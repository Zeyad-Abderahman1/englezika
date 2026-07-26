import { ensureDatabase } from '../../../db/runtime';
import { getD1 } from '../../lib/platform';

export async function GET() {
  await ensureDatabase();
  const result = await getD1()
    .prepare(
      `SELECT c.id, c.title AS month, c.grade, c.description, c.price,
     CASE WHEN c.status = 'published' THEN 1 ELSE 0 END AS available,
     (SELECT COUNT(*) FROM videos v WHERE v.course_id = c.id AND v.status = 'published') AS lectures
     FROM courses c WHERE c.status = 'published' ORDER BY c.created_at DESC`
    )
    .all();
  return Response.json(
    { courses: result.results },
    {
      headers: {
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    }
  );
}
