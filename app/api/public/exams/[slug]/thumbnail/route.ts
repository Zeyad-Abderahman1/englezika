import { getDatabase } from '../../../../../lib/platform';
import { thumbnailResponse } from '../../../../../lib/exam-thumbnail-response';

/** GET /api/public/exams/[slug]/thumbnail — header / Open Graph image of a PUBLIC exam page. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slug || slug.length > 120) return new Response('Not Found', { status: 404 });

  const exam = await getDatabase()
    .prepare(
      `SELECT thumbnail_key AS "thumbnailKey" FROM exams
       WHERE public_slug = ? AND status = 'published' AND published_as_course = true AND is_public = true`
    )
    .bind(slug)
    .first<{ thumbnailKey: string | null }>();
  return thumbnailResponse(request, exam?.thumbnailKey);
}
