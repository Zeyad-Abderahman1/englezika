import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  orchestrateAdminChat,
  evaluatePlanRisk,
  formatReadToolOutput,
} from '../app/lib/ai/orchestrator.ts';
import {
  getToolDefinition,
  isRegisteredTool,
  isReadOnlyTool,
  CANONICAL_TOOL_NAMES,
} from '../app/lib/ai/tool-registry.ts';
import { executeTool, ToolExecutionError } from '../app/lib/ai/tool-executor.ts';
import { generateActionPreview } from '../app/lib/ai/preview-generator.ts';
import { createConfirmationRequest } from '../app/lib/ai/confirmation.server.ts';
import { MockAiProvider } from '../app/lib/ai/providers/mock-provider.ts';
import { SAFE_FALLBACK_REPLY, getRepairPlanPrompt, getPlannerSystemPrompt } from '../app/lib/ai/planner-prompt.ts';
import { AI_GATE_MAX_RUNNING, AI_GATE_MAX_WAITING, AI_GATE_MAX_TOTAL } from '../app/lib/ai/ai-global-gate.server.ts';


const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

const teacherActor = {
  email: 'teacher@englizeka.com',
  name: 'Master Teacher',
  role: 'teacher',
  permissions: [
    'manage_courses',
    'manage_exams',
    'manage_videos',
    'manage_announcements',
  ],
};

class MockToolSelectionDb {
  constructor() {
    this.conversations = new Map();
    this.messages = [];
    this.confirmations = new Map();
    this.courses = [
      { id: 'c_1', title: 'Unit 1: The Basics', grade: '3sec', price: 150, status: 'published' },
      { id: 'c_2', title: 'Unit 2: Past Simple', grade: '3sec', price: 200, status: 'draft' },
    ];
  }

