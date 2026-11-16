-- Migration 014: AI assistant "exam from photos" extraction state
--
-- The assistant stages the teacher's exam-page photos, then extracts questions window by
-- window (small overlapping batches of pages, one short HTTP request each). Results are kept
-- here, server-side, and referenced by id: they are never pasted back into a model prompt and
-- an exam is only created after the teacher confirms.
--
-- Idempotent. Apply on a test database first: npm run db:migrate
-- Do NOT apply to production until verified.

CREATE TABLE IF NOT EXISTS ai_exam_extractions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  staff_email TEXT NOT NULL,
  pages_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_exam_extractions_staff ON ai_exam_extractions(staff_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_exam_extractions_expires ON ai_exam_extractions(expires_at);

CREATE TABLE IF NOT EXISTS ai_exam_extraction_windows (
  extraction_id TEXT NOT NULL REFERENCES ai_exam_extractions(id) ON DELETE CASCADE,
  window_index INTEGER NOT NULL,
  questions_json TEXT,
  error_message TEXT,
  retryable BOOLEAN NOT NULL DEFAULT true,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (extraction_id, window_index)
);
