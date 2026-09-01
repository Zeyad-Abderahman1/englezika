'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { translations, type Locale, type TranslationKey } from './translations';

export interface LanguageContextType {
  language: Locale;
  dir: 'rtl' | 'ltr';
  isRTL: boolean;
  setLanguage: (lang: Locale) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

const STORAGE_KEY = 'englizeka-lang';
const COOKIE_NAME = 'englizeka-lang';

function setLanguageCookie(lang: Locale) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LanguageProvider({
  children,
  initialLanguage = 'ar',
}: {
  children: React.ReactNode;
  initialLanguage?: Locale;
}) {
  const [language, setLanguageState] = useState<Locale>(initialLanguage);
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const isRTL = language === 'ar';

  useEffect(() => {
    // Synchronize initial language from storage / cookie after hydration
    const saved = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    const initial = saved === 'en' || saved === 'ar' ? saved : initialLanguage;
    setLanguageState(initial);
    document.documentElement.lang = initial;
    document.documentElement.dir = initial === 'ar' ? 'rtl' : 'ltr';
  }, [initialLanguage]);

  const setLanguage = useCallback((nextLang: Locale) => {
    setLanguageState(nextLang);
    const nextDir = nextLang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = nextLang;
    document.documentElement.dir = nextDir;
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLang);
      setLanguageCookie(nextLang);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  }, [language, setLanguage]);

  const t = useCallback(
    (key: TranslationKey, fallback?: string): string => {
      const dict = translations[language] || translations.ar;
      const val = dict[key];
      if (val !== undefined) return val;
      return translations.ar[key] || fallback || key;
    },
    [language]
  );

  return (
    <LanguageContext.Provider
      value={{
        language,
        dir,
        isRTL,
        setLanguage,
        toggleLanguage,
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    // Safe fallback if used outside provider
    return {
      language: 'ar',
      dir: 'rtl',
      isRTL: true,
      setLanguage: () => {},
      toggleLanguage: () => {},
      t: (key: TranslationKey, fallback?: string) => translations.ar[key] || fallback || key,
    };
  }
  return context;
}
