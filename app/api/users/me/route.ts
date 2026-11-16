/**
 * app/api/users/me/route.ts
 *
 * DELETE /api/users/me
 * Allows a logged-in student to permanently delete their own account.
 *
 * Request body: { password: string }
 * The password is verified before any data is destroyed.
 *
 * On success:
 *   - User row is anonymised (name, phone, etc. cleared) and role set to 'deleted'
 *   - Birth-certificate storage object is deleted
 *   - All native_sessions for the user are revoked
 *   - Returns 200 { message: 'Account deleted' }
 *
 * Enrollment and attempt records are retained for audit purposes.
 */

import { apiUser, getCurrentStudentUser, isResponse } from '../../../lib/api-auth';
import { verifyStudentPassword } from '../../../lib/native-auth';
import { getDatabase, getPrivateStorage } from '../../../lib/platform';
import { clearStudentSessionCookie } from '../../../lib/student-session';
import {
  isSecureRequest,
  jsonError,
  readBoundedJson,
  requireSameOrigin,
  safeText,
} from '../../../lib/security';
import { deleteStudentAccountData } from '../../../lib/account-deletion';

export async function GET() {
  const user = await getCurrentStudentUser();
  return Response.json(
    {
      viewer: user ? { displayName: user.displayName } : null,
    },
    {
      headers: {
        'cache-control': 'private, no-store',
        vary: 'Cookie',
      },
    }
  );
}

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const user = await apiUser();
  if (isResponse(user)) return user;

  const body = parsed.data;
  const password = safeText(body.password, 200);

  if (!password) {
    return jsonError('كلمة المرور مطلوبة لتأكيد الحذف', 400);
  }

  // Verify password before destroying anything.
  const verified = await verifyStudentPassword(user.email, password);
  if (!verified) {
    return jsonError('كلمة المرور غير صحيحة', 401);
  }

  const db = getDatabase();
  const deleted = await deleteStudentAccountData(db, getPrivateStorage(), user.email);
  if (!deleted) return jsonError('الحساب غير موجود أو تم حذفه من قبل', 404);

  // Clear the session cookie in the response.
  const isSecure = isSecureRequest(request);
  return new Response(JSON.stringify({ message: 'Account deleted' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearStudentSessionCookie(isSecure),
    },
  });
}
