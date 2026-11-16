import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { announcementService } from '../../../../lib/services/announcement-service';
import { DomainError } from '../../../../lib/services/types';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_announcements');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const result = await announcementService.updateAnnouncement(id, body, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر تعديل الإعلان', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const admin = await apiStaff(request, 'manage_announcements');
  if (isStaffResponse(admin)) return admin;

  const { id } = await params;

  try {
    await announcementService.deleteAnnouncement(id, admin, { request });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('فشل حذف الإعلان', 500);
  }
}
