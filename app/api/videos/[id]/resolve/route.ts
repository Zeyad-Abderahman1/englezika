import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import {
  authorizeVideoAccess,
  createVideoEmbedToken,
  VIDEO_EMBED_TOKEN_TTL_MS,
} from '../../../../lib/video-access';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const access = await authorizeVideoAccess(user.email, id);
  if (!access.ok) {
    return Response.json(
      { error: access.error, ...(access.code ? { code: access.code } : {}) },
      { status: access.status, headers: { 'cache-control': 'private, no-store' } }
    );
  }

  if (access.video.sourceType !== 'youtube') {
    return Response.json(
      { kind: 'upload', sourceUrl: `/api/videos/${encodeURIComponent(id)}` },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } }
    );
  }

  const token = await createVideoEmbedToken(user.email, id);
  return Response.json(
    {
      kind: 'youtube',
      sourceUrl: `/api/videos/${encodeURIComponent(id)}/embed?token=${encodeURIComponent(token)}`,
      expiresIn: Math.round(VIDEO_EMBED_TOKEN_TTL_MS / 1000),
    },
    { headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } }
  );
}
