import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { invalidatePublicCourseCache } from '../../../../lib/public-course-cache';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;
  const db = getDatabase();
  const existing = await db
    .prepare(
      `SELECT id, course_id AS courseId, prerequisite_exam_id AS prerequisiteExamId,
       minimum_score AS minimumScore, max_views AS maxViews FROM videos WHERE id = ?`
    )
    .bind(id)
    .first<{
      id: string;
      courseId: string;
      prerequisiteExamId: string | null;
      minimumScore: number;
      maxViews: number | null;
    }>();
  if (!existing) return jsonError('الفيديو غير موجود', 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = safeText(body.title ?? '', 150);
  if (title.length < 2) return jsonError('عنوان الفيديو مطلوب');
  const changesPrerequisite = Object.prototype.hasOwnProperty.call(body, 'prerequisiteExamId');
  const prerequisiteExamId = changesPrerequisite
    ? safeText(body.prerequisiteExamId, 80) || null
    : existing.prerequisiteExamId;
  const minimumScore = prerequisiteExamId
    ? Object.prototype.hasOwnProperty.call(body, 'minimumScore')
      ? safeInteger(body.minimumScore, 0, 0, 100)
      : existing.minimumScore
    : 0;
  if (prerequisiteExamId) {
    const prerequisite = await db
      .prepare('SELECT id FROM exams WHERE id = ? AND course_id = ?')
      .bind(prerequisiteExamId, existing.courseId)
      .first();
    if (!prerequisite) return jsonError('اختبار المتطلب غير موجود داخل هذا الكورس', 400);
  }
  const status = body.status === 'draft' ? 'draft' : 'published';
  const maxViews = Object.prototype.hasOwnProperty.call(body, 'maxViews')
    ? safeInteger(body.maxViews, 0, 0, 1000)
    : existing.maxViews;
  await db
    .prepare(
      'UPDATE videos SET title = ?, prerequisite_exam_id = ?, minimum_score = ?, max_views = ?, status = ? WHERE id = ?'
    )
    .bind(title, prerequisiteExamId, minimumScore, maxViews || null, status, id)
    .run();
  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;
  const db = getDatabase();
  const video = await db.prepare('SELECT id FROM videos WHERE id = ?').bind(id).first();
  if (!video) return jsonError('الفيديو غير موجود', 404);
  await db.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}
