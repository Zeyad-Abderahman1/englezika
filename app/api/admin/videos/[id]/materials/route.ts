import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getDatabase } from '../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../lib/private-storage';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import {
  hasAllowedContentLength,
  isPdfUpload,
  MAX_PDF_SIZE,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../../../lib/upload-validation';

/**
 * GET /api/admin/videos/[id]/materials
 * List all materials for a video.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await apiStaff(_request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const db = getDatabase();

  const materials = await db
    .prepare(
      `SELECT id, storage_key AS storageKey, file_name AS fileName,
              file_size AS fileSize, created_at AS createdAt, updated_at AS updatedAt
       FROM lecture_materials WHERE video_id = ? ORDER BY created_at`
    )
    .bind(id)
    .all<{ id: string; storageKey: string; fileName: string; fileSize: number; createdAt: number; updatedAt: number }>();

  return Response.json({ materials: materials.results });
}

/**
 * POST /api/admin/videos/[id]/materials
 * Upload one or more lecture material PDFs for a video.
 * Accepts multipart/form-data with one or more 'files' fields.
 * Only staff with manage_videos may call this.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const db = getDatabase();

  const video = await db
    .prepare('SELECT id, course_id AS courseId FROM videos WHERE id = ?')
    .bind(id)
    .first<{ id: string; courseId: string }>();
  if (!video) return jsonError('المحاضرة غير موجودة', 404);

  const contentType = request.headers.get('content-type') || '';
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedContentType !== 'multipart/form-data') {
    return jsonError('يجب رفع ملف عبر form-data', 400);
  }
  if (!hasAllowedContentLength(request, MAX_UPLOAD_BODY_SIZE)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError('تعذر قراءة الملف', 400);

  const files = formData.getAll('files');
  const validFiles = files.filter((f): f is File => f instanceof File);

  if (validFiles.length === 0) {
    const singleFile = formData.get('file');
    if (singleFile instanceof File) {
      validFiles.push(singleFile);
    }
  }

  if (validFiles.length === 0) {
    return jsonError('لم يتم اختيار ملف', 400);
  }

  const storage = getPrivateStorage();
  const now = Date.now();
  const created: Array<{ id: string; fileName: string; fileSize: number }> = [];

  for (const file of validFiles) {
    const mimeType = file.type || 'application/pdf';
    const fileBytes = await file.arrayBuffer();

    if (fileBytes.byteLength > MAX_PDF_SIZE) {
      return jsonError(`حجم الملف "${file.name}" يتجاوز الحد الأقصى (25 ميجابايت)`, 400);
    }
    if (!isPdfUpload(mimeType, fileBytes)) {
      return jsonError(`الملف "${file.name}" يجب أن يكون PDF صالح`, 400);
    }

    const materialId = crypto.randomUUID();
    const storageKey = `videos/${id}/materials/${materialId}.pdf`;
    await storage.put(storageKey, new Uint8Array(fileBytes), {
      httpMetadata: { contentType: 'application/pdf' },
    });

    const safeName = file.name.replace(/\.pdf$/i, '').slice(0, 200) || 'تحميل المحاضرة';

    await db
      .prepare(
        `INSERT INTO lecture_materials (id, video_id, storage_key, file_name, file_size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(materialId, id, storageKey, safeName, fileBytes.byteLength, now, now)
      .run();

    created.push({ id: materialId, fileName: safeName, fileSize: fileBytes.byteLength });
  }

  return Response.json({ ok: true, materials: created });
}

/**
 * DELETE /api/admin/videos/[id]/materials?id=xxx
 * Delete a specific material by ID, or all materials for the video if no ID provided.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const db = getDatabase();

  const url = new URL(request.url);
  const materialId = url.searchParams.get('id');

  const storage = getPrivateStorage();

  if (materialId) {
    const material = await db
      .prepare('SELECT id, storage_key AS storageKey FROM lecture_materials WHERE id = ? AND video_id = ?')
      .bind(materialId, id)
      .first<{ id: string; storageKey: string }>();
    if (!material) return jsonError('لا توجد مادة مرفقة', 404);

    await storage.delete(material.storageKey).catch(() => {});
    await db.prepare('DELETE FROM lecture_materials WHERE id = ?').bind(material.id).run();
  } else {
    const materials = await db
      .prepare('SELECT id, storage_key AS storageKey FROM lecture_materials WHERE video_id = ?')
      .bind(id)
      .all<{ id: string; storageKey: string }>();

    for (const m of materials.results) {
      await storage.delete(m.storageKey).catch(() => {});
    }
    await db.prepare('DELETE FROM lecture_materials WHERE video_id = ?').bind(id).run();
  }

  return Response.json({ ok: true });
}
