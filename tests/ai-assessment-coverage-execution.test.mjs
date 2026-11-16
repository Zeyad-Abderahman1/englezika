import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { getToolDefinition } from '../app/lib/ai/tool-registry.ts';
import { executeTool, validateToolArguments, ToolExecutionError } from '../app/lib/ai/tool-executor.ts';
import { createConfirmationRequest, verifyAndExecuteConfirmation } from '../app/lib/ai/confirmation.server.ts';

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

const teacher = {
  email: 'teacher@englizeka.com',
  name: 'Teacher Ahmed',
  role: 'teacher',
  permissions: ['manage_courses', 'manage_exams'],
};

const validQuestions = [
  {
    prompt: 'What is the past tense of go?',
    options: ['went', 'gone', 'going', 'goes'],
    correctAnswer: 'went',
  },
];

class MockAssessmentExecutionDb {
  constructor() {
    this.confirmations = new Map();
    this.logs = [];
    this.courses = new Map([
      ['course-101', { id: 'course-101', title: 'English 101' }],
    ]);
    this.videos = new Map([
      ['lec-1', { id: 'lec-1', course_id: 'course-101', title: 'Lecture 1' }],
      ['lec-2', { id: 'lec-2', course_id: 'course-101', title: 'Lecture 2' }],
      ['lec-foreign', { id: 'lec-foreign', course_id: 'course-999', title: 'Foreign Lecture' }],
    ]);
    this.exams = new Map();
    this.questions = new Map();
  }

