import { getDatabase, getPrivateStorage } from '../platform';
import { safeInteger, safeText } from '../security';
import { recordAuditLog } from '../audit';
import { invalidatePublicCourseCache } from '../public-course-cache';
import { invalidatePublicExamCache } from '../public-exam';
import { ALL_GRADES_LABEL, randomSlugSuffix, slugifyExamTitle } from '../exam-listing';
import {
  getImageDimensions,
  getImageExtension,
  hasReasonableCourseThumbnailDimensions,
  isImageUpload,
  MAX_IMAGE_SIZE,
} from '../upload-validation';
import { DomainError, type OperatorIdentity, type ServiceContext } from './types';

export interface PublishExamListingInput {
  /** Price in EGP. 0 = free. Same rules as the course form (0–100000). */
  price?: unknown;
  /** Short description shown on the listing and the public page. */
  description?: unknown;
  /** Create a shareable public page (default true). */
  isPublic?: unknown;
  /** Show the top-10 leaderboard on the public page (default true). */
  showLeaderboard?: unknown;
}

export interface ExamListingState {
  publishedAsCourse: boolean;
  listingCourseId: string | null;
  publicSlug: string | null;
  isPublic: boolean;
  showLeaderboard: boolean;
  price: number;
  hasThumbnail: boolean;
}

interface ExamRow {
  id: string;
  title: string;
  description: string;
  status: string;
  thumbnailKey: string | null;
  listingCourseId: string | null;
  publicSlug: string | null;
}

const EXAM_COLUMNS = `id, title, description, status, thumbnail_key AS "thumbnailKey",
  listing_course_id AS "listingCourseId", public_slug AS "publicSlug"`;

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

/**
 * ONE place that publishes / unpublishes an exam as a standalone "all classes" course and
 * manages its single thumbnail. Every exam creation path (manual form, OCR, PDF generator,
 * stage-exam generator, AI assistant) and the exam edit screen call these methods.
 */
export class ExamListingService {
  async getState(examId: string, context?: ServiceContext): Promise<ExamListingState> {
    const db = context?.db ?? getDatabase();
    const row = await db
      .prepare(
        `SELECT x.published_as_course AS "publishedAsCourse", x.listing_course_id AS "listingCourseId",
          x.public_slug AS "publicSlug", x.is_public AS "isPublic", x.show_leaderboard AS "showLeaderboard",
          x.thumbnail_key AS "thumbnailKey", COALESCE(c.price, 0) AS price
         FROM exams x LEFT JOIN courses c ON c.id = x.listing_course_id
         WHERE x.id = ?`
      )
      .bind(examId)
      .first<{
        publishedAsCourse: boolean;
        listingCourseId: string | null;
        publicSlug: string | null;
        isPublic: boolean;
        showLeaderboard: boolean;
        thumbnailKey: string | null;
        price: number;
      }>();
    if (!row) throw new DomainError('الامتحان غير موجود', 404);
    return {
      publishedAsCourse: Boolean(row.publishedAsCourse),
      listingCourseId: row.listingCourseId,
      publicSlug: row.publicSlug,
      isPublic: Boolean(row.isPublic),
      showLeaderboard: Boolean(row.showLeaderboard),
      price: Number(row.price),
      hasThumbnail: Boolean(row.thumbnailKey),
    };
  }

