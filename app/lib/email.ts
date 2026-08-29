import { getPlatformEnv } from './platform';
import { captureException, captureMessage } from './observability';
import { emailTestModeEnabled } from './email-config';

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

export function isEmailConfigured(): boolean {
  const env = getPlatformEnv();
  const hasServerSmtp = Boolean(
    (env.SERVERSMTP_CONSUMER_KEY || env.TURBO_SMTP_CONSUMER_KEY) &&
    (env.SERVERSMTP_CONSUMER_SECRET || env.TURBO_SMTP_CONSUMER_SECRET)
  );
  return hasServerSmtp || Boolean(env.RESEND_API_KEY?.trim());
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
  if ((!apiKey && (!consumerKey || !consumerSecret)) || !from) {
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
      subject = `تم تفعيل اشتراكك في كورس: ${template.courseTitle}`;
      html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#17181d">
        <h2>تهانينا! تم تفعيل الاشتراك</h2>
        <p>تم تفعيل اشتراكك بنجاح في كورس <strong>${courseTitle}</strong>. استعد للبدء الآن من لوحة التحكم الخاصة بك.</p>
      </div>`;
      break;
  }

  try {
    if (consumerKey && consumerSecret) {
      const fromAddr = from.includes('<') ? from.split('<')[1].replace('>', '').trim() : from;
      const textContent = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const response = await fetch('https://api.turbo-smtp.com/api/v2/mail/send', {
        method: 'POST',
        headers: {
          consumerKey,
          consumerSecret,
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
