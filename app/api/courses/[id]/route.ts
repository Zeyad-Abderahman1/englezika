import { getCachedPublishedCourse } from '../../../lib/public-course-cache';
import { jsonError } from '../../../lib/security';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await getCachedPublishedCourse(id);
  if (!course) return jsonError('الكورس غير موجود', 404);
  return Response.json(
    { course },
    {
      headers: {
        'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
      },
    }
  );
}
