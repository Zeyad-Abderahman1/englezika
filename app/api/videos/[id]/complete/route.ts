import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { getDatabase } from '../../../../lib/platform';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../../lib/rate-limit';
import {
  jsonError,
  requestBodyWithinLimit,
  requireSameOrigin,
  safeText,
} from '../../../../lib/security';
import { authorizeVideoAccess, verifyVideoCompletionToken } from '../../../../lib/video-access';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  if (!requestBodyWithinLimit(request, 32 * 1024)) {
    return jsonError('حجم الطلب غير صالح', 413);
  }
  const { id } = await params;
  const email = user.email.toLowerCase();
  const rateLimit = await checkRateLimit(
    'video-complete',
    `${getClientIp(request)}:${email}`,
    30,
    300
  );
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAfterSeconds);
  const payload = (await request.json().catch(() => ({}))) as { completionToken?: string };
  const completionToken = safeText(payload.completionToken, 4096);
  if (!completionToken || !(await verifyVideoCompletionToken(completionToken, email, id))) {
    return jsonError('إثبات مشاهدة المحاضرة غير صالح أو لم يحن وقت الإكمال بعد', 403);
  }
  const access = await authorizeVideoAccess(email, id);
  if (!access.ok) return jsonError(access.error, access.status);
  const db = getDatabase();

  await db
    .prepare(
      `INSERT INTO video_progress (id, user_email, video_id, completed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_email, video_id) DO UPDATE SET completed_at = excluded.completed_at`
    )
    .bind(crypto.randomUUID(), email, id, Date.now())
    .run();
  return Response.json({ ok: true, videoId: id });
}
