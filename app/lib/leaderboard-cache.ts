import { getDatabase } from './platform';

export type LeaderboardRow = {
  email: string;
  name: string;
  grade: string;
  averagePercentage: number;
  examsCompleted: number;
  lastAttemptAt: number;
  rank: number;
};

const TTL_MS = 30_000;
let cachedRows: LeaderboardRow[] | null = null;
let expiresAt = 0;
let pending: Promise<LeaderboardRow[]> | null = null;

async function queryLeaderboard() {
  const result = await getDatabase()
    .prepare(
      `WITH best_attempts AS (
         SELECT user_email, exam_id,
           MAX(score * 100.0 / max_score) AS percentage,
           MAX(submitted_at) AS last_attempt_at
         FROM attempts
         WHERE status = 'submitted' AND max_score > 0
         GROUP BY user_email, exam_id
       ), student_scores AS (
         SELECT u.email, COALESCE(NULLIF(u.name, ''), u.email) AS name, u.grade,
           ROUND(AVG(b.percentage), 1) AS averagePercentage,
           COUNT(b.exam_id) AS examsCompleted,
           MAX(b.last_attempt_at) AS lastAttemptAt
         FROM best_attempts b JOIN users u ON u.email = b.user_email
         WHERE u.role = 'student' AND u.email_verified = 1
           AND u.grade IN ('أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي')
         GROUP BY u.email, u.name, u.grade
       ), ranked AS (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY grade
           ORDER BY "averagePercentage" DESC, "examsCompleted" DESC, "lastAttemptAt" ASC
         ) AS rank
         FROM student_scores
       )
       SELECT email, name, grade, "averagePercentage", "examsCompleted", "lastAttemptAt", rank
       FROM ranked WHERE rank <= 10
       ORDER BY grade, rank`
    )
    .all<LeaderboardRow>();
  return result.results;
}

export async function getCachedLeaderboard() {
  if (cachedRows && Date.now() < expiresAt) return cachedRows;
  pending ??= queryLeaderboard()
    .then((rows) => {
      cachedRows = rows;
      expiresAt = Date.now() + TTL_MS;
      return rows;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function invalidateLeaderboardCache() {
  cachedRows = null;
  expiresAt = 0;
}
