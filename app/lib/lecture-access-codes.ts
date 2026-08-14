import { randomBytes } from 'node:crypto';
import type { Database } from './database';

const CODE_ALPHABET = '123456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_GROUPS = 6;
const CODE_GROUP_LENGTH = 5;
const NORMALIZED_CODE_PATTERN = /^ENG[123456789ABCDEFGHJKMNPQRSTUVWXYZ]{30}$/;

export type LectureAccessCodeDatabase = Pick<Database, 'prepare'>;

export type RedeemLectureCodeResult =
  | { status: 'success'; courseId: string; videoId: string; videoTitle: string; courseTitle: string }
  | { status: 'invalid_code' }
  | { status: 'already_used' };

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateLectureAccessCode(): string {
  const random = randomBytes(CODE_GROUPS * CODE_GROUP_LENGTH);
  const characters = Array.from(random, (byte) => CODE_ALPHABET[byte & 31]).join('');
  const groups = Array.from({ length: CODE_GROUPS }, (_, index) =>
    characters.slice(index * CODE_GROUP_LENGTH, (index + 1) * CODE_GROUP_LENGTH)
  );
  return `ENG-${groups.join('-')}`;
}

export function normalizeLectureAccessCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 96) return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '');
  return NORMALIZED_CODE_PATTERN.test(normalized) ? normalized : null;
}

export async function hashLectureAccessCode(normalizedCode: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedCode));
  return bytesToHex(new Uint8Array(digest));
}

export function lectureAccessCodeSuffix(normalizedCode: string): string {
  return normalizedCode.slice(-5);
}

export async function redeemLectureAccessCode(
  db: LectureAccessCodeDatabase,
  studentEmail: string,
  submittedCode: unknown
): Promise<RedeemLectureCodeResult> {
  const normalizedCode = normalizeLectureAccessCode(submittedCode);
  if (!normalizedCode) return { status: 'invalid_code' };

  const codeHash = await hashLectureAccessCode(normalizedCode);
  const email = studentEmail.trim().toLowerCase();
  const now = Date.now();
  const redeemed = await db
    .prepare(
      `WITH candidate AS (
         SELECT access_code.id, access_code.course_id, access_code.video_id
         FROM lecture_access_codes AS access_code
         JOIN videos ON videos.id = access_code.video_id AND videos.course_id = access_code.course_id
         WHERE access_code.code_hash = ?
           AND access_code.redeemed_at IS NULL
           AND access_code.redeemed_by_student_email IS NULL
         FOR UPDATE
       ), granted AS (
         INSERT INTO student_video_access_grants
           (id, student_email, video_id, source, source_access_code_id, created_at)
         SELECT ?, ?, video_id, 'one_time_code', id, ? FROM candidate
         ON CONFLICT DO NOTHING
         RETURNING source_access_code_id
       ), claimed AS (
         UPDATE lecture_access_codes AS access_code
         SET redeemed_by_student_email = ?, redeemed_at = ?
         FROM candidate
         JOIN granted ON granted.source_access_code_id = candidate.id
         WHERE access_code.id = candidate.id
         RETURNING access_code.id, access_code.course_id, access_code.video_id
       )
       SELECT c.course_id AS courseId, c.video_id AS videoId,
              v.title AS videoTitle, courses.title AS courseTitle
       FROM claimed c
       JOIN videos v ON v.id = c.video_id AND v.course_id = c.course_id
       JOIN courses ON courses.id = c.course_id`
    )
    .bind(codeHash, crypto.randomUUID(), email, now, email, now)
    .first<{ courseId: string; videoId: string; videoTitle: string; courseTitle: string }>();

  if (redeemed) return { status: 'success', ...redeemed };

  const existing = await db
    .prepare('SELECT redeemed_at AS redeemedAt FROM lecture_access_codes WHERE code_hash = ?')
    .bind(codeHash)
    .first<{ redeemedAt: number | null }>();
  return { status: existing?.redeemedAt ? 'already_used' : 'invalid_code' };
}
