import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Client } from 'pg';

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

function signPaymentWebhook(transactionId, transactionKey, paymentMethod, secret) {
  return createHmac('sha256', secret)
    .update(`TransactionId=${transactionId}&TransactionKey=${transactionKey}&PaymentMethod=${paymentMethod}`)
    .digest('hex');
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
  json: {
    courseId,
    title: `Protected lesson ${suffix}`,
    durationSeconds: 3,
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
  },
});
expectStatus(video, 200, 'teacher adds a gated YouTube lesson');
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

const otherVideo = await call('/api/admin/videos', {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: {
    courseId,
    title: `Other protected lesson ${suffix}`,
    durationSeconds: 3,
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
  },
});
expectStatus(otherVideo, 200, 'teacher adds a second protected lesson');
const otherVideoId = otherVideo.result.id;

const generatedLectureCode = await call(`/api/admin/videos/${otherVideoId}/access-codes`, {
  method: 'POST',
  cookie: teacherLogin.cookie,
  json: {},
});
expectStatus(generatedLectureCode, 201, 'authorized teacher generates one-time lecture code');
assert.match(generatedLectureCode.result.code, /^ENG(?:-[123456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}){6}$/);

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
  school_name: 'E2E School',
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
expectStatus(signedStudentHome, 200, 'signed student can open the static home page');
const dashboard = await call('/api/dashboard', { cookie: studentCookie });
expectStatus(dashboard, 200, 'student account bootstrap');
assert.equal(dashboard.result.verificationRequired, true);
const verified = await call('/api/auth/verify-code', {
  method: 'POST',
  cookie: studentCookie,
  json: { code: studentRegistration.result.testCode },
});
expectStatus(verified, 200, 'verify student email');

const anonymousRedeem = await call('/api/lecture-access-codes/redeem', {
  method: 'POST',
  json: { code: generatedLectureCode.result.code },
});
expectStatus(anonymousRedeem, 401, 'anonymous user cannot redeem a lecture code');
const studentGeneration = await call(`/api/admin/videos/${videoId}/access-codes`, {
  method: 'POST',
  cookie: studentCookie,
  json: {},
});
expectStatus(studentGeneration, 401, 'ordinary student cannot generate lecture codes');
const beforeCodeAccess = await call(`/api/videos/${otherVideoId}/resolve`, { cookie: studentCookie });
expectStatus(beforeCodeAccess, 403, 'student cannot access target lecture before redemption');
const redeemedLecture = await call('/api/lecture-access-codes/redeem', {
  method: 'POST',
  cookie: studentCookie,
  json: { code: generatedLectureCode.result.code },
});
expectStatus(redeemedLecture, 200, 'student redeems a valid one-time lecture code');
assert.equal(redeemedLecture.result.lecture.videoId, otherVideoId);
assert.equal(redeemedLecture.result.lecture.courseId, courseId);
const grantedDashboard = await call('/api/dashboard', { cookie: studentCookie });
assert.ok(grantedDashboard.result.lectureAccess.some((item) => item.videoId === otherVideoId));
const grantedVideo = await call(`/api/videos/${otherVideoId}/resolve`, { cookie: studentCookie });
expectStatus(grantedVideo, 200, 'redeemed student can resolve the selected lecture');
const unrelatedVideo = await call(`/api/videos/${videoId}/resolve`, { cookie: studentCookie });
expectStatus(unrelatedVideo, 403, 'lecture grant does not unlock another lecture or the course');
const replayByOwner = await call('/api/lecture-access-codes/redeem', {
  method: 'POST',
  cookie: studentCookie,
  json: { code: generatedLectureCode.result.code },
});
expectStatus(replayByOwner, 409, 'consumed lecture code cannot be replayed by its owner');

const secondStudentEmail = `second-${suffix}@example.test`;
const secondRegistrationForm = new FormData();
for (const [key, value] of Object.entries({
  email: secondStudentEmail,
  password: studentPassword,
  password_confirm: studentPassword,
  first_name: 'Second',
  second_name: 'Student',
  third_name: '',
  last_name: suffix,
  phone: '01000000011',
  father_phone: '01000000012',
  school_name: 'E2E School',
  governorate: 'القاهرة',
  gender: 'ذكر',
  grade: 'تالتة ثانوي',
  section: 'علمي علوم',
  account_use_agreement: 'accepted',
})) {
  secondRegistrationForm.set(key, value);
}
secondRegistrationForm.set(
  'birth_certificate',
  new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
  'certificate.png'
);
const secondRegistration = await call('/api/auth/register', {
  method: 'POST',
  body: secondRegistrationForm,
});
expectStatus(secondRegistration, 200, 'second student registration');
const secondCookie = secondRegistration.cookie;
const secondVerified = await call('/api/auth/verify-code', {
  method: 'POST',
  cookie: secondCookie,
  json: { code: secondRegistration.result.testCode },
});
expectStatus(secondVerified, 200, 'verify second student email');
const replayBySecondStudent = await call('/api/lecture-access-codes/redeem', {
  method: 'POST',
  cookie: secondCookie,
  json: { code: generatedLectureCode.result.code },
});
expectStatus(replayBySecondStudent, 409, 'another student cannot reuse the consumed code');
const secondStudentVideo = await call(`/api/videos/${otherVideoId}/resolve`, { cookie: secondCookie });
expectStatus(secondStudentVideo, 403, 'losing student receives no lecture access');
const deleteSecondStudent = await call('/api/users/me', {
  method: 'DELETE',
  cookie: secondCookie,
  json: { password: studentPassword },
});
expectStatus(deleteSecondStudent, 200, 'second E2E student cleanup');

