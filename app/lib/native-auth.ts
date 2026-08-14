import { getDatabase } from './platform';
import { hashPassword } from './staff-auth';

export { hashPassword };

export const STUDENT_PASSWORD_ITERATIONS = 100_000;

export type StudentRow = {
  email: string;
  name: string;
  firstName: string;
  secondName: string;
  thirdName: string;
  lastName: string;
  phone: string;
  fatherPhone: string;
  motherPhone: string;
  schoolName: string;
  parentJob: string;
  governorate: string;
  gender: string;
  grade: string;
  section: string;
  birthCertificateKey?: string;
  birthCertificateContentType?: string;
  accountUseAgreementAcceptedAt?: number;
  accountUseAgreementVersion?: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  role: string;
  failedAttempts?: number;
  lockedUntil?: number | null;
};

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

/** Look up a student by email. Returns null if not found. */
export async function findStudentByEmail(email: string): Promise<StudentRow | null> {
  return getDatabase()
    .prepare(
      `SELECT email, name,
     first_name AS firstName, second_name AS secondName, third_name AS thirdName, last_name AS lastName,
     phone, father_phone AS fatherPhone, mother_phone AS motherPhone,
     school_name AS schoolName, parent_job AS parentJob,
     governorate, gender, grade, section,
     password_hash AS passwordHash, password_salt AS passwordSalt,
     password_iterations AS passwordIterations, role,
     failed_attempts AS failedAttempts, locked_until AS lockedUntil
     FROM users WHERE email = ?`
    )
    .bind(email.trim().toLowerCase())
    .first<StudentRow>();
}

/** Returns true if the password matches the stored hash. Enforces account lockout (SEC-01). */
export async function verifyStudentPassword(
  email: string,
  password: string
): Promise<StudentRow | null> {
  const row = await findStudentByEmail(email);
  const dummySalt = '00000000000000000000000000000000';
  if (!row || !row.passwordHash) {
    // Run dummy hash to maintain constant time
    await hashPassword(password, dummySalt, STUDENT_PASSWORD_ITERATIONS);
    return null;
  }
  const now = Date.now();
  if (row.lockedUntil && row.lockedUntil > now) {
    await hashPassword(
      password,
      row.passwordSalt,
      row.passwordIterations || STUDENT_PASSWORD_ITERATIONS
    );
    return null;
  }

  const candidate = await hashPassword(
    password,
    row.passwordSalt,
    row.passwordIterations || STUDENT_PASSWORD_ITERATIONS
  );
  if (!constantTimeEqual(candidate.hash, row.passwordHash)) {
    const failures = Number(row.failedAttempts || 0) + 1;
    const lockedUntil = failures >= 5 ? now + 15 * 60_000 : null;
    await getDatabase()
      .prepare(
        'UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE email = ?'
      )
      .bind(failures, lockedUntil, now, row.email.toLowerCase())
      .run();
    return null;
  }

  // Reset lockout counters on success
  await getDatabase()
    .prepare(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE email = ?'
    )
    .bind(now, row.email.toLowerCase())
    .run();

  return row;
}

/** Register a new student with all extended fields. Throws if email already taken. */
export async function registerStudent(data: {
  email: string;
  password: string;
  firstName: string;
  secondName: string;
  thirdName: string;
  lastName: string;
  phone: string;
  fatherPhone: string;
  motherPhone: string;
  schoolName: string;
  parentJob: string;
  governorate: string;
  gender: string;
  grade: string;
  section: string;
  birthCertificateKey: string;
  birthCertificateContentType: string;
  accountUseAgreementAcceptedAt: number;
  accountUseAgreementVersion: string;
}): Promise<'ok' | 'email_taken'> {
  const email = data.email.trim().toLowerCase();
  const existing = await findStudentByEmail(email);
  if (existing) return 'email_taken';

  const { hash, salt, iterations } = await hashPassword(
    data.password,
    undefined,
    STUDENT_PASSWORD_ITERATIONS
  );
  const fullName = [data.firstName, data.secondName, data.thirdName, data.lastName]
    .filter(Boolean)
    .join(' ');
  const now = Date.now();

  const result = await getDatabase()
    .prepare(
      `INSERT INTO users
     (email, name, first_name, second_name, third_name, last_name,
      phone, father_phone, mother_phone, school_name, parent_job,
      governorate, gender, grade, section, birth_certificate_key,
      birth_certificate_content_type, account_use_agreement_accepted_at,
      account_use_agreement_version,
      password_hash, password_salt, password_iterations,
      role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'student', ?, ?)
     ON CONFLICT(email) DO NOTHING`
    )
    .bind(
      email,
      fullName,
      data.firstName.trim(),
      data.secondName.trim(),
      data.thirdName.trim(),
      data.lastName.trim(),
      data.phone.trim(),
      data.fatherPhone.trim(),
      data.motherPhone.trim(),
      data.schoolName.trim(),
      data.parentJob.trim(),
      data.governorate.trim(),
      data.gender.trim(),
      data.grade.trim(),
      data.section.trim(),
      data.birthCertificateKey,
      data.birthCertificateContentType,
      data.accountUseAgreementAcceptedAt,
      data.accountUseAgreementVersion,
      hash,
      salt,
      iterations,
      now,
      now
    )
    .run();

  return result.meta.changes === 1 ? 'ok' : 'email_taken';
}

/** Update an existing student's password and revoke every active session. */
export async function updateStudentPassword(email: string, newPassword: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const { hash, salt, iterations } = await hashPassword(
    newPassword,
    undefined,
    STUDENT_PASSWORD_ITERATIONS
  );
  const now = Date.now();

  const db = getDatabase();
  const [passwordUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE users
       SET password_hash = ?, password_salt = ?, password_iterations = ?,
           failed_attempts = 0, locked_until = NULL, updated_at = ?
       WHERE email = ? AND role = 'student'`
      )
      .bind(hash, salt, iterations, now, normalized),
    db.prepare('DELETE FROM native_sessions WHERE email = ?').bind(normalized),
  ]);

  return passwordUpdate.meta.changes === 1;
}
