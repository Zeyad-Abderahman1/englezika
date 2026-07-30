import { createVerificationCode, sendVerificationEmail } from './email-verification';
import { getDatabase, getPlatformEnv } from './platform';

export const PASSWORD_RESET_CODE_TTL_MS = 10 * 60_000;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

export type PasswordResetCodeResult = 'verified' | 'expired' | 'invalid' | 'locked' | 'used';

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resetSecret(): string {
  const secret = getPlatformEnv().VERIFICATION_SECRET?.trim();
  if (!secret || secret.length < 24) {
    throw new Error('Password reset secret is not configured');
  }
  return secret;
}

export function createPasswordResetCode(): string {
  return createVerificationCode();
}

export async function hashPasswordResetCode(email: string, code: string): Promise<string> {
  const input = new TextEncoder().encode(
    `password-reset:${normalizedEmail(email)}:${code}:${resetSecret()}`
  );
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function savePasswordResetCode(
  email: string,
  codeHash: string,
  sentAt: number
): Promise<void> {
  await getDatabase()
    .prepare(
      `INSERT INTO password_reset_codes
       (email, code_hash, expires_at, attempts, sent_at, consumed_at, delivery_id)
       VALUES (?, ?, ?, 0, ?, NULL, NULL)
       ON CONFLICT(email) DO UPDATE SET
         code_hash = excluded.code_hash,
         expires_at = excluded.expires_at,
         attempts = 0,
         sent_at = excluded.sent_at,
         consumed_at = NULL,
         delivery_id = NULL`
    )
    .bind(normalizedEmail(email), codeHash, sentAt + PASSWORD_RESET_CODE_TTL_MS, sentAt)
    .run();
}

export async function invalidatePasswordResetCode(email: string, codeHash: string): Promise<void> {
  await getDatabase()
    .prepare(
      `UPDATE password_reset_codes SET expires_at = 0
       WHERE email = ? AND code_hash = ? AND consumed_at IS NULL`
    )
    .bind(normalizedEmail(email), codeHash)
    .run();
}

export async function recordPasswordResetDelivery(
  email: string,
  codeHash: string,
  deliveryId: string
): Promise<void> {
  await getDatabase()
    .prepare(
      `UPDATE password_reset_codes SET delivery_id = ?
       WHERE email = ? AND code_hash = ? AND consumed_at IS NULL`
    )
    .bind(deliveryId, normalizedEmail(email), codeHash)
    .run();
}

export async function sendPasswordResetEmail(
  email: string,
  code: string,
  idempotencyKey: string
): Promise<string> {
  return sendVerificationEmail(email, code, idempotencyKey);
}

export async function consumePasswordResetCode(
  email: string,
  code: string,
  now = Date.now()
): Promise<PasswordResetCodeResult> {
  const db = getDatabase();
  const normalized = normalizedEmail(email);
  const candidateHash = await hashPasswordResetCode(normalized, code);

  const claimed = await db
    .prepare(
      `UPDATE password_reset_codes
       SET consumed_at = ?, code_hash = '', expires_at = 0
       WHERE email = ? AND code_hash = ? AND consumed_at IS NULL
         AND expires_at >= ? AND attempts < ?
       RETURNING email`
    )
    .bind(now, normalized, candidateHash, now, PASSWORD_RESET_MAX_ATTEMPTS)
    .first<{ email: string }>();
  if (claimed) return 'verified';

  const row = await db
    .prepare(
      `SELECT code_hash AS codeHash, expires_at AS expiresAt, attempts, consumed_at AS consumedAt
       FROM password_reset_codes WHERE email = ?`
    )
    .bind(normalized)
    .first<{ codeHash: string; expiresAt: number; attempts: number; consumedAt: number | null }>();

  if (row?.consumedAt) return 'used';
  if (!row || row.expiresAt < now) return 'expired';
  if (row.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) return 'locked';

  const failedAttempt = await db
    .prepare(
      `UPDATE password_reset_codes
       SET attempts = attempts + 1,
           expires_at = CASE WHEN attempts + 1 >= ? THEN 0 ELSE expires_at END
       WHERE email = ? AND code_hash = ? AND consumed_at IS NULL
         AND expires_at >= ? AND attempts < ?
       RETURNING attempts`
    )
    .bind(PASSWORD_RESET_MAX_ATTEMPTS, normalized, row.codeHash, now, PASSWORD_RESET_MAX_ATTEMPTS)
    .first<{ attempts: number }>();

  return failedAttempt && failedAttempt.attempts >= PASSWORD_RESET_MAX_ATTEMPTS
    ? 'locked'
    : 'invalid';
}
