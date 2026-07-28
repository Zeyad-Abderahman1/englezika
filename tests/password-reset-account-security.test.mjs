import assert from 'node:assert/strict';
import test from 'node:test';

class StudentDatabase {
  users = new Map();
  sessions = new Set();

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
        if (normalizedSql.startsWith('UPDATE users SET password_hash')) {
          const [passwordHash, passwordSalt, passwordIterations, updatedAt, email] = this.bindings;
          const user = database.users.get(email);
          if (!user || user.role !== 'student') {
            return { success: true, results: [], meta: { changes: 0 } };
          }
          Object.assign(user, {
            passwordHash,
            passwordSalt,
            passwordIterations,
            updatedAt,
            failedAttempts: 0,
            lockedUntil: null,
          });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (normalizedSql === 'DELETE FROM native_sessions WHERE email = ?') {
          const email = this.bindings[0];
          for (const session of database.sessions) {
            if (session.email === email) database.sessions.delete(session);
          }
        }
        return { success: true, results: [], meta: { changes: 0 } };
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

test('password reset updates existing students only and revokes all sessions', async () => {
  const db = new StudentDatabase();
  const email = 'student@example.test';
  db.users.set(email, { email, role: 'student', passwordHash: 'old' });
  db.sessions.add({ token: 'session-1', email });
  db.sessions.add({ token: 'session-2', email });
  db.sessions.add({ token: 'other-session', email: 'other@example.test' });

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
    INITIAL_STAFF_EMAIL: 'bootstrap@example.test',
    INITIAL_STAFF_NAME: 'Test Bootstrap Staff',
    INITIAL_STAFF_PASSWORD_HASH: 'a'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'b'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const { updateStudentPassword } = await import('../app/lib/native-auth.ts');
  assert.equal(await updateStudentPassword(email, 'NewValidP@ssword2026'), true);
  assert.notEqual(db.users.get(email).passwordHash, 'old');
  assert.deepEqual([...db.sessions], [{ token: 'other-session', email: 'other@example.test' }]);

  assert.equal(await updateStudentPassword('missing@example.test', 'NewValidP@ssword2026'), false);
  assert.equal(db.users.has('missing@example.test'), false);
});
