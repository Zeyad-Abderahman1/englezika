import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../lib/security';
import { courseService } from '../../../lib/services/course-service';
import { DomainError } from '../../../lib/services/types';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(admin)) return admin;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const result = await courseService.createCourse(body, admin, { request });
    return Response.json({ ok: true, id: result.id });
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر إضافة الكورس، حاول مرة أخرى', 500);
  }
}
