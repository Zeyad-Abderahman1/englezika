import { consumePasswordResetCode } from '../../../lib/password-reset';
import { updateStudentPassword } from '../../../lib/native-auth';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';
import {
  isStrongPassword,
  readBoundedJson,
  requireSameOrigin,
  safeText,
} from '../../../lib/security';

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

    const parsed = await readBoundedJson<{
      email?: string;
      code?: string;
      new_password?: string;
    }>(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const ipLimit = await checkRateLimit('password-reset-submit-ip', getClientIp(request), 20, 60);
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit.resetAfterSeconds);

    const email = safeText(body.email, 200).toLowerCase();
    const code = safeText(body.code, 6);
    const newPassword = body.new_password;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'البريد الإلكتروني غير صحيح' }, 400);
    }
    if (!/^\d{6}$/.test(code)) {
      return jsonResponse({ error: 'كود التحقق يجب أن يتكون من 6 أرقام' }, 400);
    }
    const accountLimit = await checkRateLimit('password-reset-submit-email', email, 10, 300);
    if (!accountLimit.allowed) return rateLimitResponse(accountLimit.resetAfterSeconds);
    if (!newPassword || !isStrongPassword(newPassword)) {
      return jsonResponse({ error: 'كلمة المرور الجديدة يجب أن تكون 12 حرفاً على الأقل' }, 400);
    }

    const result = await consumePasswordResetCode(email, code);
    if (result === 'expired') {
      return jsonResponse({ error: 'انتهت صلاحية كود التحقق. اطلب كوداً جديداً.' }, 400);
    }
    if (result === 'locked') {
      return jsonResponse({ error: 'تم تجاوز عدد المحاولات المسموحة للكود.' }, 400);
    }
    if (result === 'used') {
      return jsonResponse(
        {
          error: 'كود إعادة الضبط استُخدم من قبل. اطلب كوداً جديداً.',
        },
        400
      );
    }
    if (result !== 'verified') {
      return jsonResponse({ error: 'كود التحقق غير صحيح. تأكد من الرقم المكتب.' }, 400);
    }

    const updated = await updateStudentPassword(email, newPassword);
    if (!updated) {
      return jsonResponse({ error: 'لم نتمكن من العثور على الحساب لربطه.' }, 400);
    }

    return jsonResponse({
      ok: true,
      message: 'تم تحديث كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.',
    });
  } catch {
    return jsonResponse({ error: 'تعذر تغيير كلمة المرور الآن. حاول مرة أخرى لاحقاً.' }, 500);
  }
}
