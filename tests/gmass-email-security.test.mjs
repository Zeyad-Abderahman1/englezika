import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { sendVerificationEmail } from '../app/lib/email-verification.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__ENGLIZEKA_ENV__;
});

test('GMass delivery uses header authentication, an escaped message, and the shared idempotency key', async () => {
  const apiKey = 'diagnostic-gmass-key';
  let capturedUrl = '';
  let capturedInit;
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'gmass',
    GMASS_API_KEY: apiKey,
    EMAIL_FROM: 'Englizeka <mailer@example.test>',
    EMAIL_TEST_MODE: 'false',
  };
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Response.json({ transactionalEmailId: 'verify-delivery-123' });
  };

  const deliveryId = await sendVerificationEmail(
    ' Recipient@Example.Test ',
    '<script>alert(1)</script>',
    'verify-delivery-123'
  );

  assert.equal(deliveryId, 'verify-delivery-123');
  assert.equal(capturedUrl, 'https://api.gmass.co/api/transactional');
  assert.doesNotMatch(capturedUrl, new RegExp(apiKey));
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers['X-apikey'], apiKey);
  assert.equal(capturedInit.headers['content-type'], 'application/json');

  const payload = JSON.parse(capturedInit.body);
  assert.equal(payload.transactionalEmailId, 'verify-delivery-123');
  assert.equal(payload.fromEmail, 'mailer@example.test');
  assert.equal(payload.fromName, 'Englizeka');
  assert.equal(payload.to, 'recipient@example.test');
  assert.equal(payload.cc, undefined);
  assert.equal(payload.bcc, undefined);
  assert.equal(payload.subject, 'كود تفعيل حسابك في إنجليزيكا');
  assert.match(payload.message, /role="presentation"/);
  assert.match(payload.message, /dir="rtl"/);
  assert.match(payload.message, /#090a0d/);
  assert.match(payload.message, /لن نطلب منك مشاركة هذا الكود مع أي شخص/);
  assert.match(payload.message, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(payload.message, /<script>/);
  assert.deepEqual(payload.settings, {
    openTrack: false,
    clickTrack: false,
    useCustomerSmtp: false,
  });
});

test('GMass errors include actionable status while redacting the API key', async () => {
  const apiKey = 'diagnostic-gmass-key';
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'gmass',
    GMASS_API_KEY: apiKey,
    EMAIL_FROM: 'mailer@example.test',
    EMAIL_TEST_MODE: 'false',
  };
  globalThis.fetch = async () =>
    Response.json(
      { message: `Authentication failed for ${apiKey}` },
      { status: 401 }
    );

  await assert.rejects(
    sendVerificationEmail('recipient@example.test', '123456', 'verify-error-123'),
    (error) => {
      assert.match(error.message, /GMass rejected delivery \(401\)/);
      assert.match(error.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.message, new RegExp(apiKey));
      return true;
    }
  );
});

test('GMass password-reset delivery uses the shared branded template with reset-specific copy', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'gmass',
    GMASS_API_KEY: 'diagnostic-gmass-key',
    EMAIL_FROM: 'Englizeka <mailer@example.test>',
    EMAIL_TEST_MODE: 'false',
  };
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return Response.json({ transactionalEmailId: 'reset-delivery-123' });
  };

  await sendVerificationEmail('recipient@example.test', '123456', 'reset-delivery-123');

  const payload = JSON.parse(capturedInit.body);
  assert.equal(payload.subject, 'كود إعادة ضبط كلمة المرور في إنجليزيكا');
  assert.match(payload.message, /إعادة ضبط كلمة المرور/);
  assert.match(payload.message, /لن نطلب منك مشاركة هذا الكود مع أي شخص/);
  assert.match(payload.message, /123456/);
  assert.match(payload.message, /role="presentation"/);
});

test('explicit GMass selection does not silently fall through to another configured provider', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'gmass',
    RESEND_API_KEY: 'configured-resend-key',
    EMAIL_FROM: 'mailer@example.test',
    EMAIL_TEST_MODE: 'false',
  };
  globalThis.fetch = async () => {
    throw new Error('fetch should not be reached without GMASS_API_KEY');
  };

  await assert.rejects(
    sendVerificationEmail('recipient@example.test', '123456', 'verify-missing-key'),
    /GMASS_API_KEY is not configured/
  );
});
