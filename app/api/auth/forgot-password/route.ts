import { after } from 'next/server';

import { isEmailTestMode } from '../../../lib/email-verification';
import { issuePasswordResetCode } from '../../../lib/password-reset';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';
import { jsonError, readBoundedJson, requireSameOrigin, safeText } from '../../../lib/security';

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function passwordResetAccepted(testCode?: string): Response {
  return jsonResponse({
    ok: true,
    message: 'تم إرسال كود إعادة ضبط كلمة المرور إلى بريدك الإلكتروني بنجاح.',
    ...(testCode ? { testCode } : {}),
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const originError = requireSameOrigin(request);
    if (originError) return originError;

    const parsed = await readBoundedJson<{ email?: string }>(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const ip = getClientIp(request);
    const rateLimit = await checkRateLimit('forgot-password', ip, 10, 60);
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.resetAfterSeconds);
    }

    const rawEmail = safeText(body.email, 200).toLowerCase();
    if (!rawEmail || !rawEmail.includes('@')) {
      return jsonError('البريد الإلكتروني غير صحيح');
    }

    const targetLimit = await checkRateLimit('forgot-password-email', rawEmail, 3, 60 * 60);
    if (!targetLimit.allowed) return rateLimitResponse(targetLimit.resetAfterSeconds);

    const now = Date.now();
    if (isEmailTestMode()) {
      const result = await issuePasswordResetCode(rawEmail, now);
      return passwordResetAccepted(result.code);
    }

    after(async () => {
      await issuePasswordResetCode(rawEmail, now);
    });
    return passwordResetAccepted();
  } catch (error) {
    console.error('Password reset delivery failed', error);
    return jsonResponse({ error: 'password_reset_delivery_failed' }, 400);
  }
}
