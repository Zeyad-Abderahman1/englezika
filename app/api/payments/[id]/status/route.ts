import { apiUser, isResponse } from '../../../../lib/api-auth';
import { getDatabase } from '../../../../lib/platform';

type PaymentIntentRow = {
  id: string;
  courseId: string;
  status: string;
  userEmail: string;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await apiUser(request);
  if (isResponse(user)) return user;

  const { id } = await params;
  if (!id || id.length > 200) {
    return Response.json({ error: 'معرف الدفع غير صالح' }, { status: 400 });
  }

  const db = getDatabase();
  const payment = await db
    .prepare(
      `SELECT id, course_id AS courseId, status, user_email AS userEmail
       FROM payment_intents WHERE id = ? LIMIT 1`
    )
    .bind(id)
    .first<PaymentIntentRow>();

  if (!payment) {
    return Response.json({ error: 'عملية الدفع غير موجودة' }, { status: 404 });
  }

  if (payment.userEmail !== user.email.toLowerCase()) {
    return Response.json({ error: 'غير مصرح' }, { status: 403 });
  }

  return Response.json(
    {
      paymentId: payment.id,
      status: payment.status,
      courseId: payment.courseId,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
