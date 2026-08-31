import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import nodemailer from 'nodemailer';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__ENGLIZEKA_ENV__;
  mock.restoreAll();
});

test('sendTransactionalEmail routes Gmail through the selected provider', async () => {
  let sentMail;
  mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async (message) => {
      sentMail = message;
      return { messageId: 'gmail-delivery-123' };
    },
  }));
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'gmail',
    GMAIL_USER: 'mailer@example.test',
    GMAIL_APP_PASSWORD: 'gmail-app-password',
    EMAIL_FROM: 'Englizeka <mailer@example.test>',
    EMAIL_TEST_MODE: 'false',
  };

  const { sendTransactionalEmail } = await import('../app/lib/email.ts');
  const result = await sendTransactionalEmail('student@example.test', {
    type: 'welcome',
    studentName: 'Student',
  });

  assert.deepEqual(result, { success: true, deliveryId: 'gmail-delivery-123' });
  assert.equal(sentMail.to, 'student@example.test');
  assert.equal(sentMail.from, 'Englizeka <mailer@example.test>');
});

test('sendTransactionalEmail routes GMass when it is the sole configured provider', async () => {
  let capturedUrl;
  let capturedInit;
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'gmass',
    GMASS_API_KEY: 'diagnostic-gmass-key',
    EMAIL_FROM: 'Englizeka <mailer@example.test>',
    EMAIL_TEST_MODE: 'false',
  };
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Response.json({ transactionalEmailId: 'gmass-delivery-123' });
  };

  const { sendTransactionalEmail } = await import('../app/lib/email.ts');
  const result = await sendTransactionalEmail('student@example.test', {
    type: 'welcome',
    studentName: 'Student',
  });

  assert.deepEqual(result, { success: true, deliveryId: 'gmass-delivery-123' });
  assert.equal(capturedUrl, 'https://api.gmass.co/api/transactional');
  assert.equal(capturedInit.headers['X-apikey'], 'diagnostic-gmass-key');
});

test('sendTransactionalEmail routes ServerSMTP through the selected provider', async () => {
  let capturedUrl;
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'serversmtp',
    SERVERSMTP_CONSUMER_KEY: 'smtp-key',
    SERVERSMTP_CONSUMER_SECRET: 'smtp-secret',
    EMAIL_FROM: 'mailer@example.test',
    EMAIL_TEST_MODE: 'false',
  };
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return Response.json({ mid: 'smtp-delivery-123' });
  };

  const { sendTransactionalEmail } = await import('../app/lib/email.ts');
  const result = await sendTransactionalEmail('student@example.test', {
    type: 'welcome',
    studentName: 'Student',
  });

  assert.deepEqual(result, { success: true, deliveryId: 'smtp-delivery-123' });
  assert.equal(capturedUrl, 'https://api.turbo-smtp.com/api/v2/mail/send');
});

test('sendTransactionalEmail routes Resend through the selected provider', async () => {
  let capturedUrl;
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'resend-key',
    EMAIL_FROM: 'mailer@example.test',
    EMAIL_TEST_MODE: 'false',
  };
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return Response.json({ id: 'resend-delivery-123' });
  };

  const { sendTransactionalEmail } = await import('../app/lib/email.ts');
  const result = await sendTransactionalEmail('student@example.test', {
    type: 'welcome',
    studentName: 'Student',
  });

  assert.deepEqual(result, { success: true, deliveryId: 'resend-delivery-123' });
  assert.equal(capturedUrl, 'https://api.resend.com/emails');
});

test('GMass-only configuration passes transactional email readiness', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'gmass',
    GMASS_API_KEY: 'diagnostic-gmass-key',
    EMAIL_FROM: 'mailer@example.test',
    EMAIL_TEST_MODE: 'false',
  };
  globalThis.fetch = async () =>
    Response.json({ transactionalEmailId: 'gmass-readiness-123' });

  const { isEmailConfigured, sendTransactionalEmail } = await import('../app/lib/email.ts');
  assert.equal(isEmailConfigured(), true);
  assert.equal(
    (await sendTransactionalEmail('student@example.test', {
      type: 'welcome',
      studentName: 'Student',
    })).success,
    true
  );
});
