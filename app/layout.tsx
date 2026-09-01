import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import './design-system.css';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ScrollEffects from './components/ScrollEffects';
import CookieConsent from './components/CookieConsent';
import { SITE_CONFIG } from './lib/site-config';
import { LanguageProvider } from './lib/i18n/language-context';
import type { Locale } from './lib/i18n/translations';

const publicBaseUrl = new URL(process.env.APP_URL || 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: publicBaseUrl,
  title: { default: `${SITE_CONFIG.name} | ${SITE_CONFIG.nameArabic}`, template: `%s | ${SITE_CONFIG.name}` },
  description:
    `منصة ${SITE_CONFIG.teacher.nameArabic} لتعليم اللغة الإنجليزية لطلاب الثانوية العامة بطريقة واضحة ومختلفة.`,
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
  openGraph: {
    title: `${SITE_CONFIG.name} | ${SITE_CONFIG.tagline}`,
    description: `منصة ${SITE_CONFIG.teacher.nameArabic} لطلاب الثانوية العامة.`,
    type: 'website',
    locale: 'ar_EG',
    images: [{ url: '/og.webp', width: 1731, height: 909, alt: SITE_CONFIG.name }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.webp'] },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'EducationalOrganization',
  name: SITE_CONFIG.name,
  alternateName: SITE_CONFIG.nameArabic,
  url: publicBaseUrl.toString(),
  description: `منصة ${SITE_CONFIG.teacher.nameArabic} لتعليم اللغة الإنجليزية لطلاب المرحلة الثانوية.`,
  telephone: SITE_CONFIG.teacher.phoneDisplay,
  email: SITE_CONFIG.email,
  founder: {
    '@type': 'Person',
    name: SITE_CONFIG.teacher.name,
    alternateName: SITE_CONFIG.teacher.nameArabic,
    jobTitle: SITE_CONFIG.teacher.roleArabic,
    sameAs: [SITE_CONFIG.teacher.youtube, SITE_CONFIG.teacher.tiktok],
  },
  sameAs: [SITE_CONFIG.teacher.youtube, SITE_CONFIG.teacher.tiktok],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('englizeka-lang')?.value;
  const initialLang: Locale = langCookie === 'en' ? 'en' : 'ar';
  const initialDir = initialLang === 'en' ? 'ltr' : 'rtl';

  return (
    <html
      lang={initialLang}
      dir={initialDir}
      data-theme="dark"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <LanguageProvider initialLanguage={initialLang}>
          <a className="skip-link" href="#main-content">
            تخطَّ إلى المحتوى الرئيسي
          </a>
          <ScrollEffects />
          <Navbar />
          <div id="main-content">{children}</div>
          <Footer />
          <CookieConsent />
        </LanguageProvider>
      </body>
    </html>
  );
}
