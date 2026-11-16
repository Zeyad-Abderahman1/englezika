import { getPrivateStorage } from './platform';

/** Serves a stored exam thumbnail with a strong ETag and cache headers (same approach as course thumbnails). */
export async function thumbnailResponse(request: Request, key: string | null | undefined): Promise<Response> {
  if (!key) {
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  }
  const file = await getPrivateStorage().get(key);
  if (!file) {
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  }

  const etag = `"${Buffer.from(`${key}:${file.size}`).toString('base64')}"`;
  const versioned = Boolean(new URL(request.url).searchParams.get('v'));
  const cacheControl = versioned
    ? 'public, max-age=86400, stale-while-revalidate=3600'
    : 'public, no-cache, must-revalidate';

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cacheControl } });
  }

  const ext = key.split('.').pop()?.toLowerCase();
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(file.size),
      ETag: etag,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
