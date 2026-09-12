import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  validateGeneratedQuestion,
  validateGeneratedAssessment,
  isAssessmentSubmissionAllowed,
  generateAssessmentFromText,
} from '../app/lib/ai/content-generator.ts';
import { assessmentService } from '../app/lib/services/assessment-service.ts';
import { DomainError } from '../app/lib/services/types.ts';

const teacherOperator = {
  email: 'teacher@englizeka.com',
  name: 'Teacher Ahmed',
  role: 'admin',
  permissions: ['manage_courses', 'manage_videos', 'manage_exams'],
};

class MockDatabase {
  constructor() {
    this.exams = [];
    this.questions = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            if (sql.includes('SELECT id FROM courses WHERE id = ?')) {
              return { id: args[0] };
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

  async batch(statements) {
    // Execute all statements atomically
    for (const stmt of statements) {
      if (typeof stmt.run === 'function') {
        await stmt.run();
      }
    }
    return [];
  }
}

describe('Phase 1 & 2: Authoritative Assessment Question Contract & Validation Suite', () => {
  // D. Question with 3 options -> invalid (MCQ requires exactly 4)
  test('D. Question with 3 options is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', 'Lyon', 'Marseille'],
      correctAnswer: 'Paris',
      correctIndex: 0,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('WRONG_OPTION_COUNT'));
  });

  // E. Question with 5 options -> invalid (MCQ requires exactly 4)
  test('E. Question with 5 options is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', 'Lyon', 'Marseille', 'Nice', 'Toulouse'],
      correctAnswer: 'Paris',
      correctIndex: 0,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('WRONG_OPTION_COUNT'));
  });

  // F. One option = "" -> invalid
  test('F. Question with an empty option string is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', '', 'Marseille', 'Nice'],
      correctAnswer: 'Paris',
      correctIndex: 0,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('EMPTY_OPTION'));
  });

  // G. One option = whitespace -> invalid
  test('G. Question with a whitespace-only option is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', '   ', 'Marseille', 'Nice'],
      correctAnswer: 'Paris',
      correctIndex: 0,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('EMPTY_OPTION'));
  });

  // H. Duplicate options -> invalid
  test('H. Question with duplicate options is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', 'Lyon', 'paris', 'Nice'],
      correctAnswer: 'Paris',
      correctIndex: 0,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('DUPLICATE_OPTION'));
  });

  // I. correctIndex = -1 -> invalid
  test('I. Question with correctIndex = -1 is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', 'Lyon', 'Marseille', 'Nice'],
      correctAnswer: 'Paris',
      correctIndex: -1,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('INVALID_CORRECT_INDEX'));
  });

  // J. correctIndex = 4 -> invalid (valid are 0, 1, 2, 3)
  test('J. Question with correctIndex = 4 is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', 'Lyon', 'Marseille', 'Nice'],
      correctAnswer: 'Paris',
      correctIndex: 4,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('INVALID_CORRECT_INDEX'));
  });

  // K. correctIndex = "1" or invalid type
  test('K. Non-integer or out-of-range correctIndex is rejected', () => {
    const result = validateGeneratedQuestion({
      prompt: 'What is the capital of France?',
      options: ['Paris', 'Lyon', 'Marseille', 'Nice'],
      correctAnswer: 'Lyon',
      correctIndex: 1.5,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('INVALID_CORRECT_INDEX'));
  });

  // L. Empty question text -> invalid
  test('L. Question with empty prompt text is rejected as invalid', () => {
    const result = validateGeneratedQuestion({
      prompt: '   ',
      options: ['Paris', 'Lyon', 'Marseille', 'Nice'],
      correctAnswer: 'Paris',
      correctIndex: 0,
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('EMPTY_QUESTION'));
  });

  // M. Duplicate question text does not count twice in assessment validator
  test('M. Duplicate question text is rejected and does not count twice in set', () => {
    const q1 = {
      prompt: 'What is the capital of Egypt?',
      options: ['Cairo', 'Alexandria', 'Giza', 'Luxor'],
      correctAnswer: 'Cairo',
      correctIndex: 0,
    };
    const q2 = {
      prompt: 'what is the capital of egypt?', // Case-insensitive duplicate
      options: ['Cairo', 'Alexandria', 'Giza', 'Luxor'],
      correctAnswer: 'Cairo',
      correctIndex: 0,
    };
    const q3 = {
      prompt: 'Which sea is to the north of Egypt?',
      options: ['Mediterranean', 'Red Sea', 'Dead Sea', 'Black Sea'],
      correctAnswer: 'Mediterranean',
      correctIndex: 0,
    };

    const validation = validateGeneratedAssessment([q1, q2, q3], 3);
    assert.equal(validation.valid, false);
    assert.equal(validation.validQuestions.length, 2);
    assert.equal(validation.invalidQuestions.length, 1);
    assert.ok(validation.invalidQuestions[0].reasons.includes('DUPLICATE_QUESTION_TEXT'));
  });

  // T. Maximum 30 question boundary: max 30 still accepted; 31 rejected
  test('T. Maximum 30 question boundary: 30 accepted, 31 rejected server-side', async () => {
    const prevEnv = globalThis.__ENGLIZEKA_ENV__;
    const prevAi = process.env.AI_ASSISTANT_ENABLED;
    const prevSec = process.env.AI_CONFIRMATION_SECRET;
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_CONFIRMATION_SECRET = '0123456789abcdef0123456789abcdef';

    class RouteTestDb {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('staff_sessions')) {
                  return {
                    expiresAt: Date.now() + 60_000,
                    email: 'teacher@englizeka.com',
                    name: 'Teacher',
                    role: 'admin',
                    permissions: JSON.stringify(['manage_exams']),
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

    globalThis.__ENGLIZEKA_ENV__ = {
      DB: new RouteTestDb(),
    };

    try {
      const { POST: generateAssessment } = await import('../app/api/admin/ai/generate-assessment/route.ts');

      // 31 is rejected with 400
      const res31 = await generateAssessment(
        new Request('https://englezika.com/api/admin/ai/generate-assessment', {
          method: 'POST',
          headers: {
            origin: 'https://englezika.com',
            cookie: 'englizeka_staff=valid-staff-token-12345678',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            tempFileId: '00000000-0000-0000-0000-000000000000',
            questionCount: 31,
          }),
        })
      );
      assert.equal(res31.status, 400);
      const body31 = await res31.json();
      assert.ok(body31.error.includes('30'));

      // 0 is also rejected with 400
      const res0 = await generateAssessment(
        new Request('https://englezika.com/api/admin/ai/generate-assessment', {
          method: 'POST',
          headers: {
            origin: 'https://englezika.com',
            cookie: 'englizeka_staff=valid-staff-token-12345678',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            tempFileId: '00000000-0000-0000-0000-000000000000',
            questionCount: 0,
          }),
        })
      );
      assert.equal(res0.status, 400);
    } finally {
      globalThis.__ENGLIZEKA_ENV__ = prevEnv;
      process.env.AI_ASSISTANT_ENABLED = prevAi;
      process.env.AI_CONFIRMATION_SECRET = prevSec;
    }
  });
});

