import { getDatabase, getPlatformEnv } from './platform';
import nodemailer from 'nodemailer';
import { emailTestModeEnabled, selectedEmailProvider } from './email-config';

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

type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function verificationEmailContent(code: string, template: 'verification' | 'password-reset' = 'verification'): EmailContent {
  const safeCode = escapeHtml(code);
  const isPasswordReset = template === 'password-reset';
  const subject = isPasswordReset
    ? 'كود إعادة ضبط كلمة المرور في إنجليزيكا'
    : 'كود تفعيل حسابك في إنجليزيكا';
  const headline = isPasswordReset ? 'إعادة ضبط كلمة المرور' : 'تفعيل حساب إنجليزيكا';
  const instruction = isPasswordReset
    ? 'استخدم الكود التالي لإعادة ضبط كلمة المرور الخاصة بك:'
    : 'استخدم الكود التالي لتأكيد بريدك الإلكتروني:';
  const textInstruction = isPasswordReset
    ? 'استخدم الكود التالي لإعادة ضبط كلمة المرور الخاصة بك:'
    : 'استخدم الكود التالي لتأكيد بريدك الإلكتروني:';
  return {
    subject,
    text: `${textInstruction}\n${code}\nالكود صالح لمدة 10 دقائق. لن نطلب منك مشاركة هذا الكود مع أي شخص.`,
    html: `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f7f7f6;color:#18181b;font-family:Arial,Tahoma,sans-serif;line-height:1.7">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;background-color:#f7f7f6">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dedee1;border-radius:16px;overflow:hidden">
            <tr>
              <td align="center" bgcolor="#090a0d" style="padding:28px 24px;background-color:#090a0d;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                  <tr>
                    <td align="center" bgcolor="#d7193f" style="width:48px;height:48px;background-color:#d7193f;border-radius:12px;color:#ffffff;font-family:Arial,Tahoma,sans-serif;font-size:26px;font-weight:800;line-height:48px;text-align:center">E</td>
                  </tr>
                </table>
                <p style="margin:14px 0 0;color:#ffffff;font-family:Arial,Tahoma,sans-serif;font-size:23px;font-weight:800;line-height:1.25;letter-spacing:-0.4px">Englizeka</p>
                <p style="margin:4px 0 0;color:#f4f8f6;font-family:Arial,Tahoma,sans-serif;font-size:14px;line-height:1.5">إنجليزيكا</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 24px;text-align:right">
                <p style="margin:0 0 8px;color:#d7193f;font-family:Arial,Tahoma,sans-serif;font-size:13px;font-weight:700;line-height:1.5">رسالة آمنة من إنجليزيكا</p>
                <h1 style="margin:0 0 12px;color:#18181b;font-family:Arial,Tahoma,sans-serif;font-size:28px;font-weight:800;line-height:1.35">${headline}</h1>
                <p style="margin:0;color:#626269;font-family:Arial,Tahoma,sans-serif;font-size:16px;line-height:1.8">${instruction}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#fff7f8;border:2px solid #d7193f;border-radius:12px">
                  <tr>
                    <td align="center" style="padding:20px 16px 18px;text-align:center">
                      <p style="margin:0 0 8px;color:#626269;font-family:Arial,Tahoma,sans-serif;font-size:12px;font-weight:700;line-height:1.5">كود التحقق</p>
                      <div dir="ltr" style="direction:ltr;unicode-bidi:embed;color:#18181b;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:800;letter-spacing:10px;line-height:1.25;text-align:center">${safeCode}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#fde8ed;border-right:4px solid #d7193f;border-radius:8px">
                  <tr>
                    <td style="padding:14px 16px;color:#581c2b;font-family:Arial,Tahoma,sans-serif;font-size:13px;line-height:1.8;text-align:right">
                      <strong style="color:#9f1239">تنبيه أمني</strong><br />
                      الكود صالح لمدة 10 دقائق. لن نطلب منك مشاركة هذا الكود مع أي شخص.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background-color:#f7f7f6;border-top:1px solid #dedee1;text-align:center">
                <p style="margin:0;color:#626269;font-family:Arial,Tahoma,sans-serif;font-size:12px;line-height:1.7">هذه رسالة آلية من منصة إنجليزيكا.</p>
                <p style="margin:5px 0 0;font-family:Arial,Tahoma,sans-serif;font-size:12px;line-height:1.7"><a href="https://englizeka.com" style="color:#9f1239;text-decoration:none;font-weight:700">Englizeka — إنجليزيكا</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

function senderParts(from: string): { email: string; name: string } {
  const match = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  return match
    ? { name: match[1].trim() || 'Englizeka', email: match[2].trim() }
    : { name: 'Englizeka', email: from.trim() };
}

function redactedProviderDetail(detail: string, secret: string): string {
  return detail
    .replaceAll(secret, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function selectedProvider(env: ReturnType<typeof getPlatformEnv>): string | null {
  return selectedEmailProvider(env);
}

async function readProviderResponse(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { message: raw };
  }
}

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
  return emailTestModeEnabled(getPlatformEnv());
}

export async function isEmailVerified(email: string): Promise<boolean> {
  const row = await getDatabase()
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
  return getDatabase()
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
  await getDatabase()
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
  await getDatabase()
    .prepare(
      `UPDATE users SET email_verified = 0, verification_code = ?,
       verification_code_expires_at = ?, updated_at = ? WHERE email = ?`
    )
    .bind(codeHash, sentAt + VERIFICATION_CODE_TTL_MS, sentAt, normalizedEmail(email))
    .run();
}

export async function releaseFailedDelivery(email: string, codeHash: string): Promise<void> {
  await getDatabase()
    .prepare(
      `UPDATE email_verifications SET expires_at = 0, sent_at = 0
     WHERE email = ? AND code_hash = ? AND verified_at IS NULL`
    )
    .bind(normalizedEmail(email), codeHash)
    .run();
  await getDatabase()
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
  await getDatabase()
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
    const failedAttempt = await getDatabase()
      .prepare(
        `UPDATE email_verifications SET attempts = attempts + 1,
       expires_at = CASE WHEN attempts + 1 >= ? THEN 0 ELSE expires_at END
       WHERE email = ? AND code_hash = ? AND verified_at IS NULL
         AND expires_at >= ? AND attempts < ?
       RETURNING attempts`
      )
      .bind(VERIFICATION_MAX_ATTEMPTS, normalized, row.codeHash, Date.now(), VERIFICATION_MAX_ATTEMPTS)
      .first<{ attempts: number }>();
    if (!failedAttempt) return 'locked';
    return failedAttempt.attempts >= VERIFICATION_MAX_ATTEMPTS ? 'locked' : 'invalid';
  }

  const claimed = await getDatabase()
    .prepare(
      `UPDATE email_verifications SET verified_at = ?, code_hash = '', expires_at = 0
     WHERE email = ? AND code_hash = ? AND verified_at IS NULL AND expires_at >= ?
     RETURNING email`
    )
    .bind(Date.now(), normalized, row.codeHash, Date.now())
    .first<{ email: string }>();
  if (!claimed) return 'invalid';
  await getDatabase()
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

  const content = verificationEmailContent(
    code,
    idempotencyKey.startsWith('reset-') ? 'password-reset' : 'verification'
  );
  const provider = selectedProvider(env);
  const gmailUser = env.GMAIL_USER?.trim();
  const gmailPassword = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (provider === 'gmail') {
    if (!gmailUser || !gmailPassword) {
      throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are not configured');
    }
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPassword },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const delivery = await transporter.sendMail({
      from: `Englizeka <${gmailUser}>`,
      to: normalizedEmail(email),
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    return delivery.messageId;
  }

  const consumerKey = env.SERVERSMTP_CONSUMER_KEY?.trim() || env.TURBO_SMTP_CONSUMER_KEY?.trim();
  const consumerSecret =
    env.SERVERSMTP_CONSUMER_SECRET?.trim() || env.TURBO_SMTP_CONSUMER_SECRET?.trim();
  const resendApiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();

  if (provider === 'serversmtp') {
    if (!consumerKey || !consumerSecret) {
      throw new Error('ServerSMTP consumer key and secret are not configured');
    }
    if (!from) throw new Error('EMAIL_FROM is not configured');
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
        subject: content.subject,
        content: content.text,
        html_content: content.html,
      }),
      signal: AbortSignal.timeout(15_000),
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

  if (provider === 'resend') {
    if (!resendApiKey) throw new Error('RESEND_API_KEY is not configured');
    if (!from) throw new Error('EMAIL_FROM is not configured');
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
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
      signal: AbortSignal.timeout(15_000),
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

  if (provider === 'gmass') {
    const apiKey = env.GMASS_API_KEY?.trim();
    if (!apiKey) throw new Error('GMASS_API_KEY is not configured');
    if (!from) throw new Error('EMAIL_FROM is not configured');
    const sender = senderParts(from);
    const response = await fetch('https://api.gmass.co/api/transactional', {
      method: 'POST',
      headers: {
        'X-apikey': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        transactionalEmailId: idempotencyKey,
        fromEmail: sender.email,
        fromName: sender.name,
        to: normalizedEmail(email),
        subject: content.subject,
        message: content.html,
        settings: {
          openTrack: false,
          clickTrack: false,
          useCustomerSmtp: false,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await readProviderResponse(response);
    const deliveryId = result.transactionalEmailId;
    if (!response.ok || typeof deliveryId !== 'string' || !deliveryId.trim()) {
      const detail =
        typeof result.message === 'string'
          ? result.message
          : typeof result.error === 'string'
            ? result.error
            : `HTTP ${response.status}`;
      throw new Error(
        `GMass rejected delivery (${response.status}): ${redactedProviderDetail(detail, apiKey)}`
      );
    }
    return deliveryId;
  }

  throw new Error('Transactional email is not configured');
}
