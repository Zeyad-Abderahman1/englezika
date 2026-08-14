import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, BookOpenCheck, PlayCircle } from 'lucide-react';

const strengths = [
  'شرح بسيط ومنظم',
  'تدريب على نظام الامتحان',
  'متابعة مستمرة',
];

export default function Hero() {
  return (
    <section className="hero">
      <div className="hero-background" aria-hidden="true" />

      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="eyebrow">
            منصة إنجليزي للمرحلة الثانوية
          </div>
          <h1>
            <span>مستر</span>
            <br />
            أحمد حسن
          </h1>
          <div className="hero-promise">
            <i>◆</i> الإنجليزي ببساطة، من غير حفظ ولا تعقيد
          </div>
          <p>
            مدرس اللغة الإنجليزية للمرحلة الثانوية ومؤسس إنجليزيكا. بيحوّل أصعب القواعد والخطوات
            لأفكار واضحة، ويدرّبك على شكل الامتحان لحد ما تدخل واثق.
          </p>

          <div className="hero-highlights">
            <span>
              <BookOpenCheck /> شرح من الأساس
            </span>
            <span>
              <BookOpenCheck /> تطبيق بعد كل حصة
            </span>
          </div>

          <div className="hero-actions">
            <Link href="/register" className="btn btn-primary btn-large">
              ابدأ رحلتك <ArrowLeft />
            </Link>
            <Link href="/courses" className="btn btn-outline btn-large">
              <PlayCircle /> شوف الكورسات
            </Link>
          </div>

          <p className="hero-assurance">شرح منظم · تطبيق مستمر · تقدّم واضح</p>
        </div>

        <div className="hero-visual" aria-label="مستر أحمد حسن">
          <div className="teacher-stage">
            <span className="teacher-orbit" aria-hidden="true">
              <i />
            </span>
            <div className="teacher-circle">
              <Image
                src="/teacher-hero-v2.webp"
                alt="مستر أحمد حسن"
                fill
                priority
                sizes="(max-width: 800px) 86vw, 520px"
              />
              <span className="teacher-circle-shade" aria-hidden="true" />
            </div>
            {strengths.map((strength, index) => (
              <span key={strength} className={`teacher-badge teacher-badge-${index + 1}`}>
                {strength}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="hero-scroll-cue" aria-hidden="true">
        <span>SCROLL</span>
        <i />
      </div>
    </section>
  );
}
