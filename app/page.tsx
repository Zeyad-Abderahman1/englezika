import Link from 'next/link';
import { BookOpenCheck, Clock3, Headphones, ShieldCheck, Star, ArrowLeft, Phone } from 'lucide-react';
import Hero from './components/Hero';
import FeaturedCourses from './components/FeaturedCourses';
import { testimonials } from './data/content';
import { SITE_CONFIG } from './lib/site-config';
import { TikTokIcon, WhatsAppIcon, YouTubeIcon } from './components/ui/SocialIcons';

export const dynamic = 'force-static';

const features = [
  {
    icon: BookOpenCheck,
    title: 'شرح يفهّمك',
    desc: 'من الأساس لحد أصعب سؤال، بخطوات واضحة ومباشرة.',
  },
  { icon: Clock3, title: 'اتعلم في وقتك', desc: 'ارجع للحصة وكرر أي جزئية وقت ما تحتاج.' },
  {
    icon: ShieldCheck,
    title: 'محتوى منظم',
    desc: 'خطة ثابتة تخليك دايماً عارف وصلت لفين والجاي إيه.',
  },
  { icon: Headphones, title: 'متابعة حقيقية', desc: 'فريق معاك عشان يجاوبك ويساعدك تكمل.' },
];

export default function Home() {
  return (
    <main>
      <Hero />
      <section className="section courses-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-label">ابدأ من هنا</span>
              <h2>الكورسات اللي هتفرق معاك</h2>
              <p>اختار صفك وابدأ بخطة واضحة من أول حصة.</p>
            </div>
            <Link href="/courses" className="text-link">
              كل الكورسات <ArrowLeft />
            </Link>
          </div>
          <FeaturedCourses />
        </div>
      </section>

      <section className="section why-section">
        <div className="container">
          <div className="section-heading centered">
            <div>
              <span className="section-label">ليه إنجليزيكا؟</span>
              <h2>مش كورس وخلاص، دي طريقة مذاكرة</h2>
              <p>كل تفصيلة معمولة عشان تخليك تفهم، تتدرب، وتدخل الامتحان واثق.</p>
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
              <span className="section-label">كلام طلابنا</span>
              <h2>النتيجة بتتكلم</h2>
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
            <span className="section-label" style={{ fontSize: '13px' }}>تابع {SITE_CONFIG.teacher.nameArabic}</span>
            <h3 style={{ margin: '4px 0 0', fontSize: '20px' }}>تواصل معنا وتابع أحدث الشروحات والتريكات</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
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
              aria-label={`اتصل هاتفياً: ${SITE_CONFIG.teacher.phoneDisplay}`}
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
            <span className="section-label">جاهز تبدأ؟</span>
            <h2>خلّي الإنجليزي أسهل مادة السنة دي.</h2>
          </div>
          <Link href="/register" className="btn btn-light btn-large">
            اعمل حسابك مجاناً <ArrowLeft />
          </Link>
        </div>
      </section>
    </main>
  );
}
