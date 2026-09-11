import { getDatabase, getPrivateStorage } from '../platform';
import { safeInteger, safeText } from '../security';
import { invalidatePublicCourseCache } from '../public-course-cache';
import { recordAuditLog } from '../audit';
import { captureException } from '../observability';
import { extractYouTubeId } from '../youtube';
import {
  buildLectureQRUrl,
  generateLectureQRToken,
  hashLectureQRToken,
  lectureQRCodeSuffix,
  normalizeLectureQRToken,
} from '../lecture-access-codes';
import {
  isPdfUpload,
  MAX_MATERIAL_SIZE,
} from '../upload-validation';
import { DomainError, type ServiceContext, type OperatorIdentity } from './types';

export interface CreateLectureInput {
  courseId?: unknown;
  title?: unknown;
  youtubeUrl?: unknown;
  durationSeconds?: unknown;
  prerequisiteExamId?: unknown;
  minimumScore?: unknown;
  maxViews?: unknown;
  status?: unknown;
}

export interface UpdateLectureInput {
  title?: unknown;
  prerequisiteExamId?: unknown;
  minimumScore?: unknown;
  maxViews?: unknown;
  status?: unknown;
}

export interface UploadMaterialFileInput {
  name: string;
  type?: string;
  bytes: ArrayBuffer;
}

export class LectureService {
  async createLecture(
    input: CreateLectureInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; id: string }> {
    const courseId = safeText(input.courseId, 80);
    const title = safeText(input.title, 150);
    const durationSeconds = safeInteger(input.durationSeconds, 0, 0, 100_000);
    const prerequisiteExamId = safeText(input.prerequisiteExamId, 80) || null;
    const minimumScore = prerequisiteExamId ? safeInteger(input.minimumScore, 0, 0, 100) : 0;
    const maxViews = safeInteger(input.maxViews, 0, 0, 1000);
    const youtubeId = extractYouTubeId(safeText(input.youtubeUrl, 500));

    if (!courseId || title.length < 2 || !youtubeId) {
      throw new DomainError('اختر الكورس وأدخل عنوانًا ورابط YouTube صحيحًا', 400);
    }

    const db = context?.db ?? getDatabase();
    const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) {
      throw new DomainError('الكورس غير موجود', 404);
    }

    if (prerequisiteExamId) {
      const prerequisite = await db
        .prepare('SELECT id FROM exams WHERE id = ? AND course_id = ?')
        .bind(prerequisiteExamId, courseId)
        .first();
      if (!prerequisite) {
        throw new DomainError('اختبار المتطلب غير موجود داخل هذا الكورس', 400);
      }
    }

    const id = crypto.randomUUID();
    const sourceUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    const status = input.status === 'draft' ? 'draft' : 'published';

