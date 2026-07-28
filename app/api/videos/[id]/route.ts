import { apiVerifiedUser, isResponse } from '../../../lib/api-auth';
import { getVideoBucket } from '../../../lib/platform';
import { jsonError } from '../../../lib/security';
import { authorizeVideoAccess } from '../../../lib/video-access';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const video = access.video;
  if (video.sourceType === 'youtube') {
    return jsonError('هذا الدرس يُشغّل من خلال مشغل YouTube داخل صفحة الكورس', 409);
  }
  const bucket = getVideoBucket();
  const rangeHeader = request.headers.get('range');
  let object: R2ObjectBody | null;
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const metadata = await bucket.head(video.r2Key);
    if (!metadata || start >= metadata.size) return new Response(null, { status: 416 });
    const requestedEnd = match[2] ? Number(match[2]) : metadata.size - 1;
    const end = Math.min(requestedEnd, metadata.size - 1);
    object = await bucket.get(video.r2Key, { range: { offset: start, length: end - start + 1 } });
    if (!object) return jsonError('تعذر تحميل الفيديو', 404);
    const headers = new Headers({
      'content-type': video.contentType,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${metadata.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store, max-age=0',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    });
    return new Response(object.body, { status: 206, headers });
  }
  object = await bucket.get(video.r2Key);
  if (!object) return jsonError('تعذر تحميل الفيديو', 404);
  const headers = new Headers({
    'content-type': video.contentType,
    'content-length': String(object.size),
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store, max-age=0',
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
  });
  return new Response(object.body, { status: 200, headers });
}
