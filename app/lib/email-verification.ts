import { ensureDatabase } from '../../db/runtime';
import { getD1, getPlatformEnv } from './platform';
import nodemailer from 'nodemailer';

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
    throw new Error('Email verification secret is not configured');
  }
  return secret;
}

export function createVerificationCode(): string {
  const random = new Uint32Array(1);
  const upperBound = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= upperBound);
  return String(random[0] % 1_000_000).padStart(6, '0');
}

export async function hashVerificationCode(email: string, code: string): Promise<string> {
  const input = new TextEncoder().encode(
    `${normalizedEmail(email)}:${code}:${verificationSecret()}`
  );
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isEmailTestMode(): boolean {
  const env = getPlatformEnv();
  const hasKey =
    Boolean(env.GMAIL_USER?.trim() && env.GMAIL_APP_PASSWORD?.trim()) ||
    Boolean(
      (env.SERVERSMTP_CONSUMER_KEY || env.TURBO_SMTP_CONSUMER_KEY) &&
      (env.SERVERSMTP_CONSUMER_SECRET || env.TURBO_SMTP_CONSUMER_SECRET)
    ) ||
    Boolean(env.RESEND_API_KEY?.trim());

  return env.EMAIL_TEST_MODE === 'true' || !hasKey;
}

export async function isEmailVerified(email: string): Promise<boolean> {
  await ensureDatabase();
  const row = await getD1()
    .prepare(
      `SELECT u.email_verified AS emailVerified, v.verified_at AS verifiedAt
       FROM users u LEFT JOIN email_verifications v ON v.email = u.email
       WHERE u.email = ?`
    )
    .bind(normalizedEmail(email))
    .first<{ emailVerified: number; verifiedAt: number | null }>();
  return Boolean(row?.emailVerified || row?.verifiedAt);
}

export async function loadEmailVerification(email: string): Promise<VerificationRow | null> {
  await ensureDatabase();
  return getD1()
    .prepare(
      `SELECT email, code_hash AS codeHash, expires_at AS expiresAt, attempts,
     sent_at AS sentAt, verified_at AS verifiedAt
     FROM email_verifications WHERE email = ?`
    )
    .bind(normalizedEmail(email))
    .first<VerificationRow>();
}

export async function saveVerificationCode(
  email: string,
  codeHash: string,
  sentAt: number
): Promise<void> {
  await ensureDatabase();
  await getD1()
    .prepare(
      `INSERT INTO email_verifications
     (email, code_hash, expires_at, attempts, sent_at, verified_at, delivery_id)
     VALUES (?, ?, ?, 0, ?, NULL, NULL)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,
     expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at,
     verified_at = NULL, delivery_id = NULL`
    )
    .bind(normalizedEmail(email), codeHash, sentAt + VERIFICATION_CODE_TTL_MS, sentAt)
    .run();
  await getD1()
    .prepare(
      `UPDATE users SET email_verified = 0, verification_code = ?,
       verification_code_expires_at = ?, updated_at = ? WHERE email = ?`
    )
    .bind(codeHash, sentAt + VERIFICATION_CODE_TTL_MS, sentAt, normalizedEmail(email))
    .run();
}

export async function releaseFailedDelivery(email: string, codeHash: string): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE email_verifications SET expires_at = 0, sent_at = 0
     WHERE email = ? AND code_hash = ? AND verified_at IS NULL`
    )
    .bind(normalizedEmail(email), codeHash)
    .run();
  await getD1()
    .prepare(
      `UPDATE users SET verification_code = NULL, verification_code_expires_at = NULL
       WHERE email = ? AND verification_code = ?`
    )
    .bind(normalizedEmail(email), codeHash)
    .run();
}

export async function recordDeliveryId(
  email: string,
  codeHash: string,
  deliveryId: string
): Promise<void> {
  await getD1()
    .prepare('UPDATE email_verifications SET delivery_id = ? WHERE email = ? AND code_hash = ?')
    .bind(deliveryId, normalizedEmail(email), codeHash)
    .run();
}

export async function verifyStoredCode(
  email: string,
  code: string
): Promise<'verified' | 'already_verified' | 'expired' | 'invalid' | 'locked'> {
  const normalized = normalizedEmail(email);
  const row = await loadEmailVerification(normalized);
  if (row?.verifiedAt) return 'already_verified';
  if (!row || row.expiresAt < Date.now()) return 'expired';
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return 'locked';

  const candidateHash = await hashVerificationCode(normalized, code);
  if (candidateHash !== row.codeHash) {
    const attempts = row.attempts + 1;
    await getD1()
      .prepare(
        `UPDATE email_verifications SET attempts = ?,
       expires_at = CASE WHEN ? >= ? THEN 0 ELSE expires_at END
       WHERE email = ? AND code_hash = ?`
      )
      .bind(attempts, attempts, VERIFICATION_MAX_ATTEMPTS, normalized, row.codeHash)
      .run();
    return attempts >= VERIFICATION_MAX_ATTEMPTS ? 'locked' : 'invalid';
  }

  await getD1()
    .prepare(
      `UPDATE email_verifications SET verified_at = ?, code_hash = '', expires_at = 0
     WHERE email = ? AND code_hash = ?`
    )
    .bind(Date.now(), normalized, row.codeHash)
    .run();
  await getD1()
    .prepare(
      `UPDATE users SET email_verified = 1, verification_code = NULL,
       verification_code_expires_at = NULL, updated_at = ? WHERE email = ?`
    )
    .bind(Date.now(), normalized)
    .run();
  return 'verified';
}

export async function sendVerificationEmail(
  email: string,
  code: string,
  idempotencyKey: string
): Promise<string> {
  const env = getPlatformEnv();
  if (isEmailTestMode()) return `test-${idempotencyKey}`;

  const gmailUser = env.GMAIL_USER?.trim();
  const gmailPassword = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (gmailUser && gmailPassword) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPassword },
    });
    const delivery = await transporter.sendMail({
      from: `Englizeka <${gmailUser}>`,
      to: normalizedEmail(email),
      subject: 'كود تفعيل حسابك في إنجليزيكا',
      text: `كود تفعيل حسابك هو: ${code}\nالكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d;background:#f9f9f9;padding:24px;border-radius:12px">
        <h2 style="color:#ef233c;margin:0 0 12px">تفعيل حساب إنجليزيكا</h2>
        <p style="font-size:15px;margin:0 0 16px">استخدم الكود التالي لتأكيد بريدك الإلكتروني:</p>
        <div style="background:#fff;border:1px solid #e0e0e0;padding:16px;text-align:center;border-radius:8px;margin:16px 0">
          <span style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111">${code}</span>
        </div>
        <p style="font-size:13px;color:#666;margin:0">الكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p>
      </div>`,
    });
    return delivery.messageId;
  }

  const consumerKey = env.SERVERSMTP_CONSUMER_KEY?.trim() || env.TURBO_SMTP_CONSUMER_KEY?.trim();
  const consumerSecret =
    env.SERVERSMTP_CONSUMER_SECRET?.trim() || env.TURBO_SMTP_CONSUMER_SECRET?.trim();
  const resendApiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim() || 'verify@englizeka.com';

  if (consumerKey && consumerSecret) {
    const fromAddr = from.includes('<') ? from.split('<')[1].replace('>', '').trim() : from;
    const response = await fetch('https://api.turbo-smtp.com/api/v2/mail/send', {
      method: 'POST',
      headers: {
        consumerKey,
        consumerSecret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: normalizedEmail(email),
        subject: 'كود تفعيل حسابك في إنجليزيكا',
        content: `كود تفعيل حسابك في إنجليزيكا هو: ${code}\nالكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`,
        html_content: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d;background:#f9f9f9;padding:24px;border-radius:12px">
          <h2 style="color:#ef233c;margin:0 0 12px">تفعيل حساب إنجليزيكا</h2>
          <p style="font-size:15px;margin:0 0 16px">استخدم الكود التالي لتأكيد بريدك الإلكتروني:</p>
          <div style="background:#fff;border:1px solid #e0e0e0;padding:16px;text-align:center;border-radius:8px;margin:16px 0">
            <span style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111">${code}</span>
          </div>
          <p style="font-size:13px;color:#666;margin:0">الكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p>
        </div>`,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as {
      mid?: number | string;
      message?: string;
    };
    if (!response.ok || !result.mid) {
      throw new Error(`ServerSMTP rejected delivery (${response.status}): ${result.message || ''}`);
    }
    return String(result.mid);
  }

  if (resendApiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [normalizedEmail(email)],
        subject: 'كود تفعيل حسابك في إنجليزيكا',
        text: `كود تفعيل حسابك هو: ${code}\nالكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d">
          <h2>تفعيل حساب إنجليزيكا</h2>
          <p>استخدم الكود التالي لتأكيد بريدك الإلكتروني:</p>
          <p style="font-size:32px;font-weight:800;letter-spacing:8px">${code}</p>
          <p>الكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p>
        </div>`,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!response.ok || !result.id) {
      const errorMsg = result.message || result.name || `HTTP ${response.status}`;
      throw new Error(`Resend rejected delivery (${response.status}): ${errorMsg}`);
    }
    return result.id;
  }

  throw new Error('Transactional email is not configured');
}
