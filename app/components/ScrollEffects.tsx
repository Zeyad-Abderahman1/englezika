'use client';

import { useEffect } from 'react';

const revealSelector = [
  '.section-heading',
  '.course-card',
  '.feature-card',
  '.testimonial-card',
  '.cta-inner',
  '.page-hero .container',
  '.about-copy',
  '.about-portrait',
  '.contact-info',
  '.form-card',
  '.enroll-card',
  '.lecture-list > div',
  '.preview-box',
  '.order-summary',
  '.payment-card',
  '.about-stats > div',
  '.contact-info > a',
  '.footer-grid > *',
].join(',');

export default function ScrollEffects() {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealItems = Array.from(document.querySelectorAll<HTMLElement>(revealSelector));

    revealItems.forEach((item, index) => {
      item.classList.add('scroll-reveal');
      item.style.setProperty('--reveal-delay', `${Math.min((index % 4) * 90, 270)}ms`);
    });

    if (reduceMotion) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    document.documentElement.classList.add('motion-ready');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.13, rootMargin: '0px 0px -7% 0px' }
    );

    revealItems.forEach((item) => observer.observe(item));

    let scrolled = window.scrollY > 34;
    document.documentElement.classList.toggle('is-scrolled', scrolled);

    const onScroll = () => {
      const nextScrolled = window.scrollY > 34;
      if (nextScrolled !== scrolled) {
        scrolled = nextScrolled;
        document.documentElement.classList.toggle('is-scrolled', scrolled);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      document.documentElement.classList.remove('motion-ready', 'is-scrolled');
    };
  }, []);

  return null;
}
