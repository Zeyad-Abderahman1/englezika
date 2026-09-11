-- Migration 007: AI Assistant conversations, messages, durable confirmations, and audit logs

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  staff_email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'محادثة جديدة',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_staff ON ai_conversations(staff_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_call_json TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_convo ON ai_messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ai_confirmations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  staff_email TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  result_json TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  executed_at BIGINT,
  execution_id TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_confirmations_hash ON ai_confirmations(token_hash);
CREATE INDEX IF NOT EXISTS idx_ai_confirmations_staff ON ai_confirmations(staff_email);
CREATE INDEX IF NOT EXISTS idx_ai_confirmations_state ON ai_confirmations(state);
CREATE INDEX IF NOT EXISTS idx_ai_confirmations_expires ON ai_confirmations(expires_at);

CREATE TABLE IF NOT EXISTS ai_action_logs (
  id TEXT PRIMARY KEY,
  staff_email TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_staff ON ai_action_logs(staff_email, created_at DESC);