const enrollment = await call('/api/enrollments', {
  method: 'POST',
  cookie: studentCookie,
  json: { courseId, paymentMethod: 'فودافون كاش', paymentReference: `REF-${suffix}` },
});
expectStatus(enrollment, 200, 'student submits payment');

const bootstrap = await call('/api/admin/bootstrap', { cookie: teacherLogin.cookie });
expectStatus(bootstrap, 200, 'teacher dashboard');
const redeemedHistory = bootstrap.result.accessCodes.find((item) => item.videoId === otherVideoId);
assert.ok(redeemedHistory, 'teacher sees masked lecture-code history');
assert.ok(redeemedHistory.redeemedAt, 'teacher sees the code as redeemed');
assert.equal(redeemedHistory.displaySuffix, generatedLectureCode.result.displaySuffix);
assert.equal(JSON.stringify(bootstrap.result).includes(generatedLectureCode.result.code), false);
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

const assignmentDetails = await call(`/api/student/assignments/${assignmentId}`, {
  cookie: studentCookie,
});
expectStatus(assignmentDetails, 200, 'enrolled student opens assignment');
assert.equal(assignmentDetails.result.submission, null);
const assignmentAnswer = new FormData();
assignmentAnswer.set(
  'file',
  new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])], {
    type: 'application/pdf',
  }),
  'answer.pdf'
);
const assignmentSubmission = await call(`/api/student/assignments/${assignmentId}/submit`, {
  method: 'POST',
  cookie: studentCookie,
  body: assignmentAnswer,
});
expectStatus(assignmentSubmission, 200, 'student submits a PDF assignment');
assert.ok(assignmentSubmission.result.submissionId);
const duplicateAssignmentSubmission = await call(
  `/api/student/assignments/${assignmentId}/submit`,
  {
    method: 'POST',
    cookie: studentCookie,
    body: assignmentAnswer,
  }
);
expectStatus(duplicateAssignmentSubmission, 409, 'assignment cannot be submitted twice');
const submittedAssignmentDetails = await call(`/api/student/assignments/${assignmentId}`, {
  cookie: studentCookie,
});
expectStatus(submittedAssignmentDetails, 200, 'student sees submitted assignment');
assert.equal(submittedAssignmentDetails.result.submission.status, 'submitted');
assert.equal(submittedAssignmentDetails.result.submission.hasPdf, 1);

const webhookSecret = 'e2e-fawaterak-vendor-secret';
const webhookTransactionKey = `e2e-intent-${suffix}`;
const webhookTransactionId = `e2e-transaction-${suffix}`;
const paymentDb = new Client({ connectionString: process.env.DATABASE_URL });
await paymentDb.connect();
const paymentCreatedAt = Date.now();
await paymentDb.query(
  "UPDATE enrollments SET status = 'pending', updated_at = $1 WHERE id = $2",
  [paymentCreatedAt, enrollmentRow.id]
);
await paymentDb.query(
  `INSERT INTO payment_intents
     (id, enrollment_id, user_email, course_id, gateway, transaction_key, amount_minor,
      currency, status, created_at, updated_at)
   VALUES ($1, $2, $3, $4, 'fawaterak', $5, 17500, 'EGP', 'created', $6, $6)`,
  [crypto.randomUUID(), enrollmentRow.id, studentEmail, courseId, webhookTransactionKey, paymentCreatedAt]
);
await paymentDb.end();
const webhookPayload = {
  transaction_key: webhookTransactionKey,
  transaction_id: webhookTransactionId,
  payment_method: 'Fawry',
  transactionHashKey: signPaymentWebhook(
    webhookTransactionId,
    webhookTransactionKey,
    'Fawry',
    webhookSecret
  ),
  status: 'paid',
  paidAmount: '175.00',
  paidCurrency: 'EGP',
};
const paymentWebhook = await call('/api/payments/fawaterak/webhook', {
  method: 'POST',
  json: webhookPayload,
});
expectStatus(paymentWebhook, 200, 'signed payment webhook approves enrollment');
assert.equal(paymentWebhook.result.status, 'ok');
const paymentWebhookReplay = await call('/api/payments/fawaterak/webhook', {
  method: 'POST',
  json: webhookPayload,
});
expectStatus(paymentWebhookReplay, 200, 'payment webhook is idempotent');
assert.equal(paymentWebhookReplay.result.status, 'ok');

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

