import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  createConfirmationRequest,
  verifyAndExecuteConfirmation,
  signConfirmation,
  parseConfirmationToken,
  CONFIRMATION_EXPIRY_MS,
  STALE_EXECUTION_THRESHOLD_MS,
} from '../app/lib/ai/confirmation.server.ts';

const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

const teacherActor = {
  email: 'teacher@englizeka.com',
  role: 'teacher',
  permissions: ['manage_courses', 'manage_exams'],
};

const otherTeacherActor = {
  email: 'other_teacher@englizeka.com',
  role: 'teacher',
  permissions: ['manage_courses'],
};

class MockConfirmationDatabase {
  constructor() {
    this.confirmations = new Map();
    this.actionLogs = [];
    this.courses = new Map([
      ['course_123', { id: 'course_123', title: 'Original Course', price: 100, is_active: 0 }],
    ]);
  }

  clone() {
    const copy = new MockConfirmationDatabase();
    copy.confirmations = new Map(JSON.parse(JSON.stringify(Array.from(this.confirmations.entries()))));
    copy.actionLogs = [...this.actionLogs];
    copy.courses = new Map(JSON.parse(JSON.stringify(Array.from(this.courses.entries()))));
    return copy;
  }

  async withTransaction(callback) {
    const snapshot = this.clone();
    try {
      const result = await callback(snapshot);
      // On success, commit snapshot back to self
      this.confirmations = snapshot.confirmations;
      this.actionLogs = snapshot.actionLogs;
      this.courses = snapshot.courses;
      return result;
    } catch (err) {
      // Transaction rolled back - do not apply changes
      throw err;
    }
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('FROM ai_confirmations WHERE id = ?')) {
              const row = db.confirmations.get(args[0]);
              return row ? { ...row } : null;
            }
            if (sql.includes('FROM courses WHERE id = ?')) {
              const row = db.courses.get(args[0]);
              return row ? { ...row } : null;
            }
            return null;
          },
          async run() {
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
                executed_at: null,
                execution_id: null,
                error_message: null,
              });
              return { results: [], success: true, meta: { changes: 1 } };
            }

            if (sql.includes("UPDATE ai_confirmations SET state = 'executing'")) {
              const [executionId, executedAt, tokenId] = args;
              const row = db.confirmations.get(tokenId);
              if (row && row.state === 'pending') {
                row.state = 'executing';
                row.execution_id = executionId;
                row.executed_at = executedAt;
                return { results: [], success: true, meta: { changes: 1 } };
              }
              return { results: [], success: true, meta: { changes: 0 } };
            }

            if (sql.includes("UPDATE ai_confirmations SET state = 'succeeded'")) {
              const [resultJson, executedAt, tokenId] = args;
              const row = db.confirmations.get(tokenId);
              if (row) {
                row.state = 'succeeded';
                row.result_json = resultJson;
                row.executed_at = executedAt;
                return { results: [], success: true, meta: { changes: 1 } };
              }
              return { results: [], success: true, meta: { changes: 0 } };
            }

            if (sql.includes("UPDATE ai_confirmations SET state = 'failed'")) {
              let errorMsg, executedAt, tokenId;
              if (args.length === 3) {
                [errorMsg, executedAt, tokenId] = args;
              } else {
                [errorMsg, tokenId] = args;
                executedAt = Date.now();
              }
              const row = db.confirmations.get(tokenId);
              if (row) {
                row.state = 'failed';
                row.error_message = errorMsg;
                row.executed_at = executedAt;
                return { results: [], success: true, meta: { changes: 1 } };
              }
              return { results: [], success: true, meta: { changes: 0 } };
            }

            if (sql.includes('INSERT INTO ai_action_logs')) {
              const [id, staff_email, action_type, action_summary, details, ip_address, created_at] = args;
              db.actionLogs.push({
                id,
                staff_email,
                action_type,
                action_summary,
                details,
                ip_address,
                created_at,
              });
              return { results: [], success: true, meta: { changes: 1 } };
            }

            if (sql.includes('UPDATE courses SET price = ?')) {
              const [newPrice, courseId] = args;
              const course = db.courses.get(courseId);
              if (course) {
                course.price = newPrice;
                return { results: [], success: true, meta: { changes: 1 } };
              }
              return { results: [], success: true, meta: { changes: 0 } };
            }

            return { results: [], success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

describe('Durable AI Confirmation Engine', () => {
  test('creates a signed confirmation request and returns token with server-side payload storage', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    assert.ok(tokenResult.tokenId);
    assert.ok(tokenResult.signature);
    assert.ok(tokenResult.token.includes('.'));
    assert.equal(tokenResult.actionType, 'update_course_price');
    assert.equal(tokenResult.preview.requiresConfirmation, true);

    const record = db.confirmations.get(tokenResult.tokenId);
    assert.ok(record);
    assert.equal(record.staff_email, 'teacher@englizeka.com');
    assert.equal(record.state, 'pending');
    assert.deepEqual(JSON.parse(record.action_payload), { courseId: 'course_123', price: 250 });
  });

  test('successfully executes confirmed action and records audit log', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    let executorCalled = false;
    const executionResult = await verifyAndExecuteConfirmation({
      token: tokenResult.token,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor: async (actionType, payload, txDb) => {
        executorCalled = true;
        assert.equal(actionType, 'update_course_price');
        assert.equal(payload.price, 250);
        await txDb.prepare('UPDATE courses SET price = ? WHERE id = ?').bind(payload.price, payload.courseId).run();
        return { updated: true, newPrice: payload.price };
      },
    });

    assert.equal(executorCalled, true);
    assert.equal(executionResult.success, true);
    assert.equal(executionResult.cached, false);
    assert.deepEqual(executionResult.result, { updated: true, newPrice: 250 });

    // Verify DB state transitioned to succeeded
    const record = db.confirmations.get(tokenResult.tokenId);
    assert.equal(record.state, 'succeeded');
    assert.deepEqual(JSON.parse(record.result_json), { updated: true, newPrice: 250 });
    assert.equal(db.courses.get('course_123').price, 250);
    assert.equal(db.actionLogs.length, 1);
  });

  test('rejects execution when signature is invalid/tampered', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    // Tamper the signature
    const tamperedToken = `${tokenResult.tokenId}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;

    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tamperedToken,
          actor: teacherActor,
          secret: TEST_SECRET,
          db,
          executor: async () => ({ success: true }),
        });
      },
      /Invalid or tampered confirmation signature/i
    );

    // Confirmation must remain pending
    assert.equal(db.confirmations.get(tokenResult.tokenId).state, 'pending');
  });

  test('rejects execution when submitted by wrong actor (actor mismatch)', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tokenResult.token,
          actor: otherTeacherActor, // Different email
          secret: TEST_SECRET,
          db,
          executor: async () => ({ success: true }),
        });
      },
      /Actor mismatch/i
    );

    assert.equal(db.confirmations.get(tokenResult.tokenId).state, 'pending');
  });

  test('rejects expired confirmation token', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      expiresInMs: -1000, // Expired in past
      secret: TEST_SECRET,
      db,
    });

    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tokenResult.token,
          actor: teacherActor,
          secret: TEST_SECRET,
          db,
          executor: async () => ({ success: true }),
        });
      },
      /Confirmation token has expired/i
    );

    assert.equal(db.confirmations.get(tokenResult.tokenId).state, 'failed');
  });

  test('replay/retry of succeeded action returns original result without re-executing', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    let executionCount = 0;
    const executor = async () => {
      executionCount++;
      return { executionCount, timestamp: 12345 };
    };

    // First execution
    const firstResult = await verifyAndExecuteConfirmation({
      token: tokenResult.token,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor,
    });

    assert.equal(firstResult.cached, false);
    assert.equal(firstResult.result.executionCount, 1);
    assert.equal(executionCount, 1);

    // Second execution (replay / network retry)
    const secondResult = await verifyAndExecuteConfirmation({
      token: tokenResult.token,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor,
    });

    assert.equal(secondResult.cached, true);
    assert.equal(secondResult.result.executionCount, 1);
    assert.equal(executionCount, 1); // Executor was NOT re-run!
  });

  test('detects process-crash / stale execution state and blocks blind re-execution', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    // Simulate process crash: record left in 'executing' state with timestamp > 2 minutes ago
    const record = db.confirmations.get(tokenResult.tokenId);
    record.state = 'executing';
    record.executed_at = Date.now() - (STALE_EXECUTION_THRESHOLD_MS + 10000);

    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tokenResult.token,
          actor: teacherActor,
          secret: TEST_SECRET,
          db,
          executor: async () => ({ executed: true }),
        });
      },
      /Confirmation execution is stale or crashed and cannot be safely re-executed/i
    );

    // State is transitioned to failed so it cannot be touched again
    assert.equal(db.confirmations.get(tokenResult.tokenId).state, 'failed');
  });

  test('rejects duplicate concurrent request if already executing', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    // Simulate currently executing action within safe threshold
    const record = db.confirmations.get(tokenResult.tokenId);
    record.state = 'executing';
    record.executed_at = Date.now() - 5000; // 5 seconds ago

    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tokenResult.token,
          actor: teacherActor,
          secret: TEST_SECRET,
          db,
          executor: async () => ({ executed: true }),
        });
      },
      /Confirmation action is currently executing in another process/i
    );
  });

  test('canonical payload stored on server prevents client payload tampering', async () => {
    const db = new MockConfirmationDatabase();
    // Teacher prepares confirmation for price 250
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 250 },
      secret: TEST_SECRET,
      db,
    });

    // An attacker cannot supply an altered payload during confirmation submission,
    // because verifyAndExecuteConfirmation ONLY takes the token and retrieves canonical payload from DB.
    let payloadSeenByDomain;
    await verifyAndExecuteConfirmation({
      token: tokenResult.token,
      actor: teacherActor,
      secret: TEST_SECRET,
      db,
      executor: async (actionType, payload) => {
        payloadSeenByDomain = payload;
        return { success: true };
      },
    });

    assert.deepEqual(payloadSeenByDomain, { courseId: 'course_123', price: 250 });
  });

  test('transaction rollback: on domain error, state marks failed and DB mutations rollback', async () => {
    const db = new MockConfirmationDatabase();
    const tokenResult = await createConfirmationRequest({
      actor: teacherActor,
      actionType: 'update_course_price',
      actionPayload: { courseId: 'course_123', price: 999 },
      secret: TEST_SECRET,
      db,
    });

    await assert.rejects(
      async () => {
        await verifyAndExecuteConfirmation({
          token: tokenResult.token,
          actor: teacherActor,
          secret: TEST_SECRET,
          db,
          executor: async (actionType, payload, txDb) => {
            // Perform mutation
            await txDb.prepare('UPDATE courses SET price = ? WHERE id = ?').bind(payload.price, payload.courseId).run();
            // Then fail unexpectedly
            throw new Error('Simulated domain failure mid-transaction');
          },
        });
      },
      /Simulated domain failure mid-transaction/i
    );

    // Course price was rolled back!
    assert.equal(db.courses.get('course_123').price, 100);

    // Confirmation record is marked failed
    assert.equal(db.confirmations.get(tokenResult.tokenId).state, 'failed');
    assert.ok(db.confirmations.get(tokenResult.tokenId).error_message.includes('Simulated domain failure'));
  });
});
