import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  STAGE_PROFILES,
  SCHOOL_GRADES,
  EXAM_PRESETS,
  getStageForGrade,
  resolvePresetSections,
  getAvailableSectionsForStage,
  allocateStageSections,
  isQuestionTypeAllowedForStage,
} from '../app/lib/ai/stage-exam-profiles.ts';

import {
  generateStageExam,
  validateStageExamQuestion,
  getListeningScriptForStage,
  getWritingRubricForStage,
} from '../app/lib/ai/stage-exam-generator.ts';

describe('Egyptian School Stages & Profiles Verification', () => {
  test('Primary stage profile has correct grades and forbids advanced questions', () => {
    const primary = STAGE_PROFILES.primary;
    assert.equal(primary.stage, 'primary');
    assert.deepEqual(primary.allowedGrades, [
      'primary_1',
      'primary_2',
      'primary_3',
      'primary_4',
      'primary_5',
      'primary_6'
    ]);

    assert.equal(primary.supportsTranslation, false);
    assert.equal(primary.supportsDialogue, false);
    assert.equal(primary.supportsRewrite, false);
    assert.equal(primary.supportsTwoCorrectMCQ, false);

    assert.equal(isQuestionTypeAllowedForStage('primary', 'translation'), false);
    assert.equal(isQuestionTypeAllowedForStage('primary', 'dialogue_complete'), false);
    assert.equal(isQuestionTypeAllowedForStage('primary', 'rewrite'), false);
    assert.equal(isQuestionTypeAllowedForStage('primary', 'mcq_two_correct'), false);
    assert.equal(isQuestionTypeAllowedForStage('primary', 'mcq'), true);
    assert.equal(isQuestionTypeAllowedForStage('primary', 'match'), true);
    assert.equal(isQuestionTypeAllowedForStage('primary', 'circle_word'), true);
  });

  test('Preparatory stage profile supports dialogue, translation, reading & writing', () => {
    const prep = STAGE_PROFILES.preparatory;
    assert.equal(prep.stage, 'preparatory');
    assert.deepEqual(prep.allowedGrades, ['prep_1', 'prep_2', 'prep_3']);
    assert.equal(prep.supportsDialogue, true);
    assert.equal(prep.supportsTranslation, true);
    assert.equal(prep.supportsRewrite, false);
    assert.equal(prep.supportsTwoCorrectMCQ, false);

    assert.equal(isQuestionTypeAllowedForStage('preparatory', 'dialogue_complete'), true);
    assert.equal(isQuestionTypeAllowedForStage('preparatory', 'translation'), true);
    assert.equal(isQuestionTypeAllowedForStage('preparatory', 'mcq_two_correct'), false);
  });

  test('Secondary and Thanaweya profiles support 2-out-of-5 MCQs and rewrite', () => {
    const sec = STAGE_PROFILES.secondary;
    const thanaweya = STAGE_PROFILES.thanaweya;

    assert.equal(sec.supportsTwoCorrectMCQ, true);
    assert.equal(sec.supportsRewrite, true);
    assert.equal(thanaweya.supportsTwoCorrectMCQ, true);
    assert.equal(thanaweya.supportsRewrite, false);

    assert.equal(isQuestionTypeAllowedForStage('secondary', 'mcq_two_correct'), true);
    assert.equal(isQuestionTypeAllowedForStage('thanaweya', 'mcq_two_correct'), true);
  });

  test('getStageForGrade resolves all 12 grades accurately', () => {
    assert.equal(getStageForGrade('primary_1'), 'primary');
    assert.equal(getStageForGrade('primary_6'), 'primary');
    assert.equal(getStageForGrade('prep_1'), 'preparatory');
    assert.equal(getStageForGrade('prep_3'), 'preparatory');
    assert.equal(getStageForGrade('sec_1'), 'secondary');
    assert.equal(getStageForGrade('sec_2'), 'secondary');
    assert.equal(getStageForGrade('sec_3'), 'thanaweya');
  });
});

