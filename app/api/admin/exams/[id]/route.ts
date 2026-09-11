import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { assessmentService } from '../../../../lib/services/assessment-service';
import { DomainError } from '../../../../lib/services/types';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;

  try {
    const result = await assessmentService.getExam(id, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('الامتحان غير موجود', 404);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id } = await params;

  const assessmentType = body.assessmentType === 'quiz' ? 'quiz' : 'exam';
  const mode = body.mode === 'file' ? 'file' : 'online';

  try {
    const result = await assessmentService.updateExam(
      id,
      { ...body, assessmentType, mode },
      admin,
      { request }
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر تعديل الامتحان', 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;
  const { id } = await params;

  // assessmentService.deleteExam cascades DB and cleans up storage for:
  // - teacherFileKey / teacher_file_key
  // - imageFileKey / image_file_key
  // - pdfStorageKey / pdf_storage_key
  try {
    const result = await assessmentService.deleteExam(id, admin, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('فشل حذف الامتحان وبياناته التابعة.', 500);
  }
}
