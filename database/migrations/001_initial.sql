CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  grade TEXT,
  role TEXT NOT NULL DEFAULT 'student',
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_code TEXT,
  verification_code_expires_at BIGINT,
  first_name TEXT NOT NULL DEFAULT '',
  second_name TEXT NOT NULL DEFAULT '',
  third_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  father_phone TEXT NOT NULL DEFAULT '',
  mother_phone TEXT NOT NULL DEFAULT '',
  school_name TEXT NOT NULL DEFAULT '',
  parent_job TEXT NOT NULL DEFAULT '',
  governorate TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  birth_certificate_key TEXT,
  birth_certificate_content_type TEXT,
  account_use_agreement_accepted_at BIGINT,
  account_use_agreement_version TEXT,
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  password_iterations INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at BIGINT NOT NULL,
  verified_at BIGINT,
  delivery_id TEXT
);

CREATE TABLE IF NOT EXISTS password_reset_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at BIGINT NOT NULL,
  consumed_at BIGINT,
  delivery_id TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  grade TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  course_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  payment_reference TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  course_id TEXT NOT NULL,
  gateway TEXT NOT NULL DEFAULT 'fawaterak',
  transaction_key TEXT,
  transaction_id TEXT,
  amount_minor INTEGER NOT NULL,
  paid_amount_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'EGP',
  status TEXT NOT NULL DEFAULT 'creating',
  payment_method TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  paid_at BIGINT
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  passing_score INTEGER NOT NULL DEFAULT 50,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'draft',
  opens_at BIGINT,
  closes_at BIGINT,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options TEXT,
  correct_answer TEXT NOT NULL,
  rubric TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  feedback TEXT NOT NULL DEFAULT '',
  grading_method TEXT NOT NULL DEFAULT 'rules',
  started_at BIGINT NOT NULL,
  submitted_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_sessions (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  feedback TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'youtube',
  source_url TEXT,
  youtube_id TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  prerequisite_exam_id TEXT,
  minimum_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_progress (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  video_id TEXT NOT NULL,
  completed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS native_sessions (
  session_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at BIGINT,
  max_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_reads (
  user_email TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  read_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_email TEXT NOT NULL REFERENCES staff_users(email) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS enrollments_user_idx ON enrollments(user_email);
CREATE INDEX IF NOT EXISTS enrollments_course_idx ON enrollments(course_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_transaction_key_idx ON payment_intents(transaction_key);
CREATE INDEX IF NOT EXISTS payment_intents_enrollment_idx ON payment_intents(enrollment_id);
CREATE INDEX IF NOT EXISTS payment_intents_user_idx ON payment_intents(user_email);
CREATE INDEX IF NOT EXISTS exams_course_idx ON exams(course_id);
CREATE INDEX IF NOT EXISTS questions_exam_idx ON questions(exam_id);
CREATE INDEX IF NOT EXISTS attempts_exam_idx ON attempts(exam_id);
CREATE INDEX IF NOT EXISTS attempts_user_idx ON attempts(user_email);
CREATE UNIQUE INDEX IF NOT EXISTS exam_sessions_exam_user_idx ON exam_sessions(exam_id, user_email);
CREATE INDEX IF NOT EXISTS answers_attempt_idx ON answers(attempt_id);
CREATE INDEX IF NOT EXISTS videos_course_idx ON videos(course_id);
CREATE UNIQUE INDEX IF NOT EXISTS video_progress_user_video_idx ON video_progress(user_email, video_id);
CREATE INDEX IF NOT EXISTS video_progress_video_idx ON video_progress(video_id);
CREATE INDEX IF NOT EXISTS native_sessions_email_idx ON native_sessions(email);
CREATE INDEX IF NOT EXISTS native_sessions_expiry_idx ON native_sessions(expires_at);
CREATE INDEX IF NOT EXISTS assignments_course_idx ON assignments(course_id);
CREATE UNIQUE INDEX IF NOT EXISTS notification_reads_user_item_idx
  ON notification_reads(user_email, notification_type, notification_id);
CREATE INDEX IF NOT EXISTS notification_reads_user_idx ON notification_reads(user_email);
CREATE INDEX IF NOT EXISTS staff_sessions_email_idx ON staff_sessions(staff_email);
CREATE INDEX IF NOT EXISTS staff_sessions_expiry_idx ON staff_sessions(expires_at);
CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_email);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS courses_status_created_idx ON courses(status, created_at DESC);
CREATE INDEX IF NOT EXISTS enrollments_user_status_created_idx
  ON enrollments(user_email, status, created_at DESC);
CREATE INDEX IF NOT EXISTS enrollments_status_created_idx ON enrollments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS exams_status_course_created_idx ON exams(status, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assignments_status_course_created_idx
  ON assignments(status, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS announcements_status_created_idx ON announcements(status, created_at DESC);
CREATE INDEX IF NOT EXISTS videos_course_status_created_idx ON videos(course_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS attempts_user_exam_submitted_idx
  ON attempts(user_email, exam_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS attempts_status_user_exam_idx ON attempts(status, user_email, exam_id);
CREATE INDEX IF NOT EXISTS contacts_status_created_idx ON contacts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS users_role_verified_grade_idx ON users(role, email_verified, grade);
