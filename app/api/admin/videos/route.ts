import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getDatabase } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../lib/security';
import { invalidatePublicCourseCache } from '../../../lib/public-course-cache';

function extractYouTubeId(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else if (/^\/(embed|shorts)\//.test(url.pathname)) {
        id = url.pathname.split('/').filter(Boolean)[1] || '';
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return jsonError('رفع ملفات الفيديو متوقف. أضف رابط YouTube غير مدرج بدلًا منه.', 410);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const courseId = safeText(body.courseId, 80);
  const title = safeText(body.title, 150);
  const durationSeconds = safeInteger(body.durationSeconds, 0, 0, 100_000);
  const prerequisiteExamId = safeText(body.prerequisiteExamId, 80) || null;
  const minimumScore = prerequisiteExamId ? safeInteger(body.minimumScore, 0, 0, 100) : 0;
  const maxViews = safeInteger(body.maxViews, 0, 0, 1000);
  const youtubeId = extractYouTubeId(safeText(body.youtubeUrl, 500));
  if (!courseId || title.length < 2 || !youtubeId) {
    return jsonError('اختر الكورس وأدخل عنوانًا ورابط YouTube صحيحًا');
  }

  const db = getDatabase();
  const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
  if (!course) return jsonError('الكورس غير موجود', 404);
  if (prerequisiteExamId) {
    const prerequisite = await db
      .prepare('SELECT id FROM exams WHERE id = ? AND course_id = ?')
      .bind(prerequisiteExamId, courseId)
      .first();
    if (!prerequisite) return jsonError('اختبار المتطلب غير موجود داخل هذا الكورس', 400);
  }

  const id = crypto.randomUUID();
  const sourceUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  await db
    .prepare(
      `INSERT INTO videos
       (id, course_id, title, source_type, source_url, youtube_id, duration_seconds,
        prerequisite_exam_id, minimum_score, max_views, status, created_at)
       VALUES (?, ?, ?, 'youtube', ?, ?, ?, ?, ?, ?, 'published', ?)`
    )
    .bind(
      id,
      courseId,
      title,
      sourceUrl,
      youtubeId,
      durationSeconds,
      prerequisiteExamId,
      minimumScore,
      maxViews || null,
      Date.now()
    )
    .run();
  invalidatePublicCourseCache();
  return Response.json({ ok: true, id });
}
