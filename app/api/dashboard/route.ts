import { ensureDatabase } from '../../../db/runtime';
import { apiUser, isResponse } from '../../lib/api-auth';
import { isEmailVerified } from '../../lib/email-verification';
import { getD1 } from '../../lib/platform';

export async function GET() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  await ensureDatabase();
  const db = getD1();
  const email = user.email.toLowerCase();
  const verificationRequired = !(await isEmailVerified(email));
  if (verificationRequired) {
    return Response.json({
      user: { email: user.email, displayName: user.displayName, profile: null },
      verificationRequired: true,
      enrollments: [],
      exams: [],
      attempts: [],
      announcements: [],
    });
  }
  const [profile, enrollments, exams, attempts, announcements] = await Promise.all([
    db
      .prepare(
        `SELECT email, name, first_name AS firstName, second_name AS secondName,
       third_name AS thirdName, last_name AS lastName,
       phone, father_phone AS fatherPhone, mother_phone AS motherPhone,
       school_name AS schoolName, parent_job AS parentJob,
       governorate, gender, grade, section
       FROM users WHERE email = ?`
      )
      .bind(email)
      .first(),
    db
      .prepare(
        `SELECT e.id, e.status, e.created_at AS createdAt, c.id AS courseId, c.title, c.grade
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.user_email = ? ORDER BY e.created_at DESC`
      )
      .bind(email)
      .all(),
    db
      .prepare(
        `SELECT DISTINCT x.id, x.course_id AS courseId, x.title, x.description, x.duration_minutes AS durationMinutes,
       x.passing_score AS passingScore, x.max_attempts AS maxAttempts, c.title AS courseTitle,
       (SELECT COUNT(*) FROM attempts ax WHERE ax.exam_id = x.id AND ax.user_email = ?) AS attemptCount,
       (SELECT COALESCE(MAX(CASE WHEN ax2.max_score > 0 THEN ax2.score * 100.0 / ax2.max_score END), 0)
        FROM attempts ax2 WHERE ax2.exam_id = x.id AND ax2.user_email = ?) AS bestPercentage,
       COALESCE((SELECT SUM(points) FROM questions q WHERE q.exam_id = x.id), 0) AS maxScore
       FROM exams x LEFT JOIN courses c ON c.id = x.course_id
       LEFT JOIN enrollments e ON e.course_id = x.course_id AND e.user_email = ? AND e.status = 'approved'
       WHERE x.status = 'published' AND (x.course_id IS NULL OR e.id IS NOT NULL)
       AND (x.opens_at IS NULL OR x.opens_at <= ?) AND (x.closes_at IS NULL OR x.closes_at >= ?)
       ORDER BY x.created_at DESC`
      )
      .bind(email, email, email, Date.now(), Date.now())
      .all(),
    db
      .prepare(
        `SELECT a.id, a.exam_id AS examId, a.score, a.max_score AS maxScore, a.feedback,
       a.grading_method AS gradingMethod, a.submitted_at AS submittedAt, x.title
       FROM attempts a JOIN exams x ON x.id = a.exam_id
       WHERE a.user_email = ? ORDER BY a.submitted_at DESC LIMIT 30`
      )
      .bind(email)
      .all(),
    db
      .prepare(
        "SELECT id, title, body, created_at AS createdAt FROM announcements WHERE status = 'published' ORDER BY created_at DESC LIMIT 10"
      )
      .all(),
  ]);
  return Response.json({
    user: { email: user.email, displayName: user.displayName, profile },
    verificationRequired: false,
    enrollments: enrollments.results,
    exams: exams.results,
    attempts: attempts.results,
    announcements: announcements.results,
  });
}
