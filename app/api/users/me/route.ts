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
 *   - All native_sessions for the user are revoked
 *   - Returns 200 { message: 'Account deleted' }
 *
 * Enrollment and attempt records are retained for audit purposes.
 */

import { ensureDatabase } from '../../../../db/runtime';
import { apiUser, isResponse } from '../../../lib/api-auth';
import { verifyStudentPassword } from '../../../lib/native-auth';
import { getD1 } from '../../../lib/platform';
import { clearStudentSessionCookie } from '../../../lib/student-session';
import { jsonError, requireSameOrigin, safeText } from '../../../lib/security';

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiUser();
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password = safeText(body.password, 200);

  if (!password) {
    return jsonError('كلمة المرور مطلوبة لتأكيد الحذف', 400);
  }

  // Verify password before destroying anything.
  const verified = await verifyStudentPassword(user.email, password);
  if (!verified) {
    return jsonError('كلمة المرور غير صحيحة', 401);
  }

  await ensureDatabase();
  const db = getD1();
  const now = Date.now();

  // Anonymise the user row — clear all PII fields.
  await db
    .prepare(
      `UPDATE users SET
         name = '[deleted]',
         first_name = '',
         second_name = '',
         third_name = '',
         last_name = '',
         phone = '',
         father_phone = '',
         mother_phone = '',
         school_name = '',
         parent_job = '',
         governorate = '',
         gender = '',
         grade = '',
         section = '',
         password_hash = '',
         password_salt = '',
         password_iterations = 0,
         role = 'deleted',
         updated_at = ?
       WHERE email = ?`
    )
    .bind(now, user.email)
    .run();

  // Revoke all active sessions.
  await db.prepare('DELETE FROM native_sessions WHERE email = ?').bind(user.email).run();

  // Clear the session cookie in the response.
  const isSecure = request.url.startsWith('https://');
  return new Response(JSON.stringify({ message: 'Account deleted' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearStudentSessionCookie(isSecure),
    },
  });
}
