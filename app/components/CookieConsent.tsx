'use client';

/**
 * app/components/CookieConsent.tsx
 *
 * Cookie consent banner displayed on the first visit.
 * Checks localStorage key 'cookie_consent' to decide whether to show.
 *
 * Actions:
 *  - Accept All → sets cookie_consent = 'accepted'
 *  - Reject Non-Essential → sets cookie_consent = 'rejected'
 *
 * Fully keyboard-accessible and ARIA-labelled.
 */

import { useEffect, useState } from 'react';
import { Cookie, X } from 'lucide-react';
import Link from 'next/link';

const STORAGE_KEY = 'cookie_consent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (!existing) setVisible(true);
    } catch {
      // localStorage unavailable (SSR / private mode) — hide banner
    }
  }, []);

  const respond = (value: 'accepted' | 'rejected') => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="إشعار الكوكيز"
      className="cookie-consent"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        background: 'var(--surface, #1a1a2e)',
        borderTop: '1px solid var(--border, rgba(255,255,255,0.1))',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <Cookie size={22} style={{ flexShrink: 0, color: 'var(--accent, #6C63FF)' }} />
      <p style={{ flex: 1, margin: 0, fontSize: '0.875rem', lineHeight: 1.6 }}>
        نستخدم ملفات تعريف الارتباط (كوكيز) لتحسين تجربتك على منصة إنجليزيكا. يمكنك قراءة{' '}
        <Link
          href="/privacy-policy"
          style={{ color: 'var(--accent, #6C63FF)', textDecoration: 'underline' }}
        >
          سياسة الخصوصية
        </Link>{' '}
        لمعرفة المزيد.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
        <button
          className="btn btn-ghost"
          style={{ minHeight: '44px', fontSize: '0.85rem' }}
          onClick={() => respond('rejected')}
          aria-label="رفض الكوكيز غير الأساسية"
        >
          الأساسية فقط
        </button>
        <button
          className="btn btn-primary"
          style={{ minHeight: '44px', fontSize: '0.85rem' }}
          onClick={() => respond('accepted')}
          aria-label="قبول جميع الكوكيز"
        >
          قبول الكل
        </button>
        <button
          className="icon-button"
          style={{ minHeight: '44px', minWidth: '44px' }}
          onClick={() => respond('rejected')}
          aria-label="إغلاق الإشعار"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
