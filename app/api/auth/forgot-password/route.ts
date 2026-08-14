import { isEmailTestMode } from '../../../lib/email-verification';
import {
  createPasswordResetCode,
  hashPasswordResetCode,
  invalidatePasswordResetCode,
  recordPasswordResetDelivery,
  savePasswordResetCode,
  sendPasswordResetEmail,
} from '../../../lib/password-reset';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';
import { jsonError, requireSameOrigin, safeText } from '../../../lib/security';

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const originError = requireSameOrigin(request);
    if (originError) return originError;

    const ip = getClientIp(request);
    const rateLimit = await checkRateLimit('forgot-password', ip, 10, 60);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.resetAfterSeconds);
    }

    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const rawEmail = safeText(body.email, 200).toLowerCase();
    if (!rawEmail || !rawEmail.includes('@')) {
      return jsonError('البريد الإلكتروني غير صحيح');
    }

    const targetLimit = await checkRateLimit('forgot-password-email', rawEmail, 3, 60 * 60);
    if (!targetLimit.allowed) return rateLimitResponse(targetLimit.resetAfterSeconds);

    const now = Date.now();
    const code = createPasswordResetCode();
    const codeHash = await hashPasswordResetCode(rawEmail, code);
    const idempotencyKey = `reset-${rawEmail}-${now}`;

    await savePasswordResetCode(rawEmail, codeHash, now);

    try {
      const deliveryId = await sendPasswordResetEmail(rawEmail, code, idempotencyKey);
      await recordPasswordResetDelivery(rawEmail, codeHash, deliveryId);
    } catch (error) {
      await invalidatePasswordResetCode(rawEmail, codeHash).catch(() => {});
      throw error;
    }
    const testCode = isEmailTestMode() ? code : undefined;

    return jsonResponse({
      ok: true,
      message: 'تم إرسال كود إعادة ضبط كلمة المرور إلى بريدك الإلكتروني بنجاح.',
      ...(testCode ? { testCode } : {}),
    });
  } catch (error) {
    console.error('Password reset delivery failed', error);
    return jsonResponse({ error: 'password_reset_delivery_failed' }, 400);
  }
}
