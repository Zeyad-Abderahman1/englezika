import { getPlatformEnv } from './platform';
import { captureException, captureMessage } from './observability';
import nodemailer from 'nodemailer';
import {
  emailTestModeEnabled,
  isEmailProviderConfigured,
  selectedEmailProvider,
} from './email-config';

export type EmailTemplate =
  | { type: 'verification'; code: string }
  | { type: 'welcome'; studentName: string }
  | { type: 'password_reset'; resetUrl: string }
  | { type: 'enrollment_approved'; courseTitle: string };

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] || character);
}

export function sanitizeSubjectText(value: string, maxLength = 120): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\r\n\t\f\v]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function isEmailConfigured(): boolean {
  const env = getPlatformEnv();
  return isEmailProviderConfigured(env);
}

export async function sendTransactionalEmail(
  toEmail: string,
  template: EmailTemplate,
  idempotencyKey?: string
): Promise<{ success: boolean; deliveryId?: string }> {
  const env = getPlatformEnv();
  const consumerKey = env.SERVERSMTP_CONSUMER_KEY?.trim() || env.TURBO_SMTP_CONSUMER_KEY?.trim();
  const consumerSecret =
    env.SERVERSMTP_CONSUMER_SECRET?.trim() || env.TURBO_SMTP_CONSUMER_SECRET?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();

  if (emailTestModeEnabled(env)) {
    captureMessage(`[TEST_EMAIL_DELIVERY] Template: ${template.type}`, 'INFO');
    return { success: true, deliveryId: `test-${Date.now()}` };
  }
  const provider = selectedEmailProvider(env);
  if (!provider || !isEmailProviderConfigured(env, provider)) {
    captureException(new Error('Transactional email provider is not configured'), {
      module: 'email-delivery',
      templateType: template.type,
    });
    return { success: false };
  }

  let subject = '';
  let html = '';
  const studentName = template.type === 'welcome' ? escapeHtml(template.studentName) : '';
  const resetUrl = template.type === 'password_reset' ? escapeHtml(template.resetUrl) : '';
  const courseTitle =
    template.type === 'enrollment_approved' ? escapeHtml(template.courseTitle) : '';

  switch (template.type) {
    case 'verification':
      subject = 'كود تفعيل حسابك في إنجليزيكا';
      html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d">
        <h2>تفعيل حساب إنجليزيكا</h2>
        <p>استخدم الكود التالي لتأكيد بريدك الإلكتروني:</p>
        <p style="font-size:32px;font-weight:800;letter-spacing:8px">${template.code}</p>
        <p>الكود صالح لمدة 10 دقائق.</p>
      </div>`;
      break;
    case 'welcome':
      subject = 'أهلاً بك في منصة إنجليزيكا للغة الإنجليزية';
      html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d">
        <h2>أهلاً بك يا ${studentName}!</h2>
        <p>تم تفعيل حسابك بنجاح في منصة مستر أحمد حسن. يمكنك الآن تصفح الكورسات والبدء في المذاكرة والامتحانات.</p>
      </div>`;
      break;
    case 'password_reset':
      subject = 'إعادة ضبط كلمة المرور — إنجليزيكا';
      html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d">
        <h2>إعادة ضبط كلمة المرور</h2>
        <p>اضغط على الرابط التالي لإعادة ضبط كلمة المرور الخاصة بحسابك:</p>
        <p><a href="${resetUrl}" style="color:#ef233c;font-weight:800">${resetUrl}</a></p>
      </div>`;
      break;
    case 'enrollment_approved':
      subject = `تم تفعيل اشتراكك في كورس: ${sanitizeSubjectText(template.courseTitle)}`;
      html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d">
        <h2>تهانينا! تم تفعيل الاشتراك</h2>
        <p>تم تفعيل اشتراكك بنجاح في كورس <strong>${courseTitle}</strong>. استعد للبدء الآن من لوحة التحكم الخاصة بك.</p>
      </div>`;
      break;
  }

  if (provider === 'gmail') {
    const gmailUser = env.GMAIL_USER!.trim();
    const gmailPassword = env.GMAIL_APP_PASSWORD!.replace(/\s+/g, '');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPassword },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    try {
      const delivery = await transporter.sendMail({
        from: from || `Englizeka <${gmailUser}>`,
        to: toEmail.trim().toLowerCase(),
        subject,
        html,
      });
      return { success: true, deliveryId: delivery.messageId };
    } catch (error) {
      captureException(error, { module: 'email-delivery', toEmail, templateType: template.type });
      return { success: false };
    }
  }

  try {
    if (provider === 'serversmtp') {
      const configuredFrom = from!;
      const fromAddr = configuredFrom.includes('<')
        ? configuredFrom.split('<')[1].replace('>', '').trim()
        : configuredFrom;
      const textContent = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const response = await fetch('https://api.turbo-smtp.com/api/v2/mail/send', {
        method: 'POST',
        headers: {
          consumerKey: consumerKey!,
          consumerSecret: consumerSecret!,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: toEmail.trim().toLowerCase(),
          subject,
          content: textContent,
          html_content: html,
        }),
      });

      const result = (await response.json().catch(() => ({}))) as {
        mid?: number | string;
        message?: string;
      };
      if (!response.ok || !result.mid) {
        throw new Error(`ServerSMTP error (${response.status}): ${result.message || ''}`);
      }
      return { success: true, deliveryId: String(result.mid) };
    }

    if (provider === 'gmass') {
      const gmassApiKey = env.GMASS_API_KEY!.trim();
      const sender = from!.includes('<')
        ? { email: from!.split('<')[1].replace('>', '').trim(), name: from!.split('<')[0].trim() || 'Englizeka' }
        : { email: from!, name: 'Englizeka' };
      const response = await fetch('https://api.gmass.co/api/transactional', {
        method: 'POST',
        headers: {
          'X-apikey': gmassApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          transactionalEmailId: idempotencyKey,
          fromEmail: sender.email,
          fromName: sender.name,
          to: toEmail.trim().toLowerCase(),
          subject,
          message: html,
          settings: { openTrack: false, clickTrack: false, useCustomerSmtp: false },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = (await response.json().catch(() => ({}))) as {
        transactionalEmailId?: string;
        message?: string;
        error?: string;
      };
      if (!response.ok || !result.transactionalEmailId?.trim()) {
        throw new Error(`GMass error (${response.status}): ${result.message || result.error || ''}`);
      }
      return { success: true, deliveryId: result.transactionalEmailId };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [toEmail.trim().toLowerCase()],
        subject,
        html,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as { id?: string };
    if (!response.ok || !result.id) {
      throw new Error(`Resend error (${response.status})`);
    }

    return { success: true, deliveryId: result.id };
  } catch (error) {
    captureException(error, { module: 'email-delivery', toEmail, templateType: template.type });
    return { success: false };
  }
}
