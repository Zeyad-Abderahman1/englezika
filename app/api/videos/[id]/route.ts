import { ensureDatabase } from "../../../../db/runtime";
import { apiVerifiedUser, isResponse } from "../../../lib/api-auth";
import { getD1, getVideoBucket } from "../../../lib/platform";
import { jsonError } from "../../../lib/security";

type VideoRow = {
  id: string; courseId: string; r2Key: string; contentType: string; title: string;
  prerequisiteExamId: string | null; minimumScore: number;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  await ensureDatabase();
  const { id } = await params;
  const db = getD1();
  const video = await db.prepare(
    `SELECT id, course_id AS courseId, r2_key AS r2Key, content_type AS contentType, title,
     prerequisite_exam_id AS prerequisiteExamId, minimum_score AS minimumScore
     FROM videos WHERE id = ? AND status = 'published'`
  ).bind(id).first<VideoRow>();
  if (!video) return jsonError("الفيديو غير موجود", 404);
  const email = user.email.toLowerCase();
  const enrollment = await db.prepare(
    "SELECT id FROM enrollments WHERE user_email = ? AND course_id = ? AND status = 'approved' LIMIT 1"
  ).bind(email, video.courseId).first();
  if (!enrollment) return jsonError("هذا الفيديو متاح للمشتركين فقط", 403);
  if (video.prerequisiteExamId) {
    const passed = await db.prepare(
      `SELECT id FROM attempts WHERE exam_id = ? AND user_email = ?
       AND (CASE WHEN max_score > 0 THEN score * 100.0 / max_score ELSE 0 END) >= ?
       LIMIT 1`,
    ).bind(video.prerequisiteExamId, email, video.minimumScore).first();
    if (!passed) {
      return Response.json(
        { error: "يجب اجتياز اختبار المحاضرة أولاً", code: "LESSON_QUIZ_REQUIRED", examId: video.prerequisiteExamId },
        { status: 403 },
      );
    }
  }
  const bucket = getVideoBucket();
  const rangeHeader = request.headers.get("range");
  let object: R2ObjectBody | null;
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const metadata = await bucket.head(video.r2Key);
    if (!metadata || start >= metadata.size) return new Response(null, { status: 416 });
    const requestedEnd = match[2] ? Number(match[2]) : metadata.size - 1;
    const end = Math.min(requestedEnd, metadata.size - 1);
    object = await bucket.get(video.r2Key, { range: { offset: start, length: end - start + 1 } });
    if (!object) return jsonError("تعذر تحميل الفيديو", 404);
    const headers = new Headers({
      "content-type": video.contentType,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${metadata.size}`,
      "accept-ranges": "bytes",
      "cache-control": "private, no-store, max-age=0",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    });
    return new Response(object.body, { status: 206, headers });
  }
  object = await bucket.get(video.r2Key);
  if (!object) return jsonError("تعذر تحميل الفيديو", 404);
  const headers = new Headers({
    "content-type": video.contentType,
    "content-length": String(object.size),
    "accept-ranges": "bytes",
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
  });
  return new Response(object.body, { status: 200, headers });
}
