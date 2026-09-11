import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database';
import { getAiProvider } from './local-ai-provider';
import type { LocalAiProvider, PlanResult } from './local-ai-provider';
import { getGlobalAiQueue } from './ai-queue';
import { getToolDefinition, isRegisteredTool, type AiToolName } from './tool-registry';
import { executeTool } from './tool-executor';
import { createConfirmationRequest } from './confirmation.server';
import { generateActionPreview, type ConfirmationPreview } from './preview-generator';
import type { StaffActor } from './tool-executor';
import { getRepairPlanPrompt, SAFE_FALLBACK_REPLY } from './planner-prompt';

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_STORED_MESSAGES = 20;

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCallJson?: string | null;
  createdAt: number;
}

export interface OrchestratorContext {
  courseId?: string;
  lectureId?: string;
  assessmentId?: string;
}

export interface OrchestrateChatOptions {
  actor: StaffActor;
  message: string;
  conversationId?: string;
  context?: OrchestratorContext;
  provider?: LocalAiProvider;
  secret?: string;
  db?: any;
  signal?: AbortSignal;
}

export interface OrchestratorResult {
  conversationId: string;
  reply: string;
  actionsExecuted?: Array<{ tool: string; result: any }>;
  requiresConfirmation?: boolean;
  confirmationToken?: string;
  preview?: ConfirmationPreview;
}

/**
 * Validates and resolves course/lecture/assessment references from server database.
 * The model NEVER invents trusted entity IDs.
 */
export async function resolveContext(
  context: OrchestratorContext | undefined,
  db: any
): Promise<{ courseInfo?: string; lectureInfo?: string; assessmentInfo?: string; validatedContext: OrchestratorContext }> {
  const result: {
    courseInfo?: string;
    lectureInfo?: string;
    assessmentInfo?: string;
    validatedContext: OrchestratorContext;
  } = { validatedContext: {} };

  if (!context) return result;

  if (context.courseId && typeof context.courseId === 'string') {
    const course = await db
      .prepare('SELECT id, title, grade, price, status FROM courses WHERE id = ?')
      .bind(context.courseId.trim())
      .first();

    if (course) {
      result.validatedContext.courseId = course.id;
      const status = course.status || (course.is_active === 1 ? 'published' : 'draft');
      result.courseInfo = `Current Course: "${course.title}" (ID: ${course.id}, Grade: ${course.grade}, Price: ${course.price} EGP, Status: ${status})`;
    }
  }

  if (context.lectureId && typeof context.lectureId === 'string') {
    const lecture = await db
      .prepare('SELECT id, course_id, title, is_active FROM videos WHERE id = ?')
      .bind(context.lectureId.trim())
      .first();

    if (lecture) {
      result.validatedContext.lectureId = lecture.id;
      result.lectureInfo = `Current Lecture: "${lecture.title}" (ID: ${lecture.id}, Course ID: ${lecture.course_id})`;
    }
  }

  if (context.assessmentId && typeof context.assessmentId === 'string') {
    const exam = await db
      .prepare('SELECT id, course_id, title, exam_type, is_active FROM exams WHERE id = ?')
      .bind(context.assessmentId.trim())
      .first();

    if (exam) {
      result.validatedContext.assessmentId = exam.id;
      result.assessmentInfo = `Current Assessment: "${exam.title}" (ID: ${exam.id}, Type: ${exam.exam_type})`;
    }
  }

  return result;
}

/**
 * Loads bounded conversation history from PostgreSQL.
 * Keeps only the last MAX_STORED_MESSAGES. Excludes system prompts and raw schemas.
 */
