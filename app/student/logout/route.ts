import {
  clearStudentSessionCookie,
  deleteStudentSession,
  STUDENT_SESSION_COOKIE,
} from '../../lib/student-session';
import { cookies } from 'next/headers';
import { requireSameOrigin } from '../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
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

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': clearStudentSessionCookie(secure),
      'cache-control': 'no-store',
    },
  });
}

export async function GET() {
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
