"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Camera, Globe2, PlaySquare, Send } from "lucide-react";

export default function Footer() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin") || pathname.startsWith("/staff")) return null;
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-intro">
          <Link href="/" className="brand footer-brand">
            <span className="brand-icon"><BookOpen size={24} /></span>
            <span><strong>Englizeka</strong><small>إنجليزيكا</small></span>
          </Link>
          <p>بنعلمك الإنجليزي بطريقتنا.</p>
        </div>
        <nav className="footer-links" aria-label="روابط سريعة">
          <Link href="/courses">الكورسات</Link>
          <Link href="/about">عن المستر</Link>
          <Link href="/contact">تواصل معنا</Link>
          <Link href="/login">تسجيل الدخول</Link>
        </nav>
        <div className="socials" aria-label="روابط التواصل">
          <a href="https://facebook.com/englizeka" aria-label="فيسبوك"><Globe2 /></a>
          <a href="https://youtube.com/@englizeka" aria-label="يوتيوب"><PlaySquare /></a>
          <a href="https://instagram.com" aria-label="إنستجرام"><Camera /></a>
          <a href="https://t.me/englizeka" aria-label="تيليجرام"><Send /></a>
        </div>
      </div>
      <div className="container copyright">© 2026 Englizeka — إنجليزيكا. جميع الحقوق محفوظة.</div>
    </footer>
  );
}