describe('Phase 3: Bounded Missing-Question Repair & Exact Count Enforcement', () => {
  // A. Requested 20, provider returns 16 valid -> must NOT immediately return successful 16-question preview
  test('A. Requested 20 questions when initial provider returns 16 must NOT return partial 16-question preview', async () => {
    let callCount = 0;
    const provider = {
      name: 'sixteen-only-provider',
      model: 'test-model',
      async healthCheck() { return { healthy: true, provider: 'mock', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        callCount++;
        // First call returns 16 questions (and second call returns 0, simulating failure to repair)
        if (callCount === 1) {
          const questions = Array.from({ length: 16 }, (_, i) => ({
            prompt: `Unique question number ${i + 1} from chapter 1?`,
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            correctAnswer: 'Option A',
            correctIndex: 0,
          }));
          return { success: true, data: { questions } };
        }
        return { success: true, data: { questions: [] } };
      },
    };

    // Should reject because final valid count is 16 < 20
    await assert.rejects(
      async () => {
        await generateAssessmentFromText({
          documentText: 'English grammar text for high school curriculum. '.repeat(60),
          requestedQuestionCount: 20,
          provider,
        });
      },
      /تم توليد 16 من أصل 20 سؤالًا صالحًا فقط/
    );
  });

  // B. Requested 20, initial 16 valid, completion provider returns 4 valid -> final exactly 20
  test('B. Requested 20, initial 16 valid + completion 4 valid -> final exactly 20 questions', async () => {
    let callCount = 0;
    const provider = {
      name: 'repairing-provider',
      model: 'test-model',
      async healthCheck() { return { healthy: true, provider: 'mock', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(options) {
        callCount++;
        if (callCount === 1) {
          // Batch/initial generation yields 16 valid questions
          const questions = Array.from({ length: 16 }, (_, i) => ({
            prompt: `Initial question ${i + 1} on vocabulary?`,
            options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
            correctAnswer: 'Alpha',
            correctIndex: 0,
          }));
          return { success: true, data: { questions } };
        }
        // Completion pass: exactly 4 missing questions requested
        assert.ok(options.userPrompt.includes('4'), 'Completion prompt must ask for exactly 4 missing questions');
        const questions = Array.from({ length: 4 }, (_, i) => ({
          prompt: `Repaired completion question ${i + 1} on grammar?`,
          options: ['North', 'South', 'East', 'West'],
          correctAnswer: 'North',
          correctIndex: 0,
        }));
        return { success: true, data: { questions } };
      },
    };

    const result = await generateAssessmentFromText({
      documentText: 'Comprehensive English grammar and vocabulary curriculum. '.repeat(60),
      requestedQuestionCount: 20,
      provider,
    });

    assert.equal(result.questionCount, 20);
    assert.equal(result.questions.length, 20);
    assert.equal(result.requestedCount, 20);
    assert.equal(result.validatedCount, 20);
    assert.equal(callCount, 2, 'Must perform exactly 1 initial + 1 completion attempt');

    // Assert all 20 questions satisfy canonical contract
    for (const q of result.questions) {
      assert.ok(q.prompt.length >= 5);
      assert.equal(q.options.length, 4);
      assert.equal(typeof q.correctIndex, 'number');
      assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
      assert.equal(q.correctAnswer, q.options[q.correctIndex]);
    }
  });

  // C. Initial 16 valid, completion returns only 2 valid -> safe incomplete-generation error
  test('C. Initial 16 valid + completion 2 valid -> safe error without preview', async () => {
    let callCount = 0;
    const provider = {
      name: 'partial-repair-provider',
      model: 'test-model',
      async healthCheck() { return { healthy: true, provider: 'mock', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        callCount++;
        if (callCount === 1) {
          const questions = Array.from({ length: 16 }, (_, i) => ({
            prompt: `Batch question ${i + 1}?`,
            options: ['A', 'B', 'C', 'D'],
            correctAnswer: 'A',
            correctIndex: 0,
          }));
          return { success: true, data: { questions } };
        }
        // Completion pass returns only 2 valid questions (total 18 < 20)
        const questions = Array.from({ length: 2 }, (_, i) => ({
          prompt: `Additional question ${i + 1}?`,
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 'A',
          correctIndex: 0,
        }));
        return { success: true, data: { questions } };
      },
    };

    await assert.rejects(
      async () => {
        await generateAssessmentFromText({
          documentText: 'Comprehensive English grammar and vocabulary curriculum. '.repeat(60),
          requestedQuestionCount: 20,
          provider,
        });
      },
      (err) => {
        assert.ok(err.message.includes('تم توليد 18 من أصل 20 سؤالًا صالحًا فقط'));
        return true;
      }
    );
  });

  // N. Completion retry duplicates existing question -> duplicate rejected -> count incomplete
  test('N. Completion retry that duplicates existing question is rejected and fails exact count', async () => {
    let callCount = 0;
    const provider = {
      name: 'duplicate-repair-provider',
      model: 'test-model',
      async healthCheck() { return { healthy: true, provider: 'mock', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        callCount++;
        if (callCount === 1) {
          const questions = Array.from({ length: 16 }, (_, i) => ({
            prompt: `Initial unique question ${i + 1}?`,
            options: ['One', 'Two', 'Three', 'Four'],
            correctAnswer: 'One',
            correctIndex: 0,
          }));
          return { success: true, data: { questions } };
        }
        // Completion attempts to return duplicates of questions 1..4
        const questions = Array.from({ length: 4 }, (_, i) => ({
          prompt: `initial unique question ${i + 1}?`, // DUPLICATE!
          options: ['One', 'Two', 'Three', 'Four'],
          correctAnswer: 'One',
          correctIndex: 0,
        }));
        return { success: true, data: { questions } };
      },
    };

    await assert.rejects(
      async () => {
        await generateAssessmentFromText({
          documentText: 'Curriculum text for test question generation. '.repeat(60),
          requestedQuestionCount: 20,
          provider,
        });
      },
      /تم توليد 16 من أصل 20 سؤالًا صالحًا فقط/
    );
  });
});

describe('Phase 4: Server-Side Final Insert Validation & Transactional Boundary', () => {
  // R. Crafted final insertion request containing invalid MCQ -> server rejects -> zero DB inserts
  test('R. Crafted insertion request with invalid MCQ (e.g. 3 options, empty option) is rejected by AssessmentService', async () => {
    const db = new MockDatabase();

    const invalidQuestionsPayload = [
      {
        prompt: 'Valid question 1?',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
      },
      {
        prompt: 'Invalid question 2: missing 4th option?',
        options: ['A', 'B', 'C'], // Only 3 options!
        correctAnswer: 'A',
      },
    ];

    await assert.rejects(
      async () => {
        await assessmentService.createExam(
          {
            courseId: 'c_test',
            title: 'Tampered Online Exam',
            mode: 'online',
            questions: invalidQuestionsPayload,
          },
          teacherOperator,
          { db }
        );
      },
      (err) => {
        assert.ok(err instanceof DomainError);
        assert.equal(err.status, 400);
        return true;
      }
    );

    // Verify zero questions were inserted into DB
    assert.equal(db.questions.length, 0);
  });

  test('R2. Crafted insertion request with empty option string is rejected by AssessmentService', async () => {
    const db = new MockDatabase();

    const invalidQuestionsPayload = [
      {
        prompt: 'Question with empty option?',
        options: ['Valid A', '', 'Valid C', 'Valid D'],
        correctAnswer: 'Valid A',
      },
    ];

    await assert.rejects(
      async () => {
        await assessmentService.createExam(
          {
            courseId: 'c_test',
            title: 'Tampered Exam Empty Option',
            mode: 'online',
            questions: invalidQuestionsPayload,
          },
          teacherOperator,
          { db }
        );
      },
      (err) => {
        assert.ok(err instanceof DomainError);
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  // S. 20 fully valid questions -> insertion transactionally accepted
  test('S. 20 fully valid questions are accepted and inserted transactionally', async () => {
    const db = new MockDatabase();

    const valid20Questions = Array.from({ length: 20 }, (_, i) => ({
      prompt: `Proper educational assessment question ${i + 1}?`,
      options: ['Choice 1', 'Choice 2', 'Choice 3', 'Choice 4'],
      correctAnswer: 'Choice 1',
    }));

    const result = await assessmentService.createExam(
      {
        courseId: 'c_test',
        title: 'Full 20 Question Final Exam',
        mode: 'online',
        questions: valid20Questions,
      },
      teacherOperator,
      { db }
    );

    assert.equal(result.ok, true);
    assert.ok(result.id);
    assert.equal(result.questionIds.length, 20);
  });
});

describe('Phase 5: Preview UI Submission Safety & Live Edit Revalidation Suite', () => {
  // O. UI receives valid four-option MCQ -> all 4 option texts rendered and submission allowed
  test('O. Valid 4-option MCQ allows submission and provides clean options', () => {
    const questions = [
      {
        prompt: 'What is the past tense of "go"?',
        options: ['Went', 'Gone', 'Going', 'Goes'],
        correctAnswer: 'Went',
        correctIndex: 0,
      },
    ];

    const check = isAssessmentSubmissionAllowed(questions);
    assert.equal(check.allowed, true);
    assert.equal(check.reason, undefined);
  });

  // P. UI receives invalid/empty option -> confirm/insert disabled
  test('P. Invalid/empty option in question disables confirmation/insertion', () => {
    const questions = [
      {
        prompt: 'What is the past tense of "go"?',
        options: ['Went', '', 'Going', 'Goes'], // Empty option 2
        correctAnswer: 'Went',
        correctIndex: 0,
      },
    ];

    const check = isAssessmentSubmissionAllowed(questions);
    assert.equal(check.allowed, false);
    assert.ok(check.reason.includes('يوجد خيار فارغ في السؤال رقم 1'));
  });

  // Q. Teacher edits valid option to empty -> insertion becomes disabled
  test('Q. Teacher editing a valid option to empty immediately disables insertion', () => {
    const questions = [
      {
        prompt: 'What is the past tense of "go"?',
        options: ['Went', 'Gone', 'Going', 'Goes'],
        correctAnswer: 'Went',
        correctIndex: 0,
      },
    ];

    // Initially valid
    assert.equal(isAssessmentSubmissionAllowed(questions).allowed, true);

    // Teacher erases option 3
    questions[0].options[2] = '   '; // Whitespace / empty

    // Immediately disabled
    const checkAfterEdit = isAssessmentSubmissionAllowed(questions);
    assert.equal(checkAfterEdit.allowed, false);
    assert.ok(checkAfterEdit.reason.includes('يوجد خيار فارغ'));
  });
});

describe('Production AI Assessment Bug: Exact Reproduction & Regression Suite', () => {
  // Production Scenario:
  // User requested 20 questions, difficulty = advanced, quiz.
  // First pass yields 16 valid questions.
  // Second bounded completion pass yields 4 valid unique questions.
  test('Production Regression: 20 requested, 16 initial + 4 repair -> exactly 20 valid questions displayed and actionable', async () => {
    let callIdx = 0;
    const provider = {
      name: 'prod-mock-provider',
      model: 'qwen2.5:1.5b-instruct-q4_K_M',
      async healthCheck() { return { healthy: true, provider: 'ollama', model: 'qwen2.5' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(options) {
        callIdx++;
        if (callIdx === 1) {
          // Exactly 16 questions survived first pass
          const questions = Array.from({ length: 16 }, (_, i) => ({
            prompt: `Advanced reading comprehension question ${i + 1} from Unit 4 text?`,
            options: [
              `Specific answer for question ${i + 1} option A`,
              `Specific answer for question ${i + 1} option B`,
              `Specific answer for question ${i + 1} option C`,
              `Specific answer for question ${i + 1} option D`,
            ],
            correctAnswer: `Specific answer for question ${i + 1} option A`,
            correctIndex: 0,
          }));
          return { success: true, data: { questions } };
        }

        // Bounded completion pass for exactly 4 questions
        assert.ok(options.userPrompt.includes('4'));
        const questions = Array.from({ length: 4 }, (_, i) => ({
          prompt: `Advanced grammar question ${i + 17} on passive voice?`,
          options: [
            `Option A for grammar question ${i + 17}`,
            `Option B for grammar question ${i + 17}`,
            `Option C for grammar question ${i + 17}`,
            `Option D for grammar question ${i + 17}`,
          ],
          correctAnswer: `Option A for grammar question ${i + 17}`,
          correctIndex: 0,
        }));
        return { success: true, data: { questions } };
      },
    };

    const preview = await generateAssessmentFromText({
      documentText: 'Advanced English reading and grammar curriculum textbook. '.repeat(50),
      requestedQuestionCount: 20,
      difficulty: 'advanced',
      examType: 'quiz',
      provider,
    });

    assert.equal(preview.questionCount, 20);
    assert.equal(preview.questions.length, 20);
    assert.equal(preview.requestedCount, 20);
    assert.equal(preview.generatedCount, 20);
    assert.equal(preview.validatedCount, 20);

    // Every question has 4 non-empty visible options and valid correctIndex
    for (const q of preview.questions) {
      assert.ok(q.prompt.length >= 5);
      assert.equal(q.options.length, 4);
      for (const opt of q.options) {
        assert.ok(typeof opt === 'string' && opt.trim().length > 0, 'No empty option rows allowed');
      }
      assert.equal(typeof q.correctIndex, 'number');
      assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
      assert.equal(q.correctAnswer, q.options[q.correctIndex]);
    }

    // Assertion: Insertion is allowed
    const submissionCheck = isAssessmentSubmissionAllowed(preview.questions);
    assert.equal(submissionCheck.allowed, true);
  });

  // Variant: Second response only returns 2 valid questions (total 18 < 20)
  test('Production Regression Variant: 16 initial + 2 repair -> fails with clear Arabic error and disables insertion', async () => {
    let callIdx = 0;
    const provider = {
      name: 'prod-incomplete-provider',
      model: 'qwen2.5:1.5b-instruct-q4_K_M',
      async healthCheck() { return { healthy: true, provider: 'ollama', model: 'qwen2.5' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        callIdx++;
        if (callIdx === 1) {
          const questions = Array.from({ length: 16 }, (_, i) => ({
            prompt: `Advanced comprehension question ${i + 1}?`,
            options: ['Opt 1', 'Opt 2', 'Opt 3', 'Opt 4'],
            correctAnswer: 'Opt 1',
            correctIndex: 0,
          }));
          return { success: true, data: { questions } };
        }
        // Repair only yields 2
        const questions = Array.from({ length: 2 }, (_, i) => ({
          prompt: `Additional question ${i + 17}?`,
          options: ['Opt 1', 'Opt 2', 'Opt 3', 'Opt 4'],
          correctAnswer: 'Opt 1',
          correctIndex: 0,
        }));
        return { success: true, data: { questions } };
      },
    };

    await assert.rejects(
      async () => {
        await generateAssessmentFromText({
          documentText: 'Advanced English reading and grammar curriculum textbook. '.repeat(50),
          requestedQuestionCount: 20,
          difficulty: 'advanced',
          examType: 'quiz',
          provider,
        });
      },
      (err) => {
        assert.ok(
          err.message.includes('تم توليد 18 من أصل 20 سؤالًا صالحًا فقط'),
          `Expected Arabic incomplete error message, got: ${err.message}`
        );
        return true;
      }
    );
  });
});

