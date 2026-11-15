-- Migration 013: publish an exam as a standalone, all-classes course + public exam page + leaderboard
--
-- Model: an exam can be "published as a course". That creates (or reuses) ONE wrapper
-- course (courses.kind = 'exam', audience_all_grades = true) linked through
-- exams.listing_course_id, so the existing enrollment / payment / listing flow is reused.
-- The thumbnail file is stored once on the exam; the wrapper course references the same key.
--
-- Idempotent: safe to run more than once. Apply on a test database first:
--   npm run db:migrate
-- Do NOT apply to production until verified.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'course';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS audience_all_grades BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS published_as_course BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS listing_course_id TEXT REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS public_slug TEXT;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_leaderboard BOOLEAN NOT NULL DEFAULT true;

-- One public slug per exam, and at most one listing course per exam (no duplicate listings).
CREATE UNIQUE INDEX IF NOT EXISTS exams_public_slug_key ON exams(public_slug) WHERE public_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exams_listing_course_key ON exams(listing_course_id) WHERE listing_course_id IS NOT NULL;

-- Students can hide their name on public leaderboards (they keep their rank, shown anonymously).
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_from_leaderboard BOOLEAN NOT NULL DEFAULT false;

-- Leaderboard: best completed attempt per student for one exam, top 10 by score then time.
CREATE INDEX IF NOT EXISTS attempts_leaderboard_idx
  ON attempts(exam_id, user_email, submitted_at)
  WHERE status = 'submitted';

CREATE INDEX IF NOT EXISTS courses_kind_status_idx ON courses(kind, status);
