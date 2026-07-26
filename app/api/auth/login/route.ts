import { verifyStudentPassword } from "../../../lib/native-auth";
import { jsonError, requireSameOrigin, safeText } from "../../../lib/security";
import { createStudentSession, studentSessionCookie } from "../../../lib/student-session";
import { checkRateLimit, getClientIp, rateLimitResponse } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit("student-login", ip, 5, 60);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck.resetAfterSeconds);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = safeText(body.email, 200).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) return jsonError("البريد الإلكتروني وكلمة السر مطلوبان");

  const student = await verifyStudentPassword(email, password);
  if (!student) return jsonError("البريد الإلكتروني أو كلمة السر غير صحيحة", 401);

  const session = await createStudentSession(email);
  const secure = new URL(request.url).protocol === "https:";

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": studentSessionCookie(session.token, secure),
      "cache-control": "no-store",
    },
  });
}

