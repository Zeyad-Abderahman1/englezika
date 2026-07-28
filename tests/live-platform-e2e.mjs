import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://localhost:4180';
const teacherEmail = process.env.TEST_TEACHER_EMAIL || 'teacher@test.local';
const teacherPassword = process.env.TEST_TEACHER_PASSWORD || 'TestTeacher!2026';
const origin = new URL(base).origin;

async function call(path, { cookie, json, body, headers = {}, method = 'GET' } = {}) {
  const requestHeaders = { ...headers };
  if (cookie) requestHeaders.cookie = cookie;
  if (method !== 'GET' && !requestHeaders.origin) requestHeaders.origin = origin;
  let payload = body;
  if (json !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    body: payload,
    redirect: 'manual',
  });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, result, cookie: response.headers.get('set-cookie')?.split(';')[0] || null };
}

function expectStatus(value, status, label) {
  assert.equal(value.response.status, status, `${label}: ${JSON.stringify(value.result)}`);
}

const anonymousAdmin = await call('/api/admin/bootstrap');
expectStatus(anonymousAdmin, 401, 'anonymous staff API');

const crossOrigin = await call('/api/staff/login', {
  method: 'POST',
  headers: { origin: 'https://attacker.example' },
  json: { email: teacherEmail, password: teacherPassword },
});
expectStatus(crossOrigin, 403, 'cross-origin login');

const wrongLogin = await call('/api/staff/login', {
  method: 'POST',
  json: { email: teacherEmail, password: 'not-the-password' },
});
expectStatus(wrongLogin, 401, 'wrong staff password');

const teacherLogin = await call('/api/staff/login', {
  method: 'POST',
  json: { email: teacherEmail, password: teacherPassword },
});
expectStatus(teacherLogin, 200, 'teacher login');
assert.ok(teacherLogin.cookie, 'teacher session cookie must be set');
const anonymousAdminPage = await call('/admin');
assert.ok([302, 303, 307, 308].includes(anonymousAdminPage.response.status));
assert.match(anonymousAdminPage.response.headers.get('location') || '', /\/staff\/login/);
const staffPage = await call('/admin', { cookie: teacherLogin.cookie });
expectStatus(staffPage, 200, 'authenticated staff page');
assert.doesNotMatch(staffPage.result, /class="site-header"/);

const publicHome = await call('/');
expectStatus(publicHome, 200, 'public home');
assert.doesNotMatch(publicHome.result, /مساحتي التعليمية/);
const staffCookieOnStudentApi = await call('/api/dashboard', { cookie: teacherLogin.cookie });
expectStatus(staffCookieOnStudentApi, 401, 'staff session is not a student session');
const anonymousStaffApi = await call('/api/admin/bootstrap');
expectStatus(anonymousStaffApi, 401, 'student routes cannot grant staff access');

const suffix = crypto.randomUUID().slice(0, 8);
const course = await call('/api/admin/courses', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: {
    title: `E2E Course ${suffix}`,
    grade: 'تالتة ثانوي',
    description: 'End-to-end protected course',
    price: 150,
    status: 'published',
  },
});
expectStatus(course, 200, 'teacher creates course');
const courseId = course.result.id;
const editedCourseTitle = `Edited E2E Course ${suffix}`;
const editedCourse = await call(`/api/admin/courses/${courseId}`, {
  method: 'PATCH',
  cookie: teacherLogin.cookie,
  json: {
    title: editedCourseTitle,
    grade: 'تالتة ثانوي',
    description: 'Edited from the teacher dashboard',
    price: 175,
    status: 'published',
  },
});
expectStatus(editedCourse, 200, 'teacher edits any course');

const exam = await call('/api/admin/exams', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: {
    title: `Lesson Quiz ${suffix}`,
    courseId,
    durationMinutes: 10,
    passingScore: 50,
    maxAttempts: 3,
    status: 'published',
    questions: [
      {
        type: 'multiple_choice',
        prompt: 'Choose the correct answer',
        options: ['A', 'B'],
        correctAnswer: 'A',
        rubric: '',
        points: 10,
      },
    ],
  },
});
expectStatus(exam, 200, 'teacher creates quiz');
const examId = exam.result.id;
const editedExam = await call(`/api/admin/exams/${examId}`, {
  method: 'PATCH',
  cookie: teacherLogin.cookie,
  json: {
    title: `Edited Lesson Quiz ${suffix}`,
    courseId,
    description: 'Updated exam alert details',
    instructions: 'Read every question carefully',
    durationMinutes: 12,
    passingScore: 50,
    maxAttempts: 3,
    status: 'published',
  },
});
expectStatus(editedExam, 200, 'teacher edits exam details');

