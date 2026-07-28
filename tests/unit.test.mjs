import assert from 'node:assert/strict';
import test from 'node:test';

import { isStrongPassword, safeInteger, safeText } from '../app/lib/security.ts';
import { sanitizeContext } from '../app/lib/observability.ts';
import { amountToMinorUnits, createFawaterakSignature } from '../app/lib/fawaterak-crypto.ts';
import {
  isAllowedFawaterakBaseUrl,
  isAllowedFawaterakCheckoutUrl,
  resolvePublicAppOrigin,
} from '../app/lib/fawaterak-validation.ts';
import {
  createSignedVideoToken,
  verifySignedVideoToken,
  VIDEO_EMBED_TOKEN_TTL_MS,
} from '../app/lib/video-token.ts';

test('safeText trims and caps max string length', () => {
  assert.equal(safeText('  hello world  ', 5), 'hello');
  assert.equal(safeText(null), '');
  assert.equal(safeText(123), '');
});

test('safeInteger clamps numbers between min and max', () => {
  assert.equal(safeInteger(15, 1, 0, 10), 10);
  assert.equal(safeInteger(-5, 1, 0, 10), 0);
  assert.equal(safeInteger('invalid', 5, 0, 10), 5);
});

test('isStrongPassword enforces 12+ chars, upper, lower, digit, symbol', () => {
  assert.equal(isStrongPassword('Weak1!'), false);
  assert.equal(isStrongPassword('alllowercase1!'), false);
  assert.equal(isStrongPassword('ALLUPPERCASE1!'), false);
  assert.equal(isStrongPassword('NoSpecialSymbol123'), false);
  assert.equal(isStrongPassword('ValidP@ssw0rd2026'), true);
});

test('sanitizeContext redacts sensitive fields like passwords and tokens', () => {
  const context = {
    userEmail: 'student@example.test',
    password: 'SuperSecretPassword123!',
    token: 'abcdef123456',
    action: 'login',
  };
  const sanitized = sanitizeContext(context);
  assert.equal(sanitized.userEmail, 'student@example.test');
  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.token, '[REDACTED]');
  assert.equal(sanitized.action, 'login');
});

test('Fawaterak amounts are converted to integer minor units', () => {
  assert.equal(amountToMinorUnits('150.00'), 15000);
  assert.equal(amountToMinorUnits(99.5), 9950);
  assert.equal(amountToMinorUnits('invalid'), null);
});

test('Fawaterak webhook signature follows the documented HMAC payload', async () => {
  const signature = await createFawaterakSignature('12345', 'intent-key', 'Fawry', 'test-secret');
  assert.equal(signature.length, 64);
  assert.match(signature, /^[a-f0-9]{64}$/);
});

test('Fawaterak redirects are restricted to the configured official host', () => {
  assert.equal(isAllowedFawaterakBaseUrl('https://app.fawaterk.com/'), true);
  assert.equal(isAllowedFawaterakBaseUrl('https://evilfawaterk.com/'), false);
  assert.equal(
    isAllowedFawaterakCheckoutUrl(
      'https://app.fawaterk.com/ts/safe-intent',
      'https://app.fawaterk.com'
    ),
    true
  );
  assert.equal(
    isAllowedFawaterakCheckoutUrl('https://evilfawaterk.com/ts/stolen', 'https://app.fawaterk.com'),
    false
  );
});

test('production payment redirects require an explicit HTTPS application origin', () => {
  assert.throws(
    () => resolvePublicAppOrigin(undefined, 'https://worker.example.test/api/checkout', true),
    /APP_URL_NOT_CONFIGURED/
  );
  assert.equal(
    resolvePublicAppOrigin(
      'https://englizeka.example',
      'https://worker.example.test/api/checkout',
      true
    ),
    'https://englizeka.example'
  );
  assert.throws(
    () =>
      resolvePublicAppOrigin(
        'http://englizeka.example',
        'https://worker.example.test/api/checkout',
        true
      ),
    /APP_URL_INVALID/
  );
});

test('video embed tokens are short-lived, signed, and bound to the student and lesson', async () => {
  const secret = 'test-video-token-secret-that-is-long-enough';
  const now = 1_800_000_000_000;
  const token = await createSignedVideoToken(secret, 'Student@Example.test', 'lesson-123', now);
  assert.equal(
    await verifySignedVideoToken(secret, token, 'student@example.test', 'lesson-123', now),
    true
  );
  assert.equal(
    await verifySignedVideoToken(secret, token, 'another@example.test', 'lesson-123', now),
    false
  );
  assert.equal(
    await verifySignedVideoToken(secret, token, 'student@example.test', 'lesson-999', now),
    false
  );
  assert.equal(
    await verifySignedVideoToken(
      secret,
      token,
      'student@example.test',
      'lesson-123',
      now + VIDEO_EMBED_TOKEN_TTL_MS + 1
    ),
    false
  );
  assert.equal(
    await verifySignedVideoToken(
      secret,
      `${token.slice(0, -1)}x`,
      'student@example.test',
      'lesson-123',
      now
    ),
    false
  );
});
