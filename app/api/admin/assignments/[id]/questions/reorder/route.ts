import { apiStaff, isStaffResponse } from '../../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../../../lib/security';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!Array.isArray(body.order)) return jsonError('ترتيب غير صالح', 400);
  const db = getDatabase();
  const statements = (body.order as string[]).map((qId, index) =>
    db.prepare('UPDATE assignment_questions SET sort_order = ? WHERE id = ? AND assignment_id = ?')
      .bind(index + 1, qId, id)
  );
  await db.batch(statements);
  return Response.json({ ok: true });
}
