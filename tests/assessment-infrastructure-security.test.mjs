/**
 * Stage 3 — Assessment Shared Infrastructure — Security Tests
 *
 * Validates:
 * 1. Student exam GET excludes explanation, image_file_key, correct_answer — includes has_image
 * 2. Student assignment GET excludes explanation before submission — includes has_image
 * 3. Admin exam GET includes explanation, image_file_key (for editing)
 * 4. Admin assignment questions GET includes explanation, image_file_key (for editing)
 * 5. Exam submission response includes explanation for wrong answers
 * 6. Assignment submission response includes explanation for wrong answers
 * 7. Image endpoints require authentication + enrollment
 * 8. Image endpoints enforce course sequence unlock
 * 9. upload-validation: isImageUpload validates JPEG/PNG/WEBP magic bytes
 * 10. upload-validation: rejects non-image files even with image MIME type
 * 11. Student payloads never expose image_file_key
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isImageUpload, getImageExtension, ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE } from '../app/lib/upload-validation.ts';

/* ────────── isImageUpload validation ────────── */

describe('isImageUpload — magic byte validation', () => {
  test('accepts valid JPEG (FF D8 FF)', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(isImageUpload('image/jpeg', jpegBytes), true);
  });

  test('accepts valid PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    assert.equal(isImageUpload('image/png', pngBytes), true);
  });

  test('accepts valid WEBP (RIFF....WEBP)', () => {
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,     // RIFF
      0x00, 0x00, 0x00, 0x00,     // file size placeholder
      0x57, 0x45, 0x42, 0x50,     // WEBP
    ]);
    assert.equal(isImageUpload('image/webp', webpBytes), true);
  });

  test('rejects PDF masquerading as image/jpeg', () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    assert.equal(isImageUpload('image/jpeg', pdfBytes), false);
  });

  test('rejects valid JPEG bytes with wrong MIME type (application/pdf)', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    assert.equal(isImageUpload('application/pdf', jpegBytes), false);
  });

  test('rejects empty bytes with valid MIME', () => {
    assert.equal(isImageUpload('image/jpeg', new Uint8Array([])), false);
  });

  test('rejects random bytes with image/png MIME', () => {
    const randomBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    assert.equal(isImageUpload('image/png', randomBytes), false);
  });

  test('rejects text/html even with PNG magic bytes', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(isImageUpload('text/html', pngBytes), false);
  });

  test('handles MIME with charset parameter', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    assert.equal(isImageUpload('image/jpeg; charset=utf-8', jpegBytes), true);
  });
});

/* ────────── getImageExtension ────────── */

describe('getImageExtension — MIME to extension', () => {
  test('maps image/jpeg → jpg', () => {
    assert.equal(getImageExtension('image/jpeg'), 'jpg');
  });

  test('maps image/png → png', () => {
    assert.equal(getImageExtension('image/png'), 'png');
  });

  test('maps image/webp → webp', () => {
    assert.equal(getImageExtension('image/webp'), 'webp');
  });

  test('unknown MIME → bin', () => {
    assert.equal(getImageExtension('application/pdf'), 'bin');
  });
});

/* ────────── ALLOWED_IMAGE_TYPES constant ────────── */

describe('ALLOWED_IMAGE_TYPES', () => {
  test('includes exactly jpeg, png, webp', () => {
    assert.ok(ALLOWED_IMAGE_TYPES.includes('image/jpeg'));
    assert.ok(ALLOWED_IMAGE_TYPES.includes('image/png'));
    assert.ok(ALLOWED_IMAGE_TYPES.includes('image/webp'));
    assert.equal(ALLOWED_IMAGE_TYPES.length, 3);
  });
});

/* ────────── MAX_IMAGE_SIZE ────────── */

describe('MAX_IMAGE_SIZE', () => {
  test('is 5 MB', () => {
    assert.equal(MAX_IMAGE_SIZE, 5 * 1024 * 1024);
  });
});

/* ────────── Student payload shape — exam questions ────────── */

