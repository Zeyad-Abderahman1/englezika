-- Migration 011: Add explanation to questions and show_review to exams

ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE questions ALTER COLUMN explanation DROP NOT NULL;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_review BOOLEAN NOT NULL DEFAULT true;