  prepare(sql) {
    const db = this;
    const makeStatement = (boundArgs = []) => ({
      bind(...args) {
        return makeStatement(args);
      },
      async first() {
        if (sql.includes('information_schema.columns') && sql.includes('coverage_start_lecture_id')) {
          return { 1: 1 };
        }
        if (sql.includes('FROM courses WHERE id = ?')) {
          return db.courses.get(boundArgs[0]) ?? null;
        }
        if (sql.includes('FROM videos WHERE id = ? AND course_id = ?')) {
          const [vidId, courseId] = boundArgs;
          const v = db.videos.get(vidId);
          return (v && v.course_id === courseId) ? v : null;
        }
        if (sql.includes('FROM ai_confirmations WHERE id = ?')) {
          return db.confirmations.get(boundArgs[0]) ?? null;
        }
        return null;
      },
      async all() {
        return { results: [], success: true, meta: { changes: 0 } };
      },
      async run() {
        if (sql.includes('INSERT INTO exams')) {
          const [
            id, courseId, title, description, instructions, durationMinutes,
            passingScore, maxAttempts, status, opensAt, closesAt, createdBy,
            createdAt, updatedAt, assessmentType, mode, coverageStartLectureId, coverageEndLectureId
          ] = boundArgs;
          db.exams.set(id, {
            id,
            course_id: courseId,
            title,
            duration_minutes: durationMinutes,
            passing_score: passingScore,
            status,
            assessment_type: assessmentType,
            coverage_start_lecture_id: coverageStartLectureId,
            coverage_end_lecture_id: coverageEndLectureId,
          });
          return { results: [], success: true, meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO questions')) {
          const [id, examId, type, prompt, optionsJson, correctAnswer, explanation, points, sortOrder] = boundArgs;
          db.questions.set(id, { id, exam_id: examId, prompt, optionsJson, correctAnswer, explanation, points, sortOrder });
          return { results: [], success: true, meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO ai_confirmations')) {
          const [id, tokenHash, email, actionType, payload, createdAt, expiresAt] = boundArgs;
          db.confirmations.set(id, {
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
        if (sql.includes("UPDATE ai_confirmations SET state = 'executing'")) {
          const [executionId, executedAt, id] = boundArgs;
          const rec = db.confirmations.get(id);
          if (rec) Object.assign(rec, { state: 'executing', execution_id: executionId, executed_at: executedAt });
          return { results: [], success: true, meta: { changes: 1 } };
        }
        if (sql.includes("UPDATE ai_confirmations SET state = 'succeeded'")) {
          const [resultJson, executedAt, id] = boundArgs;
          const rec = db.confirmations.get(id);
          if (rec) Object.assign(rec, { state: 'succeeded', result_json: resultJson, executed_at: executedAt });
          return { results: [], success: true, meta: { changes: 1 } };
        }
        if (sql.includes("UPDATE ai_confirmations SET state = 'failed'")) {
          const [errorMessage, id] = boundArgs;
          const rec = db.confirmations.get(id);
          if (rec) Object.assign(rec, { state: 'failed', error_message: errorMessage });
          return { results: [], success: true, meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO ai_action_logs')) {
          db.logs.push(boundArgs);
          return { results: [], success: true, meta: { changes: 1 } };
        }
        return { results: [], success: true, meta: { changes: 0 } };
      },
    });
    return makeStatement();
  }

  async withTransaction(callback) {
    return callback(this);
  }

  async batch(statements) {
    for (const stmt of statements) {
      await stmt.run();
    }
    return [];
  }
}

describe('Bug 1 — Assessment Coverage Keys Execution & Persistence', () => {
  test('1. validateToolArguments accepts valid coverageStartLectureId and coverageEndLectureId for create_quiz', () => {
    const tool = getToolDefinition('create_quiz');
    assert.ok(tool, 'create_quiz must exist');

    const args = {
      courseId: 'course-101',
      title: 'Grammar Quiz 1',
      questions: validQuestions,
      durationMinutes: 15,
      passingScore: 60,
      coverageStartLectureId: 'lec-1',
      coverageEndLectureId: 'lec-2',
    };

    // This throws before the fix with: Unrecognized parameter 'coverageStartLectureId' for tool 'create_quiz'
    validateToolArguments(tool, args);
  });

  test('2. validateToolArguments accepts valid coverageStartLectureId and coverageEndLectureId for create_exam', () => {
    const tool = getToolDefinition('create_exam');
    assert.ok(tool, 'create_exam must exist');

    const args = {
      courseId: 'course-101',
      title: 'Midterm Exam',
      questions: validQuestions,
      durationMinutes: 60,
      passingScore: 70,
      coverageStartLectureId: 'lec-1',
      coverageEndLectureId: 'lec-2',
    };

    validateToolArguments(tool, args);
  });

  test('3. Malformed / unrecognized OTHER parameters remain rejected for create_quiz and create_exam', () => {
    const quizTool = getToolDefinition('create_quiz');
    const examTool = getToolDefinition('create_exam');

    assert.throws(
      () => validateToolArguments(quizTool, {
        courseId: 'course-101',
        title: 'Quiz',
        questions: validQuestions,
        unexpectedKey: 'hack',
      }),
      (err) => err instanceof ToolExecutionError && err.message.includes("Unrecognized parameter 'unexpectedKey' for tool 'create_quiz'")
    );

    assert.throws(
      () => validateToolArguments(examTool, {
        courseId: 'course-101',
        title: 'Exam',
        questions: validQuestions,
        anotherBogusKey: 123,
      }),
      (err) => err instanceof ToolExecutionError && err.message.includes("Unrecognized parameter 'anotherBogusKey' for tool 'create_exam'")
    );
  });

  test('4. coverageStartLectureId and coverageEndLectureId are optional strings', () => {
    const tool = getToolDefinition('create_quiz');
    assert.equal(tool.allowedKeys.coverageStartLectureId?.required, false);
    assert.equal(tool.allowedKeys.coverageEndLectureId?.required, false);

    // Omission is completely valid
    assert.doesNotThrow(() => {
      validateToolArguments(tool, {
        courseId: 'course-101',
        title: 'Quiz without coverage',
        questions: validQuestions,
      });
    });
  });

  test('5. executeTool creates quiz with coverage IDs and persists them in DB', async () => {
    const db = new MockAssessmentExecutionDb();

    const result = await executeTool({
      toolName: 'create_quiz',
      args: {
        courseId: 'course-101',
        title: 'Unit 1 Quiz',
        questions: validQuestions,
        durationMinutes: 15,
        passingScore: 50,
        coverageStartLectureId: 'lec-1',
        coverageEndLectureId: 'lec-2',
      },
      actor: teacher,
      context: { db, confirmationSatisfied: true },
    });

    assert.ok(result.result?.quiz);
    const createdExam = [...db.exams.values()][0];
    assert.ok(createdExam);
    assert.equal(createdExam.coverage_start_lecture_id, 'lec-1');
    assert.equal(createdExam.coverage_end_lecture_id, 'lec-2');
    assert.equal(createdExam.status, 'draft');
    assert.equal(createdExam.assessment_type, 'quiz');
  });

  test('6. executeTool creates exam with coverage IDs and persists them in DB', async () => {
    const db = new MockAssessmentExecutionDb();

    const result = await executeTool({
      toolName: 'create_exam',
      args: {
        courseId: 'course-101',
        title: 'Final Exam',
        questions: validQuestions,
        durationMinutes: 90,
        passingScore: 60,
        coverageStartLectureId: 'lec-1',
        coverageEndLectureId: 'lec-2',
      },
      actor: teacher,
      context: { db, confirmationSatisfied: true },
    });

    assert.ok(result.result?.exam);
    const createdExam = [...db.exams.values()][0];
    assert.ok(createdExam);
    assert.equal(createdExam.coverage_start_lecture_id, 'lec-1');
    assert.equal(createdExam.coverage_end_lecture_id, 'lec-2');
    assert.equal(createdExam.status, 'draft');
    assert.equal(createdExam.assessment_type, 'exam');
  });

  test('7. Server-side coverage validation rejects lectures from a different course', async () => {
    const db = new MockAssessmentExecutionDb();

    await assert.rejects(
      () => executeTool({
        toolName: 'create_quiz',
        args: {
          courseId: 'course-101',
          title: 'Quiz with bad coverage',
          questions: validQuestions,
          coverageStartLectureId: 'lec-foreign',
          coverageEndLectureId: 'lec-2',
        },
        actor: teacher,
        context: { db, confirmationSatisfied: true },
      }),
      /محاضرة البداية المحددة غير تابعة للكورس المحدد/
    );
  });

  test('8. Compound plan confirmation execution with assessment coverage succeeds', async () => {
    const db = new MockAssessmentExecutionDb();

    const actionPayload = {
      steps: [
        {
          tool: 'create_quiz',
          parameters: {
            courseId: 'course-101',
            title: 'Compound PDF Quiz',
            questions: validQuestions,
            durationMinutes: 20,
            passingScore: 70,
            coverageStartLectureId: 'lec-1',
            coverageEndLectureId: 'lec-2',
          },
        },
      ],
    };

    const confirmation = await createConfirmationRequest({
      actor: teacher,
      actionType: 'compound_plan',
      actionPayload,
      secret: SECRET,
      db,
    });

    const executionResult = await verifyAndExecuteConfirmation({
      token: confirmation.token,
      actor: teacher,
      secret: SECRET,
      db,
      executor: async (actionType, payload, txDb) => {
        const steps = payload.steps || [];
        const stepResults = [];
        for (const step of steps) {
          const res = await executeTool({
            toolName: step.tool,
            args: step.parameters,
            actor: teacher,
            context: { db: txDb, confirmationSatisfied: true },
          });
          stepResults.push({ tool: step.tool, result: res });
        }
        return { success: true, count: stepResults.length, steps: stepResults };
      },
    });

    assert.equal(executionResult.success, true);
    const confirmationRecord = db.confirmations.get(confirmation.tokenId);
    assert.equal(confirmationRecord.state, 'succeeded');

    const createdExam = [...db.exams.values()][0];
    assert.ok(createdExam);
    assert.equal(createdExam.coverage_start_lecture_id, 'lec-1');
    assert.equal(createdExam.coverage_end_lecture_id, 'lec-2');
  });
});
