import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const headersMod = require('next/headers.js');

let activeTestCookie = null;
const originalCookies = headersMod.cookies;
headersMod.cookies = async () => ({
  get(name) {
    if (activeTestCookie && name === 'englizeka_student') {
      return { name, value: activeTestCookie };
    }
    return undefined;
  },
});

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

class MockAssignmentDatabase {
  constructor({
    sessions = {},
    submissions = {},
    questions = [],
    assignment = null,
  } = {}) {
    this.sessions = sessions;
    this.submissions = submissions;
    this.questions = questions;
    this.assignment = assignment || {
      id: 'assign-mcq-1',
      title: 'Grammar MCQ Quiz',
      description: 'Test your understanding of tenses',
      dueAt: Date.now() + 86400000,
      type: 'mcq',
      maxScore: 10,
      status: 'published',
      courseId: 'course-1',
      hasTeacherFile: 0,
    };
  }

  prepare(sql) {
    const self = this;
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return new (class {
      bindings = [];
      bind(...args) {
        this.bindings = args;
        return this;
      }
      async first() {
        // 1. Native session lookup for student authentication
        if (normalized.includes('FROM native_sessions s JOIN users u')) {
          const tokenHash = this.bindings[0];
          const userEmail = self.sessions[tokenHash];
          if (userEmail) {
            return {
              email: userEmail,
              name: 'Student User',
              emailVerified: 1,
            };
          }
          return null;
        }
        // 2. Email verification check
        if (normalized.includes('FROM users u LEFT JOIN email_verifications v')) {
          return { emailVerified: 1, verifiedAt: Date.now() };
        }
        // 3. Assignment & enrollment check
        if (normalized.includes('FROM assignments a JOIN enrollments e')) {
          const [assignId, studentEmail] = this.bindings;
          if (assignId === self.assignment.id) {
            return self.assignment;
          }
          return null;
        }
        // 4. Student-scoped submission lookup
        if (normalized.includes('FROM assignment_submissions')) {
          const [assignId, studentEmail] = this.bindings;
          const key = `${assignId}:${studentEmail.toLowerCase()}`;
          return self.submissions[key] || null;
        }
        // 5. Course sequence lookup
        if (normalized.includes('FROM course_sequence_items')) {
          return null; // Course has no sequence lock
        }
        return null;
      }
      async all() {
        // 6. Assignment questions retrieval
        if (normalized.includes('FROM assignment_questions')) {
          return {
            results: self.questions.map((q) => ({
              id: q.id,
              question: q.question,
              explanation: q.explanation || null,
              options: JSON.stringify(q.options),
              correctIndex: q.correctIndex,
              points: q.points,
              sortOrder: q.sortOrder,
              imageFileKey: q.imageFileKey || null,
            })),
          };
        }
        return { results: [] };
      }
    })();
  }
}

afterEach(() => {
  delete globalThis.__ENGLIZEKA_ENV__;
  activeTestCookie = null;
});

const sampleQuestions = [
  {
    id: 'q-1',
    question: 'Choose the correct form: She ___ to school yesterday.',
    options: ['go', 'goes', 'went', 'gone'],
    correctIndex: 2,
    explanation: 'The past simple tense of "go" is "went" because the sentence specifies "yesterday".',
    points: 5,
    sortOrder: 1,
    imageFileKey: null,
  },
  {
    id: 'q-2',
    question: 'Which sentence is grammatically correct?',
    options: [
      'He don\'t know the answer.',
      'He doesn\'t knows the answer.',
      'He doesn\'t know the answer.',
      'He not knowing the answer.',
    ],
    correctIndex: 2,
    explanation: 'Third-person singular with auxiliary "does" uses the base verb form "know".',
    points: 5,
    sortOrder: 2,
    imageFileKey: null,
  },
];

test('CASE 1 — No submission exists: correctIndex and explanation are strictly null', async () => {
  const tokenStudentA = 'student-a-session-token-secret-12345';
  const hashA = await sha256(tokenStudentA);

  const db = new MockAssignmentDatabase({
    sessions: { [hashA]: 'student-a@example.test' },
    submissions: {}, // No submission
    questions: sampleQuestions,
  });

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
  };

  activeTestCookie = tokenStudentA;

  const req = new Request('https://englezika.com/api/student/assignments/assign-mcq-1', {
    method: 'GET',
    headers: { cookie: `englizeka_student=${tokenStudentA}` },
  });

  const { GET } = await import('../app/api/student/assignments/[id]/route.ts');
  const res = await GET(req, { params: Promise.resolve({ id: 'assign-mcq-1' }) });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.submission, null);
  assert.equal(data.questions.length, 2);

  for (const q of data.questions) {
    assert.equal(q.correctIndex, null, `Question ${q.id} correctIndex must be null before submission`);
    assert.equal(q.explanation, null, `Question ${q.id} explanation must be null before submission`);
  }
});

