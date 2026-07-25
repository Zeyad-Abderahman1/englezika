import { ensureDatabase } from "../../../../../db/runtime";
import {
  apiStaff,
  hashPassword,
  isStaffResponse,
  normalizeStaffPreset,
  STAFF_PRESETS,
} from "../../../../lib/staff-auth";
import { getD1 } from "../../../../lib/platform";
import { isStrongPassword, jsonError, requireSameOrigin, safeText } from "../../../../lib/security";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ email: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const actor = await apiStaff(request, "manage_staff");
  if (isStaffResponse(actor)) return actor;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const targetEmail = decodeURIComponent((await params).email).trim().toLowerCase();
  await ensureDatabase();
  const target = await getD1().prepare(
    "SELECT email, name, role, permissions, active FROM staff_users WHERE email = ?",
  ).bind(targetEmail).first<Record<string, unknown>>();
  if (!target) return jsonError("حساب الفريق غير موجود", 404);
  const active = body.active === undefined ? Number(target.active) : body.active ? 1 : 0;
  if (targetEmail === actor.email && !active) return jsonError("لا يمكنك تعطيل حسابك الحالي", 409);
  const name = safeText(body.name ?? target.name, 120);
  const role = body.role === undefined
    ? String(target.role)
    : body.role === "teacher" ? "teacher" : "assistant";
  const preset = role === "teacher" ? "full_access" : normalizeStaffPreset(body.preset ?? "grader");
  if (role === "assistant" && preset === "full_access") return jsonError("اختر صلاحيات محددة للمساعد");
  if (targetEmail === actor.email && role !== "teacher") return jsonError("لا يمكنك إزالة صلاحيتك الكاملة من الحساب الحالي", 409);
  const db = getD1();
  const password = typeof body.password === "string" ? body.password : "";
  if (password && !isStrongPassword(password)) {
    return jsonError("كلمة المرور الجديدة يجب أن تحتوي على 12 حرفاً على الأقل وحرف كبير وصغير ورقم ورمز");
  }
  if (password) {
    const credentials = await hashPassword(password);
    await db.batch([
      db.prepare(
        `UPDATE staff_users SET name = ?, role = ?, permissions = ?, active = ?,
         password_hash = ?, password_salt = ?, password_iterations = ?,
         failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE email = ?`,
      ).bind(
        name,
        role,
        JSON.stringify(STAFF_PRESETS[preset]),
        active,
        credentials.hash,
        credentials.salt,
        credentials.iterations,
        Date.now(),
        targetEmail,
      ),
      db.prepare("DELETE FROM staff_sessions WHERE staff_email = ?").bind(targetEmail),
    ]);
  } else {
    await db.prepare(
      `UPDATE staff_users SET name = ?, role = ?, permissions = ?, active = ?,
       failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE email = ?`,
    ).bind(name, role, JSON.stringify(STAFF_PRESETS[preset]), active, Date.now(), targetEmail).run();
  }
  return Response.json({ ok: true });
}
