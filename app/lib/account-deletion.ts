import type { Database, PrivateStorage } from './platform';

export async function deleteStudentAccountData(
  db: Database,
  bucket: PrivateStorage,
  email: string,
  now = Date.now()
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const student = await db
    .prepare(
      `SELECT birth_certificate_key AS birthCertificateKey
       FROM users WHERE email = ? AND role = 'student'`
    )
    .bind(normalized)
    .first<{ birthCertificateKey: string | null }>();
  if (!student) return false;

  if (student.birthCertificateKey) {
    await bucket.delete(student.birthCertificateKey);
  }

  const [accountUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE users SET
           name = '[deleted]',
           first_name = '',
           second_name = '',
           third_name = '',
           last_name = '',
           phone = '',
           father_phone = '',
           mother_phone = '',
           school_name = '',
           parent_job = '',
           governorate = '',
           gender = '',
           grade = '',
           section = '',
           birth_certificate_key = NULL,
           birth_certificate_content_type = NULL,
           password_hash = '',
           password_salt = '',
           password_iterations = 0,
           role = 'deleted',
           updated_at = ?
         WHERE email = ? AND role = 'student'`
      )
      .bind(now, normalized),
    db.prepare('DELETE FROM native_sessions WHERE email = ?').bind(normalized),
    db.prepare('DELETE FROM notification_reads WHERE user_email = ?').bind(normalized),
  ]);

  return accountUpdate.meta.changes === 1;
}
