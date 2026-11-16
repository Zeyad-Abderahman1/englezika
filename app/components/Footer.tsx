'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Phone } from 'lucide-react';
import { SITE_CONFIG } from '../lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from './ui/SocialIcons';

export default function Footer() {
  const pathname = usePathname();
  if (pathname.startsWith('/admin') || pathname.startsWith('/staff')) return null;

  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-intro">
          <Link href="/" className="brand footer-brand">
            <span className="brand-icon">
              <BookOpen size={24} />
            </span>
            <span>
              <strong>{SITE_CONFIG.name}</strong>
              <small>{SITE_CONFIG.nameArabic}</small>
            </span>
          </Link>
          <p>منصة {SITE_CONFIG.teacher.nameArabic} لتعليم اللغة الإنجليزية للمرحلة الثانوية.</p>
        </div>
        <nav className="footer-links" aria-label="روابط سريعة">
          <Link href="/courses">الكورسات</Link>
          <Link href="/about">عن المستر</Link>
          <Link href="/contact">تواصل معنا</Link>
          <Link href="/login">تسجيل الدخول</Link>
          <Link href="/privacy-policy">سياسة الخصوصية</Link>
        </nav>
        <div className="socials" aria-label="قنوات التواصل الرسمية">
          <a
            href={SITE_CONFIG.teacher.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="واتساب - مستر أحمد حسن"
            title="واتساب"
          >
            <WhatsAppIcon width={18} height={18} />
          </a>
          <a
            href={SITE_CONFIG.teacher.youtube}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="يوتيوب - قناة مستر أحمد حسن"
            title="يوتيوب"
          >
            <YouTubeIcon width={18} height={18} />
          </a>
          <a
            href={SITE_CONFIG.teacher.tiktok}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="تيك توك - مستر أحمد حسن"
            title="تيك توك"
          >
            <TikTokIcon width={18} height={18} />
          </a>
          <a
            href={SITE_CONFIG.teacher.phoneHref}
            aria-label={`اتصل بنا: ${SITE_CONFIG.teacher.phoneDisplay}`}
            title={`اتصال: ${SITE_CONFIG.teacher.phoneDisplay}`}
          >
            <Phone size={18} />
          </a>
        </div>
      </div>
      <div className="container copyright">
        © 2026 {SITE_CONFIG.name} — {SITE_CONFIG.nameArabic}. جميع الحقوق محفوظة.
      </div>
    </footer>
  );
}
