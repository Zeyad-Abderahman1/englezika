import assert from 'node:assert/strict';
import test from 'node:test';

class ForgotPasswordDatabase {
  constructor(students = [], { deleteAfterFirstLookup = false, failResetWrites = false } = {}) {
    this.students = new Map(
      students.map((student) => {
        const row = typeof student === 'string' ? { email: student, role: 'student' } : student;
        return [row.email.toLowerCase(), row];
      })
    );
    this.rateLimits = new Map();
    this.resetCodes = new Map();
    this.failResetWrites = failResetWrites;
    this.deleteAfterFirstLookup = deleteAfterFirstLookup;
    this.studentLookups = 0;
  }

  prepare(sql) {
    // The statement stub needs a stable reference to its owning in-memory database.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const database = this;
    return new (class {
      bindings = [];

      bind(...bindings) {
        this.bindings = bindings;
        return this;
      }

      async first() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('INSERT INTO rate_limits')) {
          const [key, nextResetAt, resetCountAt, resetWindowAt] = this.bindings;
          const current = database.rateLimits.get(key);
          const expired = current && current.resetAt <= resetCountAt;
          const next = {
            count: !current || expired ? 1 : current.count + 1,
            resetAt: !current || current.resetAt <= resetWindowAt ? nextResetAt : current.resetAt,
          };
          database.rateLimits.set(key, next);
          return next;
        }
        if (normalizedSql.includes('FROM users WHERE email = ?')) {
          const key = String(this.bindings[0]).toLowerCase();
          const student = database.students.get(key) ?? null;
          database.studentLookups += 1;
          if (student && database.deleteAfterFirstLookup && database.studentLookups === 1) {
            database.students.set(key, { ...student, role: 'deleted' });
            return { ...student };
          }
          return student;
        }
        return null;
      }

      async run() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('INSERT INTO password_reset_codes')) {
          if (database.failResetWrites) throw new Error('reset storage unavailable');
          const [email, codeHash, expiresAt, sentAt] = this.bindings;
          database.resetCodes.set(email, { codeHash, expiresAt, sentAt, deliveryId: null });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (normalizedSql.startsWith('UPDATE password_reset_codes SET delivery_id')) {
          const [deliveryId, email] = this.bindings;
          const reset = database.resetCodes.get(email);
          if (reset) reset.deliveryId = deliveryId;
          return { success: true, results: [], meta: { changes: reset ? 1 : 0 } };
        }
        if (normalizedSql.startsWith('UPDATE password_reset_codes SET expires_at = 0')) {
          const [email] = this.bindings;
          const reset = database.resetCodes.get(email);
          if (reset) reset.expiresAt = 0;
          return { success: true, results: [], meta: { changes: reset ? 1 : 0 } };
        }
        return { success: true, results: [], meta: { changes: 0 } };
      }
    })();
  }
}

test('password-reset issuance contacts the provider only for canonical student accounts', async () => {
  const canonicalEmail = 'student@example.test';
  const db = new ForgotPasswordDatabase([
    canonicalEmail,
    { email: 'deleted@example.test', role: 'deleted' },
    { email: 'legacy-staff@example.test', role: 'staff' },
    { email: 'victim@example.test,other@example.test', role: 'student' },
  ]);
  const providerRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    providerRequests.push({ url, body: JSON.parse(init.body) });
    return Response.json({ id: 'delivery-1' });
  };
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'test-resend-api-key',
    EMAIL_FROM: 'Englizeka <noreply@example.test>',
    VERIFICATION_SECRET: 'test-reset-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const { issuePasswordResetCode } = await import('../app/lib/password-reset.ts');
  let results;
  try {
    results = await Promise.all([
      issuePasswordResetCode('unknown@example.test'),
      issuePasswordResetCode('victim@example.test,other@example.test'),
      issuePasswordResetCode('deleted@example.test'),
      issuePasswordResetCode('legacy-staff@example.test'),
      issuePasswordResetCode(' STUDENT@EXAMPLE.TEST '),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    results.map((result) => result.issued),
    [false, false, false, false, true]
  );
  assert.deepEqual([...db.resetCodes.keys()], [canonicalEmail]);
  assert.equal(db.resetCodes.get(canonicalEmail).deliveryId, 'delivery-1');
  assert.equal(providerRequests.length, 1);
  assert.equal(providerRequests[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(providerRequests[0].body.to, [canonicalEmail]);
});

test('password-reset issuance rechecks student lifecycle before provider delivery', async () => {
  const canonicalEmail = 'student@example.test';
  const db = new ForgotPasswordDatabase([canonicalEmail], { deleteAfterFirstLookup: true });
  const providerRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    providerRequests.push({ url, body: JSON.parse(init.body) });
    return Response.json({ id: 'delivery-1' });
  };
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'test-resend-api-key',
    EMAIL_FROM: 'Englizeka <noreply@example.test>',
    VERIFICATION_SECRET: 'test-reset-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const { issuePasswordResetCode } = await import('../app/lib/password-reset.ts');
  let result;
  try {
    result = await issuePasswordResetCode(canonicalEmail);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.issued, false);
  assert.equal(providerRequests.length, 0);
  assert.equal(db.resetCodes.get(canonicalEmail).expiresAt, 0);
});

test('forgot-password keeps the generic response when reset persistence fails', async () => {
  const canonicalEmail = 'student@example.test';
  const db = new ForgotPasswordDatabase([canonicalEmail], { failResetWrites: true });
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    EMAIL_TEST_MODE: 'true',
    VERIFICATION_SECRET: 'test-reset-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  const { POST } = await import('../app/api/auth/forgot-password/route.ts');
  const requestReset = (email) => {
    const bodyStr = JSON.stringify({ email });
    return POST(
      new Request('https://example.test/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(bodyStr)),
          origin: 'https://example.test',
        },
        body: bodyStr,
      })
    );
  };

  let unknown;
  let existing;
  try {
    unknown = await requestReset('unknown@example.test');
    existing = await requestReset(canonicalEmail);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(unknown.status, 200);
  assert.equal(existing.status, 200);
  const unknownBody = await unknown.json();
  const existingBody = await existing.json();
  assert.deepEqual(
    { ok: existingBody.ok, message: existingBody.message },
    { ok: unknownBody.ok, message: unknownBody.message }
  );
});

test('password-reset issuance invalidates the code when provider delivery fails', async () => {
  const canonicalEmail = 'student@example.test';
  const db = new ForgotPasswordDatabase([canonicalEmail]);
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  globalThis.fetch = async () =>
    Response.json({ message: 'provider unavailable' }, { status: 503 });
  console.error = () => {};
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'test-resend-api-key',
    EMAIL_FROM: 'Englizeka <noreply@example.test>',
    VERIFICATION_SECRET: 'test-reset-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const { issuePasswordResetCode } = await import('../app/lib/password-reset.ts');
  let result;
  try {
    result = await issuePasswordResetCode(canonicalEmail);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  assert.equal(result.issued, false);
  assert.equal(db.resetCodes.get(canonicalEmail).expiresAt, 0);
});
