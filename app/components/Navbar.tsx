'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Menu, MoonStar, Sun, Trophy, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const publicLinks = [
  { href: '/', label: 'الرئيسية' },
  { href: '/courses', label: 'الكورسات' },
  { href: '/about', label: 'عن المستر' },
  { href: '/contact', label: 'تواصل معنا' },
];

type NavbarViewer = {
  displayName: string;
} | null;

export default function Navbar({ viewer }: { viewer: NavbarViewer }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [light, setLight] = useState(false);

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

  if (pathname.startsWith('/admin') || pathname.startsWith('/staff')) return null;

  const toggleTheme = () => {
    const nextTheme = !light;
    setLight(nextTheme);
    document.documentElement.dataset.theme = nextTheme ? 'light' : 'dark';
    document.documentElement.style.colorScheme = nextTheme ? 'light' : 'dark';
    window.localStorage.setItem('englizeka-theme', nextTheme ? 'light' : 'dark');
  };

  const closeMenu = () => setOpen(false);

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

        <div className={`nav-menu ${open ? 'is-open' : ''}`}>
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
        </div>

        <div className="nav-actions">
          <button
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
              <a href="/student/logout" className="btn btn-primary nav-register">
                تسجيل الخروج
              </a>
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
            className="menu-toggle"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="فتح القائمة"
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </nav>
    </header>
  );
}
