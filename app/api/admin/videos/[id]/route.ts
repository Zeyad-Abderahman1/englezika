import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { lectureService } from '../../../../lib/services/lecture-service';
import { DomainError } from '../../../../lib/services/types';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Accepts maxViews in edit payload; lectureService updates max_views column in videos table
  try {
    const result = await lectureService.updateLecture(id, body, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر تعديل المحاضرة', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;

  try {
    const result = await lectureService.deleteLecture(id, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('فشل حذف المحاضرة وبياناتها التابعة.', 500);
  }
}
