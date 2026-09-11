import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import { courseService } from '../../../../../lib/services/course-service';
import { DomainError } from '../../../../../lib/services/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const admin = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(admin)) return admin;

  const { id: courseId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    items?: unknown;
  };

  try {
    const result = await courseService.saveSequence(courseId, body.items, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر حفظ التسلسل', 500);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(admin)) return admin;

  const { id: courseId } = await params;

  try {
    const result = await courseService.getSequence(courseId, admin);
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر جلب تسلسل الكورس', 500);
  }
}
