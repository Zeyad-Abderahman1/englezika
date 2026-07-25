import { ensureDatabase } from "../../db/runtime";
import { getD1, getPlatformEnv } from "./platform";

export const VERIFICATION_CODE_TTL_MS = 10 * 60_000;
export const VERIFICATION_RESEND_MS = 60_000;
export const VERIFICATION_MAX_ATTEMPTS = 5;

type VerificationRow = {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
  verifiedAt: number | null;
};

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function verificationSecret(): string {
  const secret = getPlatformEnv().VERIFICATION_SECRET?.trim();
  if (!secret || secret.length < 24) {
    throw new Error("Email verification secret is not configured");
  }
  return secret;
}

export function createVerificationCode(): string {
  const random = new Uint32Array(1);
  const upperBound = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= upperBound);
  return String(random[0] % 1_000_000).padStart(6, "0");
}

export async function hashVerificationCode(email: string, code: string): Promise<string> {
  const input = new TextEncoder().encode(
    `${normalizedEmail(email)}:${code}:${verificationSecret()}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isEmailTestMode(): boolean {
  return getPlatformEnv().EMAIL_TEST_MODE === "true";
}

export async function isEmailVerified(email: string): Promise<boolean> {
  await ensureDatabase();
  const row = await getD1().prepare(
    "SELECT verified_at AS verifiedAt FROM email_verifications WHERE email = ?",
  ).bind(normalizedEmail(email)).first<{ verifiedAt: number | null }>();
  return Boolean(row?.verifiedAt);
}

export async function loadEmailVerification(email: string): Promise<VerificationRow | null> {
  await ensureDatabase();
  return getD1().prepare(
    `SELECT email, code_hash AS codeHash, expires_at AS expiresAt, attempts,
     sent_at AS sentAt, verified_at AS verifiedAt
     FROM email_verifications WHERE email = ?`,
  ).bind(normalizedEmail(email)).first<VerificationRow>();
}

export async function saveVerificationCode(
  email: string,
  codeHash: string,
  sentAt: number,
): Promise<void> {
  await ensureDatabase();
  await getD1().prepare(
    `INSERT INTO email_verifications
     (email, code_hash, expires_at, attempts, sent_at, verified_at, delivery_id)
     VALUES (?, ?, ?, 0, ?, NULL, NULL)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,
     expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at,
     verified_at = NULL, delivery_id = NULL`,
  ).bind(
    normalizedEmail(email),
    codeHash,
    sentAt + VERIFICATION_CODE_TTL_MS,
    sentAt,
  ).run();
}

export async function releaseFailedDelivery(email: string, codeHash: string): Promise<void> {
  await getD1().prepare(
    `UPDATE email_verifications SET expires_at = 0, sent_at = 0
     WHERE email = ? AND code_hash = ? AND verified_at IS NULL`,
  ).bind(normalizedEmail(email), codeHash).run();
}

export async function recordDeliveryId(email: string, codeHash: string, deliveryId: string): Promise<void> {
  await getD1().prepare(
    "UPDATE email_verifications SET delivery_id = ? WHERE email = ? AND code_hash = ?",
  ).bind(deliveryId, normalizedEmail(email), codeHash).run();
}

export async function verifyStoredCode(
  email: string,
  code: string,
): Promise<"verified" | "already_verified" | "expired" | "invalid" | "locked"> {
  const normalized = normalizedEmail(email);
  const row = await loadEmailVerification(normalized);
  if (row?.verifiedAt) return "already_verified";
  if (!row || row.expiresAt < Date.now()) return "expired";
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return "locked";

  const candidateHash = await hashVerificationCode(normalized, code);
  if (candidateHash !== row.codeHash) {
    const attempts = row.attempts + 1;
    await getD1().prepare(
      `UPDATE email_verifications SET attempts = ?,
       expires_at = CASE WHEN ? >= ? THEN 0 ELSE expires_at END
       WHERE email = ? AND code_hash = ?`,
    ).bind(
      attempts,
      attempts,
      VERIFICATION_MAX_ATTEMPTS,
      normalized,
      row.codeHash,
    ).run();
    return attempts >= VERIFICATION_MAX_ATTEMPTS ? "locked" : "invalid";
  }

  await getD1().prepare(
    `UPDATE email_verifications SET verified_at = ?, code_hash = '', expires_at = 0
     WHERE email = ? AND code_hash = ?`,
  ).bind(Date.now(), normalized, row.codeHash).run();
  return "verified";
}

export async function sendVerificationEmail(
  email: string,
  code: string,
  idempotencyKey: string,
): Promise<string> {
  const env = getPlatformEnv();
  if (isEmailTestMode()) return `test-${idempotencyKey}`;

  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("Transactional email is not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [normalizedEmail(email)],
      subject: "كود تفعيل حسابك في إنجليزيكا",
      text: `كود تفعيل حسابك هو: ${code}\nالكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d">
        <h2>تفعيل حساب إنجليزيكا</h2>
        <p>استخدم الكود التالي لتأكيد بريدك الإلكتروني:</p>
        <p style="font-size:32px;font-weight:800;letter-spacing:8px">${code}</p>
        <p>الكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p>
      </div>`,
    }),
  });

  const result = await response.json().catch(() => ({})) as { id?: string };
  if (!response.ok || !result.id) {
    throw new Error(`Email provider rejected delivery (${response.status})`);
  }
  return result.id;
}
