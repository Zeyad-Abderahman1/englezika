'use client';

import Image from 'next/image';
import { Award, BookOpenCheck, Phone, Users } from 'lucide-react';
import { SITE_CONFIG } from '../lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from '../components/ui/SocialIcons';
import { useTranslation } from '../lib/i18n/use-translation';

export default function AboutPage() {
  const { t, language } = useTranslation();

  return (
    <main className="inner-page">
      <section className="about-hero">
        <div className="container about-grid">
          <div className="about-portrait">
            <Image
              src="/teacher-hero-v2.webp"
              alt={language === 'en' ? SITE_CONFIG.teacher.name : SITE_CONFIG.teacher.nameArabic}
              fill
              priority
              unoptimized
              sizes="(max-width: 800px) 100vw, 48vw"
            />
          </div>
          <div className="about-copy">
            <span className="section-label">{t('about.hero_badge')}</span>
            <h1>{language === 'en' ? SITE_CONFIG.teacher.name : SITE_CONFIG.teacher.nameArabic}</h1>
            <h2>{t('about.hero_subtitle')}</h2>
            <p>{t('about.bio_p1')}</p>
            <p style={{ marginTop: '12px' }}>{t('about.bio_p2')}</p>

            <div className="about-stats">
              <div>
                <Users size={20} />
                <strong>+5000</strong>
                <span>{language === 'en' ? 'Students' : 'طالب'}</span>
              </div>
              <div>
                <BookOpenCheck size={20} />
                <strong>+100</strong>
                <span>{language === 'en' ? 'Lectures' : 'حصة'}</span>
              </div>
              <div>
                <Award size={20} />
                <strong>3</strong>
                <span>{language === 'en' ? 'Grades' : 'صفوف دراسية'}</span>
              </div>
            </div>

            <div className="about-channels" style={{ marginTop: '28px' }}>
              <span className="section-label" style={{ fontSize: '13px' }}>
                {t('about.social_title')}
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
                  aria-label="WhatsApp"
                >
                  <WhatsAppIcon width={18} height={18} />
                  <span>{language === 'en' ? 'WhatsApp' : 'واتساب'}</span>
                </a>

                <a
                  href={SITE_CONFIG.teacher.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                  style={{ gap: '8px', display: 'inline-flex', alignItems: 'center' }}
                  aria-label="YouTube"
                >
                  <YouTubeIcon width={18} height={18} />
                  <span>{language === 'en' ? 'YouTube' : 'يوتيوب'}</span>
                </a>

                <a
                  href={SITE_CONFIG.teacher.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline"
                  style={{ gap: '8px', display: 'inline-flex', alignItems: 'center' }}
                  aria-label="TikTok"
                >
                  <TikTokIcon width={18} height={18} />
                  <span>{language === 'en' ? 'TikTok' : 'تيك توك'}</span>
                </a>

                <a
                  href={SITE_CONFIG.teacher.phoneHref}
                  className="btn btn-ghost"
                  style={{ gap: '8px', display: 'inline-flex', alignItems: 'center' }}
                  aria-label={`Phone: ${SITE_CONFIG.teacher.phoneDisplay}`}
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
