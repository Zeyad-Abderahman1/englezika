-- Migration 004: Add lecture range scope and inter-lecture gating support to exams

ALTER TABLE exams ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'all_lectures';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_scope_type_check'
  ) THEN
    ALTER TABLE exams ADD CONSTRAINT exams_scope_type_check CHECK (scope_type IN ('all_lectures', 'lecture_range'));
  END IF;
END $$;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS from_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS to_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exams_scope_type_idx ON exams(scope_type);
CREATE INDEX IF NOT EXISTS exams_lecture_range_idx ON exams(course_id, from_video_id, to_video_id);
