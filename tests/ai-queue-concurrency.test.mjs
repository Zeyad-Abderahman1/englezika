import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  isLoopbackEndpoint,
  loadAiServerConfig,
  validateConfirmationSecret,
} from '../app/lib/ai/ai-config.server.ts';
import { getClientAiState } from '../app/lib/ai/ai-client-state.ts';
import { AiQueue, QueueSaturatedError, ResourceGuard } from '../app/lib/ai/ai-queue.ts';
import { MockAiProvider } from '../app/lib/ai/providers/mock-provider.ts';
import { OllamaAiProvider } from '../app/lib/ai/providers/ollama-provider.ts';
import { LlamaCppAiProvider } from '../app/lib/ai/providers/llamacpp-provider.ts';

describe('Phase 2: Server-Only AI Config & Security Controls', () => {
  test('feature flag disabled: does not require secret and defaults safely', () => {
    const config = loadAiServerConfig({
      AI_ASSISTANT_ENABLED: 'false',
    });
    assert.equal(config.enabled, false);
    assert.equal(config.confirmationSecret, '');
    assert.equal(config.provider, 'mock');
  });

  test('feature flag enabled: missing confirmation secret throws fatal error', () => {
    assert.throws(
      () =>
        loadAiServerConfig({
          AI_ASSISTANT_ENABLED: 'true',
          AI_CONFIRMATION_SECRET: '',
        }),
      /AI_CONFIRMATION_SECRET is required when AI_ASSISTANT_ENABLED=true/
    );
  });

  test('feature flag enabled: secret with insufficient entropy (<32 chars) throws', () => {
    assert.throws(
      () =>
        loadAiServerConfig({
          AI_ASSISTANT_ENABLED: 'true',
          AI_CONFIRMATION_SECRET: 'short-secret-1234',
        }),
      /at least 32 characters of entropy/
    );
  });

  test('feature flag enabled: valid 32+ char secret succeeds', () => {
    const validSecret = 'super-secret-entropy-key-that-is-at-least-32-chars-long';
    const config = loadAiServerConfig({
      AI_ASSISTANT_ENABLED: 'true',
      AI_CONFIRMATION_SECRET: validSecret,
      LOCAL_AI_PROVIDER: 'ollama',
    });
    assert.equal(config.enabled, true);
    assert.equal(config.confirmationSecret, validSecret);
    assert.equal(config.provider, 'ollama');
  });

  test('client-safe config exposes only safe flags and never leaks secrets or endpoints', () => {
    const clientStateEnabled = getClientAiState(true);
    assert.deepEqual(clientStateEnabled, { enabled: true });
    assert.equal(Object.keys(clientStateEnabled).length, 1);

    const clientStateDisabled = getClientAiState(false);
    assert.deepEqual(clientStateDisabled, { enabled: false });
    assert.equal(Object.keys(clientStateDisabled).length, 1);

    // Verify secret, endpoint, and model keys are absent
    assert.equal('confirmationSecret' in clientStateEnabled, false);
    assert.equal('endpoint' in clientStateEnabled, false);
    assert.equal('model' in clientStateEnabled, false);
    assert.equal('provider' in clientStateEnabled, false);
  });

  test('loopback validation: accepts loopback addresses and rejects external/cloud targets', () => {
    // Valid loopback addresses
    assert.equal(isLoopbackEndpoint('http://127.0.0.1:11434'), true);
    assert.equal(isLoopbackEndpoint('http://localhost:11434'), true);
    assert.equal(isLoopbackEndpoint('http://[::1]:11434'), true);
    assert.equal(isLoopbackEndpoint('http://127.0.0.5:8080'), true);
    assert.equal(isLoopbackEndpoint('https://127.0.0.1:443'), true);

    // Prohibited targets (external, metadata, private subnets, non-HTTP)
    assert.equal(isLoopbackEndpoint('http://attacker.com'), false);
    assert.equal(isLoopbackEndpoint('http://169.254.169.254/latest/meta-data'), false);
    assert.equal(isLoopbackEndpoint('http://10.0.0.5:11434'), false);
    assert.equal(isLoopbackEndpoint('http://192.168.1.100:11434'), false);
    assert.equal(isLoopbackEndpoint('http://172.16.0.1:11434'), false);
    assert.equal(isLoopbackEndpoint('ftp://127.0.0.1:21'), false);
    assert.equal(isLoopbackEndpoint('invalid-uri'), false);
    assert.equal(isLoopbackEndpoint(''), false);
  });

  test('loadAiServerConfig throws when configured with external endpoint', () => {
    assert.throws(
      () =>
        loadAiServerConfig({
          LOCAL_AI_ENDPOINT: 'http://attacker.com/api',
        }),
      /Invalid LOCAL_AI_ENDPOINT/
    );
  });
});