    await db
      .prepare(
        `INSERT INTO videos
         (id, course_id, title, source_type, source_url, youtube_id, duration_seconds,
          prerequisite_exam_id, minimum_score, max_views, status, created_at)
         VALUES (?, ?, ?, 'youtube', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        courseId,
        title,
        sourceUrl,
        youtubeId,
        durationSeconds,
        prerequisiteExamId,
        minimumScore,
        maxViews || null,
        status,
        Date.now()
      )
      .run();

    invalidatePublicCourseCache();
    return { ok: true, id };
  }

  async updateLecture(
    id: string,
    input: UpdateLectureInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();

    const existing = await db
      .prepare(
        `SELECT id, course_id AS courseId, prerequisite_exam_id AS prerequisiteExamId,
         minimum_score AS minimumScore, max_views AS maxViews FROM videos WHERE id = ?`
      )
      .bind(id)
      .first<{
        id: string;
        courseId: string;
        prerequisiteExamId: string | null;
        minimumScore: number;
        maxViews: number | null;
      }>();

    if (!existing) {
      throw new DomainError('الفيديو غير موجود', 404);
    }

    const title = safeText(input.title ?? '', 150);
    if (title.length < 2) {
      throw new DomainError('عنوان الفيديو مطلوب', 400);
    }

    const changesPrerequisite = Object.prototype.hasOwnProperty.call(input, 'prerequisiteExamId');
    const prerequisiteExamId = changesPrerequisite
      ? safeText(input.prerequisiteExamId, 80) || null
      : existing.prerequisiteExamId;

    const minimumScore = prerequisiteExamId
      ? Object.prototype.hasOwnProperty.call(input, 'minimumScore')
        ? safeInteger(input.minimumScore, 0, 0, 100)
        : existing.minimumScore
      : 0;

    if (prerequisiteExamId) {
      const prerequisite = await db
        .prepare('SELECT id FROM exams WHERE id = ? AND course_id = ?')
        .bind(prerequisiteExamId, existing.courseId)
        .first();
      if (!prerequisite) {
        throw new DomainError('اختبار المتطلب غير موجود داخل هذا الكورس', 400);
      }
    }

    const status = input.status === 'draft' ? 'draft' : 'published';
    const maxViews = Object.prototype.hasOwnProperty.call(input, 'maxViews')
      ? safeInteger(input.maxViews, 0, 0, 1000)
      : existing.maxViews;

    await db
      .prepare(
        'UPDATE videos SET title = ?, prerequisite_exam_id = ?, minimum_score = ?, max_views = ?, status = ? WHERE id = ?'
      )
      .bind(title, prerequisiteExamId, minimumScore, maxViews || null, status, id)
      .run();

    invalidatePublicCourseCache();
    return { ok: true };
  }

  async deleteLecture(
    id: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();

    const video = await db
      .prepare('SELECT id, course_id AS courseId, title FROM videos WHERE id = ?')
      .bind(id)
      .first<{ id: string; courseId: string; title: string }>();

    if (!video) {
      throw new DomainError('المحاضرة غير موجودة', 404);
    }

    const materials = await db
      .prepare('SELECT id, file_key AS fileKey FROM lecture_materials WHERE video_id = ?')
      .bind(id)
      .all<{ id: string; fileKey?: string | null }>()
      .catch(() => ({ results: [] as { id: string; fileKey?: string | null }[] }));

    const filesToDelete = new Set<string>();
    for (const m of materials.results) {
      if (m.fileKey) filesToDelete.add(m.fileKey);
    }

    try {
      await db.batch([
        // 1. Notification reads
        db
          .prepare("DELETE FROM notification_reads WHERE notification_type = 'video' AND notification_id = ?")
          .bind(id),
        // 2. Course items
        db.prepare('DELETE FROM course_items WHERE video_id = ?').bind(id),
        // 3. Student video progress
        db.prepare('DELETE FROM video_progress WHERE video_id = ?').bind(id),
        // 4. View sessions
        db.prepare('DELETE FROM video_view_sessions WHERE video_id = ?').bind(id),
        // 5. Access grants
        db.prepare('DELETE FROM student_video_access_grants WHERE video_id = ?').bind(id),
        // 6. Access codes
        db.prepare('DELETE FROM lecture_access_codes WHERE video_id = ?').bind(id),
        // 7. Access code batches
        db.prepare('DELETE FROM access_code_batches WHERE video_id = ?').bind(id),
        // 8. Lecture materials
        db.prepare('DELETE FROM lecture_materials WHERE video_id = ?').bind(id),
        // 9. Video record itself
        db.prepare('DELETE FROM videos WHERE id = ?').bind(id),
      ]);
    } catch (error) {
      captureException(error, { module: 'admin-video-force-delete', videoId: id });
      throw new DomainError('فشل حذف المحاضرة وبياناتها التابعة.', 500);
    }

    const storage = context?.storage ?? getPrivateStorage();
    for (const key of filesToDelete) {
      try {
        await storage.delete(key);
      } catch (storageError) {
        captureException(storageError, { module: 'video-delete-storage', storageKey: key, videoId: id });
      }
    }

    await recordAuditLog({
      userEmail: operator.email,
      action: 'video.force_deleted',
      resource: 'video',
      resourceId: id,
      details: { courseId: video.courseId, title: video.title },
      request: context?.request,
    });

    invalidatePublicCourseCache();
    return { ok: true };
  }

  async getMaterials(
    videoId: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ materials: Array<{ id: string; storageKey: string; fileName: string; fileSize: number; createdAt: number }> }> {
    const db = context?.db ?? getDatabase();
    const materials = await db
      .prepare(
        `SELECT id, file_key AS storageKey, title AS fileName,
                file_size AS fileSize, created_at AS createdAt
         FROM lecture_materials WHERE video_id = ? ORDER BY created_at`
      )
      .bind(videoId)
      .all<{ id: string; storageKey: string; fileName: string; fileSize: number; createdAt: number }>();

    return { materials: materials.results };
  }

  async uploadMaterials(
    videoId: string,
    files: UploadMaterialFileInput[],
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; materials: Array<{ id: string; fileName: string; fileSize: number }> }> {
    const db = context?.db ?? getDatabase();
    const video = await db
      .prepare('SELECT id, course_id AS courseId FROM videos WHERE id = ?')
      .bind(videoId)
      .first<{ id: string; courseId: string }>();

    if (!video) {
      throw new DomainError('المحاضرة غير موجودة', 404);
    }

    if (files.length === 0) {
      throw new DomainError('لم يتم اختيار ملف', 400);
    }

    const storage = context?.storage ?? getPrivateStorage();
    const now = Date.now();
    const created: Array<{ id: string; fileName: string; fileSize: number }> = [];

    for (const file of files) {
      const mimeType = file.type || 'application/pdf';

      if (file.bytes.byteLength > MAX_MATERIAL_SIZE) {
        throw new DomainError(`حجم الملف "${file.name}" يتجاوز الحد الأقصى (25 ميجابايت)`, 400);
      }
      if (!isPdfUpload(mimeType, file.bytes)) {
        throw new DomainError(`الملف "${file.name}" يجب أن يكون PDF صالح`, 400);
      }

      const materialId = crypto.randomUUID();
      const storageKey = `videos/${videoId}/materials/${materialId}.pdf`;
      await storage.put(storageKey, new Uint8Array(file.bytes), {
        httpMetadata: { contentType: 'application/pdf' },
      });

      const safeName =
        file.name
          .replace(/\.pdf$/i, '')
          .replace(/[\r\n\0]/g, '')
          .slice(0, 200)
          .trim() || 'تحميل المحاضرة';

      try {
        await db
          .prepare(
            `INSERT INTO lecture_materials (id, video_id, title, file_key, mime_type, file_size, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(materialId, videoId, safeName, storageKey, 'application/pdf', file.bytes.byteLength, now)
          .run();
      } catch (dbError) {
        await storage.delete(storageKey).catch(() => {});
        captureException(dbError, { module: 'admin-video-materials-upload-db', videoId, storageKey });
        throw new DomainError('تعذر رفع الملف', 500);
      }

      created.push({ id: materialId, fileName: safeName, fileSize: file.bytes.byteLength });
    }

