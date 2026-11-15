/**
 * Pure helpers (no I/O) for publishing an exam as a course and for its public page:
 * slug generation, public display-name masking and leaderboard row shaping.
 * Kept dependency-free so they are unit-tested and safe to use anywhere.
 */

export const ALL_GRADES_LABEL = 'كل الصفوف';

/** Readable URL slug: keeps Arabic/Latin letters and digits, joins words with "-". */
export function slugifyExamTitle(title: string, suffix: string): string {
  const base = (title || '')
    .normalize('NFKC')
    .replace(/[ً-ٟـ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/^-|-$/g, '');
  const cleanSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return [base || 'exam', cleanSuffix].filter(Boolean).join('-');
}

export function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 7).padEnd(5, '0');
}

export const ANONYMOUS_STUDENT_LABEL = 'طالب مجهول';

/**
 * Public display name: first name + first letter of the last name ("أحمد م."),
 * never an email, phone, user id or full name. Opted-out students are anonymous.
 */
export function maskDisplayName(input: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  hidden?: boolean | null;
}): string {
  if (input.hidden) return ANONYMOUS_STUDENT_LABEL;

  const clean = (value?: string | null) => (value || '').replace(/[^\p{L}\p{N}\s'-]/gu, '').trim();
  let first = clean(input.firstName);
  let last = clean(input.lastName);

  if (!first) {
    const parts = clean(input.fullName).split(/\s+/).filter(Boolean);
    first = parts[0] || '';
    last = last || (parts.length > 1 ? parts[parts.length - 1] : '');
  }
  if (!first) return ANONYMOUS_STUDENT_LABEL;

  const firstWord = first.split(/\s+/)[0];
  const initial = Array.from(last)[0];
  return initial ? `${firstWord} ${initial}.` : firstWord;
}

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  score: number;
  maxScore: number;
  percentage: number;
  timeSeconds: number;
}

export interface RawLeaderboardRow {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  hide_from_leaderboard?: boolean | null;
  score: number | string;
  max_score: number | string;
  pct: number | string;
  duration_ms: number | string;
}

/** Shapes DB rows (already ordered and limited) into public rows: no identifiers at all. */
export function toLeaderboardRows(rows: RawLeaderboardRow[]): LeaderboardRow[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    displayName: maskDisplayName({
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: row.name,
      hidden: row.hide_from_leaderboard,
    }),
    score: Number(row.score),
    maxScore: Number(row.max_score),
    percentage: Math.round(Number(row.pct) * 10) / 10,
    timeSeconds: Math.max(0, Math.round(Number(row.duration_ms) / 1000)),
  }));
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** URL of an exam thumbnail with a ?v= token (derived from the unique key of each upload) for cache busting. */
export function examThumbnailUrl(examId: string, thumbnailKey?: string | null): string {
  if (!examId || !thumbnailKey) return '';
  const token = (thumbnailKey.split('/').pop() || '').replace(/\.[^.]+$/, '');
  return `/api/exams/${encodeURIComponent(examId)}/thumbnail${token ? `?v=${encodeURIComponent(token)}` : ''}`;
}

export interface LeaderboardAttempt {
  email: string;
  status: string;
  score: number;
  maxScore: number;
  startedAt: number;
  submittedAt: number;
}

export interface LeaderboardStudent {
  email: string;
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  hidden?: boolean | null;
}

/**
 * Reference implementation of the leaderboard rules (kept in sync with LEADERBOARD_SQL in
 * public-exam.ts and used by tests and fakes): completed ('submitted') attempts only, one row per
 * student with their BEST attempt, students only (no staff), ordered by percentage desc, then
 * shorter time, then earlier submission, then email; top `limit` rows; masked names.
 */
export function rankLeaderboardRawReference(
  attempts: LeaderboardAttempt[],
  students: LeaderboardStudent[],
  limit = 10
): RawLeaderboardRow[] {
  const studentByEmail = new Map(students.filter((s) => s.role === 'student').map((s) => [s.email, s]));
  const pct = (a: LeaderboardAttempt) => (a.score * 100) / a.maxScore;
  const duration = (a: LeaderboardAttempt) => Math.max(a.submittedAt - a.startedAt, 0);
  const better = (a: LeaderboardAttempt, b: LeaderboardAttempt) =>
    pct(a) - pct(b) || duration(b) - duration(a) || b.submittedAt - a.submittedAt;

  const best = new Map<string, LeaderboardAttempt>();
  for (const attempt of attempts) {
    if (attempt.status !== 'submitted' || !(attempt.maxScore > 0)) continue;
    if (!studentByEmail.has(attempt.email)) continue;
    const current = best.get(attempt.email);
    if (!current || better(attempt, current) > 0) best.set(attempt.email, attempt);
  }

  const ordered = [...best.values()].sort(
    (a, b) =>
      pct(b) - pct(a) ||
      duration(a) - duration(b) ||
      a.submittedAt - b.submittedAt ||
      a.email.localeCompare(b.email)
  );

  return ordered.slice(0, limit).map((attempt) => {
    const student = studentByEmail.get(attempt.email) as LeaderboardStudent;
    return {
      first_name: student.firstName,
      last_name: student.lastName,
      name: student.name,
      hide_from_leaderboard: student.hidden,
      score: attempt.score,
      max_score: attempt.maxScore,
      pct: pct(attempt),
      duration_ms: duration(attempt),
    };
  });
}

export function rankLeaderboardReference(
  attempts: LeaderboardAttempt[],
  students: LeaderboardStudent[],
  limit = 10
): LeaderboardRow[] {
  return toLeaderboardRows(rankLeaderboardRawReference(attempts, students, limit));
}
