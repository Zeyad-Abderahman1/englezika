-- Migration 008: PostgreSQL-backed Global AI Runtime Coordination Queue
-- Ensures strict global single-flight execution (max 1 running, max 2 waiting) across all web workers

CREATE TABLE IF NOT EXISTS ai_runtime_queue (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  worker_id TEXT NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('waiting', 'running')),
  created_at BIGINT NOT NULL,
  started_at BIGINT,
  heartbeat_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_runtime_queue_status_id ON ai_runtime_queue (status, id ASC);
CREATE INDEX IF NOT EXISTS idx_ai_runtime_queue_expires_at ON ai_runtime_queue (expires_at);
