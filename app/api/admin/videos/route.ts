import { ensureDatabase } from '../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getD1, getVideoBucket } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../lib/security';

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

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
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const courseId = safeText(body.courseId, 80);
    const title = safeText(body.title, 150);
    const durationSeconds = safeInteger(body.durationSeconds, 0, 0, 100_000);
    const submittedUrl = safeText(body.youtubeUrl, 500);
    const youtubeId = extractYouTubeId(submittedUrl);
    if (!courseId || title.length < 2 || !youtubeId) {
      return jsonError('اختر الكورس وأدخل عنواناً ورابط YouTube صحيحاً');
    }
    await ensureDatabase();
    const db = getD1();
    const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) return jsonError('الكورس غير موجود', 404);
    const id = crypto.randomUUID();
    const sourceUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    await db
      .prepare(
        `INSERT INTO videos
         (id, course_id, title, r2_key, content_type, source_type, source_url, youtube_id,
          duration_seconds, prerequisite_exam_id, minimum_score, status, created_at)
         VALUES (?, ?, ?, '', 'video/youtube', 'youtube', ?, ?, ?, NULL, 0, 'published', ?)`
      )
      .bind(id, courseId, title, sourceUrl, youtubeId, durationSeconds, Date.now())
      .run();
    return Response.json({ ok: true, id });
  }

  const courseId = safeText(request.headers.get('x-course-id'), 80);
  let decodedTitle = '';
  try {
    decodedTitle = decodeURIComponent(request.headers.get('x-video-title') || '');
  } catch {
    return jsonError('عنوان الفيديو غير صالح');
  }
  const title = safeText(decodedTitle, 150);
  const durationSeconds = safeInteger(request.headers.get('x-video-duration'), 0, 0, 100_000);
  const prerequisiteExamId = null;
  const minimumScore = 0;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!courseId || !title || !contentType.startsWith('video/') || !request.body) {
    return jsonError('ملف الفيديو واسم الكورس والعنوان مطلوبة');
  }
  if (contentLength > MAX_VIDEO_BYTES) return jsonError('حجم الفيديو أكبر من الحد المسموح', 413);
  await ensureDatabase();
  const db = getD1();
  const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
  if (!course) return jsonError('الكورس غير موجود', 404);
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
     (id, course_id, title, r2_key, content_type, source_type, duration_seconds,
      prerequisite_exam_id, minimum_score, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'upload', ?, ?, ?, 'published', ?)`
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
