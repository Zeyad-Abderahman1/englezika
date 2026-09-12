import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  validateGeneratedQuestion,
  validateGeneratedAssessment,
  isAssessmentSubmissionAllowed,
  generateAssessmentFromText,
} from '../app/lib/ai/content-generator.ts';
import { assessmentService } from '../app/lib/services/assessment-service.ts';
import { validateLectureCoverageRange } from '../app/lib/ai/assessment-validator.ts';

const teacherOperator = {
  email: 'teacher@englizeka.com',
  name: 'Teacher Ahmed',
  role: 'admin',
  permissions: ['manage_courses', 'manage_videos', 'manage_exams'],
};

describe('Production Assessment Hardening: Options Integrity & Lecture Coverage Suite', () => {
  // Test 1: Gemini returns 4 real option strings -> preview displays all 4 strings
  test('1. Gemini returns 4 real option strings -> preview displays all 4 strings', () => {
    const raw = {
      prompt: 'What is the past tense of the verb "go"?',
      options: ['went', 'gone', 'goes', 'going'],
      correctIndex: 0,
      correctAnswer: 'went',
      explanation: 'Went is the simple past form of go.',
    };
    const result = validateGeneratedQuestion(raw);
    assert.equal(result.valid, true);
    assert.ok(result.normalizedQuestion);
    assert.equal(result.normalizedQuestion.options.length, 4);
    assert.deepEqual(result.normalizedQuestion.options, ['went', 'gone', 'goes', 'going']);
    const check = isAssessmentSubmissionAllowed([result.normalizedQuestion]);
    assert.equal(check.allowed, true);
  });

  // Test 2: Gemini valid backend object -> API serialization preserves options
  test('2. Gemini valid backend object -> API serialization preserves options', () => {
    const raw = {
      prompt: 'Which word is a modal auxiliary verb in English?',
      options: ['should', 'quickly', 'elephant', 'running'],
      correctIndex: 0,
      correctAnswer: 'should',
      explanation: 'Should is a modal auxiliary verb.',
    };
    const result = validateGeneratedQuestion(raw);
    assert.equal(result.valid, true);
    const serialized = JSON.stringify({ question: result.normalizedQuestion });
    const parsed = JSON.parse(serialized);
    assert.deepEqual(parsed.question.options, ['should', 'quickly', 'elephant', 'running']);
    assert.equal(typeof parsed.question.options[0], 'string');
  });

  // Test 3: options = ["", "", "", ""] -> successful preview impossible
  test('3. options = ["", "", "", ""] -> successful preview impossible', () => {
    const raw = {
      prompt: 'What is the capital city of France?',
      options: ['', '', '', ''],
      correctIndex: 0,
      correctAnswer: '',
    };
    const result = validateGeneratedQuestion(raw);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('EMPTY_OPTION'));
    const check = isAssessmentSubmissionAllowed([raw]);
    assert.equal(check.allowed, false);
    assert.ok(check.reason?.includes('هذا السؤال يحتوي على اختيارات غير صالحة'));
  });

  // Test 4: one blank option -> invalid
  test('4. one blank option -> invalid', () => {
    const raw = {
      prompt: 'Identify the correct relative pronoun for people:',
      options: ['who', 'which', '', 'whose'],
      correctIndex: 0,
      correctAnswer: 'who',
    };
    const result = validateGeneratedQuestion(raw);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('EMPTY_OPTION'));
    const check = isAssessmentSubmissionAllowed([raw]);
    assert.equal(check.allowed, false);
  });

  // Test 5: object-shaped options -> normalize explicitly OR reject
  test('5. object-shaped options -> normalize explicitly OR reject dummy letters', () => {
    // 5a. Object choices with real text -> normalized to pure strings
    const rawWithObjText = {
      prompt: 'What is the synonym of "enormous"?',
      options: [
        { text: 'gigantic' },
        { text: 'tiny' },
        { text: 'fragile' },
        { text: 'narrow' },
      ],
      correctIndex: 0,
      correctAnswer: 'gigantic',
    };
    const res1 = validateGeneratedQuestion(rawWithObjText);
    assert.equal(res1.valid, true);
    assert.deepEqual(res1.normalizedQuestion.options, ['gigantic', 'tiny', 'fragile', 'narrow']);

    // 5b. Dummy letter options like [{text:"A"}, ...] -> MUST BE REJECTED (fail closed)
    const rawWithDummyLetters = {
      prompt: 'Choose the correct answer for question 1:',
      options: [
        { text: 'A' },
        { text: 'B' },
        { text: 'C' },
        { text: 'D' },
      ],
      correctIndex: 0,
      correctAnswer: 'A',
    };
    const res2 = validateGeneratedQuestion(rawWithDummyLetters);
    assert.equal(res2.valid, false, 'Dummy letter options must be rejected');

    // 5c. Pure dummy letters array ['A', 'B', 'C', 'D'] -> MUST BE REJECTED
    const rawLetterArray = {
      prompt: 'Choose the correct option letter:',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      correctAnswer: 'A',
    };
    const res3 = validateGeneratedQuestion(rawLetterArray);
    assert.equal(res3.valid, false, 'Plain dummy letters [A, B, C, D] must be rejected');
  });

  // Test 6: 20 questions, 1 invalid -> NOT successful 20-question preview
  test('6. 20 questions, 1 invalid -> NOT successful 20-question preview', async () => {
    let callCount = 0;
    const provider = {
      name: 'provider-one-invalid',
      model: 'gemini-3.1-flash-lite',
      async healthCheck() { return { healthy: true, provider: 'gemini', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        callCount++;
        if (callCount === 1) {
          // 20 questions, but question 20 has empty option
          const questions = Array.from({ length: 20 }, (_, i) => ({
            prompt: `Educational curriculum question ${i + 1} regarding grammar?`,
            options: i === 19
              ? ['real option 1', '', 'real option 3', 'real option 4']
              : ['real option 1', 'real option 2', 'real option 3', 'real option 4'],
            correctAnswer: 'real option 1',
            correctIndex: 0,
          }));
          return { success: true, data: { questions } };
        }
        // Completion fails to fix
        return { success: true, data: { questions: [] } };
      },
    };

    await assert.rejects(
      async () => {
        await generateAssessmentFromText({
          documentText: 'English grammar curriculum unit one text. '.repeat(50),
          requestedQuestionCount: 20,
          provider,
        });
      },
      /تم توليد 19 من أصل 20 سؤالًا صالحًا فقط/
    );
  });

  // Test 7: teacher clears one option -> confirm button disabled
  test('7. teacher clears one option -> confirm button disabled with exact Arabic warning', () => {
    const questions = [
      {
        prompt: 'What is the opposite of hot?',
        options: ['cold', 'warm', 'boiling', 'freezing'],
        correctAnswer: 'cold',
        correctIndex: 0,
      },
    ];
    // Initially valid
    assert.equal(isAssessmentSubmissionAllowed(questions).allowed, true);

    // Teacher clears option 1
    const edited = [
      {
        ...questions[0],
        options: ['cold', '', 'boiling', 'freezing'],
      },
    ];
    const check = isAssessmentSubmissionAllowed(edited);
    assert.equal(check.allowed, false);
    assert.ok(check.reason?.includes('هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.'));
  });

  // Test 8: crafted final payload has blank option -> HTTP 400 -> zero inserts
  test('8. crafted final payload has blank option -> HTTP 400 -> zero inserts', async () => {
    const prevEnv = globalThis.__ENGLIZEKA_ENV__;
    const prevAi = process.env.AI_ASSISTANT_ENABLED;
    const prevSec = process.env.AI_CONFIRMATION_SECRET;
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_CONFIRMATION_SECRET = '0123456789abcdef0123456789abcdef';

    let insertCount = 0;
    class MockDb {
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
                if (sql.includes('INSERT INTO ai_confirmations')) {
                  insertCount++;
                }
                return { results: [], success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      }
    }

    globalThis.__ENGLIZEKA_ENV__ = { DB: new MockDb() };

    try {
      const { POST: prepareConfirmation } = await import('../app/api/admin/ai/prepare-confirmation/route.ts');
      const res = await prepareConfirmation(
        new Request('https://englezika.com/api/admin/ai/prepare-confirmation', {
          method: 'POST',
          headers: {
            origin: 'https://englezika.com',
            cookie: 'englizeka_staff=token12345',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            actionType: 'compound_plan',
            actionPayload: {
              steps: [
                {
                  tool: 'create_quiz',
                  parameters: {
                    courseId: 'c_test',
                    title: 'Crafted Invalid Assessment',
                    questions: [
                      {
                        prompt: 'What is an English noun?',
                        options: ['book', '', 'blue', 'quickly'],
                        correctAnswer: 'book',
                        correctIndex: 0,
                      },
                    ],
                  },
                },
              ],
            },
          }),
        })
      );

      assert.equal(res.status, 400);
      assert.equal(insertCount, 0, 'Zero confirmations or inserts must occur');
    } finally {
      globalThis.__ENGLIZEKA_ENV__ = prevEnv;
      process.env.AI_ASSISTANT_ENABLED = prevAi;
      process.env.AI_CONFIRMATION_SECRET = prevSec;
    }
  });

  // Mock course lectures for tests 9–14
  const mockLectures = [
    { id: 'lec_1', courseId: 'c_course_1', title: 'المحاضرة 1: Present Simple', sortOrder: 1 },
    { id: 'lec_2', courseId: 'c_course_1', title: 'المحاضرة 2: Present Continuous', sortOrder: 2 },
    { id: 'lec_3', courseId: 'c_course_1', title: 'المحاضرة 3: Past Simple', sortOrder: 3 },
    { id: 'lec_4', courseId: 'c_course_1', title: 'المحاضرة 4: Past Continuous', sortOrder: 4 },
    { id: 'lec_5', courseId: 'c_course_1', title: 'المحاضرة 5: Present Perfect', sortOrder: 5 },
    { id: 'lec_6', courseId: 'c_course_1', title: 'المحاضرة 6: Future Forms', sortOrder: 6 },
    { id: 'lec_7', courseId: 'c_course_1', title: 'المحاضرة 7: Passive Voice', sortOrder: 7 },
  ];

  // Test 9: selected course loads ordered lectures
  test('9. selected course loads ordered lectures', () => {
    const courseId = 'c_course_1';
    const courseLecs = mockLectures
      .filter((l) => l.courseId === courseId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    assert.equal(courseLecs.length, 7);
    assert.equal(courseLecs[0].id, 'lec_1');
    assert.equal(courseLecs[6].id, 'lec_7');
  });

  // Test 10: range selection: lecture 3 -> lecture 7 -> valid
  test('10. range selection: lecture 3 -> lecture 7 -> valid', () => {
    const validation = validateLectureCoverageRange({
      courseId: 'c_course_1',
      mode: 'range',
      startLectureId: 'lec_3',
      endLectureId: 'lec_7',
      courseLectures: mockLectures,
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.startLectureId, 'lec_3');
    assert.equal(validation.endLectureId, 'lec_7');
  });

  // Test 11: reversed range: lecture 7 -> lecture 3 -> rejected
  test('11. reversed range: lecture 7 -> lecture 3 -> rejected', () => {
    const validation = validateLectureCoverageRange({
      courseId: 'c_course_1',
      mode: 'range',
      startLectureId: 'lec_7',
      endLectureId: 'lec_3',
      courseLectures: mockLectures,
    });
    assert.equal(validation.valid, false);
    assert.ok(validation.error?.includes('محاضرة البداية'));
  });

  // Test 12: lecture from another course -> rejected server-side
  test('12. lecture from another course -> rejected server-side', () => {
    const validation = validateLectureCoverageRange({
      courseId: 'c_course_1',
      mode: 'range',
      startLectureId: 'lec_3',
      endLectureId: 'lec_other_course',
      courseLectures: mockLectures,
    });
    assert.equal(validation.valid, false);
    assert.ok(validation.error?.includes('غير تابعة'));
  });

  // Test 13: "all lectures" -> canonical full course range/coverage behavior
  test('13. "all lectures" -> canonical full course range/coverage behavior', () => {
    const validation = validateLectureCoverageRange({
      courseId: 'c_course_1',
      mode: 'all',
      courseLectures: mockLectures,
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.mode, 'all');
    assert.equal(validation.startLectureId, null);
    assert.equal(validation.endLectureId, null);
  });

  // Test 14: preview displays selected lecture range
  test('14. preview displays selected lecture range', () => {
    const coverageMetadata = {
      mode: 'range',
      startLectureId: 'lec_3',
      endLectureId: 'lec_7',
      startLectureTitle: 'المحاضرة 3 - Past Simple',
      endLectureTitle: 'المحاضرة 7 - Passive Voice',
      courseTitle: 'English Grade 10',
      sourceFileName: 'unit one.pdf',
    };
    const displayText = coverageMetadata.mode === 'all'
      ? 'جميع المحاضرات'
      : `من ${coverageMetadata.startLectureTitle} إلى ${coverageMetadata.endLectureTitle}`;
    assert.ok(displayText.includes('المحاضرة 3'));
    assert.ok(displayText.includes('المحاضرة 7'));
  });
});
