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

  const submissions = await db
    .prepare(
      `SELECT id, pdf_storage_key AS pdfStorageKey
       FROM assignment_submissions
       WHERE student_email = ?`
    )
    .bind(normalized)
    .all<{ id: string; pdfStorageKey: string | null }>()
    .catch(() => ({ results: [] as { id: string; pdfStorageKey: string | null }[] }));

  if (student.birthCertificateKey) {
    await bucket.delete(student.birthCertificateKey);
  }

  for (const sub of submissions.results) {
    if (sub.pdfStorageKey) {
      await bucket.delete(sub.pdfStorageKey);
    }
  }

  const tombstoneEmail = `deleted+${crypto.randomUUID()}@deleted.invalid`;

  const [, , , accountUpdate] = await db.batch([
    db
      .prepare(
        `UPDATE lecture_access_codes SET redeemed_by_student_email = NULL
         WHERE redeemed_by_student_email = ?`
      )
      .bind(normalized),
    db.prepare('DELETE FROM student_video_access_grants WHERE student_email = ?').bind(normalized),
    db
      .prepare(
        `UPDATE assignment_submissions
         SET student_email = ?, pdf_storage_key = NULL
         WHERE student_email = ?`
      )
      .bind(tombstoneEmail, normalized),
    db
      .prepare(
        `UPDATE users SET
           email = ?,
           original_email = ?,
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
      .bind(tombstoneEmail, normalized, now, normalized),
    db.prepare('DELETE FROM native_sessions WHERE email = ?').bind(normalized),
    db.prepare('DELETE FROM notification_reads WHERE user_email = ?').bind(normalized),
  ]);

  return accountUpdate.meta.changes === 1;
}
