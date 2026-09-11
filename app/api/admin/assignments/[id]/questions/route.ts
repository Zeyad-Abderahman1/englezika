import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin, safeText } from '../../../../../lib/security';
import { assessmentService } from '../../../../../lib/services/assessment-service';
import { DomainError } from '../../../../../lib/services/types';

/**
 * GET /api/admin/assignments/[id]/questions
 * List all MCQ questions for an assignment.
 * Query executed by assessmentService:
 *   SELECT id, question, explanation, options, correct_index AS correctIndex, points, sort_order AS sortOrder
 * Returns mapped fields:
 * - explanation: q.explanation || null
 * - imageFileKey: q.imageFileKey || null
 * - hasImage: q.imageFileKey != null
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;

  try {
    const result = await assessmentService.getAssignmentQuestions(id, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return Response.json({ questions: [] });
  }
}

/**
 * POST /api/admin/assignments/[id]/questions
 * Add an MCQ question to an assignment.
 * Validates: question.length < 3, options.length < 2, safeText(body.explanation, 3000).
 * Delegates statement execution (INSERT INTO assignment_questions) to assessmentService.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const explanation = safeText(body.explanation, 3000);

  try {
    const result = await assessmentService.createAssignmentQuestion(
      id,
      { ...body, explanation },
      staff,
      { request }
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر إضافة السؤال', 500);
  }
}
