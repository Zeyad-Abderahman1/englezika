import { apiVerifiedUser, isResponse } from '../../../../lib/api-auth';
import { examAvailabilityError, loadStudentExam } from '../../../../lib/exam-access';
import { startOrResumeExamSession } from '../../../../lib/exam-session';
import { getDatabase } from '../../../../lib/platform';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../../lib/rate-limit';
import { jsonError, requestBodyWithinLimit, requireSameOrigin } from '../../../../lib/security';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  if (!requestBodyWithinLimit(request, 8 * 1024)) return jsonError('حجم الطلب غير صالح', 413);
  const { id } = await params;
  const email = user.email.toLowerCase();
  const rateLimit = await checkRateLimit('exam-start', `${getClientIp(request)}:${email}`, 10, 60);
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAfterSeconds);
  const exam = await loadStudentExam(id, email);
  if (!exam) return jsonError('الامتحان غير متاح لحسابك', 404);
  const availabilityError = examAvailabilityError(exam, Date.now());
  if (availabilityError === 'not-open') return jsonError('الامتحان لم يبدأ بعد', 403);
  if (availabilityError === 'closed') return jsonError('انتهى وقت إتاحة الامتحان', 403);

  const sessionResult = await startOrResumeExamSession(
    getDatabase(),
    id,
    email,
    Number(exam.durationMinutes || 30),
    Number(exam.maxAttempts || 3),
    Date.now()
  );
  if (sessionResult.kind === 'attempt_limit') {
    return jsonError('انتهى عدد المحاولات المتاحة لهذا الاختبار', 409);
  }
  if (sessionResult.kind === 'busy') return jsonError('جاري تسليم هذا الامتحان', 409);
  return Response.json({ session: sessionResult.session });
}
