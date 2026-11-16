import { apiStaff, isStaffResponse } from '../../../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../../../lib/private-storage';
import { jsonError, requireSameOrigin } from '../../../../../../../lib/security';
import {
  hasAllowedContentLength,
  isImageUpload,
  getImageExtension,
  MAX_IMAGE_SIZE,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../../../../../lib/upload-validation';

/**
 * POST /api/admin/assignments/[id]/questions/[qId]/image
 * Upload (or replace) an image for an MCQ question.
 * Only staff with manage_assignments may call this.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; qId: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id, qId } = await params;
  const db = getDatabase();

  const assignment = await db
    .prepare('SELECT id FROM assignments WHERE id = ?')
    .bind(id)
    .first();
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  const question = await db
    .prepare(
      'SELECT id, image_file_key AS imageFileKey FROM assignment_questions WHERE id = ? AND assignment_id = ?'
    )
    .bind(qId, id)
    .first<{ id: string; imageFileKey: string | null }>();
  if (!question) return jsonError('السؤال غير موجود', 404);

  const contentType = request.headers.get('content-type') || '';
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedContentType !== 'multipart/form-data') {
    return jsonError('يجب رفع صورة فقط (multipart/form-data)', 400);
  }
  if (!hasAllowedContentLength(request, MAX_UPLOAD_BODY_SIZE)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError('تعذر قراءة الملف', 400);
  const file = formData.get('file');
  if (!(file instanceof Blob)) return jsonError('لم يتم اختيار ملف', 400);

  const mimeType = file.type || 'image/jpeg';
  const fileBytes = await file.arrayBuffer();

  if (fileBytes.byteLength > MAX_IMAGE_SIZE) {
    return jsonError('حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت)', 400);
  }
  if (!isImageUpload(mimeType, fileBytes)) {
    return jsonError('يجب رفع صورة JPEG أو PNG أو WebP فقط', 400);
  }

  const storage = getPrivateStorage();

  if (question.imageFileKey) {
    await storage.delete(question.imageFileKey).catch(() => {});
  }

  const ext = getImageExtension(mimeType);
  const storageKey = `assignments/${id}/questions/${qId}.${ext}`;
  await storage.put(storageKey, new Uint8Array(fileBytes), {
    httpMetadata: { contentType: mimeType },
  });

  await db
    .prepare('UPDATE assignment_questions SET image_file_key = ? WHERE id = ?')
    .bind(storageKey, qId)
    .run();

  return Response.json({ ok: true, key: storageKey });
}

/**
 * DELETE /api/admin/assignments/[id]/questions/[qId]/image
 * Remove the image from an MCQ question.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; qId: string }> }
) {
  const staff = await apiStaff(_request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id, qId } = await params;
  const db = getDatabase();

  const question = await db
    .prepare(
      'SELECT id, image_file_key AS imageFileKey FROM assignment_questions WHERE id = ? AND assignment_id = ?'
    )
    .bind(qId, id)
    .first<{ id: string; imageFileKey: string | null }>();
  if (!question) return jsonError('السؤال غير موجود', 404);

  if (question.imageFileKey) {
    const storage = getPrivateStorage();
    await storage.delete(question.imageFileKey).catch(() => {});
    await db
      .prepare('UPDATE assignment_questions SET image_file_key = NULL WHERE id = ?')
      .bind(qId)
      .run();
  }

  return Response.json({ ok: true });
}
