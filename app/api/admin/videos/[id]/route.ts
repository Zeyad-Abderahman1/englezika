import { ensureDatabase } from '../../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getD1, getVideoBucket } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  await ensureDatabase();
  const { id } = await params;
  const db = getD1();
  const existing = await db
    .prepare('SELECT id, course_id AS courseId, created_at AS createdAt FROM videos WHERE id = ?')
    .bind(id)
    .first<{ id: string; courseId: string; createdAt: number }>();
  if (!existing) return jsonError('الفيديو غير موجود', 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = safeText(body.title ?? '', 150);
  if (title.length < 2) return jsonError('عنوان الفيديو مطلوب');
  const prerequisiteExamId = safeText(body.prerequisiteExamId ?? '', 80) || null;
  const requestedMinimumScore = safeInteger(body.minimumScore, 80, 80, 100);
  const status = body.status === 'draft' ? 'draft' : 'published';
  const precedingLessons = await db
    .prepare('SELECT COUNT(*) AS count FROM videos WHERE course_id = ? AND created_at < ?')
    .bind(existing.courseId, existing.createdAt)
    .first<{ count: number }>();
  if (Number(precedingLessons?.count || 0) > 0 && !prerequisiteExamId) {
    return jsonError('لا يمكن فتح هذه المحاضرة بدون اجتياز امتحان سابق بنسبة 80%', 409);
  }
  const minimumScore = prerequisiteExamId ? Math.max(80, requestedMinimumScore) : 0;
  if (prerequisiteExamId) {
    const exam = await db
      .prepare("SELECT id FROM exams WHERE id = ? AND course_id = ? AND status = 'published'")
      .bind(prerequisiteExamId, existing.courseId)
      .first();
    if (!exam) return jsonError('اختبار المحاضرة يجب أن يكون منشوراً ومن نفس الكورس', 409);
  }
  await db
    .prepare(
      'UPDATE videos SET title = ?, prerequisite_exam_id = ?, minimum_score = ?, status = ? WHERE id = ?'
    )
    .bind(title, prerequisiteExamId, minimumScore, status, id)
    .run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  await ensureDatabase();
  const { id } = await params;
  const db = getD1();
  const video = await db
    .prepare('SELECT r2_key AS r2Key FROM videos WHERE id = ?')
    .bind(id)
    .first<{ r2Key: string }>();
  if (!video) return jsonError('الفيديو غير موجود', 404);
  await getVideoBucket().delete(video.r2Key);
  await db.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  return Response.json({ ok: true });
}
