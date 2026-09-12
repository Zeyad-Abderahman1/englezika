import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  loadAssessmentProviderConfig,
} from '../app/lib/ai/assessment-provider-config.server.ts';
import {
  OpenRouterAssessmentProvider,
} from '../app/lib/ai/providers/openrouter-assessment-provider.server.ts';
import {
  AssessmentProviderRouter,
  AssessmentGenerationUnavailableError,
} from '../app/lib/ai/assessment-provider-router.server.ts';
import { ASSESSMENT_QUESTIONS_JSON_SCHEMA } from '../app/lib/ai/assessment-validator.ts';
import { validateGeneratedAssessment } from '../app/lib/ai/assessment-validator.ts';
import { AiQueue, ResourceGuard } from '../app/lib/ai/ai-queue.ts';
import { generateAssessmentFromText } from '../app/lib/ai/content-generator.ts';

function question(index) {
  return {
    prompt: `Question number ${index} from the supplied lesson?`,
    options: [`Answer ${index}`, `Distractor ${index} B`, `Distractor ${index} C`, `Distractor ${index} D`],
    correctIndex: 0,
    correctAnswer: `Answer ${index}`,
    explanation: `The supplied lesson supports answer ${index}.`,
  };
}

function openRouterResponse(questions, finishReason = 'stop') {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: finishReason,
      message: { content: JSON.stringify({ questions }) },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Phase 1 OpenRouter assessment configuration', () => {
  test('absent assessment provider selection preserves legacy local-only mode', () => {
    const config = loadAssessmentProviderConfig({});
    assert.equal(config.remoteEnabled, false);
    assert.equal(config.primaryProvider, 'ollama');
    assert.equal(config.fallbackProvider, null);
  });

  test('OpenRouter configuration is server-only, bounded, and model-configurable', () => {
    const config = loadAssessmentProviderConfig({
      AI_ASSESSMENT_PRIMARY_PROVIDER: 'openrouter',
      AI_ASSESSMENT_FALLBACK_PROVIDER: 'ollama',
      OPENROUTER_API_KEY: 'test-key-never-log',
      OPENROUTER_MODEL: 'openrouter/free',
      OPENROUTER_TIMEOUT_MS: '70000',
    });
    assert.equal(config.remoteEnabled, true);
    assert.equal(config.model, 'openrouter/free');
    assert.equal(config.timeoutMs, 70000);
    assert.equal(config.fallbackProvider, 'ollama');
    assert.equal(JSON.stringify(config).includes('NEXT_PUBLIC'), false);
  });

  test('remote mode defaults to Ollama fallback and cannot accidentally select a paid model', () => {
    const config = loadAssessmentProviderConfig({
      AI_ASSESSMENT_PRIMARY_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'test-only',
      OPENROUTER_MODEL: 'vendor/paid-model',
    });
    assert.equal(config.fallbackProvider, 'ollama');
    assert.equal(config.model, 'openrouter/free');

    const configuredFreeModel = loadAssessmentProviderConfig({
      AI_ASSESSMENT_PRIMARY_PROVIDER: 'openrouter',
      OPENROUTER_MODEL: 'vendor/model:free',
    });
    assert.equal(configuredFreeModel.model, 'vendor/model:free');
  });
});

