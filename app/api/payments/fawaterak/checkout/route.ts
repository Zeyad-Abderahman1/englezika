import { ensureDatabase } from '@/db/runtime';
import { apiVerifiedUser, isResponse } from '@/app/lib/api-auth';
import { createFawaterakTransaction } from '@/app/lib/fawaterak';
import { resolvePublicAppOrigin } from '@/app/lib/fawaterak-validation';
import { getD1, getPlatformEnv } from '@/app/lib/platform';
import { checkRateLimit, rateLimitResponse } from '@/app/lib/rate-limit';
import { jsonError, requireSameOrigin, safeText } from '@/app/lib/security';

type CourseRow = { id: string; title: string; price: number };
type StudentRow = {
  firstName: string;
  lastName: string;
  name: string | null;
  phone: string;
};

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;

  const rateLimit = await checkRateLimit('fawaterak-checkout', user.email.toLowerCase(), 5, 60);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const courseId = safeText(body.courseId, 80);
  if (!courseId) return jsonError('اختر الكورس أولاً');

  await ensureDatabase();
  const db = getD1();
  const course = await db
    .prepare("SELECT id, title, price FROM courses WHERE id = ? AND status = 'published'")
    .bind(courseId)
    .first<CourseRow>();
  if (!course || course.price <= 0) return jsonError('الكورس غير متاح للدفع', 404);

  const approved = await db
    .prepare(
      "SELECT id FROM enrollments WHERE user_email = ? AND course_id = ? AND status = 'approved' LIMIT 1"
    )
    .bind(user.email.toLowerCase(), courseId)
    .first<{ id: string }>();
  if (approved) return jsonError('أنت مشترك بالفعل في هذا الكورس', 409);

  const student = await db
    .prepare(
      `SELECT first_name AS firstName, last_name AS lastName, name, phone
       FROM users WHERE email = ?`
    )
    .bind(user.email.toLowerCase())
    .first<StudentRow>();
  if (!student?.phone) return jsonError('أكمل رقم الهاتف في حسابك قبل الدفع', 422);

  const now = Date.now();
  const existingEnrollment = await db
    .prepare(
      "SELECT id FROM enrollments WHERE user_email = ? AND course_id = ? AND status != 'approved' ORDER BY created_at DESC LIMIT 1"
    )
    .bind(user.email.toLowerCase(), courseId)
    .first<{ id: string }>();
  const enrollmentId = existingEnrollment?.id || crypto.randomUUID();
  const paymentIntentId = crypto.randomUUID();
  const amountMinor = Math.round(course.price * 100);

  if (existingEnrollment) {
    await db
      .prepare(
        "UPDATE enrollments SET status = 'pending', payment_method = 'Fawaterak', payment_reference = NULL, updated_at = ? WHERE id = ?"
      )
      .bind(now, enrollmentId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO enrollments
         (id, user_email, course_id, status, payment_method, payment_reference, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 'Fawaterak', NULL, ?, ?)`
      )
      .bind(enrollmentId, user.email.toLowerCase(), courseId, now, now)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO payment_intents
       (id, enrollment_id, user_email, course_id, gateway, amount_minor, currency, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'fawaterak', ?, 'EGP', 'creating', ?, ?)`
    )
    .bind(paymentIntentId, enrollmentId, user.email.toLowerCase(), courseId, amountMinor, now, now)
    .run();

  try {
    const origin = resolvePublicAppOrigin(
      getPlatformEnv().APP_URL,
      request.url,
      process.env.NODE_ENV === 'production'
    );
    const transaction = await createFawaterakTransaction({
      amount: course.price,
      currency: 'EGP',
      customer: {
        firstName: student.firstName || student.name || 'طالب',
        lastName: student.lastName || 'إنجليزيكا',
        email: user.email.toLowerCase(),
        phone: student.phone,
      },
      item: { name: course.title, price: course.price },
      paymentIntentId,
      enrollmentId,
      courseId,
      successUrl: `${origin}/account?payment=processing`,
      failUrl: `${origin}/subscribe/${encodeURIComponent(courseId)}?payment=failed`,
      pendingUrl: `${origin}/account?payment=pending`,
      backUrl: `${origin}/subscribe/${encodeURIComponent(courseId)}`,
      webhookUrl: `${origin}/api/payments/fawaterak/webhook`,
    });

    await db
      .prepare(
        "UPDATE payment_intents SET transaction_key = ?, status = 'created', updated_at = ? WHERE id = ?"
      )
      .bind(transaction.transactionKey, Date.now(), paymentIntentId)
      .run();

    return Response.json(
      { checkoutUrl: transaction.checkoutUrl },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    await db
      .prepare("UPDATE payment_intents SET status = 'failed', updated_at = ? WHERE id = ?")
      .bind(Date.now(), paymentIntentId)
      .run();
    console.error('Fawaterak checkout creation failed', error);
    return jsonError(
      error instanceof Error &&
        [
          'FAWATERAK_NOT_CONFIGURED',
          'FAWATERAK_BASE_URL_INVALID',
          'APP_URL_NOT_CONFIGURED',
          'APP_URL_INVALID',
        ].includes(error.message)
        ? 'بوابة الدفع غير مفعلة حالياً'
        : 'تعذر فتح بوابة الدفع. حاول مرة أخرى.',
      502
    );
  }
}
