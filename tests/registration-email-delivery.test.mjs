import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { POST as register } from '../app/api/auth/register/route.ts';

function fakeDatabase() {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes('INSERT INTO rate_limits')) {
            return { count: 1, resetAt: Date.now() + 60_000 };
          }
          if (sql.includes('FROM users WHERE email = ?')) return null;
          return null;
        },
        async run() {
          return { meta: { changes: sql.includes('INSERT INTO users') ? 1 : 1 } };
        },
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

function registrationRequest({ includeRemovedFields = true } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    email: 'registration-delivery@example.test',
    password: 'Student!2026',
    password_confirm: 'Student!2026',
    first_name: 'Test',
    second_name: 'Student',
    third_name: '',
    last_name: 'Delivery',
    phone: '01000000001',
    father_phone: '01000000002',
    ...(includeRemovedFields ? { mother_phone: '01000000003' } : {}),
    school_name: 'E2E School',
    ...(includeRemovedFields ? { parent_job: 'Tester' } : {}),
    governorate: 'القاهرة',
    gender: 'ذكر',
    grade: 'تالتة ثانوي',
    section: 'علمي علوم',
    account_use_agreement: 'accepted',
  })) {
    form.set(key, value);
  }
  form.set(
    'birth_certificate',
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
    'certificate.png'
  );
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-length': '2048',
    },
    body: form,
  });
}

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
});

test('registration returns a retryable pending response when verification delivery fails', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: fakeDatabase(),
    STORAGE: {
      async put() {},
      async get() {
        return null;
      },
      async delete() {},
    },
    EMAIL_TEST_MODE: 'false',
    VERIFICATION_SECRET: 'diagnostic-secret-that-is-long-enough',
  };

  const response = await register(registrationRequest());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.accountCreated, true);
  assert.equal(body.verificationPending, true);
  assert.match(body.error, /تعذر إرسال كود التفعيل/);
  assert.match(response.headers.get('set-cookie') || '', /englizeka_student=/);
});

test('registration accepts a form without the removed mother-phone and parent-job fields', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: fakeDatabase(),
    STORAGE: {
      async put() {},
      async get() {
        return null;
      },
      async delete() {},
    },
    EMAIL_TEST_MODE: 'false',
    VERIFICATION_SECRET: 'diagnostic-secret-that-is-long-enough',
  };

  const response = await register(registrationRequest({ includeRemovedFields: false }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.accountCreated, true);
  assert.equal(body.verificationPending, true);
});
