import { getDatabase, getPrivateStorage } from '../platform';
import { safeInteger, safeText } from '../security';
import { invalidatePublicCourseCache } from '../public-course-cache';
import { recordAuditLog } from '../audit';
import { captureException } from '../observability';
import {
  saveCourseSequence,
  getCourseItems,
  type CourseItemType,
} from '../course-sequence';
import { getCourseThumbnailUrl } from '../course-thumbnail';
import {
  isImageUpload,
  getImageExtension,
  getImageDimensions,
  hasReasonableCourseThumbnailDimensions,
  MAX_IMAGE_SIZE,
} from '../upload-validation';
import { DomainError, type ServiceContext, type OperatorIdentity } from './types';

export interface CreateCourseInput {
  title?: unknown;
  grade?: unknown;
  description?: unknown;
  price?: unknown;
  status?: unknown;
}

export interface UpdateCourseInput {
  title?: unknown;
  grade?: unknown;
  description?: unknown;
  price?: unknown;
  status?: unknown;
}

export interface SequenceItemInput {
  itemType: CourseItemType;
  videoId?: string;
  examId?: string;
  assignmentId?: string;
}

const VALID_SEQUENCE_TYPES = new Set(['video', 'exam', 'assignment']);

export class CourseService {
  async createCourse(
    input: CreateCourseInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; id: string; title: string }> {
    const title = safeText(input.title, 120);
    const grade = safeText(input.grade, 80);
    const description = safeText(input.description, 1000);
    const price = safeInteger(input.price, 0, 0, 100_000);
    const status = input.status === 'published' ? 'published' : 'draft';

    if (title.length < 3 || grade.length < 2) {
      throw new DomainError('اسم الكورس والصف مطلوبان', 400);
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const db = context?.db ?? getDatabase();

    try {
      await db
        .prepare(
          `INSERT INTO courses (id, title, grade, description, price, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, title, grade, description, price, status, now, now)
        .run();
      invalidatePublicCourseCache();
    } catch {
      throw new DomainError('تعذر إضافة الكورس، حاول مرة أخرى', 500);
    }

    return { ok: true, id, title };
  }

  async updateCourse(
    id: string,
    input: UpdateCourseInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();

    const existing = await db
      .prepare('SELECT id, title, grade, description, price, status FROM courses WHERE id = ?')
      .bind(id)
      .first<{ id: string; title: string; grade: string; description: string; price: number; status: string }>();

    if (!existing) {
      throw new DomainError('الكورس غير موجود', 404);
    }

    const title = input.title !== undefined ? safeText(input.title, 120) : existing.title;
    const grade = input.grade !== undefined ? safeText(input.grade, 80) : existing.grade;
    const description = input.description !== undefined ? safeText(input.description, 1000) : existing.description;
    const price = input.price !== undefined ? safeInteger(input.price, existing.price, 0, 100_000) : existing.price;
    const status = input.status !== undefined
      ? (input.status === 'published' ? 'published' : 'draft')
      : existing.status;

    if (title.length < 3 || grade.length < 2) {
      throw new DomainError('بيانات الكورس غير مكتملة', 400);
    }

    const result = await db
      .prepare(
        `UPDATE courses SET title = ?, grade = ?, description = ?, price = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(title, grade, description, price, status, Date.now(), id)
      .run();

    if (result.meta.changes !== 1) {
      throw new DomainError('الكورس غير موجود', 404);
    }

    invalidatePublicCourseCache();
    return { ok: true };
  }

  async deleteCourse(
    id: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();

    const course = await db
      .prepare('SELECT id, title, thumbnail_key AS thumbnailKey FROM courses WHERE id = ?')
      .bind(id)
      .first<{ id: string; title: string; thumbnailKey: string | null }>();

    if (!course) {
      throw new DomainError('الكورس غير موجود', 404);
    }

    // Collect any attached files to clean up from storage after successful commit
    const filesToDelete = new Set<string>();
    if (course.thumbnailKey) {
      filesToDelete.add(course.thumbnailKey);
    }

    const [examFiles, questionFiles, attemptFiles, materialFiles, assignmentFiles, subFiles, assignQFiles] =
      await Promise.all([
        db
          .prepare('SELECT teacher_file_key AS key FROM exams WHERE course_id = ? AND teacher_file_key IS NOT NULL')
          .bind(id)
          .all<{ key: string }>()
          .catch(() => ({ results: [] as { key: string }[] })),
        db
          .prepare(
            'SELECT image_file_key AS key FROM questions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?) AND image_file_key IS NOT NULL'
          )
          .bind(id)
          .all<{ key: string }>()
          .catch(() => ({ results: [] as { key: string }[] })),
        db
          .prepare(
            'SELECT pdf_storage_key AS key FROM attempts WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?) AND pdf_storage_key IS NOT NULL'
          )
          .bind(id)
          .all<{ key: string }>()
          .catch(() => ({ results: [] as { key: string }[] })),
        db
          .prepare(
            'SELECT file_key AS key FROM lecture_materials WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?) AND file_key IS NOT NULL'
          )
          .bind(id)
          .all<{ key: string }>()
          .catch(() => ({ results: [] as { key: string }[] })),
        db
          .prepare('SELECT teacher_file_key AS key FROM assignments WHERE course_id = ? AND teacher_file_key IS NOT NULL')
          .bind(id)
          .all<{ key: string }>()
          .catch(() => ({ results: [] as { key: string }[] })),
        db
          .prepare(
            'SELECT pdf_storage_key AS key FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?) AND pdf_storage_key IS NOT NULL'
          )
          .bind(id)
          .all<{ key: string }>()
          .catch(() => ({ results: [] as { key: string }[] })),
        db
          .prepare(
            'SELECT image_file_key AS key FROM assignment_questions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?) AND image_file_key IS NOT NULL'
          )
          .bind(id)
          .all<{ key: string }>()
          .catch(() => ({ results: [] as { key: string }[] })),
      ]);

    for (const group of [examFiles, questionFiles, attemptFiles, materialFiles, assignmentFiles, subFiles, assignQFiles]) {
      for (const row of group.results) {
        if (row.key) filesToDelete.add(row.key);
      }
    }

    try {
      await db.batch([
        // 1. Course Sequence Items
        db.prepare('DELETE FROM course_items WHERE course_id = ?').bind(id),

        // 2. Exams, Quizzes and dependent assessments
        db
          .prepare(
            'UPDATE videos SET prerequisite_exam_id = NULL, minimum_score = 0 WHERE prerequisite_exam_id IN (SELECT id FROM exams WHERE course_id = ?)'
          )
          .bind(id),
        db
          .prepare(
            "DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id IN (SELECT id FROM exams WHERE course_id = ?)"
          )
          .bind(id),
        db
          .prepare('DELETE FROM exam_sessions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?)')
          .bind(id),
        db
          .prepare(
            `DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?))
             OR question_id IN (SELECT id FROM questions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?))`
          )
          .bind(id, id),
        db
          .prepare('DELETE FROM attempts WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?)')
          .bind(id),
        db
          .prepare('DELETE FROM questions WHERE exam_id IN (SELECT id FROM exams WHERE course_id = ?)')
          .bind(id),
        db.prepare('DELETE FROM exams WHERE course_id = ?').bind(id),

        // 3. Videos, Lectures, and dependent records
        db
          .prepare(
            "DELETE FROM notification_reads WHERE notification_type = 'video' AND notification_id IN (SELECT id FROM videos WHERE course_id = ?)"
          )
          .bind(id),
        db
          .prepare('DELETE FROM video_progress WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
          .bind(id),
        db
          .prepare('DELETE FROM video_view_sessions WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
          .bind(id),
        db
          .prepare('DELETE FROM student_video_access_grants WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
          .bind(id),
        db
          .prepare(
            'DELETE FROM lecture_access_codes WHERE course_id = ? OR video_id IN (SELECT id FROM videos WHERE course_id = ?)'
          )
          .bind(id, id),
        db
          .prepare(
            'DELETE FROM access_code_batches WHERE course_id = ? OR video_id IN (SELECT id FROM videos WHERE course_id = ?)'
          )
          .bind(id, id),
        db
          .prepare('DELETE FROM lecture_materials WHERE video_id IN (SELECT id FROM videos WHERE course_id = ?)')
          .bind(id),
        db.prepare('DELETE FROM videos WHERE course_id = ?').bind(id),

        // 4. Assignments and submissions
        db
          .prepare(
            "DELETE FROM notification_reads WHERE notification_type = 'assignment' AND notification_id IN (SELECT id FROM assignments WHERE course_id = ?)"
          )
          .bind(id),
        db
          .prepare('DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?)')
          .bind(id),
        db
          .prepare('DELETE FROM assignment_questions WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?)')
          .bind(id),
        db.prepare('DELETE FROM assignments WHERE course_id = ?').bind(id),

        // 5. Enrollments (Note: payment_intents are deliberately PRESERVED for financial audit)
        db.prepare('DELETE FROM enrollments WHERE course_id = ?').bind(id),

        // 6. Course-level notification reads
        db
          .prepare("DELETE FROM notification_reads WHERE notification_type = 'course' AND notification_id = ?")
          .bind(id),

        // 7. Course itself
        db.prepare('DELETE FROM courses WHERE id = ?').bind(id),
      ]);
    } catch (error) {
      captureException(error, { module: 'admin-course-force-delete', courseId: id });
      throw new DomainError('فشل حذف الكورس وبياناته التابعة.', 500);
    }

    // Best-effort storage cleanup after successful DB commit
    const storage = context?.storage ?? getPrivateStorage();
    for (const key of filesToDelete) {
      try {
        await storage.delete(key);
      } catch (storageError) {
        captureException(storageError, { module: 'course-delete-storage', storageKey: key, courseId: id });
      }
    }

    await recordAuditLog({
      userEmail: operator.email,
      action: 'course.force_deleted',
      resource: 'course',
      resourceId: id,
      details: { title: course.title },
      request: context?.request,
    });

    invalidatePublicCourseCache();
    return { ok: true };
  }

  async saveSequence(
    courseId: string,
    items: unknown,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; count: number }> {
    if (!courseId || courseId.length > 80) {
      throw new DomainError('معرف الكورس غير صالح', 400);
    }

    if (!Array.isArray(items)) {
      throw new DomainError('البيانات غير مكتملة', 400);
    }

    if (items.length > 200) {
      throw new DomainError('الحد الأقصى 200 عنصر في تسلسل الكورس', 400);
    }

    const db = context?.db ?? getDatabase();
    const course = await db
      .prepare('SELECT id FROM courses WHERE id = ?')
      .bind(courseId)
      .first();
    if (!course) {
      throw new DomainError('الكورس غير موجود', 404);
    }

    const validatedItems: SequenceItemInput[] = [];
    const seenIds = new Set<string>();

    for (const rawItem of items) {
      const item = rawItem as SequenceItemInput;
      if (!item.itemType || !VALID_SEQUENCE_TYPES.has(item.itemType)) {
        throw new DomainError('نوع العنصر غير صالح', 400);
      }

      let itemId: string | null = null;

      switch (item.itemType) {
        case 'video': {
          if (!item.videoId) throw new DomainError('معرف المحاضرة مطلوب', 400);
          itemId = item.videoId;
          if (seenIds.has(`video:${itemId}`)) {
            throw new DomainError('المحاضرة مكررة في التسلسل', 400);
          }
          seenIds.add(`video:${itemId}`);
          const video = await db
            .prepare('SELECT id FROM videos WHERE id = ? AND course_id = ?')
            .bind(itemId, courseId)
            .first();
          if (!video) throw new DomainError('المحاضرة غير موجودة في هذا الكورس', 400);
          validatedItems.push({ itemType: 'video', videoId: itemId });
          break;
        }
        case 'exam': {
          if (!item.examId) throw new DomainError('معرف الاختبار مطلوب', 400);
          itemId = item.examId;
          if (seenIds.has(`exam:${itemId}`)) {
            throw new DomainError('الاختبار مكرر في التسلسل', 400);
          }
          seenIds.add(`exam:${itemId}`);
          const exam = await db
            .prepare('SELECT id FROM exams WHERE id = ? AND course_id = ?')
            .bind(itemId, courseId)
            .first();
          if (!exam) throw new DomainError('الاختبار غير موجود في هذا الكورس', 400);
          validatedItems.push({ itemType: 'exam', examId: itemId });
          break;
        }
        case 'assignment': {
          if (!item.assignmentId) throw new DomainError('معرف الواجب مطلوب', 400);
          itemId = item.assignmentId;
          if (seenIds.has(`assignment:${itemId}`)) {
            throw new DomainError('الواجب مكرر في التسلسل', 400);
          }
          seenIds.add(`assignment:${itemId}`);
          const assignment = await db
            .prepare('SELECT id FROM assignments WHERE id = ? AND course_id = ?')
            .bind(itemId, courseId)
            .first();
          if (!assignment) throw new DomainError('الواجب غير موجود في هذا الكورس', 400);
          validatedItems.push({ itemType: 'assignment', assignmentId: itemId });
          break;
        }
      }
    }

    try {
      await saveCourseSequence(courseId, validatedItems);
    } catch {
      throw new DomainError('تعذر حفظ التسلسل', 500);
    }

    return { ok: true, count: validatedItems.length };
  }

  async getSequence(
    courseId: string,
    _operator?: OperatorIdentity
  ): Promise<{ ok: true; items: unknown[] }> {
    if (!courseId || courseId.length > 80) {
      throw new DomainError('معرف الكورس غير صالح', 400);
    }

    const items = await getCourseItems(courseId);
    return { ok: true, items };
  }

  async uploadThumbnail(
    courseId: string,
    fileBytes: ArrayBuffer,
    mimeType: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; key: string; url: string }> {
    if (!courseId || courseId.length > 80) {
      throw new DomainError('معرف الكورس غير صالح', 400);
    }

    const db = context?.db ?? getDatabase();
    const course = await db
      .prepare('SELECT id, thumbnail_key AS thumbnailKey FROM courses WHERE id = ?')
      .bind(courseId)
      .first<{ id: string; thumbnailKey: string | null }>();

    if (!course) {
      throw new DomainError('الكورس غير موجود', 404);
    }

    if (fileBytes.byteLength > MAX_IMAGE_SIZE) {
      throw new DomainError('حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت)', 400);
    }

    if (!isImageUpload(mimeType, fileBytes)) {
      throw new DomainError('يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP', 400);
    }

    const dimensions = getImageDimensions(mimeType, fileBytes);
    if (!dimensions || !hasReasonableCourseThumbnailDimensions(dimensions)) {
      throw new DomainError(
        'أبعاد الصورة غير صالحة. تأكد من رفع صورة صحيحة بدقة مناسبة (الحد الأدنى 160×90 بكسل).',
        400
      );
    }

    const storage = context?.storage ?? getPrivateStorage();
    const ext = getImageExtension(mimeType);
    const storageKey = `courses/${courseId}/thumbnail/${crypto.randomUUID()}.${ext}`;

    try {
      await storage.put(storageKey, new Uint8Array(fileBytes), {
        httpMetadata: { contentType: mimeType },
      });
    } catch {
      throw new DomainError('فشل حفظ الصورة في وحدة التخزين', 500);
    }

    try {
      const result = await db
        .prepare('UPDATE courses SET thumbnail_key = ?, updated_at = ? WHERE id = ?')
        .bind(storageKey, Date.now(), courseId)
        .run();

      if (result.meta.changes !== 1) {
        await storage.delete(storageKey).catch(() => {});
        throw new DomainError('الكورس غير موجود أو تعذر تحديثه', 404);
      }
    } catch (err) {
      if (err instanceof DomainError) throw err;
      await storage.delete(storageKey).catch(() => {});
      throw new DomainError('تعذر حفظ صورة الكورس في قاعدة البيانات', 500);
    }

    if (course.thumbnailKey) {
      await storage.delete(course.thumbnailKey).catch(() => {});
    }

    invalidatePublicCourseCache();

    return {
      ok: true,
      key: storageKey,
      url: getCourseThumbnailUrl(courseId, storageKey) || `/api/courses/${courseId}/thumbnail`,
    };
  }

  async deleteThumbnail(
    courseId: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    if (!courseId || courseId.length > 80) {
      throw new DomainError('معرف الكورس غير صالح', 400);
    }

    const db = context?.db ?? getDatabase();
    const course = await db
      .prepare('SELECT id, thumbnail_key AS thumbnailKey FROM courses WHERE id = ?')
      .bind(courseId)
      .first<{ id: string; thumbnailKey: string | null }>();

    if (!course) {
      throw new DomainError('الكورس غير موجود', 404);
    }

    if (course.thumbnailKey) {
      const oldKey = course.thumbnailKey;
      await db
        .prepare('UPDATE courses SET thumbnail_key = NULL, updated_at = ? WHERE id = ?')
        .bind(Date.now(), courseId)
        .run();

      const storage = context?.storage ?? getPrivateStorage();
      await storage.delete(oldKey).catch(() => {});
      invalidatePublicCourseCache();
    }

    return { ok: true };
  }
}

export const courseService = new CourseService();
