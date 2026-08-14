import { getDatabase } from '../../lib/platform';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../lib/rate-limit';
import { jsonError, requireSameOrigin, safeText } from '../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentLength = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > 16 * 1024) {
    return jsonError('request_too_large', 413);
  }
  const rateLimit = await checkRateLimit('contact', getClientIp(request), 5, 300);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAfterSeconds);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = safeText(body?.name, 100);
  const phone = safeText(body?.phone, 30);
  const message = safeText(body?.message, 2000);
  if (name.length < 2 || phone.length < 8 || message.length < 5) {
    return jsonError('من فضلك أكمل البيانات بشكل صحيح');
  }
  await getDatabase()
    .prepare(
      "INSERT INTO contacts (id, name, phone, message, status, created_at) VALUES (?, ?, ?, ?, 'new', ?)"
    )
    .bind(crypto.randomUUID(), name, phone, message, Date.now())
    .run();
  return Response.json({ ok: true });
}
