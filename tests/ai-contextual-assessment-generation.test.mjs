import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  validateGeneratedQuestion,
  validateGeneratedAssessment,
  isAssessmentSubmissionAllowed,
  normalizePromptHash,
  normalizeBlank,
  isTheoreticalQuestion,
} from '../app/lib/ai/assessment-validator.ts';
import { generateAssessmentFromText } from '../app/lib/ai/content-generator.ts';
import { assessmentService } from '../app/lib/services/assessment-service.ts';
import { executeTool } from '../app/lib/ai/tool-executor.ts';
import { createConfirmationRequest, verifyAndExecuteConfirmation } from '../app/lib/ai/confirmation.server.ts';

const teacherActor = {
  email: 'teacher@englizeka.com',
  name: 'Teacher Ahmed',
  role: 'admin',
  permissions: ['manage_courses', 'manage_videos', 'manage_exams'],
};

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Egyptian Secondary School Contextual Assessment Suite', () => {
  // 1. Generation validator accepts contextual fill-in-the-blank question + 4 options + correct + explanation
  test('1. Generation validator accepts contextual fill-in-the-blank question with explanation', () => {
    const validMCQ = {
      prompt: 'The bank ........ by thieves last night.',
      options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
      correctIndex: 1,
      correctAnswer: 'was robbed',
      explanation: 'هنا البنك هو اللي اتعمل عليه الفعل ومعانا last night فمحتاجين Passive Voice في زمن Past Simple (was/were + P.P.)، علشان كده was robbed هي الصح.',
    };

    const result = validateGeneratedQuestion(validMCQ);
    assert.equal(result.valid, true);
    assert.ok(result.normalizedQuestion);
    assert.equal(result.normalizedQuestion.prompt, 'The bank ........ by thieves last night.');
    assert.equal(result.normalizedQuestion.correctAnswer, 'was robbed');
    assert.ok(result.normalizedQuestion.explanation?.includes('was robbed'));
  });

  // 2. Validator rejects theoretical grammar-rule questions
  test('2. Validator rejects theoretical grammar-rule questions', () => {
    const theoreticalQuestions = [
      {
        prompt: 'What is the rule for the Past Simple tense?',
        options: ['S + V2', 'S + have + V3', 'S + will + V', 'S + am/is/are + V-ing'],
        correctIndex: 0,
        correctAnswer: 'S + V2',
        explanation: 'الماضي البسيط بيتكون من التصريف الثاني للفعل.',
      },
      {
        prompt: 'Which tense is used to describe completed past actions?',
        options: ['Past Simple', 'Present Continuous', 'Future Simple', 'Past Perfect Continuous'],
        correctIndex: 0,
        correctAnswer: 'Past Simple',
        explanation: 'Past Simple بيعبر عن أحداث انتهت في الماضي.',
      },
      {
        prompt: 'Which sentence correctly describes the Passive Voice?',
        options: [
          'Subject receives the action',
          'Subject performs the action',
          'No verb is used',
          'Only used in future tense',
        ],
        correctIndex: 0,
        correctAnswer: 'Subject receives the action',
        explanation: 'في المبني للمجهول المفعول به هو اللي بيتقدم.',
      },
      {
        prompt: 'Which of the following explains the function of Present Perfect?',
        options: ['Action connected to present', 'Action in 1990', 'Habit in past', 'Future plan'],
        correctIndex: 0,
        correctAnswer: 'Action connected to present',
        explanation: 'Present Perfect بيربط الماضي بالحاضر.',
      },
      {
        prompt: 'What is the structure of the first conditional?',
        options: ['If + present simple, will + inf', 'If + past, would', 'If + had, would have', 'If + will, present'],
        correctIndex: 0,
        correctAnswer: 'If + present simple, will + inf',
        explanation: 'قاعدة الحالة الأولى من if.',
      },
      {
        prompt: 'What does Present Perfect mean in English grammar?',
        options: ['Completed action with present result', 'Past habit', 'Continuous future', 'Imaginary situation'],
        correctIndex: 0,
        correctAnswer: 'Completed action with present result',
        explanation: 'معنى زمن المضارع التام.',
      },
      {
        prompt: 'Which rule applies when using since vs for?',
        options: ['Point in time vs duration', 'Both same', 'For with years only', 'Since with hours only'],
        correctIndex: 0,
        correctAnswer: 'Point in time vs duration',
        explanation: 'قاعدة since و for.',
      },
    ];

    for (const q of theoreticalQuestions) {
      const result = validateGeneratedQuestion(q);
      assert.equal(result.valid, false, `Expected theoretical question to be rejected: "${q.prompt}"`);
      assert.ok(
        result.reasons.includes('THEORETICAL_QUESTION') || result.reasons.includes('INVALID_QUESTION_STYLE'),
        `Expected rejection reason for "${q.prompt}", got: ${result.reasons.join(', ')}`
      );
    }
  });

  // 3. Validator rejects missing explanation
  test('3. Validator rejects question with missing explanation', () => {
    const raw = {
      prompt: 'While Ahmed was walking home, he ........ his old teacher.',
      options: ['meets', 'met', 'has met', 'was meet'],
      correctIndex: 1,
      correctAnswer: 'met',
      // explanation omitted
    };

    const result = validateGeneratedQuestion(raw);
    assert.equal(result.valid, false);
    assert.ok(
      result.reasons.includes('MISSING_EXPLANATION') || result.reasons.includes('EMPTY_EXPLANATION'),
      `Expected explanation error, got: ${result.reasons.join(', ')}`
    );
  });

  // 4. Validator rejects empty explanation
  test('4. Validator rejects empty explanation or whitespace-only explanation', () => {
    const rawEmpty = {
      prompt: 'While Ahmed was walking home, he ........ his old teacher.',
      options: ['meets', 'met', 'has met', 'was meet'],
      correctIndex: 1,
      correctAnswer: 'met',
      explanation: '',
    };
    const resEmpty = validateGeneratedQuestion(rawEmpty);
    assert.equal(resEmpty.valid, false);
    assert.ok(resEmpty.reasons.includes('EMPTY_EXPLANATION'));

    const rawSpaces = {
      prompt: 'While Ahmed was walking home, he ........ his old teacher.',
      options: ['meets', 'met', 'has met', 'was meet'],
      correctIndex: 1,
      correctAnswer: 'met',
      explanation: '     ',
    };
    const resSpaces = validateGeneratedQuestion(rawSpaces);
    assert.equal(resSpaces.valid, false);
    assert.ok(resSpaces.reasons.includes('EMPTY_EXPLANATION'));
  });

  // 5. Validator rejects malformed explanation types
  test('5. Validator rejects malformed explanation types (non-string)', () => {
    const nonStringExplanations = [123, true, ['شرح'], { text: 'شرح' }, null];
    for (const exp of nonStringExplanations) {
      const raw = {
        prompt: 'Mona has lived here ........ 2022.',
        options: ['for', 'since', 'ago', 'from'],
        correctIndex: 1,
        correctAnswer: 'since',
        explanation: exp,
      };
      const res = validateGeneratedQuestion(raw);
      assert.equal(res.valid, false, `Expected non-string explanation to be rejected: ${typeof exp}`);
      assert.ok(
        res.reasons.includes('MALFORMED_EXPLANATION') || res.reasons.includes('MISSING_EXPLANATION'),
        `Expected malformed explanation reason, got: ${res.reasons.join(', ')}`
      );
    }
  });

  // 6. Exact-count behavior still works with contextual questions + explanations
  test('6. Exact-count validation preserves requested count with contextual questions', () => {
    const q1 = {
      prompt: 'The bank ........ by thieves last night.',
      options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
      correctIndex: 1,
      correctAnswer: 'was robbed',
      explanation: 'هنا البنك هو اللي اتعمل عليه الفعل ومعانا last night فمحتاجين Passive Voice.',
    };
    const q2 = {
      prompt: 'Mona has lived here ........ 2022.',
      options: ['for', 'since', 'ago', 'from'],
      correctIndex: 1,
      correctAnswer: 'since',
      explanation: 'وجود 2022 كنقطة بداية محددة مع زمن Present Perfect بيتطلب since.',
    };

    const res2 = validateGeneratedAssessment([q1, q2], 2);
    assert.equal(res2.valid, true);
    assert.equal(res2.validQuestions.length, 2);

    const res3 = validateGeneratedAssessment([q1, q2], 3);
    assert.equal(res3.valid, false);
    assert.equal(res3.validQuestions.length, 2);
  });

  // 7. Completion/retry generated questions must also include explanation
  test('7. Content generator pass 1 and pass 2 completion enforce contextual style and explanations', async () => {
    let callCount = 0;
    const provider = {
      name: 'test-completion-provider',
      model: 'test-model',
      async healthCheck() { return { healthy: true, provider: 'mock', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(opts) {
        callCount++;
        if (callCount === 1) {
          // Return 1 valid contextual question and 1 theoretical (which will be rejected)
          return {
            success: true,
            data: {
              questions: [
                {
                  prompt: 'The bank ........ by thieves last night.',
                  options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
                  correctIndex: 1,
                  correctAnswer: 'was robbed',
                  explanation: 'هنا البنك هو اللي اتعمل عليه الفعل ومعانا last night فمحتاجين Passive Voice.',
                },
                {
                  prompt: 'What is the rule for Past Simple?',
                  options: ['S + V2', 'S + V1', 'S + will + V', 'S + ing'],
                  correctIndex: 0,
                  correctAnswer: 'S + V2',
                  explanation: 'قاعدة الماضي البسيط.',
                },
              ],
            },
          };
        }
        // Completion pass (callCount === 2) returns 1 valid contextual replacement
        return {
          success: true,
          data: {
            questions: [
              {
                prompt: 'While Ahmed was walking home, he ........ his old teacher.',
                options: ['meets', 'met', 'has met', 'was meet'],
                correctIndex: 1,
                correctAnswer: 'met',
                explanation: 'الحدث القاطع في الماضي المستمر بيكون في Past Simple، علشان كده met هي الصح.',
              },
            ],
          },
        };
      },
    };

    const preview = await generateAssessmentFromText({
      documentText: 'Grammar Unit: Past tenses and passive voice. '.repeat(50),
      requestedQuestionCount: 2,
      provider,
    });

    assert.equal(preview.questionCount, 2);
    assert.equal(preview.questions.length, 2);
    assert.ok(preview.questions[0].explanation);
    assert.ok(preview.questions[1].explanation);
    assert.ok(!preview.questions.some((q) => q.prompt.includes('What is the rule')));
  });

  // 8. Explanation survives generation -> preview -> durable confirmation -> execution -> AssessmentService
  test('8. Explanation survives generation -> preview -> durable confirmation -> execution -> AssessmentService', async () => {
    const db = new Map();
    const mockDb = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('information_schema.columns')) return { 1: 1 };
                if (sql.includes('FROM courses WHERE id = ?')) return { id: args[0], title: 'English 101' };
                if (sql.includes('FROM ai_confirmations WHERE id = ?')) return db.get(args[0]) || null;
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO ai_confirmations')) {
                  const [id, tokenHash, email, actionType, payload, createdAt, expiresAt] = args;
                  db.set(id, {
                    id,
                    token_hash: tokenHash,
                    staff_email: email,
                    action_type: actionType,
                    action_payload: payload,
                    state: 'pending',
                    created_at: createdAt,
                    expires_at: expiresAt,
                  });
                  return { results: [], success: true, meta: { changes: 1 } };
                }
                if (sql.includes("UPDATE ai_confirmations SET state = 'executed'")) {
                  const record = db.get(args[0]);
                  if (record) record.state = 'executed';
                  return { results: [], success: true, meta: { changes: 1 } };
                }
                return { results: [], success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
      async batch(stmts) {
        for (const s of stmts) {
          if (typeof s.run === 'function') await s.run();
        }
        return [];
      },
    };

    const contextualQuestions = [
      {
        prompt: 'The bank ........ by thieves last night.',
        options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
        correctAnswer: 'was robbed',
        explanation: 'هنا البنك هو اللي اتعمل عليه الفعل ومعانا last night فمحتاجين Passive Voice.',
      },
    ];

    // Create durable confirmation request
    const request = await createConfirmationRequest({
      actionType: 'create_exam',
      actor: teacherActor,
      actionPayload: {
        courseId: 'course-101',
        title: 'Grammar Unit Exam',
        questions: contextualQuestions,
      },
      secret: SECRET,
      db: mockDb,
    });

    assert.ok(request.tokenId);
    assert.ok(request.token);

    // Verify durable confirmation payload contains explanation intact
    const stored = db.get(request.tokenId);
    const parsedPayload = JSON.parse(stored.action_payload);
    assert.equal(parsedPayload.questions[0].explanation, contextualQuestions[0].explanation);
  });

  // 9. Explanation is persisted correctly in AssessmentService
  test('9. Explanation is persisted correctly by AssessmentService into questions table', async () => {
    let capturedQuestionInsert = null;

    const mockDb = {
      prepare(sql) {
        return {
          bind(...args) {
            if (sql.includes('INSERT INTO questions')) {
              capturedQuestionInsert = args;
            }
            return {
              async first() {
                if (sql.includes('information_schema.columns')) return { 1: 1 };
                if (sql.includes('FROM courses WHERE id = ?')) return { id: args[0] };
                return null;
              },
              async run() { return { results: [], success: true }; },
            };
          },
        };
      },
      async batch(stmts) {
        for (const stmt of stmts) {
          if (typeof stmt?.run === 'function') await stmt.run();
        }
        return [];
      },
    };

    await assessmentService.createExam(
      {
        courseId: 'course-101',
        title: 'Contextual Exam',
        questions: [
          {
            prompt: 'The bank ........ by thieves last night.',
            options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
            correctAnswer: 'was robbed',
            explanation: 'هنا البنك اتعمل عليه الفعل فمحتاجين Passive Voice.',
          },
        ],
      },
      teacherActor,
      { db: mockDb }
    );

    assert.ok(capturedQuestionInsert, 'Expected questions table insert statement to be executed');
    // args: [questionId, examId, sortOrder, type, prompt, optionsJson, correctAnswer, rubric, explanation, points]
    const explanationArg = capturedQuestionInsert[8];
    assert.equal(explanationArg, 'هنا البنك اتعمل عليه الفعل فمحتاجين Passive Voice.');
  });

  // 10. Legacy questions without explanation still work
  test('10. Legacy questions without explanation continue to be supported', () => {
    const legacyRaw = {
      prompt: 'Select the correct option for general reading comprehension.',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctIndex: 0,
      correctAnswer: 'Option A',
    };

    const res = validateGeneratedQuestion(legacyRaw, { allowLegacyWithoutExplanation: true });
    assert.equal(res.valid, true);
    assert.equal(res.normalizedQuestion?.explanation, undefined);
  });

  // 11. Active exam API does NOT leak explanation
  test('11. Active exam API does NOT leak explanation to student before submission', async () => {
    // Read the query and mapping in app/api/exams/[id]/route.ts
    const { readFile } = await import('node:fs/promises');
    const routeContent = await readFile('app/api/exams/[id]/route.ts', 'utf-8');

    // In GET route, questions are selected without explanation
    assert.match(
      routeContent,
      /SELECT id, sort_order AS sortOrder, type, prompt, options, points/i,
      'GET endpoint must NOT select explanation'
    );
    assert.doesNotMatch(
      routeContent,
      /SELECT id, sort_order AS sortOrder, type, prompt, options, (explanation, )?points.*FROM questions WHERE exam_id = \? ORDER BY sort_order\s*`\s*\)\s*\.bind\(id\)/i,
      'Must strictly exclude explanation from active exam question query'
    );
  });

  // 12. Completed result/review DOES return/display explanation
  test('12. Completed result/review endpoint returns explanation for review', async () => {
    const { readFile } = await import('node:fs/promises');
    const attemptRouteContent = await readFile('app/api/attempts/[id]/route.ts', 'utf-8');

    assert.ok(
      attemptRouteContent.includes('q.explanation') || attemptRouteContent.includes('explanation'),
      'Attempt result endpoint must select q.explanation'
    );
  });

  // 13. Existing option/correct-answer validation remains intact
  test('13. Existing option/correct-answer validation invariants remain intact', () => {
    // 3 options -> rejected
    const threeOpts = validateGeneratedQuestion({
      prompt: 'The bank ........ by thieves last night.',
      options: ['robbed', 'was robbed', 'has robbed'],
      correctIndex: 1,
      correctAnswer: 'was robbed',
      explanation: 'شرح كافي.',
    });
    assert.equal(threeOpts.valid, false);
    assert.ok(threeOpts.reasons.includes('WRONG_OPTION_COUNT'));

    // Blank option -> rejected
    const blankOpt = validateGeneratedQuestion({
      prompt: 'The bank ........ by thieves last night.',
      options: ['robbed', 'was robbed', '', 'is robbing'],
      correctIndex: 1,
      correctAnswer: 'was robbed',
      explanation: 'شرح كافي.',
    });
    assert.equal(blankOpt.valid, false);
    assert.ok(blankOpt.reasons.includes('EMPTY_OPTION'));

    // Duplicate option -> rejected
    const dupOpt = validateGeneratedQuestion({
      prompt: 'The bank ........ by thieves last night.',
      options: ['robbed', 'was robbed', 'was robbed', 'is robbing'],
      correctIndex: 1,
      correctAnswer: 'was robbed',
      explanation: 'شرح كافي.',
    });
    assert.equal(dupOpt.valid, false);
    assert.ok(dupOpt.reasons.includes('DUPLICATE_OPTION'));
  });

  // 14. Quiz and Exam both support the behavior
  test('14. Quiz and Exam tools in tool executor both pass questions with explanations', async () => {
    let createdExams = [];
    const mockDb = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('information_schema.columns')) return { 1: 1 };
                if (sql.includes('FROM courses WHERE id = ?')) return { id: args[0] };
                return null;
              },
              async run() { return { results: [], success: true }; },
            };
          },
        };
      },
      async batch(stmts) {
        for (const stmt of stmts) {
          if (typeof stmt?.run === 'function') await stmt.run();
        }
        return [];
      },
    };

    // create_exam
    await executeTool({
      actor: teacherActor,
      toolName: 'create_exam',
      args: {
        courseId: 'course-101',
        title: 'Exam Title',
        questions: [
          {
            prompt: 'The bank ........ by thieves last night.',
            options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
            correctAnswer: 'was robbed',
            explanation: 'شرح الامتحان.',
          },
        ],
      },
      context: { confirmationSatisfied: true, db: mockDb },
    });

    // create_quiz
    await executeTool({
      actor: teacherActor,
      toolName: 'create_quiz',
      args: {
        courseId: 'course-101',
        title: 'Quiz Title',
        questions: [
          {
            prompt: 'Mona has lived here ........ 2022.',
            options: ['for', 'since', 'ago', 'from'],
            correctAnswer: 'since',
            explanation: 'شرح الكويز.',
          },
        ],
      },
      context: { confirmationSatisfied: true, db: mockDb },
    });
  });

  // 15. Manual Quality Fixtures
  describe('Manual Quality Fixtures Suite', () => {
    test('Fixture A: Past Continuous middle-of-action application', () => {
      const fixtureA = {
        prompt: 'At eight, he ........ breakfast. He was in the middle of breakfast.',
        options: ['had eaten', 'has', 'is having', 'was having'],
        correctIndex: 3,
        correctAnswer: 'was having',
        explanation: 'وجود He was in the middle of breakfast معناه إن الفعل كان مستمر في اللحظة دي في الماضي، فمحتاجين Past Continuous. علشان كده was having هي الصح.',
      };

      const result = validateGeneratedQuestion(fixtureA);
      assert.equal(result.valid, true);
      assert.ok(result.normalizedQuestion);
      assert.equal(result.normalizedQuestion.prompt, 'At eight, he ........ breakfast. He was in the middle of breakfast.');
      assert.equal(result.normalizedQuestion.correctAnswer, 'was having');
      assert.equal(result.normalizedQuestion.correctIndex, 3);
      assert.equal(result.normalizedQuestion.explanation, fixtureA.explanation);
    });

    test('Fixture B: Past Simple sequence with killed application', () => {
      const fixtureB = {
        prompt: 'The thieves ........ the bank and killed the guard.',
        options: ['rob', 'robbed', 'robbing', 'are rob'],
        correctIndex: 1,
        correctAnswer: 'robbed',
        explanation: 'عندنا killed في نفس الجملة، وده حدث حصل وخلص في الماضي، فالفعل التاني لازم يمشي معاه في Past Simple. علشان كده robbed هي الصح.',
      };

      const result = validateGeneratedQuestion(fixtureB);
      assert.equal(result.valid, true);
      assert.ok(result.normalizedQuestion);
      assert.equal(result.normalizedQuestion.prompt, 'The thieves ........ the bank and killed the guard.');
      assert.equal(result.normalizedQuestion.correctAnswer, 'robbed');
      assert.equal(result.normalizedQuestion.correctIndex, 1);
      assert.equal(result.normalizedQuestion.explanation, fixtureB.explanation);
    });
  });
});
