ALTER TABLE users ADD COLUMN IF NOT EXISTS original_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_deleted_original_email_idx
  ON users (original_email)
  WHERE role = 'deleted' AND original_email IS NOT NULL;

-- Keep at most one live checkout flow per student/course. Historical duplicates
-- are retained, but no longer remain active payment flows.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_email, course_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS row_number
  FROM enrollments
  WHERE status = 'pending'
)
UPDATE enrollments
SET status = 'cancelled', updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id IN (SELECT id FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX IF NOT EXISTS enrollments_one_pending_idx
  ON enrollments (user_email, course_id)
  WHERE status = 'pending';

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY enrollment_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS row_number
  FROM payment_intents
  WHERE status IN ('creating', 'created')
)
UPDATE payment_intents
SET status = 'failed', updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE id IN (SELECT id FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_idx
  ON payment_intents (enrollment_id)
  WHERE status IN ('creating', 'created');
