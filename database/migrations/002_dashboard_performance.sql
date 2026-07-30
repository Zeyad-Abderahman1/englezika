-- Fast paths for the student dashboard, published content, and exam checks.
CREATE INDEX IF NOT EXISTS enrollments_approved_user_course_idx
  ON enrollments(user_email, course_id) WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS attempts_submitted_exam_user_score_idx
  ON attempts(exam_id, user_email, submitted_at DESC)
  WHERE status = 'submitted';

CREATE INDEX IF NOT EXISTS attempts_submitted_user_exam_score_idx
  ON attempts(user_email, exam_id, submitted_at DESC)
  WHERE status = 'submitted';

CREATE INDEX IF NOT EXISTS exams_published_course_created_idx
  ON exams(course_id, created_at DESC) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS assignments_published_course_created_idx
  ON assignments(course_id, created_at DESC) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS videos_published_course_created_idx
  ON videos(course_id, created_at DESC) WHERE status = 'published';
