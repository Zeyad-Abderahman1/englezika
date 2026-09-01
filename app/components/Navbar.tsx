'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Menu, MoonStar, Sun, Trophy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  drawerPathAfterNavigation,
  drawerPathAfterToggle,
  isDrawerOpenForPathname,
} from '../lib/mobile-navigation-state';

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
    // Theme preference is an external browser setting synchronized after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(shouldUseLight);
    document.documentElement.dataset.theme = shouldUseLight ? 'light' : 'dark';
    document.documentElement.style.colorScheme = shouldUseLight ? 'light' : 'dark';
  }, []);

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
    <header className="site-header">
      <nav className="nav-shell" aria-label="التنقل الرئيسي">
        <Link href="/" className="brand" onClick={closeMenu} aria-label="إنجليزيكا - الرئيسية">
          <span className="brand-icon">
            <BookOpen size={24} />
          </span>
          <span>
            <strong>Englizeka</strong>
            <small>إنجليزيكا</small>
          </span>
        </Link>

        <div id="primary-navigation" className={`nav-menu ${open ? 'is-open' : ''}`}>
          {publicLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? 'active' : ''}
              onClick={closeMenu}
            >
              {link.label}
            </Link>
          ))}
          {viewer && (
            <>
              <Link
                href="/account"
                className={pathname === '/account' ? 'active' : ''}
                onClick={closeMenu}
              >
                مساحتي التعليمية
              </Link>
              <Link
                href="/account?view=leaderboard"
                className="nav-leaderboard"
                onClick={closeMenu}
              >
                <Trophy size={16} />
                <span>أوائل كل صف</span>
              </Link>
            </>
          )}

          {/* Mobile drawer auth actions — visible only when hamburger menu is open */}
          <div className="nav-menu-auth">
            {viewer ? (
              <>
                <Link href="/account" className="btn btn-ghost" onClick={closeMenu}>
                  حسابي
                </Link>
                <button
                  type="button"
                  onClick={() => { closeMenu(); void logout(); }}
                  className="btn nav-menu-logout"
                >
                  تسجيل الخروج
                </button>
              </>
            ) : (
              <>
                <Link href="/register" className="btn btn-primary" onClick={closeMenu}>
                  إنشاء حساب
                </Link>
                <Link href="/login" className="btn btn-ghost" onClick={closeMenu}>
                  تسجيل الدخول
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="nav-actions">
          <button
            type="button"
            className={`theme-toggle ${light ? 'is-light' : 'is-dark'}`}
            onClick={toggleTheme}
            aria-pressed={light}
            aria-label={light ? 'تفعيل الوضع الداكن' : 'تفعيل الوضع الفاتح'}
          >
            <span className="theme-thumb" aria-hidden="true" />
            <span className="theme-icon theme-moon" aria-hidden="true">
              <MoonStar size={16} />
            </span>
            <span className="theme-icon theme-sun" aria-hidden="true">
              <Sun size={17} />
            </span>
          </button>
          {viewer ? (
            <>
              <Link href="/account" className="btn btn-ghost nav-login">
                حسابي
              </Link>
              <button type="button" onClick={() => void logout()} className="btn btn-primary nav-register">
                تسجيل الخروج
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost nav-login">
                تسجيل الدخول
              </Link>
              <Link href="/register" className="btn btn-primary nav-register">
                حساب جديد
              </Link>
            </>
          )}
          <button
            type="button"
            className="menu-toggle"
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
