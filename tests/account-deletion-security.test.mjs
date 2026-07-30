import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteStudentAccountData } from '../app/lib/account-deletion.ts';

class AccountDatabase {
  user = {
    email: 'student@example.test',
    role: 'student',
    birthCertificateKey: 'birth-certificates/student/certificate.png',
  };
  sessions = ['session-1', 'session-2'];
  notificationReads = ['announcement-1'];

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
        if (!sql.includes('SELECT birth_certificate_key')) return null;
        const email = this.bindings[0];
        return database.user?.email === email && database.user.role === 'student'
          ? { birthCertificateKey: database.user.birthCertificateKey }
          : null;
      }

      async run() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('UPDATE users SET')) {
          const [, email] = this.bindings;
          if (database.user?.email !== email || database.user.role !== 'student') {
            return { success: true, results: [], meta: { changes: 0 } };
          }
          Object.assign(database.user, {
            role: 'deleted',
            birthCertificateKey: null,
            birthCertificateContentType: null,
          });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (normalizedSql === 'DELETE FROM native_sessions WHERE email = ?') {
          database.sessions = [];
        }
        if (normalizedSql === 'DELETE FROM notification_reads WHERE user_email = ?') {
          database.notificationReads = [];
        }
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

test('account removal deletes the birth certificate before anonymizing the student', async () => {
  const db = new AccountDatabase();
  const deletedKeys = [];
  const bucket = { delete: async (key) => deletedKeys.push(key) };

  assert.equal(await deleteStudentAccountData(db, bucket, db.user.email), true);
  assert.deepEqual(deletedKeys, ['birth-certificates/student/certificate.png']);
  assert.equal(db.user.birthCertificateKey, null);
  assert.equal(db.user.role, 'deleted');
  assert.deepEqual(db.sessions, []);
  assert.deepEqual(db.notificationReads, []);
});

test('private file deletion failure leaves the account and sessions intact for a safe retry', async () => {
  const db = new AccountDatabase();
  const bucket = {
    delete: async () => {
      throw new Error('Private storage unavailable');
    },
  };

  await assert.rejects(
    () => deleteStudentAccountData(db, bucket, db.user.email),
    /Private storage unavailable/
  );
  assert.equal(db.user.role, 'student');
  assert.equal(db.user.birthCertificateKey, 'birth-certificates/student/certificate.png');
  assert.deepEqual(db.sessions, ['session-1', 'session-2']);
  assert.deepEqual(db.notificationReads, ['announcement-1']);
});
