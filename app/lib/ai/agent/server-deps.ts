import 'server-only';
import { getDatabase, getPrivateStorage } from '../../platform';
import { getAiProvider } from '../ai-provider';
import { createConfirmationRequest } from '../confirmation.server';
import { saveMessage } from '../orchestrator';
import {
  ToolExecutionError,
  executeTool,
  hasStaffPermission,
  validateToolArguments,
  type StaffActor,
} from '../tool-executor';
import { getToolDefinition } from '../tool-registry';
import type { AgentActor, AgentDeps, AgentStats } from './agent';
import { stagedImageKey } from './image-staging';
import type { DeleteCandidate, DeleteImpact } from './delete-impact';
import { DatabaseSessionStore } from './session';
import { createExtraction, getExtraction, loadWindows, summarizeExtraction } from './exam-extraction-store';

/**
 * Production wiring of the agent's dependencies.
 *
 * - Reads go through `executeTool`, so they use the same registry validation and
 *   permission checks as every other AI tool.
 * - The only write-ish dependency is `createConfirmation`, which stores a pending,
 *   signed confirmation. Nothing is executed here.
 */
export async function createServerAgentDeps(
  actor: AgentActor,
  options: { db?: ReturnType<typeof getDatabase> } = {}
): Promise<AgentDeps> {
  const db = options.db ?? getDatabase();
  const staffActor: StaffActor = {
    email: actor.email,
    name: actor.name,
    role: actor.role,
    permissions: actor.permissions as StaffActor['permissions'],
  };

  const read = async (toolName: string, args: Record<string, unknown> = {}) => {
    const outcome = await executeTool({ toolName, args, actor: staffActor, context: { db } });
    return outcome.result;
  };

  const provider = await getAiProvider().catch(() => null);

  return {
    store: new DatabaseSessionStore(db as never),
    provider,

    readTools: {
      async listGrades() {
        const result = await read('list_grades');
        return Array.isArray(result.grades) ? (result.grades as string[]) : [];
      },
      async listCourses() {
        const result = await read('list_courses');
        return (Array.isArray(result.courses) ? result.courses : []).map((course) => {
          const row = course as Record<string, unknown>;
          return {
            id: String(row.id),
            title: String(row.title ?? ''),
            grade: row.grade ? String(row.grade) : undefined,
            status: row.status ? String(row.status) : undefined,
            price: typeof row.price === 'number' ? row.price : Number(row.price ?? 0),
          };
        });
      },
      async listLectureTitles(courseId: string) {
        const result = await read('list_lectures', { courseId });
        return (Array.isArray(result.lectures) ? result.lectures : []).map((lecture) =>
          String((lecture as Record<string, unknown>).title ?? '')
        );
      },
      async stats(metric: string, courseId?: string): Promise<AgentStats> {
        const result = await read('get_platform_stats', { metric, ...(courseId ? { courseId } : {}) });
        return {
          total: Number(result.total ?? 0),
          courses: Array.isArray(result.courses) ? (result.courses as AgentStats['courses']) : undefined,
        };
      },
    },

    deleteTools: {
      async find(kind, query) {
        const result = await read('find_items_for_deletion', { kind, query });
        return Array.isArray(result.items) ? (result.items as DeleteCandidate[]) : [];
      },
      async impact(kind, id) {
        try {
          const result = await read('get_delete_impact', { kind, id });
          return (result.impact as DeleteImpact | undefined) ?? null;
        } catch (error) {
          if ((error as { status?: number })?.status === 404) return null;
          throw error;
        }
      },
    },

    async createConfirmation({ actionType, payload, preview, expiresInMs }) {
      // Fail early (while the teacher is still in the chat) if the proposed
      // arguments or the actor's permissions would be rejected at execution time.
      const steps =
        actionType === 'compound_plan'
          ? ((payload.steps as Array<{ tool: string; parameters: Record<string, unknown> }>) ?? [])
          : [{ tool: actionType, parameters: payload }];
      for (const step of steps) {
        const definition = getToolDefinition(step.tool);
        if (!definition) throw new ToolExecutionError(`Tool '${step.tool}' is not registered`, 'UNKNOWN_TOOL', 404);
        validateToolArguments(definition, step.parameters);
        if (!hasStaffPermission(staffActor, definition.requiredPermission)) {
          throw new ToolExecutionError('ليس لديك صلاحية تنفيذ هذا الإجراء', 'FORBIDDEN', 403);
        }
      }
      const created = await createConfirmationRequest({
        actor: { email: actor.email, role: actor.role || 'staff', permissions: actor.permissions },
        actionType,
        actionPayload: payload,
        preview,
        expiresInMs,
        db,
      });
      return { token: created.token };
    },

    async supersedeConfirmation(token: string) {
      const tokenId = token.split('.')[0];
      await db
        .prepare(
          "UPDATE ai_confirmations SET state = 'failed', error_message = 'superseded by edit or cancel' WHERE id = ? AND staff_email = ? AND state = 'pending'"
        )
        .bind(tokenId, actor.email.toLowerCase())
        .run();
    },

    async loadConfirmation(token: string) {
      const tokenId = token.split('.')[0];
      const row = await db
        .prepare(
          'SELECT state, action_type, result_json, error_message FROM ai_confirmations WHERE id = ? AND staff_email = ?'
        )
        .bind(tokenId, actor.email.toLowerCase())
        .first<{ state: string; action_type: string; result_json: string | null; error_message: string | null }>();
      if (!row) return null;
      let result: unknown = null;
      try {
        result = row.result_json ? JSON.parse(row.result_json) : null;
      } catch {
        result = null;
      }
      return { state: row.state, actionType: row.action_type, result, errorMessage: row.error_message };
    },

    async stagedImageExists(uploadId: string) {
      try {
        const stored = await getPrivateStorage().get(stagedImageKey(actor.email, uploadId));
        return Boolean(stored);
      } catch {
        return false;
      }
    },

    examExtraction: {
      async create(conversationId: string, pages: string[]) {
        const record = await createExtraction(db, { conversationId, email: actor.email, pages });
        return { id: record.id, windowCount: record.windows.length };
      },
      async summary(extractionId: string) {
        const record = await getExtraction(db, extractionId, actor.email);
        if (!record) return null;
        const summary = summarizeExtraction(record, await loadWindows(db, record.id));
        return { summary, pageCount: record.pages.length, windowCount: record.windows.length };
      },
    },

    persist: {
      async ensureConversation(conversationId: string, title: string) {
        const email = actor.email.toLowerCase();
        const existing = await db
          .prepare('SELECT id FROM ai_conversations WHERE id = ? AND staff_email = ?')
          .bind(conversationId, email)
          .first();
        if (existing) return;
        const now = Date.now();
        await db
          .prepare(
            'INSERT INTO ai_conversations (id, staff_email, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          )
          .bind(conversationId, email, title, now, now)
          .run();
      },
      async saveMessage(conversationId, role, content, toolCallJson) {
        await saveMessage(conversationId, role, content, toolCallJson, db);
      },
    },
  };
}
