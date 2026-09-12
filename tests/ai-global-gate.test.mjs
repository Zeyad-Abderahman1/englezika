import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  GlobalAiGate,
  withGlobalAiGate,
  AI_GATE_MAX_RUNNING,
  AI_GATE_MAX_WAITING,
  AI_GATE_MAX_TOTAL,
  AiGateSaturatedError,
  AiGateCoordinationError,
} from '../app/lib/ai/ai-global-gate.server.ts';
import { OpenRouterAssessmentProvider } from '../app/lib/ai/providers/openrouter-assessment-provider.server.ts';

// In-memory Mock Database for unit testing the state machine & locking
class MockRuntimeQueueDatabase {
  constructor() {
    this.rows = [];
    this.nextId = 1;
    this.lockHeld = false;
    this.failQueries = false;
  }

  cloneRows() {
    return JSON.parse(JSON.stringify(this.rows));
  }

  async withTransaction(callback) {
    if (this.failQueries) {
      throw new Error('ECONNREFUSED 127.0.0.1:5432');
    }
    // Simulate serializable / advisory lock
    const prevLock = this.lockHeld;
    this.lockHeld = true;
    const snapshot = this.cloneRows();
    try {
      const result = await callback(this);
      this.lockHeld = prevLock;
      return result;
    } catch (err) {
      this.rows = snapshot;
      this.lockHeld = prevLock;
      throw err;
    }
  }

