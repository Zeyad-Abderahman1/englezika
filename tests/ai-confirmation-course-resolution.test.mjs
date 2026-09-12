import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateAdminChat, resolveContext, injectCompatibleContext } from '../app/lib/ai/orchestrator.ts';
import { verifyAndExecuteConfirmation, createConfirmationRequest } from '../app/lib/ai/confirmation.server.ts';
import { executeTool } from '../app/lib/ai/tool-executor.ts';
import { CourseService } from '../app/lib/services/course-service.ts';
import {
  shouldRenderExecuteButton,
  isConfirmationActionable,
  formatUserFacingConfirmationError,
} from '../app/lib/ai/confirmation-state.ts';

const TEST_SECRET = 'super-secret-confirmation-token-signing-key-32chars!';
process.env.AI_CONFIRMATION_SECRET = TEST_SECRET;

const teacherActor = {
  email: 'teacher@englizeka.com',
  name: 'Teacher Ahmed',
  role: 'admin',
  permissions: ['manage_courses', 'manage_videos', 'manage_exams'],
};

class MockIntegrationDatabase {
  constructor(initialCourses = []) {
    this.courses = [...initialCourses];
    this.conversations = new Map();
    this.messages = [];
    this.confirmations = new Map();
  }

  async query(sql, params = []) {
    if (sql.includes('SELECT id, title, grade, price, status FROM courses')) {
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
            if (sql.includes('SELECT id, title, grade, description, price, status FROM courses WHERE id = ?') ||
                sql.includes('SELECT id, title, grade, price, status FROM courses WHERE id = ?')) {
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
            if (sql.includes('FROM ai_messages')) {
              return { results: [], success: true, meta: { changes: 0 } };
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
                executed_at: null,
                execution_id: null,
                result_json: null,
                error_message: null,
              });
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
              const [resultJson, executedAt, tokenId] = args;
              const row = db.confirmations.get(tokenId);
              if (row) {
                row.state = 'succeeded';
                row.result_json = resultJson;
                row.executed_at = executedAt;
              }
              return { results: [], success: true, meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE ai_confirmations SET state = 'failed'")) {
              const errorMessage = args[0];
              const tokenId = args[args.length - 1];
              const row = db.confirmations.get(tokenId);
              if (row) {
                row.state = 'failed';
                row.error_message = errorMessage;
              }
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
            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }

  async withTransaction(callback) {
    return callback(this);
  }
}

describe('AI Confirmation Course ID End-to-End Resolution & UI State Machine Suite', () => {
  // A. price request resolves existing course ID
  test('A. Price request resolves existing canonical course ID even when model emits title as courseId', async () => {
    const KNOWN_ID = '38547285-8b38-4e16-a197-2856d11f8190';
    const db = new MockIntegrationDatabase([
      { id: KNOWN_ID, title: 'English Grade 10', grade: '10', description: 'Curriculum', price: 0, status: 'draft' },
      { id: 'c_other', title: 'Mathematics', grade: '10', description: 'Math', price: 100, status: 'draft' },
    ]);

    const resolved = await resolveContext(undefined, db, 'غير سعر كورس English Grade 10 إلى 500 جنيه');
    assert.equal(resolved.validatedContext.courseId, KNOWN_ID, 'Entity resolver must return exact existing course ID');
    assert.equal(resolved.courseTitle, 'English Grade 10');
  });

  // RED test: Demonstrating previous failure where model emitting title as courseId broke execution
  test('RED REGRESSION: Model outputting course title as courseId must NOT bypass canonical ID into confirmation', async () => {
    const KNOWN_ID = '38547285-8b38-4e16-a197-2856d11f8190';
    const db = new MockIntegrationDatabase([
      { id: KNOWN_ID, title: 'English Grade 10', grade: '10', description: 'Curriculum', price: 0, status: 'draft' },
    ]);

    // Model emits title "English Grade 10" in place of courseId
    const mockProvider = {
      async generatePlan() {
        return {
          planText: 'سأقوم بتعديل سعر كورس English Grade 10 إلى 500 جنيه.',
          actions: [
            {
              tool: 'update_course_price',
              parameters: {
                courseId: 'English Grade 10', // WRONG: model used course name!
                price: 500,
              },
            },
          ],
        };
      },
    };

    const orchestratorResult = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(orchestratorResult.requiresConfirmation, true);

    // B. Confirmation payload must contain the exact canonical database course ID, NOT the title string
    const preparedCourseId = orchestratorResult.preview?.items[0]?.details?.courseId;
    assert.equal(
      preparedCourseId,
      KNOWN_ID,
      `Confirmation payload courseId must be canonical '${KNOWN_ID}', but got '${preparedCourseId}'`
    );

    // C. Verify confirmation database record stores the SAME canonical course ID
    const storedRecord = db.confirmations.get(orchestratorResult.confirmationToken.split('.')[0]);
    const storedPayload = JSON.parse(storedRecord.action_payload);
    assert.equal(storedPayload.courseId, KNOWN_ID);
    assert.equal(storedPayload.price, 500);

    // D. Execution receives exact same canonical ID and updates course successfully
    const execResult = await verifyAndExecuteConfirmation({
      token: orchestratorResult.confirmationToken,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor: async (actionType, payload, txDb) => {
        // Assert execution receives exact same ID
        assert.equal(payload.courseId, KNOWN_ID);
        assert.equal(payload.price, 500);
        return executeTool({
          toolName: actionType,
          args: payload,
          actor: teacherActor,
          context: { db: txDb, confirmationSatisfied: true },
        });
      },
    });

    assert.equal(execResult.success, true);

    // E. Price becomes 500, status remains draft
    const updated = db.courses.find((c) => c.id === KNOWN_ID);
    assert.equal(updated.price, 500);
    assert.equal(updated.status, 'draft', 'Status must remain draft after price update');
  });

  // Stale ambient UI context must not override explicit course mention in user command
  test('A2. Stale context.courseId from dropdown does not hijack explicit course in user command', async () => {
    const KNOWN_ID = '38547285-8b38-4e16-a197-2856d11f8190';
    const STALE_ID = 'c_stale_math_id';
    const db = new MockIntegrationDatabase([
      { id: KNOWN_ID, title: 'English Grade 10', grade: '10', description: 'Curriculum', price: 0, status: 'draft' },
      { id: STALE_ID, title: 'Mathematics', grade: '10', description: 'Math', price: 100, status: 'draft' },
    ]);

    // Client passed STALE_ID in context (e.g. from dropdown)
    const resolved = await resolveContext(
      { courseId: STALE_ID },
      db,
      'غير سعر كورس English Grade 10 إلى 500 جنيه'
    );

    assert.equal(
      resolved.validatedContext.courseId,
      KNOWN_ID,
      'Explicit course mention in message must take precedence over ambient context.courseId'
    );
    assert.equal(resolved.courseTitle, 'English Grade 10');
  });

  // F. Ambiguous title still asks for clarification
  test('F. Ambiguous course title asks for clarification and does not mutate', async () => {
    const db = new MockIntegrationDatabase([
      { id: 'c_term1', title: 'English Grade 10 Term 1', grade: '10', price: 0, status: 'draft' },
      { id: 'c_term2', title: 'English Grade 10 Term 2', grade: '10', price: 0, status: 'draft' },
    ]);

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted.length, 0);
    assert.ok(result.reply.includes('أكثر من كورس') || result.reply.includes('تحديد الكورس'));
  });

  // G. Missing course does NOT pick a different course
  test('G. Missing course does not pick a different course', async () => {
    const db = new MockIntegrationDatabase([
      { id: 'c_math', title: 'Mathematics Grade 10', grade: '10', price: 100, status: 'draft' },
    ]);

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس Physics إلى 500 جنيه',
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.actionsExecuted.length, 0);
    assert.ok(result.reply.includes('لم أتمكن من العثور') || result.reply.includes('تحديد'));
    // Invariant: Math price untouched
    assert.equal(db.courses[0].price, 100);
  });

  // H & I. Failed confirmation is terminal and cannot execute again
  test('H & I. Failed confirmation is terminal and rejects re-execution without re-running tool', async () => {
    const db = new MockIntegrationDatabase([
      { id: 'c_test', title: 'Chemistry', grade: '11', price: 200, status: 'draft' },
    ]);

    let toolExecCount = 0;

    const tokenRes = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'c_non_existent', price: 500 },
      secret: TEST_SECRET,
      db,
    });

