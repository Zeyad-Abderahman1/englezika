import { getDatabase } from './platform';

export type PublicCourse = {
  id: string;
  month: string;
  grade: string;
  description: string;
  price: number;
  available: number;
  lectures: number;
  exams?: number;
};

let courseListPromise: Promise<PublicCourse[]> | null = null;
const courseDetails = new Map<string, Promise<PublicCourse | null>>();

async function queryPublishedCourses(): Promise<PublicCourse[]> {
  const result = await getDatabase()
    .prepare(
      `SELECT c.id, c.title AS month, c.grade, c.description, c.price,
       CASE WHEN c.status = 'published' THEN 1 ELSE 0 END AS available,
       COUNT(v.id) AS lectures
       FROM courses c
       LEFT JOIN videos v ON v.course_id = c.id AND v.status = 'published'
       WHERE c.status = 'published'
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    )
    .all<PublicCourse>();
  return result.results;
}

async function queryPublishedCourse(id: string): Promise<PublicCourse | null> {
  return getDatabase()
    .prepare(
      `SELECT c.id, c.title AS month, c.grade, c.description, c.price,
       CASE WHEN c.status = 'published' THEN 1 ELSE 0 END AS available,
       (SELECT COUNT(*) FROM videos v
        WHERE v.course_id = c.id AND v.status = 'published') AS lectures,
       (SELECT COUNT(*) FROM exams x
        WHERE x.course_id = c.id AND x.status = 'published') AS exams
       FROM courses c
       WHERE c.id = ? AND c.status = 'published'`
    )
    .bind(id)
    .first<PublicCourse>();
}

export async function getCachedPublishedCourses() {
  courseListPromise ??= queryPublishedCourses().catch((error) => {
    courseListPromise = null;
    throw error;
  });
  return courseListPromise;
}

export async function getCachedPublishedCourse(id: string) {
  let cached = courseDetails.get(id);
  if (!cached) {
    cached = queryPublishedCourse(id).catch((error) => {
      courseDetails.delete(id);
      throw error;
    });
    courseDetails.set(id, cached);
  }
  return cached;
}

export function invalidatePublicCourseCache() {
  courseListPromise = null;
  courseDetails.clear();
}
