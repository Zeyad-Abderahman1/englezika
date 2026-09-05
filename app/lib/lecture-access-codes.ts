import { randomBytes } from 'node:crypto';
import type { Database } from './database';
import { getPlatformEnv } from './platform';

const CODE_ALPHABET = '123456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_GROUPS = 6;
const CODE_GROUP_LENGTH = 5;
const CODE_PATTERN = /^ENG[123456789ABCDEFGHJKMNPQRSTUVWXYZ]{30}$/;
const QR_TOKEN_PATTERN = /^eqr_[A-Za-z0-9_-]{24,80}$/;

export type LectureAccessCodeDatabase = Pick<Database, 'prepare'>;

export type RedeemLectureCodeResult =
  | { status: 'success'; courseId: string; videoId: string; videoTitle: string; courseTitle: string }
  | { status: 'invalid_code' }
  | { status: 'already_used' };

export type QRCodeInfoResult =
  | {
      status: 'available';
      videoId: string;
      videoTitle: string;
      courseId: string;
      courseTitle: string;
    }
  | {
      status: 'already_used';
      videoId: string;
      videoTitle: string;
      courseId: string;
      courseTitle: string;
      redeemedAt: number | null;
    }
  | { status: 'invalid_token' };

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a cryptographically secure, URL-safe QR token.
 * 24 bytes of entropy = 192 bits, prefixed with 'eqr_'.
 */
export function generateLectureQRToken(): string {
  const bytes = randomBytes(24);
  return `eqr_${bytes.toString('base64url')}`;
}

/**
 * Legacy code generator (kept for backward compatibility with existing tests).
 */
export function generateLectureAccessCode(): string {
  const random = randomBytes(CODE_GROUPS * CODE_GROUP_LENGTH);
  const characters = Array.from(random, (byte) => CODE_ALPHABET[byte & 31]).join('');
  const groups = Array.from({ length: CODE_GROUPS }, (_, index) =>
    characters.slice(index * CODE_GROUP_LENGTH, (index + 1) * CODE_GROUP_LENGTH)
  );
  return `ENG-${groups.join('-')}`;
}

/**
 * Normalizes and strictly validates a single-use QR token.
 * Only tokens matching the secure 'eqr_' format are accepted.
 * All legacy manual/typed codes are rejected.
 */
export function normalizeLectureQRToken(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 120) return null;
  const trimmed = value.trim();
  if (QR_TOKEN_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export const normalizeLectureAccessCode = normalizeLectureQRToken;

/**
 * Computes SHA-256 hash of a normalized token or code.
 */
export async function hashLectureAccessCode(normalizedCode: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizedCode));
  return bytesToHex(new Uint8Array(digest));
}

export const hashLectureQRToken = hashLectureAccessCode;

/**
 * Returns a short suffix for admin UI display (last 6 characters).
 */
export function lectureAccessCodeSuffix(normalizedCode: string): string {
  return normalizedCode.slice(-6);
}

export const lectureQRCodeSuffix = lectureAccessCodeSuffix;

/**
 * Builds the canonical student QR scan URL for a given token.
 */
export function buildLectureQRUrl(token: string, baseOrigin?: string): string {
  const origin = (baseOrigin || getPlatformEnv().APP_URL || '').replace(/\/+$/, '');
  const cleanToken = token.trim();
  const path = `/redeem#${cleanToken}`;
  return origin ? `${origin}${path}` : path;
}

/**
 * Pre-checks token validity and retrieves lecture info without redeeming.
 */
export async function getLectureQRCodeInfo(
  db: LectureAccessCodeDatabase,
  submittedToken: unknown
): Promise<QRCodeInfoResult> {
  const normalized = normalizeLectureQRToken(submittedToken);
  if (!normalized) return { status: 'invalid_token' };

  const codeHash = await hashLectureQRToken(normalized);
  const row = await db
    .prepare(
      `SELECT c.id AS "courseId", c.title AS "courseTitle",
              v.id AS "videoId", v.title AS "videoTitle",
              lac.redeemed_at AS "redeemedAt"
       FROM lecture_access_codes lac
       JOIN videos v ON v.id = lac.video_id
       JOIN courses c ON c.id = lac.course_id
       WHERE lac.code_hash = ?`
    )
    .bind(codeHash)
    .first<{
      courseId: string;
      courseTitle: string;
      videoId: string;
      videoTitle: string;
      redeemedAt: number | null;
    }>();

  if (!row) return { status: 'invalid_token' };

  if (row.redeemedAt !== null && row.redeemedAt !== undefined) {
    return {
      status: 'already_used',
      videoId: row.videoId,
      videoTitle: row.videoTitle,
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      redeemedAt: Number(row.redeemedAt),
    };
  }

  return {
    status: 'available',
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
  };
}

/**
 * Transactionally redeems a single-use QR token for a student account.
 */
export async function redeemLectureAccessCode(
  db: LectureAccessCodeDatabase,
  studentEmail: string,
  submittedCode: unknown
): Promise<RedeemLectureCodeResult> {
  const normalizedCode = normalizeLectureQRToken(submittedCode);
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

export const redeemLectureQRCode = redeemLectureAccessCode;

/**
 * Checks whether a student already has access to a specific video (either via course enrollment or direct grant).
 */
export async function hasLectureAccess(
  db: LectureAccessCodeDatabase,
  studentEmail: string,
  videoId: string
): Promise<boolean> {
  const email = studentEmail.trim().toLowerCase();
  const row = await db
    .prepare(
      `SELECT 1
       FROM videos v
       WHERE v.id = ?
         AND (
           EXISTS (
             SELECT 1 FROM enrollments e
             WHERE e.course_id = v.course_id AND e.user_email = ? AND e.status = 'approved'
           )
           OR EXISTS (
             SELECT 1 FROM student_video_access_grants g
             WHERE g.video_id = v.id AND g.student_email = ?
           )
         )
       LIMIT 1`
    )
    .bind(videoId, email, email)
    .first();
  return Boolean(row);
}

