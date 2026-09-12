import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { orchestrateAdminChat } from '../app/lib/ai/orchestrator.ts';
import { MockAiProvider } from '../app/lib/ai/providers/mock-provider.ts';
import { verifyAndExecuteConfirmation } from '../app/lib/ai/confirmation.server.ts';
import { executeTool } from '../app/lib/ai/tool-executor.ts';
import { isToolCompatibleWithRequest } from '../app/lib/ai/semantic-intent-guard.ts';
import { SAFE_FALLBACK_REPLY } from '../app/lib/ai/planner-prompt.ts';

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

class MockComprehensiveDb {
  constructor(initialCourses = []) {
    this.conversations = new Map();
    this.messages = [];
    this.confirmations = new Map();
    this.actionLogs = [];
    this.courses = initialCourses.length > 0 ? initialCourses : [
      { id: 'c_10', title: 'English Grade 10', grade: '10', description: 'Grade 10 English Course', price: 0, status: 'draft' },
      { id: 'c_month1', title: 'كورس الشهر الأول', grade: '3sec', description: 'Month 1 Curriculum', price: 100, status: 'draft' },
    ];
  }

  async withTransaction(callback) {
    return callback(this);
  }

  async query(sql, params = []) {
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
            if (sql.includes('FROM courses')) {
              return { results: [...db.courses], success: true, meta: { changes: db.courses.length } };
            }
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
            if (sql.includes('UPDATE courses SET')) {
              // UPDATE courses SET title = ?, grade = ?, description = ?, price = ?, status = ?, updated_at = ? WHERE id = ?
              const [title, grade, description, price, status, updatedAt, courseId] = args;
              const course = db.courses.find((c) => c.id === courseId);
              if (course) {
                course.title = title;
                course.grade = grade;
                course.description = description;
                course.price = price;
                course.status = status;
                course.updated_at = updatedAt;
              }
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE ai_confirmations SET state = 'executing'")) {
              const [executionId, executedAt, tokenId] = args;
              const row = db.confirmations.get(tokenId);
              if (row) {
                row.state = 'executing';
                row.execution_id = executionId;
                row.executed_at = executedAt;
              }
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE ai_confirmations SET state = 'succeeded'")) {
              const [resultJson, completionTime, tokenId] = args;
              const row = db.confirmations.get(tokenId);
              if (row) {
                row.state = 'succeeded';
                row.result_json = resultJson;
                row.executed_at = completionTime;
              }
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes('INSERT INTO ai_action_logs')) {
              db.actionLogs.push({ args });
              return { results: [], success: true, meta: { changes: 1 } };
            }
            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

describe('AI Mutation Intent Preservation & Price Command Safety Suite', () => {
  // 1. Mandatory RED test
  test('1. RED REGRESSION: attempted tool substitution of update_course_price -> publish_course during repair is rejected', async () => {
    const db = new MockComprehensiveDb();
    let plannerCalls = 0;

    const mockProvider = new MockAiProvider({
      planHandler() {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          // Initial plan: invalid parameters
          return {
            planText: 'سأقوم بتعديل سعر الكورس.',
            actions: [{
              tool: 'update_course_price',
              parameters: { title: 'English Grade 10', price: 500 },
            }],
          };
        }
        // Repaired plan: model attempts illegal tool substitution to publish_course
        return {
          planText: 'تم تجهيز خطة النشر.',
          actions: [{
            tool: 'publish_course',
            parameters: { courseId: 'c_10' },
          }],
        };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    // The repair was rejected because tool substitution is forbidden!
    assert.equal(plannerCalls, 2);
    assert.notEqual(result.preview?.actionType, 'publish_course', 'Tool substitution to publish_course must be rejected');
    assert.equal(result.requiresConfirmation, false);
    assert.equal(db.confirmations.size, 0);
  });

  // 2. Production request happy path
  test('2. Exact production request resolves to update_course_price and preserves draft status after confirmation execution', async () => {
    const db = new MockComprehensiveDb();
    let plannerCalls = 0;

    const mockProvider = new MockAiProvider({
      planHandler() {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          // Model supplies price and title
          return {
            planText: 'سأقوم بتعديل سعر الكورس إلى 500 جنيه.',
            actions: [{
              tool: 'update_course_price',
              parameters: { title: 'English Grade 10', price: 500 },
            }],
          };
        }
        // Intent-preserving repair fixes arguments for locked tool update_course_price
        return {
          planText: 'تعديل السعر إلى 500 جنيه.',
          actions: [{
            tool: 'update_course_price',
            parameters: { courseId: 'c_10', price: 500 },
          }],
        };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, true, 'Price updates require mandatory confirmation');
    assert.equal(result.preview?.actionType, 'update_course_price');
    assert.equal(result.preview?.items[0]?.details?.price, 500);
    assert.equal(result.preview?.items[0]?.details?.courseId, 'c_10');

    // Structured user-facing summary description verification
    assert.ok(result.preview?.descriptionAr?.includes('English Grade 10'));
    assert.ok(result.preview?.descriptionAr?.includes('500'));
    assert.equal(result.preview?.descriptionAr, 'تغيير سعر كورس English Grade 10 إلى 500 جنيه');

    // Confirm execution via durable confirmation engine
    const token = result.confirmationToken;
    assert.ok(token);

    const execResult = await verifyAndExecuteConfirmation({
      token,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor: async (actionType, payload, txDb) => {
        return executeTool({
          toolName: actionType,
          args: payload,
          actor: teacherActor,
          context: { db: txDb, confirmationSatisfied: true },
        });
      },
    });

    assert.equal(execResult.success, true);
    assert.equal(execResult.actionType, 'update_course_price');

    // Invariant: price = 500, status remains 'draft'
    const course = db.courses.find((c) => c.id === 'c_10');
    assert.equal(course?.price, 500);
    assert.equal(course?.status, 'draft', 'Status must remain draft when updating price!');
  });

  // 3. Status preservation when course is published
  test('3. Status preservation: updating price of published course leaves status as published', async () => {
    const db = new MockComprehensiveDb([
      { id: 'c_pub', title: 'English Grade 10', grade: '10', description: 'desc', price: 200, status: 'published' },
    ]);

    const mockProvider = new MockAiProvider({
      planHandler() {
        return {
          planText: 'سأعدل السعر.',
          actions: [{
            tool: 'update_course_price',
            parameters: { courseId: 'c_pub', price: 500 },
          }],
        };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, true);
    const token = result.confirmationToken;

    await verifyAndExecuteConfirmation({
      token,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor: async (actionType, payload, txDb) => {
        return executeTool({
          toolName: actionType,
          args: payload,
          actor: teacherActor,
          context: { db: txDb, confirmationSatisfied: true },
        });
      },
    });

    const course = db.courses.find((c) => c.id === 'c_pub');
    assert.equal(course?.price, 500);
    assert.equal(course?.status, 'published', 'Status must remain published when updating price!');
  });

  // 4. Intent-preserving repair rejects various tool substitutions
  test('4. Intent-preserving repair rejects delete_course substitution on price update', async () => {
    const db = new MockComprehensiveDb();
    let calls = 0;
    const mockProvider = new MockAiProvider({
      planHandler() {
        calls++;
        if (calls === 1) {
          return {
            planText: 'سأعدل السعر',
            actions: [{ tool: 'update_course_price', parameters: { bad: 'param' } }],
          };
        }
        return {
          planText: 'احذف',
          actions: [{ tool: 'delete_course', parameters: { courseId: 'c_10' } }],
        };
      },
    });

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(calls, 2);
    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted?.length, 0);
    assert.equal(result.reply, SAFE_FALLBACK_REPLY);
  });

  // 5. Cross-intent mutation negative test matrix
  describe('5. Cross-Intent Mutation Negative Test Matrix', () => {
    const matrix = [
      { message: 'غير سعر كورس English Grade 10 إلى 500 جنيه', forbiddenTool: 'publish_course', label: 'price update != publish_course' },
      { message: 'غير سعر كورس English Grade 10 إلى 500 جنيه', forbiddenTool: 'delete_course', label: 'price update != delete_course' },
      { message: 'انشر كورس English Grade 10 للطلاب', forbiddenTool: 'update_course_price', label: 'publish request != update_course_price' },
      { message: 'احذف كورس English Grade 10 نهائياً', forbiddenTool: 'publish_course', label: 'delete request != publish_course' },
      { message: 'عدل عنوان كورس English Grade 10 إلى الجديد', forbiddenTool: 'delete_course', label: 'metadata update != delete_course' },
      { message: 'رتب عناصر كورس English Grade 10', forbiddenTool: 'publish_course', label: 'reorder request != publish_course' },
      { message: 'أنشئ كورس جديد باسم English Grade 11', forbiddenTool: 'publish_course', label: 'create course != publish_course' },
      { message: 'أضف محاضرة جديدة بعنوان قواعد الوحدة الأولى', forbiddenTool: 'delete_course', label: 'add lecture != delete_course' },
    ];

    for (const { message, forbiddenTool, label } of matrix) {
      test(`negative guard: ${label}`, () => {
        const compat = isToolCompatibleWithRequest(message, forbiddenTool);
        assert.equal(compat.compatible, false, `Expected ${forbiddenTool} to be incompatible with "${message}"`);
      });
    }
  });

  // 6. Natural Arabic price variants
  describe('6. Natural Arabic Price Variants', () => {
    const arabicPriceVariants = [
      'غير سعر كورس English Grade 10 إلى 500 جنيه',
      'خلي سعر English Grade 10 بـ 500',
      'عدل سعر كورس الشهر الأول إلى 750 جنيه',
      'سعر الكورس يبقى 300',
    ];

    for (const variant of arabicPriceVariants) {
      test(`variant: "${variant}" resolves to update_course_price`, async () => {
        const db = new MockComprehensiveDb();
        const mockProvider = new MockAiProvider({
          planHandler() {
            return {
              planText: 'سأقوم بتعديل السعر.',
              actions: [{
                tool: 'update_course_price',
                parameters: { price: 500 },
              }],
            };
          },
        });

        // For "سعر الكورس يبقى 300", supply unambiguous context courseId
        const context = variant === 'سعر الكورس يبقى 300' ? { courseId: 'c_10' } : undefined;

        const result = await orchestrateAdminChat({
          actor: teacherActor,
          message: variant,
          provider: mockProvider,
          context,
          secret: TEST_SECRET,
          db,
        });

        assert.equal(result.requiresConfirmation, true);
        assert.equal(result.preview?.actionType, 'update_course_price');
        assert.ok(result.preview?.items[0]?.details?.courseId);
      });
    }
  });

  // 7. Entity Resolution and Ambiguity Protection
  describe('7. Entity Resolution and Ambiguity Protection', () => {
    test('resolves exact course "English Grade 10" when multiple non-conflicting courses exist', async () => {
      const db = new MockComprehensiveDb([
        { id: 'c_10', title: 'English Grade 10', grade: '10', price: 0, status: 'draft' },
        { id: 'c_11', title: 'English Grade 11', grade: '11', price: 0, status: 'draft' },
      ]);

      const mockProvider = new MockAiProvider({
        planHandler() {
          return {
            planText: 'سأعدل السعر',
            actions: [{ tool: 'update_course_price', parameters: { price: 500 } }],
          };
        },
      });

      const result = await orchestrateAdminChat({
        actor: teacherActor,
        message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
        provider: mockProvider,
        secret: TEST_SECRET,
        db,
      });

      assert.equal(result.requiresConfirmation, true);
      assert.equal(result.preview?.items[0]?.details?.courseId, 'c_10');
    });

    test('ambiguous reference: "سعر الكورس يبقى 300" with multiple courses in DB asks user to choose and does NOT mutate', async () => {
      const db = new MockComprehensiveDb([
        { id: 'c_10', title: 'English Grade 10', grade: '10', price: 0, status: 'draft' },
        { id: 'c_11', title: 'English Grade 11', grade: '11', price: 0, status: 'draft' },
      ]);

      let plannerCalled = false;
      const mockProvider = new MockAiProvider({
        planHandler() {
          plannerCalled = true;
          return { planText: 'ok', actions: [] };
        },
      });

      const result = await orchestrateAdminChat({
        actor: teacherActor,
        message: 'سعر الكورس يبقى 300',
        provider: mockProvider,
        secret: TEST_SECRET,
        db,
      });

      assert.equal(plannerCalled, false, 'Must not run planner when entity is ambiguous');
      assert.equal(result.requiresConfirmation, false);
      assert.equal(result.actionsExecuted?.length, 0);
      assert.match(result.reply, /تحديد الكورس المقصود/);
    });

    test('ambiguous match: multiple similar courses asks user to choose', async () => {
      const db = new MockComprehensiveDb([
        { id: 'c_10_a', title: 'English Grade 10 Section 1', grade: '10', price: 0, status: 'draft' },
        { id: 'c_10_b', title: 'English Grade 10 Section 2', grade: '10', price: 0, status: 'draft' },
      ]);

      let plannerCalled = false;
      const mockProvider = new MockAiProvider({
        planHandler() {
          plannerCalled = true;
          return { planText: 'ok', actions: [] };
        },
      });

      const result = await orchestrateAdminChat({
        actor: teacherActor,
        message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
        provider: mockProvider,
        secret: TEST_SECRET,
        db,
      });

      assert.equal(plannerCalled, false);
      assert.equal(result.requiresConfirmation, false);
      assert.match(result.reply, /أكثر من كورس مطابق/);
    });
  });

  // 8. Confirmation Action Binding Invariant
  test('8. Confirmation binding invariant: token bound to update_course_price cannot execute another tool', async () => {
    const db = new MockComprehensiveDb();

    const mockProvider = new MockAiProvider({
      planHandler() {
        return {
          planText: 'سأقوم بتعديل السعر.',
          actions: [{
            tool: 'update_course_price',
            parameters: { courseId: 'c_10', price: 500 },
          }],
        };
      },
    });

    const chatResult = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    const token = chatResult.confirmationToken;
    assert.ok(token);

    // Stored confirmation in DB is locked to update_course_price
    const record = db.confirmations.get(token.split('.')[0]);
    assert.equal(record?.action_type, 'update_course_price');
    assert.deepEqual(JSON.parse(record?.action_payload), { courseId: 'c_10', price: 500 });

    // When executed, the engine invokes the executor with the exact stored action_type and payload
    let executedTool = '';
    await verifyAndExecuteConfirmation({
      token,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor: async (actionType, payload, txDb) => {
        executedTool = actionType;
        return executeTool({
          toolName: actionType,
          args: payload,
          actor: teacherActor,
          context: { db: txDb, confirmationSatisfied: true },
        });
      },
    });

    assert.equal(executedTool, 'update_course_price', 'Executed tool must strictly equal confirmed action');
    assert.notEqual(executedTool, 'publish_course', 'Executed tool cannot be substituted with publish_course');
  });
});
