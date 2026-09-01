'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Globe, Menu, MoonStar, Sun, Trophy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  drawerPathAfterNavigation,
  drawerPathAfterToggle,
  isDrawerOpenForPathname,
} from '../lib/mobile-navigation-state';
import { useTranslation } from '../lib/i18n/use-translation';
import styles from './Navbar.module.css';

type NavbarViewer = {
  displayName: string;
} | null;

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.assign('/login');
}

export default function Navbar() {
  const pathname = usePathname();
  const { language, toggleLanguage, t } = useTranslation();
  const [drawerPathname, setDrawerPathname] = useState<string | null>(null);
  const [light, setLight] = useState(false);
  const [viewer, setViewer] = useState<NavbarViewer>(null);
  const open = isDrawerOpenForPathname(drawerPathname, pathname);

  const publicLinks = [
    { href: '/', label: t('nav.home') },
    { href: '/courses', label: t('nav.courses') },
    { href: '/about', label: t('nav.about') },
    { href: '/contact', label: t('nav.contact') },
  ];

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('englizeka-theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const shouldUseLight = savedTheme ? savedTheme === 'light' : prefersLight;
    // Theme preference is synchronized after hydration and preserved across client navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(shouldUseLight);
    document.documentElement.dataset.theme = shouldUseLight ? 'light' : 'dark';
    document.documentElement.style.colorScheme = shouldUseLight ? 'light' : 'dark';
  }, [pathname]);

  useEffect(() => {
    if (pathname.startsWith('/admin') || pathname.startsWith('/staff')) return;
    const controller = new AbortController();
    void fetch('/api/users/me', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return { viewer: null };
        return (await response.json()) as { viewer?: NavbarViewer };
      })
      .then((result) => setViewer(result.viewer ?? null))
      .catch(() => undefined);
    return () => controller.abort();
  }, [pathname]);

  useEffect(() => {
    // A route transition permanently clears the path that owned the open drawer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerPathname((current) => drawerPathAfterNavigation(current, pathname));
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerPathname(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (pathname.startsWith('/admin') || pathname.startsWith('/staff')) return null;

  const toggleTheme = () => {
    const nextTheme = !light;
    setLight(nextTheme);
    document.documentElement.dataset.theme = nextTheme ? 'light' : 'dark';
    document.documentElement.style.colorScheme = nextTheme ? 'light' : 'dark';
    window.localStorage.setItem('englizeka-theme', nextTheme ? 'light' : 'dark');
  };

  const closeMenu = () => setDrawerPathname(null);

  return (
    <header className={`${styles.siteHeader} site-header`}>
      <nav className={`${styles.navShell} nav-shell`} aria-label={t('nav.brand_title')}>
        <Link href="/" className={`${styles.brand} brand`} onClick={closeMenu} aria-label={`${t('nav.brand_title')} - ${t('nav.home')}`}>
          <span className={`${styles.brandIcon} brand-icon`}>
            <BookOpen size={22} />
          </span>
          <span>
            <strong>Englizeka</strong>
            <small>{t('nav.brand_subtitle')}</small>
          </span>
        </Link>

        <div
          id="primary-navigation"
          className={`${styles.navMenu} nav-menu ${open ? `${styles.navMenuOpen} is-open` : ''}`}
        >
          {publicLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.navLink} ${pathname === link.href ? `${styles.navLinkActive} active` : ''}`}
              onClick={closeMenu}
            >
              {link.label}
            </Link>
          ))}
          {viewer && (
            <>
              <Link
                href="/account"
                className={`${styles.navLink} ${pathname === '/account' ? `${styles.navLinkActive} active` : ''}`}
                onClick={closeMenu}
              >
                {t('nav.student_portal')}
              </Link>
              <Link
                href="/account?view=leaderboard"
                className={`${styles.navLink} ${styles.navLeaderboard} nav-leaderboard`}
                onClick={closeMenu}
              >
                <Trophy size={16} />
                <span>{t('nav.leaderboard')}</span>
              </Link>
            </>
          )}

          {/* Mobile drawer language switch */}
          <div className={styles.navMenuLang}>
            <span>{t('nav.lang_label')}</span>
            <button
              type="button"
              className={styles.langToggleBtn}
              onClick={toggleLanguage}
              aria-label={t('nav.lang_switch')}
            >
              {language === 'ar' ? 'English' : 'العربية'}
            </button>
          </div>

          {/* Mobile drawer auth actions */}
          <div className={`${styles.navMenuAuth} nav-menu-auth`}>
            {viewer ? (
              <>
                <Link href="/account" className={`${styles.authBtn} ${styles.authBtnGhost} btn btn-ghost`} onClick={closeMenu}>
                  {t('nav.my_account')}
                </Link>
                <button
                  type="button"
                  onClick={() => { closeMenu(); void logout(); }}
                  className={`${styles.authBtn} ${styles.authBtnLogout} btn nav-menu-logout`}
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <>
                <Link href="/register" className={`${styles.authBtn} ${styles.authBtnPrimary} btn btn-primary`} onClick={closeMenu}>
                  {t('nav.create_account')}
                </Link>
                <Link href="/login" className={`${styles.authBtn} ${styles.authBtnGhost} btn btn-ghost`} onClick={closeMenu}>
                  {t('nav.login')}
                </Link>
              </>
            )}
          </div>
        </div>

        <div className={`${styles.navActions} nav-actions`}>
          {/* Desktop Language Switcher */}
          <button
            type="button"
            className={styles.langBtn}
            onClick={toggleLanguage}
            title={t('nav.lang_switch')}
            aria-label={t('nav.lang_switch')}
          >
            <Globe size={15} />
            <span>{language === 'ar' ? 'EN' : 'عربي'}</span>
          </button>

          {/* Dark / Light Mode Toggle */}
          <button
            type="button"
            className={`${styles.themeToggle} theme-toggle ${light ? `${styles.isLight} is-light` : 'is-dark'}`}
            onClick={toggleTheme}
            aria-pressed={light}
            aria-label={light ? t('nav.theme_dark') : t('nav.theme_light')}
          >
            <span className={`${styles.themeThumb} theme-thumb`} aria-hidden="true" />
            <span className={`${styles.themeIcon} ${styles.themeMoon} theme-icon theme-moon`} aria-hidden="true">
              <MoonStar size={15} />
            </span>
            <span className={`${styles.themeIcon} ${styles.themeSun} theme-icon theme-sun`} aria-hidden="true">
              <Sun size={15} />
            </span>
          </button>

          {/* Desktop Auth Links */}
          {viewer ? (
            <>
              <Link href="/account" className={`${styles.desktopAuthBtn} btn btn-ghost nav-login`}>
                {t('nav.my_account')}
              </Link>
              <button type="button" onClick={() => void logout()} className={`${styles.desktopAuthBtn} btn btn-primary nav-register`}>
                {t('nav.logout')}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={`${styles.desktopAuthBtn} btn btn-ghost nav-login`}>
                {t('nav.login')}
              </Link>
              <Link href="/register" className={`${styles.desktopAuthBtn} btn btn-primary nav-register`}>
                {t('nav.register')}
              </Link>
            </>
          )}

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className={`${styles.menuToggle} menu-toggle`}
            onClick={() => setDrawerPathname(drawerPathAfterToggle(drawerPathname, pathname))}
            aria-expanded={open}
            aria-controls="primary-navigation"
            aria-label={open ? t('nav.menu_close') : t('nav.menu_open')}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>
    </header>
  );
}