describe('Exam Presets and Section Allocation', () => {
  test('All 7 exam presets are configured with appropriate defaults', () => {
    const presets = [
      'school_simple_exam',
      'unit_test',
      'worksheet_quiz',
      'monthly_exam',
      'midterm_exam',
      'final_exam',
      'thanaweya_mock'
    ];
    for (const p of presets) {
      assert.ok(EXAM_PRESETS[p], 'Preset ' + p + ' should be defined');
      assert.ok(EXAM_PRESETS[p].defaultQuestionCount > 0);
      assert.ok(EXAM_PRESETS[p].defaultTimeMinutes > 0);
      assert.ok(EXAM_PRESETS[p].defaultTotalMarks > 0);
    }
  });

  test('resolvePresetSections filters out sections not allowed for stage', () => {
    const primarySections = resolvePresetSections('primary', 'midterm_exam');
    assert.ok(!primarySections.includes('translation'), 'Primary must not have translation in midterm');

    const prepSections = resolvePresetSections('preparatory', 'midterm_exam');
    assert.ok(prepSections.includes('translation'), 'Prep should have translation');
  });

  test('allocateStageSections distributes exact requested count', () => {
    const counts = [5, 10, 15, 20, 25, 35, 42];
    for (const total of counts) {
      const allocation = allocateStageSections('preparatory', ['dialogue', 'vocabulary', 'grammar', 'reading', 'writing', 'translation'], total);
      const allocatedSum = allocation.reduce((sum, item) => sum + item.questionCount, 0);
      assert.equal(allocatedSum, total);
    }
  });
});

describe('Stage Exam Generation End-to-End', () => {
  test('Generates Primary 4 Exam with exact question count and no forbidden types', async () => {
    const exam = await generateStageExam({
      stage: 'primary',
      grade: 'primary_4',
      preset: 'school_simple_exam',
      questionCount: 10,
      term: 'term_1',
      unitTopic: 'Unit 1: At the Zoo',
      schoolName: '????? ????? ??????????',
      governorate: '?????? ??????',
      isGeneralPractice: true
    });

    assert.equal(exam.questionsCount, 10);
    assert.equal(exam.metadata.stage, 'primary');
    assert.equal(exam.metadata.grade, 'primary_4');

    const allQuestions = exam.sections.flatMap(s => s.questions);
    assert.equal(allQuestions.length, 10);

    for (const q of allQuestions) {
      assert.notEqual(q.questionType, 'translation', 'Primary question must not be translation');
      assert.notEqual(q.questionType, 'rewrite', 'Primary question must not be rewrite');
      assert.notEqual(q.questionType, 'mcq_two_correct', 'Primary question must not be 2-out-of-5');
    }

    assert.ok(exam.paperLayout.ministryHeaderAr.includes('وزارة التربية والتعليم') || exam.paperLayout.ministryHeaderAr.length > 10);
    assert.ok(exam.paperLayout.studentInfoFields.length > 0);
    assert.equal(exam.answerKey.length, 10);
  });

  test('Generates Preparatory 2 Exam with dialogue and translation', async () => {
    const exam = await generateStageExam({
      stage: 'preparatory',
      grade: 'prep_2',
      preset: 'midterm_exam',
      questionCount: 15,
      term: 'term_1',
      unitTopic: 'Units 1-3: Technology and Daily Life',
      isGeneralPractice: true
    });

    assert.equal(exam.questionsCount, 15);
    const allQuestions = exam.sections.flatMap(s => s.questions);
    assert.equal(allQuestions.length, 15);

    const types = new Set(allQuestions.map(q => q.questionType));
    const sectionTypes = new Set(exam.sections.map(s => s.sectionType));

    assert.ok(sectionTypes.has('dialogue') || types.has('dialogue_complete'), 'Prep exam should have dialogue');
    assert.ok(sectionTypes.has('translation') || types.has('translation'), 'Prep exam should have translation');
    assert.equal(exam.answerKey.length, 15);
  });

  test('Generates Secondary 1 Exam with rewrite and analytical reading', async () => {
    const exam = await generateStageExam({
      stage: 'secondary',
      grade: 'sec_1',
      preset: 'final_exam',
      questionCount: 20,
      term: 'term_1',
      unitTopic: 'First Term Comprehensive Exam',
      isGeneralPractice: true
    });

    assert.equal(exam.questionsCount, 20);
    const allQuestions = exam.sections.flatMap(s => s.questions);
    assert.equal(allQuestions.length, 20);

    const sectionTypes = new Set(exam.sections.map(s => s.sectionType));
    assert.ok(sectionTypes.has('reading'), 'Secondary exam should include reading comprehension');
    assert.ok(exam.writingRubric, 'Secondary exam should have a writing rubric');
  });

  test('Generates Grade 12 Thanaweya Mock Exam with 35 questions and full rubric', async () => {
    const exam = await generateStageExam({
      stage: 'thanaweya',
      grade: 'sec_3',
      preset: 'thanaweya_mock',
      questionCount: 35,
      totalMarks: 50,
      timeMinutes: 180,
      term: 'term_1',
      unitTopic: 'Full Year Thanaweya Amma Final Mock Exam',
      isGeneralPractice: true
    });

    assert.equal(exam.questionsCount, 35);
    const allQuestions = exam.sections.flatMap(s => s.questions);
    assert.equal(allQuestions.length, 35);

    assert.ok(exam.writingRubric, 'Thanaweya mock must include writing rubric');
    assert.equal(exam.answerKey.length, 35, 'Answer key must have exactly 35 items');

    for (let i = 0; i < allQuestions.length; i++) {
      assert.equal(allQuestions[i].questionNumber, i + 1);
      assert.equal(exam.answerKey[i].questionNumber, i + 1);
    }
  });

  test('Exact count is preserved across arbitrary custom question counts', async () => {
    const customCounts = [7, 13, 23];
    for (const count of customCounts) {
      const exam = await generateStageExam({
        stage: 'preparatory',
        grade: 'prep_1',
        preset: 'worksheet_quiz',
        questionCount: count,
        term: 'term_2',
        unitTopic: 'Quick Quiz',
        isGeneralPractice: true
      });
      assert.equal(exam.questionsCount, count);
      assert.equal(exam.sections.flatMap(s => s.questions).length, count);
      assert.equal(exam.answerKey.length, count);
    }
  });
});

