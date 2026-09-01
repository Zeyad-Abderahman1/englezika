'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Phone } from 'lucide-react';
import { SITE_CONFIG } from '../lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from './ui/SocialIcons';
import { useTranslation } from '../lib/i18n/use-translation';

export default function Footer() {
  const pathname = usePathname();
  const { t, language } = useTranslation();

  if (pathname.startsWith('/admin') || pathname.startsWith('/staff')) return null;

  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-intro">
          <Link href="/" className="brand footer-brand" aria-label={SITE_CONFIG.name}>
            <span className="brand-icon">
              <BookOpen size={22} />
            </span>
            <span>
              <strong>{SITE_CONFIG.name}</strong>
              <small>{language === 'en' ? 'English Platform' : SITE_CONFIG.nameArabic}</small>
            </span>
          </Link>
          <p>{t('footer.description')}</p>
        </div>
        <nav className="footer-links" aria-label={t('footer.quick_links')}>
          <Link href="/courses">{t('nav.courses')}</Link>
          <Link href="/about">{t('nav.about')}</Link>
          <Link href="/contact">{t('nav.contact')}</Link>
          <Link href="/login">{t('nav.login')}</Link>
          <Link href="/privacy-policy">{t('footer.privacy')}</Link>
        </nav>
        <div className="socials" aria-label="Social Channels">
          <a
            href={SITE_CONFIG.teacher.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp"
            title="WhatsApp"
          >
            <WhatsAppIcon width={18} height={18} />
          </a>
          <a
            href={SITE_CONFIG.teacher.youtube}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="YouTube"
            title="YouTube"
          >
            <YouTubeIcon width={18} height={18} />
          </a>
          <a
            href={SITE_CONFIG.teacher.tiktok}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="TikTok"
            title="TikTok"
          >
            <TikTokIcon width={18} height={18} />
          </a>
          <a
            href={SITE_CONFIG.teacher.phoneHref}
            aria-label={`Phone: ${SITE_CONFIG.teacher.phoneDisplay}`}
            title={`Phone: ${SITE_CONFIG.teacher.phoneDisplay}`}
          >
            <Phone size={18} />
          </a>
        </div>
      </div>
      <div className="container copyright">
        © 2026 {SITE_CONFIG.name} — {language === 'en' ? SITE_CONFIG.name : SITE_CONFIG.nameArabic}. {t('footer.rights')}
      </div>
    </footer>
  );
}
