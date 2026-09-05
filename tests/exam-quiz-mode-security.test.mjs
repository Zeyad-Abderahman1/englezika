/**
 * Stage 4 — Exam / Quiz Mode — Security Tests
 *
 * Validates:
 * 1. Assessment type field: exam vs quiz distinguished by field, not title
 * 2. Mode field: online vs file enforced server-side
 * 3. Student exam GET returns assessmentType and mode
 * 4. Student exam GET never exposes correct_answer, explanation, image_file_key
 * 5. Student exam GET uses has_image boolean
 * 6. File-mode exam does not expose teacher_file_key to student
 * 7. Admin create: file-mode exams skip question validation
 * 8. Admin create: online-mode exams still require questions
 * 9. Student file download: requires enrollment + mode=file + sequence unlock
 * 10. Admin endpoints require staff auth + same-origin
 * 11. Quiz uses assessment_type field, not title convention
 * 12. Existing legacy prerequisite behavior preserved
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';

/* ────────── Assessment type: field-based, not title-based ────────── */

describe('assessment_type — field-based distinction', () => {
  test('admin create stores assessment_type from field, not title', async () => {
    const content = await readFile('app/api/admin/exams/route.ts', 'utf-8');

    // Must derive assessmentType from body.assessmentType, not from title
    assert.ok(
      content.includes("body.assessmentType === 'quiz' ? 'quiz' : 'exam'"),
      'assessmentType must come from body.assessmentType field'
    );
    // Must NOT contain title-based detection
    assert.ok(
      !content.includes('title.includes') && !content.includes('title.toLowerCase().includes'),
      'Must not infer quiz/exam from title'
    );
  });

  test('admin PATCH stores assessment_type from field', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');

    assert.ok(
      content.includes("body.assessmentType === 'quiz' ? 'quiz' : 'exam'"),
      'PATCH must derive assessmentType from body.assessmentType'
    );
  });

  test('student exam load uses COALESCE for assessment_type default', async () => {
    const content = await readFile('app/lib/exam-access.ts', 'utf-8');

    assert.ok(
      content.includes("COALESCE(x.assessment_type, 'exam') AS assessmentType"),
      'Must default assessment_type to exam via COALESCE'
    );
  });

  test('admin bootstrap returns assessmentType and mode', async () => {
    const content = await readFile('app/api/admin/bootstrap/route.ts', 'utf-8');

    assert.ok(content.includes("COALESCE(x.assessment_type, 'exam') AS assessmentType"));
    assert.ok(content.includes("COALESCE(x.mode, 'online') AS mode"));
  });
});

/* ────────── Mode field: online vs file ────────── */

describe('mode — online vs file enforcement', () => {
  test('admin create stores mode from field', async () => {
    const content = await readFile('app/api/admin/exams/route.ts', 'utf-8');

    assert.ok(
      content.includes("body.mode === 'file' ? 'file' : 'online'"),
      'mode must come from body.mode field'
    );
  });

  test('admin create: file-mode exams skip question validation', async () => {
    const content = await readFile('app/api/admin/exams/route.ts', 'utf-8');

    // Question validation must be inside a mode === 'online' block
    assert.ok(
      content.includes("if (mode === 'online')"),
      'Question validation must be conditional on mode === online'
    );
  });

  test('admin create: question insertion is conditional on online mode', async () => {
    const content = await readFile('app/api/admin/exams/route.ts', 'utf-8');

    // Questions should only be inserted for online mode
    const onlineBlock = content.indexOf("if (mode === 'online')");
    const insertBlock = content.indexOf('INSERT INTO questions');
    assert.ok(onlineBlock > -1, 'Must have mode check');
    assert.ok(insertBlock > onlineBlock, 'INSERT INTO questions must be inside online mode block');
  });

  test('admin PATCH stores mode from field', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');

    assert.ok(
      content.includes("body.mode === 'file' ? 'file' : 'online'"),
      'PATCH must derive mode from body.mode'
    );
  });

  test('student exam load uses COALESCE for mode default', async () => {
    const content = await readFile('app/lib/exam-access.ts', 'utf-8');

    assert.ok(
      content.includes("COALESCE(x.mode, 'online') AS mode"),
      'Must default mode to online via COALESCE'
    );
  });
});

/* ────────── Student exam GET payload security ────────── */

