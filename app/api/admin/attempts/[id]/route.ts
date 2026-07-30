import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase } from '../../../../lib/platform';
import { invalidateLeaderboardCache } from '../../../../lib/leaderboard-cache';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'grade_exams');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id } = await params;
  const current = await getDatabase()
    .prepare('SELECT max_score AS maxScore FROM attempts WHERE id = ?')
    .bind(id)
    .first<{ maxScore: number }>();
  if (!current) return jsonError('النتيجة غير موجودة', 404);
  const score = safeInteger(body.score, 0, 0, Number(current.maxScore));
  const feedback = safeText(body.feedback, 2000);
  await getDatabase()
    .prepare(
      "UPDATE attempts SET score = ?, feedback = ?, grading_method = 'teacher_review' WHERE id = ?"
    )
    .bind(score, feedback, id)
    .run();
  invalidateLeaderboardCache();
  return Response.json({ ok: true });
}