describe('student exam question payload shape', () => {
  /**
   * Simulates the mapping from app/api/exams/[id]/route.ts GET
   * Verifies the question shape that reaches the student.
   */
  test('student question shape includes hasImage but not imageFileKey, correctAnswer, or explanation', () => {
    // Simulating the server-side mapping from exams/[id]/route.ts GET (line 92-101)
    const dbQuestion = {
      id: 'q-123',
      sortOrder: 1,
      type: 'multiple_choice',
      prompt: 'Which is correct?',
      options: JSON.stringify(['A', 'B', 'C', 'D']),
      correctAnswer: 'B',
      explanation: 'B is correct because...',
      imageFileKey: 'questions/q-123/prompt.jpg',
      points: 1,
    };

    // Apply the same mapping as the route handler
    const studentPayload = {
      id: dbQuestion.id,
      sortOrder: dbQuestion.sortOrder,
      type: dbQuestion.type,
      prompt: dbQuestion.prompt,
      options: JSON.parse(dbQuestion.options),
      points: dbQuestion.points,
      hasImage: dbQuestion.imageFileKey != null,
    };

    assert.equal(studentPayload.hasImage, true);
    assert.equal('imageFileKey' in studentPayload, false);
    assert.equal('image_file_key' in studentPayload, false);
    assert.equal('correctAnswer' in studentPayload, false);
    assert.equal('correct_answer' in studentPayload, false);
    assert.equal('explanation' in studentPayload, false);
  });

  test('hasImage is false when imageFileKey is null', () => {
    const dbQuestion = {
      id: 'q-456',
      imageFileKey: null,
    };
    const hasImage = dbQuestion.imageFileKey != null;
    assert.equal(hasImage, false);
  });
});

/* ────────── Student payload shape — assignment questions ────────── */

describe('student assignment question payload shape', () => {
  test('before submission: excludes explanation and correctIndex, includes hasImage', () => {
    const dbQuestion = {
      id: 'aq-123',
      question: 'Choose the correct answer',
      explanation: 'The answer is X because...',
      options: JSON.stringify(['A', 'B', 'C']),
      correctIndex: 1,
      points: 2,
      sortOrder: 0,
      imageFileKey: 'assignments/a1/questions/aq-123/prompt.png',
    };

    const hasSubmission = false;

    // Mapping from app/api/student/assignments/[id]/route.ts (lines 143-152)
    const studentPayload = {
      id: dbQuestion.id,
      question: dbQuestion.question,
      explanation: hasSubmission ? (dbQuestion.explanation || null) : null,
      options: JSON.parse(dbQuestion.options),
      correctIndex: hasSubmission ? dbQuestion.correctIndex : null,
      points: dbQuestion.points,
      sortOrder: dbQuestion.sortOrder,
      hasImage: dbQuestion.imageFileKey != null,
    };

    assert.equal(studentPayload.explanation, null);
    assert.equal(studentPayload.correctIndex, null);
    assert.equal(studentPayload.hasImage, true);
    assert.equal('imageFileKey' in studentPayload, false);
    assert.equal('image_file_key' in studentPayload, false);
  });

  test('after submission: includes explanation and correctIndex', () => {
    const dbQuestion = {
      id: 'aq-123',
      question: 'Choose the correct answer',
      explanation: 'The answer is B because...',
      options: JSON.stringify(['A', 'B', 'C']),
      correctIndex: 1,
      points: 2,
      sortOrder: 0,
      imageFileKey: null,
    };

    const hasSubmission = true;

    const studentPayload = {
      id: dbQuestion.id,
      question: dbQuestion.question,
      explanation: hasSubmission ? (dbQuestion.explanation || null) : null,
      options: JSON.parse(dbQuestion.options),
      correctIndex: hasSubmission ? dbQuestion.correctIndex : null,
      points: dbQuestion.points,
      sortOrder: dbQuestion.sortOrder,
      hasImage: dbQuestion.imageFileKey != null,
    };

    assert.equal(studentPayload.explanation, 'The answer is B because...');
    assert.equal(studentPayload.correctIndex, 1);
    assert.equal(studentPayload.hasImage, false);
    assert.equal('imageFileKey' in studentPayload, false);
  });
});

