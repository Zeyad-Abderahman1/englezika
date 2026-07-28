import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimExamSession,
  releaseExamSessionClaim,
  startOrResumeExamSession,
} from '../app/lib/exam-session.ts';

class ExamDatabase {
  sessions = new Map();
  attempts = [];

  key(examId, email) {
    return `${examId}:${email}`;
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
        if (normalizedSql.startsWith('SELECT id, started_at AS startedAt')) {
          const [examId, email] = this.bindings;
          const session = database.sessions.get(database.key(examId, email));
          return session ? { ...session } : null;
        }
        if (normalizedSql.startsWith('SELECT COUNT(*) AS count FROM attempts')) {
          const [examId, email] = this.bindings;
          return {
            count: database.attempts.filter(
              (attempt) => attempt.examId === examId && attempt.email === email
            ).length,
          };
        }
        if (normalizedSql.startsWith('INSERT INTO exam_sessions')) {
          const [id, examId, email, startedAt, expiresAt] = this.bindings;
          const key = database.key(examId, email);
          const current = database.sessions.get(key);
          if (current && !['submitted', 'expired'].includes(current.status)) return null;
          const session = { id, examId, email, startedAt, expiresAt, status: 'active' };
          database.sessions.set(key, session);
          return { ...session };
        }
        if (normalizedSql.startsWith("UPDATE exam_sessions SET status = 'submitting'")) {
          const [id, examId, email, now] = this.bindings;
          const session = database.sessions.get(database.key(examId, email));
          if (
            !session ||
            session.id !== id ||
            session.status !== 'active' ||
            session.expiresAt < now
          ) {
            return null;
          }
          session.status = 'submitting';
          return { ...session };
        }
        return null;
      }

      async run() {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('INSERT INTO attempts')) {
          const [, examId, email, , submittedAt, sessionId, boundExamId, boundEmail, now] =
            this.bindings;
          const session = database.sessions.get(database.key(boundExamId, boundEmail));
          if (
            session &&
            session.id === sessionId &&
            session.status === 'active' &&
            session.expiresAt <= now
          ) {
            database.attempts.push({ examId, email, submittedAt, status: 'expired' });
            return { success: true, results: [], meta: { changes: 1 } };
          }
        }
        if (normalizedSql.startsWith("UPDATE exam_sessions SET status = 'expired'")) {
          const [id, examId, email, now] = this.bindings;
          const session = database.sessions.get(database.key(examId, email));
          if (session?.id === id && session.status === 'active' && session.expiresAt <= now) {
            session.status = 'expired';
          }
        }
        if (normalizedSql.startsWith("UPDATE exam_sessions SET status = 'active'")) {
          const sessionId = this.bindings[0];
          for (const session of database.sessions.values()) {
            if (session.id === sessionId && session.status === 'submitting') {
              session.status = 'active';
            }
          }
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

test('exam sessions keep one timer, consume expirations, and allow only one submitter', async () => {
  const db = new ExamDatabase();
  const now = 1_800_000_000_000;
  const examId = 'exam-1';
  const email = 'student@example.test';

  const first = await startOrResumeExamSession(db, examId, email, 1, 2, now);
  assert.equal(first.kind, 'ready');
  const repeated = await startOrResumeExamSession(db, examId, email, 1, 2, now + 10_000);
  assert.equal(repeated.kind, 'ready');
  assert.equal(repeated.session.id, first.session.id);
  assert.equal(repeated.session.expiresAt, first.session.expiresAt);

  assert.equal(
    await claimExamSession(db, first.session.id, examId, 'other@example.test', now + 20_000),
    null
  );
  const competingClaims = await Promise.all([
    claimExamSession(db, first.session.id, examId, email, now + 20_000),
    claimExamSession(db, first.session.id, examId, email, now + 20_000),
  ]);
  assert.equal(competingClaims.filter(Boolean).length, 1);

  await releaseExamSessionClaim(db, first.session.id);
  const next = await startOrResumeExamSession(db, examId, email, 1, 2, now + 60_001);
  assert.equal(next.kind, 'ready');
  assert.notEqual(next.session.id, first.session.id);
  assert.equal(db.attempts.length, 1);

  await releaseExamSessionClaim(db, next.session.id);
  db.sessions.get(db.key(examId, email)).expiresAt = now + 60_002;
  const exhausted = await startOrResumeExamSession(db, examId, email, 1, 2, now + 60_003);
  assert.equal(exhausted.kind, 'attempt_limit');
  assert.equal(db.attempts.length, 2);
});
