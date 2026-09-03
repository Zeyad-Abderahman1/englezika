import { recordAuditLog } from '../../../../lib/audit';
import { amountToMinorUnits, mapKashierStatus } from '../../../../lib/kashier-crypto';
import { verifyKashierWebhook } from '../../../../lib/kashier';
import { isKashierConfigured } from '../../../../lib/kashier';
import { getDatabase } from '../../../../lib/platform';
import { safeText } from '../../../../lib/security';

type PaymentIntentRow = {
  id: string;
  enrollmentId: string;
  amountMinor: number;
  currency: string;
  status: string;
  transactionId: string | null;
  userEmail: string;
};

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > 64 * 1024)
    return Response.json({ error: 'payload_too_large' }, { status: 413 });

  if (!isKashierConfigured()) {
    return Response.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: 'invalid_payload' }, { status: 400 });

  const event = safeText(body.event, 50);
  const data = body.data as Record<string, unknown> | undefined;
  if (!data) return Response.json({ error: 'invalid_data' }, { status: 400 });

  const signature = safeText(request.headers.get('x-kashier-signature'), 500);
  if (!signature) return Response.json({ error: 'missing_signature' }, { status: 401 });

  let verified = false;
  try {
    verified = await verifyKashierWebhook(body, signature);
  } catch (error) {
    console.error('Kashier webhook verification error', error);
    return Response.json({ error: 'verification_error' }, { status: 503 });
  }
  if (!verified) return Response.json({ error: 'invalid_signature' }, { status: 401 });

  const merchantOrderId = safeText(data.merchantOrderId, 200);
  const kashierOrderId = safeText(data.kashierOrderId, 200);
  const kashierTransactionId = safeText(data.transactionId, 200);
  const kashierStatus = safeText(data.status, 50);
  const method = safeText(data.method, 100);
  const rawAmount = data.amount;
  const currency = safeText(data.currency, 10).toUpperCase();

  const db = getDatabase();
  const paymentIntent = await db
    .prepare(
      `SELECT id, enrollment_id AS enrollmentId, user_email AS userEmail,
              amount_minor AS amountMinor, currency, status,
              transaction_id AS transactionId
       FROM payment_intents WHERE id = ? AND gateway = 'kashier' LIMIT 1`
    )
    .bind(merchantOrderId)
    .first<PaymentIntentRow>();

  if (!paymentIntent) return Response.json({ status: 'ignored' });
  if (paymentIntent.transactionId && paymentIntent.transactionId !== kashierTransactionId) {
    return Response.json({ error: 'transaction_mismatch' }, { status: 409 });
  }
  if (paymentIntent.status === 'paid') return Response.json({ status: 'ok' });

  const now = Date.now();
  const mappedStatus = mapKashierStatus(kashierStatus);

  if (mappedStatus === 'paid') {
    const paidAmountMinor = amountToMinorUnits(rawAmount);
    if (
      paidAmountMinor === null ||
      paidAmountMinor !== paymentIntent.amountMinor ||
      currency !== paymentIntent.currency
    ) {
      await db
        .prepare(
          "UPDATE payment_intents SET status = 'amount_mismatch', transaction_id = ?, paid_amount_minor = ?, payment_method = ?, updated_at = ? WHERE id = ? AND status <> 'paid'"
        )
        .bind(kashierTransactionId, paidAmountMinor, method, now, paymentIntent.id)
        .run();
      return Response.json({ error: 'amount_mismatch' }, { status: 409 });
    }

    const transition = await db.batch([
      db
        .prepare(
          `UPDATE payment_intents
           SET status = 'paid', transaction_id = ?, paid_amount_minor = ?, payment_method = ?, paid_at = ?, updated_at = ?
           WHERE id = ? AND status <> 'paid'`
        )
        .bind(kashierTransactionId, paidAmountMinor, method, now, now, paymentIntent.id),
      db
        .prepare(
          "UPDATE enrollments SET status = 'approved', payment_method = ?, payment_reference = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND status = 'paid')"
        )
        .bind(method || 'Kashier', kashierTransactionId, now, paymentIntent.enrollmentId, paymentIntent.id),
    ]);
    if (transition[0]?.meta.changes !== 1) return Response.json({ status: 'ok' });
    await recordAuditLog({
      userEmail: paymentIntent.userEmail,
      action: 'payment.approved',
      resource: 'enrollment',
      resourceId: paymentIntent.enrollmentId,
      details: {
        gateway: 'kashier',
        kashierOrderId,
        transactionId: kashierTransactionId,
        paymentMethod: method,
        paidAmountMinor,
        currency,
      },
      request,
    });
  } else if (mappedStatus === 'pending') {
    await db
      .prepare(
        "UPDATE payment_intents SET status = 'pending', transaction_id = ?, payment_method = ?, updated_at = ? WHERE id = ? AND status NOT IN ('paid', 'amount_mismatch')"
      )
      .bind(kashierTransactionId || null, method || null, now, paymentIntent.id)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE payment_intents SET status = 'failed', transaction_id = ?, payment_method = ?, updated_at = ? WHERE id = ? AND status NOT IN ('paid', 'amount_mismatch')"
      )
      .bind(kashierTransactionId || null, method || null, now, paymentIntent.id)
      .run();
  }

  return Response.json({ status: 'ok' });
}
