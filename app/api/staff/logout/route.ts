import { clearStaffCookie, deleteCurrentStaffSession } from '../../../lib/staff-auth';
import { requireSameOrigin } from '../../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  await deleteCurrentStaffSession(request);
  const secure = new URL(request.url).protocol === 'https:';
  return Response.json({ ok: true }, { headers: { 'set-cookie': clearStaffCookie(secure) } });
}
