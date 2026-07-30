import type { Database } from './platform';

export type ExamSession = {
  id: string;
  startedAt: number;
  expiresAt: number;
  status: string;
};

export type ExamSessionStart =
  { kind: 'ready'; session: ExamSession } | { kind: 'attempt_limit' } | { kind: 'busy' };

async function loadSession(db: Database, examId: string, email: string) {
  return db
    .prepare(
      `SELECT id, started_at AS startedAt, expires_at AS expiresAt, status
       FROM exam_sessions WHERE exam_id = ? AND user_email = ?`
    )
    .bind(examId, email)
    .first<ExamSession>();
}

async function attemptCount(db: Database, examId: string, email: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS count FROM attempts WHERE exam_id = ? AND user_email = ?')
    .bind(examId, email)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function startOrResumeExamSession(
  db: Database,
  examId: string,
  email: string,
  durationMinutes: number,
  maxAttempts: number,
  now = Date.now()
): Promise<ExamSessionStart> {
  let session = await loadSession(db, examId, email);
  if (session?.status === 'active' && session.expiresAt > now) {
    return { kind: 'ready', session };
  }
  if (session?.status === 'submitting') return { kind: 'busy' };

  if (session?.status === 'active' && session.expiresAt <= now) {
    const timeoutAttemptId = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          `INSERT INTO attempts
           (id, exam_id, user_email, status, score, max_score, feedback,
            grading_method, started_at, submitted_at)
           SELECT ?, ?, ?, 'expired', 0,
             COALESCE((SELECT SUM(points) FROM questions WHERE exam_id = ?), 0),
             'Exam time expired before submission.', 'timeout', started_at, ?
           FROM exam_sessions
           WHERE id = ? AND exam_id = ? AND user_email = ?
             AND status = 'active' AND expires_at <= ?`
        )
        .bind(timeoutAttemptId, examId, email, examId, now, session.id, examId, email, now),
      db
        .prepare(
          `UPDATE exam_sessions SET status = 'expired'
           WHERE id = ? AND exam_id = ? AND user_email = ?
             AND status = 'active' AND expires_at <= ?`
        )
        .bind(session.id, examId, email, now),
    ]);
    session = await loadSession(db, examId, email);
    if (session?.status === 'active') return { kind: 'ready', session };
  }

  const safeMaximum = Number.isSafeInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1;
  if ((await attemptCount(db, examId, email)) >= safeMaximum) return { kind: 'attempt_limit' };

  const sessionId = crypto.randomUUID();
  const safeDuration =
    Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 30;
  const expiresAt = now + Math.round(safeDuration * 60_000);
  const started = await db
    .prepare(
      `INSERT INTO exam_sessions (id, exam_id, user_email, started_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON CONFLICT(exam_id, user_email) DO UPDATE SET
         id = excluded.id, started_at = excluded.started_at,
         expires_at = excluded.expires_at, status = 'active'
       WHERE exam_sessions.status IN ('submitted', 'expired')
       RETURNING id, started_at AS startedAt, expires_at AS expiresAt, status`
    )
    .bind(sessionId, examId, email, now, expiresAt)
    .first<ExamSession>();

  if (started) return { kind: 'ready', session: started };
  session = await loadSession(db, examId, email);
  return session?.status === 'active' ? { kind: 'ready', session } : { kind: 'busy' };
}

export async function claimExamSession(
  db: Database,
  sessionId: string,
  examId: string,
  email: string,
  now = Date.now()
): Promise<ExamSession | null> {
  return db
    .prepare(
      `UPDATE exam_sessions SET status = 'submitting'
       WHERE id = ? AND exam_id = ? AND user_email = ?
         AND status = 'active' AND expires_at >= ?
       RETURNING id, started_at AS startedAt, expires_at AS expiresAt, status`
    )
    .bind(sessionId, examId, email, now)
    .first<ExamSession>();
}

export async function releaseExamSessionClaim(db: Database, sessionId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE exam_sessions SET status = 'active'
       WHERE id = ? AND status = 'submitting'`
    )
    .bind(sessionId)
    .run();
}
