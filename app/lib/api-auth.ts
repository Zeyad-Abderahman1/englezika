import { findStudentByEmail } from './native-auth';
import { isEmailVerified } from './email-verification';
import { jsonError } from './security';
import { cookies } from 'next/headers';
import { STUDENT_SESSION_COOKIE, hasStudentSession } from './student-session';
import { getDatabase } from './platform';

export type SessionUser = {
  email: string;
  displayName: string;
  fullName: string | null;
};

/**
 * Read the authenticated student from the session cookie + DB.
 * The cookie stores an HMAC keyed to the email, so we look up the email
 * via the sessions table or (for native auth) by matching the HMAC against
 * every possible value.
 *
 * In practice, native auth sets the session cookie knowing the email at login time.
 * The email is stored in the DB; we look it up by the cookie value's implicit binding.
 *
 * For native auth: the login API creates the session cookie tied to a known email.
 * We must store that email in a way we can retrieve it on subsequent requests.
 *
 * Implementation: we add a lightweight `student_sessions` table (email ↔ session_hash)
 * so we can look up the email from the cookie hash.
 */
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getStudentEmailFromCookie(): Promise<string | null> {
  const jar = await cookies();
  const cookieValue = jar.get(STUDENT_SESSION_COOKIE)?.value;
  if (!cookieValue || cookieValue.length < 16) return null;

  const tokenHash = await sha256(cookieValue);
  const row = await getDatabase()
    .prepare('SELECT email FROM native_sessions WHERE session_hash = ? AND expires_at > ?')
    .bind(tokenHash, Date.now())
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function getCurrentStudentUser(): Promise<SessionUser | null> {
  const email = await getStudentEmailFromCookie();
  if (!email) return null;

  const student = await findStudentByEmail(email);
  if (!student) return null;

  // Verify HMAC is still valid for this email
  if (!(await hasStudentSession(email))) return null;

  return {
    email,
    displayName: student.name || email,
    fullName: student.name || null,
  };
}

export async function apiUser(): Promise<SessionUser | Response> {
  const user = await getCurrentStudentUser();
  return user ?? jsonError('يجب تسجيل الدخول أولاً', 401);
}

export async function apiVerifiedUser(): Promise<SessionUser | Response> {
  const user = await apiUser();
  if (user instanceof Response) return user;
  if (!(await isEmailVerified(user.email))) {
    return Response.json(
      { error: 'يجب تأكيد البريد الإلكتروني أولًا', code: 'EMAIL_NOT_VERIFIED' },
      { status: 403 }
    );
  }
  return user;
}

export function isResponse(value: SessionUser | Response): value is Response {
  return value instanceof Response;
}
