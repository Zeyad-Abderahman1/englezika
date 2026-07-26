import { apiUser, isResponse } from '../../../lib/api-auth';
import {
  createVerificationCode,
  hashVerificationCode,
  isEmailTestMode,
  loadEmailVerification,
  recordDeliveryId,
  releaseFailedDelivery,
  saveVerificationCode,
  sendVerificationEmail,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_RESEND_MS,
} from '../../../lib/email-verification';
import { jsonError, requireSameOrigin } from '../../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiUser();
  if (isResponse(user)) return user;
  const existing = await loadEmailVerification(user.email);
  if (existing?.verifiedAt) {
    return Response.json({ ok: true, verified: true });
  }

  const now = Date.now();
  if (existing?.sentAt && now - existing.sentAt < VERIFICATION_RESEND_MS) {
    const retryAfter = Math.ceil((VERIFICATION_RESEND_MS - (now - existing.sentAt)) / 1000);
    return Response.json(
      { error: 'انتظر قليلًا قبل طلب كود جديد', retryAfter },
      { status: 429, headers: { 'retry-after': String(retryAfter) } }
    );
  }

  const code = createVerificationCode();
  const codeHash = await hashVerificationCode(user.email, code);
  await saveVerificationCode(user.email, codeHash, now);
  const idempotencyKey = `verify-${codeHash.slice(0, 32)}`;

  let deliveryId: string;
  try {
    deliveryId = await sendVerificationEmail(user.email, code, idempotencyKey);
  } catch (error) {
    await releaseFailedDelivery(user.email, codeHash);
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('422') || msg.includes('testing email') || msg.includes('validation_error')) {
      return jsonError(
        'في وضع التجربة المجاني (onboarding@resend.dev)، يمكنك الإرسال فقط إلى البريد الإلكتروني الذي أنشأت به حسابك في Resend.',
        400
      );
    }
    return jsonError(
      'تعذر إرسال كود التفعيل الآن. تحقق من البريد الإلكتروني أو تواصل مع الدعم.',
      503
    );
  }
  try {
    await recordDeliveryId(user.email, codeHash, deliveryId);
  } catch (error) {
    console.error('Verification delivery ID could not be recorded', error);
  }

  return Response.json({
    ok: true,
    expiresIn: Math.round(VERIFICATION_CODE_TTL_MS / 1000),
    ...(isEmailTestMode() ? { testCode: code } : {}),
  });
}
