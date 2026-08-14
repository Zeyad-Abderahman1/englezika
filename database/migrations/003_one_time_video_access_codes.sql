CREATE TABLE IF NOT EXISTS lecture_access_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT UNIQUE NOT NULL,
  display_suffix TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_by_staff_email TEXT REFERENCES staff_users(email) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  redeemed_by_student_email TEXT REFERENCES users(email) ON DELETE SET NULL,
  redeemed_at BIGINT,
  CONSTRAINT lecture_access_codes_redemption_state_check CHECK (
    redeemed_by_student_email IS NULL OR redeemed_at IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS student_video_access_grants (
  id TEXT PRIMARY KEY,
  student_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'one_time_code',
  source_access_code_id TEXT UNIQUE REFERENCES lecture_access_codes(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT student_video_access_grants_source_check CHECK (source = 'one_time_code'),
  CONSTRAINT student_video_access_grants_student_video_unique UNIQUE (student_email, video_id)
);

CREATE INDEX IF NOT EXISTS lecture_access_codes_video_created_idx
  ON lecture_access_codes(video_id, created_at DESC);
