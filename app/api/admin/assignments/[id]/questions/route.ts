import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../lib/platform';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../../lib/security';

/**
 * GET /api/admin/assignments/[id]/questions
 * List all MCQ questions for an assignment.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const db = getDatabase();
  const assignment = await db
    .prepare('SELECT id FROM assignments WHERE id = ?')
    .bind(id)
    .first();
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  try {
    const questions = await db
      .prepare(
        `SELECT id, question, explanation, options, correct_index AS correctIndex, points, sort_order AS sortOrder
         FROM assignment_questions WHERE assignment_id = ? ORDER BY sort_order ASC`
      )
      .bind(id)
      .all<{
        id: string;
        question: string;
        explanation: string | null;
        options: string;
        correctIndex: number;
        points: number;
        sortOrder: number;
      }>();
    return Response.json({
      questions: questions.results.map((q) => ({
        ...q,
        explanation: q.explanation || null,
        options: JSON.parse(q.options) as string[],
      })),
    });
  } catch {
    return Response.json({ questions: [] });
  }
}

/**
 * POST /api/admin/assignments/[id]/questions
 * Add an MCQ question to an assignment.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;
  void staff;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const question = safeText(body.question, 2000);
  const explanation = safeText(body.explanation, 3000);
  const options = Array.isArray(body.options)
    ? (body.options as unknown[])
        .slice(0, 6)
        .map((opt) => safeText(opt, 500))
        .filter(Boolean)
    : [];
  const correctIndex = safeInteger(body.correctIndex, 0, 0, options.length - 1);
  const points = safeInteger(body.points, 1, 1, 100);
  const sortOrder = safeInteger(body.sortOrder, 0, 0, 9999);

  if (question.length < 3) return jsonError('نص السؤال قصير جداً');
  if (options.length < 2) return jsonError('يجب إدخال خيارَين على الأقل');

  const db = getDatabase();
  const assignment = await db
    .prepare('SELECT id FROM assignments WHERE id = ?')
    .bind(id)
    .first();
  if (!assignment) return jsonError('الواجب غير موجود', 404);

  const qId = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO assignment_questions (id, assignment_id, question, explanation, options, correct_index, points, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(qId, id, question, explanation, JSON.stringify(options), correctIndex, points, sortOrder)
      .run();
  } catch {
    return jsonError('جدول الأسئلة غير موجود. يرجى تشغيل الترحيل أولاً', 500);
  }
  return Response.json({ ok: true, id: qId });
}
