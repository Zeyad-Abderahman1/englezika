import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import {
  hasAllowedContentLength,
  MAX_UPLOAD_BODY_SIZE,
  sniffImageMimeType,
} from '../../../../../lib/upload-validation';
import { examListingService } from '../../../../../lib/services/exam-listing-service';
import { DomainError } from '../../../../../lib/services/types';

/**
 * POST /api/admin/exams/[id]/thumbnail  — upload or replace the exam thumbnail.
 * DELETE                                 — remove it.
 * Same validation and messages as the course thumbnail endpoint (JPG/PNG/WebP, 5MB, min size).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  if (!id || id.length > 80) return jsonError('معرف الامتحان غير صالح', 400);

  const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'multipart/form-data') return jsonError('يجب رفع صورة فقط (multipart/form-data)', 400);
  if (!hasAllowedContentLength(request, MAX_UPLOAD_BODY_SIZE)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError('تعذر قراءة بيانات الملف', 400);
  const file = formData.get('file');
  if (!(file instanceof Blob)) return jsonError('لم يتم اختيار ملف', 400);

  const bytes = await file.arrayBuffer();
  const mimeType = sniffImageMimeType(bytes) || file.type || 'image/jpeg';

  try {
    return Response.json(await examListingService.setThumbnail(id, bytes, mimeType, staff, { request }));
  } catch (error) {
    if (error instanceof DomainError) return jsonError(error.message, error.status);
    return jsonError('فشل حفظ صورة الامتحان', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  if (!id || id.length > 80) return jsonError('معرف الامتحان غير صالح', 400);
  try {
    return Response.json(await examListingService.deleteThumbnail(id, staff, { request }));
  } catch (error) {
    if (error instanceof DomainError) return jsonError(error.message, error.status);
    return jsonError('تعذر حذف صورة الامتحان', 500);
  }
}
