import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import { examListingService } from '../../../../../lib/services/exam-listing-service';
import { DomainError } from '../../../../../lib/services/types';

/**
 * GET    /api/admin/exams/[id]/listing — current "published as course" state.
 * PUT    — publish (or update) the exam as a standalone all-classes course.
 * DELETE — unpublish (hides the listing and the public page; attempts are kept).
 * All three call the SAME shared service used by every exam creation path.
 */
async function authorize(request: Request, mutating: boolean) {
  if (mutating) {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
  }
  return apiStaff(request, 'manage_exams');
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await authorize(request, false);
  if (isStaffResponse(staff) || staff instanceof Response) return staff;
  const { id } = await params;
  try {
    return Response.json({ ok: true, ...(await examListingService.getState(id)) });
  } catch (error) {
    if (error instanceof DomainError) return jsonError(error.message, error.status);
    return jsonError('تعذر قراءة حالة النشر', 500);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await authorize(request, true);
  if (isStaffResponse(staff) || staff instanceof Response) return staff;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await examListingService.publishAsCourse(
      id,
      {
        price: body.price,
        description: body.description,
        isPublic: body.isPublic,
        showLeaderboard: body.showLeaderboard,
      },
      staff,
      { request }
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) return jsonError(error.message, error.status);
    return jsonError('تعذر نشر الامتحان ككورس', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await authorize(request, true);
  if (isStaffResponse(staff) || staff instanceof Response) return staff;
  const { id } = await params;
  try {
    return Response.json(await examListingService.unpublish(id, staff, { request }));
  } catch (error) {
    if (error instanceof DomainError) return jsonError(error.message, error.status);
    return jsonError('تعذر إلغاء نشر الامتحان', 500);
  }
}
