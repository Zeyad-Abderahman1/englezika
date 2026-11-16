ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'pdf';

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS teacher_file_key TEXT;

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_email TEXT NOT NULL,
  pdf_storage_key TEXT,
  mcq_answers TEXT,
  score INTEGER,
  max_score INTEGER,
  feedback TEXT NOT NULL DEFAULT '',
  graded_by TEXT,
  submitted_at BIGINT NOT NULL,
  graded_at BIGINT,
  status TEXT NOT NULL DEFAULT 'submitted',
  UNIQUE (assignment_id, student_email)
);

CREATE INDEX IF NOT EXISTS assignment_submissions_assignment_idx
  ON assignment_submissions (assignment_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS assignment_submissions_student_idx
  ON assignment_submissions (student_email, submitted_at DESC);

CREATE TABLE IF NOT EXISTS assignment_questions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS assignment_questions_assignment_idx
  ON assignment_questions (assignment_id, sort_order ASC);
