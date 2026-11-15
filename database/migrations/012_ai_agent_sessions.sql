-- Migration 012: AI assistant agent sessions (slot-filling state per conversation)
--
-- Stores the small, short-lived state of an in-progress assistant flow (for example
-- "add a course": which fields were collected, which question is open, which
-- confirmation card is shown) so a page refresh does not lose the conversation.
-- Rows expire automatically (expires_at) and are deleted with their conversation.
--
-- Idempotent: safe to run more than once. Apply locally/staging first:
--   npm run db:migrate
-- Do NOT apply to production until it has been verified on a test database.

CREATE TABLE IF NOT EXISTS ai_agent_sessions (
  conversation_id TEXT PRIMARY KEY REFERENCES ai_conversations(id) ON DELETE CASCADE,
  staff_email TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_staff ON ai_agent_sessions(staff_email);
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_expires ON ai_agent_sessions(expires_at);
