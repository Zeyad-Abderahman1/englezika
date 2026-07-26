import { apiUser, isResponse } from '../../../lib/api-auth';
import { verifyStoredCode } from '../../../lib/email-verification';
import { jsonError, requireSameOrigin } from '../../../lib/security';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit('verify-code', ip, 5, 300);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck.resetAfterSeconds);
  }
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) return jsonError('أدخل كود التفعيل المكون من 6 أرقام');

  const result = await verifyStoredCode(user.email, code);
  if (result === 'verified' || result === 'already_verified') {
    return Response.json({ ok: true, verified: true });
  }
  if (result === 'locked')
    return jsonError('تم إيقاف الكود بعد محاولات كثيرة. اطلب كودًا جديدًا.', 429);
  if (result === 'expired') return jsonError('انتهت صلاحية الكود. اطلب كودًا جديدًا.', 410);
  return jsonError('كود التفعيل غير صحيح', 400);
}
