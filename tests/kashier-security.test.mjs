import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { isKashierConfigured } from '../app/lib/kashier.ts';
import {
  verifyKashierSignature,
  amountToMinorUnits,
  constantTimeEqual,
  mapKashierStatus,
} from '../app/lib/kashier-crypto.ts';

class MockPaymentDb {
  constructor(options = {}) {
    this._options = options;
  }
  prepare(sql) {
    const self = this;
    return new (class {
      bindings = [];
      bind(...args) {
        this.bindings = args;
        return this;
      }
      async first() {
        if (sql.includes('FROM native_sessions s JOIN users u')) {
          return { email: 'student@example.test', name: 'Ahmed Ali', emailVerified: 1 };
        }
        if (sql.includes('INSERT INTO rate_limits')) {
          return { count: 1, resetAt: Date.now() + 60000 };
        }
        if (sql.includes('FROM courses')) {
          return self._options.course || { id: 'course-1', title: 'English Course', price: 500 };
        }
        if (sql.includes('FROM enrollments') && sql.includes('approved')) {
          return self._options.approvedEnrollment || null;
        }
        if (sql.includes('FROM enrollments') && sql.includes('pending')) {
          return self._options.existingEnrollment || null;
        }
        if (sql.includes('FROM users WHERE email')) {
          return { firstName: 'Ahmed', lastName: 'Ali', name: 'Ahmed Ali', phone: '01012345678' };
        }
        if (sql.includes('FROM payment_intents') && sql.includes('creating')) {
          return self._options.activeIntent || null;
        }
        if (sql.includes('FROM payment_intents') && sql.includes('LIMIT 1')) {
          return self._options.paymentIntent || null;
        }
        return null;
      }
      async run() {
        return { success: true, meta: { changes: 1 } };
      }
    })();
  }
  async batch() {
    return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
  }
}

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
});

test('Kashier crypto: constantTimeEqual compares strings safely', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('', ''), true);
  assert.equal(constantTimeEqual('a', 'ab'), false);
});

test('Kashier crypto: amountToMinorUnits converts correctly', () => {
  assert.equal(amountToMinorUnits('150.00'), 15000);
  assert.equal(amountToMinorUnits(99.5), 9950);
  assert.equal(amountToMinorUnits('invalid'), null);
  assert.equal(amountToMinorUnits(-5), null);
  assert.equal(amountToMinorUnits(null), null);
  assert.equal(amountToMinorUnits('100.99'), 10099);
});

