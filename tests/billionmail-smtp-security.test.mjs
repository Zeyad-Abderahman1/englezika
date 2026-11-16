import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import nodemailer from 'nodemailer';
import {
  isEmailProviderConfigured,
  parseBillionmailPort,
  parseBillionmailSecure,
  selectedEmailProvider,
  validateEmailConfiguration,
} from '../app/lib/email-config.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__ENGLIZEKA_ENV__;
  mock.restoreAll();
});

// ──────────────────────────────────────────────────────────────────────────────
// 1. billionmail is accepted as EMAIL_PROVIDER
// ──────────────────────────────────────────────────────────────────────────────
test('1. billionmail is accepted as EMAIL_PROVIDER', () => {
  const provider = selectedEmailProvider({ EMAIL_PROVIDER: 'billionmail' });
  assert.equal(provider, 'billionmail');
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. missing SMTP host fails production validation
// ──────────────────────────────────────────────────────────────────────────────
test('2. missing BILLIONMAIL_SMTP_HOST fails production validation', () => {
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
    },
    'production'
  );
  assert.ok(errors.some((e) => /BILLIONMAIL_SMTP_HOST/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. missing SMTP username fails production validation
// ──────────────────────────────────────────────────────────────────────────────
test('3. missing BILLIONMAIL_SMTP_USER fails production validation', () => {
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
    },
    'production'
  );
  assert.ok(errors.some((e) => /BILLIONMAIL_SMTP_USER/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. missing SMTP password fails production validation
// ──────────────────────────────────────────────────────────────────────────────
test('4. missing BILLIONMAIL_SMTP_PASSWORD fails production validation', () => {
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
    },
    'production'
  );
  assert.ok(errors.some((e) => /BILLIONMAIL_SMTP_PASSWORD/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. EMAIL_FROM is required
// ──────────────────────────────────────────────────────────────────────────────
test('5. EMAIL_FROM is required for BillionMail', () => {
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
    },
    'production'
  );
  assert.ok(errors.some((e) => /EMAIL_FROM/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. port parsing is validated
// ──────────────────────────────────────────────────────────────────────────────
test('6. port parsing validates numeric range', () => {
  // Valid ports
  assert.equal(parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: '587' }), 587);
  assert.equal(parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: '465' }), 465);
  assert.equal(parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: '25' }), 25);
  // Default when absent
  assert.equal(parseBillionmailPort({}), 587);
  // Invalid ports
  assert.throws(() => parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: 'abc' }), /must be an integer/);
  assert.throws(() => parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: '0' }), /must be an integer/);
  assert.throws(
    () => parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: '99999' }),
    /must be an integer/
  );
  assert.throws(
    () => parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: '-1' }),
    /must be an integer/
  );
  assert.throws(
    () => parseBillionmailPort({ BILLIONMAIL_SMTP_PORT: '587.5' }),
    /must be an integer/
  );

  // Invalid port causes validation error
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
      BILLIONMAIL_SMTP_PORT: 'abc',
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
    },
    'production'
  );
  assert.ok(errors.some((e) => /must be an integer/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. secure=true/false parsing is validated
// ──────────────────────────────────────────────────────────────────────────────
test('7. secure flag parsing accepts only true/false', () => {
  assert.equal(parseBillionmailSecure({ BILLIONMAIL_SMTP_SECURE: 'false' }), false);
  assert.equal(parseBillionmailSecure({ BILLIONMAIL_SMTP_SECURE: 'true' }), true);
  assert.equal(parseBillionmailSecure({ BILLIONMAIL_SMTP_SECURE: 'FALSE' }), false);
  assert.equal(parseBillionmailSecure({ BILLIONMAIL_SMTP_SECURE: 'TRUE' }), true);
  // Default when absent
  assert.equal(parseBillionmailSecure({}), false);
  // Invalid values
  assert.throws(() => parseBillionmailSecure({ BILLIONMAIL_SMTP_SECURE: 'yes' }), /must be/);
  assert.throws(() => parseBillionmailSecure({ BILLIONMAIL_SMTP_SECURE: '1' }), /must be/);

  // Invalid secure causes validation error
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
      BILLIONMAIL_SMTP_SECURE: 'yes',
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
    },
    'production'
  );
  assert.ok(errors.some((e) => /must be/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. production EMAIL_TEST_MODE remains rejected
// ──────────────────────────────────────────────────────────────────────────────
test('8. production EMAIL_TEST_MODE remains rejected with billionmail', () => {
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
      EMAIL_TEST_MODE: 'true',
    },
    'production'
  );
  assert.ok(errors.some((e) => /cannot be enabled/.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. credentials are never included in thrown/logged error messages
// ──────────────────────────────────────────────────────────────────────────────
test('9. SMTP credentials are never included in validation error messages', () => {
  const smtpPassword = 'super-secret-smtp-password-that-must-not-leak';
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_PORT: 'invalid',
      BILLIONMAIL_SMTP_SECURE: 'maybe',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: smtpPassword,
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
    },
    'production'
  );
  const joined = errors.join('\n');
  assert.ok(!joined.includes(smtpPassword), 'SMTP password must not appear in error messages');
  assert.ok(!joined.includes('info@englezika.com'), 'SMTP user must not appear in error messages');
});

// ──────────────────────────────────────────────────────────────────────────────
// 10. existing GMass/Gmail/Resend/ServerSMTP behavior remains functional
// ──────────────────────────────────────────────────────────────────────────────
test('10. existing providers still pass validation after billionmail addition', () => {
  // Gmail
  assert.deepEqual(
    validateEmailConfiguration(
      {
        EMAIL_PROVIDER: 'gmail',
        GMAIL_USER: 'mailer@example.test',
        GMAIL_APP_PASSWORD: 'app-password',
      },
      'production'
    ),
    []
  );
  // GMass
  assert.deepEqual(
    validateEmailConfiguration(
      {
        EMAIL_PROVIDER: 'gmass',
        GMASS_API_KEY: 'gmass-key',
        EMAIL_FROM: 'Englizeka <mailer@example.test>',
      },
      'production'
    ),
    []
  );
  // Resend
  assert.deepEqual(
    validateEmailConfiguration(
      {
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'resend-key',
        EMAIL_FROM: 'mailer@example.test',
      },
      'production'
    ),
    []
  );
  // ServerSMTP
  assert.deepEqual(
    validateEmailConfiguration(
      {
        EMAIL_PROVIDER: 'serversmtp',
        SERVERSMTP_CONSUMER_KEY: 'smtp-key',
        SERVERSMTP_CONSUMER_SECRET: 'smtp-secret',
        EMAIL_FROM: 'mailer@example.test',
      },
      'production'
    ),
    []
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// 11. Complete BillionMail config passes validation
// ──────────────────────────────────────────────────────────────────────────────
test('11. complete BillionMail configuration passes production validation', () => {
  const errors = validateEmailConfiguration(
    {
      EMAIL_PROVIDER: 'billionmail',
      BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
      BILLIONMAIL_SMTP_PORT: '587',
      BILLIONMAIL_SMTP_SECURE: 'false',
      BILLIONMAIL_SMTP_USER: 'info@englezika.com',
      BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
      EMAIL_FROM: 'Englizeka <info@englezika.com>',
    },
    'production'
  );
  assert.deepEqual(errors, []);
  assert.equal(
    isEmailProviderConfigured(
      {
        EMAIL_PROVIDER: 'billionmail',
        BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
        BILLIONMAIL_SMTP_USER: 'info@englezika.com',
        BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
        EMAIL_FROM: 'Englizeka <info@englezika.com>',
      },
      'billionmail'
    ),
    true
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// 12. sendTransactionalEmail routes BillionMail through nodemailer SMTP
// ──────────────────────────────────────────────────────────────────────────────
test('12. sendTransactionalEmail routes BillionMail through nodemailer SMTP', async () => {
  let transportConfig;
  let sentMail;
  mock.method(nodemailer, 'createTransport', (config) => {
    transportConfig = config;
    return {
      sendMail: async (message) => {
        sentMail = message;
        return { messageId: 'billionmail-delivery-123' };
      },
    };
  });
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'billionmail',
    BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
    BILLIONMAIL_SMTP_PORT: '587',
    BILLIONMAIL_SMTP_SECURE: 'false',
    BILLIONMAIL_SMTP_USER: 'info@englezika.com',
    BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
    EMAIL_FROM: 'Englizeka <info@englezika.com>',
    EMAIL_TEST_MODE: 'false',
  };

  const { sendTransactionalEmail } = await import('../app/lib/email.ts');
  const result = await sendTransactionalEmail('student@example.test', {
    type: 'verification',
    code: '123456',
  });

  assert.deepEqual(result, { success: true, deliveryId: 'billionmail-delivery-123' });
  // Verify SMTP transport was configured correctly
  assert.equal(transportConfig.host, 'mail.englezika.com');
  assert.equal(transportConfig.port, 587);
  assert.equal(transportConfig.secure, false);
  assert.equal(transportConfig.auth.user, 'info@englezika.com');
  assert.equal(transportConfig.auth.pass, 'smtp-password');
  assert.equal(transportConfig.tls.rejectUnauthorized, true);
  // Verify email was sent to the correct recipient
  assert.equal(sentMail.to, 'student@example.test');
  assert.equal(sentMail.from, 'Englizeka <info@englezika.com>');
  assert.ok(sentMail.html.includes('123456'));
});

// ──────────────────────────────────────────────────────────────────────────────
// 13. BillionMail port 465 uses secure=true (implicit TLS)
// ──────────────────────────────────────────────────────────────────────────────
test('13. BillionMail port 465 uses secure=true (implicit TLS)', async () => {
  let transportConfig;
  mock.method(nodemailer, 'createTransport', (config) => {
    transportConfig = config;
    return {
      sendMail: async () => ({ messageId: 'billionmail-465-delivery' }),
    };
  });
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'billionmail',
    BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
    BILLIONMAIL_SMTP_PORT: '465',
    BILLIONMAIL_SMTP_SECURE: 'true',
    BILLIONMAIL_SMTP_USER: 'info@englezika.com',
    BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
    EMAIL_FROM: 'Englizeka <info@englezika.com>',
    EMAIL_TEST_MODE: 'false',
  };

  const { sendTransactionalEmail } = await import('../app/lib/email.ts');
  const result = await sendTransactionalEmail('student@example.test', {
    type: 'welcome',
    studentName: 'Student',
  });

  assert.equal(result.success, true);
  assert.equal(transportConfig.port, 465);
  assert.equal(transportConfig.secure, true);
  assert.equal(transportConfig.tls.rejectUnauthorized, true);
});

// ──────────────────────────────────────────────────────────────────────────────
// 14. BillionMail readiness check works
// ──────────────────────────────────────────────────────────────────────────────
test('14. BillionMail passes isEmailConfigured readiness check', async () => {
  mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async () => ({ messageId: 'billionmail-readiness-123' }),
  }));
  globalThis.__ENGLIZEKA_ENV__ = {
    EMAIL_PROVIDER: 'billionmail',
    BILLIONMAIL_SMTP_HOST: 'mail.englezika.com',
    BILLIONMAIL_SMTP_PORT: '587',
    BILLIONMAIL_SMTP_SECURE: 'false',
    BILLIONMAIL_SMTP_USER: 'info@englezika.com',
    BILLIONMAIL_SMTP_PASSWORD: 'smtp-password',
    EMAIL_FROM: 'Englizeka <info@englezika.com>',
    EMAIL_TEST_MODE: 'false',
  };

  const { isEmailConfigured, sendTransactionalEmail } = await import('../app/lib/email.ts');
  assert.equal(isEmailConfigured(), true);
  assert.equal(
    (
      await sendTransactionalEmail('student@example.test', {
        type: 'welcome',
        studentName: 'Student',
      })
    ).success,
    true
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// 15. email.ts source never contains rejectUnauthorized: false
// ──────────────────────────────────────────────────────────────────────────────
test('15. email.ts never disables TLS certificate verification', async () => {
  const { readFile } = await import('node:fs/promises');
  const emailSource = await readFile(new URL('../app/lib/email.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(emailSource, /rejectUnauthorized:\s*false/);
});