    return { ok: true, materials: created };
  }

  async deleteMaterials(
    videoId: string,
    materialId: string | null,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();
    const storage = context?.storage ?? getPrivateStorage();

    if (materialId) {
      const material = await db
        .prepare('SELECT id, file_key AS storageKey FROM lecture_materials WHERE id = ? AND video_id = ?')
        .bind(materialId, videoId)
        .first<{ id: string; storageKey: string }>();

      if (!material) {
        throw new DomainError('لا توجد مادة مرفقة', 404);
      }

      await storage.delete(material.storageKey).catch(() => {});
      await db.prepare('DELETE FROM lecture_materials WHERE id = ?').bind(material.id).run();
    } else {
      const materials = await db
        .prepare('SELECT id, file_key AS storageKey FROM lecture_materials WHERE video_id = ?')
        .bind(videoId)
        .all<{ id: string; storageKey: string }>();

      for (const m of materials.results) {
        await storage.delete(m.storageKey).catch(() => {});
      }
      await db.prepare('DELETE FROM lecture_materials WHERE video_id = ?').bind(videoId).run();
    }

    return { ok: true };
  }

  async createLectureQR(
    videoId: string,
    origin: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ token: string; url: string; displaySuffix: string; createdAt: number }> {
    const cleanId = safeText(videoId, 80);
    if (!cleanId) {
      throw new DomainError('المحاضرة غير صالحة', 400);
    }

    const db = context?.db ?? getDatabase();
    const video = await db
      .prepare('SELECT id, course_id AS courseId FROM videos WHERE id = ?')
      .bind(cleanId)
      .first<{ id: string; courseId: string }>();

    if (!video) {
      throw new DomainError('المحاضرة غير موجودة', 404);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = generateLectureQRToken();
      const normalized = normalizeLectureQRToken(token);
      if (!normalized) throw new Error('Generated lecture QR token did not pass validation');
      const codeHash = await hashLectureQRToken(normalized);
      const suffix = lectureQRCodeSuffix(normalized);
      const createdAt = Date.now();
      const inserted = await db
        .prepare(
          `INSERT INTO lecture_access_codes
            (id, code_hash, display_suffix, course_id, video_id, created_by_staff_email, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(code_hash) DO NOTHING RETURNING id`
        )
        .bind(
          crypto.randomUUID(),
          codeHash,
          suffix,
          video.courseId,
          video.id,
          operator.email.toLowerCase(),
          createdAt
        )
        .first<{ id: string }>();
      if (!inserted) continue;

      await recordAuditLog({
        userEmail: operator.email,
        action: 'lecture_qr.created',
        resource: 'video',
        resourceId: video.id,
        details: { courseId: video.courseId },
        request: context?.request,
      });

      const url = buildLectureQRUrl(token, origin);
      return {
        token,
        url,
        displaySuffix: suffix,
        createdAt,
      };
    }

    throw new DomainError('تعذر إنشاء رمز QR آمن الآن. حاول مرة أخرى.', 503);
  }
}

export const lectureService = new LectureService();
