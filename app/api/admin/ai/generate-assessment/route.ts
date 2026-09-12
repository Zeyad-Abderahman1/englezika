import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getPrivateStorage } from '../../../../lib/platform';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import { parsePdfDocument } from '../../../../lib/ai/document-parser';
import { generateAssessmentFromText } from '../../../../lib/ai/content-generator';

export const runtime = 'nodejs';

/**
 * POST /api/admin/ai/generate-assessment
 *
 * Generates an editable assessment preview (MCQ questions) from:
 * A) A temporary uploaded PDF (tempFileId)
 * B) An existing course/lecture material (materialKey)
 *
 * Zero LMS database mutations occur here. Output is strictly for teacher preview/editing.
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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError('صيغة الطلب غير صالحة، يجب إرسال JSON', 400);
  }

  const tempFileId = typeof body.tempFileId === 'string' ? body.tempFileId.trim() : null;
  const materialKey = typeof body.materialKey === 'string' ? body.materialKey.trim() : null;

  if (!tempFileId && !materialKey) {
    return jsonError('يجب تحديد مصدر المستند (tempFileId أو materialKey)', 400);
  }

  const questionCount = typeof body.questionCount === 'number' ? body.questionCount : 5;
  if (questionCount < 1 || questionCount > 30) {
    return jsonError('عدد الأسئلة المطلوب يجب أن يكون بين 1 و 30 سؤالاً', 400);
  }

  const storage = getPrivateStorage();
  let storageKey: string;
  let isTemp = false;

  if (tempFileId) {
    // Validate UUID format to prevent directory traversal
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tempFileId)) {
      return jsonError('معرف الملف المؤقت غير صالح', 400);
    }
    storageKey = `ai_temp/${tempFileId}.pdf`;
    isTemp = true;
  } else {
    // Validate materialKey belongs to authorized materials namespace
    if (!materialKey!.startsWith('videos/') || materialKey!.includes('..')) {
      return jsonError('مسار مادة المحاضرة غير صالح أو غير مصرح به', 403);
    }
    storageKey = materialKey!;
  }

  // 1. Retrieve PDF bytes from PrivateStorage
  const storedObject = await storage.get(storageKey);
  if (!storedObject || !storedObject.body) {
    return jsonError('لم يتم العثور على ملف المحتوى المطلوب في التخزين الآمن', 404);
  }

  try {
    // 2. Parse and validate PDF text
    const extracted = await parsePdfDocument(storedObject.body);

    // 3. Generate assessment preview using batched generator
    const title = typeof body.title === 'string' ? body.title : undefined;
    const examType = body.examType === 'exam' ? 'exam' : 'quiz';
    const difficulty =
      body.difficulty === 'easy' || body.difficulty === 'hard' || body.difficulty === 'advanced'
        ? body.difficulty
        : 'medium';

    const assessmentPreview = await generateAssessmentFromText({
      documentText: extracted.text,
      title,
      examType,
      requestedQuestionCount: questionCount,
      difficulty,
    });

    return Response.json({
      success: true,
      assessment: assessmentPreview,
    });
  } catch (error: any) {
    const message = error?.message || 'تعذر توليد التقييم من المستند';
    const status =
      error?.code === 'AI_QUEUE_SATURATED' || error?.code === 'QUEUE_SATURATED'
        ? 429
        : message.includes('ممسوح ضوئياً') ||
          message.includes('Scanned PDF') ||
          message.includes('سؤالًا صالحًا فقط') ||
          message.includes('سؤالاً صالحاً فقط') ||
          message.includes('تم توليد')
        ? 422
        : 500;
    return jsonError(message, status);
  } finally {
    // 4. Immediate cleanup: delete temporary upload file
    if (isTemp) {
      storage.delete(storageKey).catch(() => {});
    }
  }
}
