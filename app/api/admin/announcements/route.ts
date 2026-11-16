import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../lib/security';
import { announcementService } from '../../../lib/services/announcement-service';
import { DomainError } from '../../../lib/services/types';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_announcements');
  if (isStaffResponse(admin)) return admin;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const result = await announcementService.createAnnouncement(body, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر إضافة الإعلان', 500);
  }
}
