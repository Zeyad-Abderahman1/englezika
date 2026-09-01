'use client';

import Link from 'next/link';
import { BookOpenCheck, Clock3, Headphones, ShieldCheck, Star, ArrowLeft, ArrowRight, Phone } from 'lucide-react';
import Hero from './components/Hero';
import FeaturedCourses from './components/FeaturedCourses';
import { testimonials } from './data/content';
import { SITE_CONFIG } from './lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from './components/ui/SocialIcons';
import { useTranslation } from './lib/i18n/use-translation';

export default function Home() {
  const { t, isRTL, language } = useTranslation();
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  const features = [
    {
      icon: BookOpenCheck,
      title: t('feature.1.title'),
      desc: t('feature.1.desc'),
    },
    {
      icon: Clock3,
      title: t('feature.2.title'),
      desc: t('feature.2.desc'),
    },
    {
      icon: ShieldCheck,
      title: t('feature.3.title'),
      desc: t('feature.3.desc'),
    },
    {
      icon: Headphones,
      title: t('feature.4.title'),
      desc: t('feature.4.desc'),
    },
  ];

  return (
    <main>
      <Hero />
      <section className="section courses-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-label">{t('featured.badge')}</span>
              <h2>{t('featured.title')}</h2>
              <p>{t('featured.subtitle')}</p>
            </div>
            <Link href="/courses" className="text-link">
              {t('featured.view_all')} <ArrowIcon size={16} />
            </Link>
          </div>
          <FeaturedCourses />
        </div>
      </section>

      <section className="section why-section">
        <div className="container">
          <div className="section-heading centered">
            <div>
              <span className="section-label">{t('why.badge')}</span>
              <h2>{t('why.title')}</h2>
              <p>{t('why.subtitle')}</p>
            </div>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, title, desc }, i) => (
              <article key={title} className="feature-card">
                <span className="feature-number">0{i + 1}</span>
                <div className="feature-icon">
                  <Icon />
                </div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section testimonial-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-label">{t('testimonials.badge')}</span>
              <h2>{t('testimonials.title')}</h2>
            </div>
          </div>
          <div className="testimonial-grid">
            {testimonials.map((item) => (
              <article className="testimonial-card" key={item.name}>
                <div className="stars">
                  {Array.from({ length: item.rating }).map((_, i) => (
                    <Star key={i} size={16} fill="currentColor" />
                  ))}
                </div>
                <blockquote>“{item.text}”</blockquote>
                <div className="student">
                  <span>{item.name.charAt(0)}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.grade}</small>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section teacher-connect-section" style={{ paddingBlock: '48px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div className="container" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '20px' }}>
          <div>
            <span className="section-label" style={{ fontSize: '13px' }}>
              {language === 'en' ? `Follow ${SITE_CONFIG.teacher.name}` : `تابع ${SITE_CONFIG.teacher.nameArabic}`}
            </span>
            <h3 style={{ margin: '4px 0 0', fontSize: '20px' }}>
              {language === 'en' ? 'Connect with us & follow the latest explanations and tips' : 'تواصل معنا وتابع أحدث الشروحات والتريكات'}
            </h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
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
      </section>

      <section className="cta-section">
        <div className="container cta-inner">
          <div>
            <span className="section-label">{t('cta.title')}</span>
            <h2>{t('cta.subtitle')}</h2>
          </div>
          <Link href="/register" className="btn btn-light btn-large">
            {t('cta.button')} <ArrowIcon size={18} />
          </Link>
        </div>
      </section>
    </main>
  );
}
