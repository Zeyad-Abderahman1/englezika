import type { Metadata } from 'next';
import { Mail, Phone } from 'lucide-react';
import ContactForm from '../components/ContactForm';
import { SITE_CONFIG } from '../lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from '../components/ui/SocialIcons';

export const metadata: Metadata = {
  title: 'تواصل معنا',
  description: 'تواصل مع مستر أحمد حسن وفريق إنجليزيكا عبر واتساب، الهاتف، وقنوات التواصل الرسمية.',
};

export const dynamic = 'force-static';

export default function ContactPage() {
  return (
    <main className="inner-page">
      <section className="page-hero compact">
        <div className="container">
          <span className="section-label">إحنا هنا عشانك</span>
          <h1>تواصل مع {SITE_CONFIG.teacher.nameArabic}</h1>
          <p>عندك سؤال عن الكورس أو محتاج مساعدة؟ تواصل معنا مباشرة عبر قنواتنا الرسمية.</p>
        </div>
      </section>

      <section className="section">
        <div className="container contact-grid">
          <div className="contact-info">
            <h2>قنوات التواصل المباشر</h2>
            <p>اختار الطريقة الأسهل ليك، وفريق إنجليزيكا ومستر أحمد حسن هيتابعوا معاك.</p>

            <a
              href={SITE_CONFIG.teacher.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="تواصل عبر واتساب"
            >
              <WhatsAppIcon />
              <span>
                <small>واتساب</small>
                ابدأ محادثة مباشرة
              </span>
            </a>

            <a
              href={SITE_CONFIG.teacher.phoneHref}
              aria-label={`اتصل هاتفياً: ${SITE_CONFIG.teacher.phoneDisplay}`}
            >
              <Phone />
              <span>
                <small>اتصل بنا</small>
                <bdi dir="ltr">{SITE_CONFIG.teacher.phoneDisplay}</bdi>
              </span>
            </a>

            <a
              href={SITE_CONFIG.teacher.youtube}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="قناة مستر أحمد حسن على يوتيوب"
            >
              <YouTubeIcon />
              <span>
                <small>يوتيوب</small>
                قناة الشروحات والمراجعات
              </span>
            </a>

            <a
              href={SITE_CONFIG.teacher.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="حساب مستر أحمد حسن على تيك توك"
            >
              <TikTokIcon />
              <span>
                <small>تيك توك</small>
                فيديوهات وتريكات سريعة
              </span>
            </a>

            <a
              href={`mailto:${SITE_CONFIG.email}`}
              aria-label={`البريد الإلكتروني: ${SITE_CONFIG.email}`}
            >
              <Mail />
              <span>
                <small>البريد الإلكتروني</small>
                <bdi dir="ltr">{SITE_CONFIG.email}</bdi>
              </span>
            </a>
          </div>

          <ContactForm />
        </div>
      </section>
    </main>
  );
}
