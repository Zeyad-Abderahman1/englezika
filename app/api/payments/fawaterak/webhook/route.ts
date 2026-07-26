import { ensureDatabase } from '@/db/runtime';
import { recordAuditLog } from '@/app/lib/audit';
import { amountToMinorUnits } from '@/app/lib/fawaterak-crypto';
import { verifyFawaterakWebhook } from '@/app/lib/fawaterak';
import { getD1 } from '@/app/lib/platform';
import { safeText } from '@/app/lib/security';

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
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 64 * 1024)
    return Response.json({ error: 'payload_too_large' }, { status: 413 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: 'invalid_payload' }, { status: 400 });

  const transactionKey = safeText(body.transaction_key, 100);
  const transactionId = safeText(String(body.transaction_id ?? ''), 100);
  const paymentMethod = safeText(body.payment_method, 100);
  const signature = safeText(body.transactionHashKey || body.hashKey, 200);
  const status = safeText(body.status || body.invoice_status, 30).toLowerCase();

  let verified = false;
  try {
    verified = await verifyFawaterakWebhook({
      transactionId,
      transactionKey,
      paymentMethod,
      signature,
    });
  } catch (error) {
    console.error('Fawaterak webhook verification is not configured', error);
    return Response.json({ error: 'webhook_not_configured' }, { status: 503 });
  }
  if (!verified) return Response.json({ error: 'invalid_signature' }, { status: 401 });

  await ensureDatabase();
  const db = getD1();
  const paymentIntent = await db
    .prepare(
      `SELECT id, enrollment_id AS enrollmentId, user_email AS userEmail,
              amount_minor AS amountMinor, currency, status,
              transaction_id AS transactionId
       FROM payment_intents WHERE transaction_key = ? LIMIT 1`
    )
    .bind(transactionKey)
    .first<PaymentIntentRow>();

  // Acknowledge valid callbacks for unknown/expired intents to prevent endless retries.
  if (!paymentIntent) return Response.json({ status: 'ignored' });
  if (paymentIntent.transactionId && paymentIntent.transactionId !== transactionId) {
    return Response.json({ error: 'transaction_mismatch' }, { status: 409 });
  }
  if (paymentIntent.status === 'paid') return Response.json({ status: 'ok' });

  const now = Date.now();
  const paidAmountMinor = amountToMinorUnits(body.paidAmount);
  const paidCurrency = safeText(body.paidCurrency, 10).toUpperCase();

  if (status === 'paid') {
    if (
      paidAmountMinor === null ||
      paidAmountMinor < paymentIntent.amountMinor ||
      paidCurrency !== paymentIntent.currency
    ) {
      await db
        .prepare(
          "UPDATE payment_intents SET status = 'amount_mismatch', transaction_id = ?, paid_amount_minor = ?, payment_method = ?, updated_at = ? WHERE id = ?"
        )
        .bind(transactionId, paidAmountMinor, paymentMethod, now, paymentIntent.id)
        .run();
      return Response.json({ error: 'amount_mismatch' }, { status: 409 });
    }

    await db.batch([
      db
        .prepare(
          `UPDATE payment_intents
           SET status = 'paid', transaction_id = ?, paid_amount_minor = ?, payment_method = ?, paid_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(transactionId, paidAmountMinor, paymentMethod, now, now, paymentIntent.id),
      db
        .prepare(
          "UPDATE enrollments SET status = 'approved', payment_method = ?, payment_reference = ?, updated_at = ? WHERE id = ?"
        )
        .bind(paymentMethod || 'Fawaterak', transactionId, now, paymentIntent.enrollmentId),
    ]);
    await recordAuditLog({
      userEmail: paymentIntent.userEmail,
      action: 'payment.approved',
      resource: 'enrollment',
      resourceId: paymentIntent.enrollmentId,
      details: {
        gateway: 'fawaterak',
        transactionId,
        paymentMethod,
        paidAmountMinor,
        currency: paidCurrency,
      },
      request,
    });
  } else {
    const failurePayload = Boolean(body.errorMessage || body.response);
    if (status !== 'pending' && status !== 'failed' && !failurePayload) {
      return Response.json({ error: 'unsupported_status' }, { status: 400 });
    }
    const nextStatus = status === 'pending' ? 'pending' : 'failed';
    await db
      .prepare(
        'UPDATE payment_intents SET status = ?, transaction_id = ?, payment_method = ?, updated_at = ? WHERE id = ?'
      )
      .bind(nextStatus, transactionId || null, paymentMethod || null, now, paymentIntent.id)
      .run();
  }

  return Response.json({ status: 'ok' });
}
