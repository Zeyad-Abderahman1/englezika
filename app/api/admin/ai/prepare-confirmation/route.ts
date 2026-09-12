import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import { createConfirmationRequest } from '../../../../lib/ai/confirmation.server';
import { getToolDefinition, isRegisteredTool, type AiToolName } from '../../../../lib/ai/tool-registry';
import { generateActionPreview } from '../../../../lib/ai/preview-generator';
import { validateGeneratedAssessment } from '../../../../lib/ai/assessment-validator';
import { getDatabase } from '../../../../lib/platform';

export const runtime = 'nodejs';

/**
 * POST /api/admin/ai/prepare-confirmation
 *
 * Prepares a durable confirmation record and returns a cryptographic HMAC token.
 * Canonical payload is saved server-side in PostgreSQL.
 * The client receives ONLY the signed token (tokenId.signature) and preview.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_courses');
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

  const actionType = typeof body.actionType === 'string' ? body.actionType.trim() : '';
  const actionPayload = body.actionPayload && typeof body.actionPayload === 'object' ? body.actionPayload : null;

  if (!actionType || !actionPayload) {
    return jsonError('نوع الإجراء وحمولته مطلوبان', 400);
  }

  // Validate tool exists in registry or is a compound plan
  if (actionType !== 'compound_plan') {
    const tool = getToolDefinition(actionType as AiToolName);
    if (!tool) {
      return jsonError(`الأداة المطلوبة غير معروفة: ${actionType}`, 400);
    }
    if (tool.mutationType === 'read') {
      return jsonError(`الأدوات المخصصة للقراءة فقط لا تتطلب تأكيداً: ${actionType}`, 400);
    }
    if (actionType === 'create_quiz' || actionType === 'create_exam') {
      const questions = Array.isArray(actionPayload.questions) ? actionPayload.questions : [];
      const validation = validateGeneratedAssessment(questions);
      if (!validation.valid || validation.validQuestions.length === 0) {
        return jsonError('هذا التقييم يحتوي على اختيارات أو بيانات غير صالحة ولا يمكن إدراجه', 400);
      }
      if (actionPayload.coverageStartLectureId || actionPayload.coverageEndLectureId) {
        const db = getDatabase();
        const lecsRes = await db
          .prepare(
            `SELECT v.id FROM videos v
             LEFT JOIN course_items ci ON ci.video_id = v.id AND ci.course_id = v.course_id
             WHERE v.course_id = ?
             ORDER BY COALESCE(ci.sort_order, 999999) ASC, v.created_at ASC`
          )
          .bind(String(actionPayload.courseId || ''))
          .all<{ id: string }>();
        const lecs = (lecsRes?.results || []).map((l) => l.id);
        const startIdx = lecs.indexOf(String(actionPayload.coverageStartLectureId || ''));
        const endIdx = lecs.indexOf(String(actionPayload.coverageEndLectureId || ''));
        if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
          return jsonError('نطاق المحاضرات المحدد للاختبار غير صالح أو غير تابع للدورة التعليمية', 400);
        }
      }
    }
  } else {
    const steps = Array.isArray(actionPayload.steps) ? actionPayload.steps : [];
    if (steps.length === 0) {
      return jsonError('خطة العمل المركبة يجب أن تحتوي على خطوات', 400);
    }
    for (const step of steps) {
      if (!step.tool || !isRegisteredTool(step.tool)) {
        return jsonError(`الأداة المطلوبة في الخطة غير معروفة: ${step.tool}`, 400);
      }
      if (step.tool === 'create_quiz' || step.tool === 'create_exam') {
        const stepParams = step.parameters || step.payload || {};
        const questions = Array.isArray(stepParams.questions) ? stepParams.questions : [];
        const validation = validateGeneratedAssessment(questions);
        if (!validation.valid || validation.validQuestions.length === 0) {
          return jsonError('هذا التقييم يحتوي على اختيارات أو أسئلة غير صالحة ولا يمكن إدراجه', 400);
        }
        if (stepParams.coverageStartLectureId || stepParams.coverageEndLectureId) {
          const db = getDatabase();
          const lecsRes = await db
            .prepare(
              `SELECT v.id FROM videos v
               LEFT JOIN course_items ci ON ci.video_id = v.id AND ci.course_id = v.course_id
               WHERE v.course_id = ?
               ORDER BY COALESCE(ci.sort_order, 999999) ASC, v.created_at ASC`
            )
            .bind(String(stepParams.courseId || ''))
            .all<{ id: string }>();
          const lecs = (lecsRes?.results || []).map((l) => l.id);
          const startIdx = lecs.indexOf(String(stepParams.coverageStartLectureId || ''));
          const endIdx = lecs.indexOf(String(stepParams.coverageEndLectureId || ''));
          if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
            return jsonError('نطاق المحاضرات المحدد للاختبار غير صالح أو غير تابع للدورة التعليمية', 400);
          }
        }
      }
    }
  }


  try {
    const preview = generateActionPreview(actionType, actionPayload);
    const tokenResult = await createConfirmationRequest({
      actor: {
        email: staff.email,
        role: staff.role as any,
        permissions: staff.permissions || [],
      },
      actionType,
      actionPayload,
      preview,
    });

    return Response.json({
      success: true,
      tokenId: tokenResult.tokenId,
      signature: tokenResult.signature,
      token: tokenResult.token,
      actionType: tokenResult.actionType,
      expiresAt: tokenResult.expiresAt,
      preview: tokenResult.preview,
    });
  } catch (error: any) {
    return jsonError(error?.message || 'فشل إعداد رمز التأكيد', 500);
  }
}