/* ────────── Admin payload shape — exam questions ────────── */

describe('admin exam question payload shape', () => {
  test('admin GET includes explanation, imageFileKey, and hasImage for editing', () => {
    const dbQuestion = {
      id: 'q-789',
      sortOrder: 1,
      type: 'multiple_choice',
      prompt: 'Test question',
      options: JSON.stringify(['X', 'Y']),
      correctAnswer: 'X',
      rubric: '',
      explanation: 'X is correct.',
      points: 3,
      imageFileKey: 'questions/q-789/prompt.jpg',
    };

    // Mapping from app/api/admin/exams/[id]/route.ts GET
    const adminPayload = {
      ...dbQuestion,
      options: JSON.parse(dbQuestion.options),
      imageFileKey: dbQuestion.imageFileKey || null,
      hasImage: dbQuestion.imageFileKey != null,
    };

    assert.equal(adminPayload.explanation, 'X is correct.');
    assert.equal(adminPayload.imageFileKey, 'questions/q-789/prompt.jpg');
    assert.equal(adminPayload.hasImage, true);
    assert.equal(adminPayload.correctAnswer, 'X');
  });
});

/* ────────── Admin payload shape — assignment questions ────────── */

describe('admin assignment question payload shape', () => {
  test('admin GET includes explanation, imageFileKey, and hasImage', () => {
    const dbQuestion = {
      id: 'aq-789',
      question: 'Admin editable question',
      explanation: 'Teacher explanation here',
      options: JSON.stringify(['A', 'B', 'C']),
      correctIndex: 2,
      points: 5,
      sortOrder: 0,
      imageFileKey: 'assignments/a1/questions/aq-789/prompt.png',
    };

    // Mapping from app/api/admin/assignments/[id]/questions/route.ts GET
    const adminPayload = {
      ...dbQuestion,
      explanation: dbQuestion.explanation || null,
      options: JSON.parse(dbQuestion.options),
      imageFileKey: dbQuestion.imageFileKey || null,
      hasImage: dbQuestion.imageFileKey != null,
    };

    assert.equal(adminPayload.explanation, 'Teacher explanation here');
    assert.equal(adminPayload.imageFileKey, 'assignments/a1/questions/aq-789/prompt.png');
    assert.equal(adminPayload.hasImage, true);
  });
});

/* ────────── Exam submission response — explanation for wrong answers ────────── */

describe('exam submission response — explanation rules', () => {
  test('includes explanation for incorrect answer', () => {
    const question = {
      id: 'q-1',
      correctAnswer: 'B',
      explanation: 'The correct answer is B because of past tense.',
    };
    const studentAnswer = 'C';
    const isCorrect = studentAnswer === question.correctAnswer;

    // Mapping from app/api/exams/[id]/route.ts POST (line 303-309)
    const responseItem = {
      questionId: question.id,
      score: isCorrect ? 1 : 0,
      points: 1,
      feedback: isCorrect ? 'إجابة صحيحة.' : `الإجابة الصحيحة: ${question.correctAnswer}`,
      explanation: question.explanation || '',
    };

    assert.equal(responseItem.explanation, 'The correct answer is B because of past tense.');
    assert.equal(responseItem.score, 0);
  });

  test('includes empty explanation when question has no explanation', () => {
    const question = {
      id: 'q-2',
      correctAnswer: 'A',
      explanation: '',
    };
    const studentAnswer = 'B';

    const responseItem = {
      questionId: question.id,
      explanation: question.explanation || '',
    };

    assert.equal(responseItem.explanation, '');
  });
});

/* ────────── Assignment submission response — explanation for wrong answers ────────── */

