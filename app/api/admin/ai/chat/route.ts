import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { checkRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import { orchestrateAdminChat } from '../../../../lib/ai/orchestrator';

export const runtime = 'nodejs';

/**
 * POST /api/admin/ai/chat
 *
 * Conversational interface for the admin AI assistant.
 * - Authenticated staff only ('manage_courses')
 * - Rate limited: 30 requests / min
 * - Orchestrates multi-turn memory and compound plan risk escalation
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

  // Rate limiting: 30 requests / minute per staff account
  const rateLimit = await checkRateLimit('admin-ai-chat', staff.email.toLowerCase(), 30, 60);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAfterSeconds, 'تجاوزت الحد المسموح من طلبات المحادثة. يرجى الانتظار قليلاً.');
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError('صيغة الطلب غير صالحة، يجب إرسال JSON', 400);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return jsonError('رسالة المعلم لا يمكن أن تكون فارغة', 400);
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : undefined;
  const context = body.context && typeof body.context === 'object' ? body.context : undefined;

  try {
    const result = await orchestrateAdminChat({
      actor: {
        email: staff.email,
        name: (staff as any).name || staff.email,
        role: staff.role as any,
        permissions: staff.permissions || [],
      },
      message,
      conversationId,
      context,
    });

    return Response.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    const errorMsg = error?.message || 'تعذر معالجة محادثة المساعد الذكي';
    return jsonError(errorMsg, 500);
  }
}
