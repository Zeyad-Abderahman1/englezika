import { getCachedPublishedCourses } from '../../lib/public-course-cache';

export async function GET() {
  const courses = await getCachedPublishedCourses();
  return Response.json(
    { courses },
    {
      headers: {
        'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
      },
    }
  );
}
