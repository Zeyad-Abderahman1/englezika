import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase, getPrivateStorage } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { invalidatePublicCourseCache } from '../../../../lib/public-course-cache';
import { recordAuditLog } from '../../../../lib/audit';
import { captureException } from '../../../../lib/observability';

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

  const video = await db
    .prepare('SELECT id, course_id AS courseId, title FROM videos WHERE id = ?')
    .bind(id)
    .first<{ id: string; courseId: string; title: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  // Collect any material files to clean up after successful DB commit
  const materials = await db
    .prepare('SELECT id, file_key AS fileKey FROM lecture_materials WHERE video_id = ?')
    .bind(id)
    .all<{ id: string; fileKey?: string | null }>()
    .catch(() => ({ results: [] as { id: string; fileKey?: string | null }[] }));

  const filesToDelete = new Set<string>();
  for (const m of materials.results) {
    if (m.fileKey) filesToDelete.add(m.fileKey);
  }

  try {
    await db.batch([
      // 1. Notification reads
      db
        .prepare("DELETE FROM notification_reads WHERE notification_type = 'video' AND notification_id = ?")
        .bind(id),
      // 2. Course items
      db.prepare('DELETE FROM course_items WHERE video_id = ?').bind(id),
      // 3. Student video progress
      db.prepare('DELETE FROM video_progress WHERE video_id = ?').bind(id),
      // 4. View sessions
      db.prepare('DELETE FROM video_view_sessions WHERE video_id = ?').bind(id),
      // 5. Access grants
      db.prepare('DELETE FROM student_video_access_grants WHERE video_id = ?').bind(id),
      // 6. Access codes
      db.prepare('DELETE FROM lecture_access_codes WHERE video_id = ?').bind(id),
      // 7. Access code batches
      db.prepare('DELETE FROM access_code_batches WHERE video_id = ?').bind(id),
      // 8. Lecture materials
      db.prepare('DELETE FROM lecture_materials WHERE video_id = ?').bind(id),
      // 9. Video record itself
      db.prepare('DELETE FROM videos WHERE id = ?').bind(id),
    ]);
  } catch (error) {
    captureException(error, { module: 'admin-video-force-delete', videoId: id });
    return jsonError('فشل حذف المحاضرة وبياناتها التابعة.', 500);
  }

  // Best-effort storage cleanup after successful DB commit
  const storage = getPrivateStorage();
  for (const key of filesToDelete) {
    try {
      await storage.delete(key);
    } catch (storageError) {
      captureException(storageError, { module: 'video-delete-storage', storageKey: key, videoId: id });
    }
  }

  await recordAuditLog({
    userEmail: admin.email,
    action: 'video.force_deleted',
    resource: 'video',
    resourceId: id,
    details: { courseId: video.courseId, title: video.title },
    request,
  });

  invalidatePublicCourseCache();
  return Response.json({ ok: true });
}
