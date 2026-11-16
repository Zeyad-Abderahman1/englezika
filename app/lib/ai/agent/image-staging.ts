import { createHash, randomUUID } from 'node:crypto';
import { getPrivateStorage } from '../../platform';
import {
  MAX_IMAGE_SIZE,
  getImageDimensions,
  hasReasonableCourseThumbnailDimensions,
  isImageUpload,
} from '../../upload-validation';

/**
 * Staged (not yet attached) images for the AI assistant chat.
 *
 * The browser uploads the image once to /api/admin/ai/upload-image; only an
 * opaque upload reference (`<uuid>.<ext>`) ever reaches the model/agent state.
 * The storage key embeds a hash of the owner's email, so a reference can only be
 * resolved by the staff member who uploaded it.
 */

const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export class ImageStagingError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ImageStagingError';
    this.status = status;
  }
}

type StorageLike = {
  put: (key: string, body: Uint8Array, options?: unknown) => Promise<unknown>;
  get: (key: string) => Promise<{ body: Uint8Array } | null>;
  delete: (key: string) => Promise<unknown>;
};

export function isValidUploadId(uploadId: unknown): uploadId is string {
  return typeof uploadId === 'string' && UPLOAD_ID_PATTERN.test(uploadId);
}

function ownerSegment(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

export function stagedImageKey(email: string, uploadId: string): string {
  if (!isValidUploadId(uploadId)) {
    throw new ImageStagingError('مرجع الصورة غير صالح', 400);
  }
  return `ai_temp/img/${ownerSegment(email)}/${uploadId}`;
}

export interface ValidatedImage {
  mime: string;
  width: number;
  height: number;
  /** True when the aspect ratio is noticeably different from 16:9. */
  notWidescreen: boolean;
}

/**
 * Same checks as `courseService.uploadThumbnail` (type sniffing, 5MB cap,
 * minimum dimensions) so the teacher gets the error immediately in the chat
 * instead of after the course is created.
 */
export function validateThumbnailImage(bytes: ArrayBuffer, mimeHint: string): ValidatedImage {
  if (bytes.byteLength > MAX_IMAGE_SIZE) {
    throw new ImageStagingError('حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت)');
  }
  if (!isImageUpload(mimeHint, bytes)) {
    throw new ImageStagingError('يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP');
  }
  const dimensions = getImageDimensions(mimeHint, bytes);
  if (!dimensions || !hasReasonableCourseThumbnailDimensions(dimensions)) {
    throw new ImageStagingError(
      'أبعاد الصورة غير صالحة. تأكد من رفع صورة صحيحة بدقة مناسبة (الحد الأدنى 160×90 بكسل).'
    );
  }
  const ratio = dimensions.width / dimensions.height;
  return {
    mime: mimeHint,
    width: dimensions.width,
    height: dimensions.height,
    notWidescreen: Math.abs(ratio - 16 / 9) > 0.15,
  };
}

/** Same limits as the OCR upload route: JPG/PNG/WebP, max 10MB per page, no dimension rule. */
export const MAX_EXAM_PAGE_BYTES = 10 * 1024 * 1024;

export function validateExamPageImage(bytes: ArrayBuffer, mimeHint: string): ValidatedImage {
  if (bytes.byteLength > MAX_EXAM_PAGE_BYTES) {
    throw new ImageStagingError('حجم الصورة يتجاوز 10 ميجابايت');
  }
  if (!isImageUpload(mimeHint, bytes)) {
    throw new ImageStagingError('نوع الملف غير مدعوم. الصيغ المدعومة هي PNG وJPEG وWEBP');
  }
  const dimensions = getImageDimensions(mimeHint, bytes);
  return { mime: mimeHint, width: dimensions?.width ?? 0, height: dimensions?.height ?? 0, notWidescreen: false };
}

export type StagePurpose = 'thumbnail' | 'exam_page';

export async function stageImage(
  email: string,
  bytes: ArrayBuffer,
  mime: string,
  storage: StorageLike = getPrivateStorage() as unknown as StorageLike,
  purpose: StagePurpose = 'thumbnail'
): Promise<{ uploadId: string; image: ValidatedImage }> {
  const image = purpose === 'exam_page' ? validateExamPageImage(bytes, mime) : validateThumbnailImage(bytes, mime);
  const extension = EXTENSION_BY_MIME[mime];
  if (!extension) throw new ImageStagingError('يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP');

  const uploadId = `${randomUUID()}.${extension}`;
  await storage.put(stagedImageKey(email, uploadId), new Uint8Array(bytes));
  return { uploadId, image };
}

export async function loadStagedImage(
  email: string,
  uploadId: string,
  storage: StorageLike = getPrivateStorage() as unknown as StorageLike
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const key = stagedImageKey(email, uploadId);
  const stored = await storage.get(key);
  if (!stored) return null;
  const extension = uploadId.slice(uploadId.lastIndexOf('.') + 1);
  const copy = new Uint8Array(stored.body.byteLength);
  copy.set(stored.body);
  return { bytes: copy.buffer, mime: MIME_BY_EXTENSION[extension] };
}

export async function deleteStagedImage(
  email: string,
  uploadId: string,
  storage: StorageLike = getPrivateStorage() as unknown as StorageLike
): Promise<void> {
  try {
    await storage.delete(stagedImageKey(email, uploadId));
  } catch {
    // Best effort; stale temp files are swept by the lazy cleanup in /upload.
  }
}
