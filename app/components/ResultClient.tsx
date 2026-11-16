'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, XCircle, LoaderCircle, ClipboardCheck } from 'lucide-react';
import AssessmentReview, { type ReviewQuestion } from './AssessmentReview';

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
    showReview?: boolean;
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
    explanation?: string | null;
    hasImage?: boolean;
  }>;
};

export default function ResultClient({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState('');
  const [showReviewScreen, setShowReviewScreen] = useState(false);

  useEffect(() => {
    fetch(`/api/attempts/${attemptId}`, { cache: 'no-store' })
      .then((res) => res.json() as Promise<AttemptDetail & { error?: string }>)
      .then((result) => {
        if (result.error) setError(result.error);
        else setData(result);
      })
      .catch(() => setError('تعذّر تحميل النتيجة'));
  }, [attemptId]);

  if (error) return <div className="dashboard-state error-toast">{error}</div>;
  if (!data)
    return (
      <div className="dashboard-state">
        <LoaderCircle className="spin" /> جاري تحميل النتيجة...
      </div>
    );

  const { attempt, answers } = data;
  const isReviewAllowed = attempt.showReview !== false && answers.length > 0;

  const reviewQuestions: ReviewQuestion[] = answers.map((ans, idx) => ({
    id: ans.questionId || ans.id,
    prompt: ans.prompt,
    sortOrder: ans.sortOrder || idx + 1,
    points: ans.points,
    studentAnswer: ans.answer,
    correctAnswer: ans.correctAnswer,
    isCorrect: ans.score >= ans.points,
    explanation: ans.explanation,
    hasImage: ans.hasImage,
    options: ans.options,
    type: ans.type,
  }));

  if (showReviewScreen && isReviewAllowed) {
    return (
      <div className="dashboard-shell" style={{ maxWidth: '880px', margin: '0 auto', padding: '1.5rem' }}>
        <AssessmentReview
          title={`مراجعة إجابات: ${attempt.examTitle}`}
          score={attempt.score}
          maxScore={attempt.maxScore}
          percentage={attempt.percentage}
          questions={reviewQuestions}
          onBack={() => setShowReviewScreen(false)}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <header className="dashboard-welcome">
        <div>
          <span className="section-label">نتيجة الامتحان</span>
          <h1>{attempt.examTitle}</h1>
          <p>{new Date(attempt.submittedAt).toLocaleString('ar-EG')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {isReviewAllowed && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowReviewScreen(true)}
              style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <ClipboardCheck size={18} /> مراجعة الإجابات
            </button>
          )}
          <Link href="/account" className="btn btn-outline" style={{ minHeight: '44px' }}>
            <ArrowRight /> العودة لحسابي
          </Link>
        </div>
      </header>

      <section className="stats-grid">
        <article>
          {attempt.passed ? <CheckCircle2 color="#27ae60" /> : <XCircle color="#e74c3c" />}
          <span>{attempt.passed ? 'ناجح' : 'لم تنجح'}</span>
          <strong style={{ color: attempt.passed ? '#27ae60' : '#e74c3c' }}>
            {attempt.passed ? 'تجاوز النجاح' : 'دون الحد الأدنى'}
          </strong>
        </article>
        <article>
          <span>الدرجة</span>
          <strong>
            {attempt.score} / {attempt.maxScore}
          </strong>
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
        <div className="panel-title">
          <div>
            <h2>ملاحظة عامة</h2>
          </div>
        </div>
        <p style={{ padding: '0.5rem 0' }}>{attempt.feedback}</p>
        {attempt.gradingMethod === 'ai' && (
          <small style={{ opacity: 0.6 }}>تم التصحيح بواسطة الذكاء الاصطناعي</small>
        )}
        {attempt.gradingMethod === 'teacher_review' && (
          <small style={{ opacity: 0.6 }}>تم المراجعة من قِبل المدرس</small>
        )}
      </section>

      <section className="dashboard-panel">
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h2>تفاصيل الأسئلة والإجابات</h2>
            <p>{answers.length} سؤال</p>
          </div>
          {isReviewAllowed && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowReviewScreen(true)}
              style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <ClipboardCheck size={18} /> مراجعة الإجابات والشرح
            </button>
          )}
        </div>

        {!isReviewAllowed ? (
          <p style={{ padding: '1.25rem', color: 'var(--muted, #64748b)' }}>
            مراجعة إجابات هذا الامتحان غير مفعلة من قِبل المعلم.
          </p>
        ) : (
          <div style={{ padding: '1.5rem', textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={() => setShowReviewScreen(true)}
              style={{
                minHeight: '48px',
                fontSize: '1.05rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 2rem',
              }}
            >
              <ClipboardCheck size={20} /> فتح شاشة مراجعة الإجابات والشرح
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