  async publishAsCourse(
    examId: string,
    input: PublishExamListingInput,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<ExamListingState & { ok: true }> {
    if (!examId || examId.length > 80) throw new DomainError('معرف الامتحان غير صالح', 400);
    const db = context?.db ?? getDatabase();

    const price = safeInteger(input.price, 0, 0, 100_000);
    const isPublic = asBoolean(input.isPublic, true);
    const showLeaderboard = asBoolean(input.showLeaderboard, true);

    const publish = async (tx: typeof db) => {
      // Lock the exam row so two concurrent publishes cannot create two listings.
      const exam = await tx
        .prepare(`SELECT ${EXAM_COLUMNS} FROM exams WHERE id = ? FOR UPDATE`)
        .bind(examId)
        .first<ExamRow>();
      if (!exam) throw new DomainError('الامتحان غير موجود', 404);

      const title = safeText(exam.title, 120);
      if (title.length < 3) throw new DomainError('عنوان الامتحان قصير جدًا للنشر ككورس', 400);
      const description = safeText(input.description ?? exam.description, 1000);
      const now = Date.now();

      let courseId = exam.listingCourseId;
      const existingCourse = courseId
        ? await tx.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first()
        : null;

      if (courseId && existingCourse) {
        await tx
          .prepare(
            `UPDATE courses SET title = ?, grade = ?, description = ?, price = ?, status = 'published',
              kind = 'exam', audience_all_grades = true, thumbnail_key = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(title, ALL_GRADES_LABEL, description, price, exam.thumbnailKey, now, courseId)
          .run();
      } else {
        courseId = crypto.randomUUID();
        await tx
          .prepare(
            `INSERT INTO courses
             (id, title, grade, description, price, status, kind, audience_all_grades, thumbnail_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'published', 'exam', true, ?, ?, ?)`
          )
          .bind(courseId, title, ALL_GRADES_LABEL, description, price, exam.thumbnailKey, now, now)
          .run();
      }

      let slug = exam.publicSlug;
      if (!slug) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const candidate = slugifyExamTitle(title, randomSlugSuffix());
          const taken = await tx.prepare('SELECT 1 AS found FROM exams WHERE public_slug = ?').bind(candidate).first();
          if (!taken) {
            slug = candidate;
            break;
          }
        }
        if (!slug) slug = slugifyExamTitle(title, crypto.randomUUID().slice(0, 8));
      }

      await tx
        .prepare(
          `UPDATE exams SET status = 'published', published_as_course = true, listing_course_id = ?,
            public_slug = ?, is_public = ?, show_leaderboard = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(courseId, slug, isPublic, showLeaderboard, now, examId)
        .run();

      return { courseId: courseId as string, slug };
    };

    const result = typeof db.withTransaction === 'function' ? await db.withTransaction(publish) : await publish(db);

    invalidatePublicCourseCache();
    invalidatePublicExamCache();
    await recordAuditLog({
      userEmail: operator.email,
      action: 'exam.published_as_course',
      resource: 'exam',
      resourceId: examId,
      details: { price, isPublic, showLeaderboard, listingCourseId: result.courseId },
      request: context?.request,
    });

    return { ok: true, ...(await this.getState(examId, context)) };
  }

  /** Hides the listing and the public page. Attempts, results and enrollments are kept. */
  async unpublish(
    examId: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<ExamListingState & { ok: true }> {
    const db = context?.db ?? getDatabase();
    const exam = await db
      .prepare(`SELECT ${EXAM_COLUMNS} FROM exams WHERE id = ?`)
      .bind(examId)
      .first<ExamRow>();
    if (!exam) throw new DomainError('الامتحان غير موجود', 404);

    const now = Date.now();
    const statements = [
      db.prepare('UPDATE exams SET published_as_course = false, updated_at = ? WHERE id = ?').bind(now, examId),
    ];
    if (exam.listingCourseId) {
      statements.push(
        db.prepare("UPDATE courses SET status = 'draft', updated_at = ? WHERE id = ?").bind(now, exam.listingCourseId)
      );
    }
    await db.batch(statements);

    invalidatePublicCourseCache();
    invalidatePublicExamCache();
    await recordAuditLog({
      userEmail: operator.email,
      action: 'exam.unpublished_as_course',
      resource: 'exam',
      resourceId: examId,
      request: context?.request,
    });
    return { ok: true, ...(await this.getState(examId, context)) };
  }

  /** Updates the settings of an existing listing without changing its publish state. */
  async updateListing(
    examId: string,
    input: PublishExamListingInput,
    operator: OperatorIdentity,
    context?: ServiceContext
  ) {
    const state = await this.getState(examId, context);
    if (!state.publishedAsCourse) {
      throw new DomainError('الامتحان غير منشور ككورس', 409);
    }
    return this.publishAsCourse(
      examId,
      {
        price: input.price ?? state.price,
        description: input.description,
        isPublic: input.isPublic ?? state.isPublic,
        showLeaderboard: input.showLeaderboard ?? state.showLeaderboard,
      },
      operator,
      context
    );
  }

  /**
   * Stores the exam thumbnail ONCE (on the exam). The listing course points at the same
   * key, so there is no second copy. Same validation as the course thumbnail.
   */
  async setThumbnail(
    examId: string,
    fileBytes: ArrayBuffer,
    mimeType: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; key: string; notWidescreen: boolean }> {
    if (!examId || examId.length > 80) throw new DomainError('معرف الامتحان غير صالح', 400);
    const db = context?.db ?? getDatabase();
    const exam = await db
      .prepare(`SELECT ${EXAM_COLUMNS} FROM exams WHERE id = ?`)
      .bind(examId)
      .first<ExamRow>();
    if (!exam) throw new DomainError('الامتحان غير موجود', 404);

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
    const key = `exams/${examId}/thumbnail/${crypto.randomUUID()}.${getImageExtension(mimeType)}`;
    try {
      await storage.put(key, new Uint8Array(fileBytes), { httpMetadata: { contentType: mimeType } });
    } catch {
      throw new DomainError('فشل حفظ الصورة في وحدة التخزين', 500);
    }

    const now = Date.now();
    try {
      const statements = [db.prepare('UPDATE exams SET thumbnail_key = ?, updated_at = ? WHERE id = ?').bind(key, now, examId)];
      if (exam.listingCourseId) {
        statements.push(
          db.prepare('UPDATE courses SET thumbnail_key = ?, updated_at = ? WHERE id = ?').bind(key, now, exam.listingCourseId)
        );
      }
      await db.batch(statements);
    } catch {
      await storage.delete(key).catch(() => {});
      throw new DomainError('تعذر حفظ صورة الامتحان في قاعدة البيانات', 500);
    }

    if (exam.thumbnailKey) await storage.delete(exam.thumbnailKey).catch(() => {});
    invalidatePublicCourseCache();
    invalidatePublicExamCache();

    const ratio = dimensions.width / dimensions.height;
    return { ok: true, key, notWidescreen: Math.abs(ratio - 16 / 9) > 0.15 };
  }

  async deleteThumbnail(examId: string, _operator?: OperatorIdentity, context?: ServiceContext): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();
    const exam = await db
      .prepare(`SELECT ${EXAM_COLUMNS} FROM exams WHERE id = ?`)
      .bind(examId)
      .first<ExamRow>();
    if (!exam) throw new DomainError('الامتحان غير موجود', 404);

    if (exam.thumbnailKey) {
      const now = Date.now();
      const statements = [db.prepare('UPDATE exams SET thumbnail_key = NULL, updated_at = ? WHERE id = ?').bind(now, examId)];
      if (exam.listingCourseId) {
        statements.push(
          db.prepare('UPDATE courses SET thumbnail_key = NULL, updated_at = ? WHERE id = ?').bind(now, exam.listingCourseId)
        );
      }
      await db.batch(statements);
      await (context?.storage ?? getPrivateStorage()).delete(exam.thumbnailKey).catch(() => {});
      invalidatePublicCourseCache();
      invalidatePublicExamCache();
    }
    return { ok: true };
  }
}

export const examListingService = new ExamListingService();