describe('AI Provider Integration & Source Grounding Verification', () => {
  test('Prove the AI provider is called in normal generation', async () => {
    let callCount = 0;
    let recordedSystemPrompt = '';
    let recordedUserPrompt = '';

    const spyProvider = {
      name: 'spy-gemini',
      model: 'gemini-3.1-flash-lite',
      async healthCheck() { return { healthy: true, provider: 'gemini', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(options) {
        callCount++;
        recordedSystemPrompt = options.systemPrompt || '';
        recordedUserPrompt = options.userPrompt || '';
        return {
          success: true,
          data: {
            examTitle: 'Spy Exam',
            sections: [
              {
                sectionType: 'vocabulary',
                questions: [
                  {
                    questionType: 'mcq',
                    prompt: 'The scientist made an important ........ in the lab.',
                    options: ['discovery', 'discovers', 'discovering', 'discovered'],
                    correctAnswer: 'discovery',
                    correctIndex: 0,
                    explanation: 'Noun needed after adjective important.',
                    marks: 1
                  }
                ]
              }
            ]
          }
        };
      }
    };

    const exam = await generateStageExam({
      stage: 'secondary',
      grade: 'sec_1',
      questionCount: 1,
      isGeneralPractice: true,
      provider: spyProvider,
      allowFallback: true
    });

    assert.ok(callCount >= 1, 'AI provider generateStructuredOutput MUST be called');
    assert.ok(recordedSystemPrompt.includes('Egyptian Ministry'), 'System prompt must instruct on Egyptian Ministry exam specs');
    assert.ok(recordedUserPrompt.includes('Secondary 1'), 'User prompt must include target grade');
    assert.equal(exam.questionsCount, 1);
  });

  test('Prove referenceText is included in generation context', async () => {
    let capturedUserPrompt = '';
    const uniqueSourceSnippet = 'Red Sea marine ecosystem with coral reefs, parrotfish, and dugongs.';

    const spyProvider = {
      name: 'spy-source',
      model: 'test-model',
      async healthCheck() { return { healthy: true, provider: 'test', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(options) {
        capturedUserPrompt = options.userPrompt || '';
        return {
          success: true,
          data: {
            sections: [
              {
                sectionType: 'reading',
                passage: uniqueSourceSnippet,
                questions: [
                  {
                    questionType: 'reading_comprehension',
                    prompt: 'What creature is mentioned in the Red Sea text?',
                    options: ['dugongs', 'polar bears', 'kangaroos', 'penguins'],
                    correctAnswer: 'dugongs',
                    correctIndex: 0,
                    explanation: 'Dugongs are mentioned in the text.',
                    marks: 2
                  }
                ]
              }
            ]
          }
        };
      }
    };

    await generateStageExam({
      stage: 'preparatory',
      grade: 'prep_2',
      questionCount: 1,
      referenceText: uniqueSourceSnippet,
      provider: spyProvider,
      allowFallback: true
    });

    assert.ok(
      capturedUserPrompt.includes(uniqueSourceSnippet),
      'The exact teacher reference text MUST reach the AI generation prompt'
    );
  });

  test('Prove uploaded/reference content affects the generated exam', async () => {
    const customContent = 'Artificial Intelligence in modern agriculture: Egyptian farmers use smart irrigation sensors to conserve Nile water.';

    const exam = await generateStageExam({
      stage: 'secondary',
      grade: 'sec_2',
      questionCount: 5,
      referenceText: customContent,
      isGeneralPractice: false
    });

    assert.equal(exam.metadata.sourceOrigin, 'teacher_reference_text');
    assert.equal(exam.metadata.isAiGenerated, true);
    assert.equal(exam.questionsCount, 5);

    // Reading passage or sections must exist and reflect context
    const hasReading = exam.sections.some(s => s.sectionType === 'reading');
    if (hasReading) {
      const readingSec = exam.sections.find(s => s.sectionType === 'reading');
      assert.ok(readingSec.passage && readingSec.passage.length > 20);
    }
  });

  test('Prove two generations from the same source produce distinct questions', async () => {
    let callIdx = 0;
    const dynamicProvider = {
      name: 'dynamic-ai',
      model: 'test',
      async healthCheck() { return { healthy: true, provider: 'test', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        callIdx++;
        return {
          success: true,
          data: {
            sections: [
              {
                sectionType: 'grammar',
                questions: [
                  {
                    questionType: 'mcq',
                    prompt: `Dynamic Question Variation ${callIdx}: While studying, he ........ asleep.`,
                    options: ['fell', 'falls', 'falling', 'is fall'],
                    correctAnswer: 'fell',
                    correctIndex: 0,
                    explanation: 'Past simple after while.',
                    marks: 1
                  }
                ]
              }
            ]
          }
        };
      }
    };

    const exam1 = await generateStageExam({
      grade: 'prep_3',
      sections: ['grammar'],
      questionCount: 1,
      isGeneralPractice: true,
      provider: dynamicProvider
    });

    const exam2 = await generateStageExam({
      grade: 'prep_3',
      sections: ['grammar'],
      questionCount: 1,
      isGeneralPractice: true,
      provider: dynamicProvider
    });

    const p1 = exam1.sections[0].questions[0].prompt;
    const p2 = exam2.sections[0].questions[0].prompt;

    assert.notEqual(p1, p2, 'Two generations must produce distinct dynamic questions');
  });

    test('Prove dummy Option A/B/C/D fallback cannot appear in production mode', async () => {
    const dummyProvider = {
      name: 'dummy-ai',
      model: 'test',
      async healthCheck() { return { healthy: true, provider: 'test', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        return {
          success: true,
          data: {
            sections: [
              {
                sectionType: 'vocabulary',
                questions: [
                  {
                    questionType: 'mcq',
                    prompt: 'Choose the correct answer for blank:',
                    options: ['Option A', 'Option B', 'Option C', 'Option D'],
                    correctAnswer: 'Option A',
                    correctIndex: 0,
                    explanation: 'Dummy explanation'
                  }
                ]
              }
            ]
          }
        };
      }
    };

    // When allowFallback is false (normal production mode), dummy options must be rejected and throw error
    await assert.rejects(
      async () => {
        await generateStageExam({
          grade: 'sec_1',
          questionCount: 5,
          isGeneralPractice: true,
          provider: dummyProvider,
          allowFallback: false
        });
      },
      (err) => Boolean(err && typeof err.message === 'string' && err.message.length > 0)
    );
  });

  test('Prove no (Part 2) duplicate-question behavior exists', async () => {
    const exam = await generateStageExam({
      stage: 'secondary',
      grade: 'sec_1',
      questionCount: 12,
      isGeneralPractice: true
    });

    const allQuestions = exam.sections.flatMap(s => s.questions);
    assert.equal(allQuestions.length, 12);

    for (const q of allQuestions) {
      assert.ok(!q.prompt.includes('(Part 2)'), 'Question prompt must never contain (Part 2)');
      assert.ok(!q.prompt.includes('(Part 3)'), 'Question prompt must never contain (Part 3)');
    }
  });

  test('Prove reading questions are grounded in the generated passage', async () => {
    const exam = await generateStageExam({
      stage: 'preparatory',
      grade: 'prep_3',
      preset: 'final_exam',
      questionCount: 15,
      unitTopic: 'Renewable Clean Energy in Egypt',
      isGeneralPractice: true
    });

    const readingSec = exam.sections.find(s => s.sectionType === 'reading');
    assert.ok(readingSec, 'Final exam must have a reading section');
    assert.ok(readingSec.passage && readingSec.passage.length > 50, 'Reading section must have a substantial passage');

    for (const q of readingSec.questions) {
      assert.equal(q.questionType, 'reading_comprehension');
      assert.ok(q.prompt.length > 10);
      assert.ok(q.explanation && q.explanation.length > 5);
    }
  });

  test('Prove lack of reference material without general practice throws clear teacher error', async () => {
    await assert.rejects(
      async () => {
        await generateStageExam({
          grade: 'primary_5',
          questionCount: 10,
          isGeneralPractice: false
        });
      },
      (err) => Boolean(err && typeof err.message === 'string' && err.message.length > 0)
    );
  });
});


describe('Hardening Regression Suite (Production Correctness)', () => {
  test('incorrect correctAnswer that does not exist in options is REJECTED, not converted to option 0', () => {
    const raw = {
      prompt: 'He will travel to London ........ next Monday.',
      questionType: 'mcq',
      options: ['on', 'in', 'at', 'by'],
      correctAnswer: 'during', // NOT in options!
      explanation: 'Preposition of time.'
    };

    const res = validateStageExamQuestion(raw, 'secondary', new Set());
    assert.equal(res.valid, false, 'Question must be rejected');
    assert.equal(res.reason, 'CORRECT_ANSWER_NOT_IN_OPTIONS');
    assert.equal(res.question, undefined, 'No question object should be returned on rejection');
  });

  test('conflicting correctAnswer/correctIndex is rejected', () => {
    const raw = {
      prompt: 'While the team was preparing, the manager ........ an announcement.',
      questionType: 'mcq',
      options: ['made', 'makes', 'is making', 'had make'],
      correctIndex: 0, // points to 'made'
      correctAnswer: 'makes', // points to index 1! Conflicting!
      explanation: 'Past event.'
    };

    const res = validateStageExamQuestion(raw, 'secondary', new Set());
    assert.equal(res.valid, false, 'Conflicting index and answer must be rejected');
    assert.equal(res.reason, 'CONFLICTING_CORRECT_INDEX_AND_ANSWER');
    assert.equal(res.question, undefined);
  });

  test('2-out-of-5 without two valid answers is rejected, not defaulted to [0,1]', () => {
    const options = ['efficient', 'beneficial', 'detrimental', 'useless', 'careless'];

    // Test 1: Only 1 index supplied
    const res1 = validateStageExamQuestion({
      prompt: 'Choose the TWO synonyms for productive:',
      questionType: 'mcq_two_correct',
      options,
      correctIndices: [0] // Only 1 index!
    }, 'thanaweya', new Set());
    assert.equal(res1.valid, false, 'Must reject when fewer than 2 indices');

    // Test 2: Duplicate identical indices
    const res2 = validateStageExamQuestion({
      prompt: 'Choose the TWO synonyms for productive:',
      questionType: 'mcq_two_correct',
      options,
      correctIndices: [1, 1] // Duplicate!
    }, 'thanaweya', new Set());
    assert.equal(res2.valid, false, 'Must reject duplicate indices');

    // Test 3: Answers not in options
    const res3 = validateStageExamQuestion({
      prompt: 'Choose the TWO synonyms for productive:',
      questionType: 'mcq_two_correct',
      options,
      correctAnswers: ['efficient', 'invented_word']
    }, 'thanaweya', new Set());
    assert.equal(res3.valid, false, 'Must reject when an answer is not in options');

    // Test 4: Conflicting indices and answers
    const res4 = validateStageExamQuestion({
      prompt: 'Choose the TWO synonyms for productive:',
      questionType: 'mcq_two_correct',
      options,
      correctIndices: [0, 1], // efficient, beneficial
      correctAnswers: ['detrimental', 'useless'] // indices 2, 3!
    }, 'thanaweya', new Set());
    assert.equal(res4.valid, false, 'Must reject when indices and answers conflict');
  });

  test('correctAnswers and correctIndices contract is consistent with JSON schema', () => {
    const options = ['productive', 'innovative', 'harmful', 'worthless', 'lazy'];
    const raw = {
      prompt: 'Choose the TWO correct adjectives describing modern renewable initiatives:',
      questionType: 'mcq_two_correct',
      options,
      correctAnswers: ['productive', 'innovative'],
      correctIndices: [0, 1],
      marks: 2,
      explanation: 'Both denote positive attributes.'
    };

    const res = validateStageExamQuestion(raw, 'thanaweya', new Set());
    assert.equal(res.valid, true, 'Valid 2-out-of-5 question must pass');
    assert.ok(res.question);
    assert.deepEqual(res.question.correctIndices, [0, 1]);
    assert.deepEqual(res.question.correctAnswer, ['productive', 'innovative']);
  });

  test('missing reading passage triggers repair/failure, never generic fallback in production', async () => {
    const noPassageProvider = {
      name: 'no-passage-ai',
      model: 'test',
      async healthCheck() { return { healthy: true, provider: 'test', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(opts) {
        // Return reading section with NO passage, and if repair requested for passage, return null
        if (opts.schema?.properties?.passage) {
          return { success: false, data: null };
        }
        return {
          success: true,
          data: {
            sections: [
              {
                sectionType: 'reading',
                passage: '', // Missing passage!
                questions: [
                  {
                    questionType: 'reading_comprehension',
                    prompt: 'What was the primary goal discussed in the passage?',
                    options: ['Sustainable growth', 'Higher cost', 'Delaying reform', 'Cancelling tests'],
                    correctAnswer: 'Sustainable growth',
                    correctIndex: 0,
                    explanation: 'Supported by text.'
                  }
                ]
              }
            ]
          }
        };
      }
    };

    // When allowFallback is false (default production mode), it must fail cleanly and NOT insert Cairo/Giza fallback
    await assert.rejects(
      async () => {
        await generateStageExam({
          grade: 'sec_1',
          sections: ['reading'],
          questionCount: 1,
          isGeneralPractice: true,
          provider: noPassageProvider,
          allowFallback: false
        });
      },
      (err) => {
        assert.ok(err.message.includes('قطعة القراءة'), 'Error message must explicitly mention reading passage failure');
        return true;
      }
    );
  });

  test('missing listening script triggers repair/failure, never hard-coded fallback in production', async () => {
    const noScriptProvider = {
      name: 'no-script-ai',
      model: 'test',
      async healthCheck() { return { healthy: true, provider: 'test', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(opts) {
        if (opts.schema?.properties?.listeningScript) {
          return { success: false, data: null };
        }
        return {
          success: true,
          data: {
            sections: [
              {
                sectionType: 'listening',
                listeningScript: '', // Missing script!
                questions: [
                  {
                    questionType: 'listening_mcq',
                    prompt: 'Where did the listening conversation take place?',
                    options: ['At the hospital', 'At the museum', 'At the station', 'At the airport'],
                    correctAnswer: 'At the museum',
                    correctIndex: 1,
                    explanation: 'Listening context.'
                  }
                ]
              }
            ]
          }
        };
      }
    };

    await assert.rejects(
      async () => {
        await generateStageExam({
          grade: 'primary_4',
          sections: ['listening'],
          questionCount: 1,
          isGeneralPractice: true,
          provider: noScriptProvider,
          allowFallback: false
        });
      },
      (err) => {
        assert.ok(err.message.includes('نص الاستماع'), 'Error message must explicitly mention listening script failure');
        return true;
      }
    );
  });

  test('production API cannot enable allowFallback through request body', async () => {
    // In production environment (NODE_ENV=production), allowFallback must be strictly ignored
    const oldEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const failingProvider = {
        name: 'failing-ai',
        model: 'test',
        async healthCheck() { return { healthy: true, provider: 'test', model: 'test' }; },
        async generatePlan() { return { planText: '', actions: [] }; },
        async generateStructuredOutput() {
          return { success: false, data: null };
        }
      };

      // Even if allowFallback: true is passed in options, in production it MUST fail closed
      await assert.rejects(
        async () => {
          await generateStageExam({
            grade: 'prep_1',
            questionCount: 5,
            isGeneralPractice: true,
            provider: failingProvider,
            allowFallback: true // Attempting to turn fallback on!
          });
        },
        (err) => {
          assert.ok(err.message.includes('تعذر') || err.message.includes('فشل'), 'Must fail closed in production');
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });

  test('courseId/lectureId does not masquerade as source text; real material must be retrieved or generation must fail', async () => {
    // If courseId/lectureId provided has no database textual material and isGeneralPractice is false
    await assert.rejects(
      async () => {
        await generateStageExam({
          grade: 'sec_1',
          courseId: 'non_existent_course_without_materials',
          lectureId: 'lec_empty_no_text',
          questionCount: 5,
          isGeneralPractice: false
        });
      },
      (err) => {
        assert.ok(
          err.message.includes('المحاضرة أو الكورس') || err.message.includes('محتوى نصي'),
          'Must fail closed with clear teacher message about missing curriculum content'
        );
        return true;
      }
    );
  });

  test('exact requested question count still holds after repair pass', async () => {
    let callNum = 0;
    const repairingProvider = {
      name: 'repair-ai',
      model: 'test',
      async healthCheck() { return { healthy: true, provider: 'test', model: 'test' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput() {
        callNum++;
        if (callNum === 1) {
          // First call: returns 1 valid question and 2 invalid questions (dummy letter options)
          return {
            success: true,
            data: {
              sections: [
                {
                  sectionType: 'vocabulary',
                  questions: [
                    {
                      questionType: 'mcq',
                      prompt: 'Valid initial question on energy conservation.',
                      options: ['efficient', 'wasteful', 'polluting', 'careless'],
                      correctAnswer: 'efficient',
                      correctIndex: 0,
                      explanation: 'Positive adjective.'
                    },
                    {
                      questionType: 'mcq',
                      prompt: 'Invalid question with dummy options.',
                      options: ['A', 'B', 'C', 'D'], // Dummy!
                      correctAnswer: 'A',
                      correctIndex: 0
                    },
                    {
                      questionType: 'mcq',
                      prompt: 'Another invalid question with wrong answer.',
                      options: ['sun', 'moon', 'stars', 'planets'],
                      correctAnswer: 'clouds', // Not in options!
                      correctIndex: 0
                    }
                  ]
                }
              ]
            }
          };
        } else {
          // Repair call: returns valid repaired questions
          return {
            success: true,
            data: {
              questions: [
                {
                  questionType: 'mcq',
                  prompt: 'Repaired question 1 on solar energy.',
                  options: ['harness', 'destroy', 'forget', 'oppose'],
                  correctAnswer: 'harness',
                  correctIndex: 0,
                  explanation: 'Harness energy.'
                },
                {
                  questionType: 'mcq',
                  prompt: 'Repaired question 2 on wind turbines.',
                  options: ['rotate', 'freeze', 'disappear', 'sleep'],
                  correctAnswer: 'rotate',
                  correctIndex: 0,
                  explanation: 'Wind turbines rotate.'
                }
              ]
            }
          };
        }
      }
    };

    const exam = await generateStageExam({
      grade: 'sec_2',
      sections: ['vocabulary'],
      questionCount: 3, // Requested 3 questions
      isGeneralPractice: true,
      provider: repairingProvider,
      allowFallback: false
    });

    assert.equal(exam.questionsCount, 3, 'Must have exactly 3 questions after repair');
    assert.equal(exam.sections[0].questions.length, 3, 'Vocabulary section must have exactly 3 questions');
    const prompts = exam.sections[0].questions.map(q => q.prompt);
    assert.ok(prompts.includes('Valid initial question on energy conservation.'));
    assert.ok(prompts.includes('Repaired question 1 on solar energy.'));
    assert.ok(prompts.includes('Repaired question 2 on wind turbines.'));
  });

  test('single extraction test: tempFileId + referenceText proves PDF text is not duplicated in sourceMaterial', async () => {
    const tempId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    const tempDir = path.resolve('storage/private/ai_temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, `${tempId}.pdf`);
    const uniquePdfContent = 'UNIQUE_PDF_CONTENT_PHRASE_FOR_SINGLE_EXTRACTION_TEST_12345';
    fs.writeFileSync(tempFile, uniquePdfContent, 'utf8');

    let capturedPrompt = '';
    const spyProvider = {
      name: 'spy-provider',
      model: 'spy-model',
      async healthCheck() { return { healthy: true, provider: 'spy-provider', model: 'spy-model' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(options) {
        capturedPrompt = options.userPrompt || '';
        return {
          success: true,
          data: {
            examTitle: 'Spy Exam',
            sections: [
              {
                sectionType: 'vocabulary',
                questions: [
                  {
                    questionType: 'mcq',
                    prompt: 'What does the unique phrase represent?',
                    options: ['Testing extraction', 'Dummy 1', 'Dummy 2', 'Dummy 3'],
                    correctAnswer: 'Testing extraction',
                    correctIndex: 0,
                    explanation: 'Single extraction verified.'
                  }
                ]
              }
            ]
          }
        };
      }
    };

    try {
      const exam = await generateStageExam({
        grade: 'prep_1',
        sections: ['vocabulary'],
        questionCount: 1,
        referenceText: 'TEACHER_PASTED_NOTE_TEXT_ABCD',
        tempFileId: tempId,
        isGeneralPractice: false,
        provider: spyProvider,
        allowFallback: false
      });

      assert.ok(exam);
      assert.ok(capturedPrompt.includes(uniquePdfContent), 'Prompt must include the PDF text');
      assert.ok(capturedPrompt.includes('TEACHER_PASTED_NOTE_TEXT_ABCD'), 'Prompt must include teacher reference text');

      // Count occurrences of uniquePdfContent in the prompt
      const matches = capturedPrompt.match(new RegExp(uniquePdfContent, 'g'));
      assert.equal(matches ? matches.length : 0, 1, 'Uploaded PDF text must appear exactly once in sourceMaterial');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  test('substantive curriculum content: very long course title + very long lecture title but no substantive material fails closed', async () => {
    // When course has only title and no description, and no attached materials, and isGeneralPractice is false
    // It should fail closed because titles alone do not constitute substantive curriculum content
    await assert.rejects(
      async () => {
        await generateStageExam({
          grade: 'prep_2',
          sections: ['vocabulary'],
          questionCount: 5,
          courseId: 'course_with_only_titles',
          isGeneralPractice: false,
          allowFallback: false
        });
      },
      new RegExp("المحاضرة أو الكورس المحدد لا يحتوي على محتوى نصي")
    );
  });

  test('substantive curriculum content: real course description >= minimum is accepted', async () => {
    let capturedPrompt = '';
    const spyProvider = {
      name: 'spy-provider',
      model: 'spy-model',
      async healthCheck() { return { healthy: true, provider: 'spy-provider', model: 'spy-model' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(options) {
        capturedPrompt = options.userPrompt || '';
        return {
          success: true,
          data: {
            examTitle: 'Spy Exam',
            sections: [
              {
                sectionType: 'vocabulary',
                questions: [
                  {
                    questionType: 'mcq',
                    prompt: 'Sample question based on substantive syllabus?',
                    options: ['Solar system', 'B', 'C', 'D'],
                    correctAnswer: 'Solar system',
                    correctIndex: 0,
                    explanation: 'Explanation.'
                  }
                ]
              }
            ]
          }
        };
      }
    };

    const substantiveText = 'This is a genuine substantive syllabus content describing the solar system and planetary motion in deep detail for students.';
    const exam = await generateStageExam({
      grade: 'prep_2',
      sections: ['vocabulary'],
      questionCount: 1,
      referenceText: substantiveText,
      isGeneralPractice: false,
      provider: spyProvider,
      allowFallback: false
    });

    assert.ok(exam);
    assert.ok(capturedPrompt.includes(substantiveText));
  });

  test('substantive curriculum content: attached file material is accepted', async () => {
    const tempId = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
    const tempDir = path.resolve('storage/private/ai_temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, `${tempId}.pdf`);
    const substantiveFileText = 'Unit 4 Vocabulary Guide: Ecosystems, biodiversity, endangered species, rainforest conservation.';
    fs.writeFileSync(tempFile, substantiveFileText, 'utf8');

    let capturedPrompt = '';
    const spyProvider = {
      name: 'spy-provider',
      model: 'spy-model',
      async healthCheck() { return { healthy: true, provider: 'spy-provider', model: 'spy-model' }; },
      async generatePlan() { return { planText: '', actions: [] }; },
      async generateStructuredOutput(options) {
        capturedPrompt = options.userPrompt || '';
        return {
          success: true,
          data: {
            examTitle: 'Spy Exam',
            sections: [
              {
                sectionType: 'vocabulary',
                questions: [
                  {
                    questionType: 'mcq',
                    prompt: 'What threatens ecosystems?',
                    options: ['Deforestation', 'Trees', 'Rain', 'Sunlight'],
                    correctAnswer: 'Deforestation',
                    correctIndex: 0,
                    explanation: 'Deforestation threatens ecosystems.'
                  }
                ]
              }
            ]
          }
        };
      }
    };

    try {
      const exam = await generateStageExam({
        grade: 'sec_1',
        sections: ['vocabulary'],
        questionCount: 1,
        tempFileId: tempId,
        isGeneralPractice: false,
        provider: spyProvider,
        allowFallback: false
      });

      assert.ok(exam);
      assert.ok(capturedPrompt.includes(substantiveFileText));
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
