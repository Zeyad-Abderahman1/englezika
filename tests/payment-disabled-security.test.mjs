import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { isFawaterakConfigured } from '../app/lib/fawaterak.ts';

class MockPaymentDb {
  prepare(sql) {
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
          return { id: 'course-1', title: 'English Course', price: 500 };
        }
        if (sql.includes('FROM enrollments')) {
          return null; // no active approved enrollment
        }
        if (sql.includes('FROM users WHERE email = ?')) {
          return { firstName: 'Ahmed', lastName: 'Ali', name: 'Ahmed Ali', phone: '01012345678' };
        }
        if (sql.includes('FROM payment_intents')) {
          return null;
        }
        return null;
      }
      async run() {
        return { success: true, meta: { changes: 1 } };
      }
    })();
  }
}

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
});

test('1. isFawaterakConfigured returns false when credentials are empty', () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    FAWATERAK_BASE_URL: undefined,
    FAWATERAK_CLIENT_ID: undefined,
    FAWATERAK_CLIENT_SECRET: undefined,
  };
  assert.equal(isFawaterakConfigured(), false);
});

test('2. Checkout returns clean 502 with friendly Arabic message when Fawaterak is unconfigured', async () => {
  const db = new MockPaymentDb();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    APP_URL: 'https://englezika.com',
    FAWATERAK_BASE_URL: undefined,
    FAWATERAK_CLIENT_ID: undefined,
    FAWATERAK_CLIENT_SECRET: undefined,
    FAWATERAK_VENDOR_API_KEY: undefined,
    VERIFICATION_SECRET: 'a'.repeat(32),
  };

  const req = new Request('https://englezika.com/api/payments/fawaterak/checkout', {
    method: 'POST',
    headers: {
      origin: 'https://englezika.com',
      'content-type': 'application/json',
      cookie: 'englizeka_student=12345678901234567890123456789012',
    },
    body: JSON.stringify({ courseId: 'course-1' }),
  });

  // Mock verified user session
  const { POST } = await import('../app/api/payments/fawaterak/checkout/route.ts');
  const response = await POST(req);
  const data = await response.json().catch(() => ({}));

  assert.equal(response.status, 502);
  assert.equal(data.error, 'بوابة الدفع غير مفعلة حالياً');
  assert.equal(data.stack, undefined);
});
