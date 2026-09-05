import { apiVerifiedUser, isResponse } from '../../../../../../lib/api-auth';
import { getDatabase } from '../../../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../../../lib/security';

/**
 * POST /api/student/videos/[id]/view-session/start
 *
 * Starts a new view session or returns the existing active session for a video.
 * Consumes a view from the student's allowed views if starting a new session.
 *
 * max_views on the videos table controls the limit:
 *   0 = unlimited (always allows new sessions)
 *   positive integer = maximum views per student per video
 *
 * Returns:
 * - sessionId: string
 * - expiresAt: number (epoch ms)
 * - viewsRemaining: number | null (null when unlimited or reused session)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiVerifiedUser(request);
  if (isResponse(user)) return user;

  const { id } = await params;
  const db = getDatabase();
  const email = user.email.toLowerCase();
  const now = Date.now();

  // Verify enrollment and read max_views from the video
  const video = await db
    .prepare('SELECT id, course_id AS courseId, max_views AS maxViews FROM videos WHERE id = ?')
    .bind(id)
    .first<{ id: string; courseId: string; maxViews: number }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  const enrollment = await db
    .prepare(
      "SELECT 1 FROM enrollments WHERE user_email = ? AND course_id = ? AND status = 'approved' LIMIT 1"
    )
    .bind(email, video.courseId)
    .first();
  if (!enrollment) return jsonError('غير مصرح بالدخول', 403);

  // Reuse existing active session if still valid
  const existing = await db
    .prepare(
      `SELECT id, expires_at AS expiresAt
       FROM video_view_sessions
       WHERE video_id = ? AND user_email = ? AND status = 'active'
       LIMIT 1`
    )
    .bind(id, email)
    .first<{ id: string; expiresAt: number }>();

  if (existing && existing.expiresAt > now) {
    return Response.json({
      sessionId: existing.id,
      expiresAt: existing.expiresAt,
      viewsRemaining: null,
    });
  }

  const maxViews = video.maxViews;

  // Enforce view limit when max_views > 0 (0 = unlimited)
  if (maxViews > 0) {
    const viewCount = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM video_view_sessions
         WHERE video_id = ? AND user_email = ? AND status IN ('active', 'expired', 'submitted')`
      )
      .bind(id, email)
      .first<{ count: number }>();
    const currentViews = Number(viewCount?.count || 0);

    if (currentViews >= maxViews) {
      return jsonError('لقد استنفدت عدد المشاهدات المسموحة لهذه المحاضرة', 403);
    }

    // Create new session — expires in 30 minutes; heartbeat extends by 30 min each time
    const sessionId = crypto.randomUUID();
    const expiresAt = now + 30 * 60 * 1000;
    await db
      .prepare(
        `INSERT INTO video_view_sessions (id, video_id, user_email, session_token, started_at, last_active_at, expires_at, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .bind(sessionId, id, email, sessionId, now, now, expiresAt, now)
      .run();

    return Response.json({
      sessionId,
      expiresAt,
      viewsRemaining: maxViews - currentViews - 1,
    });
  }

  // Unlimited (max_views = 0): no count check, just create a new session
  const sessionId = crypto.randomUUID();
  const expiresAt = now + 30 * 60 * 1000;
  await db
    .prepare(
      `INSERT INTO video_view_sessions (id, video_id, user_email, session_token, started_at, last_active_at, expires_at, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    )
    .bind(sessionId, id, email, sessionId, now, now, expiresAt, now)
    .run();

  return Response.json({
    sessionId,
    expiresAt,
    viewsRemaining: null,
  });
}
