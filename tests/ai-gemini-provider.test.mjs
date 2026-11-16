import assert from 'node:assert/strict';
import test, { describe, beforeEach, afterEach } from 'node:test';
import {
  GeminiAiProvider,
  loadGeminiConfig,
} from '../app/lib/ai/providers/gemini-provider.server.ts';
import {
  validateGeneratedQuestion,
  validateGeneratedAssessment,
  isAssessmentSubmissionAllowed,
} from '../app/lib/ai/assessment-validator.ts';
import { generateAssessmentFromText } from '../app/lib/ai/content-generator.ts';
import { orchestrateAdminChat, resolveContext, evaluatePlanRisk } from '../app/lib/ai/orchestrator.ts';
import { getToolDefinition } from '../app/lib/ai/tool-registry.ts';
import { isToolCompatibleWithRequest } from '../app/lib/ai/semantic-intent-guard.ts';

function mockGeminiSuccessResponse(textPayload, usage = { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 }) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: typeof textPayload === 'string' ? textPayload : JSON.stringify(textPayload) }],
            role: 'model',
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: usage,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function mockGeminiErrorResponse(status, statusText, errorBody = {}) {
  return new Response(
    JSON.stringify(errorBody),
    {
      status,
      statusText,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function makeValidQuestion(index) {
  return {
    prompt: `Educational curriculum reading question ${index} about English literature?`,
    options: [
      `Valid answer choice A for question ${index}`,
      `Valid answer choice B for question ${index}`,
      `Valid answer choice C for question ${index}`,
      `Valid answer choice D for question ${index}`,
    ],
    correctIndex: 0,
    correctAnswer: `Valid answer choice A for question ${index}`,
    explanation: `Explanation for question ${index}`,
  };
}

describe('Phase 1: Gemini Provider Core Contracts & Requirements (1 to 7)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1. Gemini configured -> admin AI request uses Gemini
  test('1. Gemini configured: loadGeminiConfig reads GEMINI_MODEL and defaults to gemini-3.1-flash-lite', () => {
    delete process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = 'test-gemini-key-123';
    const configDefault = loadGeminiConfig(process.env);
    assert.equal(configDefault.model, 'gemini-3.1-flash-lite');
    assert.equal(configDefault.apiKey, 'test-gemini-key-123');
    assert.equal(configDefault.timeoutMs, 60000);

    process.env.GEMINI_MODEL = 'gemini-3.1-pro';
    process.env.GEMINI_TIMEOUT_MS = '45000';
    const configCustom = loadGeminiConfig(process.env);
    assert.equal(configCustom.model, 'gemini-3.1-pro');
    assert.equal(configCustom.timeoutMs, 45000);
  });

  // 2. No Gemini key -> safe configuration error
  test('2. No Gemini key: provider throws safe configuration error indicating service is not properly configured', async () => {
    const provider = new GeminiAiProvider({ apiKey: '' });
    await assert.rejects(
      async () => {
        await provider.generateStructuredOutput({ userPrompt: 'hello' });
      },
      (err) => {
        assert.ok(
          err.message.includes('غير مهيأة') || err.message.includes('غير مفعلة') || err.message.includes('مفتاح'),
          `Expected clean Arabic config error, got: ${err.message}`
        );
        assert.equal(err.code, 'CONFIG_ERROR');
        return true;
      }
    );
  });

  // 3. Gemini key never reaches client output
  test('3. Gemini key never reaches error messages or serialized outputs', async () => {
    const secretKey = 'GEMINI_SECRET_KEY_NEVER_LEAK_12345';
    const provider = new GeminiAiProvider({
      apiKey: secretKey,
      fetchImpl: async () => {
        return mockGeminiErrorResponse(500, 'Internal Server Error', { error: { message: 'Internal crash' } });
      },
    });

    try {
      await provider.generateStructuredOutput({ userPrompt: 'test' });
      assert.fail('Should have thrown');
    } catch (err) {
      const serialized = JSON.stringify(err, Object.getOwnPropertyNames(err));
      assert.ok(!serialized.includes(secretKey), 'Secret key must never leak in error objects');
      assert.ok(!err.message.includes(secretKey), 'Secret key must never leak in error message');
    }
  });

  // 4. Gemini API 429 -> safe Arabic quota error
  test('4. Gemini API 429: throws exact required Arabic quota error', async () => {
    const provider = new GeminiAiProvider({
      apiKey: 'test-key',
      fetchImpl: async () => {
        return mockGeminiErrorResponse(429, 'Too Many Requests', {
          error: { code: 429, message: 'RESOURCE_EXHAUSTED', status: 'RESOURCE_EXHAUSTED' },
        });
      },
    });

    await assert.rejects(
      async () => {
        await provider.generateStructuredOutput({ userPrompt: 'test' });
      },
      (err) => {
        assert.equal(err.message, 'تم الوصول إلى الحد المؤقت لخدمة الذكاء الاصطناعي. حاول مرة أخرى لاحقًا.');
        assert.equal(err.code, 'RATE_LIMITED');
        return true;
      }
    );
  });

  // 5. Gemini timeout -> AbortController cancels
  test('5. Gemini timeout: AbortController cancels and throws clean Arabic temporary error', async () => {
    const provider = new GeminiAiProvider({
      apiKey: 'test-key',
      timeoutMs: 50,
      fetchImpl: async (_url, options) => {
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
    });

    await assert.rejects(
      async () => {
        await provider.generateStructuredOutput({ userPrompt: 'test' });
      },
      (err) => {
        assert.equal(err.message, 'خدمة الذكاء الاصطناعي غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.');
        assert.equal(err.code, 'TIMEOUT');
        return true;
      }
    );
  });

  // 6. Gemini 5xx -> safe temporary-unavailable error
  test('6. Gemini 5xx: throws exact required Arabic temporary error', async () => {
    const provider = new GeminiAiProvider({
      apiKey: 'test-key',
      fetchImpl: async () => {
        return mockGeminiErrorResponse(503, 'Service Unavailable', {
          error: { code: 503, message: 'The model is overloaded.' },
        });
      },
    });

    await assert.rejects(
      async () => {
        await provider.generateStructuredOutput({ userPrompt: 'test' });
      },
      (err) => {
        assert.equal(err.message, 'خدمة الذكاء الاصطناعي غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.');
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        return true;
      }
    );
  });

  // 7. Malformed Gemini response -> rejected cleanly
  test('7. Malformed Gemini response (invalid JSON / empty candidates) is rejected cleanly', async () => {
    const providerMalformedJson = new GeminiAiProvider({
      apiKey: 'test-key',
      fetchImpl: async () => mockGeminiSuccessResponse('THIS_IS_NOT_JSON'),
    });

    const result = await providerMalformedJson.generateStructuredOutput({ userPrompt: 'test' });
    assert.equal(result.success, false);
    assert.ok(result.error);

    const providerEmptyCandidates = new GeminiAiProvider({
      apiKey: 'test-key',
      fetchImpl: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    });

    const emptyResult = await providerEmptyCandidates.generateStructuredOutput({ userPrompt: 'test' });
    assert.equal(emptyResult.success, false);
  });
});

describe('Phase 2: Planner, Tool Registry & Safety Contracts (8 to 13)', () => {
  // 8. Valid planner JSON -> registry validation passes
  test('8. Valid planner JSON produced by Gemini passes registry validation', async () => {
    const validPlan = {
      planText: 'عرض قائمة الكورسات المتاحة',
      actions: [{ tool: 'list_courses', parameters: {} }],
      explanation: 'قائمة الدورات',
    };

    const provider = new GeminiAiProvider({
      apiKey: 'test-key',
      fetchImpl: async () => mockGeminiSuccessResponse(validPlan),
    });

    const plan = await provider.generatePlan('اعرض الكورسات');
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0].tool, 'list_courses');
    const toolDef = getToolDefinition('list_courses');
    assert.ok(toolDef);
    assert.equal(toolDef.name, 'list_courses');
  });

  // 9. Hallucinated tool -> rejected/repaired according to rules
  test('9. Hallucinated tool is rejected by tool registry', () => {
    const hallucinatedDef = getToolDefinition('non_existent_magic_tool');
    assert.equal(hallucinatedDef, undefined);
  });

  // 10. Price request cannot become publish_course
  test('10. Price request cannot become publish_course (intent guard prevents semantic hijack)', () => {
    const priceRequest = 'غير سعر كورس English Grade 10 إلى 500 جنيه';
    const check = isToolCompatibleWithRequest(priceRequest, 'publish_course');
    assert.equal(check.compatible, false);
  });

  // 11. Canonical course entity resolution remains intact
  test('11. Canonical course entity resolution matches course title accurately', async () => {
    const mockDb = {
      prepare(sql) {
        return {
          all() {
            if (sql.includes('courses')) {
              return [{ id: 'c_course_g10', title: 'English Grade 10', price: 400, is_active: 1, status: 'published' }];
            }
            return [];
          },
          bind() {
            return this;
          },
        };
      },
    };

    const resolved = await resolveContext(undefined, mockDb, 'غير سعر كورس English Grade 10 إلى 500');
    assert.equal(resolved.validatedContext.courseId, 'c_course_g10');
    assert.equal(resolved.courseTitle, 'English Grade 10');
  });

  // 12. Confirmation remains mandatory for price/publish/delete/risky actions
  test('12. Confirmation remains mandatory for update_course_price, publish_course, and delete actions', () => {
    const pricePlan = evaluatePlanRisk([{ tool: 'update_course_price', parameters: { courseId: 'c_1', price: 500 } }]);
    assert.equal(pricePlan.requiresConfirmation, true);

    const publishPlan = evaluatePlanRisk([{ tool: 'publish_course', parameters: { courseId: 'c_1' } }]);
    assert.equal(publishPlan.requiresConfirmation, true);

    const deletePlan = evaluatePlanRisk([{ tool: 'delete_lecture', parameters: { lectureId: 'l_1' } }]);
    assert.equal(deletePlan.requiresConfirmation, true);
  });

  // 13. list_courses remains read-only and requires no confirmation
  test('13. list_courses remains read-only and requires no confirmation', () => {
    const listPlan = evaluatePlanRisk([{ tool: 'list_courses', parameters: {} }]);
    assert.equal(listPlan.requiresConfirmation, false);
    const tool = getToolDefinition('list_courses');
    assert.equal(tool.mutationType, 'read');
  });
});

describe('Phase 3: Assessment Generation & Validation Contracts (14 to 21)', () => {
  // 14. PDF request 20 valid MCQs -> exactly 20 previewed
  test('14. PDF request 20 valid MCQs generates exactly 20 preview questions', async () => {
    const questions20 = Array.from({ length: 20 }, (_, i) => makeValidQuestion(i + 1));
    const provider = new GeminiAiProvider({
      apiKey: 'test-key',
      fetchImpl: async () => mockGeminiSuccessResponse({ questions: questions20 }),
    });

    const preview = await generateAssessmentFromText({
      documentText: 'Educational material content for reading comprehension. '.repeat(50),
      requestedQuestionCount: 20,
      assessmentProvider: provider,
    });

    assert.equal(preview.questionCount, 20);
    assert.equal(preview.questions.length, 20);
    for (const q of preview.questions) {
      assert.equal(q.options.length, 4);
      for (const opt of q.options) {
        assert.equal(typeof opt, 'string');
        assert.ok(opt.trim().length > 0);
      }
    }
  });

  // 15. PDF question with blank option -> rejected
  test('15. PDF question with any blank option is strictly rejected by deterministic validator', () => {
    const qWithBlank = {
      prompt: 'Valid prompt for test question?',
      options: ['Option A', '', 'Option C', 'Option D'],
      correctAnswer: 'Option A',
      correctIndex: 0,
    };
    const res = validateGeneratedQuestion(qWithBlank);
    assert.equal(res.valid, false);
    assert.ok(res.reasons.includes('EMPTY_OPTION'));
  });

  // 16. PDF 16 valid -> completion requests exactly missing 4
  test('16. PDF 16 valid questions triggers completion pass requesting exactly 4 missing questions', async () => {
    let callCount = 0;
    const provider = {
      name: 'gemini',
      model: 'gemini-3.1-flash-lite',
      async healthCheck() { return { healthy: true, provider: 'gemini', model: 'gemini-3.1-flash-lite' }; },
      async generateStructuredOutput(options) {
        callCount++;
        if (callCount === 1) {
          // First pass: returns 16 valid questions
          return {
            success: true,
            data: { questions: Array.from({ length: 16 }, (_, i) => makeValidQuestion(i + 1)) },
          };
        }
        // Second pass: options.userPrompt should request missing 4
        assert.ok(options.userPrompt.includes('4 NEW') || options.userPrompt.includes('4 high-quality') || options.userPrompt.includes('4'));
        return {
          success: true,
          data: { questions: Array.from({ length: 4 }, (_, i) => makeValidQuestion(i + 17)) },
        };
      },
    };

    const preview = await generateAssessmentFromText({
      documentText: 'Educational material text for testing English skills. '.repeat(60),
      requestedQuestionCount: 20,
      assessmentProvider: provider,
    });

    assert.equal(preview.questionCount, 20);
    assert.equal(callCount, 2);
  });

  // 17. Completion fails -> no partial preview
  test('17. Completion fails to reach requested total -> fails safely without partial preview', async () => {
    let callCount = 0;
    const provider = {
      name: 'gemini',
      model: 'gemini-3.1-flash-lite',
      async healthCheck() { return { healthy: true, provider: 'gemini', model: 'gemini-3.1-flash-lite' }; },
      async generateStructuredOutput() {
        callCount++;
        if (callCount === 1) {
          // Returns 19 valid questions
          return {
            success: true,
            data: { questions: Array.from({ length: 19 }, (_, i) => makeValidQuestion(i + 1)) },
          };
        }
        // Second pass fails to generate any valid questions
        return { success: true, data: { questions: [] } };
      },
    };

    await assert.rejects(
      async () => {
        await generateAssessmentFromText({
          documentText: 'Educational curriculum text for reading. '.repeat(60),
          requestedQuestionCount: 20,
          assessmentProvider: provider,
        });
      },
      /تم توليد 19 من أصل 20 سؤالًا صالحًا فقط/
    );
  });

  // 18. Teacher edits option blank -> insert disabled
  test('18. Teacher manually clears an option -> submission is disallowed with Arabic message', () => {
    const questions = [
      {
        prompt: 'What is the capital of Egypt?',
        options: ['Cairo', '   ', 'Alexandria', 'Giza'], // blank/whitespace
        correctAnswer: 'Cairo',
        correctIndex: 0,
      },
    ];
    const check = isAssessmentSubmissionAllowed(questions);
    assert.equal(check.allowed, false);
    assert.ok(
      check.reason?.includes('هذا السؤال يحتوي على اختيارات غير صالحة') ||
      check.reason?.includes('يوجد خيار فارغ')
    );
  });

  // 19. Crafted invalid final payload -> server 400 -> zero inserts
  test('19. prepare-confirmation rejects crafted payload containing empty option with HTTP 400', async () => {
    const prevEnv = globalThis.__ENGLIZEKA_ENV__;
    const prevAi = process.env.AI_ASSISTANT_ENABLED;
    const prevSec = process.env.AI_CONFIRMATION_SECRET;
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_CONFIRMATION_SECRET = '0123456789abcdef0123456789abcdef';

    class StaffSessionDb {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('staff_sessions')) {
                  return {
                    expiresAt: Date.now() + 60_000,
                    email: 'admin@englizeka.com',
                    name: 'Admin',
                    role: 'admin',
                    permissions: JSON.stringify(['manage_courses', 'manage_exams']),
                  };
                }
                return null;
              },
              async run() {
                return { results: [], success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      }
    }

    globalThis.__ENGLIZEKA_ENV__ = { DB: new StaffSessionDb() };

    try {
      const { POST: prepareConfirmation } = await import('../app/api/admin/ai/prepare-confirmation/route.ts');
      const res = await prepareConfirmation(
        new Request('https://englezika.com/api/admin/ai/prepare-confirmation', {
          method: 'POST',
          headers: {
            origin: 'https://englezika.com',
            cookie: 'englizeka_staff=valid-staff-token-12345678',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            actionType: 'create_quiz',
            actionPayload: {
              courseId: 'c_test',
              title: 'Crafted Quiz With Blank Option',
              questions: [
                {
                  prompt: 'Valid prompt for test question?',
                  options: ['A', '', 'C', 'D'], // BLANK OPTION!
                  correctAnswer: 'A',
                  correctIndex: 0,
                },
              ],
            },
          }),
        })
      );

      assert.equal(res.status, 400);
    } finally {
      globalThis.__ENGLIZEKA_ENV__ = prevEnv;
      process.env.AI_ASSISTANT_ENABLED = prevAi;
      process.env.AI_CONFIRMATION_SECRET = prevSec;
    }
  });

  // 20. 30 questions accepted
  test('20. Exactly 30 questions is within maximum limit and accepted', () => {
    const questions30 = Array.from({ length: 30 }, (_, i) => makeValidQuestion(i + 1));
    const result = validateGeneratedAssessment(questions30, 30);
    assert.equal(result.valid, true);
    assert.equal(result.validQuestions.length, 30);
  });

  // 21. 31 questions rejected
  test('21. 31 questions exceeds maximum allowed limit (30) and is rejected', () => {
    const questions31 = Array.from({ length: 31 }, (_, i) => makeValidQuestion(i + 1));
    const result = validateGeneratedAssessment(questions31, 31);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('30')));
  });
});

