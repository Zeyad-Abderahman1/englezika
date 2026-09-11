import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../lib/security';
import { assessmentService } from '../../../lib/services/assessment-service';
import { DomainError } from '../../../lib/services/types';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const result = await assessmentService.createAssignment(body, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر إضافة الواجب', 500);
  }
}
