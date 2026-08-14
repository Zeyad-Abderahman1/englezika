import { apiUser, isResponse } from '../../../lib/api-auth';
import { verifyStudentPassword, STUDENT_PASSWORD_ITERATIONS } from '../../../lib/native-auth';
import { hashPassword } from '../../../lib/staff-auth';
import { getDatabase } from '../../../lib/platform';
import { isStrongPassword, jsonError, requireSameOrigin } from '../../../lib/security';
import { STUDENT_SESSION_COOKIE } from '../../../lib/student-session';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiUser();
  if (isResponse(user)) return user;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const newPasswordConfirm =
    typeof body.newPasswordConfirm === 'string' ? body.newPasswordConfirm : '';

  if (!currentPassword) return jsonError('كلمة المرور الحالية مطلوبة');
  if (!isStrongPassword(newPassword)) {
    return jsonError(
      'كلمة المرور الجديدة يجب أن تكون 12 حرفاً على الأقل، وتحتوي على حرف كبير، وحرف صغير، ورقم، ورمز خاص (!@#$%).'
    );
  }
  if (newPassword !== newPasswordConfirm) return jsonError('كلمتا المرور الجديدة غير متطابقتين');

  // Verify current password
  const student = await verifyStudentPassword(user.email, currentPassword);
  if (!student) return jsonError('كلمة المرور الحالية غير صحيحة', 401);

  const { hash, salt, iterations } = await hashPassword(
    newPassword,
    undefined,
    STUDENT_PASSWORD_ITERATIONS
  );
  const now = Date.now();
  const db = getDatabase();

  // Get current session hash to preserve it (so the user stays logged in)
  const jar = await cookies();
  const currentSessionToken = jar.get(STUDENT_SESSION_COOKIE)?.value ?? null;
  const currentSessionHash = currentSessionToken
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(currentSessionToken)
          )
        ),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join('')
    : null;

  await db.batch([
    db
      .prepare(
        'UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE email = ?'
      )
      .bind(hash, salt, iterations, now, user.email.toLowerCase()),
    // Invalidate all other sessions for this email except the current one
    currentSessionHash
      ? db
          .prepare('DELETE FROM native_sessions WHERE email = ? AND session_hash != ?')
          .bind(user.email.toLowerCase(), currentSessionHash)
      : db.prepare('DELETE FROM native_sessions WHERE email = ?').bind(user.email.toLowerCase()),
  ]);

  return Response.json({ ok: true });
}
