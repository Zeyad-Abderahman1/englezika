import type { Metadata } from "next";
import QuizRunner from "../../components/QuizRunner";
import { requireStudentUser } from "../../lib/student-session";

export const metadata: Metadata = { title: "الامتحان" };
export const dynamic = "force-dynamic";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStudentUser(`/exam/${id}`);
  return <main className="portal-page quiz-page"><div className="container"><QuizRunner examId={id} /></div></main>;
}
