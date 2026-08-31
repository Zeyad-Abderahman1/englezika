import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteStudentAccountData } from '../app/lib/account-deletion.ts';

class AccountDatabase {
  user = {
    email: 'student@example.test',
    role: 'student',
    birthCertificateKey: 'birth-certificates/student/certificate.png',
  };
  submissions = [];
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

      async all() {
        if (sql.includes('FROM assignment_submissions')) {
          const email = this.bindings[0];
          const results = database.submissions
            .filter((s) => s.student_email === email)
            .map((s) => ({ id: s.id, pdfStorageKey: s.pdf_storage_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        return { results: [], success: true, meta: { changes: 0 } };
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
        if (normalizedSql.startsWith('UPDATE assignment_submissions')) {
          const [tombstone, email] = this.bindings;
          for (const sub of database.submissions) {
            if (sub.student_email === email) {
              sub.student_email = tombstone;
              sub.pdf_storage_key = null;
            }
          }
          return { success: true, results: [], meta: { changes: database.submissions.length } };
        }
        if (normalizedSql.startsWith('UPDATE lecture_access_codes SET redeemed_by_student_email')) {
          return { success: true, results: [], meta: { changes: 0 } };
        }
        if (normalizedSql === 'DELETE FROM student_video_access_grants WHERE student_email = ?') {
          return { success: true, results: [], meta: { changes: 0 } };
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

test('account removal anonymizes assignment submissions and deletes submission PDFs', async () => {
  const db = new AccountDatabase();
  const submissionPdfKey = 'assignments/a1/submissions/student-sub.pdf';
  db.submissions = [
    { id: 'sub-1', assignment_id: 'a1', student_email: db.user.email, pdf_storage_key: submissionPdfKey, score: 95 }
  ];
  const deletedKeys = [];
  const bucket = { delete: async (key) => deletedKeys.push(key) };

  assert.equal(await deleteStudentAccountData(db, bucket, db.user.email), true);

  // 1. Storage PDF must be deleted
  assert.ok(deletedKeys.includes(submissionPdfKey), 'Submission PDF must be deleted from storage');

  // 2. Submission row must still exist, but student_email anonymized and pdf_storage_key nulled
  const sub = db.submissions[0];
  assert.notEqual(sub.student_email, 'student@example.test', 'student_email must no longer be the original email');
  assert.match(sub.student_email, /^deleted\+[a-f0-9-]+@deleted\.invalid$/, 'student_email must be the tombstone email');
  assert.equal(sub.pdf_storage_key, null, 'pdf_storage_key must be nulled');
  assert.equal(sub.score, 95, 'Grading score must be preserved for records');
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

test('deleted accounts are tombstoned so the same email can create a fresh account', async () => {
  const db = new AccountDatabase();
  const bucket = { delete: async () => {} };

  assert.equal(await deleteStudentAccountData(db, bucket, db.user.email), true);
  assert.match(db.user.email, /^student@example\.test$/);
  assert.equal(db.user.role, 'deleted');

  const implementation = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../app/lib/account-deletion.ts', import.meta.url), 'utf8')
  );
  assert.match(implementation, /deleted\+\$\{crypto\.randomUUID\(\)\}@deleted\.invalid/);
  assert.match(implementation, /original_email = \?/);

  const migration = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../database/migrations/002_deleted_account_re_registration.sql', import.meta.url), 'utf8')
  );
  assert.match(migration, /original_email TEXT/);
  assert.match(migration, /users_deleted_original_email_idx/);
  assert.match(migration, /enrollments_one_pending_idx/);
  assert.match(migration, /payment_intents_one_active_idx/);
});
