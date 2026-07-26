import {
  createStaffSession,
  staffCookie,
  verifyStaffCredentials,
} from "../../../lib/staff-auth";
import { jsonError, requireSameOrigin, safeText } from "../../../lib/security";
import { checkRateLimit, getClientIp, rateLimitResponse } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit("staff-login", ip, 5, 60);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck.resetAfterSeconds);
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = safeText(body.email, 254).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return jsonError("البريد الإلكتروني وكلمة المرور مطلوبان");
  const staff = await verifyStaffCredentials(email, password);
  if (!staff) return jsonError("بيانات الدخول غير صحيحة أو الحساب مقفل مؤقتاً", 401);
  const session = await createStaffSession(staff);
  const secure = new URL(request.url).protocol === "https:";
  return Response.json(
    { ok: true, staff: { email: staff.email, name: staff.name, role: staff.role } },
    { headers: { "set-cookie": staffCookie(session.token, session.expiresAt, secure) } },
  );
}