const announcement = await call('/api/admin/announcements', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: { title: `E2E Alert ${suffix}`, body: 'Original notification body' },
});
expectStatus(announcement, 200, 'teacher creates an alert');
const editedAnnouncement = await call(`/api/admin/announcements/${announcement.result.id}`, {
  method: 'PATCH',
  cookie: teacherLogin.cookie,
  json: { title: `Edited E2E Alert ${suffix}`, body: 'Updated notification body' },
});
expectStatus(editedAnnouncement, 200, 'teacher edits an alert');

const assignment = await call('/api/admin/assignments', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: {
    courseId,
    title: `Homework ${suffix}`,
    description: 'Complete the revision worksheet',
    dueAt: Date.now() + 86_400_000,
    maxScore: 20,
    status: 'published',
  },
});
expectStatus(assignment, 200, 'teacher creates a course assignment');
const assignmentId = assignment.result.id;

const video = await call('/api/admin/videos', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  headers: {
    'content-type': 'video/mp4',
    'x-course-id': courseId,
    'x-video-title': encodeURIComponent(`Protected lesson ${suffix}`),
    'x-video-duration': '1',
  },
  body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
});
expectStatus(video, 200, 'teacher uploads gated lesson');
const videoId = video.result.id;
const lessonGate = await call(`/api/admin/videos/${videoId}`, {
  method: 'PATCH',
  cookie: teacherLogin.cookie,
  json: {
    title: `Protected lesson ${suffix}`,
    prerequisiteExamId: examId,
    minimumScore: 70,
    status: 'published',
  },
});
expectStatus(lessonGate, 200, 'teacher places an exam with a pass percentage before a lesson');

const studentEmail = `student-${suffix}@example.test`;
const studentPassword = 'Student!2026';
const registrationForm = new FormData();
for (const [key, value] of Object.entries({
  email: studentEmail,
  password: studentPassword,
  password_confirm: studentPassword,
  first_name: 'Test',
  second_name: 'Student',
  third_name: '',
  last_name: suffix,
  phone: '01000000001',
  father_phone: '01000000002',
  mother_phone: '01000000003',
  school_name: 'E2E School',
  parent_job: 'Tester',
  governorate: 'القاهرة',
  gender: 'ذكر',
  grade: 'تالتة ثانوي',
  section: 'علمي علوم',
  account_use_agreement: 'accepted',
})) {
  registrationForm.set(key, value);
}
registrationForm.set(
  'birth_certificate',
  new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
  'certificate.png'
);
const studentRegistration = await call('/api/auth/register', {
  method: 'POST',
  body: registrationForm,
});
expectStatus(studentRegistration, 200, 'student registration creates application session');
assert.ok(studentRegistration.cookie);
assert.match(studentRegistration.result.testCode, /^\d{6}$/);
const studentCookie = studentRegistration.cookie;
const signedStudentHome = await call('/', { cookie: studentCookie });
assert.match(signedStudentHome.result, /مساحتي التعليمية/);
const dashboard = await call('/api/dashboard', { cookie: studentCookie });
expectStatus(dashboard, 200, 'student account bootstrap');
assert.equal(dashboard.result.verificationRequired, true);
const verified = await call('/api/auth/verify-code', {
  method: 'POST',
  cookie: studentCookie,
  json: { code: studentRegistration.result.testCode },
});
expectStatus(verified, 200, 'verify student email');

const enrollment = await call('/api/enrollments', {
  method: 'POST',
  cookie: studentCookie,
  json: { courseId, paymentMethod: 'فودافون كاش', paymentReference: `REF-${suffix}` },
});
expectStatus(enrollment, 200, 'student submits payment');

