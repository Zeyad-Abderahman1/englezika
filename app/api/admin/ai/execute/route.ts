import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { getClientIp } from '../../../../lib/rate-limit';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import { verifyAndExecuteConfirmation } from '../../../../lib/ai/confirmation.server';
import { executeTool } from '../../../../lib/ai/tool-executor';
import type { AiToolName } from '../../../../lib/ai/tool-registry';
import { formatUserFacingConfirmationError } from '../../../../lib/ai/confirmation-state';

export const runtime = 'nodejs';

/**
 * POST /api/admin/ai/execute
 *
 * Authoritative execution endpoint for confirmed AI actions.
 * - Authenticated staff only
 * - Client submits ONLY tokenId + signature
 * - Canonical payload is retrieved directly from PostgreSQL
 * - Prevents duplicate mutations and returns cached result on retry
 * - Atomic transactional execution for pure database mutations
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

  const token = body.token || (body.tokenId && body.signature ? { tokenId: body.tokenId, signature: body.signature } : null);
  if (!token) {
    return jsonError('رمز التأكيد (token) مطلوب للتنفيذ', 400);
  }

  const actor = {
    email: staff.email,
    name: (staff as any).name || staff.email,
    role: staff.role as any,
    permissions: staff.permissions || [],
  };

  try {
    const executionResult = await verifyAndExecuteConfirmation({
      token,
      actor,
      ipAddress: getClientIp(request),
      executor: async (actionType, payload, txDb) => {
        if (actionType === 'compound_plan') {
          // Execute compound multi-action plan
          const steps: Array<{ tool: string; parameters: Record<string, any> }> = Array.isArray(payload.steps)
            ? payload.steps
            : [];

          const stepResults: any[] = [];
          for (const step of steps) {
            const stepResult = await executeTool({
              toolName: step.tool as AiToolName,
              args: step.parameters,
              actor,
              context: {
                db: txDb,
                confirmationSatisfied: true,
              },
            });
            stepResults.push({ tool: step.tool, result: stepResult });
          }
          return { success: true, count: stepResults.length, steps: stepResults };
        }

        // Execute single confirmed action
        return executeTool({
          toolName: actionType as AiToolName,
          args: payload,
          actor,
          context: {
            db: txDb,
            confirmationSatisfied: true,
          },
        });
      },
    });

    return Response.json({
      success: true,
      cached: executionResult.cached,
      executionId: executionResult.executionId,
      actionType: executionResult.actionType,
      result: executionResult.result,
    });
  } catch (error: any) {
    const rawErrorMsg = error?.message || 'فشل تنفيذ الإجراء المؤكد';
    const userMsg = formatUserFacingConfirmationError(rawErrorMsg);

    const isConflict =
      rawErrorMsg.includes('currently executing') ||
      rawErrorMsg.includes('stale or crashed') ||
      rawErrorMsg.includes('already failed');
    const isForbidden = rawErrorMsg.includes('Actor mismatch') || rawErrorMsg.includes('signature');
    const status = isConflict ? 409 : isForbidden ? 403 : 500;

    return jsonError(userMsg, status);
  }
}
