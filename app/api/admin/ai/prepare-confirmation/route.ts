import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import { createConfirmationRequest } from '../../../../lib/ai/confirmation.server';
import { getToolDefinition, type AiToolName } from '../../../../lib/ai/tool-registry';
import { generateActionPreview } from '../../../../lib/ai/preview-generator';

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