describe('OpenRouterAssessmentProvider', () => {
  test('sends the canonical strict schema and privacy-preserving provider policy', async () => {
    let request;
    const provider = new OpenRouterAssessmentProvider({
      apiKey: 'unit-test-key',
      model: 'openrouter/free',
      fetchImpl: async (url, init) => {
        request = { url, init, body: JSON.parse(init.body) };
        return openRouterResponse([question(1)]);
      },
    });

    const result = await provider.generateStructuredOutput({
      systemPrompt: 'System grounding policy',
      userPrompt: 'Generate exactly 1 question from PDF text',
      maxTokens: 1400,
      schema: ASSESSMENT_QUESTIONS_JSON_SCHEMA,
    });

    assert.equal(result.success, true);
    assert.equal(result.data.questions.length, 1);
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(request.init.headers.Authorization, 'Bearer unit-test-key');
    assert.equal(request.body.model, 'openrouter/free');
    assert.deepEqual(request.body.provider, {
      require_parameters: true,
      data_collection: 'deny',
      allow_fallbacks: true,
    });
    assert.deepEqual(request.body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: 'englizeka_assessment_questions',
        strict: true,
        schema: ASSESSMENT_QUESTIONS_JSON_SCHEMA,
      },
    });
    assert.equal('tools' in request.body, false);
    assert.equal('plugins' in request.body, false);
  });

  test('20 strict MCQs pass through the authoritative deterministic validator', async () => {
    const provider = new OpenRouterAssessmentProvider({
      apiKey: 'unit-test-key',
      fetchImpl: async () => openRouterResponse(Array.from({ length: 20 }, (_, i) => question(i + 1))),
    });
    const result = await provider.generateStructuredOutput({ userPrompt: 'generate exactly 20' });
    const validation = validateGeneratedAssessment(result.data.questions, 20);
    assert.equal(validation.valid, true);
    assert.equal(validation.validQuestions.length, 20);
  });

  for (const [status, failureClass] of [[429, 'rate_limit'], [500, 'http_error']]) {
    test(`classifies HTTP ${status} without leaking the API key`, async () => {
      const secret = 'sensitive-openrouter-key';
      const provider = new OpenRouterAssessmentProvider({
        apiKey: secret,
        fetchImpl: async () => new Response('provider diagnostics containing nothing useful', { status }),
      });

      await assert.rejects(
        provider.generateStructuredOutput({ userPrompt: 'generate' }),
        (error) => {
          assert.equal(error.failureClass, failureClass);
          assert.equal(String(error.message).includes(secret), false);
          assert.equal(JSON.stringify(error).includes(secret), false);
          return true;
        }
      );
    });
  }

  test('malformed and truncated responses fail instead of reaching preview', async () => {
    const malformed = new OpenRouterAssessmentProvider({
      apiKey: 'secret',
      fetchImpl: async () => openRouterResponse([], 'length'),
    });
    await assert.rejects(
      malformed.generateStructuredOutput({ userPrompt: 'generate' }),
      (error) => error.failureClass === 'malformed_response'
    );

    const invalidJson = new OpenRouterAssessmentProvider({
      apiKey: 'secret',
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '{not-json' } }],
      }), { status: 200 }),
    });
    await assert.rejects(
      invalidJson.generateStructuredOutput({ userPrompt: 'generate' }),
      (error) => error.failureClass === 'malformed_response'
    );

    const wrongShape = new OpenRouterAssessmentProvider({
      apiKey: 'secret',
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: 'not questions' }) } }],
      }), { status: 200 }),
    });
    await assert.rejects(
      wrongShape.generateStructuredOutput({ userPrompt: 'generate' }),
      (error) => error.failureClass === 'malformed_response'
    );

    const zeroValidQuestions = new OpenRouterAssessmentProvider({
      apiKey: 'secret',
      fetchImpl: async () => openRouterResponse([{}]),
    });
    await assert.rejects(
      zeroValidQuestions.generateStructuredOutput({ userPrompt: 'generate' }),
      (error) => error.failureClass === 'malformed_response'
    );
  });

  test('provider boundary cannot emit a paid model even when directly constructed', async () => {
    let outboundModel;
    const provider = new OpenRouterAssessmentProvider({
      apiKey: 'secret',
      model: 'vendor/paid-model',
      fetchImpl: async (_url, init) => {
        outboundModel = JSON.parse(init.body).model;
        return openRouterResponse([question(1)]);
      },
    });
    await provider.generateStructuredOutput({ userPrompt: 'generate' });
    assert.equal(provider.model, 'openrouter/free');
    assert.equal(outboundModel, 'openrouter/free');
  });

  test('timeout aborts the request and returns a sanitized timeout failure', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let observedSignal;
    const provider = new OpenRouterAssessmentProvider({
      apiKey: 'timeout-secret',
      timeoutMs: 10,
      fetchImpl: async (_url, init) => {
        observedSignal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      },
    });

    const pending = provider.generateStructuredOutput({ userPrompt: 'generate' });
    t.mock.timers.tick(10);
    await assert.rejects(
      pending,
      (error) => error.failureClass === 'timeout' && !error.message.includes('timeout-secret')
    );
    assert.equal(observedSignal.aborted, true);
  });
});

