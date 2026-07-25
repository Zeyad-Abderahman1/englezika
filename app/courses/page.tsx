import type { Metadata } from "next";
import CoursesExplorer from "../components/CoursesExplorer";

export const metadata: Metadata = { title: "الكورسات" };

export default function CoursesPage() {
  return <main className="inner-page"><section className="page-hero"><div className="container"><span className="section-label">اختار خطتك</span><h1>كل كورسات إنجليزيكا</h1><p>محتوى مرتب لكل صف، من الشرح للتدريب والمراجعة.</p></div></section><section className="section"><div className="container"><CoursesExplorer /></div></section></main>;
}
