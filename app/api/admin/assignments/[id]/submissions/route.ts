import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../lib/platform';
import { jsonError } from '../../../../../lib/security';

/**
 * GET /api/admin/assignments/[id]/submissions
 * Returns all student submissions for a specific assignment.
 * Requires manage_assignments permission.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const db = getDatabase();

  const assignment = await db
    .prepare(
      `SELECT id, title, COALESCE(type, 'pdf') AS type, max_score AS maxScore FROM assignments WHERE id = ?`
    )
    .bind(id)
    .first<{ id: string; title: string; type: string; maxScore: number }>();
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  // Check if assignment_submissions table exists (migration may not have run)
  let submissions: Array<{
    id: string;
    studentEmail: string;
    status: string;
    score: number | null;
    maxScore: number | null;
    feedback: string;
    submittedAt: number;
    gradedAt: number | null;
    gradedBy: string | null;
    hasPdf: number;
  }>;

  try {
    const result = await db
      .prepare(
        `SELECT s.id, s.student_email AS studentEmail, s.status,
         s.score, s.max_score AS maxScore, COALESCE(s.feedback, '') AS feedback,
         s.submitted_at AS submittedAt, s.graded_at AS gradedAt,
         s.graded_by AS gradedBy,
         CASE WHEN s.pdf_storage_key IS NOT NULL THEN 1 ELSE 0 END AS hasPdf
         FROM assignment_submissions s
         WHERE s.assignment_id = ?
         ORDER BY s.submitted_at ASC`
      )
      .bind(id)
      .all<(typeof submissions)[number]>();
    submissions = result.results;
  } catch {
    // Table not yet created
    submissions = [];
  }

  return Response.json({
    assignment,
    submissions,
  });
}
