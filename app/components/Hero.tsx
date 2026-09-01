'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpenCheck, PlayCircle } from 'lucide-react';
import { useTranslation } from '../lib/i18n/use-translation';

export default function Hero() {
  const { t, isRTL } = useTranslation();

  const strengths = [
    t('hero.strength_1'),
    t('hero.strength_2'),
    t('hero.strength_3'),
  ];

  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  return (
    <section className="hero">
      <div className="hero-background" aria-hidden="true" />

      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="eyebrow">
            {t('hero.badge')}
          </div>
          <h1>
            <span>{t('hero.title_prefix')}</span>
            <br />
            {t('hero.title_name')}
          </h1>
          <div className="hero-promise">
            <i>◆</i> {t('hero.promise')}
          </div>
          <p>
            {t('hero.description')}
          </p>

          <div className="hero-highlights">
            <span>
              <BookOpenCheck size={18} /> {t('hero.highlight_1')}
            </span>
            <span>
              <BookOpenCheck size={18} /> {t('hero.highlight_2')}
            </span>
          </div>

          <div className="hero-actions">
            <Link href="/register" className="btn btn-primary btn-large">
              {t('hero.cta_start')} <ArrowIcon size={18} />
            </Link>
            <Link href="/courses" className="btn btn-outline btn-large">
              <PlayCircle size={18} /> {t('hero.cta_courses')}
            </Link>
          </div>

          <p className="hero-assurance">{t('hero.assurance')}</p>
        </div>

        <div className="hero-visual" aria-label={t('hero.teacher_alt')}>
          <div className="teacher-stage">
            <span className="teacher-orbit" aria-hidden="true">
              <i />
            </span>
            <div className="teacher-circle">
              <Image
                src="/teacher-hero-v2.webp"
                alt={t('hero.teacher_alt')}
                fill
                priority
                sizes="(max-width: 800px) 70vw, 520px"
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
