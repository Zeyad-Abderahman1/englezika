import { clearStudentSessionCookie, deleteStudentSession, STUDENT_SESSION_COOKIE } from "../../../lib/student-session";
import { requireSameOrigin } from "../../../lib/security";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const secure = new URL(request.url).protocol === "https:";

  try {
    const jar = await cookies();
    const token = jar.get(STUDENT_SESSION_COOKIE)?.value;
    if (token) {
      await deleteStudentSession(token);
    }
  } catch {
    // Best-effort — always clear cookie
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": clearStudentSessionCookie(secure),
      "cache-control": "no-store",
    },
  });
}

