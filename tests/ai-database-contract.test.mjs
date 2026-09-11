import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import { loadConversationHistory } from '../app/lib/ai/orchestrator.ts';
import { executeTool } from '../app/lib/ai/tool-executor.ts';
import { verifyAndExecuteConfirmation, createConfirmationRequest } from '../app/lib/ai/confirmation.server.ts';

test('AI Database Contract & Return Shape Suite', async (t) => {
  await t.test('A. Conversation history loading works when .all() returns canonical DatabaseResult { results: [...], success: true, meta: {...} }', async () => {
    const mockDb = {
      prepare(sql) {
        return {
          bind(convId, email, limit) {
            return {
              async all() {
                // Canonical DatabaseResult shape from app/lib/database.ts
                return {
                  results: [
                    {
                      id: 'msg_2',
                      role: 'assistant',
                      content: 'Here is your quiz draft.',
                      tool_call_json: null,
                      created_at: 1700000002,
                    },
                    {
                      id: 'msg_1',
                      role: 'user',
                      content: 'Create a quiz for Grade 10',
                      tool_call_json: null,
                      created_at: 1700000001,
                    },
                  ],
                  success: true,
                  meta: { changes: 2 },
                };
              },
            };
          },
        };
      },
    };

    const messages = await loadConversationHistory('conv_123', 'teacher@englizeka.com', mockDb);
    assert.equal(Array.isArray(messages), true, 'loadConversationHistory must return an array');
    assert.equal(messages.length, 2, 'Must load exactly 2 messages');
    // Chronological order check: msg_1 then msg_2
    assert.equal(messages[0].id, 'msg_1');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].id, 'msg_2');
    assert.equal(messages[1].role, 'assistant');
  });

  await t.test('B. Empty conversation history works cleanly when .all() returns { results: [], success: true, meta: {...} }', async () => {
    const mockDb = {
      prepare(sql) {
        return {
          bind(convId, email, limit) {
            return {
              async all() {
                return {
                  results: [],
                  success: true,
                  meta: { changes: 0 },
                };
              },
            };
          },
        };
      },
    };

    const messages = await loadConversationHistory('conv_empty', 'teacher@englizeka.com', mockDb);
    assert.equal(Array.isArray(messages), true);
    assert.equal(messages.length, 0);
  });

  await t.test('C. Static check: No AI code attempts .map() directly on the return value of .all()', () => {
    const orchestratorPath = path.join(rootDir, 'app/lib/ai/orchestrator.ts');
    const orchestratorSource = fs.readFileSync(orchestratorPath, 'utf8');

    // Confirm that (rows || []).map is gone and rows extraction handles result.results
    assert.ok(
      !orchestratorSource.includes('(rows || []).map'),
      'Must NOT call (rows || []).map directly on the result of .all()'
    );
    assert.ok(
      orchestratorSource.includes('result?.results') || orchestratorSource.includes('result.results'),
      'Must extract results array from DatabaseResult'
    );
  });

  await t.test('D. list_courses works with real PostgreSQL QueryResult shape { rows: [...], rowCount: ... }', async () => {
    const mockPgDb = {
      async query(sql) {
        if (sql.includes('FROM courses')) {
          return {
            rows: [
              { id: 'c_1', title: 'English Grade 10', grade: '1sec', price: 150, status: 'published' },
              { id: 'c_2', title: 'Grammar Mastery', grade: '2sec', price: 200, status: 'draft' },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const actor = {
      email: 'teacher@englizeka.com',
      role: 'teacher',
      permissions: ['manage_courses'],
    };

    const result = await executeTool({
      toolName: 'list_courses',
      args: {},
      actor,
      context: { db: mockPgDb },
    });

    assert.equal(result.ok, true);
    assert.ok(result.result.courses, 'Must return courses array');
    assert.equal(result.result.courses.length, 2);
    assert.equal(result.result.courses[0].title, 'English Grade 10');
    assert.equal(result.result.courses[0].status, 'published');
    assert.equal(result.result.courses[0].isActive, true);
    assert.equal(result.result.courses[1].status, 'draft');
    assert.equal(result.result.courses[1].isActive, false);
  });

  await t.test('E. get_course works with real PostgreSQL QueryResult shape', async () => {
    const mockPgDb = {
      async query(sql, params) {
        if (sql.includes('FROM courses WHERE id = $1')) {
          return {
            rows: [
              { id: 'c_1', title: 'English Grade 10', grade: '1sec', price: 150, status: 'published' },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM course_items WHERE course_id = $1')) {
          return {
            rows: [
              { id: 'ci_1', item_type: 'video', item_id: 'v_1', sequence_order: 1 },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const actor = {
      email: 'teacher@englizeka.com',
      role: 'teacher',
      permissions: ['manage_courses'],
    };

    const result = await executeTool({
      toolName: 'get_course',
      args: { courseId: 'c_1' },
      actor,
      context: { db: mockPgDb },
    });

    assert.equal(result.ok, true);
    assert.ok(result.result.course);
    assert.equal(result.result.course.id, 'c_1');
    assert.equal(result.result.course.status, 'published');
    assert.equal(result.result.course.isActive, true);
    assert.equal(result.result.items.length, 1);
  });

  await t.test('F. Existing confirmation flow executes safely with canonical PreparedStatement.run() DatabaseResult { results: [], success: true, meta: { changes: 1 } }', async () => {
    const records = new Map();
    const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

    const mockDb = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT * FROM ai_confirmations WHERE id = ?')) {
                  const r = records.get(args[0]);
                  return r ? { ...r } : null;
                }
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO ai_confirmations')) {
                  const [id, token_hash, staff_email, action_type, action_payload, created_at, expires_at] = args;
                  records.set(id, {
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
                if (sql.includes("UPDATE ai_confirmations SET state = 'executing'")) {
                  const [execution_id, executed_at, id] = args;
                  const rec = records.get(id);
                  if (rec && rec.state === 'pending') {
                    rec.state = 'executing';
                    rec.execution_id = execution_id;
                    rec.executed_at = executed_at;
                    return { results: [], success: true, meta: { changes: 1 } };
                  }
                  return { results: [], success: true, meta: { changes: 0 } };
                }
                if (sql.includes("UPDATE ai_confirmations SET state = 'succeeded'")) {
                  const [result_json, executed_at, id] = args;
                  const rec = records.get(id);
                  if (rec) {
                    rec.state = 'succeeded';
                    rec.result_json = result_json;
                    rec.executed_at = executed_at;
                  }
                  return { results: [], success: true, meta: { changes: 1 } };
                }
                if (sql.includes('INSERT INTO ai_action_logs')) {
                  return { results: [], success: true, meta: { changes: 1 } };
                }
                return { results: [], success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    const req = await createConfirmationRequest({
      actor: { email: 'teacher@englizeka.com', role: 'teacher', permissions: ['manage_courses'] },
      actionType: 'update_course_price',
      actionPayload: { courseId: 'c_1', price: 250 },
      secret: TEST_SECRET,
      db: mockDb,
    });

    const execResult = await verifyAndExecuteConfirmation({
      token: req.token,
      actor: { email: 'teacher@englizeka.com', role: 'teacher', permissions: ['manage_courses'] },
      secret: TEST_SECRET,
      db: mockDb,
      executor: async (actionType, payload) => ({ success: true, newPrice: payload.price }),
    });

    assert.equal(execResult.success, true);
    assert.equal(execResult.result.newPrice, 250);
  });

  await t.test('G. Database adapter contract in app/lib/database.ts is unchanged', () => {
    const dbSource = fs.readFileSync(path.join(rootDir, 'app/lib/database.ts'), 'utf8');
    assert.ok(dbSource.includes('export type DatabaseResult<T = Record<string, unknown>> = {'));
    assert.ok(dbSource.includes('results: T[];'));
    assert.ok(dbSource.includes('success: true;'));
    assert.ok(dbSource.includes('meta: {'));
    assert.ok(dbSource.includes('changes: number;'));
  });
});
