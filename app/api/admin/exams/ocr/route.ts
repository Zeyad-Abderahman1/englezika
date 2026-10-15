import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { extractAndSolveExamFromImages, type ImageInput } from '../../../../lib/exam-ocr';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../../lib/rate-limit';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_COUNT = 10;

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const admin = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(admin)) return admin;

  // Rate limiting backed by rate_limits table (SEC-05)
  const clientIp = getClientIp(request);
  const accountRate = await checkRateLimit('admin-exam-ocr-account', admin.email.toLowerCase(), 10, 300);
  if (!accountRate.allowed) {
    return rateLimitResponse(accountRate.resetAfterSeconds, 'تم تجاوز الحد المسموح به لطلبات استخراج الأسئلة. يرجى الانتظار قليلاً.');
  }

  const ipRate = await checkRateLimit('admin-exam-ocr-ip', clientIp, 30, 300);
  if (!ipRate.allowed) {
    return rateLimitResponse(ipRate.resetAfterSeconds, 'تم تجاوز الحد المسموح به لطلبات استخراج الأسئلة من هذا العنوان.');
  }

  const contentType = request.headers.get('content-type') || '';
  const imageInputs: ImageInput[] = [];

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const files = formData.getAll('images') as File[];

      if (!files.length) {
        return jsonError('يرجى رفع صورة واحدة على الأقل لأسئلة الامتحان', 400);
      }
      if (files.length > MAX_IMAGE_COUNT) {
        return jsonError(`الحد الأقصى المسموح به هو ${MAX_IMAGE_COUNT} صور في المرة الواحدة`, 400);
      }

      for (const file of files) {
        if (!ALLOWED_MIME_TYPES.has(file.type)) {
          return jsonError(`نوع الملف غير مدعوم: ${file.name}. الصيغ المدعومة هي PNG, JPEG, WEBP`, 400);
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          return jsonError(`حجم الصورة ${file.name} يتجاوز 10 ميجابايت`, 400);
        }

        const buffer = await file.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        imageInputs.push({
          data: base64,
          mimeType: file.type,
        });
      }
    } else {
      // JSON payload support
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const rawImages = Array.isArray(body.images) ? body.images : [];

      if (!rawImages.length) {
        return jsonError('يرجى رفع صورة واحدة على الأقل لأسئلة الامتحان', 400);
      }
      if (rawImages.length > MAX_IMAGE_COUNT) {
        return jsonError(`الحد الأقصى المسموح به هو ${MAX_IMAGE_COUNT} صور في المرة الواحدة`, 400);
      }

      for (const raw of rawImages) {
        const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const mimeType = String(item.mimeType || item.type || 'image/jpeg');
        const data = String(item.data || '');

        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
          return jsonError(`نوع الصورة غير مدعوم: ${mimeType}`, 400);
        }
        if (!data || data.length > MAX_IMAGE_SIZE_BYTES * 1.4) {
          return jsonError('حجم إحدى الصور يتجاوز الحد الأقصى 10 ميجابايت', 400);
        }

        // Clean base64 header if present (e.g. data:image/png;base64,...)
        const cleanedData = data.includes(',') ? data.split(',')[1] : data;
        imageInputs.push({
          data: cleanedData,
          mimeType,
        });
      }
    }

    const ocrResult = await extractAndSolveExamFromImages(imageInputs);
    if (!ocrResult.ok) {
      const safeError =
        ocrResult.error && !ocrResult.error.includes('http') && !ocrResult.error.includes('AIza')
          ? ocrResult.error
          : 'تعذر استخراج الأسئلة من الصور عبر الذكاء الاصطناعي';
      return Response.json(
        {
          error: safeError,
          code: ocrResult.code || 'AI_OCR_FAILED',
        },
        { status: ocrResult.code === 'AI_MODEL_UNAVAILABLE' ? 503 : 502 }
      );
    }

    return Response.json({
      ok: true,
      questions: ocrResult.questions,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    const rawMsg = err instanceof Error ? err.message : String(err);
    const truncatedMessage = rawMsg.slice(0, 300);
    console.error('[Admin OCR Route Error]', status ? { status, message: truncatedMessage } : { message: truncatedMessage });
    return jsonError('حدث خطأ أثناء معالجة الصور', 500);
  }
}
