import type { Metadata } from "next";
import ResultClient from "../../components/ResultClient";
import { requireStudentUser } from "../../lib/student-session";

export const metadata: Metadata = { title: "نتيجة الامتحان" };
export const dynamic = "force-dynamic";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStudentUser(`/result/${id}`);
  return (
    <main className="portal-page">
      <div className="container">
        <ResultClient attemptId={id} />
      </div>
    </main>
  );
}
