import type { Metadata } from 'next';
import Image from 'next/image';
import { Award, BookOpenCheck, Phone, Users } from 'lucide-react';
import { SITE_CONFIG } from '../lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from '../components/ui/SocialIcons';
import { teacher } from '../data/content';

export const metadata: Metadata = {
  title: `عن ${SITE_CONFIG.teacher.nameArabic}`,
  description: `تعرف على ${SITE_CONFIG.teacher.nameArabic} (${SITE_CONFIG.teacher.name})، ${SITE_CONFIG.teacher.roleArabic} ومؤسس منصة إنجليزيكا.`,
};

export const dynamic = 'force-static';

export default function AboutPage() {
  return (
    <main className="inner-page">
      <section className="about-hero">
        <div className="container about-grid">
          <div className="about-portrait">
            <Image
              src="/teacher-hero-v2.webp"
              alt={SITE_CONFIG.teacher.nameArabic}
              fill
              priority
              unoptimized
              sizes="(max-width: 800px) 100vw, 48vw"
            />
          </div>
          <div className="about-copy">
            <span className="section-label">عن المستر</span>
            <h1>{SITE_CONFIG.teacher.nameArabic}</h1>
            <h2>{SITE_CONFIG.teacher.roleArabic}</h2>
            <p>{teacher.bio}</p>

            <div className="about-stats">
              <div>
                <Users />
                <strong>+5000</strong>
                <span>طالب</span>
              </div>
              <div>
                <BookOpenCheck />
                <strong>+50</strong>
                <span>حصة</span>
              </div>
              <div>
                <Award />
                <strong>3</strong>
                <span>صفوف دراسية</span>
              </div>
            </div>

            <div className="about-channels" style={{ marginTop: '28px' }}>
              <span className="section-label" style={{ fontSize: '13px' }}>
                تواصل وتابع الشروحات
              </span>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px',
                  marginTop: '12px',
                }}
              >
                <a
                  href={SITE_CONFIG.teacher.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ gap: '8px', display: 'inline-flex', alignItems: 'center' }}
                  aria-label="تواصل مع مستر أحمد حسن عبر واتساب"
                >
                  <WhatsAppIcon width={18} height={18} />
                  <span>واتساب</span>
                </a>

                <a
                  href={SITE_CONFIG.teacher.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                  style={{ gap: '8px', display: 'inline-flex', alignItems: 'center' }}
                  aria-label="قناة مستر أحمد حسن على يوتيوب"
                >
                  <YouTubeIcon width={18} height={18} />
                  <span>يوتيوب</span>
                </a>

                <a
                  href={SITE_CONFIG.teacher.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                  style={{ gap: '8px', display: 'inline-flex', alignItems: 'center' }}
                  aria-label="حساب مستر أحمد حسن على تيك توك"
                >
                  <TikTokIcon width={18} height={18} />
                  <span>تيك توك</span>
                </a>

                <a
                  href={SITE_CONFIG.teacher.phoneHref}
                  className="btn btn-ghost"
                  style={{ gap: '8px', display: 'inline-flex', alignItems: 'center' }}
                  aria-label={`اتصال هاتفياً: ${SITE_CONFIG.teacher.phoneDisplay}`}
                >
                  <Phone size={17} />
                  <bdi dir="ltr">{SITE_CONFIG.teacher.phoneDisplay}</bdi>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
