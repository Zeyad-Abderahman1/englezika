import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { checkRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { getDatabase } from '../../../../lib/platform';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import { loadConversationHistory, orchestrateAdminChat } from '../../../../lib/ai/orchestrator';
import { runAgentTurn } from '../../../../lib/ai/agent/agent';
import { createServerAgentDeps } from '../../../../lib/ai/agent/server-deps';
import { parseAgentEvent } from '../../../../lib/ai/agent/ui-types';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * POST /api/admin/ai/chat
 *
 * Conversational interface for the admin AI assistant.
 * - Authenticated staff only ('manage_courses'), same-origin (CSRF) protected
 * - Rate limited: 30 requests / min per staff account
 * - The agent (slot-filling flows + read-only info questions) answers first. Writes
 *   are NEVER executed here: a finished flow only produces a pending confirmation
 *   that the teacher approves through /api/admin/ai/execute.
 * - Anything the agent does not recognise falls through to the planner/orchestrator
 *   (exams, quizzes, reordering, ...), exactly as before.
 *
 * Body: { message?: string, event?: AgentEvent, conversationId?: string, context?: {...} }
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

  const rateLimit = await checkRateLimit('admin-ai-chat', staff.email.toLowerCase(), 30, 60);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.resetAfterSeconds, 'تجاوزت الحد المسموح من طلبات المحادثة. يرجى الانتظار قليلاً.');
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonError('حجم الطلب أكبر من المسموح', 413);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError('صيغة الطلب غير صالحة، يجب إرسال JSON', 400);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const event = parseAgentEvent(body.event);
  if (body.event !== undefined && !event) {
    return jsonError('حدث غير صالح', 400);
  }
  if (!message && !event) {
    return jsonError('رسالة المعلم لا يمكن أن تكون فارغة', 400);
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : undefined;
  const context = body.context && typeof body.context === 'object' ? (body.context as Record<string, string>) : undefined;

  const actor = {
    email: staff.email,
    name: (staff as { name?: string }).name || staff.email,
    role: staff.role as string,
    permissions: staff.permissions || [],
  };

  try {
    const deps = await createServerAgentDeps(actor);
    const agentResult = await runAgentTurn({ actor, message, event: event ?? undefined, conversationId }, deps);
    if (agentResult.handled) {
      return Response.json({
        success: true,
        conversationId: agentResult.conversationId,
        reply: agentResult.reply,
        ui: agentResult.ui,
        flow: agentResult.flow,
        requiresConfirmation: false,
      });
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : '';
    if (text.includes('012_ai_agent_sessions')) {
      return jsonError(text, 503);
    }
    return jsonError('تعذر معالجة محادثة المساعد الذكي', 500);
  }

  // Not an agent flow → existing planner/orchestrator path.
  try {
    const result = await orchestrateAdminChat({
      actor: {
        email: actor.email,
        name: actor.name,
        role: actor.role as never,
        permissions: actor.permissions,
      },
      message,
      conversationId,
      context,
    });

    return Response.json({ success: true, ...result });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    const status = code === 'AI_QUEUE_SATURATED' || code === 'QUEUE_SATURATED' ? 429 : 500;
    const errorMsg = (error as { message?: string })?.message || 'تعذر معالجة محادثة المساعد الذكي';
    return jsonError(errorMsg, status);
  }
}

/**
 * GET /api/admin/ai/chat?conversationId=...
 *
 * Restores a conversation after a page refresh: the last messages plus the UI
 * blocks (chips, upload prompt, confirmation card) of each assistant message. The
 * client only keeps the LAST assistant message interactive.
 */
export async function GET(request: Request) {
  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const conversationId = new URL(request.url).searchParams.get('conversationId')?.trim();
  if (!conversationId || conversationId.length > 80) {
    return jsonError('معرف المحادثة مطلوب', 400);
  }

  const history = await loadConversationHistory(conversationId, staff.email, getDatabase());
  const messages = history.map((item) => {
    let ui: unknown = undefined;
    if (item.role === 'assistant' && item.toolCallJson) {
      try {
        const parsed = JSON.parse(item.toolCallJson) as { ui?: unknown };
        if (Array.isArray(parsed.ui)) ui = parsed.ui;
      } catch {
        ui = undefined;
      }
    }
    return { id: item.id, role: item.role, text: item.content, ui };
  });

  return Response.json({ success: true, conversationId, messages });
}
