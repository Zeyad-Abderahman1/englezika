import { ensureDatabase } from "../../db/runtime";
import { getD1 } from "./platform";
import { hashPassword } from "./staff-auth";

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
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  role: string;
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
  await ensureDatabase();
  return getD1().prepare(
    `SELECT email, name,
     first_name AS firstName, second_name AS secondName, third_name AS thirdName, last_name AS lastName,
     phone, father_phone AS fatherPhone, mother_phone AS motherPhone,
     school_name AS schoolName, parent_job AS parentJob,
     governorate, gender, grade, section,
     password_hash AS passwordHash, password_salt AS passwordSalt,
     password_iterations AS passwordIterations, role
     FROM users WHERE email = ?`,
  ).bind(email.trim().toLowerCase()).first<StudentRow>();
}

/** Returns true if the password matches the stored hash. Runs dummy hash on miss to prevent timing attacks. */
export async function verifyStudentPassword(email: string, password: string): Promise<StudentRow | null> {
  const row = await findStudentByEmail(email);
  const dummySalt = "00000000000000000000000000000000";
  if (!row || !row.passwordHash) {
    // Run dummy hash to maintain constant time
    await hashPassword(password, dummySalt, STUDENT_PASSWORD_ITERATIONS);
    return null;
  }
  const candidate = await hashPassword(password, row.passwordSalt, row.passwordIterations || STUDENT_PASSWORD_ITERATIONS);
  if (!constantTimeEqual(candidate.hash, row.passwordHash)) return null;
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
}): Promise<"ok" | "email_taken"> {
  await ensureDatabase();
  const email = data.email.trim().toLowerCase();
  const existing = await findStudentByEmail(email);
  if (existing?.passwordHash) return "email_taken";

  const { hash, salt, iterations } = await hashPassword(data.password, undefined, STUDENT_PASSWORD_ITERATIONS);
  const fullName = [data.firstName, data.secondName, data.thirdName, data.lastName].filter(Boolean).join(" ");
  const now = Date.now();

  await getD1().prepare(
    `INSERT INTO users
     (email, name, first_name, second_name, third_name, last_name,
      phone, father_phone, mother_phone, school_name, parent_job,
      governorate, gender, grade, section,
      password_hash, password_salt, password_iterations,
      role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'student', ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       first_name = excluded.first_name, second_name = excluded.second_name,
       third_name = excluded.third_name, last_name = excluded.last_name,
       phone = excluded.phone, father_phone = excluded.father_phone,
       mother_phone = excluded.mother_phone, school_name = excluded.school_name,
       parent_job = excluded.parent_job, governorate = excluded.governorate,
       gender = excluded.gender, grade = excluded.grade, section = excluded.section,
       password_hash = excluded.password_hash, password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       updated_at = excluded.updated_at
     WHERE users.password_hash = ''`,
  ).bind(
    email, fullName,
    data.firstName.trim(), data.secondName.trim(), data.thirdName.trim(), data.lastName.trim(),
    data.phone.trim(), data.fatherPhone.trim(), data.motherPhone.trim(),
    data.schoolName.trim(), data.parentJob.trim(),
    data.governorate.trim(), data.gender.trim(), data.grade.trim(), data.section.trim(),
    hash, salt, iterations,
    now, now,
  ).run();

  return "ok";
}
