import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { POST as register } from '../app/api/auth/register/route.ts';

function fakeDatabase(insertedUsers = []) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          if (sql.includes('INSERT INTO users')) {
            insertedUsers.push({ sql, args });
          }
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

function registrationRequest({
  includeRemovedFields = true,
  grade = 'تالتة ثانوي',
  section = 'علمي علوم',
  password = 'Test!2026',
  passwordConfirm = 'Test!2026',
} = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    email: 'registration-delivery@example.test',
    password,
    password_confirm: passwordConfirm,
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
    grade,
    ...(section !== undefined ? { section } : {}),
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

test('registration: first secondary students are allowed with no track and section is saved as empty', async () => {
  const insertedUsers = [];
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: fakeDatabase(insertedUsers),
    STORAGE: {
      async put() {},
      async get() { return null; },
      async delete() {},
    },
    EMAIL_TEST_MODE: 'false',
    VERIFICATION_SECRET: 'diagnostic-secret-that-is-long-enough',
  };

  // 1. Grade = أولى ثانوي with no section -> Allowed and saved with empty track
  const res1 = await register(registrationRequest({ grade: 'أولى ثانوي', section: '' }));
  assert.equal(res1.status, 503);
  assert.equal(insertedUsers[0].args[13], 'أولى ثانوي');
  assert.equal(insertedUsers[0].args[14], '', 'First secondary track must be empty string');

  // 2. Grade = أولى ثانوي with stale/invalid track passed in body -> Track is discarded and saved as empty
  insertedUsers.length = 0;
  const res2 = await register(registrationRequest({ grade: 'أولى ثانوي', section: 'علمي علوم' }));
  assert.equal(res2.status, 503);
  assert.equal(insertedUsers[0].args[13], 'أولى ثانوي');
  assert.equal(insertedUsers[0].args[14], '', 'Stale track value must be cleared for first secondary');

  // 3. Grade = تانية ثانوي without section -> Rejected with 400 'اختر الشعبة'
  const res3 = await register(registrationRequest({ grade: 'تانية ثانوي', section: '' }));
  assert.equal(res3.status, 400);
  const body3 = await res3.json();
  assert.equal(body3.error, 'اختر الشعبة');

  // 4. Grade = تالتة ثانوي without section -> Rejected with 400 'اختر الشعبة'
  const res4 = await register(registrationRequest({ grade: 'تالتة ثانوي', section: '' }));
  assert.equal(res4.status, 400);
  const body4 = await res4.json();
  assert.equal(body4.error, 'اختر الشعبة');
});

test('registration rejects passwords and password confirmations longer than 9 characters', async () => {
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: fakeDatabase(),
    STORAGE: {
      async put() {},
      async get() { return null; },
      async delete() {},
    },
    EMAIL_TEST_MODE: 'false',
    VERIFICATION_SECRET: 'diagnostic-secret-that-is-long-enough',
  };

  // Password longer than 9 characters
  const res1 = await register(registrationRequest({ password: 'LongPassword!2026', passwordConfirm: 'LongPassword!2026' }));
  assert.equal(res1.status, 400);
  const body1 = await res1.json();
  assert.equal(body1.error, 'كلمة المرور يجب ألا تتجاوز 9 أحرف');

  // Password confirmation longer than 9 characters
  const res2 = await register(registrationRequest({ password: 'Pass!1', passwordConfirm: 'LongPassword!2026' }));
  assert.equal(res2.status, 400);
  const body2 = await res2.json();
  assert.equal(body2.error, 'تأكيد كلمة المرور يجب ألا يتجاوز 9 أحرف');
});
