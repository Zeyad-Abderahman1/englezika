import { apiStaff, isStaffResponse } from '../../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../../../lib/security';

/**
 * DELETE /api/admin/assignments/[id]/questions/[qId]
 * Remove an MCQ question from an assignment.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; qId: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;
  void staff;

  const { id, qId } = await params;
  const db = getDatabase();

  try {
    const question = await db
      .prepare('SELECT id FROM assignment_questions WHERE id = ? AND assignment_id = ?')
      .bind(qId, id)
      .first();
    if (!question) return jsonError('السؤال غير موجود', 404);
    await db.prepare('DELETE FROM assignment_questions WHERE id = ?').bind(qId).run();
  } catch {
    return jsonError('تعذر حذف السؤال', 500);
  }

  return new Response(null, { status: 204 });
}
