import { apiVerifiedUser, isResponse } from '../../../lib/api-auth';
import { jsonError } from '../../../lib/security';
import { authorizeVideoAccess } from '../../../lib/video-access';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  const access = await authorizeVideoAccess(user.email, id);
  if (!access.ok) {
    return Response.json(
      { error: access.error, ...(access.code ? { code: access.code } : {}) },
      { status: access.status, headers: { 'cache-control': 'private, no-store' } }
    );
  }
  return jsonError('شغّل هذه المحاضرة من مشغل YouTube داخل صفحة الكورس.', 409);
}
