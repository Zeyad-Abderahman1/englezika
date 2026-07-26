import { ensureDatabase } from "../../../../db/runtime";
import { apiStaff, isStaffResponse } from "../../../lib/staff-auth";
import { getD1 } from "../../../lib/platform";

export async function GET(request: Request) {
  const admin = await apiStaff(request);
  if (isStaffResponse(admin)) return admin;
  await ensureDatabase();
  const db = getD1();

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10)));
  const offset = (page - 1) * pageSize;

  const [courses, exams, enrollments, attempts, videos, contacts, counts, totalEnrollments, totalAttempts, totalContacts] = await Promise.all([
    db.prepare(
      `SELECT id, title, grade, description, price, status, created_at AS createdAt
       FROM courses ORDER BY created_at DESC`
    ).all(),
    db.prepare(
      `SELECT x.id, x.course_id AS courseId, x.title, x.description, x.instructions,
       x.duration_minutes AS durationMinutes,
       x.passing_score AS passingScore, x.max_attempts AS maxAttempts, x.status, x.created_at AS createdAt,
       c.title AS courseTitle, COUNT(q.id) AS questionCount, COALESCE(SUM(q.points), 0) AS maxScore
       FROM exams x LEFT JOIN courses c ON c.id = x.course_id
       LEFT JOIN questions q ON q.exam_id = x.id
       GROUP BY x.id ORDER BY x.created_at DESC`
    ).all(),
    db.prepare(
      `SELECT e.id, e.user_email AS userEmail, e.status, e.payment_method AS paymentMethod,
       e.payment_reference AS paymentReference, e.created_at AS createdAt,
       c.title AS courseTitle, c.id AS courseId
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       ORDER BY CASE e.status WHEN 'pending' THEN 0 ELSE 1 END, e.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(pageSize, offset).all(),
    db.prepare(
      `SELECT a.id, a.user_email AS userEmail, a.score, a.max_score AS maxScore,
       a.grading_method AS gradingMethod, a.submitted_at AS submittedAt, x.title AS examTitle
       FROM attempts a JOIN exams x ON x.id = a.exam_id ORDER BY a.submitted_at DESC
       LIMIT ? OFFSET ?`
    ).bind(pageSize, offset).all(),
    db.prepare(
      `SELECT v.id, v.course_id AS courseId, v.title, v.status,
       v.duration_seconds AS durationSeconds, v.prerequisite_exam_id AS prerequisiteExamId,
       v.minimum_score AS minimumScore, v.created_at AS createdAt,
       c.title AS courseTitle, x.title AS prerequisiteExamTitle
       FROM videos v JOIN courses c ON c.id = v.course_id
       LEFT JOIN exams x ON x.id = v.prerequisite_exam_id
       ORDER BY v.created_at DESC`
    ).all(),
    db.prepare(
      "SELECT id, name, phone, message, status, created_at AS createdAt FROM contacts ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).bind(pageSize, offset).all(),
    db.prepare(
      `SELECT
       (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
       (SELECT COUNT(*) FROM enrollments WHERE status = 'approved') AS activeEnrollments,
       (SELECT COUNT(*) FROM enrollments WHERE status = 'pending') AS pendingEnrollments,
       (SELECT COUNT(*) FROM exams WHERE status = 'published') AS publishedExams,
       (SELECT COUNT(*) FROM attempts) AS attempts,
       (SELECT COALESCE(AVG(CASE WHEN max_score > 0 THEN score * 100.0 / max_score END), 0) FROM attempts) AS averageScore`
    ).first(),
    db.prepare("SELECT COUNT(*) AS total FROM enrollments").first<{ total: number }>(),
    db.prepare("SELECT COUNT(*) AS total FROM attempts").first<{ total: number }>(),
    db.prepare("SELECT COUNT(*) AS total FROM contacts").first<{ total: number }>(),
  ]);

  const can = (permission: string) => admin.permissions.includes(permission as typeof admin.permissions[number]);
  const rawCounts = (counts ?? {}) as Record<string, unknown>;

  const makePagination = (totalRecords: number) => {
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;
    return {
      page,
      pageSize,
      total: totalRecords,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  };

  return Response.json({
    admin: { email: admin.email, name: admin.name, role: admin.role, permissions: admin.permissions },
    counts: {
      students: can("view_students") || can("manage_enrollments") ? rawCounts.students : 0,
      activeEnrollments: can("manage_enrollments") ? rawCounts.activeEnrollments : 0,
      pendingEnrollments: can("manage_enrollments") ? rawCounts.pendingEnrollments : 0,
      publishedExams: can("manage_exams") || can("grade_exams") ? rawCounts.publishedExams : 0,
      attempts: can("grade_exams") ? rawCounts.attempts : 0,
      averageScore: can("grade_exams") ? rawCounts.averageScore : 0,
    },
    courses: can("manage_courses") || can("manage_exams") || can("manage_videos") || can("manage_enrollments")
      ? courses.results
      : [],
    exams: can("manage_exams") || can("manage_videos") ? exams.results : [],
    enrollments: can("manage_enrollments") ? enrollments.results : [],
    attempts: can("grade_exams") ? attempts.results : [],
    videos: can("manage_videos") ? videos.results : [],
    contacts: can("manage_messages") ? contacts.results : [],
    pagination: {
      enrollments: makePagination(totalEnrollments?.total || 0),
      attempts: makePagination(totalAttempts?.total || 0),
      contacts: makePagination(totalContacts?.total || 0),
    },
  });
}
