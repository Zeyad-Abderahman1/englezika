/**
 * app/privacy-policy/page.tsx
 *
 * Privacy Policy page — Arabic (RTL), primary language.
 * Route: /privacy-policy
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية — إنجليزيكا',
  description:
    'سياسة الخصوصية لمنصة إنجليزيكا التعليمية. تعرف على كيفية جمع بياناتك واستخدامها وحمايتها.',
};

export default function PrivacyPolicyPage() {
  return (
    <main
      dir="rtl"
      style={{ padding: '7rem 1rem 3rem', maxWidth: '800px', margin: '0 auto', lineHeight: 1.9 }}
    >
      <div className="container">
        <span className="section-label">الشفافية أولاً</span>
        <h1
          style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
            fontWeight: 900,
            marginBottom: '0.5rem',
          }}
        >
          سياسة الخصوصية
        </h1>
        <p style={{ opacity: 0.6, marginBottom: '2.5rem' }}>آخر تحديث: يناير ٢٠٢٦</p>

        <Section title="١. البيانات التي نجمعها">
          <p>عند إنشاء حساب على منصة إنجليزيكا، نجمع البيانات التالية:</p>
          <ul>
            <li>الاسم الكامل (الرباعي)</li>
            <li>عنوان البريد الإلكتروني</li>
            <li>رقم الهاتف، ورقم هاتف ولي الأمر</li>
            <li>الصف الدراسي، والشعبة، والمحافظة، واسم المدرسة</li>
            <li>كلمة المرور (مشفرة بالكامل — لا نخزن النص الصريح أبداً)</li>
          </ul>
          <p>كذلك نسجل تلقائياً:</p>
          <ul>
            <li>نتائج الامتحانات والمحاولات</li>
            <li>بيانات الاشتراك في الكورسات وحالة الدفع</li>
            <li>سجلات الاستخدام الأساسية (للأمان وتشخيص الأخطاء)</li>
          </ul>
        </Section>

        <Section title="٢. كيف نستخدم بياناتك">
          <ul>
            <li>تشغيل خدمة التعليم وعرض الكورسات والامتحانات المناسبة لصفك</li>
            <li>إرسال رمز التحقق عند إنشاء الحساب أو إعادة تعيين كلمة المرور</li>
            <li>مراجعة الاشتراكات وتفعيلها من قِبَل فريق المنصة</li>
            <li>عرض نتائجك ومتابعة تقدمك الدراسي</li>
            <li>التواصل معك بخصوص التحديثات الهامة للخدمة</li>
          </ul>
          <p>لا نستخدم بياناتك في أي أغراض تجارية خارج نطاق الخدمة التعليمية.</p>
        </Section>

        <Section title="٣. مدة الاحتفاظ بالبيانات">
          <p>
            نحتفظ ببياناتك طالما حسابك نشط. إذا طلبت حذف حسابك، سنُزيل بياناتك الشخصية (الاسم،
            الهاتف، العنوان) من قواعدنا خلال ٧ أيام عمل، مع الاحتفاظ بسجلات الامتحانات والنتائج
            بصورة مجهولة الهوية لأغراض إحصائية.
          </p>
        </Section>

        <Section title="٤. الخدمات الخارجية">
          <p>نستخدم مزودين موثوقين لتشغيل المنصة:</p>
          <ul>
            <li>
              <strong>خادم المنصة الخاص</strong> — تشغيل الموقع وقاعدة البيانات وحفظ المستندات
            </li>
            <li>
              <strong>Resend / ServerSMTP</strong> — إرسال رسائل البريد الإلكتروني التحقيقية
            </li>
          </ul>
          <p>لا نبيع بياناتك ولا نشاركها مع أي طرف ثالث لأغراض تسويقية.</p>
        </Section>

        <Section title="٥. حقوقك">
          <ul>
            <li>
              <strong>حق الاطلاع:</strong> يمكنك طلب نسخة من بياناتك في أي وقت.
            </li>
            <li>
              <strong>حق التصحيح:</strong> يمكنك تعديل بياناتك من صفحة حسابك.
            </li>
            <li>
              <strong>حق الحذف:</strong> يمكنك حذف حسابك نهائياً من إعدادات الحساب.
            </li>
          </ul>
        </Section>

        <Section title="٦. التواصل معنا">
          <p>
            إذا كانت لديك أي استفسارات حول سياسة الخصوصية، يسعدنا التواصل معك عبر{' '}
            <Link href="/contact" style={{ color: 'var(--brand, #d7193f)' }}>
              صفحة التواصل
            </Link>
            .
          </p>
        </Section>

        <div
          style={{
            marginTop: '3rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid var(--line, rgba(255,255,255,0.1))',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <Link href="/" className="btn btn-ghost">
            الرئيسية
          </Link>
          <Link href="/contact" className="btn btn-outline">
            تواصل معنا
          </Link>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '2.5rem' }}>
      <h2
        style={{
          fontSize: '1.2rem',
          fontWeight: 800,
          marginBottom: '0.75rem',
          color: 'var(--brand, #d7193f)',
        }}
      >
        {title}
      </h2>
      <div style={{ color: 'var(--muted, rgba(255,255,255,0.8))' }}>{children}</div>
    </section>
  );
}
export const dynamic = 'force-static';
