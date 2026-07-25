import { verifyStudentPassword } from "../../../lib/native-auth";
import { jsonError, requireSameOrigin, safeText } from "../../../lib/security";
import { createStudentSessionValue, studentSessionCookie } from "../../../lib/student-session";
import { ensureDatabase } from "../../../../db/runtime";
import { getD1 } from "../../../lib/platform";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = safeText(body.email, 200).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) return jsonError("البريد الإلكتروني وكلمة السر مطلوبان");

  const student = await verifyStudentPassword(email, password);
  if (!student) return jsonError("البريد الإلكتروني أو كلمة السر غير صحيحة", 401);

  const sessionHash = await createStudentSessionValue(email);
  const secure = new URL(request.url).protocol === "https:";
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_MS;

  // Store session hash → email mapping
  await ensureDatabase();
  await getD1().batch([
    // Clean up expired sessions
    getD1().prepare("DELETE FROM native_sessions WHERE expires_at <= ?").bind(now),
    // Upsert the new session (one session per login — multiple logins create multiple rows,
    // each tied to a specific hash value)
    getD1().prepare(
      `INSERT INTO native_sessions (session_hash, email, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_hash) DO UPDATE SET expires_at = excluded.expires_at`,
    ).bind(sessionHash, email, expiresAt, now),
  ]);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": studentSessionCookie(sessionHash, secure),
      "cache-control": "no-store",
    },
  });
}
