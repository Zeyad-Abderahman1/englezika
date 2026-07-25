"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, XCircle, LoaderCircle } from "lucide-react";

type AttemptDetail = {
  attempt: {
    id: string;
    examId: string;
    examTitle: string;
    score: number;
    maxScore: number;
    percentage: number;
    passed: boolean;
    passingScore: number;
    feedback: string;
    gradingMethod: string;
    startedAt: number;
    submittedAt: number;
  };
  answers: Array<{
    id: string;
    questionId: string;
    sortOrder: number;
    type: string;
    prompt: string;
    options: string[];
    correctAnswer: string;
    answer: string;
    score: number;
    points: number;
    feedback: string;
  }>;
};

export default function ResultClient({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/attempts/${attemptId}`, { cache: "no-store" })
      .then((res) => res.json() as Promise<AttemptDetail & { error?: string }>)
      .then((result) => {
        if (result.error) setError(result.error);
        else setData(result);
      })
      .catch(() => setError("تعذّر تحميل النتيجة"));
  }, [attemptId]);

  if (error) return <div className="dashboard-state error-toast">{error}</div>;
  if (!data) return <div className="dashboard-state"><LoaderCircle className="spin" /> جاري تحميل النتيجة...</div>;

  const { attempt, answers } = data;

  return (
    <div className="dashboard-shell">
      <header className="dashboard-welcome">
        <div>
          <span className="section-label">نتيجة الامتحان</span>
          <h1>{attempt.examTitle}</h1>
          <p>{new Date(attempt.submittedAt).toLocaleString("ar-EG")}</p>
        </div>
        <Link href="/account" className="btn btn-outline"><ArrowRight /> العودة لحسابي</Link>
      </header>

      <section className="stats-grid">
        <article>
          {attempt.passed ? <CheckCircle2 color="#27ae60" /> : <XCircle color="#e74c3c" />}
          <span>{attempt.passed ? "ناجح" : "لم تنجح"}</span>
          <strong style={{ color: attempt.passed ? "#27ae60" : "#e74c3c" }}>
            {attempt.passed ? "تجاوز النجاح" : "دون الحد الأدنى"}
          </strong>
        </article>
        <article>
          <span>الدرجة</span>
          <strong>{attempt.score} / {attempt.maxScore}</strong>
        </article>
        <article>
          <span>النسبة</span>
          <strong>{attempt.percentage}%</strong>
        </article>
        <article>
          <span>نسبة النجاح</span>
          <strong>{attempt.passingScore}%</strong>
        </article>
      </section>

      <section className="dashboard-panel">
        <div className="panel-title"><div><h2>ملاحظة عامة</h2></div></div>
        <p style={{ padding: "0.5rem 0" }}>{attempt.feedback}</p>
        {attempt.gradingMethod === "ai" && (
          <small style={{ opacity: 0.6 }}>تم التصحيح بواسطة الذكاء الاصطناعي</small>
        )}
        {attempt.gradingMethod === "teacher_review" && (
          <small style={{ opacity: 0.6 }}>تم المراجعة من قِبل المدرس</small>
        )}
      </section>

      <section className="dashboard-panel">
        <div className="panel-title"><div><h2>تفاصيل الأسئلة</h2><p>{answers.length} سؤال</p></div></div>
        <div className="question-results">
          {answers.map((ans, index) => {
            const correct = ans.score >= ans.points;
            const partial = ans.score > 0 && ans.score < ans.points;
            return (
              <article key={ans.id} className="question-result-card" style={{
                borderRight: `4px solid ${correct ? "#27ae60" : partial ? "#f39c12" : "#e74c3c"}`,
                padding: "1rem",
                marginBottom: "1rem",
                borderRadius: "8px",
                background: "var(--surface-1, rgba(0,0,0,0.03))",
              }}>
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <strong style={{ flex: 1 }}>السؤال {index + 1}: {ans.prompt}</strong>
                  <span className={`status-pill status-${correct ? "approved" : partial ? "pending" : "rejected"}`} style={{ whiteSpace: "nowrap" }}>
                    {ans.score} / {ans.points}
                  </span>
                </header>
                {ans.options.length > 0 && (
                  <ul style={{ listStyle: "none", padding: "0.5rem 0", margin: 0 }}>
                    {ans.options.map((opt) => (
                      <li key={opt} style={{ padding: "0.25rem 0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        {opt === ans.correctAnswer ? <CheckCircle2 size={14} color="#27ae60" /> : opt === ans.answer && opt !== ans.correctAnswer ? <XCircle size={14} color="#e74c3c" /> : <span style={{ width: 14 }} />}
                        {opt}
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                  <div><b>إجابتك:</b> {ans.answer || "—"}</div>
                  {ans.answer !== ans.correctAnswer && (
                    <div style={{ color: "#27ae60" }}><b>الإجابة الصحيحة:</b> {ans.correctAnswer}</div>
                  )}
                  {ans.feedback && <div style={{ marginTop: "0.25rem", opacity: 0.75 }}>{ans.feedback}</div>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
