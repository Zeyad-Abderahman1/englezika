import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database';
import { getAiProvider } from './local-ai-provider';
import type { LocalAiProvider, PlanResult } from './local-ai-provider';
import { getGlobalAiQueue } from './ai-queue';
import { getToolDefinition, isRegisteredTool, toolAcceptsParameter, type AiToolName } from './tool-registry';

export { toolAcceptsParameter };
import { executeTool, validateToolArguments } from './tool-executor';
import { createConfirmationRequest } from './confirmation.server';
import { generateActionPreview, type ConfirmationPreview } from './preview-generator';
import type { StaffActor } from './tool-executor';
import { getSchemaRepairPrompt, getEmptyActionRepairPrompt, SAFE_FALLBACK_REPLY } from './planner-prompt';
import { resolveSafeReadIntent, isConversationalMessage } from './read-intent-resolver';
import { isToolCompatibleWithRequest, hasPriceIntent } from './semantic-intent-guard';

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

function normalizeEntityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '') // remove Arabic diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ResolvedContextResult {
  courseInfo?: string;
  lectureInfo?: string;
  assessmentInfo?: string;
  validatedContext: OrchestratorContext;
  courseTitle?: string;
  ambiguousEntity?: boolean;
  ambiguityReason?: string;
}

/**
 * Validates and resolves course/lecture/assessment references from server database.
 * The model NEVER invents trusted entity IDs.
 */
