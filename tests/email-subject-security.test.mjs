import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSubjectText, sendTransactionalEmail } from '../app/lib/email.ts';

test('sanitizeSubjectText strips CR, LF, tabs, control characters and truncates', () => {
  const malicious = 'English 101\r\nBcc: victim@example.test\nSubject: Injected\t\x00Course';
  const clean = sanitizeSubjectText(malicious);
  assert.equal(clean, 'English 101 Bcc: victim@example.test Subject: Injected Course');
  assert.doesNotMatch(clean, /[\r\n\x00]/);

  const longTitle = 'A'.repeat(200);
  assert.equal(sanitizeSubjectText(longTitle, 50).length, 50);
});

test('sendTransactionalEmail enrollment_approved sanitizes email subject header', async () => {
  let capturedSubject = '';
  globalThis.__ENGLIZEKA_ENV__ = {
    RESEND_API_KEY: 're_test_key_123',
    EMAIL_FROM: 'Englizeka <info@englizeka.com>',
    EMAIL_TEST_MODE: 'false',
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    capturedSubject = payload.subject;
    return Response.json({ id: 'msg_123' });
  };

  try {
    await sendTransactionalEmail('student@example.test', {
      type: 'enrollment_approved',
      courseTitle: 'Grammar Mastery\r\nCc: attacker@example.test\n',
    });
    assert.equal(capturedSubject, 'تم تفعيل اشتراكك في كورس: Grammar Mastery Cc: attacker@example.test');
    assert.doesNotMatch(capturedSubject, /[\r\n]/);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});
