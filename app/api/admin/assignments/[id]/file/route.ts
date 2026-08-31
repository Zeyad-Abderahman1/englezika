import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../lib/private-storage';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import {
  hasAllowedContentLength,
  isPdfUpload,
  MAX_PDF_SIZE,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../../../lib/upload-validation';

/**
 * POST /api/admin/assignments/[id]/file
 * Upload (or replace) the teacher's assignment PDF.
 * Only staff with manage_assignments may call this.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const db = getDatabase();
  const assignment = await db
    .prepare('SELECT id FROM assignments WHERE id = ?')
    .bind(id)
    .first();
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  const contentType = request.headers.get('content-type') || '';
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedContentType !== 'multipart/form-data' && normalizedContentType !== 'application/pdf') {
    return jsonError('يجب رفع ملف PDF فقط', 400);
  }
  if (!hasAllowedContentLength(request, MAX_UPLOAD_BODY_SIZE)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
  }

  let fileBytes: ArrayBuffer;
  let mimeType: string;

  if (contentType.startsWith('multipart/form-data')) {
    const formData = await request.formData().catch(() => null);
    if (!formData) return jsonError('تعذر قراءة الملف', 400);
    const file = formData.get('file');
    if (!(file instanceof Blob)) return jsonError('لم يتم اختيار ملف', 400);
    mimeType = file.type || 'application/pdf';
    fileBytes = await file.arrayBuffer();
  } else {
    mimeType = contentType;
    fileBytes = await request.arrayBuffer();
  }

  if (fileBytes.byteLength > MAX_PDF_SIZE) {
    return jsonError('حجم الملف يتجاوز الحد الأقصى (15 ميجابايت)', 400);
  }
  if (!isPdfUpload(mimeType, fileBytes)) {
    return jsonError('يجب رفع ملف PDF صالح فقط', 400);
  }

  const storage = getPrivateStorage();
  const storageKey = `assignments/${id}/teacher.pdf`;

  // Delete old file if exists
  await storage.delete(storageKey).catch(() => undefined);

  await storage.put(storageKey, new Uint8Array(fileBytes), {
    httpMetadata: { contentType: 'application/pdf', contentDisposition: 'inline' },
    customMetadata: { uploadedBy: staff.email },
  });

  try {
    await db
      .prepare('UPDATE assignments SET teacher_file_key = ? WHERE id = ?')
      .bind(storageKey, id)
      .run();
  } catch {
    await storage.delete(storageKey).catch(() => undefined);
    return jsonError('تعذر حفظ ملف الواجب', 500);
  }

  return Response.json({ ok: true, key: storageKey });
}

/**
 * GET /api/admin/assignments/[id]/file
 * Download the teacher's assignment PDF.
 * Staff with manage_assignments may access it; enrolled students via student API.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const storage = getPrivateStorage();
  const storageKey = `assignments/${id}/teacher.pdf`;
  const file = await storage.get(storageKey);
  if (!file) return jsonError('ملف الواجب غير موجود', 404);

  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="assignment-${id}.pdf"`,
      'content-length': String(file.size),
      'cache-control': 'no-store',
    },
  });
}

/**
 * DELETE /api/admin/assignments/[id]/file
 * Remove the teacher's assignment PDF.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const db = getDatabase();
  const assignment = await db
    .prepare('SELECT id FROM assignments WHERE id = ?')
    .bind(id)
    .first();
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  const storage = getPrivateStorage();
  await storage.delete(`assignments/${id}/teacher.pdf`).catch(() => undefined);

  await db
    .prepare('UPDATE assignments SET teacher_file_key = NULL WHERE id = ?')
    .bind(id)
    .run();

  return new Response(null, { status: 204 });
}
