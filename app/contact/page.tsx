'use client';

import { Mail, Phone } from 'lucide-react';
import ContactForm from '../components/ContactForm';
import { SITE_CONFIG } from '../lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from '../components/ui/SocialIcons';
import { useTranslation } from '../lib/i18n/use-translation';

export default function ContactPage() {
  const { t, language } = useTranslation();

  return (
    <main className="inner-page">
      <section className="page-hero compact">
        <div className="container">
          <span className="section-label">{t('contact.hero_badge')}</span>
          <h1>{t('contact.hero_title')}</h1>
          <p>{t('contact.hero_subtitle')}</p>
        </div>
      </section>

      <section className="section">
        <div className="container contact-grid">
          <div className="contact-info">
            <h2>{language === 'en' ? 'Direct Contact Channels' : 'قنوات التواصل المباشر'}</h2>
            <p>
              {language === 'en'
                ? 'Choose the most convenient way for you, and the Englizeka team will follow up.'
                : 'اختار الطريقة الأسهل ليك، وفريق إنجليزيكا ومستر أحمد حسن هيتابعوا معاك.'}
            </p>

            <a
              href={SITE_CONFIG.teacher.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
            >
              <WhatsAppIcon />
              <span>
                <small>{language === 'en' ? 'WhatsApp' : 'واتساب'}</small>
                {t('contact.whatsapp_desc')}
              </span>
            </a>

            <a
              href={SITE_CONFIG.teacher.phoneHref}
              aria-label={`Phone: ${SITE_CONFIG.teacher.phoneDisplay}`}
            >
              <Phone />
              <span>
                <small>{t('contact.phone_title')}</small>
                <bdi dir="ltr">{SITE_CONFIG.teacher.phoneDisplay}</bdi>
              </span>
            </a>

            <a
              href={SITE_CONFIG.teacher.youtube}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
            >
              <YouTubeIcon />
              <span>
                <small>YouTube</small>
                {language === 'en' ? 'Explanations & Revisions Channel' : 'قناة الشروحات والمراجعات'}
              </span>
            </a>

            <a
              href={SITE_CONFIG.teacher.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="TikTok"
            >
              <TikTokIcon />
              <span>
                <small>TikTok</small>
                {language === 'en' ? 'Quick Tips & Video Shorts' : 'فيديوهات وتريكات سريعة'}
              </span>
            </a>

            <a
              href={`mailto:${SITE_CONFIG.email}`}
              aria-label={`Email: ${SITE_CONFIG.email}`}
            >
              <Mail />
              <span>
                <small>{t('contact.email_title')}</small>
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
