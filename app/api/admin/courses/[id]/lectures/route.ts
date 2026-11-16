import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import { getDatabase } from '../../../../../lib/platform';

export const runtime = 'nodejs';

/**
 * GET /api/admin/courses/[id]/lectures
 *
 * Returns canonical ordered lectures for a given course.
 * Order respects course_items sequence when present, falling back to creation timestamp.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const { id: courseId } = await params;
  if (!courseId || typeof courseId !== 'string') {
    return jsonError('معرف الدورة التعليمية مطلوب', 400);
  }

  const db = getDatabase();

  // Verify course exists
  const course = await db
    .prepare('SELECT id, title FROM courses WHERE id = ?')
    .bind(courseId)
    .first<{ id: string; title: string }>();

  if (!course) {
    return jsonError('الدورة التعليمية غير موجودة', 404);
  }

  // Retrieve ordered lectures
  const result = await db
    .prepare(
      `SELECT v.id, v.title, v.duration_seconds AS "durationSeconds",
              COALESCE(ci.sort_order, 999999) AS "sortOrder",
              v.created_at AS "createdAt"
       FROM videos v
       LEFT JOIN course_items ci ON ci.video_id = v.id AND ci.course_id = v.course_id
       WHERE v.course_id = ?
       ORDER BY COALESCE(ci.sort_order, 999999) ASC, v.created_at ASC`
    )
    .bind(courseId)
    .all<{ id: string; title: string; durationSeconds: number; sortOrder: number; createdAt: number }>();

  const lectures = (result?.results || []).map((lec, idx) => ({
    id: lec.id,
    courseId,
    title: lec.title,
    orderIndex: idx + 1,
    sortOrder: lec.sortOrder,
  }));

  return Response.json({
    success: true,
    courseId,
    courseTitle: course.title,
    lectures,
  });
}
