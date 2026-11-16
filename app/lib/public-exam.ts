import { getDatabase } from './platform';
import { toLeaderboardRows, type LeaderboardRow, type RawLeaderboardRow } from './exam-listing';

/**
 * Data for the PUBLIC exam page (no login). It exposes only listing facts and a
 * top-10 leaderboard of display names and scores. It never returns questions,
 * options, answers, explanations, emails, phones, schools or user ids.
 */

export type PublicExam = {
  id: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  passingScore: number;
  questionCount: number;
  price: number;
  listingCourseId: string | null;
  hasThumbnail: boolean;
  showLeaderboard: boolean;
  mode: string;
  assessmentType: string;
  updatedAt: number;
};

const CACHE_TTL_MS = 60_000;
const examCache = new Map<string, { value: Promise<PublicExam | null>; expiresAt: number }>();
const leaderboardCache = new Map<string, { value: Promise<LeaderboardRow[]>; expiresAt: number }>();

export function invalidatePublicExamCache() {
  examCache.clear();
  leaderboardCache.clear();
}

/** An exam is public only when it is published, listed as a course AND marked public. */
async function queryPublicExam(slug: string): Promise<PublicExam | null> {
  return getDatabase()
    .prepare(
      `SELECT x.id, x.public_slug AS "slug", x.title, x.description,
        x.duration_minutes AS "durationMinutes", x.passing_score AS "passingScore",
        (SELECT COUNT(*) FROM questions q WHERE q.exam_id = x.id) AS "questionCount",
        COALESCE(c.price, 0) AS price, x.listing_course_id AS "listingCourseId",
        (x.thumbnail_key IS NOT NULL) AS "hasThumbnail", x.show_leaderboard AS "showLeaderboard",
        COALESCE(x.mode, 'online') AS mode, COALESCE(x.assessment_type, 'exam') AS "assessmentType",
        x.updated_at AS "updatedAt"
       FROM exams x LEFT JOIN courses c ON c.id = x.listing_course_id
       WHERE x.public_slug = ? AND x.status = 'published'
         AND x.published_as_course = true AND x.is_public = true`
    )
    .bind(slug)
    .first<PublicExam>();
}

export async function getPublicExam(slug: string): Promise<PublicExam | null> {
  if (!slug || slug.length > 120) return null;
  const cached = examCache.get(slug);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const value = queryPublicExam(slug).catch((error) => {
    examCache.delete(slug);
    throw error;
  });
  examCache.set(slug, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Best COMPLETED attempt per student, ordered by score (percentage) desc, then shorter
 * time, then earlier submission, then email as a final deterministic tiebreaker. Only
 * students (not staff) with status 'submitted' attempts count; terminated attempts are
 * excluded. LIMIT 10 is applied in SQL and backed by attempts_leaderboard_idx.
 */
export const LEADERBOARD_SQL = `
  WITH best AS (
    SELECT DISTINCT ON (a.user_email)
      a.user_email, a.score, a.max_score, a.submitted_at,
      CASE WHEN a.max_score > 0 THEN a.score * 100.0 / a.max_score ELSE 0 END AS pct,
      GREATEST(a.submitted_at - a.started_at, 0) AS duration_ms
    FROM attempts a
    WHERE a.exam_id = ? AND a.status = 'submitted' AND a.max_score > 0
    ORDER BY a.user_email,
      (a.score * 1.0 / a.max_score) DESC,
      GREATEST(a.submitted_at - a.started_at, 0) ASC,
      a.submitted_at ASC
  )
  SELECT b.score, b.max_score, b.pct, b.duration_ms,
    u.first_name, u.last_name, u.name, u.hide_from_leaderboard
  FROM best b
  JOIN users u ON u.email = b.user_email AND u.role = 'student'
  ORDER BY b.pct DESC, b.duration_ms ASC, b.submitted_at ASC, b.user_email ASC
  LIMIT 10`;

async function queryLeaderboard(examId: string): Promise<LeaderboardRow[]> {
  const result = await getDatabase().prepare(LEADERBOARD_SQL).bind(examId).all<RawLeaderboardRow>();
  return toLeaderboardRows(result.results);
}

export async function getExamLeaderboard(examId: string): Promise<LeaderboardRow[]> {
  const cached = leaderboardCache.get(examId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const value = queryLeaderboard(examId).catch((error) => {
    leaderboardCache.delete(examId);
    throw error;
  });
  leaderboardCache.set(examId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
