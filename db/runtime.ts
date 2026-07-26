import { getD1 } from '../app/lib/platform';
import { getPlatformEnv } from '../app/lib/platform';
import { STAFF_PRESETS } from '../app/lib/staff-permissions';

let initialization: Promise<void> | null = null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY, name TEXT, phone TEXT, grade TEXT,
    role TEXT NOT NULL DEFAULT 'student', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_verifications (
    email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL,
    verified_at INTEGER, delivery_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, grade TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY, user_email TEXT NOT NULL, course_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT, payment_reference TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS enrollments_user_idx ON enrollments (user_email)',
  'CREATE INDEX IF NOT EXISTS enrollments_course_idx ON enrollments (course_id)',
  `CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL, user_email TEXT NOT NULL,
    course_id TEXT NOT NULL, gateway TEXT NOT NULL DEFAULT 'fawaterak',
    transaction_key TEXT, transaction_id TEXT, amount_minor INTEGER NOT NULL,
    paid_amount_minor INTEGER, currency TEXT NOT NULL DEFAULT 'EGP',
    status TEXT NOT NULL DEFAULT 'creating', payment_method TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, paid_at INTEGER
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_transaction_key_idx ON payment_intents (transaction_key)',
  'CREATE INDEX IF NOT EXISTS payment_intents_enrollment_idx ON payment_intents (enrollment_id)',
  'CREATE INDEX IF NOT EXISTS payment_intents_user_idx ON payment_intents (user_email)',
  `CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY, course_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '', duration_minutes INTEGER NOT NULL DEFAULT 30,
    passing_score INTEGER NOT NULL DEFAULT 50, max_attempts INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'draft',
    opens_at INTEGER, closes_at INTEGER, created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS exams_course_idx ON exams (course_id)',
  `CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, sort_order INTEGER NOT NULL, type TEXT NOT NULL,
    prompt TEXT NOT NULL, options TEXT, correct_answer TEXT NOT NULL, rubric TEXT NOT NULL DEFAULT '',
    points INTEGER NOT NULL DEFAULT 1
  )`,
  'CREATE INDEX IF NOT EXISTS questions_exam_idx ON questions (exam_id)',
  `CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted', score INTEGER NOT NULL DEFAULT 0,
    max_score INTEGER NOT NULL DEFAULT 0, feedback TEXT NOT NULL DEFAULT '',
    grading_method TEXT NOT NULL DEFAULT 'rules', started_at INTEGER NOT NULL, submitted_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS attempts_exam_idx ON attempts (exam_id)',
  'CREATE INDEX IF NOT EXISTS attempts_user_idx ON attempts (user_email)',
  `CREATE TABLE IF NOT EXISTS exam_sessions (
    id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_email TEXT NOT NULL,
    started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active'
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS exam_sessions_exam_user_idx ON exam_sessions (exam_id, user_email)',
  `CREATE TABLE IF NOT EXISTS answers (
    id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, question_id TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '', score INTEGER NOT NULL DEFAULT 0, feedback TEXT NOT NULL DEFAULT ''
  )`,
  'CREATE INDEX IF NOT EXISTS answers_attempt_idx ON answers (attempt_id)',
  `CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, course_id TEXT NOT NULL, title TEXT NOT NULL, r2_key TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'video/mp4', duration_seconds INTEGER NOT NULL DEFAULT 0,
    prerequisite_exam_id TEXT, minimum_score INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS videos_course_idx ON videos (course_id)',
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS native_sessions (
    session_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS native_sessions_email_idx ON native_sessions (email)',
  'CREATE INDEX IF NOT EXISTS native_sessions_expiry_idx ON native_sessions (expires_at)',
  `CREATE TABLE IF NOT EXISTS staff_users (
    email TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, permissions TEXT NOT NULL,
    password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS staff_sessions (
    token_hash TEXT PRIMARY KEY, staff_email TEXT NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS staff_sessions_email_idx ON staff_sessions (staff_email)',
  'CREATE INDEX IF NOT EXISTS staff_sessions_expiry_idx ON staff_sessions (expires_at)',
];

const seedCourses = [
  ['sep-3', 'شهر سبتمبر', 'تالتة ثانوي', 'شرح وتدريب شامل على منهج سبتمبر.', 150, 'published'],
  ['oct-3', 'شهر أكتوبر', 'تالتة ثانوي', 'شرح وتدريب شامل على منهج أكتوبر.', 150, 'published'],
  ['sep-2', 'شهر سبتمبر', 'تانية ثانوي', 'شرح منظم لطلاب الصف الثاني الثانوي.', 120, 'published'],
  ['sep-1', 'شهر سبتمبر', 'أولى ثانوي', 'تأسيس قوي لطلاب الصف الأول الثانوي.', 100, 'published'],
  [
    'grammar-2',
    'تأسيس الجرامر',
    'تانية ثانوي',
    'قواعد اللغة الإنجليزية من الأساس للاحتراف.',
    180,
    'published',
  ],
] as const;

export function ensureDatabase(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    const db = getD1();
    // Enforce foreign key constraints (DB-04)
    await db
      .prepare('PRAGMA foreign_keys = ON;')
      .run()
      .catch(() => {});
    await db.batch(schemaStatements.map((sql) => db.prepare(sql)));
    // Additional composite indexes (DB-02)
    const extraIndexes = [
      'CREATE INDEX IF NOT EXISTS enrollments_user_course_idx ON enrollments (user_email, course_id, status)',
      'CREATE INDEX IF NOT EXISTS attempts_user_exam_idx ON attempts (user_email, exam_id)',
      'CREATE INDEX IF NOT EXISTS attempts_submitted_idx ON attempts (submitted_at)',
      'CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)',
      'CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits (reset_at)',
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, user_email TEXT NOT NULL, action TEXT NOT NULL,
        resource TEXT NOT NULL, resource_id TEXT, details TEXT,
        ip TEXT, user_agent TEXT, created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_email)',
      'CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action)',
      'CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at)',
    ];
    await db.batch(extraIndexes.map((sql) => db.prepare(sql)));
    await ensureColumn(db, 'exams', 'max_attempts', 'INTEGER NOT NULL DEFAULT 3');
    await ensureColumn(db, 'videos', 'prerequisite_exam_id', 'TEXT');
    await ensureColumn(db, 'videos', 'minimum_score', 'INTEGER NOT NULL DEFAULT 0');
    // Extended student profile fields
    await ensureColumn(db, 'users', 'first_name', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'second_name', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'third_name', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'last_name', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'father_phone', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'mother_phone', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'school_name', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'parent_job', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'governorate', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'gender', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'section', "TEXT NOT NULL DEFAULT ''");
    // Native auth fields
    await ensureColumn(db, 'users', 'password_hash', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'password_salt', "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(db, 'users', 'password_iterations', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'users', 'failed_attempts', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(db, 'users', 'locked_until', 'INTEGER');
    const now = Date.now();
    await db.batch(
      seedCourses.map((course) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO courses
       (id, title, grade, description, price, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(...course, now, now)
      )
    );
    const env = getPlatformEnv();
    const initialEmail = env.INITIAL_STAFF_EMAIL?.trim().toLowerCase() || 'admin@englizeka.com';
    const initialHash =
      env.INITIAL_STAFF_PASSWORD_HASH ||
      '8c9856920b5793ba16ffb487d06dd6e45a9c032b4e2dbbafed56cabf65536de4';
    const initialSalt = env.INITIAL_STAFF_PASSWORD_SALT || 'e3c8a797c8950b1e5287fceeb1271069';
    const initialIter = Number(env.INITIAL_STAFF_PASSWORD_ITERATIONS || '100000');

    await db
      .prepare(
        `INSERT INTO staff_users
       (email, name, role, permissions, password_hash, password_salt, password_iterations,
        active, failed_attempts, locked_until, created_by, created_at, updated_at)
       VALUES (?, ?, 'teacher', ?, ?, ?, ?, 1, 0, NULL, 'platform-bootstrap', ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         password_hash = excluded.password_hash,
         password_salt = excluded.password_salt,
         password_iterations = excluded.password_iterations,
         failed_attempts = 0,
         locked_until = NULL,
         updated_at = excluded.updated_at
       WHERE staff_users.created_by = 'platform-bootstrap'`
      )
      .bind(
        initialEmail,
        env.INITIAL_STAFF_NAME?.trim() || 'مستر أحمد حسن',
        JSON.stringify(STAFF_PRESETS.full_access),
        initialHash,
        initialSalt,
        initialIter,
        now,
        now
      )
      .run();
  })().catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

async function ensureColumn(
  db: D1Database,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!info.results.some((item) => item.name === column)) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}
