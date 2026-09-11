import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import {
  hasAllowedContentLength,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../../../lib/upload-validation';
import { courseService } from '../../../../../lib/services/course-service';
import { DomainError } from '../../../../../lib/services/types';

/**
 * POST /api/admin/courses/[id]/thumbnail
 * Upload or replace a course thumbnail image.
 * Requires manage_courses staff permission and same-origin CSRF check.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  if (!id || id.length > 80) return jsonError('معرف الكورس غير صالح', 400);

  const contentType = request.headers.get('content-type') || '';
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedContentType !== 'multipart/form-data') {
    return jsonError('يجب رفع صورة فقط (multipart/form-data)', 400);
  }

  if (!hasAllowedContentLength(request, MAX_UPLOAD_BODY_SIZE)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError('تعذر قراءة بيانات الملف', 400);

  const file = formData.get('file');
  if (!(file instanceof Blob)) return jsonError('لم يتم اختيار ملف', 400);

  const mimeType = file.type || 'image/jpeg';
  const fileBytes = await file.arrayBuffer();

  try {
    const result = await courseService.uploadThumbnail(id, fileBytes, mimeType, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('فشل حفظ صورة الكورس', 500);
  }
}

/**
 * DELETE /api/admin/courses/[id]/thumbnail
 * Remove a course thumbnail image and clean up storage.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  if (!id || id.length > 80) return jsonError('معرف الكورس غير صالح', 400);

  try {
    const result = await courseService.deleteThumbnail(id, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر حذف صورة الكورس', 500);
  }
}

