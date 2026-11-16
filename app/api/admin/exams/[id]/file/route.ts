import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getPrivateStorage } from '../../../../../lib/private-storage';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import {
  hasAllowedContentLength,
  isPdfUpload,
  MAX_PDF_SIZE,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../../../lib/upload-validation';
import { assessmentService } from '../../../../../lib/services/assessment-service';
import { DomainError } from '../../../../../lib/services/types';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;

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

  try {
    const result = await assessmentService.uploadExamFile(id, fileBytes, mimeType, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر حفظ ملف الامتحان', 500);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const storage = getPrivateStorage();
  const storageKey = `exams/${id}/teacher.pdf`;
  const file = await storage.get(storageKey);
  if (!file) return jsonError('ملف الامتحان غير موجود', 404);

  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="exam-${id}.pdf"`,
      'content-length': String(file.size),
      'cache-control': 'no-store',
    },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;

  // assessmentService.deleteExamFile clears storage and updates DB:
  // UPDATE exams SET teacher_file_key = NULL WHERE id = ?
  try {
    await assessmentService.deleteExamFile(id, staff, { request });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر حذف ملف الامتحان', 500);
  }
}