export async function resolveContext(
  context: OrchestratorContext | undefined,
  db: any,
  message?: string
): Promise<ResolvedContextResult> {
  const result: ResolvedContextResult = { validatedContext: {} };

  if (context?.courseId && typeof context.courseId === 'string') {
    const course = await db
      .prepare('SELECT id, title, grade, price, status FROM courses WHERE id = ?')
      .bind(context.courseId.trim())
      .first();

    if (course) {
      result.validatedContext.courseId = course.id;
      result.courseTitle = course.title;
      const status = course.status || (course.is_active === 1 ? 'published' : 'draft');
      result.courseInfo = `Current Course: "${course.title}" (ID: ${course.id}, Grade: ${course.grade}, Price: ${course.price} EGP, Status: ${status})`;
    }
  }

  // Safe server-side entity resolution from user message when context courseId is not explicitly bound
  if (!result.validatedContext.courseId && db && message && typeof message === 'string') {
    let allCourses: any[] = [];
    try {
      if (typeof db.query === 'function') {
        const qRes = await db.query('SELECT id, title, grade, price, status FROM courses');
        allCourses = qRes?.rows ? qRes.rows : (Array.isArray(qRes) ? qRes : []);
      } else if (typeof db.prepare === 'function') {
        const qRes = await db.prepare('SELECT id, title, grade, price, status FROM courses').all();
        allCourses = Array.isArray(qRes?.results) ? qRes.results : (Array.isArray(qRes) ? qRes : []);
      }
    } catch {
      allCourses = [];
    }

    if (allCourses.length > 0) {
      const normMessage = normalizeEntityText(message);
      const candidateMatches: any[] = [];

      // Extract candidate entity phrase if user explicitly named a course after "كورس" or "دورة"
      const mentionMatch = message.match(/(?:كورس|دورة|course)\s+(.+?)(?:\s+(?:إلى|الى|بـ|ب|يبقى|يكون|لـ|ل|to|for)\s+\d+|\s*$)/i);
      const extractedMention = mentionMatch ? normalizeEntityText(mentionMatch[1]) : '';

      for (const c of allCourses) {
        if (!c.title) continue;
        const normTitle = normalizeEntityText(c.title);
        if (normTitle.length >= 2 && normMessage.includes(normTitle)) {
          candidateMatches.push(c);
          continue;
        }
        const strippedTitle = normTitle.replace(/^(?:كورس|دورة)\s+/, '');
        if (strippedTitle.length >= 3 && normMessage.includes(strippedTitle)) {
          candidateMatches.push(c);
          continue;
        }
        if (extractedMention.length >= 3 && (normTitle.includes(extractedMention) || strippedTitle.includes(extractedMention))) {
          candidateMatches.push(c);
        }
      }

      if (candidateMatches.length === 1) {
        const course = candidateMatches[0];
        result.validatedContext.courseId = course.id;
        result.courseTitle = course.title;
        const status = course.status || (course.is_active === 1 ? 'published' : 'draft');
        result.courseInfo = `Current Course: "${course.title}" (ID: ${course.id}, Grade: ${course.grade}, Price: ${course.price} EGP, Status: ${status})`;
      } else if (candidateMatches.length > 1) {
        // Multiple matches: check if one is strictly more specific (longer full title)
        const sorted = [...candidateMatches].sort((a, b) => b.title.length - a.title.length);
        const longest = sorted[0];
        const secondLongest = sorted[1];
        if (
          normalizeEntityText(longest.title).length > normalizeEntityText(secondLongest.title).length &&
          normMessage.includes(normalizeEntityText(longest.title))
        ) {
          result.validatedContext.courseId = longest.id;
          result.courseTitle = longest.title;
          const status = longest.status || (longest.is_active === 1 ? 'published' : 'draft');
          result.courseInfo = `Current Course: "${longest.title}" (ID: ${longest.id}, Grade: ${longest.grade}, Price: ${longest.price} EGP, Status: ${status})`;
        } else {
          result.ambiguousEntity = true;
          result.ambiguityReason = 'يوجد أكثر من كورس مطابق للاسم المحدد. يرجى تحديد الكورس بدقة.';
        }
      } else {
        // If the user explicitly requested a price update on "الكورس" without specifying title:
        const hasPrice = hasPriceIntent(message);
        if (hasPrice) {
          if (allCourses.length === 1) {
            const course = allCourses[0];
            result.validatedContext.courseId = course.id;
            result.courseTitle = course.title;
            const status = course.status || (course.is_active === 1 ? 'published' : 'draft');
            result.courseInfo = `Current Course: "${course.title}" (ID: ${course.id}, Grade: ${course.grade}, Price: ${course.price} EGP, Status: ${status})`;
          } else if (allCourses.length > 1) {
            result.ambiguousEntity = true;
            result.ambiguityReason = 'أحتاج إلى تحديد الكورس المقصود قبل تعديل السعر، حيث يوجد أكثر من كورس مسجل.';
          } else {
            result.ambiguousEntity = true;
            result.ambiguityReason = 'لم أتمكن من العثور على الكورس المطلوب. يرجى التأكد من اسم الكورس بدقة.';
          }
        }
      }
    }
  }

  if (context?.lectureId && typeof context.lectureId === 'string') {
    const lecture = await db
      .prepare('SELECT id, course_id, title, is_active FROM videos WHERE id = ?')
      .bind(context.lectureId.trim())
      .first();

    if (lecture) {
      result.validatedContext.lectureId = lecture.id;
      result.lectureInfo = `Current Lecture: "${lecture.title}" (ID: ${lecture.id}, Course ID: ${lecture.course_id})`;
    }
  }

  if (context?.assessmentId && typeof context.assessmentId === 'string') {
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
 * Injects validated server-side contextual IDs into action parameters ONLY IF:
 * 1. The parameter was not explicitly provided by the model.
 * 2. The authoritative registered tool schema explicitly declares and accepts that parameter.
 *
 * CRITICAL SECURITY INVARIANT:
 * Model-generated parameters (including any invalid or unknown keys) MUST NOT be stripped or sanitized;
 * they must be preserved so strict schema validation downstream rejects them.
 */
export function injectCompatibleContext(
  toolName: string,
  modelParameters: Record<string, unknown> | undefined,
  validatedContext: OrchestratorContext | undefined
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...(modelParameters || {}) };
  if (!validatedContext) {
    return params;
  }

  const tool = getToolDefinition(toolName);
  if (!tool?.contextBindings) {
    return params;
  }

  for (const [targetParameter, contextKey] of Object.entries(tool.contextBindings)) {
    if (!toolAcceptsParameter(toolName, targetParameter)) {
      continue;
    }

    const value = validatedContext[contextKey];
    if (value !== undefined && value !== null && value !== '') {
      const modelProvidedParameter = Object.prototype.hasOwnProperty.call(params, targetParameter);
      if (!modelProvidedParameter) {
        params[targetParameter] = value;
      }
    }
  }

  return params;
}

export interface PlanConformanceResult {
  valid: boolean;
  errors: string[];
  missingRequiredFields: string[];
}

/**
 * Validates model plans before risk evaluation or execution. The model payload is
 * never mutated: trusted context is added to a copy and the executor's strict,
 * registry-backed validator remains the authoritative argument boundary.
 */
export function validatePlannedActions(
  actions: Array<{ tool: string; parameters?: Record<string, unknown> }>,
  validatedContext?: OrchestratorContext
): PlanConformanceResult {
  const errors: string[] = [];
  const missingRequiredFields: string[] = [];

  for (const action of actions) {
    const tool = getToolDefinition(action.tool);
    if (!tool) {
      errors.push(`Tool '${action.tool}' is not registered`);
      continue;
    }

    const parameters = injectCompatibleContext(action.tool, action.parameters, validatedContext);
    try {
      validateToolArguments(tool, parameters);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid tool arguments';
      errors.push(message);
      const missing = message.match(/^Missing required parameter '([^']+)'/);
      if (missing) missingRequiredFields.push(missing[1]);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingRequiredFields,
  };
}

function userFacingPlanFailure(result: PlanConformanceResult): string {
  const fieldLabels: Record<string, string> = {
    grade: 'الصف الدراسي',
    courseId: 'الكورس المقصود',
    videoId: 'المحاضرة المقصودة',
    assessmentId: 'التقييم المقصود',
    examId: 'الامتحان المقصود',
    title: 'العنوان',
    youtubeUrl: 'رابط فيديو يوتيوب',
    questions: 'الأسئلة',
    items: 'ترتيب العناصر المطلوب',
  };
  const labels = [...new Set(result.missingRequiredFields)].map((field) => fieldLabels[field] || field);
  if (labels.length > 0) {
    return `أحتاج إلى تحديد ${labels.join(' و')} قبل تنفيذ الطلب.`;
  }
  return SAFE_FALLBACK_REPLY;
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
  const resolved = await resolveContext(options.context, db, rawMessage);

  // If entity reference is ambiguous or unresolvable, clarify before mutating
  if (resolved.ambiguousEntity) {
    const reply = resolved.ambiguityReason || 'يرجى تحديد الكورس المقصود بدقة قبل المتابعة.';
    await saveMessage(conversationId, 'assistant', reply, null, db);
    return {
      conversationId,
      reply,
      actionsExecuted: [],
      requiresConfirmation: false,
    };
  }

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

  const planResult: PlanResult & {
    isInvalidToolPlan?: boolean;
    isEmptyActionRecovery?: boolean;
    failureReply?: string;
  } = await queue.enqueue(
    async (signal) => {
      const initialPlan = await provider.generatePlan(rawMessage, planContext, {
        signal: options.signal || signal,
      });

      // Pre-execution conformance boundary: validate tool names and arguments without mutation.
      const rawActions = Array.isArray(initialPlan?.actions) ? initialPlan.actions : [];
      if (rawActions.length > 0) {
        const initialValidation = validatePlannedActions(rawActions, resolved.validatedContext);
        for (const action of rawActions) {
          if (isRegisteredTool(action.tool)) {
            const compat = isToolCompatibleWithRequest(rawMessage, action.tool);
            if (!compat.compatible) {
              initialValidation.valid = false;
              initialValidation.errors.push(compat.reason || `Tool '${action.tool}' is semantically incompatible with user request`);
            }
          }
        }

        if (!initialValidation.valid) {
          // Lock tool name ONLY if initial action is a registered tool compatible with the request
          const initialTool = rawActions[0]?.tool;
          const isInitialToolValid = isRegisteredTool(initialTool) && isToolCompatibleWithRequest(rawMessage, initialTool).compatible;
          const lockedToolName = isInitialToolValid ? initialTool : undefined;

          // Perform exactly ONE bounded re-plan using registry-derived schemas.
          const repairPrompt = getSchemaRepairPrompt(rawMessage, initialValidation.errors, lockedToolName);
          let repairedValidation = initialValidation;
          try {
            const repairedPlan = await provider.generatePlan(repairPrompt, planContext, {
              signal: options.signal || signal,
            });
            const repairedActions = Array.isArray(repairedPlan?.actions) ? repairedPlan.actions : [];

            // 1. Invariant: Tool substitution during repair is strictly rejected
            if (lockedToolName) {
              const substituted = repairedActions.some((a) => a.tool !== lockedToolName);
              if (substituted) {
                return {
                  planText: SAFE_FALLBACK_REPLY,
                  actions: [],
                  explanation: `Plan repair rejected: tool substitution from '${lockedToolName}' is strictly prohibited.`,
                  isInvalidToolPlan: true,
                  failureReply: SAFE_FALLBACK_REPLY,
                };
              }
            }

            // 2. Semantic Intent Guard on repaired actions
            for (const action of repairedActions) {
              const compat = isToolCompatibleWithRequest(rawMessage, action.tool);
              if (!compat.compatible) {
                return {
                  planText: SAFE_FALLBACK_REPLY,
                  actions: [],
                  explanation: `Repaired plan rejected by semantic intent guard: ${compat.reason}`,
                  isInvalidToolPlan: true,
                  failureReply: SAFE_FALLBACK_REPLY,
                };
              }
            }

            repairedValidation = validatePlannedActions(repairedActions, resolved.validatedContext);

            if (repairedActions.length > 0 && repairedValidation.valid) {
              return repairedPlan;
            }
          } catch {
            // If repair fails, fall through to the safe non-actionable result.
          }

          return {
            planText: userFacingPlanFailure(repairedValidation),
            actions: [],
            explanation: 'Plan arguments failed registry conformance after one repair attempt.',
            isInvalidToolPlan: true,
            failureReply: userFacingPlanFailure(repairedValidation),
          };
        }
      }

      // Empty-action recovery: planner returned zero actions
      if (rawActions.length === 0 && !isConversationalMessage(rawMessage)) {
        // Attempt ONE bounded empty-action repair replan
        const emptyRepairPrompt = getEmptyActionRepairPrompt(rawMessage);
        try {
          const repairedPlan = await provider.generatePlan(emptyRepairPrompt, planContext, {
            signal: options.signal || signal,
          });
          const repairedActions = Array.isArray(repairedPlan?.actions) ? repairedPlan.actions : [];
          const validRepaired = repairedActions.filter((a) => {
            if (!isRegisteredTool(a.tool)) return false;
            return isToolCompatibleWithRequest(rawMessage, a.tool).compatible;
          });

          if (validRepaired.length > 0) {
            const repairedValidation = validatePlannedActions(validRepaired, resolved.validatedContext);
            if (repairedValidation.valid) {
              return { ...repairedPlan, actions: validRepaired };
            }
          }
        } catch {
          // If repair fails, fall through to deterministic fallback
        }

        // Deterministic safe read-only fallback
        const safeIntent = resolveSafeReadIntent(rawMessage);
        if (safeIntent) {
          return {
            planText: '',
            actions: [{ tool: safeIntent.tool, parameters: safeIntent.parameters }],
            explanation: 'Deterministic safe read-only fallback resolved intent.',
            isEmptyActionRecovery: true,
          };
        }

        // Not a read-only intent: return safe clarification
        return {
          planText: SAFE_FALLBACK_REPLY,
          actions: [],
          explanation: 'Empty-action plan could not be recovered.',
          isInvalidToolPlan: true,
        };
      }

      return initialPlan;
    },
    { signal: options.signal }
  );

  // If the plan was invalid and could not be repaired:
  if ((planResult as any).isInvalidToolPlan) {
    const reply = planResult.failureReply || planResult.planText || SAFE_FALLBACK_REPLY;
    await saveMessage(conversationId, 'assistant', reply, null, db);
    return {
      conversationId,
      reply,
      actionsExecuted: [],
      requiresConfirmation: false,
    };
  }

  // Filter actions to ensure ONLY canonical registered tools proceed and pass semantic guard
  const registeredActions = (planResult.actions || []).filter((a) => {
    if (!isRegisteredTool(a.tool)) return false;
    return isToolCompatibleWithRequest(rawMessage, a.tool).compatible;
  });
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
    // Inject validated contextual IDs ONLY if accepted by authoritative tool schema
    const params = injectCompatibleContext(a.tool, a.parameters, resolved.validatedContext);
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

    const preview = generateActionPreview(actionType, actionPayload, {
      courseTitle: resolved.courseTitle,
    });
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

    const reply =
      planResult.planText ||
      `تم إعداد خطة العمل (${preview.descriptionAr || preview.titleAr}). يرجى مراجعة التفاصيل وتأكيد التنفيذ.`;

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
