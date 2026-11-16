import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getPrivateStorage } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { checkRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import {
  MAX_IMAGE_SIZE,
  hasAllowedContentLength,
  sniffImageMimeType,
} from '../../../../lib/upload-validation';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import {
  ImageStagingError,
  MAX_EXAM_PAGE_BYTES,
  stageImage,
  type StagePurpose,
} from '../../../../lib/ai/agent/image-staging';

export const runtime = 'nodejs';

const MAX_BODY = MAX_IMAGE_SIZE + 256 * 1024;
const MAX_PAGE_BODY = MAX_EXAM_PAGE_BYTES + 256 * 1024;

/**
 * POST /api/admin/ai/upload-image
 *
 * Stages a course thumbnail chosen inside the assistant chat.
 * - Same-origin (CSRF) + 'manage_courses' staff permission, like the course form.
 * - Same validation as the course thumbnail endpoint: real content sniffing,
 *   JPG/PNG/WebP only, max 5MB, minimum dimensions.
 * - Stored under a per-user private namespace. Only an opaque `uploadId` is
 *   returned: no URL, path, or image data ever reaches the model.
 * - The image is attached to a course later, when the teacher confirms the
 *   create/update action.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  // ?purpose=exam_page stages ONE page of an exam paper (many pages are uploaded one by one);
  // the default stages a single course/exam thumbnail.
  const purpose: StagePurpose =
    new URL(request.url).searchParams.get('purpose') === 'exam_page' ? 'exam_page' : 'thumbnail';

  const staff = await apiStaff(request, purpose === 'exam_page' ? 'manage_exams' : 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const config = loadAiServerConfig();
  if (!config.enabled) {
    return jsonError('خدمة المساعد الذكي غير مفعلة حالياً على الخادم', 403);
  }

  const limit =
    purpose === 'exam_page'
      ? await checkRateLimit('admin-ai-upload-page', staff.email.toLowerCase(), 300, 300)
      : await checkRateLimit('admin-ai-upload-image', staff.email.toLowerCase(), 20, 60);
  if (!limit.allowed) {
    return rateLimitResponse(limit.resetAfterSeconds, 'عدد كبير من رفع الصور. انتظر قليلًا ثم حاول مرة أخرى.');
  }

  const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'multipart/form-data') {
    return jsonError('يجب رفع صورة فقط (multipart/form-data)', 400);
  }
  if (!hasAllowedContentLength(request, purpose === 'exam_page' ? MAX_PAGE_BODY : MAX_BODY)) {
    return jsonError(
      purpose === 'exam_page' ? 'حجم الصورة يتجاوز 10 ميجابايت' : 'حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت)',
      413
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError('تعذر قراءة بيانات الملف', 400);

  const file = formData.get('file');
  if (!(file instanceof Blob)) return jsonError('لم يتم اختيار ملف', 400);
  if (purpose === 'thumbnail' && file.size > MAX_IMAGE_SIZE) {
    return jsonError('حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت)', 413);
  }
  if (purpose === 'exam_page' && file.size > MAX_EXAM_PAGE_BYTES) {
    return jsonError('حجم الصورة يتجاوز 10 ميجابايت', 413);
  }

  const bytes = await file.arrayBuffer();
  const mime = sniffImageMimeType(bytes) || file.type || '';

  try {
    const storage = getPrivateStorage();
    const { uploadId, image } = await stageImage(staff.email, bytes, mime, storage as never, purpose);
    cleanStaleStagedImages(storage).catch(() => {});
    return Response.json({
      success: true,
      uploadId,
      width: image.width,
      height: image.height,
      notWidescreen: image.notWidescreen,
    });
  } catch (error) {
    if (error instanceof ImageStagingError) {
      return jsonError(error.message, error.status);
    }
    return jsonError('تعذر حفظ الصورة مؤقتًا', 500);
  }
}

/** Lazy cleanup: staged images that were never attached are removed after 2 hours. */
async function cleanStaleStagedImages(storage: ReturnType<typeof getPrivateStorage>) {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const now = Date.now();
  const listing = await storage.list({ limit: 200 });
  const staged = (listing?.objects || []).filter((object: { key: string }) =>
    object.key.startsWith('ai_temp/img/')
  );
  for (const object of staged) {
    const meta = await storage.head(object.key);
    if (meta && typeof meta.mtimeMs === 'number' && meta.mtimeMs <= now - TWO_HOURS_MS) {
      await storage.delete(object.key);
    }
  }
}
