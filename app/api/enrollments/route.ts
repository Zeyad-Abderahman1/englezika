import { apiVerifiedUser, isResponse } from '../../lib/api-auth';
import { getDatabase } from '../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const courseId = safeText(body.courseId, 80);
  const paymentMethod = safeText(body.paymentMethod, 60);
  const paymentReference = safeText(body.paymentReference, 120);
  if (!courseId) return jsonError('اختر الكورس');
  const db = getDatabase();
  const course = await db
    .prepare("SELECT id, price FROM courses WHERE id = ? AND status = 'published'")
    .bind(courseId)
    .first<{ id: string; price: number }>();
  if (!course) return jsonError('الكورس غير متاح', 404);
  const isFree = Number(course.price) === 0;
  if (!isFree && !paymentMethod) return jsonError('اختر طريقة الدفع');
  const existing = await db
    .prepare(
      'SELECT id, status FROM enrollments WHERE user_email = ? AND course_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .bind(user.email.toLowerCase(), courseId)
    .first<{ id: string; status: string }>();
  if (existing?.status === 'approved') {
    if (isFree) return Response.json({ ok: true, approved: true, courseId });
    return jsonError('أنت مشترك بالفعل في هذا الكورس', 409);
  }
  const now = Date.now();
  const status = isFree ? 'approved' : 'pending';
  const effectivePaymentMethod = isFree ? 'free' : paymentMethod;
  if (existing) {
    await db
      .prepare(
        'UPDATE enrollments SET status = ?, payment_method = ?, payment_reference = ?, updated_at = ? WHERE id = ?'
      )
      .bind(status, effectivePaymentMethod, paymentReference, now, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO enrollments
       (id, user_email, course_id, status, payment_method, payment_reference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        user.email.toLowerCase(),
        courseId,
        status,
        effectivePaymentMethod,
        paymentReference,
        now,
        now
      )
      .run();
  }
  return Response.json({
    ok: true,
    approved: isFree,
    courseId,
    message: isFree ? 'تم تفعيل الكورس المجاني على حسابك' : 'تم إرسال طلب الاشتراك للمراجعة',
  });
}
