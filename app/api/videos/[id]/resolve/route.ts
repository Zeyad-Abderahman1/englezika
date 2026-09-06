import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { getDatabase } from '../../../../lib/platform';
import {
  authorizeVideoAccess,
  createVideoEmbedToken,
  createVideoCompletionToken,
  VIDEO_EMBED_TOKEN_TTL_MS,
} from '../../../../lib/video-access';
import { extractYouTubeId } from '../../../../lib/youtube';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser(request);
  if (isResponse(user)) return user;
  const { id } = await params;
  const access = await authorizeVideoAccess(user.email, id);
  if (!access.ok) {
    return Response.json(
      { error: access.error, ...(access.code ? { code: access.code } : {}) },
      { status: access.status, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  const db = getDatabase();
  const email = user.email.toLowerCase();
  const now = Date.now();
  const maxViews = Number(access.video.maxViews || 0);

  let activeSession: { sessionId: string; expiresAt: number } | null = null;

  if (maxViews > 0) {
    const existingSession = await db
      .prepare(
        `SELECT id, expires_at AS expiresAt
         FROM video_view_sessions
         WHERE video_id = ? AND user_email = ? AND status = 'active'
         LIMIT 1`
      )
      .bind(id, email)
      .first<{ id: string; expiresAt: number }>();

    const hasValidActiveSession = Boolean(
      existingSession && Number(existingSession.expiresAt) > now
    );

    if (hasValidActiveSession && existingSession) {
      activeSession = {
        sessionId: existingSession.id,
        expiresAt: Number(existingSession.expiresAt),
      };
    } else {
      const viewCount = await db
        .prepare(
          `SELECT COUNT(*) AS count FROM video_view_sessions
           WHERE video_id = ? AND user_email = ? AND status IN ('active', 'expired', 'submitted')`
        )
        .bind(id, email)
        .first<{ count: number }>();
      const currentViews = Number(viewCount?.count || 0);

      if (currentViews >= maxViews) {
        return Response.json(
          {
            error: 'لقد استنفدت عدد المشاهدات المسموحة لهذه المحاضرة',
            code: 'VIEW_LIMIT_REACHED',
          },
          {
            status: 403,
            headers: { 'cache-control': 'private, no-store', vary: 'Cookie' },
          }
        );
      }
    }
  } else {
    const existingSession = await db
      .prepare(
        `SELECT id, expires_at AS expiresAt
         FROM video_view_sessions
         WHERE video_id = ? AND user_email = ? AND status = 'active'
         LIMIT 1`
      )
      .bind(id, email)
      .first<{ id: string; expiresAt: number }>();
    if (existingSession && Number(existingSession.expiresAt) > now) {
      activeSession = {
        sessionId: existingSession.id,
        expiresAt: Number(existingSession.expiresAt),
      };
    }
  }

  const completionToken = await createVideoCompletionToken(
    user.email,
    id,
    access.video.durationSeconds
  );

  const youtubeId =
    extractYouTubeId(access.video.youtubeId) ||
    extractYouTubeId(access.video.sourceUrl);

  const normalizedVidstackSource = youtubeId ? `youtube/${youtubeId}` : '';
  const token = await createVideoEmbedToken(user.email, id);

  return Response.json(
    {
      kind: 'youtube',
      youtubeId,
      videoSource: normalizedVidstackSource,
      sourceUrl: normalizedVidstackSource || `/api/videos/${encodeURIComponent(id)}/embed?token=${encodeURIComponent(token)}`,
      embedUrl: `/api/videos/${encodeURIComponent(id)}/embed?token=${encodeURIComponent(token)}`,
      completionToken,
      expiresIn: Math.round(VIDEO_EMBED_TOKEN_TTL_MS / 1000),
      activeSession,
    },
    { headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } }
  );
}
