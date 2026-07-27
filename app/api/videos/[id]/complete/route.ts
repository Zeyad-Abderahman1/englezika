import { ensureDatabase } from '../../../../../db/runtime';
import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { getD1 } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  await ensureDatabase();
  const { id } = await params;
  const email = user.email.toLowerCase();
  const db = getD1();
  const video = await db
    .prepare(
      `SELECT v.id, v.course_id AS courseId
       FROM videos v JOIN enrollments e ON e.course_id = v.course_id
       WHERE v.id = ? AND v.status = 'published'
       AND e.user_email = ? AND e.status = 'approved' LIMIT 1`
    )
    .bind(id, email)
    .first<{ id: string; courseId: string }>();
  if (!video) return jsonError('المحاضرة غير متاحة لهذا الحساب', 403);

  const previousVideo = await db
    .prepare(
      `SELECT id FROM videos
       WHERE course_id = ? AND status = 'published' AND created_at < (
         SELECT created_at FROM videos WHERE id = ?
       ) ORDER BY created_at DESC LIMIT 1`
    )
    .bind(video.courseId, id)
    .first<{ id: string }>();
  if (previousVideo) {
    const previousCompleted = await db
      .prepare('SELECT id FROM video_progress WHERE user_email = ? AND video_id = ? LIMIT 1')
      .bind(email, previousVideo.id)
      .first();
    if (!previousCompleted) return jsonError('يجب إنهاء المحاضرة السابقة أولًا', 409);
  }

  await db
    .prepare(
      `INSERT INTO video_progress (id, user_email, video_id, completed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_email, video_id) DO UPDATE SET completed_at = excluded.completed_at`
    )
    .bind(crypto.randomUUID(), email, id, Date.now())
    .run();
  return Response.json({ ok: true, videoId: id });
}
