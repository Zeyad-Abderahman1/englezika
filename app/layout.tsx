import type { Metadata } from 'next';
import './globals.css';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ScrollEffects from './components/ScrollEffects';
import CookieConsent from './components/CookieConsent';

const publicBaseUrl = new URL(process.env.APP_URL || 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: publicBaseUrl,
  title: { default: 'Englizeka | إنجليزيكا', template: '%s | Englizeka' },
  description:
    'منصة مستر أحمد حسن لتعليم اللغة الإنجليزية لطلاب الثانوية العامة بطريقة واضحة ومختلفة.',
  openGraph: {
    title: 'Englizeka | افهم الإنجليزي وخليه نقطة قوتك',
    description: 'منصة مستر أحمد حسن لطلاب الثانوية العامة.',
    type: 'website',
    locale: 'ar_EG',
    images: [{ url: '/og.webp', width: 1731, height: 909, alt: 'Englizeka' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.webp'] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" data-theme="dark">
      <body>
        <ScrollEffects />
        <Navbar />
        {children}
        <Footer />
        <CookieConsent />
      </body>
    </html>
  );
}
