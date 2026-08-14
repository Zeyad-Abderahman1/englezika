import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('checkout and payment schema enforce one active flow and idempotent terminal transitions', async () => {
  const migration = await readFile(
    new URL('../database/migrations/002_deleted_account_re_registration.sql', import.meta.url),
    'utf8'
  );
  const checkout = await readFile(
    new URL('../app/api/payments/fawaterak/checkout/route.ts', import.meta.url),
    'utf8'
  );
  const webhook = await readFile(
    new URL('../app/api/payments/fawaterak/webhook/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(migration, /enrollments_one_pending_idx/);
  assert.match(migration, /payment_intents_one_active_idx/);
  assert.match(checkout, /code === '23505'/);
  assert.match(checkout, /status IN \('creating', 'created'\)/);
  assert.match(webhook, /status <> 'paid'/);
  assert.match(webhook, /status NOT IN \('paid', 'amount_mismatch'\)/);
});
