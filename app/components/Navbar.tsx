'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Menu, Trophy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  drawerPathAfterNavigation,
  drawerPathAfterToggle,
  isDrawerOpenForPathname,
} from '../lib/mobile-navigation-state';
import ThemeToggle from './ThemeToggle';
import styles from './Navbar.module.css';

const publicLinks = [
  { href: '/', label: 'الرئيسية' },
  { href: '/courses', label: 'الكورسات' },
  { href: '/about', label: 'عن المستر' },
  { href: '/contact', label: 'تواصل معنا' },
];

type NavbarViewer = {
  displayName: string;
} | null;

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.assign('/login');
}

export default function Navbar() {
  const pathname = usePathname();
  const [drawerPathname, setDrawerPathname] = useState<string | null>(null);
  const [light, setLight] = useState(false);
  const [viewer, setViewer] = useState<NavbarViewer>(null);
  const open = isDrawerOpenForPathname(drawerPathname, pathname);

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
      <nav className={`${styles.navShell} nav-shell`} aria-label="التنقل الرئيسي">
        <Link href="/" className={`${styles.brand} brand`} onClick={closeMenu} aria-label="إنجليزيكا - الرئيسية">
          <span className={`${styles.brandIcon} brand-icon`}>
            <BookOpen size={24} />
          </span>
          <span>
            <strong>Englizeka</strong>
            <small>إنجليزيكا</small>
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
                مساحتي التعليمية
              </Link>
              <Link
                href="/account?view=leaderboard"
                className={`${styles.navLink} ${styles.navLeaderboard} nav-leaderboard`}
                onClick={closeMenu}
              >
                <Trophy size={16} />
                <span>أوائل كل صف</span>
              </Link>
            </>
          )}

          {/* Mobile drawer auth actions — visible only inside hamburger drawer on mobile */}
          <div className={`${styles.navMenuAuth} nav-menu-auth`}>
            {viewer ? (
              <>
                <Link href="/account" className={`${styles.authBtn} ${styles.authBtnGhost} btn btn-ghost`} onClick={closeMenu}>
                  حسابي
                </Link>
                <button
                  type="button"
                  onClick={() => { closeMenu(); void logout(); }}
                  className={`${styles.authBtn} ${styles.authBtnLogout} btn nav-menu-logout`}
                >
                  تسجيل الخروج
                </button>
              </>
            ) : (
              <>
                <Link href="/register" className={`${styles.authBtn} ${styles.authBtnPrimary} btn btn-primary`} onClick={closeMenu}>
                  إنشاء حساب
                </Link>
                <Link href="/login" className={`${styles.authBtn} ${styles.authBtnGhost} btn btn-ghost`} onClick={closeMenu}>
                  تسجيل الدخول
                </Link>
              </>
            )}
          </div>
        </div>

        <div className={`${styles.navActions} nav-actions`}>
          <ThemeToggle isDark={!light} onToggle={toggleTheme} />
          {viewer ? (
            <>
              <Link href="/account" className={`${styles.desktopAuthBtn} btn btn-ghost nav-login`}>
                حسابي
              </Link>
              <button type="button" onClick={() => void logout()} className={`${styles.desktopAuthBtn} btn btn-primary nav-register`}>
                تسجيل الخروج
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={`${styles.desktopAuthBtn} btn btn-ghost nav-login`}>
                تسجيل الدخول
              </Link>
              <Link href="/register" className={`${styles.desktopAuthBtn} btn btn-primary nav-register`}>
                حساب جديد
              </Link>
            </>
          )}
          <button
            type="button"
            className={`${styles.menuToggle} menu-toggle`}
            onClick={() => setDrawerPathname(drawerPathAfterToggle(drawerPathname, pathname))}
            aria-expanded={open}
            aria-controls="primary-navigation"
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </nav>
    </header>
  );
}
