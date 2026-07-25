import { ensureDatabase } from "../../../db/runtime";
import { apiVerifiedUser, isResponse } from "../../lib/api-auth";
import { getD1 } from "../../lib/platform";
import { jsonError, requireSameOrigin, safeText } from "../../lib/security";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const courseId = safeText(body.courseId, 80);
  const paymentMethod = safeText(body.paymentMethod, 60);
  const paymentReference = safeText(body.paymentReference, 120);
  if (!courseId || !paymentMethod) return jsonError("اختر طريقة الدفع");
  await ensureDatabase();
  const db = getD1();
  const course = await db.prepare("SELECT id FROM courses WHERE id = ? AND status = 'published'").bind(courseId).first();
  if (!course) return jsonError("الكورس غير متاح", 404);
  const existing = await db.prepare(
    "SELECT id, status FROM enrollments WHERE user_email = ? AND course_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(user.email.toLowerCase(), courseId).first<{ id: string; status: string }>();
  if (existing?.status === "approved") return jsonError("أنت مشترك بالفعل في هذا الكورس", 409);
  const now = Date.now();
  if (existing) {
    await db.prepare(
      "UPDATE enrollments SET status = 'pending', payment_method = ?, payment_reference = ?, updated_at = ? WHERE id = ?"
    ).bind(paymentMethod, paymentReference, now, existing.id).run();
  } else {
    await db.prepare(
      `INSERT INTO enrollments
       (id, user_email, course_id, status, payment_method, payment_reference, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), user.email.toLowerCase(), courseId, paymentMethod, paymentReference, now, now).run();
  }
  return Response.json({ ok: true, message: "تم إرسال طلب الاشتراك للمراجعة" });
}
