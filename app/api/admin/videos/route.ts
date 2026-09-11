import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { jsonError, requireSameOrigin, safeInteger } from '../../../lib/security';
import { lectureService } from '../../../lib/services/lecture-service';
import { DomainError } from '../../../lib/services/types';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(admin)) return admin;
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return jsonError('رفع ملفات الفيديو متوقف. أضف رابط YouTube غير مدرج بدلًا منه.', 410);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const maxViews = safeInteger(body.maxViews, 0, 0, 1000);

  try {
    const result = await lectureService.createLecture({ ...body, maxViews }, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر إضافة المحاضرة', 500);
  }
}
