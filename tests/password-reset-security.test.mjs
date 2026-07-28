import assert from 'node:assert/strict';
import test from 'node:test';

class ResetCodeDatabase {
  resetCodes = new Map();

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

      async run() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('INSERT INTO password_reset_codes')) {
          const [email, codeHash, expiresAt, sentAt] = this.bindings;
          database.resetCodes.set(email, {
            email,
            codeHash,
            expiresAt,
            attempts: 0,
            sentAt,
            consumedAt: null,
          });
        } else if (normalizedSql.startsWith('UPDATE password_reset_codes SET expires_at = 0')) {
          const [email, codeHash] = this.bindings;
          const row = database.resetCodes.get(email);
          if (row && row.codeHash === codeHash && row.consumedAt === null) row.expiresAt = 0;
        }
        return { success: true, meta: { changes: 1 } };
      }

      async first() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('UPDATE password_reset_codes SET consumed_at')) {
          const [now, email, codeHash, minimumExpiry, maxAttempts] = this.bindings;
          const row = database.resetCodes.get(email);
          if (
            row &&
            row.codeHash === codeHash &&
            row.consumedAt === null &&
            row.expiresAt >= minimumExpiry &&
            row.attempts < maxAttempts
          ) {
            row.consumedAt = now;
            row.codeHash = '';
            row.expiresAt = 0;
            return { email };
          }
          return null;
        }
        if (normalizedSql.startsWith('SELECT code_hash AS codeHash')) {
          const row = database.resetCodes.get(this.bindings[0]);
          return row ? { ...row } : null;
        }
        if (normalizedSql.startsWith('UPDATE password_reset_codes SET attempts = attempts + 1')) {
          const [maxForExpiry, email, codeHash, minimumExpiry, maxAttempts] = this.bindings;
          const row = database.resetCodes.get(email);
          if (
            row &&
            row.codeHash === codeHash &&
            row.consumedAt === null &&
            row.expiresAt >= minimumExpiry &&
            row.attempts < maxAttempts
          ) {
            row.attempts += 1;
            if (row.attempts >= maxForExpiry) row.expiresAt = 0;
            return { attempts: row.attempts };
          }
          return null;
        }
        return null;
      }

      async all() {
        return { success: true, results: [] };
      }
    })();
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

test('password reset codes are purpose-specific, expiring, and consumed once atomically', async () => {
  const db = new ResetCodeDatabase();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-reset-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const {
    PASSWORD_RESET_CODE_TTL_MS,
    consumePasswordResetCode,
    hashPasswordResetCode,
    savePasswordResetCode,
  } = await import('../app/lib/password-reset.ts');

  const email = 'Student@Example.test';
  const code = '481516';
  const issuedAt = 1_800_000_000_000;
  const resetHash = await hashPasswordResetCode(email, code);
  await savePasswordResetCode(email, resetHash, issuedAt);

  assert.equal(await consumePasswordResetCode(email, '000000', issuedAt + 1), 'invalid');
  assert.equal(await consumePasswordResetCode(email, code, issuedAt + 2), 'verified');
  assert.equal(await consumePasswordResetCode(email, code, issuedAt + 3), 'used');

  const secondHash = await hashPasswordResetCode(email, code);
  await savePasswordResetCode(email, secondHash, issuedAt);
  assert.equal(
    await consumePasswordResetCode(email, code, issuedAt + PASSWORD_RESET_CODE_TTL_MS + 1),
    'expired'
  );
});
