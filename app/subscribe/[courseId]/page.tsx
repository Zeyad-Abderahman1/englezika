import type { Metadata } from "next";
import SubscribeClient from "../../components/SubscribeClient";
import { requireStudentUser } from "../../lib/student-session";

export const metadata: Metadata = { title: "الاشتراك" };
export const dynamic = "force-dynamic";

export default async function SubscribePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  await requireStudentUser(`/subscribe/${courseId}`);
  return (
    <main className="inner-page">
      <section className="page-hero compact"><div className="container"><span className="section-label">خطوة واحدة وتبدأ</span><h1>اشترك في الكورس</h1></div></section>
      <section className="section"><SubscribeClient courseId={courseId} /></section>
    </main>
  );
}
