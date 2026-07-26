import { ensureDatabase } from '../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getD1 } from '../../../lib/platform';
import { safeInteger } from '../../../lib/security';

export async function GET(request: Request) {
  const actor = await apiStaff(request, 'view_students');
  if (isStaffResponse(actor)) return actor;
  await ensureDatabase();
  const db = getD1();
  const url = new URL(request.url);
  const page = safeInteger(url.searchParams.get('page') ?? '1', 1, 1, 10_000);
  const limit = safeInteger(url.searchParams.get('limit') ?? '50', 50, 1, 200);
  const search = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const grade = (url.searchParams.get('grade') ?? '').trim().slice(0, 80);
  const offset = (page - 1) * limit;

  let whereClause = "WHERE u.role = 'student'";
  const bindings: (string | number)[] = [];

  if (search) {
    whereClause += ' AND (u.email LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)';
    const like = `%${search}%`;
    bindings.push(like, like, like);
  }
  if (grade) {
    whereClause += ' AND u.grade = ?';
    bindings.push(grade);
  }

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM users u ${whereClause}`)
    .bind(...bindings)
    .first<{ total: number }>();

  const students = await db
    .prepare(
      `SELECT u.email, u.name,
     u.first_name AS firstName, u.second_name AS secondName,
     u.third_name AS thirdName, u.last_name AS lastName,
     u.phone, u.father_phone AS fatherPhone, u.mother_phone AS motherPhone,
     u.school_name AS schoolName, u.parent_job AS parentJob,
     u.governorate, u.gender, u.grade, u.section,
     u.created_at AS createdAt,
     (SELECT COUNT(*) FROM enrollments e WHERE e.user_email = u.email AND e.status = 'approved') AS activeEnrollments,
     (SELECT COUNT(*) FROM attempts a WHERE a.user_email = u.email) AS totalAttempts
     FROM users u ${whereClause}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`
    )
    .bind(...bindings, limit, offset)
    .all<Record<string, unknown>>();

  return Response.json({
    students: students.results,
    total: Number(countRow?.total ?? 0),
    page,
    limit,
    pages: Math.ceil(Number(countRow?.total ?? 0) / limit),
  });
}
