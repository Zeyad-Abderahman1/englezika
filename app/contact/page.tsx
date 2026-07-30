import type { Metadata } from 'next';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import ContactForm from '../components/ContactForm';

export const metadata: Metadata = { title: 'تواصل معنا' };
export const dynamic = 'force-static';

export default function ContactPage() {
  return (
    <main className="inner-page">
      <section className="page-hero compact">
        <div className="container">
          <span className="section-label">إحنا هنا عشانك</span>
          <h1>تواصل معانا</h1>
          <p>عندك سؤال عن الكورس أو محتاج مساعدة؟ ابعت لنا.</p>
        </div>
      </section>
      <section className="section">
        <div className="container contact-grid">
          <div className="contact-info">
            <h2>هنرد عليك في أسرع وقت</h2>
            <p>اختار الطريقة الأسهل ليك، وفريق إنجليزيكا هيتابع معاك.</p>
            <a href="tel:+201000000000">
              <Phone />
              <span>
                <small>اتصل بينا</small>+20 100 000 0000
              </span>
            </a>
            <a href="https://wa.me/201000000000">
              <MessageCircle />
              <span>
                <small>واتساب</small>ابدأ محادثة
              </span>
            </a>
            <a href="mailto:hello@englizeka.com">
              <Mail />
              <span>
                <small>البريد الإلكتروني</small>hello@englizeka.com
              </span>
            </a>
          </div>
          <ContactForm />
        </div>
      </section>
    </main>
  );
}
