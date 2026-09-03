import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import {
  saveCourseSequence,
  type CourseItemType,
} from '../../../../../lib/course-sequence';

type SequenceItem = {
  itemType: CourseItemType;
  videoId?: string;
  examId?: string;
  assignmentId?: string;
};

const VALID_TYPES = new Set(['video', 'exam', 'assignment']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const admin = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(admin)) return admin;

  const { id: courseId } = await params;
  if (!courseId || courseId.length > 80) return jsonError('معرف الكورس غير صالح');

  const body = (await request.json().catch(() => ({}))) as {
    items?: SequenceItem[];
  };

  if (!Array.isArray(body.items)) {
    return jsonError('البيانات غير مكتملة');
  }

  if (body.items.length > 200) {
    return jsonError('الحد الأقصى 200 عنصر في تسلسل الكورس');
  }

  const db = getDatabase();
  const course = await db
    .prepare('SELECT id FROM courses WHERE id = ?')
    .bind(courseId)
    .first();
  if (!course) return jsonError('الكورس غير موجود', 404);

  const validatedItems: SequenceItem[] = [];
  const seenIds = new Set<string>();

  for (const item of body.items) {
    if (!item.itemType || !VALID_TYPES.has(item.itemType)) {
      return jsonError('نوع العنصر غير صالح');
    }

    let itemId: string | null = null;

    switch (item.itemType) {
      case 'video': {
        if (!item.videoId) return jsonError('معرف المحاضرة مطلوب');
        itemId = item.videoId;
        if (seenIds.has(`video:${itemId}`)) {
          return jsonError('المحاضرة مكررة في التسلسل');
        }
        seenIds.add(`video:${itemId}`);
        const video = await db
          .prepare('SELECT id FROM videos WHERE id = ? AND course_id = ?')
          .bind(itemId, courseId)
          .first();
        if (!video) return jsonError('المحاضرة غير موجودة في هذا الكورس');
        validatedItems.push({ itemType: 'video', videoId: itemId });
        break;
      }
      case 'exam': {
        if (!item.examId) return jsonError('معرف الاختبار مطلوب');
        itemId = item.examId;
        if (seenIds.has(`exam:${itemId}`)) {
          return jsonError('الاختبار مكرر في التسلسل');
        }
        seenIds.add(`exam:${itemId}`);
        const exam = await db
          .prepare('SELECT id FROM exams WHERE id = ? AND course_id = ?')
          .bind(itemId, courseId)
          .first();
        if (!exam) return jsonError('الاختبار غير موجود في هذا الكورس');
        validatedItems.push({ itemType: 'exam', examId: itemId });
        break;
      }
      case 'assignment': {
        if (!item.assignmentId) return jsonError('معرف الواجب مطلوب');
        itemId = item.assignmentId;
        if (seenIds.has(`assignment:${itemId}`)) {
          return jsonError('الواجب مكرر في التسلسل');
        }
        seenIds.add(`assignment:${itemId}`);
        const assignment = await db
          .prepare('SELECT id FROM assignments WHERE id = ? AND course_id = ?')
          .bind(itemId, courseId)
          .first();
        if (!assignment) return jsonError('الواجب غير موجود في هذا الكورس');
        validatedItems.push({ itemType: 'assignment', assignmentId: itemId });
        break;
      }
    }
  }

  try {
    await saveCourseSequence(courseId, validatedItems);
  } catch {
    return jsonError('تعذر حفظ التسلسل', 500);
  }

  return Response.json({ ok: true, count: validatedItems.length });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await apiStaff(_request, 'manage_courses');
  if (isStaffResponse(admin)) return admin;

  const { id: courseId } = await params;
  if (!courseId || courseId.length > 80) return jsonError('معرف الكورس غير صالح');

  const { getCourseItems } = await import('../../../../../lib/course-sequence');
  const items = await getCourseItems(courseId);

  return Response.json({ ok: true, items });
}
