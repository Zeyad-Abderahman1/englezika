import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import {
  authorizeVideoAccess,
  createVideoEmbedToken,
  createVideoCompletionToken,
  VIDEO_EMBED_TOKEN_TTL_MS,
} from '../../../../lib/video-access';

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

  const completionToken = await createVideoCompletionToken(
    user.email,
    id,
    access.video.durationSeconds
  );

  const token = await createVideoEmbedToken(user.email, id);
  return Response.json(
    {
      kind: 'youtube',
      youtubeId: access.video.youtubeId,
      sourceUrl: `/api/videos/${encodeURIComponent(id)}/embed?token=${encodeURIComponent(token)}`,
      completionToken,
      expiresIn: Math.round(VIDEO_EMBED_TOKEN_TTL_MS / 1000),
    },
    { headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } }
  );
}
