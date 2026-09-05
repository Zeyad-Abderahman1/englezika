export const MAX_PDF_SIZE = 15 * 1024 * 1024;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_MATERIAL_SIZE = 25 * 1024 * 1024;
export const MAX_UPLOAD_BODY_SIZE = MAX_PDF_SIZE + 256 * 1024;
export const MAX_MATERIAL_UPLOAD_BODY_SIZE = MAX_MATERIAL_SIZE + 512 * 1024;
export const MAX_JSON_BODY_SIZE = 256 * 1024;

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function hasAllowedContentLength(request: Request, maximum: number): boolean {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return false;
  const length = Number(rawLength);
  return Number.isSafeInteger(length) && length > 0 && length <= maximum;
}

export function isPdfUpload(mimeType: string, bytes: ArrayBuffer | Uint8Array): boolean {
  const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
  const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return (
    (normalizedMimeType === 'application/pdf' || normalizedMimeType === 'application/octet-stream') &&
    pdfSignature.every((byte, index) => content[index] === byte)
  );
}

export function isImageUpload(mimeType: string, bytes: ArrayBuffer | Uint8Array): boolean {
  const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
  const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(normalizedMimeType)) return false;

  if (normalizedMimeType === 'image/jpeg') {
    return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (normalizedMimeType === 'image/png') {
    const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return pngSig.every((byte, index) => content[index] === byte);
  }
  if (normalizedMimeType === 'image/webp') {
    const webpRiff = [0x52, 0x49, 0x46, 0x46];
    const riffOk = webpRiff.every((byte, index) => content[index] === byte);
    const webpTag = content[8] === 0x57 && content[9] === 0x45 && content[10] === 0x42 && content[11] === 0x50;
    return riffOk && webpTag;
  }

  return false;
}

export function getImageExtension(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0].trim().toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  return 'bin';
}

export async function stableStorageIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value.trim().toLowerCase())
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
