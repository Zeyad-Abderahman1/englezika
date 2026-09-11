import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { assessmentService } from '../../../../lib/services/assessment-service';
import { DomainError } from '../../../../lib/services/types';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id } = await params;

  try {
    const result = await assessmentService.updateAssignment(id, body, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر تعديل الواجب', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;
  const { id } = await params;

  // assessmentService.deleteAssignment deletes DB records and performs storage.delete on files
  try {
    await assessmentService.deleteAssignment(id, staff, { request });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('فشل حذف الواجب وبياناته التابعة.', 500);
  }
}