export async function loadConversationHistory(
  conversationId: string,
  staffEmail: string,
  db: any
): Promise<ConversationMessage[]> {
  const result = await db
    .prepare(
      `SELECT m.id, m.role, m.content, m.tool_call_json, m.created_at
       FROM ai_messages m
       INNER JOIN ai_conversations c ON c.id = m.conversation_id
       WHERE c.id = ? AND c.staff_email = ?
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .bind(conversationId, staffEmail.toLowerCase(), MAX_STORED_MESSAGES)
    .all();

  const rows: any[] = Array.isArray(result?.results)
    ? result.results
    : Array.isArray(result)
      ? result
      : [];

  const messages: ConversationMessage[] = rows.map((row: any) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    toolCallJson: row.tool_call_json,
    createdAt: Number(row.created_at),
  }));

  // Return in chronological order
  return messages.reverse();
}

/**
 * Persists a message to ai_messages, maintaining bounded length and counts.
 */
export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  toolCallJson: string | null = null,
  db: any
): Promise<void> {
  const messageId = randomUUID();
  const cappedContent = content.slice(0, MAX_MESSAGE_LENGTH);
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO ai_messages (id, conversation_id, role, content, tool_call_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(messageId, conversationId, role, cappedContent, toolCallJson, now)
    .run();

  await db
    .prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?')
    .bind(now, conversationId)
    .run();
}

/**
 * Evaluates whether planned actions require teacher confirmation:
 * 1. Read-only tools NEVER require confirmation (auto-executed)
 * 2. Destructive actions (delete) ALWAYS require confirmation
 * 3. Publish/unpublish ALWAYS requires confirmation
 * 4. Price/financial updates ALWAYS require confirmation
 * 5. More than 2 mutations ALWAYS require confirmation
 * 6. 1–2 low-risk reversible draft mutations can execute directly
 * 7. Unknown tools NEVER require confirmation (rejected at validation boundary)
 */
export function evaluatePlanRisk(
  actions: Array<{ tool: string; parameters: Record<string, any> }>
): { requiresConfirmation: boolean; reason?: string } {
  if (actions.length === 0) {
    return { requiresConfirmation: false };
  }

  // Escalation: >2 mutations require plan preview and confirmation
  if (actions.length > 2) {
    return {
      requiresConfirmation: true,
      reason: `Multi-action plan contains ${actions.length} actions; bulk changes require teacher approval.`,
    };
  }

  for (const action of actions) {
    const tool = getToolDefinition(action.tool as AiToolName);
    if (!tool) {
      return { requiresConfirmation: false, reason: `Unknown tool ${action.tool}` };
    }

    // Read-only tools are always low risk and never require confirmation
    if (tool.mutationType === 'read' || tool.confirmationPolicy === 'none') {
      continue;
    }

    if (tool.riskLevel === 'critical' || tool.riskLevel === 'high') {
      return {
        requiresConfirmation: true,
        reason: `Action "${tool.name}" is classified as ${tool.riskLevel} risk and requires mandatory confirmation.`,
      };
    }

    if (tool.confirmationPolicy === 'mandatory' || tool.confirmationPolicy === 'preview_required') {
      return {
        requiresConfirmation: true,
        reason: `Action "${tool.name}" requires teacher confirmation policy: ${tool.confirmationPolicy}`,
      };
    }
  }

  return { requiresConfirmation: false };
}

/**
 * Formats data-minimized outputs from read-only tools into Arabic assistant responses.
 */
export function formatReadToolOutput(actionsExecuted: Array<{ tool: string; result: any }>): string | null {
  for (const item of actionsExecuted) {
    if ((item.tool === 'list_courses' || item.tool === 'search_courses') && Array.isArray(item.result?.result?.courses)) {
      const courses = item.result.result.courses;
      if (courses.length === 0) {
        return 'لا توجد كورسات مسجلة حالياً في النظام.';
      }
      const lines = courses.map((c: any, idx: number) => {
        const statusAr = c.status === 'published' ? 'منشور' : 'مسودة';
        const gradeStr = c.grade ? ` | الصف: ${c.grade}` : '';
        return `${idx + 1}. **${c.title}** (الحالة: ${statusAr}${gradeStr})`;
      });
      return `إليك قائمة الكورسات الموجودة حاليًا:\n${lines.join('\n')}`;
    }
    if ((item.tool === 'get_course' || item.tool === 'get_course_structure') && item.result?.result?.course) {
      const c = item.result.result.course;
      const statusAr = c.status === 'published' ? 'منشور' : 'مسودة';
      const gradeStr = c.grade ? `\n- **الصف**: ${c.grade}` : '';
      return `بيانات الدورة:\n- **العنوان**: ${c.title}\n- **الحالة**: ${statusAr}${gradeStr}\n- **السعر**: ${c.price || 0} ج.م`;
    }
  }
  return null;
}


/**
 * Main AI Orchestrator Entrypoint
 */
export async function orchestrateAdminChat(
  options: OrchestrateChatOptions
): Promise<OrchestratorResult> {
  const db = options.db || getDatabase();
  const staffEmail = options.actor.email.toLowerCase();
  const rawMessage = options.message.trim().slice(0, MAX_MESSAGE_LENGTH);

  if (!rawMessage) {
    throw new Error('رسالة المعلم لا يمكن أن تكون فارغة');
  }

  // 1. Resolve or create conversation
  let conversationId = options.conversationId;
  if (!conversationId) {
    conversationId = randomUUID();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO ai_conversations (id, staff_email, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(conversationId, staffEmail, rawMessage.slice(0, 50), now, now)
      .run();
  } else {
    // Verify conversation ownership
    const conv = await db
      .prepare('SELECT id FROM ai_conversations WHERE id = ? AND staff_email = ?')
      .bind(conversationId, staffEmail)
      .first();

    if (!conv) {
      // Re-create if missing
      const now = Date.now();
      await db
        .prepare(
          'INSERT INTO ai_conversations (id, staff_email, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(conversationId, staffEmail, rawMessage.slice(0, 50), now, now)
        .run();
    }
  }

  // Save user message
  await saveMessage(conversationId, 'user', rawMessage, null, db);

  // 2. Validate contextual entity references
  const resolved = await resolveContext(options.context, db);

  // 3. Load bounded history (user & assistant messages only)
  const history = await loadConversationHistory(conversationId, staffEmail, db);

  // 4. Generate plan through local provider with deterministic validation & bounded repair
  const provider = options.provider || (await getAiProvider());
  const queue = getGlobalAiQueue();

  const planContext = {
    course: resolved.courseInfo,
    lecture: resolved.lectureInfo,
    assessment: resolved.assessmentInfo,
    contextIds: resolved.validatedContext,
    recentHistory: history.slice(-6).map((m) => `${m.role}: ${m.content}`),
  };

  const planResult: PlanResult & { isInvalidToolPlan?: boolean } = await queue.enqueue(
    async (signal) => {
      const initialPlan = await provider.generatePlan(rawMessage, planContext, {
        signal: options.signal || signal,
      });

      // Server-side validation boundary: verify all model-produced actions use registered tools
      const rawActions = Array.isArray(initialPlan?.actions) ? initialPlan.actions : [];
      const unknownTools = rawActions
        .filter((a) => !isRegisteredTool(a.tool))
        .map((a) => a.tool);

      if (unknownTools.length > 0) {
        // Perform ONE bounded repair attempt using canonical tools
        const repairPrompt = getRepairPlanPrompt(unknownTools, rawMessage);
        try {
          const repairedPlan = await provider.generatePlan(repairPrompt, planContext, {
            signal: options.signal || signal,
          });
          const repairedActions = Array.isArray(repairedPlan?.actions) ? repairedPlan.actions : [];
          const stillUnknown = repairedActions.filter((a) => !isRegisteredTool(a.tool));

          if (stillUnknown.length === 0) {
            // Repair succeeded!
            return repairedPlan;
          }
        } catch {
          // If repair fails, fall through to safe invalid plan
        }

        // Repaired plan is still invalid: return safe non-actionable response marker
        return {
          planText: SAFE_FALLBACK_REPLY,
          actions: [],
          explanation: 'Plan contains unregistered tools that could not be repaired.',
          isInvalidToolPlan: true,
        };
      }

      return initialPlan;
    },
    { signal: options.signal }
  );

  // If the plan was invalid and could not be repaired:
  if ((planResult as any).isInvalidToolPlan) {
    const reply = SAFE_FALLBACK_REPLY;
    await saveMessage(conversationId, 'assistant', reply, null, db);
    return {
      conversationId,
      reply,
      actionsExecuted: [],
      requiresConfirmation: false,
    };
  }

  // Filter actions to ensure ONLY canonical registered tools proceed
  const registeredActions = (planResult.actions || []).filter((a) => isRegisteredTool(a.tool));
  if ((planResult.actions || []).length > 0 && registeredActions.length === 0) {
    const reply = SAFE_FALLBACK_REPLY;
    await saveMessage(conversationId, 'assistant', reply, null, db);
    return {
      conversationId,
      reply,
      actionsExecuted: [],
      requiresConfirmation: false,
    };
  }

  const actions = registeredActions.map((a) => {
    // Inject validated contextual IDs if not provided by model
    const params = { ...a.parameters };
    if (!params.courseId && resolved.validatedContext.courseId) {
      params.courseId = resolved.validatedContext.courseId;
    }
    if (!params.lectureId && resolved.validatedContext.lectureId) {
      params.lectureId = resolved.validatedContext.lectureId;
    }
    if (!params.assessmentId && resolved.validatedContext.assessmentId) {
      params.assessmentId = resolved.validatedContext.assessmentId;
    }
    return {
      tool: a.tool,
      parameters: params,
    };
  });

  // 5. Evaluate risk and confirmation escalation
  const riskEval = evaluatePlanRisk(actions);

  if (riskEval.requiresConfirmation && actions.length > 0) {
    // Prepare confirmation token and store canonical payload server-side
    const isCompound = actions.length > 1;
    const actionType = isCompound ? 'compound_plan' : actions[0].tool;
    const actionPayload = isCompound ? { steps: actions } : actions[0].parameters;

    const preview = generateActionPreview(actionType, actionPayload);
    const tokenResult = await createConfirmationRequest({
      actor: {
        email: options.actor.email,
        role: options.actor.role || 'staff',
        permissions: options.actor.permissions,
      },
      actionType,
      actionPayload,
      preview,
      secret: options.secret,
      db,
    });

    const reply = planResult.planText || `تم إعداد خطة العمل (${preview.titleAr}). يرجى مراجعة التفاصيل وتأكيد التنفيذ.`;

    await saveMessage(conversationId, 'assistant', reply, JSON.stringify({ tokenResult }), db);

    return {
      conversationId,
      reply,
      requiresConfirmation: true,
      confirmationToken: tokenResult.token,
      preview,
    };
  }

  // 6. Direct execution for 0–2 low-risk reversible actions (including read-only tools)
  const actionsExecuted: Array<{ tool: string; result: any }> = [];

  if (actions.length > 0) {
    for (const action of actions) {
      const execResult = await executeTool({
        toolName: action.tool as AiToolName,
        args: action.parameters,
        actor: options.actor,
        context: {
          db,
          confirmationSatisfied: false, // Low-risk tools only
        },
      });
      actionsExecuted.push({ tool: action.tool, result: execResult });
    }
  }

  const readToolFormatted = formatReadToolOutput(actionsExecuted);

  const reply =
    readToolFormatted ||
    planResult.planText ||
    (actionsExecuted.length > 0
      ? `تم تنفيذ الإجراء بنجاح: ${actionsExecuted.map((a) => a.tool).join(', ')}`
      : 'أنا جاهز لمساعدتك في إدارة الدورات والامتحانات والمحاضرات.');

  await saveMessage(
    conversationId,
    'assistant',
    reply,
    actionsExecuted.length > 0 ? JSON.stringify(actionsExecuted) : null,
    db
  );

  return {
    conversationId,
    reply,
    actionsExecuted,
    requiresConfirmation: false,
  };

}
