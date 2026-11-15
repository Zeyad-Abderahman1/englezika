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
  thumbnailKey?: string | null;
  updatedAt?: number;
  /** 'course' or 'exam' (an exam published as a standalone course). */
  kind?: string;
  /** True when the item is offered to every class. */
  allGrades?: boolean;
  /** Public page slug of an exam listing (only when that page is public). */
  examSlug?: string | null;
};

const CACHE_TTL_MS = 60_000;
let courseListPromise: Promise<PublicCourse[]> | null = null;
let courseListExpiresAt = 0;
const courseDetails = new Map<
  string,
  { promise: Promise<PublicCourse | null>; expiresAt: number }
>();

async function queryPublishedCourses(): Promise<PublicCourse[]> {
  const result = await getDatabase()
    .prepare(
      `SELECT c.id, c.title AS month, c.grade, c.description, c.price,
       c.thumbnail_key AS thumbnailKey,
       c.updated_at AS updatedAt,
       c.kind AS kind, c.audience_all_grades AS allGrades,
       (SELECT x.public_slug FROM exams x
        WHERE x.listing_course_id = c.id AND x.published_as_course = true AND x.is_public = true
        LIMIT 1) AS examSlug,
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
       c.thumbnail_key AS thumbnailKey,
       c.updated_at AS updatedAt,
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
  if (courseListPromise && Date.now() >= courseListExpiresAt) courseListPromise = null;
  if (!courseListPromise) {
    courseListExpiresAt = Date.now() + CACHE_TTL_MS;
    courseListPromise = queryPublishedCourses().catch((error) => {
      courseListPromise = null;
      courseListExpiresAt = 0;
      throw error;
    });
  }
  return courseListPromise;
}

export async function getCachedPublishedCourse(id: string) {
  const existing = courseDetails.get(id);
  if (existing && Date.now() < existing.expiresAt) return existing.promise;

  const promise = queryPublishedCourse(id).catch((error) => {
      courseDetails.delete(id);
      throw error;
    });
  courseDetails.set(id, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  return promise;
}

export function invalidatePublicCourseCache() {
  courseListPromise = null;
  courseListExpiresAt = 0;
  courseDetails.clear();
}
