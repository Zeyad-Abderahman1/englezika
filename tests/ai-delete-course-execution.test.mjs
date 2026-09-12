import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfirmationRequest, verifyAndExecuteConfirmation } from '../app/lib/ai/confirmation.server.ts';
import { executeTool, ToolExecutionError } from '../app/lib/ai/tool-executor.ts';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
const teacher = { email: 'teacher@englizeka.com', name: 'Teacher', role: 'teacher', permissions: ['manage_courses'] };
const unauthorized = { email: 'assistant@englizeka.com', role: 'assistant', permissions: [] };

class DeleteCourseDatabase {
  constructor(state, transaction = false) {
    this.state = state ?? {
      confirmations: new Map(),
      logs: [],
      courses: new Map([
        ['course-delete', { id: 'course-delete', title: 'Third Secondary', thumbnailKey: null }],
        ['course-keep', { id: 'course-keep', title: 'Keep Me', thumbnailKey: null }],
      ]),
      children: new Map([
        ['video-delete', { courseId: 'course-delete' }],
        ['video-keep', { courseId: 'course-keep' }],
      ]),
    };
    this.transaction = transaction;
    this.aborted = false;
  }

  async withTransaction(callback) {
    return callback(new DeleteCourseDatabase(this.state, true));
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('ai_confirmations')) return db.state.confirmations.get(args[0]) ?? null;
            if (sql.includes('FROM courses WHERE id')) return db.state.courses.get(args[0]) ?? null;
            return null;
          },
          async all() {
            // Reproduce production schema drift during a best-effort storage lookup.
            if (sql.includes('assignment_questions') && sql.includes('image_file_key')) {
              if (db.transaction) db.aborted = true;
              throw new Error('column assignment_questions.image_file_key does not exist');
            }
            return { results: [], success: true, meta: { changes: 0 } };
          },
          async run() {
            if (db.aborted) throw new Error('current transaction is aborted, commands ignored until end of transaction block');
            if (sql.includes('INSERT INTO ai_confirmations')) {
              const [id, tokenHash, email, actionType, payload, createdAt, expiresAt] = args;
              db.state.confirmations.set(id, { id, token_hash: tokenHash, staff_email: email, action_type: actionType, action_payload: payload, state: 'pending', result_json: null, created_at: createdAt, expires_at: expiresAt, executed_at: null, execution_id: null, error_message: null });
            } else if (sql.includes("state = 'executing'")) {
              const [executionId, executedAt, id] = args;
              Object.assign(db.state.confirmations.get(id), { state: 'executing', execution_id: executionId, executed_at: executedAt });
            } else if (sql.includes("state = 'succeeded'")) {
              const [resultJson, executedAt, id] = args;
              Object.assign(db.state.confirmations.get(id), { state: 'succeeded', result_json: resultJson, executed_at: executedAt });
            } else if (sql.includes("state = 'failed'")) {
              const [errorMessage, executedAt, id] = args;
              Object.assign(db.state.confirmations.get(id), { state: 'failed', error_message: errorMessage, executed_at: executedAt });
            } else if (sql.includes('INSERT INTO ai_action_logs')) {
              db.state.logs.push(args);
            }
            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }

  async batch(statements) {
    if (this.aborted) throw new Error('current transaction is aborted, commands ignored until end of transaction block');
    for (const statement of statements) await statement.run();
    const target = statements.at(-1);
    void target;
    for (const [id, course] of this.state.courses) {
      if (course.id === 'course-delete') this.state.courses.delete(id);
    }
    for (const [id, child] of this.state.children) {
      if (child.courseId === 'course-delete') this.state.children.delete(id);
    }
    return [];
  }
}

async function confirmedDelete(db, courseId = 'course-delete', actor = teacher, afterCommit = []) {
  const confirmation = await createConfirmationRequest({ actor, actionType: 'delete_course', actionPayload: { courseId }, secret: SECRET, db });
  return verifyAndExecuteConfirmation({
    token: confirmation.token,
    actor,
    secret: SECRET,
    db,
    executor: (actionType, payload, txDb) => executeTool({
      toolName: actionType,
      args: payload,
      actor,
      context: { db: txDb, metadataDb: db, afterCommit, confirmationSatisfied: true },
    }),
  });
}

test('confirmed AI delete_course survives a tolerated storage-metadata lookup failure and deletes only the target graph', async () => {
  const db = new DeleteCourseDatabase();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: { delete: async () => {} } };
  try {
    const afterCommit = [];
    const result = await confirmedDelete(db, 'course-delete', teacher, afterCommit);
    assert.equal(result.success, true);
    assert.equal(db.state.courses.has('course-delete'), false);
    assert.equal(db.state.children.has('video-delete'), false);
    assert.equal(db.state.courses.has('course-keep'), true);
    assert.equal(db.state.children.has('video-keep'), true);
    assert.equal([...db.state.confirmations.values()][0].state, 'succeeded');
    assert.equal(afterCommit.length, 1);
    await Promise.all(afterCommit.map((effect) => effect()));
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

test('delete_course rejects nonexistent targets, missing permission, and missing confirmation', async () => {
  const db = new DeleteCourseDatabase();
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: { delete: async () => {} } };
  try {
    await assert.rejects(() => confirmedDelete(db, 'missing'), /الكورس غير موجود/);
    assert.equal([...db.state.confirmations.values()][0].state, 'failed');
    assert.equal(db.state.courses.has('course-keep'), true);
    await assert.rejects(() => executeTool({ toolName: 'delete_course', args: { courseId: 'course-delete' }, actor: unauthorized, context: { db, confirmationSatisfied: true } }), (error) => error instanceof ToolExecutionError && error.code === 'FORBIDDEN');
    await assert.rejects(() => executeTool({ toolName: 'delete_course', args: { courseId: 'course-delete' }, actor: teacher, context: { db } }), (error) => error instanceof ToolExecutionError && error.code === 'CONFIRMATION_REQUIRED');
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});
