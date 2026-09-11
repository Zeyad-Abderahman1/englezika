import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import { lectureService } from '../../../../../lib/services/lecture-service';
import { DomainError } from '../../../../../lib/services/types';

// Invariants verified by lectureService:
// - Verifies video exists: SELECT id, course_id AS courseId FROM videos WHERE id = ?
// - Generates secure token: generateLectureQRToken()
// - Hashes token for storage: hashLectureQRToken(normalized)
// - Records audit log: recordAuditLog({ ... })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const { id: videoId } = await params;

  try {
    const origin = new URL(request.url).origin;
    const result = await lectureService.createLectureQR(videoId, origin, staff, { request });
    return Response.json(result, {
      status: 201,
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر إنشاء رمز QR آمن الآن. حاول مرة أخرى.', 503);
  }
}
