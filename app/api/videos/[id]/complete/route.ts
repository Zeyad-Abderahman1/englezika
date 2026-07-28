import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { getD1 } from '../../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';
import { authorizeVideoAccess, verifyVideoCompletionToken } from '../../../../lib/video-access';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const email = user.email.toLowerCase();
  const payload = (await request.json().catch(() => ({}))) as { completionToken?: string };
  const completionToken = safeText(payload.completionToken, 4096);
  if (!completionToken || !(await verifyVideoCompletionToken(completionToken, email, id))) {
    return jsonError('إثبات مشاهدة المحاضرة غير صالح أو لم يحن وقت الإكمال بعد', 403);
  }
  const access = await authorizeVideoAccess(email, id);
  if (!access.ok) return jsonError(access.error, access.status);
  const db = getD1();

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
