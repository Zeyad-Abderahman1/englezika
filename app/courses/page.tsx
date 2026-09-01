'use client';

import CoursesExplorer from '../components/CoursesExplorer';
import { useTranslation } from '../lib/i18n/use-translation';

export default function CoursesPage() {
  const { t } = useTranslation();

  return (
    <main className="inner-page">
      <section className="page-hero">
        <div className="container">
          <span className="section-label">{t('courses.hero_badge')}</span>
          <h1>{t('courses.hero_title')}</h1>
          <p>{t('courses.hero_subtitle')}</p>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <CoursesExplorer />
        </div>
      </section>
    </main>
  );
}