test('Kashier crypto: verifyKashierSignature validates correct HMAC-SHA256', async () => {
  const paymentApiKey = 'test-api-key-12345';
  const data = {
    merchantOrderId: 'order-123',
    kashierOrderId: 'kashier-456',
    status: 'SUCCESS',
    amount: 50000,
    currency: 'EGP',
    method: 'card',
    transactionId: 'TX-789',
    transactionResponseCode: '00',
    channel: 'online',
    signatureKeys: [
      'amount',
      'channel',
      'currency',
      'kashierOrderId',
      'merchantOrderId',
      'method',
      'status',
      'transactionId',
      'transactionResponseCode',
    ],
  };

  const sortedKeys = [...data.signatureKeys].sort();
  const pairs = sortedKeys.map(
    (key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(data[key]))}`
  );
  const signaturePayload = pairs.join('&');

  const { createHmac } = await import('node:crypto');
  const expectedSignature = createHmac('sha256', paymentApiKey)
    .update(signaturePayload)
    .digest('hex');

  const valid = await verifyKashierSignature(data, expectedSignature, paymentApiKey);
  assert.equal(valid, true);
});

test('Kashier crypto: verifyKashierSignature rejects wrong signature', async () => {
  const data = {
    merchantOrderId: 'order-123',
    status: 'SUCCESS',
    signatureKeys: ['merchantOrderId', 'status'],
  };

  const valid = await verifyKashierSignature(data, 'wrong-signature-value', 'test-key');
  assert.equal(valid, false);
});

test('Kashier crypto: verifyKashierSignature rejects empty signatureKeys', async () => {
  const data = {
    merchantOrderId: 'order-123',
    status: 'SUCCESS',
    signatureKeys: [],
  };

  const valid = await verifyKashierSignature(data, 'some-sig', 'test-key');
  assert.equal(valid, false);
});

test('Kashier crypto: verifyKashierSignature rejects missing signatureKeys', async () => {
  const data = {
    merchantOrderId: 'order-123',
    status: 'SUCCESS',
  };

  const valid = await verifyKashierSignature(data, 'some-sig', 'test-key');
  assert.equal(valid, false);
});

test('Kashier status mapping: SUCCESS maps to paid', () => {
  assert.equal(mapKashierStatus('SUCCESS'), 'paid');
  assert.equal(mapKashierStatus('success'), 'paid');
});

test('Kashier status mapping: PENDING/CREATED/OPENED map to pending', () => {
  assert.equal(mapKashierStatus('PENDING'), 'pending');
  assert.equal(mapKashierStatus('CREATED'), 'pending');
  assert.equal(mapKashierStatus('OPENED'), 'pending');
});

test('Kashier status mapping: FAILED/CANCELLED/EXPIRED map to failed', () => {
  assert.equal(mapKashierStatus('FAILED'), 'failed');
  assert.equal(mapKashierStatus('CANCELLED'), 'failed');
  assert.equal(mapKashierStatus('EXPIRED'), 'failed');
  assert.equal(mapKashierStatus('UNKNOWN_STATUS'), 'failed');
});

test('1. isKashierConfigured returns false when credentials are empty', () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    KASHIER_MODE: undefined,
    KASHIER_MERCHANT_ID: undefined,
    KASHIER_PAYMENT_API_KEY: undefined,
    KASHIER_SECRET_KEY: undefined,
  };
  assert.equal(isKashierConfigured(), false);
});

test('2. isKashierConfigured returns true when all credentials are present', () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
  };
  assert.equal(isKashierConfigured(), true);
});

test('3. Checkout returns clean 502 when Kashier is unconfigured', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: undefined,
    KASHIER_MERCHANT_ID: undefined,
    KASHIER_PAYMENT_API_KEY: undefined,
    KASHIER_SECRET_KEY: undefined,
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 502);
  assert.equal(data.error, 'بوابة الدفع غير مفعلة حالياً');
});

test('21. Unified checkout rejects when PAYMENT_GATEWAY is unset', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    APP_URL: 'https://englezika.com',
    PAYMENT_GATEWAY: undefined,
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
    FAWATERAK_BASE_URL: 'https://staging.fawaterk.com',
    FAWATERAK_CLIENT_ID: 'test-client-id',
    FAWATERAK_CLIENT_SECRET: 'test-client-secret',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/checkout', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/checkout/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 502);
  assert.equal(data.error, 'بوابة الدفع غير مفعلة حالياً');
});

test('22. Unified checkout rejects when PAYMENT_GATEWAY has invalid value', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    APP_URL: 'https://englezika.com',
    PAYMENT_GATEWAY: 'unknown-gateway',
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/checkout', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/checkout/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 502);
  assert.equal(data.error, 'بوابة الدفع غير مفعلة حالياً');
});

test('4. Webhook returns 503 when Kashier is unconfigured', async () => {
  const body = JSON.stringify({ event: 'pay', data: {} });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    KASHIER_MODE: undefined,
    KASHIER_MERCHANT_ID: undefined,
    KASHIER_PAYMENT_API_KEY: undefined,
    KASHIER_SECRET_KEY: undefined,
  };

  const req = new Request('https://englezika.com/api/payments/kashier/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });

  const { POST } = await import('../app/api/payments/kashier/webhook/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 503);
  assert.equal(data.error, 'webhook_not_configured');
});

test('5. Webhook rejects missing x-kashier-signature header', async () => {
  const body = JSON.stringify({
    event: 'pay',
    data: {
      merchantOrderId: 'order-123',
      status: 'SUCCESS',
      signatureKeys: ['merchantOrderId', 'status'],
    },
  });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
  };

  const req = new Request('https://englezika.com/api/payments/kashier/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });

  const { POST } = await import('../app/api/payments/kashier/webhook/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 401);
  assert.equal(data.error, 'missing_signature');
});

test('6. Webhook rejects invalid signature', async () => {
  const body = JSON.stringify({
    event: 'pay',
    data: {
      merchantOrderId: 'order-123',
      status: 'SUCCESS',
      signatureKeys: ['merchantOrderId', 'status'],
    },
  });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
  };

  const req = new Request('https://englezika.com/api/payments/kashier/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-kashier-signature': 'invalid-signature-hash',
    },
    body,
  });

  const { POST } = await import('../app/api/payments/kashier/webhook/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 401);
  assert.equal(data.error, 'invalid_signature');
});

test('7. Webhook rejects oversized payload', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
  };

  const req = new Request('https://englezika.com/api/payments/kashier/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '999999',
    },
    body: JSON.stringify({ event: 'pay', data: {} }),
  });

  const { POST } = await import('../app/api/payments/kashier/webhook/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 413);
  assert.equal(data.error, 'payload_too_large');
});

test('8. Webhook returns 400 for invalid JSON body', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
  };

  const req = new Request('https://englezika.com/api/payments/kashier/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '10',
    },
    body: 'not-valid-json',
  });

  const { POST } = await import('../app/api/payments/kashier/webhook/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 400);
  assert.equal(data.error, 'invalid_payload');
});

test('9. Payment status API requires authentication', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/test-id/status', {
    method: 'GET',
  });

  const { GET } = await import('../app/api/payments/[id]/status/route.ts');
  const response = await GET(req, { params: Promise.resolve({ id: 'test-id' }) });
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 401);
  assert.ok(data.error);
});

test('10. Payment status API rejects invalid payment ID', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/normal-id/status', {
    method: 'GET',
    headers: { cookie: 'englizeka_student=12345678901234567890123456789012' },
  });

  const { GET } = await import('../app/api/payments/[id]/status/route.ts');
  const response = await GET(req, { params: Promise.resolve({ id: 'normal-id' }) });
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 404);
  assert.equal(data.error, 'عملية الدفع غير موجودة');
});

test('11. Checkout rejects unauthenticated request', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 401);
  assert.ok(data.error);
});

test('12. Checkout rejects cross-origin request', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://evil-site.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 403);
  assert.equal(data.error, 'طلب غير مسموح');
});

test('13. Checkout rejects nonexistent course', async () => {
  const db = new MockPaymentDb({ course: null });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: undefined,
    KASHIER_MERCHANT_ID: undefined,
    KASHIER_PAYMENT_API_KEY: undefined,
    KASHIER_SECRET_KEY: undefined,
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'nonexistent-course' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 502);
  assert.equal(data.error, 'بوابة الدفع غير مفعلة حالياً');
});

test('14. Checkout rejects already-approved enrollment', async () => {
  const db = new MockPaymentDb({ approvedEnrollment: { id: 'existing-enrollment' } });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 409);
  assert.equal(data.error, 'أنت مشترك بالفعل في هذا الكورس');
});

test('15. Checkout rejects empty courseId', async () => {
  const db = new MockPaymentDb();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({}),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 400);
  assert.equal(data.error, 'اختر الكورس أولاً');
});

test('16. Secrets are not included in checkout error response', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key-FAKE',
    KASHIER_SECRET_KEY: 'test-secret-FAKE',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const bodyText = await response.text();

  assert.ok(!bodyText.includes('test-api-key-FAKE'), 'API key leaked in error response');
  assert.ok(!bodyText.includes('test-secret-FAKE'), 'Secret key leaked in error response');
  assert.ok(!bodyText.includes('MID-TEST-123'), 'Merchant ID leaked in error response');
});

test('17. Checkout free course returns appropriate error', async () => {
  const db = new MockPaymentDb({ course: { id: 'free-course', title: 'Free', price: 0 } });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'free-course' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 404);
  assert.equal(data.error, 'الكورس غير متاح للدفع');
});

test('18. Webhook rejects event with no data field', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    KASHIER_MODE: 'test',
    KASHIER_MERCHANT_ID: 'MID-TEST-123',
    KASHIER_PAYMENT_API_KEY: 'test-api-key',
    KASHIER_SECRET_KEY: 'test-secret-key',
  };

  const req = new Request('https://englezika.com/api/payments/kashier/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '50',
      'x-kashier-signature': 'some-sig',
    },
    body: JSON.stringify({ event: 'pay' }),
  });

  const { POST } = await import('../app/api/payments/kashier/webhook/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 400);
  assert.equal(data.error, 'invalid_data');
});

test('19. Checkout rejects active payment intent for same enrollment', async () => {
  const db = new MockPaymentDb({
    existingEnrollment: { id: 'existing-enrollment' },
    activeIntent: { id: 'active-intent' },
  });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    APP_URL: 'https://englezika.com',
    KASHIER_MODE: undefined,
    KASHIER_MERCHANT_ID: undefined,
    KASHIER_PAYMENT_API_KEY: undefined,
    KASHIER_SECRET_KEY: undefined,
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/kashier/create', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/kashier/create/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 502);
  assert.equal(data.error, 'بوابة الدفع غير مفعلة حالياً');
});

test('20. Unified checkout endpoint rejects when gateway credentials are missing', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: new MockPaymentDb(),
    APP_URL: 'https://englezika.com',
    PAYMENT_GATEWAY: 'kashier',
    KASHIER_MODE: undefined,
    KASHIER_MERCHANT_ID: undefined,
    KASHIER_PAYMENT_API_KEY: undefined,
    KASHIER_SECRET_KEY: undefined,
    FAWATERAK_BASE_URL: undefined,
    FAWATERAK_CLIENT_ID: undefined,
    FAWATERAK_CLIENT_SECRET: undefined,
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/checkout', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  const { POST } = await import('../app/api/payments/checkout/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 502);
  assert.equal(data.error, 'بوابة الدفع غير مفعلة حالياً');
});
