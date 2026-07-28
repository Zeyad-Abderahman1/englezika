import { isEmailTestMode } from '../../../lib/email-verification';
import {
  createPasswordResetCode,
  hashPasswordResetCode,
  invalidatePasswordResetCode,
  recordPasswordResetDelivery,
  savePasswordResetCode,
  sendPasswordResetEmail,
} from '../../../lib/password-reset';
import { checkRateLimit } from '../../../lib/rate-limit';

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ip =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      '127.0.0.1';
    const rateLimit = await checkRateLimit('forgot-password', ip, 10, 60);
    if (!rateLimit.allowed) {
      return jsonResponse({ error: 'تجاوزت الحد المسموح من المحاولات. حاول مجدداً لاحقاً.' }, 429);
    }

    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const rawEmail = body.email?.trim().toLowerCase();
    if (!rawEmail || !rawEmail.includes('@')) {
      return jsonResponse({ error: 'البريد الإلكتروني غير صحيح' }, 400);
    }

    const now = Date.now();
    const code = createPasswordResetCode();
    const codeHash = await hashPasswordResetCode(rawEmail, code);
    const idempotencyKey = `reset-${rawEmail}-${now}`;

    await savePasswordResetCode(rawEmail, codeHash, now);

    let deliveryId: string;
    try {
      deliveryId = await sendPasswordResetEmail(rawEmail, code, idempotencyKey);
      await recordPasswordResetDelivery(rawEmail, codeHash, deliveryId);
    } catch (error) {
      await invalidatePasswordResetCode(rawEmail, codeHash).catch(() => {});
      throw error;
    }
    const testCode = isEmailTestMode() ? code : undefined;

    return jsonResponse({
      ok: true,
      message: 'تم إرسال كود إعادة ضبط كلمة المرور إلى بريدك الإلكتروني بنجاح.',
      deliveryId,
      ...(testCode ? { testCode } : {}),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        error: `تعذر الإرسال: ${msg}`,
      },
      400
    );
  }
}
