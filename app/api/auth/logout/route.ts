import { clearStudentSessionCookie, STUDENT_SESSION_COOKIE } from "../../../lib/student-session";
import { ensureDatabase } from "../../../../db/runtime";
import { getD1 } from "../../../lib/platform";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const secure = new URL(request.url).protocol === "https:";

  // Remove the session from DB
  try {
    const jar = await cookies();
    const sessionHash = jar.get(STUDENT_SESSION_COOKIE)?.value;
    if (sessionHash) {
      await ensureDatabase();
      await getD1().prepare("DELETE FROM native_sessions WHERE session_hash = ?").bind(sessionHash).run();
    }
  } catch {
    // Best-effort — always clear the cookie
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