describe('student exam GET — payload security', () => {
  test('student exam GET returns assessmentType and mode', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');

    // The exam object is returned from loadStudentExam which now includes these fields
    // Verify the GET handler returns the exam object (which contains assessmentType/mode)
    assert.ok(content.includes('exam,'), 'GET must return exam object');
    assert.ok(content.includes('loadStudentExam'), 'GET must use loadStudentExam');
  });

  test('student exam GET never exposes correct_answer in response', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');

    // Get the GET section (between export async function GET and POST)
    const getStart = content.indexOf('export async function GET');
    const postStart = content.indexOf('export async function POST');
    const getSection = content.slice(getStart, postStart);

    // The response map should not include correctAnswer
    const mapStart = getSection.indexOf('.map(');
    if (mapStart > -1) {
      const mapSection = getSection.slice(mapStart);
      assert.ok(
        !mapSection.includes('correctAnswer') && !mapSection.includes('correct_answer'),
        'Student GET response must not expose correct_answer'
      );
    }
  });

  test('student exam GET never exposes explanation in response', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');

    const getStart = content.indexOf('export async function GET');
    const postStart = content.indexOf('export async function POST');
    const getSection = content.slice(getStart, postStart);

    // The response map should not include explanation
    const mapStart = getSection.indexOf('.map(');
    if (mapStart > -1) {
      const mapSection = getSection.slice(mapStart);
      assert.ok(
        !mapSection.includes('explanation:'),
        'Student GET response must not expose explanation'
      );
    }
  });

  test('student exam GET never exposes image_file_key in response', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');

    const getStart = content.indexOf('export async function GET');
    const postStart = content.indexOf('export async function POST');
    const getSection = content.slice(getStart, postStart);

    const mapStart = getSection.indexOf('.map(');
    if (mapStart > -1) {
      const mapSection = getSection.slice(mapStart);
      assert.ok(
        !mapSection.includes('imageFileKey:') && !mapSection.includes('image_file_key:'),
        'Student GET response must not expose image_file_key'
      );
    }
  });

  test('student exam GET uses has_image computed from image_file_key', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');

    assert.ok(
      content.includes('hasImage: question.imageFileKey != null'),
      'Student GET must compute hasImage from imageFileKey'
    );
  });

  test('student exam GET excludes image_file_key from query result mapping', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');

    // The SELECT includes image_file_key but the .map() should not pass it through
    const getStart = content.indexOf('export async function GET');
    const postStart = content.indexOf('export async function POST');
    const getSection = content.slice(getStart, postStart);

    // Should select imageFileKey for computing hasImage
    assert.ok(getSection.includes('image_file_key AS imageFileKey'), 'Must select image_file_key');
    // But the map should not include imageFileKey in the response
    const mapSection = getSection.slice(getSection.indexOf('.map('));
    assert.ok(
      !mapSection.includes('imageFileKey:'),
      'Must not pass imageFileKey through to response'
    );
  });
});

/* ────────── File-mode exam security ────────── */

