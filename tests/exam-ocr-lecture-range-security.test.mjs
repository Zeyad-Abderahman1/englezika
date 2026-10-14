import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class MockExamPlacementDatabase {
  exams = new Map();
  questions = new Map();
  videos = new Map([
    [
      'video-1',
      {
        id: 'video-1',
        courseId: 'course-1',
        title: 'Lecture 1 - Grammar Introduction',
        status: 'published',
        durationSeconds: 600,
        prerequisiteExamId: null,
        minimumScore: 0,
      },
    ],
    [
      'video-2',
      {
        id: 'video-2',
        courseId: 'course-1',
        title: 'Lecture 2 - Advanced Tenses',
        status: 'published',
        durationSeconds: 900,
        prerequisiteExamId: null,
        minimumScore: 0,
      },
    ],
  ]);
  studentBestScore = 0;

  prepare(sql) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    return new (class {
      bindings = [];

      bind(...bindings) {
        this.bindings = bindings;
        return this;
      }

      async first() {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('SELECT id FROM exams WHERE id = ?')) {
          const exam = db.exams.get(this.bindings[0]);
          if (normalized.includes("status = 'published'")) {
            return exam && exam.status === 'published' ? { id: exam.id } : null;
          }
          return exam ? { id: exam.id } : null;
        }
        if (normalized.startsWith('SELECT id FROM courses')) {
          return { id: this.bindings[0] };
        }
        if (normalized.startsWith('SELECT id FROM videos WHERE id = ? AND course_id = ?')) {
          const video = db.videos.get(this.bindings[0]);
          return video && video.courseId === this.bindings[1] ? { id: video.id } : null;
        }
        if (normalized.startsWith('SELECT v.id, v.course_id AS courseId')) {
          const video = db.videos.get(this.bindings[2]);
          if (!video) return null;
          return {
            id: video.id,
            courseId: video.courseId,
            sourceType: 'youtube',
            youtubeId: 'mock-yt-123',
            durationSeconds: video.durationSeconds,
            title: video.title,
            prerequisiteExamId: video.prerequisiteExamId,
            minimumScore: video.minimumScore,
            hasEnrollmentAccess: 1,
            hasIndividualGrant: 0,
          };
        }
        if (normalized.startsWith('SELECT id FROM videos WHERE course_id = ?')) {
          return null; // first video in course
        }
        if (normalized.startsWith('SELECT MAX(CASE WHEN max_score > 0')) {
          return { bestPercentage: db.studentBestScore };
        }
        return null;
      }

      async all() {
        return { success: true, results: [], meta: { changes: 0 } };
      }

      async run() {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('UPDATE videos SET prerequisite_exam_id = ?, minimum_score = ? WHERE id = ?')) {
          const [examId, minScore, videoId] = this.bindings;
          const video = db.videos.get(videoId);
          if (video) {
            video.prerequisiteExamId = examId;
            video.minimumScore = Number(minScore);
          }
          return { success: true, results: [], meta: { changes: 1 } };
        }
        if (normalized.startsWith('INSERT INTO exams')) {
          const [id, courseId, title, , , duration, passingScore, maxAttempts, status, , , scopeType, fromVideoId, toVideoId] = this.bindings;
          db.exams.set(id, {
            id,
            courseId,
            title,
            duration,
            passingScore,
            maxAttempts,
            status,
            scopeType,
            fromVideoId,
            toVideoId,
          });
          return { success: true, results: [], meta: { changes: 1 } };
        }
        return { success: true, results: [], meta: { changes: 0 } };
      }
    })();
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

