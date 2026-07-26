import {
  clearStudentSessionCookie,
  deleteStudentSession,
  STUDENT_SESSION_COOKIE,
} from '../../lib/student-session';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';

  try {
    const jar = await cookies();
    const token = jar.get(STUDENT_SESSION_COOKIE)?.value;
    if (token) {
      await deleteStudentSession(token);
    }
  } catch {
    // Best-effort
  }

  return new Response(null, {
    status: 303,
    headers: {
      location: '/',
      'set-cookie': clearStudentSessionCookie(secure),
      'cache-control': 'no-store',
    },
  });
}