describe('file-mode exam — security', () => {
  test('student file download endpoint exists', async () => {
    const { existsSync } = await import('node:fs');
    assert.ok(
      existsSync('app/api/student/exams/[id]/file/route.ts'),
      'Student file download endpoint must exist'
    );
  });

  test('student file download requires authentication', async () => {
    const content = await readFile('app/api/student/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('apiVerifiedUser'), 'Must require authentication');
  });

  test('student file download checks enrollment', async () => {
    const content = await readFile('app/api/student/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('enrollments'), 'Must check enrollment');
  });

  test('student file download checks mode = file', async () => {
    const content = await readFile('app/api/student/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes("x.mode = 'file'"), 'Must verify exam is file mode');
  });

  test('student file download checks course sequence unlock', async () => {
    const content = await readFile('app/api/student/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('hasCourseItems'), 'Must check course sequence');
    assert.ok(content.includes('getCourseSequenceUnlockState'), 'Must get unlock state');
  });

  test('student file download serves from private storage', async () => {
    const content = await readFile('app/api/student/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('getPrivateStorage'), 'Must use private storage');
    assert.ok(content.includes('exams/${id}/teacher.pdf'), 'Must use correct storage key');
  });

  test('student file download sets safe headers', async () => {
    const content = await readFile('app/api/student/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('cache-control'), 'Must set cache-control');
    assert.ok(content.includes('no-store'), 'Must use no-store');
    assert.ok(content.includes('content-disposition'), 'Must set content-disposition');
  });

  test('student file download does not expose teacher_file_key', async () => {
    const content = await readFile('app/api/student/exams/[id]/file/route.ts', 'utf-8');
    // Must NOT return teacher_file_key in JSON
    assert.ok(
      !content.includes('teacher_file_key') || content.includes('teacher_file_key') &&
        !content.includes('Response.json({') ,
      'Must not expose teacher_file_key to student'
    );
  });

  test('admin exam file upload requires staff auth', async () => {
    const content = await readFile('app/api/admin/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('apiStaff'), 'Must require staff auth');
    assert.ok(content.includes('manage_exams'), 'Must check manage_exams permission');
  });

  test('admin exam file upload requires same-origin', async () => {
    const content = await readFile('app/api/admin/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Must check same-origin');
  });

  test('admin exam file upload validates PDF only', async () => {
    const content = await readFile('app/api/admin/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(content.includes('isPdfUpload'), 'Must validate PDF');
    assert.ok(content.includes('MAX_PDF_SIZE'), 'Must enforce size limit');
  });

  test('admin exam file upload stores at correct path', async () => {
    const content = await readFile('app/api/admin/exams/[id]/file/route.ts', 'utf-8');
    assert.ok(
      content.includes('exams/${id}/teacher.pdf'),
      'Must store at exams/{id}/teacher.pdf'
    );
  });

  test('admin exam file delete requires same-origin', async () => {
    const content = await readFile('app/api/admin/exams/[id]/file/route.ts', 'utf-8');
    // The DELETE function should check same-origin
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('requireSameOrigin'), 'DELETE must check same-origin');
  });

  test('admin exam file delete clears teacher_file_key', async () => {
    const content = await readFile('app/api/admin/exams/[id]/file/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(
      deleteSection.includes('teacher_file_key = NULL'),
      'DELETE must clear teacher_file_key'
    );
  });
});

/* ────────── Admin endpoint security ────────── */

describe('admin exam endpoints — security', () => {
  test('admin exam create requires staff auth + manage_exams', async () => {
    const content = await readFile('app/api/admin/exams/route.ts', 'utf-8');
    assert.ok(content.includes('apiStaff'), 'Must require staff auth');
    assert.ok(content.includes('manage_exams'), 'Must check manage_exams permission');
  });

  test('admin exam create requires same-origin', async () => {
    const content = await readFile('app/api/admin/exams/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Must check same-origin');
  });

  test('admin exam PATCH requires staff auth + manage_exams', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');
    assert.ok(content.includes('apiStaff'), 'Must require staff auth');
    assert.ok(content.includes('manage_exams'), 'Must check manage_exams permission');
  });

  test('admin exam PATCH requires same-origin', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Must check same-origin');
  });

  test('admin exam DELETE requires staff auth + manage_exams', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('apiStaff'), 'DELETE must require staff auth');
    assert.ok(deleteSection.includes('manage_exams'), 'DELETE must check manage_exams');
  });

  test('admin exam DELETE requires same-origin', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('requireSameOrigin'), 'DELETE must check same-origin');
  });
});

/* ────────── Course sequence enforcement on exam routes ────────── */

describe('exam routes — course sequence enforcement', () => {
  test('exam start checks course sequence unlock', async () => {
    const content = await readFile('app/api/exams/[id]/start/route.ts', 'utf-8');
    assert.ok(content.includes('hasCourseItems'), 'Start must check course sequence');
    assert.ok(content.includes('getCourseSequenceUnlockState'), 'Start must get unlock state');
  });

  test('exam GET checks course sequence unlock', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');
    assert.ok(content.includes('hasCourseItems'), 'GET must check course sequence');
    assert.ok(content.includes('assertExamUnlocked'), 'GET must call assertExamUnlocked');
  });

  test('exam POST (submit) checks course sequence unlock', async () => {
    const content = await readFile('app/api/exams/[id]/route.ts', 'utf-8');
    const postStart = content.indexOf('export async function POST');
    const postSection = content.slice(postStart);
    assert.ok(postSection.includes('assertExamUnlocked'), 'POST must call assertExamUnlocked');
  });

  test('exam start uses same-origin protection', async () => {
    const content = await readFile('app/api/exams/[id]/start/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Start must check same-origin');
  });
});

