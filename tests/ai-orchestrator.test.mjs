import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  orchestrateAdminChat,
  evaluatePlanRisk,
  resolveContext,
  loadConversationHistory,
  saveMessage,
  MAX_MESSAGE_LENGTH,
  MAX_STORED_MESSAGES,
} from '../app/lib/ai/orchestrator.ts';
import { MockAiProvider } from '../app/lib/ai/providers/mock-provider.ts';

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

class MockOrchestratorDatabase {
  constructor() {
    this.conversations = new Map();
    this.messages = [];
    this.confirmations = new Map();
    this.actionLogs = [];
    this.courses = new Map([
      ['c_unit4', { id: 'c_unit4', title: 'Unit 4: Advanced Grammar', grade: '3sec', price: 200, status: 'draft' }],
    ]);
    this.videos = new Map([
      ['v_lec1', { id: 'v_lec1', course_id: 'c_unit4', title: 'Passive Voice Lecture', is_active: 0 }],
    ]);
    this.exams = new Map([
      ['ex_quiz1', { id: 'ex_quiz1', course_id: 'c_unit4', title: 'Quiz 1', exam_type: 'quiz', is_active: 0 }],
    ]);
  }

  async withTransaction(callback) {
    return callback(this);
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('FROM courses WHERE id = ?')) {
              const row = db.courses.get(args[0]);
              return row ? { ...row } : null;
            }
            if (sql.includes('FROM videos WHERE id = ?')) {
              const row = db.videos.get(args[0]);
              return row ? { ...row } : null;
            }
            if (sql.includes('FROM exams WHERE id = ?')) {
              const row = db.exams.get(args[0]);
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
                result_json: null,
                created_at,
                expires_at,
              });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE courses SET')) {
              const newTitle = args[0];
              const courseId = args[args.length - 1];
              const course = db.courses.get(courseId);
              if (course) course.title = newTitle;
              return { results: [], success: true, meta: { changes: 1 } };
            }
            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

describe('Phase 6: AI Orchestrator & Bounded Memory', () => {
  test('saves and loads only user/assistant messages capped at MAX_STORED_MESSAGES', async () => {
    const db = new MockOrchestratorDatabase();
    const convId = 'conv_test_1';
    db.conversations.set(convId, { id: convId, staff_email: teacherActor.email, title: 'Test', created_at: Date.now(), updated_at: Date.now() });

    // Insert 25 messages
    for (let i = 1; i <= 25; i++) {
      await saveMessage(convId, i % 2 === 0 ? 'assistant' : 'user', `Message ${i}`, null, db);
    }

    const history = await loadConversationHistory(convId, teacherActor.email, db);

    // Bounded: returns at most MAX_STORED_MESSAGES (20)
    assert.equal(history.length, MAX_STORED_MESSAGES);
    // Chronological order: oldest returned is Message 6
    assert.equal(history[0].content, 'Message 6');
    assert.equal(history[history.length - 1].content, 'Message 25');

    // Asserts no system prompts or raw schemas exist
    for (const msg of history) {
      assert.ok(msg.role === 'user' || msg.role === 'assistant');
      assert.ok(!msg.content.includes('SYSTEM'));
    }
  });

  test('validates server context: resolves existing entities and ignores fake IDs', async () => {
    const db = new MockOrchestratorDatabase();
    const resolved = await resolveContext(
      {
        courseId: 'c_unit4',
        lectureId: 'v_lec1',
        assessmentId: 'fake_non_existent_exam_id',
      },
      db
    );

    assert.ok(resolved.courseInfo?.includes('Unit 4: Advanced Grammar'));
    assert.ok(resolved.courseInfo?.includes('Status: draft'), 'courseInfo must report status from course.status');
    assert.ok(resolved.lectureInfo?.includes('Passive Voice Lecture'));
    // fake ID must NOT be resolved into assessmentInfo
    assert.equal(resolved.assessmentInfo, undefined);
    assert.equal(resolved.validatedContext.assessmentId, undefined);
  });

  test('orchestrator course context reports published status from course.status', async () => {
    const db = new MockOrchestratorDatabase();
    db.courses.set('c_unit4_pub', {
      id: 'c_unit4_pub',
      title: 'Unit 4: Published Course',
      grade: '3sec',
      price: 300,
      status: 'published',
    });

    const resolved = await resolveContext({ courseId: 'c_unit4_pub' }, db);
    assert.ok(resolved.courseInfo?.includes('Status: published'));
  });
});

