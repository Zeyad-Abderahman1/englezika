import {
  createVerificationCode,
  hashVerificationCode,
  isEmailTestMode,
  isEmailVerified,
  loadEmailVerification,
  recordDeliveryId,
  releaseFailedDelivery,
  saveVerificationCode,
  sendVerificationEmail,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_RESEND_MS,
} from '../../../lib/email-verification';
import { findStudentByEmail } from '../../../lib/native-auth';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';
import { jsonError, requireSameOrigin, safeText } from '../../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const ipRateCheck = await checkRateLimit('resend-verification-ip', getClientIp(request), 10, 60);
  if (!ipRateCheck.allowed) return rateLimitResponse(ipRateCheck.resetAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = safeText(body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('البريد الإلكتروني غير صحيح');
  }
  const student = await findStudentByEmail(email);
  if (!student) return Response.json({ ok: true });
  if (await isEmailVerified(email)) {
    return Response.json({ ok: true });
  }

  const rateCheck = await checkRateLimit('resend-verification', email, 1, 60);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck.resetAfterSeconds, 'انتظر دقيقة قبل طلب كود تفعيل جديد.');
  }
  const existing = await loadEmailVerification(email);
  const now = Date.now();
  if (existing?.sentAt && now - existing.sentAt < VERIFICATION_RESEND_MS) {
    const retryAfter = Math.ceil((VERIFICATION_RESEND_MS - (now - existing.sentAt)) / 1000);
    return Response.json(
      { error: 'انتظر دقيقة قبل طلب كود تفعيل جديد.', retryAfter },
      { status: 429, headers: { 'retry-after': String(retryAfter) } }
    );
  }

  const code = createVerificationCode();
  const codeHash = await hashVerificationCode(email, code);
  await saveVerificationCode(email, codeHash, now);
  try {
    const deliveryId = await sendVerificationEmail(email, code, `verify-${codeHash.slice(0, 32)}`);
    await recordDeliveryId(email, codeHash, deliveryId);
  } catch {
    await releaseFailedDelivery(email, codeHash);
    return jsonError('تعذر إرسال كود التفعيل الآن. حاول مرة أخرى لاحقاً.', 503);
  }

  return Response.json({
    ok: true,
    expiresIn: Math.round(VERIFICATION_CODE_TTL_MS / 1000),
    ...(isEmailTestMode() ? { testCode: code } : {}),
  });
}
