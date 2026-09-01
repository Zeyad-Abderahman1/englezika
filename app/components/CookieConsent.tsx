'use client';

import { useState, useSyncExternalStore } from 'react';
import { Cookie, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from '../lib/i18n/use-translation';

const STORAGE_KEY = 'cookie_consent';
const CONSENT_CHANGE_EVENT = 'cookie-consent-change';
const STORAGE_UNAVAILABLE = 'unavailable';

function subscribeToConsent(onStoreChange: () => void) {
  const notify = () => onStoreChange();
  window.addEventListener('storage', notify);
  window.addEventListener(CONSENT_CHANGE_EVENT, notify);

  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(CONSENT_CHANGE_EVENT, notify);
  };
}

function getConsentSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return STORAGE_UNAVAILABLE;
  }
}

export default function CookieConsent() {
  const { language } = useTranslation();
  const consent = useSyncExternalStore(
    subscribeToConsent,
    getConsentSnapshot,
    () => STORAGE_UNAVAILABLE
  );
  const [dismissed, setDismissed] = useState(false);
  const visible = consent === null && !dismissed;

  const respond = (value: 'accepted' | 'rejected') => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={language === 'en' ? 'Cookie Notice' : 'إشعار الكوكيز'}
      className="cookie-consent"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10000,
        background: 'var(--surface, #1a1a2e)',
        borderTop: '1px solid var(--line, rgba(255,255,255,0.1))',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <Cookie size={22} style={{ flexShrink: 0, color: 'var(--brand, #d7193f)' }} />
      <p style={{ flex: 1, margin: 0, fontSize: '0.875rem', lineHeight: 1.6 }}>
        {language === 'en' ? (
          <>
            We use essential cookies to improve your experience on the Englizeka platform. Read our{' '}
            <Link
              href="/privacy-policy"
              style={{ color: 'var(--brand, #d7193f)', textDecoration: 'underline' }}
            >
              Privacy Policy
            </Link>{' '}
            for more details.
          </>
        ) : (
          <>
            نستخدم ملفات تعريف الارتباط (كوكيز) لتحسين تجربتك على منصة إنجليزيكا. يمكنك قراءة{' '}
            <Link
              href="/privacy-policy"
              style={{ color: 'var(--brand, #d7193f)', textDecoration: 'underline' }}
            >
              سياسة الخصوصية
            </Link>{' '}
            لمعرفة المزيد.
          </>
        )}
      </p>
      <div className="cookie-consent-actions" style={{ display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
        <button
          className="btn btn-ghost"
          style={{ minHeight: '44px', fontSize: '0.85rem' }}
          onClick={() => respond('rejected')}
          aria-label={language === 'en' ? 'Essential Only' : 'الأساسية فقط'}
        >
          {language === 'en' ? 'Essential Only' : 'الأساسية فقط'}
        </button>
        <button
          className="btn btn-primary"
          style={{ minHeight: '44px', fontSize: '0.85rem' }}
          onClick={() => respond('accepted')}
          aria-label={language === 'en' ? 'Accept All' : 'قبول الكل'}
        >
          {language === 'en' ? 'Accept All' : 'قبول الكل'}
        </button>
        <button
          className="icon-button"
          style={{ minHeight: '44px', minWidth: '44px' }}
          onClick={() => respond('rejected')}
          aria-label={language === 'en' ? 'Close' : 'إغلاق الإشعار'}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
