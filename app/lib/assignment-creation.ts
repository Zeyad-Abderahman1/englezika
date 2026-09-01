export const MAX_ASSIGNMENT_PDF_SIZE = 15 * 1024 * 1024;

type AdminRequest = (url: string, init?: RequestInit) => Promise<unknown>;

type FileLike = {
  name: string;
  size: number;
  type: string;
};

export class AssignmentFileUploadError extends Error {
  readonly assignmentId: string;

  constructor(assignmentId: string, cause: unknown) {
    super(
      cause instanceof Error
        ? `تم إنشاء الواجب، لكن تعذر رفع ملف PDF: ${cause.message}`
        : 'تم إنشاء الواجب، لكن تعذر رفع ملف PDF'
    );
    this.name = 'AssignmentFileUploadError';
    this.assignmentId = assignmentId;
  }
}

function validatePdf(file: FileLike | null): void {
  if (!file) return;
  if (file.type.toLowerCase() !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('يجب اختيار ملف PDF صالح فقط');
  }
  if (file.size > MAX_ASSIGNMENT_PDF_SIZE) {
    throw new Error('حجم ملف PDF يتجاوز الحد الأقصى (15 ميجابايت)');
  }
}

export async function createAssignmentWithOptionalPdf(
  request: AdminRequest,
  payload: Record<string, unknown>,
  pdf: File | null
): Promise<{ id: string; fileUploaded: boolean }> {
  validatePdf(pdf);

  const created = (await request('/api/admin/assignments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })) as { id?: unknown };
  if (typeof created.id !== 'string' || !created.id) {
    throw new Error('تم إنشاء استجابة غير صالحة للواجب');
  }

  if (!pdf) return { id: created.id, fileUploaded: false };

  const formData = new FormData();
  formData.append('file', pdf);
  try {
    await request(`/api/admin/assignments/${encodeURIComponent(created.id)}/file`, {
      method: 'POST',
      body: formData,
    });
  } catch (error) {
    throw new AssignmentFileUploadError(created.id, error);
  }

  return { id: created.id, fileUploaded: true };
}
