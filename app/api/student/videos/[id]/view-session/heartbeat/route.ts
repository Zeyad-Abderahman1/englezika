import { apiVerifiedUser, isResponse } from '../../../../../../lib/api-auth';
import { getDatabase } from '../../../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../../../lib/security';

/**
 * POST /api/student/videos/[id]/view-session/heartbeat
 *
 * Called periodically (every 30s) while the video is actively playing.
 * Extends the session expiry by 30 minutes on each heartbeat.
 * If the session is expired or not found, returns 404 so the client re-requests a new session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;

  const { id } = await params;
  const db = getDatabase();
  const email = user.email.toLowerCase();
  const now = Date.now();

  const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId = body.sessionId;
  if (!sessionId || sessionId.length > 100) {
    return jsonError('معرف الجلسة مطلوب', 400);
  }

  const session = await db
    .prepare(
      `SELECT id, expires_at AS expiresAt, status
       FROM video_view_sessions
       WHERE id = ? AND video_id = ? AND user_email = ?`
    )
    .bind(sessionId, id, email)
    .first<{ id: string; expiresAt: number; status: string }>();

  if (!session) return jsonError('جلسة المشاهدة غير موجودة', 404);
  if (session.status !== 'active') return jsonError('الجلسة غير نشطة', 409);
  if (now >= session.expiresAt) return jsonError('انتهت صلاحية الجلسة', 410);

  // Extend session by 30 minutes
  const newExpiresAt = now + 30 * 60 * 1000;
  await db
    .prepare('UPDATE video_view_sessions SET expires_at = ?, last_active_at = ? WHERE id = ?')
    .bind(newExpiresAt, now, sessionId)
    .run();

  return Response.json({ ok: true, expiresAt: newExpiresAt });
}
