import { apiStaff, isStaffResponse } from '../../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../../../lib/security';

/**
 * PATCH /api/admin/assignments/[id]/questions/[qId]
 * Update an MCQ question on an assignment.
 */
export async function PATCH(
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
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const existing = await db
    .prepare('SELECT id, question, explanation, options, correct_index, points, sort_order FROM assignment_questions WHERE id = ? AND assignment_id = ?')
    .bind(qId, id)
    .first<Record<string, unknown>>();
  if (!existing) return jsonError('السؤال غير موجود', 404);

  const question = safeText(body.question ?? existing.question, 2000);
  const explanation = safeText(body.explanation ?? existing.explanation ?? '', 3000);
  const rawOptions = Array.isArray(body.options)
    ? (body.options as unknown[]).slice(0, 6).map((opt) => safeText(opt, 500)).filter(Boolean)
    : null;
  const options = rawOptions || (existing.options ? JSON.parse(String(existing.options)) : []);
  const correctIndex = safeInteger(body.correctIndex ?? existing.correct_index, 0, 0, (Array.isArray(options) ? options.length : 6) - 1);
  const points = safeInteger(body.points ?? existing.points, 1, 1, 100);
  const sortOrder = safeInteger(body.sortOrder ?? existing.sort_order, 0, 0, 9999);

  if (question.length < 3) return jsonError('نص السؤال قصير جداً');
  if (Array.isArray(options) && options.length < 2) return jsonError('يجب إدخال خيارَين على الأقل');

  await db
    .prepare(
      `UPDATE assignment_questions SET question = ?, explanation = ?, options = ?, correct_index = ?, points = ?, sort_order = ? WHERE id = ? AND assignment_id = ?`
    )
    .bind(question, explanation, JSON.stringify(options), correctIndex, points, sortOrder, qId, id)
    .run();

  return Response.json({ ok: true });
}

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