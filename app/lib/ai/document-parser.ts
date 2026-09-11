import { extractText } from 'unpdf';
import { isPdfUpload } from '../upload-validation';

export const MAX_EXTRACTED_CHARS = 100_000;
export const MIN_READABLE_CHARS = 300;

export interface ExtractedDocument {
  text: string;
  charCount: number;
  pageCount: number;
  readableChars: number;
}

/**
 * Validates and extracts text from an in-memory PDF buffer.
 * Enforces magic-byte validation, scanned PDF guards, and character boundaries.
 */
export async function parsePdfDocument(
  buffer: ArrayBuffer | Uint8Array,
  mimeType = 'application/pdf'
): Promise<ExtractedDocument> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // 1. Magic-byte PDF validation
  if (!isPdfUpload(mimeType, bytes)) {
    throw new Error('الملف المرفوع ليس ملف PDF صالح أو تالف.');
  }

  // 2. Extract text using unpdf
  let extracted: { text: string | string[]; totalPages: number };
  try {
    const cleanUint8 = new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    extracted = await extractText(cleanUint8);
  } catch (error: any) {
    throw new Error(`تعذر استخراج النص من ملف PDF: ${error?.message || 'خطأ غير معروف'}`);
  }

  const rawText = Array.isArray(extracted.text) ? extracted.text.join('\n\n') : (extracted.text || '');
  const pageCount = extracted.totalPages || 1;

  // 3. Clean and normalize text
  const normalizedText = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 4. Scanned PDF guard
  // Count meaningful Unicode letters and numbers (Arabic, English, digits)
  const lettersAndDigits = normalizedText.match(/[\p{L}\p{N}]/gu) || [];
  const readableChars = lettersAndDigits.length;

  if (readableChars < MIN_READABLE_CHARS) {
    throw new Error(
      'الملف المرفوع عبارة عن مستند ممسوح ضوئياً أو لا يحتوي على نص كافٍ قابل للقراءة (Scanned PDF). يرجى رفع ملف نصي يحتوي على محتوى تعليمي مقروء.'
    );
  }

  // 5. Cap maximum characters
  const boundedText = normalizedText.slice(0, MAX_EXTRACTED_CHARS);

  return {
    text: boundedText,
    charCount: boundedText.length,
    pageCount,
    readableChars,
  };
}
