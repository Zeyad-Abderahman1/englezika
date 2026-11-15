import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../../../lib/rate-limit';
import { getExamLeaderboard, getPublicExam } from '../../../../../lib/public-exam';

/**
 * GET /api/public/exams/[slug]/leaderboard
 * Public (no login), rate-limited, cached ~60s. Returns ONLY rank, display name, score and
 * percentage/time: no identifiers, emails, phones or exam content.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const rate = await checkRateLimit('public-exam-leaderboard', getClientIp(request), 60, 60);
  if (!rate.allowed) return rateLimitResponse(rate.resetAfterSeconds, 'عدد كبير من الطلبات. حاول بعد قليل.');

  const { slug } = await params;
  const exam = await getPublicExam(slug);
  if (!exam || !exam.showLeaderboard || exam.mode !== 'online') {
    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  const leaderboard = await getExamLeaderboard(exam.id);
  return Response.json(
    { leaderboard },
    { headers: { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=120' } }
  );
}
