import { randomUUID } from 'node:crypto';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getPrivateStorage } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import {
  hasAllowedContentLength,
  isPdfUpload,
} from '../../../../lib/upload-validation';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';

export const runtime = 'nodejs';

const MAX_AI_PDF_SIZE = 10 * 1024 * 1024;
const MAX_AI_UPLOAD_BODY_SIZE = MAX_AI_PDF_SIZE + 256 * 1024;

/**
 * POST /api/admin/ai/upload
 *
 * Secure temporary upload endpoint for AI PDF parsing.
 * - Authenticated staff only ('manage_exams')
 * - Validates PDF magic bytes and file size
 * - Stores in private storage under ai_temp/
 * - Returns ONLY tempFileId (random UUID) and metadata
 * - Zero public URLs, filesystem paths, or raw text returned.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const config = loadAiServerConfig();
  if (!config.enabled) {
    return jsonError('خدمة المساعد الذكي غير مفعلة حالياً على الخادم', 403);
  }

  const contentType = request.headers.get('content-type') || '';
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedContentType !== 'multipart/form-data') {
    return jsonError('يجب رفع الملف عبر form-data', 400);
  }

  if (!hasAllowedContentLength(request, MAX_AI_UPLOAD_BODY_SIZE)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد الأقصى المسموح به (10 ميجابايت)', 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('فشل قراءة الملف المرفوع', 400);
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string' || !(file instanceof Blob)) {
    return jsonError('يرجى اختيار ملف PDF صالح للرفع', 400);
  }

  if (file.size > MAX_AI_PDF_SIZE) {
    return jsonError('حجم الملف يتجاوز الحد الأقصى (10 ميجابايت)', 413);
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (!isPdfUpload(file.type || 'application/pdf', bytes)) {
    return jsonError('الملف المرفوع ليس ملف PDF صالح أو تالف', 400);
  }

  const storage = getPrivateStorage();
  const tempFileId = randomUUID();
  const storageKey = `ai_temp/${tempFileId}.pdf`;

  try {
    await storage.put(storageKey, bytes);
  } catch {
    return jsonError('تعذر حفظ الملف المؤقت في التخزين الآمن', 500);
  }

  // Lazy cleanup of older files in ai_temp (non-blocking)
  cleanStaleAiTempFiles(storage).catch(() => {});

  const sanitizedFileName = (file.name || 'document.pdf')
    .replace(/[^\w\s.\u0600-\u06FF-]/gi, '')
    .slice(0, 100);

  return Response.json({
    success: true,
    tempFileId,
    fileName: sanitizedFileName,
    size: bytes.byteLength,
  });
}

/**
 * Background lazy cleanup for temporary AI files older than 1 hour.
 */
async function cleanStaleAiTempFiles(storage: any) {
  try {
    const listResult = await storage.list({ limit: 50 });
    const tempFiles = (listResult?.objects || []).filter((obj: { key: string }) =>
      obj.key.startsWith('ai_temp/')
    );

    const ONE_HOUR_MS = 60 * 60 * 1000;
    const now = Date.now();

    for (const fileObj of tempFiles) {
      const meta = await storage.head(fileObj.key);
      // Delete only objects whose filesystem metadata proves they are stale.
      // A missing/unknown timestamp fails closed by retaining the private file.
      if (meta && typeof meta.mtimeMs === 'number' && meta.mtimeMs <= now - ONE_HOUR_MS) {
        await storage.delete(fileObj.key);
      }
    }
  } catch {
    // Ignore lazy cleanup errors
  }
}
