import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class RateLimitDatabase {
  counters = new Map();

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
        return { success: true, results: [], meta: { changes: 0 } };
      }

      async first() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (!normalizedSql.startsWith('INSERT INTO rate_limits')) return null;

        const [key, nextResetAt, resetCountAt, resetWindowAt] = this.bindings;
        const current = database.counters.get(key);
        const expired = current && current.resetAt <= resetCountAt;
        const next = {
          count: !current || expired ? 1 : current.count + 1,
          resetAt: !current || current.resetAt <= resetWindowAt ? nextResetAt : current.resetAt,
        };
        database.counters.set(key, next);
        return { ...next };
      }

      async all() {
        return { success: true, results: [], meta: { changes: 0 } };
      }
    })();
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

test('parallel rate-limit checks use one atomic counter and never drop the table', async () => {
  const db = new RateLimitDatabase();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-rate-limit-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const { checkRateLimit } = await import('../app/lib/rate-limit.ts');
  const checks = await Promise.all(
    Array.from({ length: 20 }, () => checkRateLimit('login', '203.0.113.9', 5, 60))
  );
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;

  assert.equal(checks.filter((result) => result.allowed).length, 5);
  assert.equal(checks.filter((result) => !result.allowed).length, 15);
  assert.equal([...db.counters.values()][0].count, 20);

  const source = await readFile(new URL('../app/lib/rate-limit.ts', import.meta.url), 'utf8');
  assert.match(source, /ON CONFLICT\(key\) DO UPDATE SET/);
  assert.doesNotMatch(source, /DROP TABLE/i);
});
