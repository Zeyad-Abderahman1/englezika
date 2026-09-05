import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getDatabase, getPrivateStorage } from '../../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import { invalidatePublicCourseCache } from '../../../../../lib/public-course-cache';
import {
  hasAllowedContentLength,
  isImageUpload,
  getImageExtension,
  getImageDimensions,
  hasReasonableCourseThumbnailDimensions,
  MAX_IMAGE_SIZE,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../../../lib/upload-validation';

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

  const db = getDatabase();
  const course = await db
    .prepare('SELECT id, thumbnail_key AS thumbnailKey FROM courses WHERE id = ?')
    .bind(id)
    .first<{ id: string; thumbnailKey: string | null }>();

  if (!course) return jsonError('الكورس غير موجود', 404);

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

  if (fileBytes.byteLength > MAX_IMAGE_SIZE) {
    return jsonError('حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت)', 400);
  }

  if (!isImageUpload(mimeType, fileBytes)) {
    return jsonError('يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP', 400);
  }

  const dimensions = getImageDimensions(mimeType, fileBytes);
  if (!dimensions || !hasReasonableCourseThumbnailDimensions(dimensions)) {
    return jsonError(
      'أبعاد الصورة غير صالحة. تأكد من رفع صورة صحيحة بدقة مناسبة (الحد الأدنى 160×90 بكسل).',
      400
    );
  }

  const storage = getPrivateStorage();
  const ext = getImageExtension(mimeType);
  const storageKey = `courses/${id}/thumbnail/${crypto.randomUUID()}.${ext}`;

  try {
    await storage.put(storageKey, new Uint8Array(fileBytes), {
      httpMetadata: { contentType: mimeType },
    });
  } catch {
    return jsonError('فشل حفظ الصورة في وحدة التخزين', 500);
  }

  try {
    const result = await db
      .prepare('UPDATE courses SET thumbnail_key = ?, updated_at = ? WHERE id = ?')
      .bind(storageKey, Date.now(), id)
      .run();

    if (result.meta.changes !== 1) {
      await storage.delete(storageKey).catch(() => {});
      return jsonError('الكورس غير موجود أو تعذر تحديثه', 404);
    }
  } catch {
    // Clean up newly uploaded orphan if DB update failed
    await storage.delete(storageKey).catch(() => {});
    return jsonError('تعذر حفظ صورة الكورس في قاعدة البيانات', 500);
  }

  // Clean up old thumbnail only after DB update succeeds
  if (course.thumbnailKey) {
    await storage.delete(course.thumbnailKey).catch(() => {});
  }

  invalidatePublicCourseCache();

  return Response.json({
    ok: true,
    key: storageKey,
    url: `/api/courses/${id}/thumbnail`,
  });
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

  const db = getDatabase();
  const course = await db
    .prepare('SELECT id, thumbnail_key AS thumbnailKey FROM courses WHERE id = ?')
    .bind(id)
    .first<{ id: string; thumbnailKey: string | null }>();

  if (!course) return jsonError('الكورس غير موجود', 404);

  if (course.thumbnailKey) {
    const oldKey = course.thumbnailKey;
    await db
      .prepare('UPDATE courses SET thumbnail_key = NULL, updated_at = ? WHERE id = ?')
      .bind(Date.now(), id)
      .run();

    const storage = getPrivateStorage();
    await storage.delete(oldKey).catch(() => {});
    invalidatePublicCourseCache();
  }

  return Response.json({ ok: true });
}
