import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ScrollEffects from "./components/ScrollEffects";
import { getCurrentStudentUser } from "./lib/api-auth";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  return {
    metadataBase: base,
    title: { default: "Englizeka | إنجليزيكا", template: "%s | Englizeka" },
    description: "منصة مستر أحمد حسن لتعليم اللغة الإنجليزية لطلاب الثانوية العامة بطريقة واضحة ومختلفة.",
    openGraph: {
      title: "Englizeka | افهم الإنجليزي وخليه نقطة قوتك",
      description: "منصة مستر أحمد حسن لطلاب الثانوية العامة.",
      type: "website",
      locale: "ar_EG",
      images: [{ url: new URL("/og.png", base), width: 1732, height: 909, alt: "Englizeka" }],
    },
    twitter: { card: "summary_large_image", images: [new URL("/og.png", base)] },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentStudentUser();
  const viewer = user ? { displayName: user.displayName } : null;

  return (
    <html lang="ar" dir="rtl" data-theme="dark">
      <body><ScrollEffects /><Navbar viewer={viewer} />{children}<Footer /></body>
    </html>
  );
}