describe('Phase 4: Provider Hygiene & Secret Isolation (22 to 25)', () => {
  // 22. No code/runtime reference calls port 11434
  test('22. No active production code references loopback port 11434', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    async function scanDir(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.next' && entry.name !== '.git') {
            files.push(...(await scanDir(full)));
          }
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          files.push(full);
        }
      }
      return files;
    }

    const appFiles = await scanDir(path.resolve('app/lib/ai'));
    for (const file of appFiles) {
      const content = await fs.readFile(file, 'utf8');
      assert.ok(
        !content.includes('11434'),
        `File ${file} must not contain port 11434 reference`
      );
    }
  });

  // 23. No production OpenRouter provider path remains
  test('23. No production OpenRouter provider file remains in app/lib/ai', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const openrouterProviderPath = path.resolve('app/lib/ai/providers/openrouter-assessment-provider.server.ts');
    let exists = true;
    try {
      await fs.access(openrouterProviderPath);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, 'openrouter-assessment-provider.server.ts must be deleted');

    const routerPath = path.resolve('app/lib/ai/assessment-provider-router.server.ts');
    let routerExists = true;
    try {
      await fs.access(routerPath);
    } catch {
      routerExists = false;
    }
    assert.equal(routerExists, false, 'assessment-provider-router.server.ts must be deleted');
  });

  // 24. No OPENROUTER_API_KEY string in client build
  test('24. No OPENROUTER_API_KEY in client components', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    async function scanClient(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanClient(full);
        } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
          const content = await fs.readFile(full, 'utf8');
          assert.ok(
            !content.includes('OPENROUTER_API_KEY'),
            `Client component ${full} must not reference OPENROUTER_API_KEY`
          );
        }
      }
    }
    await scanClient(path.resolve('app/components'));
  });

  // 25. No GEMINI_API_KEY string/value in client build
  test('25. No GEMINI_API_KEY in client components', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    async function scanClient(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanClient(full);
        } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
          const content = await fs.readFile(full, 'utf8');
          assert.ok(
            !content.includes('GEMINI_API_KEY'),
            `Client component ${full} must not reference GEMINI_API_KEY`
          );
        }
      }
    }
    await scanClient(path.resolve('app/components'));
  });
});
