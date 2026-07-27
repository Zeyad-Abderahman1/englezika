import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  email: text('email').primaryKey(),
  name: text('name'),
  phone: text('phone'),
  grade: text('grade'),
  role: text('role').notNull().default('student'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const emailVerifications = sqliteTable('email_verifications', {
  email: text('email').primaryKey(),
  codeHash: text('code_hash').notNull(),
  expiresAt: integer('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  sentAt: integer('sent_at').notNull(),
  verifiedAt: integer('verified_at'),
  deliveryId: text('delivery_id'),
});

export const courses = sqliteTable('courses', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  grade: text('grade').notNull(),
  description: text('description').notNull().default(''),
  price: integer('price').notNull().default(0),
  status: text('status').notNull().default('draft'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const enrollments = sqliteTable(
  'enrollments',
  {
    id: text('id').primaryKey(),
    userEmail: text('user_email').notNull(),
    courseId: text('course_id').notNull(),
    status: text('status').notNull().default('pending'),
    paymentMethod: text('payment_method'),
    paymentReference: text('payment_reference'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('enrollments_user_idx').on(table.userEmail),
    index('enrollments_course_idx').on(table.courseId),
  ]
);

export const paymentIntents = sqliteTable(
  'payment_intents',
  {
    id: text('id').primaryKey(),
    enrollmentId: text('enrollment_id').notNull(),
    userEmail: text('user_email').notNull(),
    courseId: text('course_id').notNull(),
    gateway: text('gateway').notNull().default('fawaterak'),
    transactionKey: text('transaction_key'),
    transactionId: text('transaction_id'),
    amountMinor: integer('amount_minor').notNull(),
    paidAmountMinor: integer('paid_amount_minor'),
    currency: text('currency').notNull().default('EGP'),
    status: text('status').notNull().default('creating'),
    paymentMethod: text('payment_method'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    paidAt: integer('paid_at'),
  },
  (table) => [
    uniqueIndex('payment_intents_transaction_key_idx').on(table.transactionKey),
    index('payment_intents_enrollment_idx').on(table.enrollmentId),
    index('payment_intents_user_idx').on(table.userEmail),
  ]
);

export const exams = sqliteTable(
  'exams',
  {
    id: text('id').primaryKey(),
    courseId: text('course_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    passingScore: integer('passing_score').notNull().default(50),
    maxAttempts: integer('max_attempts').notNull().default(3),
    status: text('status').notNull().default('draft'),
    opensAt: integer('opens_at'),
    closesAt: integer('closes_at'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('exams_course_idx').on(table.courseId)]
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    examId: text('exam_id').notNull(),
    sortOrder: integer('sort_order').notNull(),
    type: text('type').notNull(),
    prompt: text('prompt').notNull(),
    options: text('options'),
    correctAnswer: text('correct_answer').notNull(),
    rubric: text('rubric').notNull().default(''),
    points: integer('points').notNull().default(1),
  },
  (table) => [index('questions_exam_idx').on(table.examId)]
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    examId: text('exam_id').notNull(),
    userEmail: text('user_email').notNull(),
    status: text('status').notNull().default('submitted'),
    score: integer('score').notNull().default(0),
    maxScore: integer('max_score').notNull().default(0),
    feedback: text('feedback').notNull().default(''),
    gradingMethod: text('grading_method').notNull().default('rules'),
    startedAt: integer('started_at').notNull(),
    submittedAt: integer('submitted_at').notNull(),
  },
  (table) => [
    index('attempts_exam_idx').on(table.examId),
    index('attempts_user_idx').on(table.userEmail),
  ]
);

export const examSessions = sqliteTable(
  'exam_sessions',
  {
    id: text('id').primaryKey(),
    examId: text('exam_id').notNull(),
    userEmail: text('user_email').notNull(),
    startedAt: integer('started_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    status: text('status').notNull().default('active'),
  },
  (table) => [uniqueIndex('exam_sessions_exam_user_idx').on(table.examId, table.userEmail)]
);

export const answers = sqliteTable(
  'answers',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id').notNull(),
    questionId: text('question_id').notNull(),
    answer: text('answer').notNull().default(''),
    score: integer('score').notNull().default(0),
    feedback: text('feedback').notNull().default(''),
  },
  (table) => [index('answers_attempt_idx').on(table.attemptId)]
);

export const videos = sqliteTable(
  'videos',
  {
    id: text('id').primaryKey(),
    courseId: text('course_id').notNull(),
    title: text('title').notNull(),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull().default('video/mp4'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    prerequisiteExamId: text('prerequisite_exam_id'),
    minimumScore: integer('minimum_score').notNull().default(0),
    status: text('status').notNull().default('published'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('videos_course_idx').on(table.courseId)]
);

export const videoProgress = sqliteTable(
  'video_progress',
  {
    id: text('id').primaryKey(),
    userEmail: text('user_email').notNull(),
    videoId: text('video_id').notNull(),
    completedAt: integer('completed_at').notNull(),
  },
  (table) => [
    uniqueIndex('video_progress_user_video_idx').on(table.userEmail, table.videoId),
    index('video_progress_video_idx').on(table.videoId),
  ]
);

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('new'),
  createdAt: integer('created_at').notNull(),
});

export const announcements = sqliteTable('announcements', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('published'),
  createdAt: integer('created_at').notNull(),
});

export const staffUsers = sqliteTable('staff_users', {
  email: text('email').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  permissions: text('permissions').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  passwordIterations: integer('password_iterations').notNull(),
  active: integer('active').notNull().default(1),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const staffSessions = sqliteTable(
  'staff_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    staffEmail: text('staff_email')
      .notNull()
      .references(() => staffUsers.email, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeen: integer('last_seen').notNull(),
  },
  (table) => [
    index('staff_sessions_email_idx').on(table.staffEmail),
    index('staff_sessions_expiry_idx').on(table.expiresAt),
  ]
);

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    resetAt: integer('reset_at').notNull(),
  },
  (table) => [index('rate_limits_reset_idx').on(table.resetAt)]
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    userEmail: text('user_email').notNull(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id'),
    details: text('details'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('audit_logs_user_idx').on(table.userEmail),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_idx').on(table.createdAt),
  ]
);
