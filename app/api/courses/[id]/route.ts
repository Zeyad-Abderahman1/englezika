import { ensureDatabase } from "../../../../db/runtime";
import { getD1 } from "../../../lib/platform";
import { jsonError } from "../../../lib/security";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureDatabase();
  const { id } = await params;
  const course = await getD1().prepare(
    `SELECT c.id, c.title AS month, c.grade, c.description, c.price,
     CASE WHEN c.status = 'published' THEN 1 ELSE 0 END AS available,
     (SELECT COUNT(*) FROM videos v WHERE v.course_id = c.id AND v.status = 'published') AS lectures,
     (SELECT COUNT(*) FROM exams x WHERE x.course_id = c.id AND x.status = 'published') AS exams
     FROM courses c WHERE c.id = ? AND c.status = 'published'`
  ).bind(id).first();
  return course ? Response.json({ course }) : jsonError("الكورس غير موجود", 404);
}