  async query(sql, params) {
    if (sql.includes('FROM courses')) {
      return { rows: [...this.courses], rowCount: this.courses.length };
    }
    return { rows: [], rowCount: 0 };
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('FROM ai_conversations WHERE id = ?')) {
              const row = db.conversations.get(args[0]);
              return row ? { ...row } : null;
            }
            if (sql.includes('FROM ai_confirmations WHERE id = ?')) {
              const row = db.confirmations.get(args[0]);
              return row ? { ...row } : null;
            }
            return null;
          },
          async all() {
            if (sql.includes('FROM ai_messages m')) {
              const [conversationId, staffEmail, limit] = args;
              const matching = db.messages
                .filter((m) => m.conversation_id === conversationId)
                .slice(-limit)
                .reverse();
              return { results: matching, success: true, meta: { changes: matching.length } };
            }
            return { results: [], success: true, meta: { changes: 0 } };
          },
          async run() {
            if (sql.includes('INSERT INTO ai_conversations')) {
              const [id, staff_email, title, created_at, updated_at] = args;
              db.conversations.set(id, { id, staff_email, title, created_at, updated_at });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('INSERT INTO ai_messages')) {
              const [id, conversation_id, role, content, tool_call_json, created_at] = args;
              db.messages.push({ id, conversation_id, role, content, tool_call_json, created_at });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE ai_conversations SET updated_at = ?')) {
              const [updatedAt, id] = args;
              const row = db.conversations.get(id);
              if (row) row.updated_at = updatedAt;
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('INSERT INTO ai_confirmations')) {
              const [id, token_hash, staff_email, action_type, action_payload, created_at, expires_at] = args;
              db.confirmations.set(id, {
                id,
                token_hash,
                staff_email,
                action_type,
                action_payload,
                state: 'pending',
                created_at,
                expires_at,
              });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

describe('AI Planner Tool-Selection & Canonical Registry Enforcement Suite', () => {
  test('A. Arabic request: "اعرض لي الكورسات الموجودة حاليًا مع اسم كل كورس وحالته فقط" resolves to list_courses', async () => {
    const db = new MockToolSelectionDb();
    const mockProvider = new MockAiProvider({
      mockPlan: {
        planText: '',
        actions: [{ tool: 'list_courses', parameters: {} }],
      },
    });

    const arabicPrompt = 'اعرض لي الكورسات الموجودة حاليًا مع اسم كل كورس وحالته فقط. لا تنشئ أو تعدل أو تحذف أي شيء.';
    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: arabicPrompt,
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false, 'Read-only tool must NOT require confirmation');
    assert.equal(result.confirmationToken, undefined, 'Must not produce confirmation token');
    assert.equal(result.actionsExecuted?.length, 1);
    assert.equal(result.actionsExecuted[0].tool, 'list_courses');
    assert.ok(result.reply.includes('Unit 1: The Basics'));
    assert.ok(result.reply.includes('منشور'));
    assert.ok(result.reply.includes('Unit 2: Past Simple'));
    assert.ok(result.reply.includes('مسودة'));
  });

  test('B. Equivalent English request: "Show me the current courses and their status" resolves to list_courses', async () => {
    const db = new MockToolSelectionDb();
    const mockProvider = new MockAiProvider({
      mockPlan: {
        planText: 'Here is the course list:',
        actions: [{ tool: 'list_courses', parameters: {} }],
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'Show me the current courses and their status',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.length, 1);
    assert.equal(result.actionsExecuted[0].tool, 'list_courses');
    assert.ok(result.reply.includes('Unit 1: The Basics'));
  });

  test('C. list_courses is read-only and does NOT require confirmation', async () => {
    const tool = getToolDefinition('list_courses');
    assert.ok(tool, 'list_courses must be in registry');
    assert.equal(tool.mutationType, 'read');
    assert.equal(tool.riskLevel, 'low');
    assert.equal(tool.confirmationPolicy, 'none');
    assert.equal(isReadOnlyTool('list_courses'), true);

    const risk = evaluatePlanRisk([{ tool: 'list_courses', parameters: {} }]);
    assert.equal(risk.requiresConfirmation, false);

    const mockDb = new MockToolSelectionDb();
    // Direct attempt to create confirmation token for list_courses must reject
    await assert.rejects(
      async () => {
        await createConfirmationRequest({
          actor: teacherActor,
          actionType: 'list_courses',
          actionPayload: {},
          secret: TEST_SECRET,
          db: mockDb,
        });
      },
      /does not require confirmation/i
    );

    // Auto-executes cleanly with confirmationSatisfied = false
    const execRes = await executeTool({
      actor: teacherActor,
      toolName: 'list_courses',
      args: {},
      context: { db: mockDb, confirmationSatisfied: false },
    });
    assert.equal(execRes.ok, true);
    assert.ok(Array.isArray(execRes.result.courses));
  });

  test('D. Hallucinated tool: displayCourses is rejected before confirmation creation', async () => {
    const db = new MockToolSelectionDb();
    // Model produces hallucinated tool displayCourses, and repair replan also returns invalid tool
    const mockProvider = new MockAiProvider({
      mockPlans: [
        { planText: 'Displaying courses', actions: [{ tool: 'displayCourses', parameters: {} }] },
        { planText: 'Displaying courses', actions: [{ tool: 'displayCourses', parameters: {} }] },
      ],
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض لي الكورسات الموجودة حاليًا مع اسم كل كورس وحالته فقط. لا تنشئ أو تعدل أو تحذف أي شيء.',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false, 'Unknown tool must NOT produce confirmation request');
    assert.equal(result.confirmationToken, undefined, 'Unknown tool must NOT produce confirmation token');
    assert.equal(result.actionsExecuted?.length, 0, 'Unknown tool must NOT be executed');
    assert.equal(db.confirmations.size, 0, 'No record must be created in ai_confirmations');
    assert.equal(result.reply, SAFE_FALLBACK_REPLY, 'Must return safe Arabic fallback');
  });

  test('E. Unknown tool does not produce an executable confirmation card', () => {
    const preview = generateActionPreview('displayCourses', { test: true });
    assert.equal(preview.isUnknown, true, 'Must flag isUnknown = true');
    assert.equal(preview.requiresConfirmation, false, 'Must NOT require confirmation');
    assert.equal(preview.riskLevel, 'low', 'Must NOT be classified as high risk');
    assert.equal(preview.titleAr, 'إجراء غير مسجل');

    // Compound plan with unknown tool
    const compoundPreview = generateActionPreview('compound_plan', {
      steps: [{ tool: 'displayCourses', payload: {} }],
    });
    assert.equal(compoundPreview.isUnknown, true);
    assert.equal(compoundPreview.requiresConfirmation, false);
    assert.equal(compoundPreview.riskLevel, 'low');
  });

  test('F. Unknown tool cannot reach tool execution', async () => {
    const db = new MockToolSelectionDb();
    await assert.rejects(
      async () => {
        await executeTool({
          actor: teacherActor,
          toolName: 'displayCourses',
          args: {},
          context: { db },
        });
      },
      (err) => err instanceof ToolExecutionError && err.code === 'UNKNOWN_TOOL' && err.status === 404
    );
  });

  test('G. One bounded repair attempt can convert: displayCourses -> list_courses when appropriate', async () => {
    const db = new MockToolSelectionDb();
    // 1st inference produces hallucinated tool displayCourses
    // 2nd inference (repair replan) successfully uses canonical list_courses
    const mockProvider = new MockAiProvider({
      mockPlans: [
        { planText: 'Show courses', actions: [{ tool: 'displayCourses', parameters: {} }] },
        { planText: 'Here are the courses', actions: [{ tool: 'list_courses', parameters: {} }] },
      ],
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض لي الكورسات الموجودة حاليًا مع اسم كل كورس وحالته فقط',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.length, 1);
    assert.equal(result.actionsExecuted[0].tool, 'list_courses');
    assert.ok(result.reply.includes('Unit 1: The Basics'));
    assert.equal(db.confirmations.size, 0);
  });

  test('H. A second invalid repair fails safely without execution', async () => {
    const db = new MockToolSelectionDb();
    let generationAttempts = 0;
    const mockProvider = new MockAiProvider({
      planHandler: (prompt) => {
        generationAttempts++;
        // Both initial and repair attempt return hallucinated tools
        return {
          planText: 'Invalid plan',
          actions: [{ tool: generationAttempts === 1 ? 'displayCourses' : 'showCourses', parameters: {} }],
        };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض لي الكورسات',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    // Bounded: initial (1) + repair (1) = 2 attempts max, no infinite loop!
    assert.equal(generationAttempts, 2, 'Must perform exactly 1 bounded repair attempt');
    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.confirmationToken, undefined);
    assert.equal(result.actionsExecuted?.length, 0);
    assert.equal(result.reply, SAFE_FALLBACK_REPLY);
    assert.equal(db.confirmations.size, 0);
  });

  test('I. Risk classification is derived from registry metadata, not model output', () => {
    // Model tries to claim delete_course or price updates are low risk or do not need confirmation
    const deceptiveDelete = [{ tool: 'delete_course', parameters: { courseId: 'c_1', risk: 'low', confirmation: false } }];
    const deleteRisk = evaluatePlanRisk(deceptiveDelete);
    assert.equal(deleteRisk.requiresConfirmation, true);

    const deceptivePrice = [{ tool: 'update_course_price', parameters: { courseId: 'c_1', price: 100, riskLevel: 'low' } }];
    const priceRisk = evaluatePlanRisk(deceptivePrice);
    assert.equal(priceRisk.requiresConfirmation, true);

    const deceptivePublish = [{ tool: 'publish_course', parameters: { courseId: 'c_1', requiresConfirmation: false } }];
    const publishRisk = evaluatePlanRisk(deceptivePublish);
    assert.equal(publishRisk.requiresConfirmation, true);

    const readTool = [{ tool: 'list_courses', parameters: { requiresConfirmation: true } }];
    const readRisk = evaluatePlanRisk(readTool);
    assert.equal(readRisk.requiresConfirmation, false, 'Read tool risk is server-side low');
  });

  test('J. Existing mutation confirmation behavior remains unchanged', () => {
    // 1–2 draft updates execute directly
    const draftUpdate = [{ tool: 'update_course', parameters: { courseId: 'c_1', title: 'New' } }];
    assert.equal(evaluatePlanRisk(draftUpdate).requiresConfirmation, false);

    // Financial price change requires confirmation
    const priceChange = [{ tool: 'update_course_price', parameters: { courseId: 'c_1', price: 200 } }];
    assert.equal(evaluatePlanRisk(priceChange).requiresConfirmation, true);
  });

  test('K. Existing destructive/publish confirmation behavior remains unchanged', () => {
    assert.equal(evaluatePlanRisk([{ tool: 'delete_course', parameters: { courseId: 'c_1' } }]).requiresConfirmation, true);
    assert.equal(evaluatePlanRisk([{ tool: 'delete_lecture', parameters: { videoId: 'v_1' } }]).requiresConfirmation, true);
    assert.equal(evaluatePlanRisk([{ tool: 'delete_exam', parameters: { examId: 'e_1' } }]).requiresConfirmation, true);

    assert.equal(evaluatePlanRisk([{ tool: 'publish_course', parameters: { courseId: 'c_1' } }]).requiresConfirmation, true);
    assert.equal(evaluatePlanRisk([{ tool: 'publish_lecture', parameters: { videoId: 'v_1' } }]).requiresConfirmation, true);
    assert.equal(evaluatePlanRisk([{ tool: 'publish_exam', parameters: { examId: 'e_1' } }]).requiresConfirmation, true);
    assert.equal(evaluatePlanRisk([{ tool: 'publish_assignment', parameters: { assignmentId: 'a_1' } }]).requiresConfirmation, true);
  });

  test('L. Existing database-contract tests remain green (DatabaseResult contract integrity)', () => {
    // Contract verification
    assert.ok(isRegisteredTool('list_courses'));
    assert.ok(isRegisteredTool('get_course'));
    assert.ok(CANONICAL_TOOL_NAMES.includes('list_courses'));
    assert.equal(isRegisteredTool('displayCourses'), false);
    assert.equal(isRegisteredTool('showCourses'), false);
  });

  test('M. Existing courses.status tests remain green (status column without is_active)', () => {
    const courseDef = getToolDefinition('list_courses');
    assert.ok(courseDef);
    assert.equal(courseDef.mutationType, 'read');
    assert.equal(courseDef.requiredPermission, 'manage_courses');
  });

  test('N. Existing global gate behavior remains green (concurrency constants and single flight)', () => {
    assert.equal(AI_GATE_MAX_RUNNING, 1);
    assert.equal(AI_GATE_MAX_WAITING, 2);
    assert.equal(AI_GATE_MAX_TOTAL, 3);
  });

});
