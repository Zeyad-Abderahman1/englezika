import { ensureDatabase } from '../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getD1, getVideoBucket } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../lib/security';

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  const courseId = safeText(request.headers.get('x-course-id'), 80);
  let decodedTitle = '';
  try {
    decodedTitle = decodeURIComponent(request.headers.get('x-video-title') || '');
  } catch {
    return jsonError('عنوان الفيديو غير صالح');
  }
  const title = safeText(decodedTitle, 150);
  const durationSeconds = safeInteger(request.headers.get('x-video-duration'), 0, 0, 100_000);
  const prerequisiteExamId = safeText(request.headers.get('x-prerequisite-exam-id'), 80) || null;
  const requestedMinimumScore = safeInteger(request.headers.get('x-minimum-score'), 80, 80, 100);
  const contentType = request.headers.get('content-type') || '';
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!courseId || !title || !contentType.startsWith('video/') || !request.body) {
    return jsonError('ملف الفيديو واسم الكورس والعنوان مطلوبة');
  }
  if (contentLength > MAX_VIDEO_BYTES) return jsonError('حجم الفيديو أكبر من الحد المسموح', 413);
  await ensureDatabase();
  const db = getD1();
  const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
  if (!course) return jsonError('الكورس غير موجود', 404);
  const existingLessons = await db
    .prepare('SELECT COUNT(*) AS count FROM videos WHERE course_id = ?')
    .bind(courseId)
    .first<{ count: number }>();
  if (Number(existingLessons?.count || 0) > 0 && !prerequisiteExamId) {
    return jsonError('كل محاضرة بعد الأولى تحتاج امتحانًا سابقًا لفتحها', 409);
  }
  const minimumScore = prerequisiteExamId ? Math.max(80, requestedMinimumScore) : 0;
  if (prerequisiteExamId) {
    const exam = await db
      .prepare("SELECT id FROM exams WHERE id = ? AND course_id = ? AND status = 'published'")
      .bind(prerequisiteExamId, courseId)
      .first();
    if (!exam) return jsonError('اختبار المحاضرة يجب أن يكون منشوراً ومن نفس الكورس', 409);
  }
  const id = crypto.randomUUID();
  const safeExtension = contentType.includes('webm') ? 'webm' : 'mp4';
  const key = `courses/${courseId}/${id}.${safeExtension}`;
  await getVideoBucket().put(key, request.body, {
    httpMetadata: { contentType, contentDisposition: 'inline' },
    customMetadata: { courseId, uploadedBy: admin.email.toLowerCase(), title },
  });
  await db
    .prepare(
      `INSERT INTO videos
     (id, course_id, title, r2_key, content_type, duration_seconds,
      prerequisite_exam_id, minimum_score, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
    )
    .bind(
      id,
      courseId,
      title,
      key,
      contentType,
      durationSeconds,
      prerequisiteExamId,
      minimumScore,
      Date.now()
    )
    .run();
  return Response.json({ ok: true, id });
}
