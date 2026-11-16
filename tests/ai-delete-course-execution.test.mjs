import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';

import { Database } from '../app/lib/database.ts';
import { createConfirmationRequest, verifyAndExecuteConfirmation } from '../app/lib/ai/confirmation.server.ts';
import { executeTool, ToolExecutionError } from '../app/lib/ai/tool-executor.ts';
import { courseService } from '../app/lib/services/course-service.ts';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
const teacher = { email: 'teacher@englizeka.com', name: 'Teacher', role: 'teacher', permissions: ['manage_courses'] };
const unauthorized = { email: 'assistant@englizeka.com', role: 'assistant', permissions: [] };

function createTestPoolAndState() {
  const state = {
    confirmations: new Map(),
    logs: [],
    courses: new Map([
      ['course-delete', { id: 'course-delete', title: 'Third Secondary', thumbnailKey: 'thumb-1' }],
      ['course-keep', { id: 'course-keep', title: 'Keep Me', thumbnailKey: null }],
    ]),
    videos: new Map([
      ['video-delete', { id: 'video-delete', course_id: 'course-delete' }],
      ['video-keep', { id: 'video-keep', course_id: 'course-keep' }],
    ]),
    exams: new Map([
      ['exam-delete', { id: 'exam-delete', course_id: 'course-delete' }],
    ]),
    questions: new Map([
      ['q-delete', { id: 'q-delete', exam_id: 'exam-delete' }],
    ]),
  };

  let clientActive = false;
  let forceSqlFailure = false;

  function executeSql(sql, values, pendingState) {
    const s = pendingState || state;
    if (forceSqlFailure && sql.includes('DELETE FROM courses')) {
      throw new Error('simulated disk failure during final course deletion');
    }

    if (sql.includes('SELECT') && sql.includes('FROM courses WHERE id')) {
      const c = s.courses.get(values[0]);
      return { rows: c ? [{ id: c.id, title: c.title, thumbnailKey: c.thumbnailKey }] : [], rowCount: c ? 1 : 0 };
    }
    if (sql.includes('SELECT') && sql.includes('FROM ai_confirmations WHERE id')) {
      const rec = s.confirmations.get(values[0]);
      return { rows: rec ? [rec] : [], rowCount: rec ? 1 : 0 };
    }
    if (sql.includes('SELECT teacher_file_key') || sql.includes('SELECT image_file_key') ||
        sql.includes('SELECT pdf_storage_key') || sql.includes('SELECT file_key')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO ai_confirmations')) {
      const [id, tokenHash, email, actionType, payload, createdAt, expiresAt] = values;
      s.confirmations.set(id, {
        id, token_hash: tokenHash, staff_email: email, action_type: actionType,
        action_payload: payload, state: 'pending', result_json: null, created_at: createdAt,
        expires_at: expiresAt, executed_at: null, execution_id: null, error_message: null
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("state = 'executing'")) {
      const [executionId, executedAt, id] = values;
      const rec = s.confirmations.get(id);
      if (rec) Object.assign(rec, { state: 'executing', execution_id: executionId, executed_at: executedAt });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("state = 'succeeded'")) {
      const [resultJson, executedAt, id] = values;
      const rec = s.confirmations.get(id);
      if (rec) Object.assign(rec, { state: 'succeeded', result_json: resultJson, executed_at: executedAt });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("state = 'failed'")) {
      const errorMessage = values[0];
      const id = values[values.length - 1];
      const rec = s.confirmations.get(id);
      if (rec) Object.assign(rec, { state: 'failed', error_message: errorMessage });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO ai_action_logs')) {
      s.logs.push(values);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM courses')) {
      const id = values[0];
      s.courses.delete(id);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM videos')) {
      for (const [id, v] of s.videos) {
        if (v.course_id === values[0]) s.videos.delete(id);
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM exams')) {
      for (const [id, e] of s.exams) {
        if (e.course_id === values[0]) s.exams.delete(id);
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM questions')) {
      s.questions.clear();
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }

  // Realistic PoolClient inheriting from pg.Client
  function createPoolClient() {
    const client = new Client();
    client._connected = true; // Mark as already connected in pg
    let inTransaction = false;
    let stagedState = null;

    client.release = () => {
      clientActive = false;
    };

    client.query = async (sql, values = []) => {
      const normalizedSql = typeof sql === 'string' ? sql : sql.text;
      const normalizedValues = Array.isArray(values) ? values : (sql.values || []);

      if (normalizedSql === 'BEGIN') {
        inTransaction = true;
        stagedState = {
          confirmations: new Map(state.confirmations),
          logs: [...state.logs],
          courses: new Map(state.courses),
          videos: new Map(state.videos),
          exams: new Map(state.exams),
          questions: new Map(state.questions),
        };
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql === 'COMMIT') {
        inTransaction = false;
        if (stagedState) {
          state.confirmations = stagedState.confirmations;
          state.logs = stagedState.logs;
          state.courses = stagedState.courses;
          state.videos = stagedState.videos;
          state.exams = stagedState.exams;
          state.questions = stagedState.questions;
          stagedState = null;
        }
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql === 'ROLLBACK') {
        inTransaction = false;
        stagedState = null;
        return { rows: [], rowCount: 0 };
      }

      return executeSql(normalizedSql, normalizedValues, inTransaction ? stagedState : state);
    };

    return client;
  }

  const pool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    async connect() {
      clientActive = true;
      return createPoolClient();
    },
    async query(sql, values = []) {
      const client = await this.connect();
      try {
        return await client.query(sql, values);
      } finally {
        client.release();
      }
    },
  };

  return {
    pool,
    state,
    isClientActive: () => clientActive,
    setForceSqlFailure: (val) => { forceSqlFailure = val; },
  };
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

test('reproduces production bug: Database.batch on txDb must not attempt client.connect() and succeeds cleanly', async () => {
  const { pool, state } = createTestPoolAndState();
  const db = new Database(pool);
  const deletedFiles = [];
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: { delete: async (k) => { deletedFiles.push(k); } } };

  try {
    const afterCommit = [];
    const result = await confirmedDelete(db, 'course-delete', teacher, afterCommit);

    assert.equal(result.success, true);
    assert.equal(state.courses.has('course-delete'), false, 'Target course deleted');
    assert.equal(state.videos.has('video-delete'), false, 'Target videos deleted');
    assert.equal(state.courses.has('course-keep'), true, 'Unrelated course preserved');
    assert.equal(state.videos.has('video-keep'), true, 'Unrelated videos preserved');

    const conf = [...state.confirmations.values()][0];
    assert.equal(conf.state, 'succeeded', 'Confirmation reaches succeeded');

    // Post-commit effects executed
    assert.equal(afterCommit.length, 1);
    await Promise.all(afterCommit.map((fn) => fn()));
    assert.ok(deletedFiles.includes('thumb-1'), 'Storage file cleaned up post-commit');
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

test('transaction rollback: forced SQL failure rolls back transaction, fails confirmation, keeps course', async () => {
  const { pool, state, setForceSqlFailure } = createTestPoolAndState();
  const db = new Database(pool);
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: { delete: async () => {} } };

  try {
    setForceSqlFailure(true);
    const afterCommit = [];

    await assert.rejects(
      () => confirmedDelete(db, 'course-delete', teacher, afterCommit),
      /فشل حذف الكورس وبياناته التابعة/
    );

    // Confirmation must be marked failed
    const conf = [...state.confirmations.values()][0];
    assert.equal(conf.state, 'failed');

    // Course and children must remain intact in state
    assert.equal(state.courses.has('course-delete'), true, 'Course preserved after rollback');
    assert.equal(state.videos.has('video-delete'), true, 'Videos preserved after rollback');
    assert.equal(state.courses.has('course-keep'), true);

    // afterCommit must NOT run
    assert.equal(afterCommit.length, 0, 'No post-commit effects scheduled/executed');
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

test('delete_course rejects nonexistent targets, missing permission, and missing confirmation', async () => {
  const { pool, state } = createTestPoolAndState();
  const db = new Database(pool);
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, STORAGE: { delete: async () => {} } };

  try {
    await assert.rejects(() => confirmedDelete(db, 'missing'), /الكورس غير موجود/);
    const conf = [...state.confirmations.values()][0];
    assert.equal(conf.state, 'failed');
    assert.equal(state.courses.has('course-keep'), true);

    await assert.rejects(
      () => executeTool({ toolName: 'delete_course', args: { courseId: 'course-delete' }, actor: unauthorized, context: { db, confirmationSatisfied: true } }),
      (error) => error instanceof ToolExecutionError && error.code === 'FORBIDDEN'
    );
    await assert.rejects(
      () => executeTool({ toolName: 'delete_course', args: { courseId: 'course-delete' }, actor: teacher, context: { db } }),
      (error) => error instanceof ToolExecutionError && error.code === 'CONFIRMATION_REQUIRED'
    );
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