test('CASE 2 — Submission exists: correctIndex and explanation are revealed to the student', async () => {
  const tokenStudentA = 'student-a-session-token-secret-12345';
  const hashA = await sha256(tokenStudentA);

  const db = new MockAssignmentDatabase({
    sessions: { [hashA]: 'student-a@example.test' },
    submissions: {
      'assign-mcq-1:student-a@example.test': {
        id: 'sub-1',
        status: 'submitted',
        score: 10,
        maxScore: 10,
        feedback: 'Excellent job!',
        submittedAt: Date.now() - 3600000,
        gradedAt: Date.now() - 1800000,
        hasPdf: 0,
        mcqAnswers: JSON.stringify([{ questionId: 'q-1', chosen: 2 }, { questionId: 'q-2', chosen: 2 }]),
      },
    },
    questions: sampleQuestions,
  });

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
  };

  activeTestCookie = tokenStudentA;

  const req = new Request('https://englezika.com/api/student/assignments/assign-mcq-1', {
    method: 'GET',
    headers: { cookie: `englizeka_student=${tokenStudentA}` },
  });

  const { GET } = await import('../app/api/student/assignments/[id]/route.ts');
  const res = await GET(req, { params: Promise.resolve({ id: 'assign-mcq-1' }) });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.ok(data.submission !== null);
  assert.equal(data.submission.status, 'submitted');
  assert.equal(data.questions.length, 2);

  assert.equal(data.questions[0].correctIndex, 2);
  assert.equal(
    data.questions[0].explanation,
    'The past simple tense of "go" is "went" because the sentence specifies "yesterday".'
  );

  assert.equal(data.questions[1].correctIndex, 2);
  assert.equal(
    data.questions[1].explanation,
    'Third-person singular with auxiliary "does" uses the base verb form "know".'
  );
});

test('CASE 3 — Another student\'s submission exists: Student A still receives null for explanation & correctIndex', async () => {
  const tokenStudentA = 'student-a-session-token-secret-12345';
  const tokenStudentB = 'student-b-session-token-secret-67890';
  const hashA = await sha256(tokenStudentA);
  const hashB = await sha256(tokenStudentB);

  // Student B has submitted, but Student A has NOT submitted
  const db = new MockAssignmentDatabase({
    sessions: {
      [hashA]: 'student-a@example.test',
      [hashB]: 'student-b@example.test',
    },
    submissions: {
      'assign-mcq-1:student-b@example.test': {
        id: 'sub-b',
        status: 'submitted',
        score: 10,
        maxScore: 10,
        feedback: 'Great',
        submittedAt: Date.now() - 3600000,
        gradedAt: null,
        hasPdf: 0,
        mcqAnswers: null,
      },
    },
    questions: sampleQuestions,
  });

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    VERIFICATION_SECRET: 'test-verification-secret-32-chars-long!',
  };

  const { GET } = await import('../app/api/student/assignments/[id]/route.ts');

  // Request as Student A (no submission)
  activeTestCookie = tokenStudentA;
  const reqA = new Request('https://englezika.com/api/student/assignments/assign-mcq-1', {
    method: 'GET',
    headers: { cookie: `englizeka_student=${tokenStudentA}` },
  });
  const resA = await GET(reqA, { params: Promise.resolve({ id: 'assign-mcq-1' }) });
  assert.equal(resA.status, 200);

  const dataA = await resA.json();
  assert.equal(dataA.submission, null, 'Student A must have null submission');
  for (const q of dataA.questions) {
    assert.equal(q.correctIndex, null, 'Student A must not see correctIndex');
    assert.equal(q.explanation, null, 'Student A must not see explanation even if Student B submitted');
  }

  // Request as Student B (submitted)
  activeTestCookie = tokenStudentB;
  const reqB = new Request('https://englezika.com/api/student/assignments/assign-mcq-1', {
    method: 'GET',
    headers: { cookie: `englizeka_student=${tokenStudentB}` },
  });
  const resB = await GET(reqB, { params: Promise.resolve({ id: 'assign-mcq-1' }) });
  assert.equal(resB.status, 200);

  const dataB = await resB.json();
  assert.ok(dataB.submission !== null, 'Student B sees their submission');
  assert.equal(dataB.questions[0].correctIndex, 2);
  assert.ok(dataB.questions[0].explanation !== null);
});

test('CASE 4 — Admin/teacher question management behavior is unchanged and receives explanation', async () => {
  const adminRoute = await readFile(
    new URL('../app/api/admin/assignments/[id]/questions/route.ts', import.meta.url),
    'utf8'
  );

  // Verifies staff permission check is present
  assert.match(adminRoute, /apiStaff\(request,\s*'manage_assignments'\)/);

  // Verifies admin questions route returns explanation unconditionally
  assert.match(adminRoute, /explanation:\s*q\.explanation\s*\|\|\s*null/);
  assert.match(adminRoute, /correct_index\s+AS\s+correctIndex/);

  // Verifies student route masks explanation when hasSubmission is false
  const studentRoute = await readFile(
    new URL('../app/api/student/assignments/[id]/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(studentRoute, /explanation:\s*hasSubmission\s*\?\s*\(q\.explanation\s*\|\|\s*null\)\s*:\s*null/);
  assert.match(studentRoute, /correctIndex:\s*hasSubmission\s*\?\s*q\.correctIndex\s*:\s*null/);
  assert.doesNotMatch(studentRoute, /explanation:\s*q\.explanation\s*\|\|\s*null/);

  // Verifies original apiUser() call was preserved
  assert.match(studentRoute, /const user = await apiUser\(\);/);
});