describe('Phase 2: AI Single-Flight Queue & Resource Guard', () => {
  test('single-flight: strictly one job executes at a time (maxConcurrent = 1)', async () => {
    const queue = new AiQueue({ maxWaiting: 2 });
    let concurrent = 0;
    let maxObservedConcurrent = 0;

    const createJob = (durationMs) => async () => {
      concurrent++;
      maxObservedConcurrent = Math.max(maxObservedConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      concurrent--;
      return 'done';
    };

    const p1 = queue.enqueue(createJob(30));
    const p2 = queue.enqueue(createJob(20));
    const p3 = queue.enqueue(createJob(10));

    await Promise.all([p1, p2, p3]);

    assert.equal(maxObservedConcurrent, 1);
    assert.equal(queue.getStats().executing, 0);
    assert.equal(queue.getStats().waiting, 0);
  });

  test('FIFO ordering: jobs are processed in the exact order enqueued', async () => {
    const queue = new AiQueue({ maxWaiting: 2 });
    const order = [];

    const p1 = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const p2 = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
    });
    const p3 = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);

    assert.deepEqual(order, [1, 2, 3]);
  });

  test('queue saturation: rejects 4th request when 1 executing + 2 waiting', async () => {
    const queue = new AiQueue({ maxWaiting: 2 });

    const slowJob = () => new Promise((r) => setTimeout(r, 100));

    const p1 = queue.enqueue(slowJob); // executing
    const p2 = queue.enqueue(slowJob); // waiting 1
    const p3 = queue.enqueue(slowJob); // waiting 2

    assert.equal(queue.getStats().executing, 1);
    assert.equal(queue.getStats().waiting, 2);

    // 4th request must be rejected immediately with QueueSaturatedError
    await assert.rejects(
      () => queue.enqueue(slowJob),
      (err) => err instanceof QueueSaturatedError && err.code === 'QUEUE_SATURATED'
    );

    // Check stats: rejected request does not stay in queue
    assert.equal(queue.getStats().waiting, 2);

    await Promise.all([p1, p2, p3]);
    assert.equal(queue.getStats().executing, 0);
    assert.equal(queue.getStats().waiting, 0);
  });

  test('deadlock recovery: queue continues cleanly after a task throws', async () => {
    const queue = new AiQueue({ maxWaiting: 2 });

    const failingJob = queue.enqueue(async () => {
      throw new Error('Simulated model failure');
    });

    const succeedingJob = queue.enqueue(async () => {
      return 'recovered_ok';
    });

    await assert.rejects(() => failingJob, /Simulated model failure/);
    const result = await succeedingJob;

    assert.equal(result, 'recovered_ok');
    assert.equal(queue.getStats().executing, 0);
    assert.equal(queue.getStats().waiting, 0);
  });

  test('cancellation: removes cancelled task from waiting queue', async () => {
    const queue = new AiQueue({ maxWaiting: 2 });
    const controller = new AbortController();

    const p1 = queue.enqueue(() => new Promise((r) => setTimeout(r, 50)));
    const p2 = queue.enqueue(
      () => Promise.resolve('should_not_run'),
      { signal: controller.signal }
    );
    const p3 = queue.enqueue(() => Promise.resolve('p3_ok'));

    // Abort p2 while waiting
    controller.abort();

    await assert.rejects(() => p2, /cancelled/);
    await p1;
    const res3 = await p3;

    assert.equal(res3, 'p3_ok');
    assert.equal(queue.getStats().waiting, 0);
    assert.equal(queue.getStats().executing, 0);
  });

  test('timeout enforcement: aborts job that exceeds timeoutMs', async () => {
    const queue = new AiQueue({ maxWaiting: 2 });

    await assert.rejects(
      () =>
        queue.enqueue(
          (signal) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(() => resolve('finished'), 200);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('Timed out'));
              });
            }),
          { timeoutMs: 30 }
        ),
      /Timed out/
    );

    assert.equal(queue.getStats().executing, 0);
  });

  test('resource guard: sheds load when active student exams exceed threshold', async () => {
    let mockActiveExams = 30; // > 25
    const guard = new ResourceGuard({
      maxActiveStudentExams: 25,
      getActiveExamsCount: () => mockActiveExams,
    });

    const decision = await guard.checkSystemHeadroom(0);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'ACTIVE_EXAMS_HIGH');

    mockActiveExams = 10;
    const allowedDecision = await guard.checkSystemHeadroom(0);
    assert.equal(allowedDecision.allowed, true);
  });
});