const bootstrap = await call('/api/admin/bootstrap', { cookie: teacherLogin.cookie });
expectStatus(bootstrap, 200, 'teacher dashboard');
const enrollmentRow = bootstrap.result.enrollments.find(
  (item) => item.userEmail === studentEmail && item.courseId === courseId
);
assert.ok(enrollmentRow, 'payment request must appear in staff dashboard');
const approved = await call(`/api/admin/enrollments/${enrollmentRow.id}`, {
  method: 'PATCH',
  cookie: teacherLogin.cookie,
  json: { status: 'approved' },
});
expectStatus(approved, 200, 'teacher approves payment');

const notificationsBeforeRead = await call('/api/dashboard', { cookie: studentCookie });
expectStatus(notificationsBeforeRead, 200, 'student receives assignments and alerts');
assert.equal(
  notificationsBeforeRead.result.assignments.find((item) => item.id === assignmentId)?.isRead,
  0
);
assert.equal(notificationsBeforeRead.result.exams.find((item) => item.id === examId)?.isRead, 0);
assert.ok(notificationsBeforeRead.result.announcements.some((item) => item.isRead === 0));
const markNotificationsRead = await call('/api/notifications/read', {
  method: 'POST',
  cookie: studentCookie,
  json: {},
});
expectStatus(markNotificationsRead, 200, 'student marks visible notifications read');
const notificationsAfterRead = await call('/api/dashboard', { cookie: studentCookie });
assert.equal(
  notificationsAfterRead.result.assignments.find((item) => item.id === assignmentId)?.isRead,
  1
);
assert.equal(notificationsAfterRead.result.exams.find((item) => item.id === examId)?.isRead, 1);
assert.ok(notificationsAfterRead.result.announcements.every((item) => item.isRead === 1));

const lockedVideo = await call(`/api/videos/${videoId}`, { cookie: studentCookie });
expectStatus(lockedVideo, 403, 'lesson blocked before quiz');
assert.equal(lockedVideo.result.code, 'LESSON_QUIZ_REQUIRED');

const openedExam = await call(`/api/exams/${examId}`, { cookie: studentCookie });
expectStatus(openedExam, 200, 'student opens quiz');
const resumedExam = await call(`/api/exams/${examId}`, { cookie: studentCookie });
expectStatus(resumedExam, 200, 'student resumes quiz');
assert.equal(resumedExam.result.session.id, openedExam.result.session.id);
assert.equal(resumedExam.result.session.expiresAt, openedExam.result.session.expiresAt);
const questionId = openedExam.result.questions[0].id;
const submitted = await call(`/api/exams/${examId}`, {
  method: 'POST',
  cookie: studentCookie,
  json: { sessionId: openedExam.result.session.id, answers: { [questionId]: 'A' } },
});
expectStatus(submitted, 200, 'student submits quiz');
assert.equal(submitted.result.passed, true);

const unlockedVideo = await call(`/api/videos/${videoId}`, { cookie: studentCookie });
expectStatus(unlockedVideo, 200, 'lesson unlocked after quiz');
const resolvedVideo = await call(`/api/videos/${videoId}/resolve`, { cookie: studentCookie });
expectStatus(resolvedVideo, 200, 'student resolves completion proof');
const earlyCompletion = await call(`/api/videos/${videoId}/complete`, {
  method: 'POST',
  cookie: studentCookie,
  json: { completionToken: resolvedVideo.result.completionToken },
});
expectStatus(earlyCompletion, 403, 'lesson cannot complete before required watch time');
await new Promise((resolve) => setTimeout(resolve, 1100));
const completedVideo = await call(`/api/videos/${videoId}/complete`, {
  method: 'POST',
  cookie: studentCookie,
  json: { completionToken: resolvedVideo.result.completionToken },
});
expectStatus(completedVideo, 200, 'signed lesson completion proof succeeds after watch time');
const studentLogout = await call('/student/logout', { cookie: studentCookie });
expectStatus(studentLogout, 303, 'student logout');
assert.ok(studentLogout.cookie);
const dashboardAfterLogout = await call('/api/dashboard', { cookie: studentLogout.cookie });
expectStatus(dashboardAfterLogout, 401, 'student session is cleared on logout');

