import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getPrivateStorage } from '../../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import {
  hasAllowedContentLength,
  isPdfUpload,
  MAX_MATERIAL_SIZE,
  MAX_MATERIAL_UPLOAD_BODY_SIZE,
} from '../../../../../lib/upload-validation';
import { lectureService } from '../../../../../lib/services/lecture-service';
import { DomainError } from '../../../../../lib/services/types';

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

  try {
    const result = await lectureService.getMaterials(id, staff, { request: _request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر جلب ملفات المحاضرة', 500);
  }
}

/**
 * POST /api/admin/videos/[id]/materials
 * Upload one or more lecture material PDFs for a video.
 * Enforces isPdfUpload and MAX_MATERIAL_SIZE validation.
 * Uses private storage getPrivateStorage() stored at `videos/${id}/materials/`.
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

  const contentType = request.headers.get('content-type') || '';
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedContentType !== 'multipart/form-data') {
    return jsonError('يجب رفع ملف عبر form-data', 400);
  }
  if (!hasAllowedContentLength(request, MAX_MATERIAL_UPLOAD_BODY_SIZE)) {
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

  try {
    const filePayloads = await Promise.all(
      validFiles.map(async (f) => {
        const bytes = await f.arrayBuffer();
        if (bytes.byteLength > MAX_MATERIAL_SIZE) {
          throw new DomainError(`حجم الملف "${f.name}" يتجاوز الحد الأقصى (25 ميجابايت)`, 400);
        }
        if (!isPdfUpload(f.type || 'application/pdf', bytes)) {
          throw new DomainError(`الملف "${f.name}" يجب أن يكون PDF صالح`, 400);
        }
        return {
          name: f.name,
          type: f.type,
          bytes,
        };
      })
    );

    const result = await lectureService.uploadMaterials(id, filePayloads, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر رفع الملف', 500);
  }
}

/**
 * DELETE /api/admin/videos/[id]/materials?id=xxx
 * Delete a specific material by ID, or all materials for the video if no ID provided.
 * Uses getPrivateStorage() where storage.delete cleans up storage files.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await apiStaff(request, 'manage_videos');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  const url = new URL(request.url);
  const materialId = url.searchParams.get('id');

  // lectureService handles DB deletion and storage.delete for all material files
  try {
    const result = await lectureService.deleteMaterials(id, materialId, staff, { request });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DomainError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر حذف الملف', 500);
  }
}
