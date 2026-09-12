-- Migration 009: Assessment Lecture Coverage Range
-- Adds optional lecture coverage metadata to exams table

ALTER TABLE exams ADD COLUMN IF NOT EXISTS coverage_start_lecture_id TEXT REFERENCES videos(id) ON DELETE SET NULL;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS coverage_end_lecture_id TEXT REFERENCES videos(id) ON DELETE SET NULL;
