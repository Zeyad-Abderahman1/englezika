import { getDatabase, getPrivateStorage } from '../../../../lib/platform';

/**
 * GET /api/courses/[id]/thumbnail
 * Public-facing cached image endpoint for course artwork/thumbnail.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id || id.length > 80) {
    return new Response('Not Found', { status: 404 });
  }

  const db = getDatabase();
  const course = await db
    .prepare('SELECT thumbnail_key AS thumbnailKey FROM courses WHERE id = ?')
    .bind(id)
    .first<{ thumbnailKey: string | null }>();

  if (!course?.thumbnailKey) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  }

  const storage = getPrivateStorage();
  const file = await storage.get(course.thumbnailKey);
  if (!file) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  // Generate deterministic strong ETag based on storage key and content size
  const etag = `"${Buffer.from(`${course.thumbnailKey}:${file.size}`).toString('base64')}"`;
  const clientEtag = request.headers.get('if-none-match');

  if (clientEtag && clientEtag === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    });
  }

  const ext = course.thumbnailKey.split('.').pop()?.toLowerCase() || 'webp';
  const contentType =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : 'image/webp';

  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
