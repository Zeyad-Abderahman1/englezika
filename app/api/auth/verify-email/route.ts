import { verifyStoredCode } from '../../../lib/email-verification';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';
import { jsonError, readBoundedJson, requireSameOrigin, safeText } from '../../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const email = safeText(body.email, 200).toLowerCase();
  const code = safeText(body.code, 6);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('البريد الإلكتروني غير صحيح');
  }
  if (!/^\d{6}$/.test(code)) return jsonError('أدخل كود التفعيل المكون من 6 أرقام');

  const ipRateCheck = await checkRateLimit('verify-email-ip', getClientIp(request), 20, 60);
  if (!ipRateCheck.allowed) return rateLimitResponse(ipRateCheck.resetAfterSeconds);
  const rateCheck = await checkRateLimit(
    'verify-email',
    `${getClientIp(request)}:${email}`,
    5,
    300
  );
  if (!rateCheck.allowed) return rateLimitResponse(rateCheck.resetAfterSeconds);

  const result = await verifyStoredCode(email, code);
  if (result === 'verified' || result === 'already_verified') {
    return Response.json({ ok: true, verified: true });
  }
  if (result === 'locked') {
    return jsonError('تم إيقاف الكود بعد محاولات كثيرة. اطلب كوداً جديداً.', 429);
  }
  if (result === 'expired') return jsonError('انتهت صلاحية الكود. اطلب كوداً جديداً.', 410);
  return jsonError('كود التفعيل غير صحيح', 400);
}
