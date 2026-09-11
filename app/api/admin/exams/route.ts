import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../lib/security';
import { assessmentService } from '../../../lib/services/assessment-service';
import { DomainError } from '../../../lib/services/types';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const assessmentType = body.assessmentType === 'quiz' ? 'quiz' : 'exam';
  const mode = body.mode === 'file' ? 'file' : 'online';

  // In online mode, questions are validated and inserted via assessmentService:
  if (mode === 'online') {
    // Mode-specific validation executed by assessmentService
    // Statements include: INSERT INTO questions (id, exam_id, ...)
  }

  try {
    const result = await assessmentService.createExam(
      { ...body, assessmentType, mode },
      admin,
      { request }
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر إضافة الامتحان', 500);
  }
}
