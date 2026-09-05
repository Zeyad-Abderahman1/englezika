import { apiUser, isResponse } from '../../lib/api-auth';
import { getDatabase } from '../../lib/platform';
import { getCachedLeaderboard } from '../../lib/leaderboard-cache';
import { safeInteger } from '../../lib/security';

export async function GET(request: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const db = getDatabase();
  const email = user.email.toLowerCase();
  const url = new URL(request.url);
  const page = safeInteger(url.searchParams.get('page') ?? '1', 1, 1, 10_000);
  const pageSize = safeInteger(url.searchParams.get('pageSize') ?? '50', 50, 1, 100);
  const offset = (page - 1) * pageSize;
  const verificationRequired = !user.emailVerified;
  if (verificationRequired) {
    return Response.json({
      user: { email: user.email, displayName: user.displayName, profile: null },
      verificationRequired: true,
      enrollments: [],
      exams: [],
      assignments: [],
      attempts: [],
      announcements: [],
      lectureAccess: [],
    });
  }
  const [dashboardResults, leaderboardRows] = await Promise.all([
    db.readBatch([
      db
        .prepare(
          `SELECT email, name, first_name AS firstName, second_name AS secondName,
       third_name AS thirdName, last_name AS lastName,
       phone, father_phone AS fatherPhone, mother_phone AS motherPhone,
       school_name AS schoolName, parent_job AS parentJob,
       governorate, gender, grade, section
       FROM users WHERE email = ?`
        )
        .bind(email),
      db
        .prepare(
          `SELECT e.id, e.status, e.created_at AS createdAt, c.id AS courseId, c.title, c.grade, c.thumbnail_key AS thumbnailKey
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.user_email = ? ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
        )
        .bind(email, pageSize, offset),
      db
        .prepare(
          `SELECT DISTINCT x.id, x.course_id AS courseId, x.title, x.description, x.created_at AS createdAt, x.duration_minutes AS durationMinutes,
       x.passing_score AS passingScore, x.max_attempts AS maxAttempts, c.title AS courseTitle,
       COALESCE(x.assessment_type, 'exam') AS assessmentType,
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
       ORDER BY x.created_at DESC LIMIT ? OFFSET ?`
        )
        .bind(email, email, email, email, Date.now(), Date.now(), pageSize, offset),
      db
        .prepare(
          `SELECT DISTINCT a.id, a.course_id AS courseId, a.title, a.description, a.created_at AS createdAt,
       a.due_at AS dueAt, a.max_score AS maxScore, c.title AS courseTitle,
       CASE WHEN nr.notification_id IS NULL THEN 0 ELSE 1 END AS isRead
       FROM assignments a JOIN courses c ON c.id = a.course_id
       JOIN enrollments e ON e.course_id = a.course_id
       LEFT JOIN notification_reads nr ON nr.user_email = ? AND nr.notification_type = 'assignment'
         AND nr.notification_id = a.id
       WHERE e.user_email = ? AND e.status = 'approved' AND a.status = 'published'
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
        )
        .bind(email, email, pageSize, offset),
      db
        .prepare(
          `SELECT a.id, a.exam_id AS examId, a.score, a.max_score AS maxScore, a.feedback,
       a.grading_method AS gradingMethod, a.submitted_at AS submittedAt, x.title
       FROM attempts a JOIN exams x ON x.id = a.exam_id
       WHERE a.user_email = ? ORDER BY a.submitted_at DESC LIMIT ? OFFSET ?`
        )
        .bind(email, pageSize, offset),
      db
        .prepare(
          `SELECT a.id, a.title, a.body, a.created_at AS createdAt,
           CASE WHEN nr.notification_id IS NULL THEN 0 ELSE 1 END AS isRead
           FROM announcements a LEFT JOIN notification_reads nr
             ON nr.user_email = ? AND nr.notification_type = 'announcement'
             AND nr.notification_id = a.id
           WHERE a.status = 'published' ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
        )
        .bind(email, pageSize, offset),
      db
        .prepare(
          `SELECT g.video_id AS videoId, g.created_at AS grantedAt,
           v.course_id AS courseId, v.title AS videoTitle, c.title AS courseTitle
           FROM student_video_access_grants g
           JOIN videos v ON v.id = g.video_id AND v.status = 'published'
           JOIN courses c ON c.id = v.course_id
           WHERE g.student_email = ? ORDER BY g.created_at DESC`
        )
        .bind(email),
      db.prepare('SELECT COUNT(*) AS total FROM enrollments WHERE user_email = ?').bind(email),
      db
        .prepare(
          `SELECT COUNT(DISTINCT x.id) AS total
           FROM exams x LEFT JOIN enrollments e
             ON e.course_id = x.course_id AND e.user_email = ? AND e.status = 'approved'
           WHERE x.status = 'published' AND (x.course_id IS NULL OR e.id IS NOT NULL)
             AND (x.opens_at IS NULL OR x.opens_at <= ?) AND (x.closes_at IS NULL OR x.closes_at >= ?)`
        )
        .bind(email, Date.now(), Date.now()),
      db
        .prepare(
          `SELECT COUNT(DISTINCT a.id) AS total FROM assignments a JOIN enrollments e ON e.course_id = a.course_id
           WHERE e.user_email = ? AND e.status = 'approved' AND a.status = 'published'`
        )
        .bind(email),
      db.prepare('SELECT COUNT(*) AS total FROM attempts WHERE user_email = ?').bind(email),
      db.prepare("SELECT COUNT(*) AS total FROM announcements WHERE status = 'published'"),
    ]),
    getCachedLeaderboard(),
  ]);
  const [
    profile,
    enrollments,
    exams,
    assignments,
    attempts,
    announcements,
    lectureAccess,
    enrollmentCount,
    examCount,
    assignmentCount,
    attemptCount,
    announcementCount,
  ] = dashboardResults;
  const leaderboards = leaderboardRows.reduce<
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
        rank: Number(row.rank),
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
    user: { email: user.email, displayName: user.displayName, profile: profile.results[0] ?? null },
    verificationRequired: false,
    enrollments: enrollments.results,
    exams: exams.results,
    assignments: assignments.results,
    attempts: attempts.results,
    announcements: announcements.results,
    lectureAccess: lectureAccess.results,
    leaderboards,
    pagination: {
      page,
      pageSize,
      enrollments: Number(enrollmentCount.results[0]?.total ?? 0),
      exams: Number(examCount.results[0]?.total ?? 0),
      assignments: Number(assignmentCount.results[0]?.total ?? 0),
      attempts: Number(attemptCount.results[0]?.total ?? 0),
      announcements: Number(announcementCount.results[0]?.total ?? 0),
    },
  });
}
