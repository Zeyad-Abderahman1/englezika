import { jsonError } from './security';
import { cookies } from 'next/headers';
import { STUDENT_SESSION_COOKIE } from './student-session';
import { getDatabase } from './platform';

export type SessionUser = {
  email: string;
  displayName: string;
  fullName: string | null;
  emailVerified: boolean;
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

function tokenFromCookieHeader(header: string | null, cookieName: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) return decodeURIComponent(value.join('='));
  }
  return null;
}

async function getStudentFromCookie(request?: Request): Promise<SessionUser | null> {
  const cookieValue = request
    ? tokenFromCookieHeader(request.headers.get('cookie'), STUDENT_SESSION_COOKIE)
    : (await cookies()).get(STUDENT_SESSION_COOKIE)?.value;
  if (!cookieValue || cookieValue.length < 16) return null;

  const tokenHash = await sha256(cookieValue);
  const student = await getDatabase()
    .prepare(
      `SELECT u.email, u.name, u.email_verified AS emailVerified
       FROM native_sessions s JOIN users u ON u.email = s.email
       WHERE s.session_hash = ? AND s.expires_at > ? AND u.role = 'student'`
    )
    .bind(tokenHash, Date.now())
    .first<{ email: string; name: string; emailVerified: number }>();
  if (!student) return null;
  return {
    email: student.email,
    displayName: student.name || student.email,
    fullName: student.name || null,
    emailVerified: Boolean(student.emailVerified),
  };
}

export async function getCurrentStudentUser(request?: Request): Promise<SessionUser | null> {
  return getStudentFromCookie(request);
}

export async function apiUser(request?: Request): Promise<SessionUser | Response> {
  const user = await getCurrentStudentUser(request);
  return user ?? jsonError('يجب تسجيل الدخول أولاً', 401);
}

export async function apiVerifiedUser(request?: Request): Promise<SessionUser | Response> {
  const user = await apiUser(request);
  if (user instanceof Response) return user;
  if (!user.emailVerified) {
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
