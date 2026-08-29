export const MAX_PDF_SIZE = 15 * 1024 * 1024;
export const MAX_UPLOAD_BODY_SIZE = MAX_PDF_SIZE + 256 * 1024;
export const MAX_JSON_BODY_SIZE = 256 * 1024;

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

export async function stableStorageIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value.trim().toLowerCase())
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