const startedExam = await call(`/api/exams/${examId}/start`, {
  method: 'POST',
  cookie: studentCookie,
  json: {},
});
expectStatus(startedExam, 200, 'student starts quiz');
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
expectStatus(unlockedVideo, 409, 'raw video download remains unavailable after quiz');
const resolvedVideo = await call(`/api/videos/${videoId}/resolve`, { cookie: studentCookie });
expectStatus(resolvedVideo, 200, 'student resolves completion proof');
assert.equal(resolvedVideo.result.kind, 'youtube');
const embeddedVideo = await call(resolvedVideo.result.sourceUrl, { cookie: studentCookie });
expectStatus(embeddedVideo, 200, 'authorized student opens YouTube embed frame');
assert.match(embeddedVideo.result, /new YT\.Player/);
assert.equal(
  embeddedVideo.response.headers.get('content-security-policy'),
  "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src https://www.youtube.com https://*.googlevideo.com; img-src data: https://i.ytimg.com https://*.ggpht.com; style-src 'unsafe-inline'; frame-ancestors 'self'"
);
assert.equal(embeddedVideo.response.headers.get('x-frame-options'), 'SAMEORIGIN');
const earlyCompletion = await call(`/api/videos/${videoId}/complete`, {
  method: 'POST',
  cookie: studentCookie,
  json: { completionToken: resolvedVideo.result.completionToken },
});
expectStatus(earlyCompletion, 403, 'lesson cannot complete before required watch time');
await new Promise((resolve) => setTimeout(resolve, 3100));
const completedVideo = await call(`/api/videos/${videoId}/complete`, {
  method: 'POST',
  cookie: studentCookie,
  json: { completionToken: resolvedVideo.result.completionToken },
});
expectStatus(completedVideo, 200, 'signed lesson completion proof succeeds after watch time');

const expiryStart = await call(`/api/exams/${examId}/start`, {
  method: 'POST',
  cookie: studentCookie,
  json: {},
});
expectStatus(expiryStart, 200, 'student starts a second exam session for expiry check');
const expiryDb = new Client({ connectionString: process.env.DATABASE_URL });
await expiryDb.connect();
await expiryDb.query('UPDATE exam_sessions SET expires_at = $1 WHERE id = $2', [
  Date.now() - 1,
  expiryStart.result.session.id,
]);
await expiryDb.end();
const expiryRecovery = await call(`/api/exams/${examId}/start`, {
  method: 'POST',
  cookie: studentCookie,
  json: {},
});
expectStatus(expiryRecovery, 200, 'expired exam session is claimed before a fresh session');
assert.notEqual(expiryRecovery.result.session.id, expiryStart.result.session.id);
const expiredAttemptDb = new Client({ connectionString: process.env.DATABASE_URL });
await expiredAttemptDb.connect();
const expiredAttempt = await expiredAttemptDb.query(
  "SELECT id FROM attempts WHERE exam_id = $1 AND user_email = $2 AND status = 'expired' LIMIT 1",
  [examId, studentEmail]
);
await expiredAttemptDb.end();
assert.equal(expiredAttempt.rowCount, 1, 'expired session creates one timeout attempt');
const studentLogout = await call('/student/logout', {
  method: 'POST',
  cookie: studentCookie,
  json: {},
});
expectStatus(studentLogout, 200, 'student logout');
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
const graderLectureCode = await call(`/api/admin/videos/${videoId}/access-codes`, {
  method: 'POST',
  cookie: graderLogin.cookie,
  json: {},
});
expectStatus(graderLectureCode, 403, 'staff without manage_videos cannot generate lecture codes');

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

if (process.env.MOBILE_QA_FIXTURES === 'true') {
  console.log(
    `MOBILE_QA_FIXTURES=${JSON.stringify({ teacherEmail, teacherPassword, studentEmail, studentPassword: newStudentPassword, courseId, examId, videoId, attemptId: submitted.result.attemptId })}`
  );
} else {
  const accountDeletion = await call('/api/users/me', {
    method: 'DELETE',
    cookie: postResetLogin.cookie,
    json: { password: newStudentPassword },
  });
  expectStatus(accountDeletion, 200, 'student account and birth certificate are deleted');
}

console.log(
  `E2E PASS: auth, reset, one-time lecture code generation/redemption/isolation, course/exam editing, assignment submission and duplicate rejection, signed payment webhook approval/idempotency, read notifications, payment, quiz timing/gate/expiry, completion proof, ${process.env.MOBILE_QA_FIXTURES === 'true' ? 'mobile QA fixture retention' : 'storage deletion'}, and staff permissions`
);
