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

export function getImageDimensions(
  mimeType: string,
  bytes: ArrayBuffer | Uint8Array
): { width: number; height: number } | null {
  const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
  const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (normalizedMimeType === 'image/png') {
    if (content.length < 24) return null;
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { width, height };
  }

  if (normalizedMimeType === 'image/jpeg') {
    let offset = 2;
    const len = content.length;
    while (offset + 4 < len) {
      if (content[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = content[offset + 1];
      if (marker === 0xff || marker === 0x00) {
        offset++;
        continue;
      }
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      const segLength = (content[offset + 2] << 8) | content[offset + 3];
      if (isSof && offset + 8 < len) {
        const height = (content[offset + 5] << 8) | content[offset + 6];
        const width = (content[offset + 7] << 8) | content[offset + 8];
        return { width, height };
      }
      if (marker === 0xda || marker === 0xd9) break;
      offset += 2 + segLength;
    }
    return null;
  }

  if (normalizedMimeType === 'image/webp') {
    if (content.length < 30) return null;
    const chunkType = String.fromCharCode(content[12], content[13], content[14], content[15]);
    if (chunkType === 'VP8 ' && content.length >= 30) {
      // VP8 lossy: 14-bit width/height
      const width = ((content[27] << 8) | content[26]) & 0x3fff;
      const height = ((content[29] << 8) | content[28]) & 0x3fff;
      return { width, height };
    }
    if (chunkType === 'VP8L' && content.length >= 25) {
      // VP8L lossless
      const b0 = content[21];
      const b1 = content[22];
      const b2 = content[23];
      const b3 = content[24];
      const width = 1 + (b0 | ((b1 & 0x3f) << 8));
      const height = 1 + (((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)));
      return { width, height };
    }
    if (chunkType === 'VP8X' && content.length >= 30) {
      // VP8X extended: 24-bit canvas width/height
      const width = 1 + (content[24] | (content[25] << 8) | (content[26] << 16));
      const height = 1 + (content[27] | (content[28] << 8) | (content[29] << 16));
      return { width, height };
    }
    return null;
  }

  return null;
}

export function hasReasonableCourseThumbnailDimensions(dimensions: {
  width: number;
  height: number;
}): boolean {
  const { width, height } = dimensions;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 160 &&
    height >= 90 &&
    width <= 8000 &&
    height <= 8000
  );
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

