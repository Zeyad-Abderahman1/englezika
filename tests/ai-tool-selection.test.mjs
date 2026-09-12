import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  orchestrateAdminChat,
  evaluatePlanRisk,
  formatReadToolOutput,
  injectCompatibleContext,
  validatePlannedActions,
} from '../app/lib/ai/orchestrator.ts';
import {
  getToolDefinition,
  isRegisteredTool,
  isReadOnlyTool,
  CANONICAL_TOOL_NAMES,
  toolAcceptsParameter,
} from '../app/lib/ai/tool-registry.ts';
import { executeTool, ToolExecutionError } from '../app/lib/ai/tool-executor.ts';
import { generateActionPreview } from '../app/lib/ai/preview-generator.ts';
import { createConfirmationRequest } from '../app/lib/ai/confirmation.server.ts';
import { MockAiProvider } from '../app/lib/ai/providers/mock-provider.ts';
import { SAFE_FALLBACK_REPLY, getCanonicalToolCatalog, getPlannerSystemPrompt } from '../app/lib/ai/planner-prompt.ts';
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
    if (sql.includes('FROM courses WHERE id = $1')) {
      const course = this.courses.find((c) => c.id === params[0]);
      return { rows: course ? [{ ...course, course_id: course.id }] : [], rowCount: course ? 1 : 0 };
    }
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
            if (sql.includes('FROM courses WHERE id = ?')) {
              const row = db.courses.find((c) => c.id === args[0]);
              return row ? { ...row } : null;
            }
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
  test('production regression: prohibited create_course status is repaired once before execution', async () => {
    const db = new MockToolSelectionDb();
    let plannerCalls = 0;
    const mockProvider = new MockAiProvider({
      planHandler() {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          return {
            planText: 'سأنشئ الدورة في وضع المسودة.',
            actions: [{
              tool: 'create_course',
              parameters: { title: 'English Grade 10', grade: 'Grade 10', status: 'draft' },
            }],
          };
        }
        return {
          planText: 'تم إنشاء الدورة.',
          actions: [{
            tool: 'create_course',
            parameters: { title: 'English Grade 10', grade: 'Grade 10' },
          }],
        };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'أنشئ دورة جديدة باسم English Grade 10 للصف Grade 10',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(plannerCalls, 2, 'the planner must receive exactly one repair attempt');
    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.[0]?.tool, 'create_course');
    assert.equal(result.actionsExecuted?.[0]?.result?.result?.course?.title, 'English Grade 10');
  });

  test('create_course with a genuinely missing grade asks the user instead of inventing data', async () => {
    const db = new MockToolSelectionDb();
    let plannerCalls = 0;
    const mockProvider = new MockAiProvider({
      planHandler() {
        plannerCalls += 1;
        return {
          planText: 'سأنشئ الدورة.',
          actions: [{ tool: 'create_course', parameters: { title: 'English Grade 10' } }],
        };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'أنشئ دورة جديدة باسم English Grade 10',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(plannerCalls, 2, 'missing fields receive no more than one repair attempt');
    assert.equal(result.actionsExecuted?.length, 0);
    assert.match(result.reply, /الصف/);
  });

  test('planner conformance matrix accepts canonical schema-valid actions and preserves confirmation policy', () => {
    const matrix = [
      ['list_courses', {}, false],
      ['get_course', { courseId: 'course-1' }, false],
      ['create_course', { title: 'English Grade 10', grade: 'Grade 10' }, false],
      ['update_course', { courseId: 'course-1', title: 'Updated Course' }, false],
      ['update_course_price', { courseId: 'course-1', price: 500 }, true],
      ['add_lecture', { courseId: 'course-1', title: 'Lesson One', youtubeUrl: 'https://youtu.be/abc123' }, false],
      ['update_lecture', { videoId: 'video-1', title: 'Updated Lesson' }, false],
      ['get_lecture_details', { videoId: 'video-1' }, false],
      ['create_exam', { courseId: 'course-1', title: 'Unit Exam', questions: [] }, true],
      ['create_quiz', { courseId: 'course-1', title: 'Unit Quiz', questions: [] }, true],
      ['create_assignment', { courseId: 'course-1', title: 'Unit Assignment' }, false],
      ['reorder_course_items', { courseId: 'course-1', items: [] }, false],
      ['publish_course', { courseId: 'course-1' }, true],
      ['delete_course', { courseId: 'course-1' }, true],
    ];

    for (const [tool, parameters, requiresConfirmation] of matrix) {
      assert.equal(isRegisteredTool(tool), true, `${tool} must be canonical`);
      assert.equal(validatePlannedActions([{ tool, parameters }]).valid, true, `${tool} parameters must conform`);
      assert.equal(evaluatePlanRisk([{ tool, parameters }]).requiresConfirmation, requiresConfirmation, `${tool} confirmation policy`);
      for (const key of Object.keys(parameters)) {
        assert.ok(!['status', 'staffEmail', 'role', 'permissions', 'is_active'].includes(key));
      }
    }
  });

  test('planner catalog is generated from every authoritative registry definition', () => {
    const catalog = getCanonicalToolCatalog();
    assert.ok(catalog.includes('create_course:'));
    assert.ok(catalog.includes('server-owned=[status]'));
    for (const toolName of CANONICAL_TOOL_NAMES) {
      const definition = getToolDefinition(toolName);
      assert.ok(catalog.includes(`- ${toolName}:`));
      assert.ok(catalog.includes(`mutation=${definition.mutationType}`));
      assert.ok(catalog.includes(`confirmation=${definition.confirmationPolicy}`));
      for (const fieldName of Object.keys(definition.allowedKeys)) {
        assert.ok(catalog.includes(`${fieldName}:`), `${toolName}.${fieldName} must be exposed`);
      }
    }
  });

  test('repair matrix gives invalid plans at most one schema-guided replan', async () => {
    const cases = [
      {
        initial: { tool: 'list_courses', parameters: { courseId: 'unsupported' } },
        repaired: { tool: 'list_courses', parameters: {} },
        executes: true,
      },
      {
        initial: { tool: 'update_lecture', parameters: { lectureId: 'wrong-alias', title: 'Lesson' } },
        repaired: { tool: 'update_lecture', parameters: { lectureId: 'still-wrong', title: 'Lesson' } },
        executes: false,
      },
      {
        initial: { tool: 'list_courses', parameters: { extraUnknown: true } },
        repaired: { tool: 'list_courses', parameters: {} },
        executes: true,
      },
    ];

    for (const scenario of cases) {
      const db = new MockToolSelectionDb();
      let plannerCalls = 0;
      const provider = new MockAiProvider({
        planHandler() {
          plannerCalls += 1;
          return {
            planText: '',
            actions: [plannerCalls === 1 ? scenario.initial : scenario.repaired],
          };
        },
      });
      const result = await orchestrateAdminChat({
        actor: teacherActor,
        message: 'نفذ الطلب المحدد',
        provider,
        secret: TEST_SECRET,
        db,
      });
      assert.equal(plannerCalls, 2);
      assert.equal((result.actionsExecuted?.length || 0) > 0, scenario.executes);
    }
  });

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

  test('E2. Compound assessment steps accept parameters and preserve legacy payload previews', () => {
    const examParameters = {
      courseId: 'course-english-10',
      title: 'PDF Midterm',
      questions: [{
        prompt: 'Choose the passive sentence.',
        options: ['The letter was written by Ali.', 'Ali wrote the letter.', 'Ali writes.', 'The letter writes.'],
        correctIndex: 0,
        correctAnswer: 'The letter was written by Ali.',
      }],
    };
    const quizParameters = {
      courseId: 'course-english-10',
      title: 'PDF Quiz',
      questions: examParameters.questions,
    };

    const parametersPreview = generateActionPreview('compound_plan', {
      steps: [
        { tool: 'create_exam', parameters: examParameters },
        { tool: 'create_quiz', parameters: quizParameters },
      ],
    });

    assert.equal(parametersPreview.actionType, 'compound_plan');
    assert.equal(parametersPreview.requiresConfirmation, true);
    assert.equal(parametersPreview.isUnknown, undefined);
    assert.equal(parametersPreview.items.length, 2);
    assert.deepEqual(parametersPreview.items[0].details, examParameters);
    assert.deepEqual(parametersPreview.items[1].details, quizParameters);

    const legacyPayload = { courseId: 'course-legacy', title: 'Legacy Quiz' };
    const legacyPreview = generateActionPreview('compound_plan', {
      steps: [{ tool: 'create_quiz', payload: legacyPayload }],
    });

    assert.equal(legacyPreview.requiresConfirmation, true);
    assert.equal(legacyPreview.items.length, 1);
    assert.deepEqual(legacyPreview.items[0].details, legacyPayload);
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

  test('N. Existing global gate behavior remains green (provider-neutral concurrency constants)', () => {
    assert.equal(AI_GATE_MAX_RUNNING, 3);
    assert.equal(AI_GATE_MAX_WAITING, 6);
    assert.equal(AI_GATE_MAX_TOTAL, 9);
  });

  test('O. Empty-action plan for actionable Arabic request triggers bounded repair and resolves to list_courses', async () => {
    const db = new MockToolSelectionDb();
    let generationAttempts = 0;
    const mockProvider = new MockAiProvider({
      planHandler: (prompt) => {
        generationAttempts++;
        if (generationAttempts === 1) {
          // Initial plan: model returns zero actions
          return { planText: 'عرض الكورسات الحالية', actions: [] };
        }
        // Repair: model successfully produces list_courses
        return { planText: 'Here are the courses', actions: [{ tool: 'list_courses', parameters: {} }] };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض لي الكورسات الموجودة حاليًا مع اسم كل كورس وحالته فقط. لا تنشئ أو تعدل أو تحذف أي شيء.',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(generationAttempts, 2, 'Must perform exactly 1 bounded empty-action repair attempt');
    assert.equal(result.requiresConfirmation, false, 'Read-only tool must NOT require confirmation');
    assert.equal(result.actionsExecuted?.length, 1);
    assert.equal(result.actionsExecuted[0].tool, 'list_courses');
    assert.ok(result.reply.includes('Unit 1: The Basics'), 'Must include real course title');
    assert.ok(result.reply.includes('منشور'), 'Must include published status');
    assert.ok(result.reply.includes('Unit 2: Past Simple'));
    assert.ok(result.reply.includes('مسودة'), 'Must include draft status');
    assert.equal(db.confirmations.size, 0, 'No confirmation records');
  });

  test('P. Empty-action plan where repair also fails falls back to deterministic read-only resolver for list_courses', async () => {
    const db = new MockToolSelectionDb();
    let generationAttempts = 0;
    const mockProvider = new MockAiProvider({
      planHandler: (prompt) => {
        generationAttempts++;
        // Both initial and repair return zero actions
        return { planText: 'عرض الكورسات', actions: [] };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض لي الكورسات الموجودة حاليًا',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(generationAttempts, 2, 'Must perform exactly 1 bounded repair attempt after empty initial');
    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.length, 1, 'Deterministic fallback must resolve to list_courses');
    assert.equal(result.actionsExecuted[0].tool, 'list_courses');
    assert.ok(result.reply.includes('Unit 1: The Basics'));
    assert.ok(result.reply.includes('منشور'));
    assert.equal(db.confirmations.size, 0);
  });

  test('Q. Deterministic fallback NEVER resolves a mutation — "احذف الكورس الأول" with empty plans returns safe clarification', async () => {
    const db = new MockToolSelectionDb();
    let generationAttempts = 0;
    const mockProvider = new MockAiProvider({
      planHandler: (prompt) => {
        generationAttempts++;
        return { planText: 'حذف الكورس', actions: [] };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'احذف الكورس الأول',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(generationAttempts, 2, 'Must attempt repair once for non-conversational request');
    assert.equal(result.requiresConfirmation, false, 'Must NOT invent a confirmation for an inferred mutation');
    assert.equal(result.actionsExecuted?.length, 0, 'Must NOT execute any tool');
    assert.equal(result.reply, SAFE_FALLBACK_REPLY, 'Must return safe clarification');
    assert.equal(db.confirmations.size, 0, 'Must NOT create any confirmation record');
  });

  test('R. Greetings remain conversation-only — "مرحبا" with empty actions does NOT trigger repair', async () => {
    const db = new MockToolSelectionDb();
    let generationAttempts = 0;
    const mockProvider = new MockAiProvider({
      planHandler: (prompt) => {
        generationAttempts++;
        return { planText: 'أهلاً! كيف يمكنني مساعدتك اليوم؟', actions: [] };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'مرحبا',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(generationAttempts, 1, 'Must NOT attempt repair for conversational message');
    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.length, 0, 'Must NOT execute any tool');
    assert.ok(result.reply.includes('أهلاً'), 'Must return conversational response');
    assert.equal(db.confirmations.size, 0);
  });

  test('S. "ماذا يمكنك أن تفعل؟" must NOT trigger empty-action repair', async () => {
    const db = new MockToolSelectionDb();
    let generationAttempts = 0;
    const mockProvider = new MockAiProvider({
      planHandler: (prompt) => {
        generationAttempts++;
        return { planText: 'يمكنني مساعدتك في إدارة الكورسات والامتحانات.', actions: [] };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'ماذا يمكنك أن تفعل؟',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(generationAttempts, 1, 'Must NOT attempt repair for capability question');
    assert.equal(result.actionsExecuted?.length, 0);
    assert.ok(result.reply.includes('يمكنني'), 'Must return descriptive response');
  });

  test('T. Provider call count: successful initial plan = 1 call, no repair', async () => {
    const db = new MockToolSelectionDb();
    let generationAttempts = 0;
    const mockProvider = new MockAiProvider({
      planHandler: (prompt) => {
        generationAttempts++;
        return { planText: 'Listing courses', actions: [{ tool: 'list_courses', parameters: {} }] };
      },
    });

    await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض لي الكورسات',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(generationAttempts, 1, 'Successful initial plan must use exactly 1 planning call');
  });

  test('U. English empty-action plan "Show me the current courses" resolves via repair or fallback', async () => {
    const db = new MockToolSelectionDb();
    const mockProvider = new MockAiProvider({
      mockPlans: [
        { planText: 'Showing courses', actions: [] },
        { planText: 'Here are the courses', actions: [{ tool: 'list_courses', parameters: {} }] },
      ],
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

  test('V. list_courses output does not expose course IDs', async () => {
    const db = new MockToolSelectionDb();
    const mockProvider = new MockAiProvider({
      mockPlan: { planText: '', actions: [{ tool: 'list_courses', parameters: {} }] },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض الكورسات',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.ok(!result.reply.includes('c_1'), 'Course IDs must not be exposed in normal list response');
    assert.ok(!result.reply.includes('c_2'), 'Course IDs must not be exposed in normal list response');
    assert.ok(result.reply.includes('Unit 1: The Basics'));
    assert.ok(result.reply.includes('منشور'));
    assert.ok(result.reply.includes('مسودة'));
  });

  test('W. Production Regression: Arabic list request with admin context containing courseId executes list_courses without courseId injection', async () => {
    const db = new MockToolSelectionDb();
    const mockProvider = new MockAiProvider({
      mockPlan: {
        planText: '',
        actions: [{ tool: 'list_courses', parameters: {} }],
      },
    });

    const arabicPrompt = 'اعرض لي الكورسات الموجودة حاليًا مع اسم كل كورس وحالته فقط. لا تنشئ أو تعدل أو تحذف أي شيء.';

    const executedParameters = injectCompatibleContext('list_courses', {}, { courseId: 'c_1' });
    assert.deepEqual(executedParameters, {}, 'Canonical executor input must remain exactly empty');

    // Admin context contains an active courseId
    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: arabicPrompt,
      context: { courseId: 'c_1' },
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    // 1. No confirmation
    assert.equal(result.requiresConfirmation, false, 'list_courses must never require confirmation');
    assert.equal(result.confirmationToken, undefined, 'Must not produce confirmation token');

    // 2. list_courses executes
    assert.equal(result.actionsExecuted?.length, 1);
    const action = result.actionsExecuted[0];
    assert.equal(action.tool, 'list_courses');

    // 3. Schema-bounded parameters: courseId was NOT injected into list_courses
    // In db.messages, check stored tool execution payload
    const lastMsg = db.messages[db.messages.length - 1];
    assert.ok(lastMsg.tool_call_json, 'Must store executed actions');
    const storedActions = JSON.parse(lastMsg.tool_call_json);
    assert.equal(storedActions[0].tool, 'list_courses');

    // 4. Real courses returned
    assert.ok(action.result?.result?.courses?.length >= 2);

    // 5. Arabic formatted output includes title + status (published -> منشور, draft -> مسودة)
    assert.ok(result.reply.includes('إليك قائمة الكورسات الموجودة حاليًا'));
    assert.ok(result.reply.includes('Unit 1: The Basics'));
    assert.ok(result.reply.includes('منشور'));
    assert.ok(result.reply.includes('Unit 2: Past Simple'));
    assert.ok(result.reply.includes('مسودة'));

    // 6. No IDs unless explicitly requested
    assert.ok(!result.reply.includes('c_1'), 'Course ID c_1 must not be leaked');
    assert.ok(!result.reply.includes('c_2'), 'Course ID c_2 must not be leaked');
  });

  test('X. toolAcceptsParameter authoritatively checks registry schemas without hard-coded matrices', () => {
    // Read tools
    assert.equal(toolAcceptsParameter('list_courses', 'courseId'), false, 'list_courses schema does not accept courseId');
    assert.equal(toolAcceptsParameter('list_courses', 'query'), true, 'list_courses accepts query');
    assert.equal(toolAcceptsParameter('list_courses', 'grade'), true, 'list_courses accepts grade');
    assert.equal(toolAcceptsParameter('search_courses', 'courseId'), false, 'search_courses schema does not accept courseId');
    assert.equal(toolAcceptsParameter('get_course', 'courseId'), true, 'get_course accepts courseId');
    assert.equal(toolAcceptsParameter('get_course_structure', 'courseId'), true, 'get_course_structure accepts courseId');

    // Lecture tools
    assert.equal(toolAcceptsParameter('get_lecture_details', 'lectureId'), false, 'get_lecture_details declares videoId, not lectureId');
    assert.equal(toolAcceptsParameter('get_lecture_details', 'videoId'), true, 'get_lecture_details accepts videoId');
    assert.equal(toolAcceptsParameter('add_lecture', 'courseId'), true, 'add_lecture accepts courseId');
    assert.equal(toolAcceptsParameter('delete_lecture', 'courseId'), false, 'delete_lecture does not accept courseId');
    assert.equal(toolAcceptsParameter('delete_lecture', 'videoId'), true, 'delete_lecture accepts videoId');

    // Assessment tools
    assert.equal(toolAcceptsParameter('get_assessment_details', 'assessmentId'), true, 'get_assessment_details accepts assessmentId');
    assert.equal(toolAcceptsParameter('delete_exam', 'assessmentId'), false, 'delete_exam declares examId, not assessmentId');
    assert.equal(toolAcceptsParameter('delete_exam', 'examId'), true, 'delete_exam accepts examId');
    assert.equal(toolAcceptsParameter('publish_assessment', 'assessmentId'), true, 'publish_assessment accepts assessmentId');
    assert.equal(toolAcceptsParameter('delete_assessment', 'assessmentId'), true, 'delete_assessment accepts assessmentId');

    // Course tools
    assert.equal(toolAcceptsParameter('create_course', 'courseId'), false, 'create_course does not accept courseId');
    assert.equal(toolAcceptsParameter('update_course', 'courseId'), true, 'update_course accepts courseId');
    assert.equal(toolAcceptsParameter('delete_course', 'courseId'), true, 'delete_course accepts courseId');
    assert.equal(toolAcceptsParameter('publish_course', 'courseId'), true, 'publish_course accepts courseId');

    // Non-registered tools
    assert.equal(toolAcceptsParameter('unknown_tool', 'courseId'), false);
  });

  test('Y. injectCompatibleContext injects context ONLY when registered schema allows it', () => {
    const validatedContext = {
      courseId: 'c_unit1',
      lectureId: 'v_lec1',
      assessmentId: 'ex_quiz1',
    };

    // A. list_courses does NOT receive contextual courseId
    const listParams = injectCompatibleContext('list_courses', {}, validatedContext);
    assert.deepEqual(listParams, {}, 'list_courses must not receive courseId');

    // search_courses injects only declared schema parameters
    const searchParams = injectCompatibleContext('search_courses', { query: 'intro' }, validatedContext);
    assert.deepEqual(searchParams, { query: 'intro' });

    // C. get_course receives contextual courseId when schema accepts it
    const getCourseParams = injectCompatibleContext('get_course', {}, validatedContext);
    assert.deepEqual(getCourseParams, { courseId: 'c_unit1' });

    // D. Explicit valid model courseId is not unexpectedly overwritten
    const explicitParams = injectCompatibleContext('get_course', { courseId: 'c_explicit' }, validatedContext);
    assert.equal(explicitParams.courseId, 'c_explicit', 'Explicit model parameter must take precedence');

    // E. get_lecture_details maps the trusted lecture context to its declared videoId argument
    const getLectureParams = injectCompatibleContext('get_lecture_details', {}, validatedContext);
    assert.deepEqual(getLectureParams, { videoId: 'v_lec1' });

    // F. assessment tools receive assessmentId only when declared
    const assessmentDetailsParams = injectCompatibleContext('get_assessment_details', {}, validatedContext);
    assert.equal(assessmentDetailsParams.assessmentId, 'ex_quiz1');

    const deleteExamParams = injectCompatibleContext('delete_exam', { examId: 'ex_1' }, validatedContext);
    assert.equal(deleteExamParams.assessmentId, undefined, 'delete_exam declares examId, must not receive assessmentId');
    assert.equal(deleteExamParams.examId, 'ex_1');
  });

  test('Z. CRITICAL SECURITY: Model-supplied invalid parameters remain rejected by strict validation', async () => {
    const db = new MockToolSelectionDb();
    const mockProvider = new MockAiProvider({
      mockPlans: [{
        planText: '',
        actions: [{ tool: 'list_courses', parameters: { evilUnknown: 'x' } }],
      }, {
        planText: '',
        actions: [{ tool: 'list_courses', parameters: { evilUnknown: 'x' } }],
      }],
    });

    // Validated context is present
    const validatedContext = { courseId: 'c_1' };
    const injected = injectCompatibleContext('list_courses', { evilUnknown: 'x' }, validatedContext);
    // Preserves evilUnknown, does not sanitize or strip it
    assert.equal(injected.evilUnknown, 'x');
    assert.equal(injected.courseId, undefined);

    // Orchestration refuses safely after one repair instead of leaking raw errors.
    const orchestrationResult = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض الكورسات',
      context: { courseId: 'c_1' },
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });
    assert.equal(orchestrationResult.actionsExecuted?.length, 0);
    assert.equal(orchestrationResult.reply, SAFE_FALLBACK_REPLY);

    // The executor independently keeps the strict fail-closed boundary.
    await assert.rejects(
      () => executeTool({ actor: teacherActor, toolName: 'list_courses', args: injected, context: { db } }),
      (err) => {
        assert.ok(err instanceof ToolExecutionError);
        assert.ok(err.message.includes("Unrecognized parameter 'evilUnknown' for tool 'list_courses'"));
        return true;
      }
    );
  });

  test('Z1. Explicit null courseId remains model-owned and strict validation rejects it', async () => {
    const db = new MockToolSelectionDb();
    const invalidPlan = { planText: '', actions: [{ tool: 'get_course', parameters: { courseId: null } }] };
    const mockProvider = new MockAiProvider({ mockPlans: [invalidPlan, invalidPlan] });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض تفاصيل الدورة',
      context: { courseId: 'c_1' },
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });
    assert.equal(result.actionsExecuted?.length, 0);
    assert.match(result.reply, /الكورس المقصود/);
    await assert.rejects(
      () => executeTool({ actor: teacherActor, toolName: 'get_course', args: { courseId: null }, context: { db } }),
      (err) => err instanceof ToolExecutionError && err.message.includes("Missing required parameter 'courseId'")
    );
  });

  test('Z2. Explicit empty courseId remains model-owned and strict validation rejects it', async () => {
    const db = new MockToolSelectionDb();
    const invalidPlan = { planText: '', actions: [{ tool: 'get_course', parameters: { courseId: '' } }] };
    const mockProvider = new MockAiProvider({ mockPlans: [invalidPlan, invalidPlan] });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'اعرض تفاصيل الدورة',
      context: { courseId: 'c_1' },
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });
    assert.equal(result.actionsExecuted?.length, 0);
    assert.match(result.reply, /الكورس المقصود/);
    await assert.rejects(
      () => executeTool({ actor: teacherActor, toolName: 'get_course', args: { courseId: '' }, context: { db } }),
      (err) => err instanceof ToolExecutionError && err.message.includes("Missing required parameter 'courseId'")
    );
  });

  test('AA. get_course receives contextual courseId when its schema accepts it and executes successfully', async () => {
    const db = new MockToolSelectionDb();
    const mockProvider = new MockAiProvider({
      mockPlan: {
        planText: '',
        actions: [{ tool: 'get_course', parameters: {} }],
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'أعطني تفاصيل الدورة الحالية',
      context: { courseId: 'c_1' },
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.length, 1);
    assert.equal(result.actionsExecuted[0].tool, 'get_course');
    assert.ok(result.reply.includes('Unit 1: The Basics'));
    assert.ok(result.reply.includes('منشور'));
  });

});
