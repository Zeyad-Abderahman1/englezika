import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { createKashierSession, isKashierConfigured } from '../../../../lib/kashier';
import { resolvePublicAppOrigin } from '../../../../lib/fawaterak-validation';
import { getDatabase, getPlatformEnv } from '../../../../lib/platform';
import { checkRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { jsonError, requireSameOrigin, safeText } from '../../../../lib/security';

type CourseRow = { id: string; title: string; price: number };

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiVerifiedUser(request);
  if (isResponse(user)) return user;

  if (!isKashierConfigured()) {
    return jsonError('بوابة الدفع غير مفعلة حالياً', 502);
  }

  const rateLimit = await checkRateLimit('kashier-checkout', user.email.toLowerCase(), 5, 60);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const courseId = safeText(body.courseId, 80);
  if (!courseId) return jsonError('اختر الكورس أولاً');

  const db = getDatabase();
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
    const activeIntent = await db
      .prepare(
        "SELECT id FROM payment_intents WHERE enrollment_id = ? AND status IN ('creating', 'created') LIMIT 1"
      )
      .bind(enrollmentId)
      .first<{ id: string }>();
    if (activeIntent) return jsonError('لديك طلب دفع قيد المعالجة', 409);
    await db
      .prepare(
        "UPDATE enrollments SET status = 'pending', payment_method = 'Kashier', payment_reference = NULL, updated_at = ? WHERE id = ?"
      )
      .bind(now, enrollmentId)
      .run();
  } else {
    try {
      await db
        .prepare(
          `INSERT INTO enrollments
           (id, user_email, course_id, status, payment_method, payment_reference, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', 'Kashier', NULL, ?, ?)`
        )
        .bind(enrollmentId, user.email.toLowerCase(), courseId, now, now)
        .run();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return jsonError('لديك طلب دفع قيد المعالجة', 409);
    }
  }

  try {
    await db
      .prepare(
        `INSERT INTO payment_intents
         (id, enrollment_id, user_email, course_id, gateway, amount_minor, currency, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'kashier', ?, 'EGP', 'creating', ?, ?)`
      )
      .bind(paymentIntentId, enrollmentId, user.email.toLowerCase(), courseId, amountMinor, now, now)
      .run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return jsonError('لديك طلب دفع قيد المعالجة', 409);
  }

  try {
    const origin = resolvePublicAppOrigin(
      getPlatformEnv().APP_URL,
      request.url,
      process.env.NODE_ENV === 'production'
    );
    const session = await createKashierSession({
      amount: amountMinor,
      currency: 'EGP',
      orderId: paymentIntentId,
      merchantId: '',
      courseId,
      userEmail: user.email.toLowerCase(),
      description: `Payment for ${course.title}`,
      merchantRedirect: `${origin}/account?payment=processing`,
      webhookUrl: `${origin}/api/payments/kashier/webhook`,
    });

    await db
      .prepare(
        "UPDATE payment_intents SET transaction_key = ?, status = 'created', updated_at = ? WHERE id = ?"
      )
      .bind(session.sessionId, Date.now(), paymentIntentId)
      .run();

    return Response.json(
      { checkoutUrl: session.sessionUrl },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    await db
      .prepare("UPDATE payment_intents SET status = 'failed', updated_at = ? WHERE id = ?")
      .bind(Date.now(), paymentIntentId)
      .run();
    console.error('Kashier checkout creation failed', error);
    return jsonError(
      error instanceof Error &&
        ['KASHIER_NOT_CONFIGURED', 'APP_URL_NOT_CONFIGURED', 'APP_URL_INVALID'].includes(
          error.message
        )
        ? 'بوابة الدفع غير مفعلة حالياً'
        : 'تعذر فتح بوابة الدفع. حاول مرة أخرى.',
      502
    );
  }
}