  prepare(sql) {
    const db = this;
    const normalized = sql.trim().replace(/\s+/g, ' ');

    const createHandler = (boundArgs = []) => ({
      bind(...args) {
        return createHandler(args);
      },

      async run(...runArgs) {
        if (db.failQueries) throw new Error('Database query failed');
        const args = runArgs.length > 0 ? runArgs : boundArgs;

        if (normalized.includes('DELETE FROM ai_runtime_queue WHERE request_id')) {
          const reqId = args[0];
          db.rows = db.rows.filter((r) => r.request_id !== reqId);
          return { rowCount: 1 };
        }

        if (normalized.includes('DELETE FROM ai_runtime_queue WHERE expires_at')) {
          const now = args[0];
          const before = db.rows.length;
          db.rows = db.rows.filter((r) => r.expires_at >= now);
          return { rowCount: before - db.rows.length };
        }

        if (normalized.includes("UPDATE ai_runtime_queue SET status = 'running'")) {
          const reqId = args[args.length - 1];
          const started_at = args[0];
          const heartbeat_at = args.length === 4 ? args[1] : started_at;
          const expires_at = args.length === 4 ? args[2] : args[1];
          const row = db.rows.find((r) => r.request_id === reqId);
          if (row) {
            row.status = 'running';
            row.started_at = started_at;
            row.heartbeat_at = heartbeat_at;
            row.expires_at = expires_at;
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        }

        if (normalized.includes('UPDATE ai_runtime_queue SET heartbeat_at')) {
          const [heartbeat_at, expires_at, reqId] = args;
          const row = db.rows.find((r) => r.request_id === reqId);
          if (row) {
            row.heartbeat_at = heartbeat_at;
            row.expires_at = expires_at;
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        }

        if (normalized.includes('INSERT INTO ai_runtime_queue')) {
          const reqId = args[0];
          const workerId = args[1];
          const created_at = args[2];
          const expires_at = args[args.length - 1];
          const id = db.nextId++;
          const row = {
            id,
            request_id: reqId,
            worker_id: workerId,
            status: 'waiting',
            created_at,
            started_at: null,
            heartbeat_at: created_at,
            expires_at,
          };
          db.rows.push(row);
          return { rowCount: 1, lastInsertRowid: id };
        }

        return { rowCount: 0 };
      },

      async first(...firstArgs) {
        return this.get(...firstArgs);
      },

      async get(...getArgs) {
        if (db.failQueries) throw new Error('Database query failed');
        const args = getArgs.length > 0 ? getArgs : boundArgs;

        if (normalized.includes('COUNT(*)')) {
          const count = db.rows.length;
          return { count };
        }

        if (normalized.includes("WHERE status = 'running'")) {
          const now = args[0] || Date.now();
          const row = db.rows.find((r) => r.status === 'running' && r.expires_at >= now);
          return row || null;
        }

        if (normalized.includes("WHERE status = 'waiting' ORDER BY id ASC LIMIT 1")) {
          const waiting = db.rows
            .filter((r) => r.status === 'waiting')
            .sort((a, b) => a.id - b.id);
          return waiting[0] || null;
        }

        if (normalized.includes('WHERE request_id')) {
          const reqId = args[0];
          const row = db.rows.find((r) => r.request_id === reqId);
          return row || null;
        }

        return null;
      },

      async all() {
        if (db.failQueries) throw new Error('Database query failed');
        return [...db.rows];
      },
    });

    return createHandler();
  }
}

describe('PostgreSQL Global AI Gate (Multi-Worker Single-Flight Coordination)', () => {
  test('constants conform to specification: max running = 1, max waiting = 2, max total = 3', () => {
    assert.equal(AI_GATE_MAX_RUNNING, 1);
    assert.equal(AI_GATE_MAX_WAITING, 2);
    assert.equal(AI_GATE_MAX_TOTAL, 3);
  });

  test('Worker A and Worker B cannot both run generation (global running max = 1)', async () => {
    const db = new MockRuntimeQueueDatabase();
    const gate = new GlobalAiGate({ db, pollIntervalMs: 20 });

    let workerAStarted = false;
    let workerAFinished = false;
    let workerBStartedWhileAActive = false;

    const taskA = gate.execute({
      requestId: 'req_a',
      workerId: 'worker_1_pid100',
      action: async () => {
        workerAStarted = true;
        await new Promise((r) => setTimeout(r, 60));
        workerAFinished = true;
        return 'result_a';
      },
    });

    // Give worker A time to acquire running status
    await new Promise((r) => setTimeout(r, 10));

    const taskB = gate.execute({
      requestId: 'req_b',
      workerId: 'worker_2_pid101',
      action: async () => {
        if (!workerAFinished) {
          workerBStartedWhileAActive = true;
        }
        return 'result_b';
      },
    });

    const [resA, resB] = await Promise.all([taskA, taskB]);
    assert.equal(resA, 'result_a');
    assert.equal(resB, 'result_b');
    assert.equal(workerAStarted, true);
    assert.equal(workerAFinished, true);
    assert.equal(workerBStartedWhileAActive, false, 'Worker B must NOT run while Worker A is active');
  });

  test('two global waiters allowed; fourth total request is rejected with AiGateSaturatedError', async () => {
    const db = new MockRuntimeQueueDatabase();
    const gate = new GlobalAiGate({ db, pollIntervalMs: 20 });

    let unblockA;
    const blockerA = new Promise((resolve) => {
      unblockA = resolve;
    });

    // 1. Running task (slot 1)
    const task1 = gate.execute({
      requestId: 'req_1',
      workerId: 'worker_1',
      action: async () => {
        await blockerA;
        return 'done_1';
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    // 2. Waiting task 1 (slot 2)
    const task2 = gate.execute({
      requestId: 'req_2',
      workerId: 'worker_2',
      action: async () => 'done_2',
    });

    await new Promise((r) => setTimeout(r, 10));

    // 3. Waiting task 2 (slot 3)
    const task3 = gate.execute({
      requestId: 'req_3',
      workerId: 'worker_3',
      action: async () => 'done_3',
    });

    await new Promise((r) => setTimeout(r, 10));

    // 4. Fourth request (should be rejected immediately)
    await assert.rejects(
      async () => {
        await gate.execute({
          requestId: 'req_4',
          workerId: 'worker_4',
          action: async () => 'done_4',
        });
      },
      (err) => {
        assert.ok(err instanceof AiGateSaturatedError || err.code === 'AI_QUEUE_SATURATED');
        assert.ok(err.message.includes('مشغولة') || err.message.includes('busy'));
        return true;
      }
    );

    // Unblock task 1 and finish remaining
    unblockA();
    const [r1, r2, r3] = await Promise.all([task1, task2, task3]);
    assert.equal(r1, 'done_1');
    assert.equal(r2, 'done_2');
    assert.equal(r3, 'done_3');
  });

  test('FIFO claim order across simulated workers', async () => {
    const db = new MockRuntimeQueueDatabase();
    const gate = new GlobalAiGate({ db, pollIntervalMs: 15 });

    const executionOrder = [];
    let unblock1;
    const blocker = new Promise((r) => { unblock1 = r; });

    // Task 1 runs
    const p1 = gate.execute({
      requestId: 'req_fifo_1',
      workerId: 'worker_1',
      action: async () => {
        executionOrder.push('task_1');
        await blocker;
        return 'done_1';
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Task 2 enqueues (FIFO #1)
    const p2 = gate.execute({
      requestId: 'req_fifo_2',
      workerId: 'worker_2',
      action: async () => {
        executionOrder.push('task_2');
        return 'done_2';
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Task 3 enqueues (FIFO #2)
    const p3 = gate.execute({
      requestId: 'req_fifo_3',
      workerId: 'worker_3',
      action: async () => {
        executionOrder.push('task_3');
        return 'done_3';
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    unblock1();
    await Promise.all([p1, p2, p3]);

    assert.deepEqual(executionOrder, ['task_1', 'task_2', 'task_3'], 'Tasks must execute in strict FIFO order');
  });

  test('cancellation removes waiting request immediately and allows next FIFO request to advance', async () => {
    const db = new MockRuntimeQueueDatabase();
    const gate = new GlobalAiGate({ db, pollIntervalMs: 15 });

    let unblock1;
    const blocker = new Promise((r) => { unblock1 = r; });

    const p1 = gate.execute({
      requestId: 'req_c_1',
      workerId: 'worker_1',
      action: async () => {
        await blocker;
        return 'done_1';
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Task 2 has abort controller
    const ac2 = new AbortController();
    const p2 = gate.execute({
      requestId: 'req_c_2',
      workerId: 'worker_2',
      signal: ac2.signal,
      action: async () => 'done_2',
    });

    await new Promise((r) => setTimeout(r, 10));

    // Task 3 waits behind task 2
    const p3 = gate.execute({
      requestId: 'req_c_3',
      workerId: 'worker_3',
      action: async () => 'done_3',
    });

    await new Promise((r) => setTimeout(r, 10));

    // Cancel task 2 while waiting
    ac2.abort();

    await assert.rejects(p2, (err) => {
      assert.ok(err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('إلغاء'));
      return true;
    });

    // Verify task 2 was removed from DB
    assert.equal(db.rows.find((r) => r.request_id === 'req_c_2'), undefined);

    // Unblock task 1
    unblock1();
    const [r1, r3] = await Promise.all([p1, p3]);
    assert.equal(r1, 'done_1');
    assert.equal(r3, 'done_3');
  });

  test('running failure releases slot so next waiter runs without deadlock', async () => {
    const db = new MockRuntimeQueueDatabase();
    const gate = new GlobalAiGate({ db, pollIntervalMs: 15 });

    const p1 = gate.execute({
      requestId: 'req_err_1',
      workerId: 'worker_1',
      action: async () => {
        throw new Error('Provider inference exploded');
      },
    });

    const p2 = gate.execute({
      requestId: 'req_err_2',
      workerId: 'worker_2',
      action: async () => {
        return 'recovered_and_done';
      },
    });

    await assert.rejects(p1, /Provider inference exploded/);
    const r2 = await p2;
    assert.equal(r2, 'recovered_and_done');

    // Verify all rows are cleaned up
    assert.equal(db.rows.length, 0);
  });

  test('OpenRouter timeout releases the global slot for the next assessment request', async () => {
    const db = new MockRuntimeQueueDatabase();
    const gate = new GlobalAiGate({ db, pollIntervalMs: 15 });
    const provider = new OpenRouterAssessmentProvider({
      apiKey: 'test-only-secret',
      timeoutMs: 10,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }),
    });

    const timedOut = gate.execute({
      requestId: 'req_remote_timeout',
      workerId: 'worker_1',
      action: () => provider.generateStructuredOutput({ userPrompt: 'generate' }),
    });
    await assert.rejects(timedOut, (error) => error.failureClass === 'timeout');
    assert.equal(db.rows.length, 0);

    const next = await gate.execute({
      requestId: 'req_after_timeout',
      workerId: 'worker_2',
      action: async () => 'next-ran',
    });
    assert.equal(next, 'next-ran');
    assert.equal(db.rows.length, 0);
  });

  test('stale running row recovery: dead worker running row is swept and slot is claimed', async () => {
    const db = new MockRuntimeQueueDatabase();
    const now = Date.now();

    // Manually inject a stale running row from a crashed worker that expired 10 seconds ago
    db.rows.push({
      id: 1,
      request_id: 'req_crashed_worker',
      worker_id: 'worker_dead_pid999',
      status: 'running',
      created_at: now - 60000,
      started_at: now - 50000,
      heartbeat_at: now - 40000,
      expires_at: now - 10000, // EXPIRED
    });

    const gate = new GlobalAiGate({ db, pollIntervalMs: 15 });

    // A new request arrives; it must detect the expired row, sweep it, and execute
    const result = await gate.execute({
      requestId: 'req_healthy_worker',
      workerId: 'worker_live_pid102',
      action: async () => 'successfully_recovered_slot',
    });

    assert.equal(result, 'successfully_recovered_slot');
    // Stale row must have been swept
    assert.equal(db.rows.find((r) => r.request_id === 'req_crashed_worker'), undefined);
  });

  test('fail-closed: database connection failure rejects with sanitized error and does not run inference', async () => {
    const db = new MockRuntimeQueueDatabase();
    db.failQueries = true; // DB is offline

    const gate = new GlobalAiGate({ db, pollIntervalMs: 15 });

    let inferenceExecuted = false;

    await assert.rejects(
      async () => {
        await gate.execute({
          requestId: 'req_db_down',
          workerId: 'worker_1',
          action: async () => {
            inferenceExecuted = true;
            return 'should_never_run';
          },
        });
      },
      (err) => {
        assert.ok(err instanceof AiGateCoordinationError || err.code === 'AI_COORDINATION_FAILED');
        assert.ok(!err.message.includes('ECONNREFUSED'), 'Must not leak database internals');
        return true;
      }
    );

    assert.equal(inferenceExecuted, false, 'Must fail closed; zero inference when DB down');
  });

  test('runtime queue table contains ZERO prompts, PDFs, model output, or user secrets', async () => {
    const db = new MockRuntimeQueueDatabase();
    const gate = new GlobalAiGate({ db, pollIntervalMs: 15 });

    await gate.execute({
      requestId: 'req_sensitive_check',
      workerId: 'worker_1',
      action: async () => {
        // While running, inspect the table row
        const row = db.rows.find((r) => r.request_id === 'req_sensitive_check');
        assert.ok(row);

        const keys = Object.keys(row);
        const forbiddenTerms = ['prompt', 'content', 'pdf', 'text', 'secret', 'password', 'token', 'model', 'output'];
        for (const term of forbiddenTerms) {
          assert.equal(
            keys.some((k) => k.toLowerCase().includes(term)),
            false,
            `Column list must not include ${term}`
          );
        }
        return 'ok';
      },
    });
  });

  test('WEB_CONCURRENCY=4: 4 distinct web workers each running AiQueue coordinate single-flight globally', async () => {
    const { AiQueue } = await import('../app/lib/ai/ai-queue.ts');
    const sharedDb = new MockRuntimeQueueDatabase();

    // 4 independent Next.js web worker queues sharing the same PostgreSQL database
    const worker1Queue = new AiQueue({ maxWaiting: 2, useGlobalGate: true, workerId: 'worker_1', gateDb: sharedDb });
    const worker2Queue = new AiQueue({ maxWaiting: 2, useGlobalGate: true, workerId: 'worker_2', gateDb: sharedDb });
    const worker3Queue = new AiQueue({ maxWaiting: 2, useGlobalGate: true, workerId: 'worker_3', gateDb: sharedDb });
    const worker4Queue = new AiQueue({ maxWaiting: 2, useGlobalGate: true, workerId: 'worker_4', gateDb: sharedDb });

    let activeInferenceCount = 0;
    let maxObservedGlobalInference = 0;

    const makeTask = (workerName, durationMs = 50) => async () => {
      activeInferenceCount++;
      maxObservedGlobalInference = Math.max(maxObservedGlobalInference, activeInferenceCount);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      activeInferenceCount--;
      return `${workerName}_done`;
    };

    // Worker 1 starts generation
    const job1 = worker1Queue.enqueue(makeTask('worker1', 200));
    await new Promise((r) => setTimeout(r, 15));

    // Worker 2 enqueues (becomes waiting #1 in global queue)
    const job2 = worker2Queue.enqueue(makeTask('worker2', 40));
    await new Promise((r) => setTimeout(r, 15));

    // Worker 3 enqueues (becomes waiting #2 in global queue)
    const job3 = worker3Queue.enqueue(makeTask('worker3', 40));
    await new Promise((r) => setTimeout(r, 15));

    // Worker 4 enqueues (4th total request globally: must be rejected with AiGateSaturatedError)
    await assert.rejects(
      async () => {
        await worker4Queue.enqueue(makeTask('worker4', 20));
      },
      (err) => {
        assert.ok(err instanceof AiGateSaturatedError || err.code === 'AI_QUEUE_SATURATED');
        return true;
      }
    );

    const [res1, res2, res3] = await Promise.all([job1, job2, job3]);
    assert.equal(res1, 'worker1_done');
    assert.equal(res2, 'worker2_done');
    assert.equal(res3, 'worker3_done');
    assert.equal(maxObservedGlobalInference, 1, 'Never more than 1 generation across all 4 workers');
    assert.equal(activeInferenceCount, 0);
  });
});
