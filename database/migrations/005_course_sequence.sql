-- Migration 005: Course Sequence + Assessments + Materials + View Limits + Bulk Codes
-- Safe: all additive changes, no destructive operations

-- ============================================================
-- 1. COURSE ITEMS (sequence with real foreign keys)
-- ============================================================

CREATE TABLE IF NOT EXISTS course_items (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('video', 'exam', 'assignment')),
  video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
  exam_id TEXT REFERENCES exams(id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CHECK (
    (item_type = 'video' AND video_id IS NOT NULL AND exam_id IS NULL AND assignment_id IS NULL)
    OR
    (item_type = 'exam' AND exam_id IS NOT NULL AND video_id IS NULL AND assignment_id IS NULL)
    OR
    (item_type = 'assignment' AND assignment_id IS NOT NULL AND video_id IS NULL AND exam_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS course_items_course_order_idx ON course_items(course_id, sort_order ASC);
CREATE UNIQUE INDEX IF NOT EXISTS course_items_course_video_unique ON course_items(course_id, video_id)
  WHERE video_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS course_items_course_exam_unique ON course_items(course_id, exam_id)
  WHERE exam_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS course_items_course_assignment_unique ON course_items(course_id, assignment_id)
  WHERE assignment_id IS NOT NULL;

-- ============================================================
-- 2. LECTURE MATERIALS (multiple per lecture)
-- ============================================================

CREATE TABLE IF NOT EXISTS lecture_materials (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS lecture_materials_video_idx ON lecture_materials(video_id);

-- ============================================================
-- 3. VIDEO VIEW SESSIONS (playback-initiated, server-authoritative)
-- ============================================================

CREATE TABLE IF NOT EXISTS video_view_sessions (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'submitted')),
  started_at BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS video_view_sessions_user_video_idx ON video_view_sessions(user_email, video_id);
CREATE INDEX IF NOT EXISTS video_view_sessions_token_idx ON video_view_sessions(session_token);

-- ============================================================
-- 4. ACCESS CODE BATCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS access_code_batches (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  count INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS access_code_batches_video_idx ON access_code_batches(video_id);

-- ============================================================
-- 5. EXTEND EXISTING TABLES
-- ============================================================

-- Exams: assessment_type, mode, teacher_file_key
ALTER TABLE exams ADD COLUMN IF NOT EXISTS assessment_type TEXT NOT NULL DEFAULT 'exam';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'online';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS teacher_file_key TEXT;

-- Questions: explanation, image_file_key
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_file_key TEXT;

-- Assignment questions: explanation, image_file_key
ALTER TABLE assignment_questions ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';
ALTER TABLE assignment_questions ADD COLUMN IF NOT EXISTS image_file_key TEXT;

-- Attempts: pdf_storage_key, graded_by (for file-mode exam submissions)
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS pdf_storage_key TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS graded_by TEXT;

-- Videos: max_views (0 = unlimited)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS max_views INTEGER NOT NULL DEFAULT 0;

-- Lecture access codes: batch_id
ALTER TABLE lecture_access_codes ADD COLUMN IF NOT EXISTS batch_id TEXT
  REFERENCES access_code_batches(id) ON DELETE SET NULL;

-- ============================================================
-- 6. BACKFILL: existing published videos into course_items
-- ============================================================

INSERT INTO course_items (id, course_id, item_type, video_id, sort_order, created_at)
SELECT
  gen_random_uuid()::text,
  v.course_id,
  'video',
  v.id,
  ROW_NUMBER() OVER (PARTITION BY v.course_id ORDER BY v.created_at ASC) - 1,
  v.created_at
FROM videos v
WHERE v.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM course_items ci
    WHERE ci.course_id = v.course_id AND ci.video_id = v.id
  );