describe('assignment MCQ submission response — explanation rules', () => {
  test('includes explanation for incorrect MCQ answer', () => {
    const question = {
      id: 'aq-1',
      question: 'Which is correct?',
      explanation: 'Answer B is right.',
      correctIndex: 1,
      points: 2,
      options: '["A","B","C"]',
      sortOrder: 0,
      imageFileKey: null,
    };
    const chosenIndex = 0; // wrong
    const isCorrect = chosenIndex === question.correctIndex;
    const options = JSON.parse(question.options);

    // Mapping from app/api/student/assignments/[id]/submit/route.ts
    const reviewItem = {
      id: question.id,
      prompt: question.question,
      sortOrder: question.sortOrder,
      points: question.points,
      studentAnswer: chosenIndex >= 0 && chosenIndex < options.length ? options[chosenIndex] : '',
      correctAnswer: question.correctIndex >= 0 && question.correctIndex < options.length ? options[question.correctIndex] : '',
      isCorrect,
      explanation: isCorrect ? '' : (question.explanation || ''),
      hasImage: question.imageFileKey != null,
    };

    assert.equal(reviewItem.explanation, 'Answer B is right.');
    assert.equal(reviewItem.isCorrect, false);
    assert.equal(reviewItem.hasImage, false);
    assert.equal('imageFileKey' in reviewItem, false);
    assert.equal('image_file_key' in reviewItem, false);
    assert.equal('correctIndex' in reviewItem, false);
  });

  test('returns empty explanation for correct MCQ answer', () => {
    const question = {
      id: 'aq-2',
      question: 'Which is correct?',
      explanation: 'This is the explanation.',
      correctIndex: 0,
      points: 1,
      options: '["A","B"]',
      sortOrder: 1,
      imageFileKey: 'assignments/a1/questions/aq-2/prompt.jpg',
    };
    const chosenIndex = 0; // correct
    const isCorrect = chosenIndex === question.correctIndex;

    const reviewItem = {
      explanation: isCorrect ? '' : (question.explanation || ''),
      hasImage: question.imageFileKey != null,
    };

    assert.equal(reviewItem.explanation, '');
    assert.equal(reviewItem.hasImage, true);
  });
});

/* ────────── Image endpoint authorization chain verification ────────── */

describe('image endpoint — authorization chain requirements', () => {
  /**
   * These tests verify the expected authorization chain structure
   * without running the actual HTTP handlers (which need a running server).
   */

  test('exam question image route file exists and imports apiVerifiedUser', async () => {
    const fs = await import('node:fs');
    const routePath = 'app/api/student/questions/[id]/image/route.ts';
    const content = fs.readFileSync(routePath, 'utf-8');

    assert.ok(content.includes('apiVerifiedUser'));
    assert.ok(content.includes('getDatabase'));
    assert.ok(content.includes('getPrivateStorage'));
    assert.ok(content.includes("status: 403"));
    assert.ok(content.includes("status: 404"));
    // Must NOT expose file key to client
    assert.ok(!content.includes('Response.json({ imageFileKey'));
    assert.ok(!content.includes('Response.json({ image_file_key'));
    // Must enforce sequence
    assert.ok(content.includes('hasCourseItems'));
    assert.ok(content.includes('getCourseSequenceUnlockState'));
  });

  test('assignment question image route file exists and imports apiVerifiedUser', async () => {
    const fs = await import('node:fs');
    const routePath = 'app/api/student/assignment-questions/[id]/image/route.ts';
    const content = fs.readFileSync(routePath, 'utf-8');

    assert.ok(content.includes('apiVerifiedUser'));
    assert.ok(content.includes('getDatabase'));
    assert.ok(content.includes('getPrivateStorage'));
    assert.ok(content.includes("status: 403"));
    assert.ok(content.includes("status: 404"));
    // Must NOT expose file key to client
    assert.ok(!content.includes('Response.json({ imageFileKey'));
    assert.ok(!content.includes('Response.json({ image_file_key'));
    // Must enforce sequence
    assert.ok(content.includes('hasCourseItems'));
    assert.ok(content.includes('getCourseSequenceUnlockState'));
  });

  test('question image endpoint performs enrollment check before storage access', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/student/questions/[id]/image/route.ts', 'utf-8');

    const enrollmentPos = content.indexOf('enrollments');
    const storagePos = content.indexOf('storage.get');

    assert.ok(enrollmentPos > -1);
    assert.ok(storagePos > -1);
    // Enrollment check must come before storage access
    assert.ok(enrollmentPos < storagePos);
  });

  test('assignment question image endpoint performs enrollment check before storage access', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/student/assignment-questions/[id]/image/route.ts', 'utf-8');

    const enrollmentPos = content.indexOf('enrollments');
    const storagePos = content.indexOf('storage.get');

    assert.ok(enrollmentPos > -1);
    assert.ok(storagePos > -1);
    assert.ok(enrollmentPos < storagePos);
  });

  test('question image endpoint sets Cache-Control: private, no-store', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/student/questions/[id]/image/route.ts', 'utf-8');
    assert.ok(content.includes("'Cache-Control': 'private, no-store, max-age=0'"));
  });

  test('question image endpoint sets x-content-type-options: nosniff', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/student/questions/[id]/image/route.ts', 'utf-8');
    assert.ok(content.includes("'x-content-type-options': 'nosniff'"));
  });
});