describe('Phase 2: Local AI Provider Abstraction & Implementations', () => {
  test('MockAiProvider: deterministic successful structured output and plan', async () => {
    const mock = new MockAiProvider({
      mockData: { questions: [{ q: 'Question 1?', answer: 'A' }] },
      mockPlan: {
        planText: 'Plan: Create Unit 4',
        actions: [{ tool: 'create_course', parameters: { title: 'Unit 4' } }],
      },
    });

    const output = await mock.generateStructuredOutput({
      userPrompt: 'Generate questions',
    });
    assert.equal(output.success, true);
    assert.equal(output.data.questions.length, 1);

    const plan = await mock.generatePlan('Create course Unit 4');
    assert.equal(plan.planText, 'Plan: Create Unit 4');
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].tool, 'create_course');
  });

  test('MockAiProvider: deterministic error modes (offline, invalid, timeout)', async () => {
    const mock = new MockAiProvider();

    mock.setMode('offline');
    await assert.rejects(
      () => mock.generateStructuredOutput({ userPrompt: 'test' }),
      (err) => err.code === 'PROVIDER_OFFLINE'
    );

    mock.setMode('timeout');
    await assert.rejects(
      () => mock.generateStructuredOutput({ userPrompt: 'test' }),
      (err) => err.code === 'TIMEOUT'
    );

    mock.setMode('invalid_response');
    const res = await mock.generateStructuredOutput({ userPrompt: 'test' });
    assert.equal(res.success, false);
    assert.match(res.rawText, /MALFORMED/);
  });

  test('OllamaAiProvider: keep_alive configuration and endpoint security', () => {
    const ollama = new OllamaAiProvider({
      endpoint: 'http://127.0.0.1:11434',
      idleTimeoutMinutes: 10,
    });
    assert.equal(ollama.getKeepAliveString(), '10m');

    // Reject non-loopback
    assert.throws(
      () =>
        new OllamaAiProvider({
          endpoint: 'http://remote-server.test:11434',
        }),
      /must be restricted to loopback/
    );
  });

  test('LlamaCppAiProvider: endpoint security and loopback enforcement', () => {
    const llamacpp = new LlamaCppAiProvider({
      endpoint: 'http://127.0.0.1:8080',
    });
    assert.equal(llamacpp.name, 'llamacpp');

    assert.throws(
      () =>
        new LlamaCppAiProvider({
          endpoint: 'http://192.168.1.50:8080',
        }),
      /must be restricted to loopback/
    );
  });

  test('no AI provider contains or executes LMS mutations', () => {
    // Assert strictly that providers expose only inference & health APIs
    const prohibitedMethods = [
      'createCourse',
      'updateCourse',
      'deleteCourse',
      'createLecture',
      'updateLecture',
      'deleteLecture',
      'createExam',
      'deleteExam',
      'executeTransaction',
      'db',
      'database',
    ];

    const providers = [
      new MockAiProvider(),
      new OllamaAiProvider({ endpoint: 'http://127.0.0.1:11434' }),
      new LlamaCppAiProvider({ endpoint: 'http://127.0.0.1:8080' }),
    ];

    for (const provider of providers) {
      for (const method of prohibitedMethods) {
        assert.equal(
          method in provider,
          false,
          `Provider ${provider.name} must never have LMS mutation member: ${method}`
        );
      }
    }
  });
});
