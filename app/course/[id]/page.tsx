import type { Metadata } from "next";
import CourseDetailClient from "../../components/CourseDetailClient";

export const metadata: Metadata = { title: "تفاصيل الكورس" };

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="inner-page"><CourseDetailClient courseId={id} /></main>;
}