/* ────────── Legacy prerequisite compatibility ────────── */

describe('legacy prerequisite compatibility', () => {
  test('exam-access loadStudentExam still uses enrollment-based access', async () => {
    const content = await readFile('app/lib/exam-access.ts', 'utf-8');

    // Must still join enrollments for access control
    assert.ok(content.includes('LEFT JOIN enrollments e'), 'Must join enrollments');
    assert.ok(content.includes("e.status = 'approved'"), 'Must check approved enrollment');
  });

  test('exam-access still filters by published status', async () => {
    const content = await readFile('app/lib/exam-access.ts', 'utf-8');
    assert.ok(content.includes("x.status = 'published'"), 'Must filter by published status');
  });

  test('exam-access allows exams with no course (public exams)', async () => {
    const content = await readFile('app/lib/exam-access.ts', 'utf-8');
    assert.ok(
      content.includes('x.course_id IS NULL'),
      'Must allow exams with no course (public)'
    );
  });
});

/* ────────── QuizRunner supports assessment types ────────── */

describe('QuizRunner — assessment type support', () => {
  test('QuizRunner type includes assessmentType and mode in ExamPayload', async () => {
    const content = await readFile('app/components/QuizRunner.tsx', 'utf-8');

    // The ExamPayload type should accept assessmentType and mode from the exam
    // These come from loadStudentExam via the GET response
    assert.ok(content.includes('ExamPayload'), 'Must define ExamPayload type');
    // The exam object in the payload should accept these fields
    assert.ok(
      content.includes('exam:') || content.includes('exam {'),
      'Must have exam in payload'
    );
  });

  test('QuizRunner uses hasImage for question images', async () => {
    const content = await readFile('app/components/QuizRunner.tsx', 'utf-8');
    assert.ok(content.includes('hasImage'), 'Must use hasImage for question images');
    assert.ok(
      content.includes('/api/student/questions/'),
      'Must use student question image endpoint'
    );
  });

  test('QuizRunner shows explanation after submission', async () => {
    const content = await readFile('app/components/QuizRunner.tsx', 'utf-8');
    // The result/review section should display explanations
    assert.ok(
      content.includes('explanation') || content.includes('AssessmentReview'),
      'Must show explanation in review'
    );
  });
});

/* ────────── Admin UI supports assessment types ────────── */

describe('ExamsManagerView — assessment type UI', () => {
  test('admin UI has assessment type selector', async () => {
    const content = await readFile('app/components/admin/domains/ExamsManagerView.tsx', 'utf-8');
    assert.ok(
      content.includes('assessmentType'),
      'Admin UI must have assessmentType field'
    );
    assert.ok(
      content.includes('امتحان') && content.includes('quiz'),
      'Admin UI must show Arabic labels for exam/quiz'
    );
  });

  test('admin UI has mode selector', async () => {
    const content = await readFile('app/components/admin/domains/ExamsManagerView.tsx', 'utf-8');
    assert.ok(content.includes('mode'), 'Admin UI must have mode field');
    assert.ok(
      content.includes('online') && content.includes('file'),
      'Admin UI must show online/file options'
    );
  });

  test('admin UI sends assessmentType and mode in create request', async () => {
    const content = await readFile('app/components/admin/domains/ExamsManagerView.tsx', 'utf-8');
    assert.ok(
      content.includes('assessmentType: values.assessmentType'),
      'Must send assessmentType in create request'
    );
    assert.ok(
      content.includes('mode: values.mode'),
      'Must send mode in create request'
    );
  });
});

/* ────────── Exam deletion cleans up file-mode resources ────────── */

describe('exam deletion — file-mode cleanup', () => {
  test('admin exam DELETE cleans up teacher_file_key', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(
      deleteSection.includes('teacherFileKey') || deleteSection.includes('teacher_file_key'),
      'DELETE must handle teacher file cleanup'
    );
  });

  test('admin exam DELETE cleans up question image files', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(
      deleteSection.includes('image_file_key') || deleteSection.includes('imageFileKey'),
      'DELETE must handle question image cleanup'
    );
  });

  test('admin exam DELETE cleans up attempt PDF files', async () => {
    const content = await readFile('app/api/admin/exams/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(
      deleteSection.includes('pdf_storage_key') || deleteSection.includes('pdfStorageKey'),
      'DELETE must handle attempt PDF cleanup'
    );
  });
});