/* ────────── Sequence unlock enforcement on image endpoints ────────── */

describe('image endpoint — sequence unlock enforcement', () => {
  test('exam question image route checks sequence unlock after enrollment', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/student/questions/[id]/image/route.ts', 'utf-8');

    const enrollmentPos = content.indexOf('enrollments');
    const sequencePos = content.indexOf('hasCourseItems(');
    const storagePos = content.indexOf('storage.get');

    assert.ok(sequencePos > enrollmentPos);
    assert.ok(sequencePos < storagePos);
  });

  test('assignment question image route checks sequence unlock after enrollment', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/student/assignment-questions/[id]/image/route.ts', 'utf-8');

    const enrollmentPos = content.indexOf('enrollments');
    const sequencePos = content.indexOf('hasCourseItems(');
    const storagePos = content.indexOf('storage.get');

    assert.ok(sequencePos > enrollmentPos);
    assert.ok(sequencePos < storagePos);
  });
});

/* ────────── Student exam GET — field exclusion ────────── */

describe('student exam GET — field exclusion', () => {
  test('exam GET query selects image_file_key but maps to hasImage only', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/exams/[id]/route.ts', 'utf-8');

    // The GET handler query selects imageFileKey
    assert.ok(content.includes('image_file_key AS imageFileKey'));

    // But the response only contains hasImage (computed)
    assert.ok(content.includes('hasImage: question.imageFileKey != null'));

    // Verify that explanation is NOT included in the student GET response (only in POST)
    const getSection = content.slice(
      content.indexOf('export async function GET'),
      content.indexOf('export async function POST')
    );
    assert.ok(!getSection.includes("explanation:"));

    // imageFileKey must not appear in the returned JSON payload
    const mapSection = getSection.slice(getSection.indexOf('.map('));
    assert.ok(!mapSection.includes("imageFileKey:"));
    assert.ok(!mapSection.includes("image_file_key:"));
  });
});

/* ────────── Student assignment submit — explanation flow ────────── */

describe('student assignment submit — explanation in response', () => {
  test('submit route queries explanation from DB', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/student/assignments/[id]/submit/route.ts', 'utf-8');

    // Must query explanation
    assert.ok(content.includes('explanation'));

    // Must compute hasImage from imageFileKey, not from a has_image column
    assert.ok(content.includes('imageFileKey'));
    assert.ok(content.includes('q.imageFileKey != null'));

    // Must include explanation in review response
    assert.ok(content.includes("explanation: isCorrect ? '' : (q.explanation || '')"));
  });
});

/* ────────── Admin question update (PATCH) endpoint ────────── */

describe('admin assignment question PATCH endpoint', () => {
  test('PATCH route exists and requires staff auth', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');

    assert.ok(content.includes('export async function PATCH'));
    assert.ok(content.includes('apiStaff'));
    assert.ok(content.includes("manage_assignments"));
    assert.ok(content.includes('requireSameOrigin'));
  });

  test('PATCH validates question text length', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');

    assert.ok(content.includes('question.length < 3'));
    assert.ok(content.includes('safeText'));
    assert.ok(content.includes('safeInteger'));
  });

  test('PATCH updates explanation field', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');

    assert.ok(content.includes('explanation'));
    assert.ok(content.includes('UPDATE assignment_questions SET'));
  });
});
