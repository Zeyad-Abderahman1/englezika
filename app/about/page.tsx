import type { Metadata } from 'next';
import Image from 'next/image';
import { Award, BookOpenCheck, Users } from 'lucide-react';
import { teacher } from '../data/content';

export const metadata: Metadata = { title: 'عن مستر أحمد حسن' };
export const dynamic = 'force-static';

export default function AboutPage() {
  return (
    <main className="inner-page">
      <section className="about-hero">
        <div className="container about-grid">
          <div className="about-portrait">
            <Image
              src="/teacher-hero-v2.webp"
              alt="مستر أحمد حسن"
              fill
              priority
              unoptimized
              sizes="(max-width: 800px) 100vw, 48vw"
            />
          </div>
          <div className="about-copy">
            <span className="section-label">عن المستر</span>
            <h1>{teacher.name}</h1>
            <h2>{teacher.role}</h2>
            <p>{teacher.bio}</p>
            <div className="about-stats">
              <div>
                <Users />
                <strong>+5000</strong>
                <span>طالب</span>
              </div>
              <div>
                <BookOpenCheck />
                <strong>+50</strong>
                <span>حصة</span>
              </div>
              <div>
                <Award />
                <strong>3</strong>
                <span>صفوف دراسية</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
