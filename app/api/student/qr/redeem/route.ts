import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { normalizeLectureQRToken, redeemLectureAccessCode } from '../../../../lib/lecture-access-codes';
import { getDatabase } from '../../../../lib/platform';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../../lib/rate-limit';
import { requireSameOrigin } from '../../../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;

  const email = user.email.toLowerCase();
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };

  if (!body || typeof body.token !== 'string' || !body.token.trim()) {
    return Response.json(
      { ok: false, error: 'رمز QR مطلوب.', code: 'token_required' },
      { status: 400 }
    );
  }

  const normalizedToken = normalizeLectureQRToken(body.token);
  if (!normalizedToken) {
    return Response.json(
      { ok: false, error: 'رمز QR غير صالح.', code: 'invalid_token' },
      { status: 400 }
    );
  }

  const ip = getClientIp(request);
  const accountLimit = await checkRateLimit('lecture-code-account', email, 8, 15 * 60);
  if (!accountLimit.allowed) {
    return rateLimitResponse(
      accountLimit.resetAfterSeconds,
      'تم إجراء محاولات كثيرة. حاول مرة أخرى لاحقًا.'
    );
  }

  const ipLimit = await checkRateLimit('lecture-code-ip', ip, 30, 15 * 60);
  if (!ipLimit.allowed) {
    return rateLimitResponse(
      ipLimit.resetAfterSeconds,
      'تم إجراء محاولات كثيرة. حاول مرة أخرى لاحقًا.'
    );
  }

  const result = await redeemLectureAccessCode(getDatabase(), email, normalizedToken);
  if (result.status === 'invalid_code') {
    return Response.json(
      { ok: false, error: 'رمز QR غير صالح.', code: 'invalid_token' },
      { status: 400 }
    );
  }

  if (result.status === 'already_used') {
    return Response.json(
      { ok: false, error: 'تم استخدام رمز QR هذا مسبقًا.', code: 'already_used' },
      { status: 409 }
    );
  }

  return Response.json(
    {
      ok: true,
      code: 'success',
      lecture: {
        videoId: result.videoId,
        videoTitle: result.videoTitle,
        courseId: result.courseId,
        courseTitle: result.courseTitle,
        watchUrl: `/learn/${encodeURIComponent(result.courseId)}?video=${encodeURIComponent(result.videoId)}`,
      },
    },
    { headers: { 'cache-control': 'private, no-store' } }
  );
}
