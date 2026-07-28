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
      assignments: [],
      attempts: [],
      announcements: [],
    });
  }
  const [profile, enrollments, exams, assignments, attempts, announcements, leaderboardRows] =
    await Promise.all([
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
       CASE WHEN nr.notification_id IS NULL THEN 0 ELSE 1 END AS isRead,
       (SELECT COUNT(*) FROM attempts ax WHERE ax.exam_id = x.id AND ax.user_email = ?) AS attemptCount,
       (SELECT COALESCE(MAX(CASE WHEN ax2.max_score > 0 THEN ax2.score * 100.0 / ax2.max_score END), 0)
        FROM attempts ax2 WHERE ax2.exam_id = x.id AND ax2.user_email = ?) AS bestPercentage,
       COALESCE((SELECT SUM(points) FROM questions q WHERE q.exam_id = x.id), 0) AS maxScore
       FROM exams x LEFT JOIN courses c ON c.id = x.course_id
       LEFT JOIN enrollments e ON e.course_id = x.course_id AND e.user_email = ? AND e.status = 'approved'
       LEFT JOIN notification_reads nr ON nr.user_email = ? AND nr.notification_type = 'exam'
         AND nr.notification_id = x.id
       WHERE x.status = 'published' AND (x.course_id IS NULL OR e.id IS NOT NULL)
       AND (x.opens_at IS NULL OR x.opens_at <= ?) AND (x.closes_at IS NULL OR x.closes_at >= ?)
       ORDER BY x.created_at DESC`
        )
        .bind(email, email, email, email, Date.now(), Date.now())
        .all(),
      db
        .prepare(
          `SELECT DISTINCT a.id, a.course_id AS courseId, a.title, a.description,
       a.due_at AS dueAt, a.max_score AS maxScore, c.title AS courseTitle,
       CASE WHEN nr.notification_id IS NULL THEN 0 ELSE 1 END AS isRead
       FROM assignments a JOIN courses c ON c.id = a.course_id
       JOIN enrollments e ON e.course_id = a.course_id
       LEFT JOIN notification_reads nr ON nr.user_email = ? AND nr.notification_type = 'assignment'
         AND nr.notification_id = a.id
       WHERE e.user_email = ? AND e.status = 'approved' AND a.status = 'published'
       ORDER BY a.created_at DESC`
        )
        .bind(email, email)
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
          `SELECT a.id, a.title, a.body, a.created_at AS createdAt,
           CASE WHEN nr.notification_id IS NULL THEN 0 ELSE 1 END AS isRead
           FROM announcements a LEFT JOIN notification_reads nr
             ON nr.user_email = ? AND nr.notification_type = 'announcement'
             AND nr.notification_id = a.id
           WHERE a.status = 'published' ORDER BY a.created_at DESC LIMIT 10`
        )
        .bind(email)
        .all(),
      db
        .prepare(
          `WITH best_attempts AS (
           SELECT user_email, exam_id,
             MAX(score * 100.0 / max_score) AS percentage,
             MAX(submitted_at) AS lastAttemptAt
           FROM attempts
           WHERE status = 'submitted' AND max_score > 0
           GROUP BY user_email, exam_id
         )
         SELECT u.email, COALESCE(NULLIF(u.name, ''), u.email) AS name, u.grade,
           ROUND(AVG(b.percentage), 1) AS averagePercentage,
           COUNT(b.exam_id) AS examsCompleted,
           MAX(b.lastAttemptAt) AS lastAttemptAt
         FROM best_attempts b JOIN users u ON u.email = b.user_email
         WHERE u.role = 'student' AND u.email_verified = 1
           AND u.grade IN ('أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي')
         GROUP BY u.email, u.name, u.grade
         ORDER BY u.grade, averagePercentage DESC, examsCompleted DESC, lastAttemptAt ASC`
        )
        .all<{
          email: string;
          name: string;
          grade: string;
          averagePercentage: number;
          examsCompleted: number;
          lastAttemptAt: number;
        }>(),
    ]);
  const leaderboards = leaderboardRows.results.reduce<
    Record<
      string,
      Array<{
        rank: number;
        name: string;
        averagePercentage: number;
        examsCompleted: number;
        isCurrentStudent: boolean;
      }>
    >
  >((groups, row) => {
    const board = groups[row.grade] ?? [];
    if (board.length < 10) {
      board.push({
        rank: board.length + 1,
        name: row.name,
        averagePercentage: Number(row.averagePercentage),
        examsCompleted: Number(row.examsCompleted),
        isCurrentStudent: row.email.toLowerCase() === email,
      });
      groups[row.grade] = board;
    }
    return groups;
  }, {});
  return Response.json({
    user: { email: user.email, displayName: user.displayName, profile },
    verificationRequired: false,
    enrollments: enrollments.results,
    exams: exams.results,
    assignments: assignments.results,
    attempts: attempts.results,
    announcements: announcements.results,
    leaderboards,
  });
}