    // First execution fails because course does not exist
    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tokenRes.token,
          actor: teacherActor,
          secret: TEST_SECRET,
          db,
          executor: async () => {
            toolExecCount++;
            throw new Error('الكورس غير موجود');
          },
        });
      },
      (err) => {
        assert.equal(err.message, 'الكورس غير موجود');
        return true;
      }
    );

    assert.equal(toolExecCount, 1);

    // Verify record state is 'failed'
    const record = db.confirmations.get(tokenRes.tokenId);
    assert.equal(record.state, 'failed');
    assert.equal(record.error_message, 'الكورس غير موجود');

    // Second execution attempt: MUST be blocked as already failed without calling executor again
    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tokenRes.token,
          actor: teacherActor,
          secret: TEST_SECRET,
          db,
          executor: async () => {
            toolExecCount++;
            return { ok: true };
          },
        });
      },
      (err) => {
        assert.ok(err.message.includes('already failed') || err.message.includes('سابقاً'));
        return true;
      }
    );

    // Executor MUST NOT have been called a second time!
    assert.equal(toolExecCount, 1, 'Failed confirmation must NOT re-execute the tool!');
  });

  // J. UI does not render execute button for failed state
  test('J. UI state machine strictly omits execute button for failed state', () => {
    assert.equal(shouldRenderExecuteButton('failed'), false, 'Failed state must NOT render execute button');
    assert.equal(isConfirmationActionable('failed'), false, 'Failed state must NOT be actionable');
    const userError = formatUserFacingConfirmationError('Confirmation action already failed: الكورس غير موجود');
    assert.ok(
      userError.includes('تعذر تنفيذ الإجراء لأن الكورس لم يعد متاحًا'),
      'Technical failed error must be translated to clean Arabic product message'
    );
    assert.ok(!userError.includes('Confirmation action already failed'), 'Must not leak English technical prefix');
  });

  // K. Succeeded confirmation does not render execute button
  test('K. UI state machine strictly omits execute button for succeeded state', () => {
    assert.equal(shouldRenderExecuteButton('succeeded'), false, 'Succeeded state must NOT render execute button');
    assert.equal(isConfirmationActionable('succeeded'), false, 'Succeeded state must NOT be actionable');
  });

  // L. Only pending confirmation renders active execute button (executing is disabled)
  test('L. Only pending confirmation renders active execute button', () => {
    assert.equal(shouldRenderExecuteButton('pending'), true, 'Pending state must render execute button');
    assert.equal(isConfirmationActionable('pending'), true, 'Pending state must be actionable');

    assert.equal(shouldRenderExecuteButton('executing'), true, 'Executing state renders button');
    assert.equal(isConfirmationActionable('executing'), false, 'Executing state is NOT actionable (disabled)');

    assert.equal(shouldRenderExecuteButton('expired'), false, 'Expired state must NOT render execute button');
    assert.equal(isConfirmationActionable('expired'), false, 'Expired state is NOT actionable');
  });

  // M. Original price-intent regression remains green: price update != publish
  test('M. Price update command strictly selects update_course_price and never publish_course', async () => {
    const KNOWN_ID = '38547285-8b38-4e16-a197-2856d11f8190';
    const db = new MockIntegrationDatabase([
      { id: KNOWN_ID, title: 'English Grade 10', grade: '10', description: 'Curriculum', price: 0, status: 'draft' },
    ]);

    const mockProvider = {
      async generatePlan() {
        return {
          planText: 'سأقوم بتعديل سعر الكورس.',
          actions: [
            {
              tool: 'update_course_price',
              parameters: {
                price: 500,
              },
            },
          ],
        };
      },
    };

    const result = await orchestrateAdminChat({
      actor: teacherActor,
      message: 'غير سعر كورس English Grade 10 إلى 500 جنيه',
      provider: mockProvider,
      secret: TEST_SECRET,
      db,
    });

    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.preview?.actionType, 'update_course_price');
    assert.notEqual(result.preview?.actionType, 'publish_course');
    assert.equal(result.preview?.items[0]?.details?.courseId, KNOWN_ID);
    assert.equal(result.preview?.items[0]?.details?.price, 500);
  });
});
