import { apiStaff, isStaffResponse } from '../../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../../lib/private-storage';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../../../lib/security';

/**
 * PATCH /api/admin/assignments/[id]/submissions/[subId]
 * Grade a student submission: assign score and optional feedback.
 * Requires manage_assignments permission.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id, subId } = await params;
  const db = getDatabase();

  const assignment = await db
    .prepare('SELECT id, max_score AS maxScore FROM assignments WHERE id = ?')
    .bind(id)
    .first<{ id: string; maxScore: number }>();
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  const submission = await db
    .prepare(
      'SELECT id, status FROM assignment_submissions WHERE id = ? AND assignment_id = ?'
    )
    .bind(subId, id)
    .first<{ id: string; status: string }>();
  if (!submission) return jsonError('التسليم غير موجود', 404);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const score = safeInteger(body.score, 0, 0, assignment.maxScore > 0 ? assignment.maxScore : 10_000);
  const feedback = safeText(body.feedback, 2000);

  await db
    .prepare(
      `UPDATE assignment_submissions
       SET score = ?, max_score = ?, feedback = ?, graded_by = ?, graded_at = ?, status = 'graded'
       WHERE id = ?`
    )
    .bind(score, assignment.maxScore, feedback, staff.email, Date.now(), subId)
    .run();

  return Response.json({ ok: true });
}

/**
 * GET /api/admin/assignments/[id]/submissions/[subId]/pdf
 * Download a student's submitted PDF.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; subId: string }> }
) {
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { subId } = await params;
  const db = getDatabase();

  const submission = await db
    .prepare('SELECT pdf_storage_key AS pdfStorageKey FROM assignment_submissions WHERE id = ?')
    .bind(subId)
    .first<{ pdfStorageKey: string | null }>();

  if (!submission?.pdfStorageKey) return jsonError('لا يوجد ملف PDF لهذا التسليم', 404);

  const storage = getPrivateStorage();
  const file = await storage.get(submission.pdfStorageKey);
  if (!file) return jsonError('ملف التسليم غير موجود', 404);

  return new Response(file.body as unknown as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="submission-${subId}.pdf"`,
      'content-length': String(file.size),
      'cache-control': 'no-store',
    },
  });
}
