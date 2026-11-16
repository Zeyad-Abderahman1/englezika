import { NextResponse } from 'next/server';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { isPdfUpload } from '../../../../lib/upload-validation';
import { parsePdfDocument } from '../../../../lib/ai/document-parser';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/admin/ai/extract-text
 * Server-side extraction of curriculum text from uploaded PDF or TXT files.
 * Reuses the platform's core document-parser unpdf architecture.
 * Requires staff permission 'manage_exams'.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('يجب رفع الملف بصيغة multipart/form-data', 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('فشل في قراءة بيانات الملف المرفوع', 400);
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string' || !(file instanceof Blob)) {
    return jsonError('يرجى تحديد ملف صالح (PDF أو TXT)', 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return jsonError('حجم الملف يتجاوز الحد الأقصى المسموح به (10 ميجابايت)', 413);
  }

  const fileName = (file.name || 'document.pdf')
    .replace(/[^\w\s.\u0600-\u06FF-]/gi, '')
    .slice(0, 100);

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const isPdf = isPdfUpload(file.type || 'application/pdf', bytes);
  const isTxt = file.type === 'text/plain' || fileName.toLowerCase().endsWith('.txt');

  if (!isPdf && !isTxt) {
    return jsonError('نوع الملف غير مدعوم. الصيغ المدعومة هي PDF أو TXT فقط', 400);
  }

  try {
    if (isPdf) {
      const extracted = await parsePdfDocument(bytes, file.type || 'application/pdf');
      return NextResponse.json({
        ok: true,
        fileName,
        fileType: 'pdf',
        pageCount: extracted.pageCount,
        charCount: extracted.charCount,
        readableChars: extracted.readableChars,
        text: extracted.text,
      });
    } else {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(bytes).trim();
      return NextResponse.json({
        ok: true,
        fileName,
        fileType: 'txt',
        pageCount: 1,
        charCount: text.length,
        readableChars: text.length,
        text,
      });
    }
  } catch (error: any) {
    console.error('[ExtractText API Error]:', error);
    return jsonError(
      error?.message || 'فشل في استخراج النصوص التعليمية من الملف',
      422
    );
  }
}