test('010_exam_lecture_range.sql schema migration contains required columns and constraint', async () => {
  const sql = await readFile(
    new URL('../database/migrations/010_exam_lecture_range.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /ALTER TABLE exams ADD COLUMN IF NOT EXISTS scope_type/);
  assert.match(sql, /scope_type IN \('all_lectures', 'lecture_range'\)/);
  assert.match(sql, /ALTER TABLE exams ADD COLUMN IF NOT EXISTS from_video_id/);
  assert.match(sql, /ALTER TABLE exams ADD COLUMN IF NOT EXISTS to_video_id/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS exams_lecture_range_idx/);
});

test('exam-ocr normalizer parses questions verbatim, enforces choices, and handles confidence', async () => {
  const { normalizeExtractedQuestions } = await import('../app/lib/exam-ocr.ts');

  const rawSample = [
    {
      temp_id: 'custom-1',
      prompt: 'If she ...... earlier, she would have caught the train.',
      type: 'multiple_choice',
      options: ['arrives', 'arrived', 'had arrived', 'would arrive'],
      correct_answer: 'had arrived',
      points: 2,
      ai_confidence: 'high',
      ai_explanation: 'Third conditional requires past perfect in the if-clause.',
    },
    {
      prompt: 'Water boils at 100 degrees Celsius.',
      type: 'true_false',
      correct_answer: 'True',
    },
    {
      prompt: 'Unmatched answer fallback test',
      type: 'multiple_choice',
      options: ['First', 'Second'],
      correct_answer: 'Nonexistent',
    },
  ];

  const normalized = normalizeExtractedQuestions(rawSample);
  assert.equal(normalized.length, 3);

  // Question 1
  assert.equal(normalized[0].prompt, 'If she ...... earlier, she would have caught the train.');
  assert.equal(normalized[0].correct_answer, 'had arrived');
  assert.equal(normalized[0].points, 2);
  assert.equal(normalized[0].ai_confidence, 'high');

  // Question 2 (auto-options for true_false)
  assert.equal(normalized[1].type, 'true_false');
  assert.deepEqual(normalized[1].options, ['True', 'False']);
  assert.equal(normalized[1].correct_answer, 'True');

  // Question 3 (unmatched answer leaves correct_answer empty string and confidence low)
  assert.equal(normalized[2].correct_answer, '');
  assert.equal(normalized[2].ai_confidence, 'low');

  // Verify missing API key returns explicit error without mock fallback
  const { extractAndSolveExamFromImages } = await import('../app/lib/exam-ocr.ts');
  const ocrRes = await extractAndSolveExamFromImages([{ data: 'test', mimeType: 'image/jpeg' }], '');
  assert.equal(ocrRes.ok, false);
  assert.match(ocrRes.error, /GEMINI_API_KEY/);
});

test('inter-lecture exam placement binds prerequisite to target lecture and gates video access', async () => {
  const db = new MockExamPlacementDatabase();
  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-secret-at-least-24-characters-long',
    INITIAL_STAFF_EMAIL: 'teacher@example.test',
    INITIAL_STAFF_NAME: 'Mr Ahmed Hassan',
    INITIAL_STAFF_PASSWORD_HASH: 'f'.repeat(64),
    INITIAL_STAFF_PASSWORD_SALT: 'e'.repeat(32),
    INITIAL_STAFF_PASSWORD_ITERATIONS: '100000',
  };

  const { authorizeVideoAccess } = await import('../app/lib/video-access.ts');

  // Initially video-2 has no prerequisite exam
  const initialAccess = await authorizeVideoAccess('student@example.test', 'video-2');
  assert.equal(initialAccess.ok, true);

  // Verify that an unpublished / draft exam does NOT block video access
  const draftId = 'exam-draft-test';
  db.exams.set(draftId, { id: draftId, status: 'draft' });
  db.videos.set('video-draft-gate', {
    id: 'video-draft-gate',
    courseId: 'course-1',
    durationSeconds: 120,
    title: 'Draft gated video',
    prerequisiteExamId: draftId,
    minimumScore: 80,
  });
  const draftAccess = await authorizeVideoAccess('student@example.test', 'video-draft-gate');
  assert.equal(draftAccess.ok, true);

  // Now create an inter-lecture exam placed between video-1 and video-2 with 80% passing score
  const examId = 'exam-range-1';
  const passingScore = 80;

  // Simulate statements executed in POST /api/admin/exams:
  await db.batch([
    db.prepare('INSERT INTO exams ...').bind(
      examId,
      'course-1',
      'Mid-Unit 1 Exam',
      'Description',
      'Instructions',
      30,
      passingScore,
      3,
      'published',
      null,
      null,
      'lecture_range',
      'video-1',
      'video-2'
    ),
    db.prepare('UPDATE videos SET prerequisite_exam_id = ?, minimum_score = ? WHERE id = ? AND course_id = ?').bind(
      examId,
      passingScore,
      'video-2',
      'course-1'
    ),
  ]);

  const targetVideo = db.videos.get('video-2');
  assert.equal(targetVideo.prerequisiteExamId, examId);
  assert.equal(targetVideo.minimumScore, 80);

  // Student has an attempt with 75% (< 80% passing score) -> access must be blocked
  db.studentBestScore = 75;
  const blockedAccess = await authorizeVideoAccess('student@example.test', 'video-2');
  assert.equal(blockedAccess.ok, false);
  assert.equal(blockedAccess.code, 'LESSON_QUIZ_REQUIRED');
  assert.match(blockedAccess.error, /يجب اجتياز اختبار المحاضرة بالدرجة المطلوبة/);

  // Student passes with 85% (>= 80% passing score) -> access is unlocked
  db.studentBestScore = 85;
  const grantedAccess = await authorizeVideoAccess('student@example.test', 'video-2');
  assert.equal(grantedAccess.ok, true);
  assert.equal(grantedAccess.video.id, 'video-2');
});

test('exam question validation validates multiple_choice against options, while true_false and short_answer save correctly', async () => {
  const { parseQuestion, validateQuestion } = await import('../app/lib/exam-validation.ts');

  // 1. Multiple Choice: Valid choice in options passes
  const validMcq = parseQuestion(
    {
      type: 'multiple_choice',
      prompt: 'What is the capital of England?',
      options: ['London', 'Paris', 'Berlin', 'Rome'],
      correctAnswer: 'London',
      points: 2,
    },
    1
  );
  assert.equal(validMcq.type, 'multiple_choice');
  assert.equal(validateQuestion(validMcq), null);

  // 2. Multiple Choice: Answer not in options fails validation
  const invalidMcq = parseQuestion(
    {
      type: 'multiple_choice',
      prompt: 'What is the capital of England?',
      options: ['London', 'Paris', 'Berlin', 'Rome'],
      correctAnswer: 'Madrid', // Not in options
      points: 2,
    },
    2
  );
  assert.match(validateQuestion(invalidMcq), /اختر الإجابة الصحيحة من اختيارات السؤال/);

  // 3. Multiple Choice: Fewer than 2 options fails validation
  const mcqTooFewOptions = parseQuestion(
    {
      type: 'multiple_choice',
      prompt: 'Single option test',
      options: ['OnlyOne'],
      correctAnswer: 'OnlyOne',
    },
    3
  );
  assert.match(validateQuestion(mcqTooFewOptions), /اختيارين على الأقل/);

  // 4. True / False: Saves correctly with default True/False options
  const validTf = parseQuestion(
    {
      type: 'true_false',
      prompt: 'The Pacific is the largest ocean on Earth.',
      correctAnswer: 'True',
    },
    4
  );
  assert.equal(validTf.type, 'true_false');
  assert.deepEqual(validTf.options, ['True', 'False']);
  assert.equal(validateQuestion(validTf), null);

  // 5. Short Answer: Saves correctly with empty options and open-ended text answer
  const validShortAnswer = parseQuestion(
    {
      type: 'short_answer',
      prompt: 'Name the process by which green plants make food using sunlight.',
      correctAnswer: 'Photosynthesis',
    },
    5
  );
  assert.equal(validShortAnswer.type, 'short_answer');
  assert.deepEqual(validShortAnswer.options, []);
  assert.equal(validShortAnswer.correctAnswer, 'Photosynthesis');
  assert.equal(validateQuestion(validShortAnswer), null);

  // 6. Short Answer: Missing prompt or answer fails validation
  const invalidShortAnswer = parseQuestion(
    {
      type: 'short_answer',
      prompt: 'Question without answer',
      correctAnswer: '',
    },
    6
  );
  assert.match(validateQuestion(invalidShortAnswer), /مع الإجابة الصحيحة/);
});