describe('Phase 6: Risk Escalation & Compound Action Planner', () => {
  test('auto-executes 1–2 low-risk draft actions directly without confirmation', () => {
    const lowRiskActions = [
      { tool: 'update_course', parameters: { courseId: 'c_unit4', title: 'Unit 4: Revised' } },
    ];
    const risk = evaluatePlanRisk(lowRiskActions);
    assert.equal(risk.requiresConfirmation, false);
  });

  test('escalates destructive actions (delete_course) to mandatory confirmation', () => {
    const deleteAction = [
      { tool: 'delete_course', parameters: { courseId: 'c_unit4' } },
    ];
    const risk = evaluatePlanRisk(deleteAction);
    assert.equal(risk.requiresConfirmation, true);
    assert.ok(risk.reason?.includes('delete_course'));
  });

  test('escalates financial price changes to mandatory confirmation', () => {
    const priceAction = [
      { tool: 'update_course_price', parameters: { courseId: 'c_unit4', price: 300 } },
    ];
    const risk = evaluatePlanRisk(priceAction);
    assert.equal(risk.requiresConfirmation, true);
    assert.ok(risk.reason?.includes('update_course_price'));
  });

  test('escalates publish actions to mandatory confirmation', () => {
    const publishAction = [
      { tool: 'publish_assessment', parameters: { assessmentId: 'ex_quiz1' } },
    ];
    const risk = evaluatePlanRisk(publishAction);
    assert.equal(risk.requiresConfirmation, true);
  });

  test('escalates compound plans with >2 mutations to mandatory plan preview + confirmation', () => {
    const compoundActions = [
      { tool: 'create_course', parameters: { title: 'Unit 5', grade: '3sec' } },
      { tool: 'create_lecture', parameters: { courseId: 'c_unit5', title: 'Lesson 1', youtubeId: 'abc' } },
      { tool: 'create_lecture', parameters: { courseId: 'c_unit5', title: 'Lesson 2', youtubeId: 'def' } },
    ];
    const risk = evaluatePlanRisk(compoundActions);
    assert.equal(risk.requiresConfirmation, true);
    assert.ok(risk.reason?.includes('Multi-action plan'));
  });

  test('orchestrateAdminChat creates confirmation request when plan contains risky actions', async () => {
    const db = new MockOrchestratorDatabase();
    const mockProvider = new MockAiProvider({
      mockPlan: {
        planText: 'سأقوم بتعديل سعر الدورة بعد موافقتك.',
        actions: [
          { tool: 'update_course_price', parameters: { courseId: 'c_unit4', price: 450 } },
        ],
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'عدل سعر الدورة إلى 450 جنيه',
      context: { courseId: 'c_unit4' },
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, true);
    assert.ok(result.confirmationToken);
    assert.ok(result.preview);
    assert.equal(result.preview.actionType, 'update_course_price');
    assert.equal(result.preview.riskLevel, 'high');

    // Server-side confirmation was stored in DB
    const confirmationRow = Array.from(db.confirmations.values())[0];
    assert.ok(confirmationRow);
    assert.equal(confirmationRow.action_type, 'update_course_price');
    assert.equal(confirmationRow.state, 'pending');
  });

  test('orchestrateAdminChat directly executes safe low-risk action', async () => {
    const db = new MockOrchestratorDatabase();
    const mockProvider = new MockAiProvider({
      mockPlan: {
        planText: 'تم تعديل اسم الدورة بنجاح.',
        actions: [
          { tool: 'update_course', parameters: { courseId: 'c_unit4', title: 'Unit 4: New Title' } },
        ],
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير اسم الدورة إلى Unit 4: New Title',
      context: { courseId: 'c_unit4' },
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.length, 1);
    assert.equal(result.actionsExecuted[0].tool, 'update_course');
    assert.equal(db.courses.get('c_unit4').title, 'Unit 4: New Title');
  });
});