const graderEmail = `grader-${suffix}@staff.test`;
const createGrader = await call('/api/admin/staff', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: {
    name: 'Grade Assistant',
    email: graderEmail,
    password: 'GradeAssistant!2026',
    role: 'assistant',
    preset: 'grader',
  },
});
expectStatus(createGrader, 200, 'teacher creates grader');
const graderLogin = await call('/api/staff/login', {
  method: 'POST',
  json: { email: graderEmail, password: 'GradeAssistant!2026' },
});
expectStatus(graderLogin, 200, 'grader login');
const graderReview = await call(`/api/admin/attempts/${submitted.result.attemptId}`, {
  method: 'PATCH',
  cookie: graderLogin.cookie,
  json: { score: 9, feedback: 'Reviewed' },
});
expectStatus(graderReview, 200, 'grader can edit grades');
const graderCourse = await call('/api/admin/courses', {
  method: 'POST',
  cookie: graderLogin.cookie,
  json: { title: 'Forbidden course', grade: 'أولى ثانوي' },
});
expectStatus(graderCourse, 403, 'grader cannot create courses');
const graderAssignment = await call('/api/admin/assignments', {
  method: 'POST',
  cookie: graderLogin.cookie,
  json: { courseId, title: 'Forbidden assignment' },
});
expectStatus(graderAssignment, 403, 'grader cannot create assignments');

const managerEmail = `manager-${suffix}@staff.test`;
const createManager = await call('/api/admin/staff', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: {
    name: 'Course Assistant',
    email: managerEmail,
    password: 'CourseManager!2026',
    role: 'assistant',
    preset: 'course_manager',
  },
});
expectStatus(createManager, 200, 'teacher creates course manager');
const managerLogin = await call('/api/staff/login', {
  method: 'POST',
  json: { email: managerEmail, password: 'CourseManager!2026' },
});
expectStatus(managerLogin, 200, 'course manager login');
const managerCourse = await call('/api/admin/courses', {
  method: 'POST',
  cookie: managerLogin.cookie,
  json: { title: `Manager Course ${suffix}`, grade: 'أولى ثانوي', status: 'draft' },
});
expectStatus(managerCourse, 200, 'course manager can create courses');
const managerAssignment = await call('/api/admin/assignments', {
  method: 'POST',
  cookie: managerLogin.cookie,
  json: {
    courseId,
    title: `Assistant Homework ${suffix}`,
    description: 'Created by an authorized assistant',
    status: 'published',
  },
});
expectStatus(managerAssignment, 200, 'course manager assistant can create assignments');
const managerGrade = await call(`/api/admin/attempts/${submitted.result.attemptId}`, {
  method: 'PATCH',
  cookie: managerLogin.cookie,
  json: { score: 8 },
});
expectStatus(managerGrade, 403, 'course manager cannot edit grades');

const preResetLogin = await call('/api/auth/login', {
  method: 'POST',
  json: { email: studentEmail, password: studentPassword },
});
expectStatus(preResetLogin, 200, 'student signs in before password reset');
const resetRequest = await call('/api/auth/forgot-password', {
  method: 'POST',
  json: { email: studentEmail },
});
expectStatus(resetRequest, 200, 'student requests a purpose-specific reset code');
assert.match(resetRequest.result.testCode, /^\d{6}$/);
const newStudentPassword = 'NewStudent!2026';
const resetPassword = await call('/api/auth/reset-password', {
  method: 'POST',
  json: {
    email: studentEmail,
    code: resetRequest.result.testCode,
    new_password: newStudentPassword,
  },
});
expectStatus(resetPassword, 200, 'student consumes reset code once');
const replayReset = await call('/api/auth/reset-password', {
  method: 'POST',
  json: {
    email: studentEmail,
    code: resetRequest.result.testCode,
    new_password: 'ReplayBlocked!2026',
  },
});
expectStatus(replayReset, 400, 'password reset code replay is rejected');
const revokedSession = await call('/api/dashboard', { cookie: preResetLogin.cookie });
expectStatus(revokedSession, 401, 'password reset revokes existing sessions');
const postResetLogin = await call('/api/auth/login', {
  method: 'POST',
  json: { email: studentEmail, password: newStudentPassword },
});
expectStatus(postResetLogin, 200, 'new student password works');

const accountDeletion = await call('/api/users/me', {
  method: 'DELETE',
  cookie: postResetLogin.cookie,
  json: { password: newStudentPassword },
});
expectStatus(accountDeletion, 200, 'student account and birth certificate are deleted');

console.log(
  'E2E PASS: auth, reset, course/exam editing, assignments, read notifications, payment, quiz timing/gate, completion proof, storage deletion, and staff permissions'
);
