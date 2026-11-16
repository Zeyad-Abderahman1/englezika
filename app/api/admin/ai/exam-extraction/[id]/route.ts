import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError } from '../../../../../lib/security';
import { getDatabase } from '../../../../../lib/platform';
import {
  getExtraction,
  loadWindows,
  summarizeExtraction,
} from '../../../../../lib/ai/agent/exam-extraction-store';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ai/exam-extraction/[id]
 * Returns the merged questions of an extraction (owner only) so the teacher can open the
 * full review/edit screen (the OCR modal) pre-filled with what the assistant extracted.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  if (!id || id.length > 64) return jsonError('معرف الاستخراج غير صالح', 400);

  const db = getDatabase();
  const record = await getExtraction(db, id, staff.email);
  if (!record) return jsonError('انتهت صلاحية الاستخراج أو لم يعد متاحًا', 404);

  const summary = summarizeExtraction(record, await loadWindows(db, record.id));
  return Response.json({
    ok: true,
    questions: summary.questions,
    warnings: summary.warnings,
    pageCount: record.pages.length,
  });
}