describe('AssessmentProviderRouter provider-aware load guard', () => {
  test('generation prompt grounds every call in PDF-only material, count, difficulty, and assessment type', async () => {
    let captured;
    const provider = {
      name: 'capture', model: 'test', bypassLocalResourceGuard: true,
      async generateStructuredOutput(options) {
        captured = options;
        return { success: true, data: { questions: [question(1)] } };
      },
    };
    await generateAssessmentFromText({
      documentText: 'Lesson material about present perfect tense. '.repeat(30),
      requestedQuestionCount: 1,
      difficulty: 'hard',
      examType: 'exam',
      assessmentProvider: provider,
    });
    assert.match(captured.systemPrompt, /Use ONLY the extracted educational content/i);
    assert.match(captured.systemPrompt, /answerable from the supplied educational text/i);
    assert.match(captured.userPrompt, /Create exactly 1/i);
    assert.match(captured.userPrompt, /Difficulty: hard/i);
    assert.match(captured.userPrompt, /Assessment type: exam/i);
    assert.deepEqual(captured.schema, ASSESSMENT_QUESTIONS_JSON_SCHEMA);
  });

  test('successful OpenRouter bypasses local SYSTEM_LOAD_HIGH and never invokes Ollama', async () => {
    let remoteCalls = 0;
    let localCalls = 0;
    const router = new AssessmentProviderRouter({
      primary: {
        name: 'openrouter', model: 'openrouter/free',
        async generateStructuredOutput() { remoteCalls++; return { success: true, data: { questions: Array.from({ length: 20 }, (_, i) => question(i + 1)) } }; },
      },
      fallback: {
        name: 'ollama', model: 'local',
        async generateStructuredOutput() { localCalls++; return { success: true, data: { questions: [] } }; },
      },
      checkLocalHeadroom: () => ({ allowed: false, reason: 'SYSTEM_LOAD_HIGH' }),
    });

    const queue = new AiQueue({
      resourceGuard: new ResourceGuard({ maxLoadAverage: -1 }),
      useGlobalGate: false,
    });
    const result = await queue.enqueue(
      () => router.generateStructuredOutput({ userPrompt: 'generate 20' }),
      { skipLocalResourceGuard: true }
    );
    assert.equal(result.data.questions.length, 20);
    assert.equal(remoteCalls, 1);
    assert.equal(localCalls, 0);
  });

  test('remote load bypass keeps the bounded queue saturation limit', async () => {
    const queue = new AiQueue({
      maxWaiting: 2,
      resourceGuard: {
        checkHeadroomSync(queueLength) {
          return queueLength >= 2
            ? { allowed: false, reason: 'QUEUE_SATURATED' }
            : { allowed: false, reason: 'SYSTEM_LOAD_HIGH' };
        },
      },
      useGlobalGate: false,
    });
    let release;
    const blocker = new Promise((resolve) => { release = resolve; });
    const options = { skipLocalResourceGuard: true };
    const first = queue.enqueue(() => blocker, options);
    const second = queue.enqueue(() => blocker, options);
    const third = queue.enqueue(() => blocker, options);

    await assert.rejects(
      queue.enqueue(() => blocker, options),
      (error) => error.code === 'QUEUE_SATURATED'
    );
    release('done');
    await Promise.all([first, second, third]);
  });

  for (const failureClass of ['rate_limit', 'http_error', 'timeout', 'malformed_response']) {
    test(`${failureClass} falls back to Ollama when local headroom is available`, async () => {
      let localCalls = 0;
      const router = new AssessmentProviderRouter({
        primary: {
          name: 'openrouter', model: 'remote',
          async generateStructuredOutput() { throw Object.assign(new Error('sanitized'), { failureClass }); },
        },
        fallback: {
          name: 'ollama', model: 'local',
          async generateStructuredOutput() { localCalls++; return { success: true, data: { questions: [question(1)] } }; },
        },
        checkLocalHeadroom: () => ({ allowed: true }),
      });
      const result = await router.generateStructuredOutput({ userPrompt: 'generate one' });
      assert.equal(result.data.questions.length, 1);
      assert.equal(localCalls, 1);
    });
  }

  test('failed OpenRouter plus SYSTEM_LOAD_HIGH blocks Ollama with safe Arabic error', async () => {
    let localCalls = 0;
    const router = new AssessmentProviderRouter({
      primary: {
        name: 'openrouter', model: 'remote',
        async generateStructuredOutput() { throw Object.assign(new Error('rate limited'), { failureClass: 'rate_limit' }); },
      },
      fallback: {
        name: 'ollama', model: 'local',
        async generateStructuredOutput() { localCalls++; return { success: true, data: { questions: [] } }; },
      },
      checkLocalHeadroom: () => ({ allowed: false, reason: 'SYSTEM_LOAD_HIGH' }),
    });

    await assert.rejects(
      router.generateStructuredOutput({ userPrompt: 'generate' }),
      (error) => error instanceof AssessmentGenerationUnavailableError &&
        /موارد الخادم المحلي مشغولة/.test(error.message)
    );
    assert.equal(localCalls, 0);
  });

  test('caller cancellation propagates without invoking Ollama fallback', async () => {
    let localCalls = 0;
    const controller = new AbortController();
    controller.abort();
    const router = new AssessmentProviderRouter({
      primary: new OpenRouterAssessmentProvider({ apiKey: 'secret' }),
      fallback: {
        name: 'ollama', model: 'local',
        async generateStructuredOutput() { localCalls++; return { success: true, data: { questions: [] } }; },
      },
      checkLocalHeadroom: () => ({ allowed: true }),
    });
    await assert.rejects(
      router.generateStructuredOutput({ userPrompt: 'generate', signal: controller.signal }),
      (error) => error.failureClass === 'cancelled'
    );
    assert.equal(localCalls, 0);
  });

  test('16 valid remote questions are preserved and failed missing-4 call falls back for only 4', async () => {
    let remoteCalls = 0;
    const fallbackPrompts = [];
    const router = new AssessmentProviderRouter({
      primary: {
        name: 'openrouter', model: 'remote',
        async generateStructuredOutput(options) {
          remoteCalls++;
          if (remoteCalls === 1) {
            return { success: true, data: { questions: Array.from({ length: 16 }, (_, i) => question(i + 1)) } };
          }
          throw Object.assign(new Error('remote unavailable'), { failureClass: 'rate_limit' });
        },
      },
      fallback: {
        name: 'ollama', model: 'local',
        async generateStructuredOutput(options) {
          fallbackPrompts.push(options.userPrompt);
          return { success: true, data: { questions: Array.from({ length: 4 }, (_, i) => question(i + 17)) } };
        },
      },
      checkLocalHeadroom: () => ({ allowed: true }),
    });

    const preview = await generateAssessmentFromText({
      documentText: 'A long supplied English lesson containing grammar and vocabulary. '.repeat(80),
      requestedQuestionCount: 20,
      assessmentProvider: router,
    });

    assert.equal(preview.questions.length, 20);
    assert.deepEqual(preview.questions.slice(0, 16).map((q) => q.prompt),
      Array.from({ length: 16 }, (_, i) => question(i + 1).prompt));
    assert.equal(remoteCalls, 2);
    assert.equal(fallbackPrompts.length, 1);
    assert.match(fallbackPrompts[0], /exactly 4/i);
  });

  test('observability reports provider, duration, requested/valid counts, and no content or secret', async () => {
    const logLines = [];
    const originalInfo = console.info;
    console.info = (line) => logLines.push(String(line));
    try {
      const router = new AssessmentProviderRouter({
        primary: {
          name: 'openrouter', model: 'remote',
          async generateStructuredOutput() { return { success: true, data: { questions: [question(1)] } }; },
        },
        checkLocalHeadroom: () => ({ allowed: true }),
      });
      await generateAssessmentFromText({
        documentText: 'PRIVATE PDF CONTENT secret-marker '.repeat(30),
        requestedQuestionCount: 1,
        assessmentProvider: router,
      });
    } finally {
      console.info = originalInfo;
    }

    const events = logLines.map((line) => JSON.parse(line));
    const generationEvent = events.find((event) => event.event === 'ai_assessment_generation');
    assert.deepEqual(
      {
        provider: generationEvent.provider,
        requestedQuestionCount: generationEvent.requestedQuestionCount,
        validQuestionCount: generationEvent.validQuestionCount,
        fallbackOccurred: generationEvent.fallbackOccurred,
      },
      { provider: 'openrouter', requestedQuestionCount: 1, validQuestionCount: 1, fallbackOccurred: false }
    );
    assert.equal(Number.isFinite(generationEvent.durationMs), true);
    assert.equal(logLines.join('\n').includes('secret-marker'), false);
  });
});
