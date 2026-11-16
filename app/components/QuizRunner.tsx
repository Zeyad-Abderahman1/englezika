'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, Clock3, LoaderCircle, Send } from 'lucide-react';
import AssessmentReview, { type ReviewQuestion } from './AssessmentReview';
import { replaceAbortController, runRecoverableLoad } from '../lib/recoverable-load';

type Question = {
  id: string;
  sortOrder: number;
  type: string;
  prompt: string;
  options: string[];
  points: number;
  hasImage?: boolean;
  explanation?: string;
};

type ExamPayload = {
  exam: {
    id: string;
    title: string;
    description: string;
    instructions: string;
    durationMinutes: number;
    passingScore: number;
    showReview?: boolean;
  };
  session: { id: string; startedAt: number; expiresAt: number };
  questions: Question[];
};

type Result = {
  attemptId?: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  feedback: string;
  gradingMethod: string;
  showReview?: boolean;
  answers: Array<{
    questionId: string;
    score: number;
    points: number;
    feedback: string;
    correctAnswer?: string;
    explanation?: string;
  }>;
};

export default function QuizRunner({ examId }: { examId: string }) {
  const [hasConsented, setHasConsented] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(`exam-consent-${examId}`) === 'true';
    }
    return false;
  });
  const [payload, setPayload] = useState<ExamPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [showReviewScreen, setShowReviewScreen] = useState(false);
  const [focusWarning, setFocusWarning] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);

  const lastViolationSentRef = useRef<number>(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const draftKey = `englizeka-exam-${examId}`;

  const loadExam = useCallback(
    async (signal?: AbortSignal) => {
      await runRecoverableLoad(
        async () => {
          const startResponse = await fetch(`/api/exams/${examId}/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            cache: 'no-store',
            signal,
          });
          const startData = (await startResponse.json().catch(() => ({}))) as {
            error?: string;
            terminated?: boolean;
          };
          if (startData.terminated || startData.error?.includes('تم إنهاء الامتحان')) {
            setIsTerminated(true);
            return null;
          }
          if (!startResponse.ok) {
            throw new Error(startData.error || 'تعذر بدء الامتحان');
          }

          const response = await fetch(`/api/exams/${examId}`, {
            cache: 'no-store',
            signal,
          });
          const data = (await response.json().catch(() => ({}))) as (ExamPayload & {
            error?: string;
            terminated?: boolean;
          }) | null;

          if (data?.terminated || data?.error?.includes('تم إنهاء الامتحان')) {
            setIsTerminated(true);
            return null;
          }
          if (!response.ok || !data) throw new Error(data?.error || 'تعذر فتح الامتحان');
          return data;
        },
        {
          signal,
          fallbackMessage: 'تعذر تجهيز الامتحان. تحقق من اتصالك ثم حاول مرة أخرى.',
          onSuccess(data) {
            if (!data) return;
            setPayload(data);
            setRemaining(
              Math.max(0, Math.floor((Number(data.session.expiresAt) - Date.now()) / 1000))
            );
            try {
              const draft = localStorage.getItem(draftKey);
              if (draft) setAnswers(JSON.parse(draft));
            } catch {
              /* Ignore an invalid device-local draft. */
            }
          },
          onError: setError,
          onSettled: () => setLoading(false),
        }
      );
    },
    [draftKey, examId]
  );

  const beginExamLoad = useCallback(() => {
    setLoading(true);
    setError('');
    const controller = replaceAbortController(loadControllerRef.current);
    loadControllerRef.current = controller;
    void loadExam(controller.signal);
  }, [loadExam]);

  useEffect(() => {
    if (hasConsented) {
      beginExamLoad();
    } else {
      setLoading(false);
    }
    return () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    };
  }, [beginExamLoad, hasConsented]);

  useEffect(() => {
    if (!payload || result || isTerminated) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(
        0,
        Math.floor((Number(payload.session.expiresAt) - Date.now()) / 1000)
      );
      setRemaining(seconds);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isTerminated, payload, result]);

  useEffect(() => {
    if (payload && !isTerminated) localStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers, draftKey, isTerminated, payload]);

  // ── Focus Protection ────────────────────────────────────────────────────────
  const reportFocusViolation = useCallback(async () => {
    if (!payload || submitting || result || isTerminated) return;
    const now = Date.now();
    // Deduplicate rapid consecutive client events (< 2500ms)
    if (now - lastViolationSentRef.current < 2500) return;
    lastViolationSentRef.current = now;

    try {
      const response = await fetch(`/api/attempts/${encodeURIComponent(payload.session.id)}/focus-violation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        violationCount?: number;
        terminated?: boolean;
      };

      if (data.terminated || (typeof data.violationCount === 'number' && data.violationCount >= 2)) {
        setIsTerminated(true);
        localStorage.removeItem(draftKey);
      } else if (data.violationCount === 1) {
        setFocusWarning(true);
      }
    } catch {
      // Non-critical network error
    }
  }, [answers, draftKey, isTerminated, payload, result, submitting]);

  useEffect(() => {
    if (!payload || result || isTerminated) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void reportFocusViolation();
      }
    };

    const handlePageHide = () => {
      void reportFocusViolation();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [isTerminated, payload, reportFocusViolation, result]);

  const submit = useCallback(async () => {
    if (!payload || submitting || result || isTerminated) return;
    setSubmitting(true);
    setError('');
    const response = await fetch(`/api/exams/${examId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: payload.session.id, answers }),
    });
    const data = (await response.json().catch(() => ({}))) as Result & { error?: string };
    setSubmitting(false);
    if (!response.ok) return setError(data.error || 'تعذر تسليم الامتحان');
    localStorage.removeItem(draftKey);
    setResult(data);
  }, [answers, draftKey, examId, isTerminated, payload, result, submitting]);

  useEffect(() => {
    if (payload && remaining === 0 && !result && !submitting && !isTerminated) {
      void submit();
    }
  }, [isTerminated, payload, remaining, result, submit, submitting]);

  const answeredCount = useMemo(
    () => Object.values(answers).filter((answer) => answer.trim()).length,
    [answers]
  );

  // Terminated Screen
  if (isTerminated) {
    return (
      <div className="quiz-state quiz-terminated-state" role="alert" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
        <AlertTriangle size={52} style={{ color: '#ef4444', margin: '0 auto 1rem' }} />
        <h2 style={{ fontSize: '1.6rem', color: '#ef4444', marginBottom: '0.75rem' }}>تم إنهاء الامتحان</h2>
        <p style={{ fontSize: '1.1rem', marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
          تم تسجيل مغادرة صفحة الامتحان للمرة الثانية.
        </p>
        <Link href="/account" className="btn btn-primary btn-large">
          العودة إلى حسابي
        </Link>
      </div>
    );
  }

  // Pre-exam Warning and Consent
  if (!hasConsented) {
    return (
      <div className="quiz-consent-shell" style={{ maxWidth: '640px', margin: '2rem auto', padding: '1.5rem' }}>
        <div
          className="quiz-consent-card"
          style={{
            background: 'var(--card-bg, #1a1a24)',
            border: '1px solid var(--border-color, #333)',
            borderRadius: '16px',
            padding: '2.5rem 2rem',
            textAlign: 'center',
          }}
        >
          <div style={{ color: '#f59e0b', marginBottom: '1.25rem' }}>
            <AlertTriangle size={48} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1.25rem' }}>
            تنبيه مهم
          </h2>
          <div
            style={{
              fontSize: '1.05rem',
              lineHeight: 1.8,
              color: 'var(--text-secondary, #ccc)',
              marginBottom: '2rem',
              textAlign: 'right',
              background: 'rgba(245, 158, 11, 0.08)',
              padding: '1.25rem',
              borderRadius: '12px',
              border: '1px solid rgba(245, 158, 11, 0.2)',
            }}
          >
            <p style={{ margin: '0 0 0.5rem 0' }}>
              أثناء الامتحان يجب عدم مغادرة صفحة الامتحان أو الانتقال إلى تبويب أو تطبيق آخر.
            </p>
            <p style={{ margin: '0 0 0.5rem 0' }}>
              سيتم تسجيل مغادرة الامتحان.
            </p>
            <p style={{ margin: '0 0 0.5rem 0' }}>
              في المرة الأولى سيظهر لك تحذير.
            </p>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--text-primary)' }}>
              في المرة الثانية سيتم إنهاء الامتحان تلقائيًا.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-large"
            style={{ width: '100%', fontSize: '1.1rem', padding: '0.875rem 1.5rem' }}
            onClick={() => {
              sessionStorage.setItem(`exam-consent-${examId}`, 'true');
              setHasConsented(true);
            }}
          >
            أفهم وأوافق
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="quiz-state">
        <LoaderCircle className="spin" /> جاري تجهيز الامتحان...
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="quiz-state">
        <AlertTriangle />
        <p>{error}</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setLoading(true);
            setError('');
            beginExamLoad();
          }}
        >
          إعادة المحاولة
        </button>
        <Link href="/account" className="btn btn-primary">
          العودة إلى حسابي
        </Link>
      </div>
    );
  }

  if (!payload) return null;

  if (result) {
    const isReviewAllowed =
      result.showReview !== false && payload.exam.showReview !== false;

    const reviewQuestions: ReviewQuestion[] = payload.questions.map((question) => {
      const grade = result.answers.find((item) => item.questionId === question.id);
      return {
        id: question.id,
        prompt: question.prompt,
        sortOrder: question.sortOrder,
        points: question.points,
        options: question.options || [],
        studentAnswer: answers[question.id] || '',
        correctAnswer:
          grade?.correctAnswer ||
          (grade?.feedback?.includes(':') ? grade.feedback.split(':').slice(1).join(':').trim() : '') ||
          ((grade?.score ?? 0) > 0 ? (answers[question.id] || '') : ''),
        isCorrect: (grade?.score ?? 0) > 0,
        explanation: grade?.explanation || question.explanation,
        hasImage: question.hasImage,
      };
    });

    if (showReviewScreen && isReviewAllowed) {
      return (
        <div className="quiz-result" style={{ padding: '1rem 0' }}>
          <AssessmentReview
            title={`مراجعة إجابات: ${payload.exam.title}`}
            score={result.score}
            maxScore={result.maxScore}
            percentage={result.percentage}
            questions={reviewQuestions}
            onBack={() => setShowReviewScreen(false)}
          />
        </div>
      );
    }

    return (
      <div className="quiz-result" style={{ maxWidth: '640px', margin: '2rem auto', textAlign: 'center', padding: '1.5rem' }}>
        <div
          className="quiz-result-card"
          style={{
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--line, #e2e8f0)',
            borderRadius: '16px',
            padding: '2.5rem 2rem',
            boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ marginBottom: '1.25rem' }}>
            {result.passed ? (
              <CheckCircle2 size={56} style={{ color: '#16a34a', margin: '0 auto' }} />
            ) : (
              <AlertTriangle size={56} style={{ color: '#f59e0b', margin: '0 auto' }} />
            )}
          </div>

          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--text, #18181b)' }}>
            {result.passed ? 'برافو عليك! تم اجتياز الامتحان بنجاح' : 'تم تسليم الامتحان'}
          </h2>

          <p style={{ fontSize: '1rem', color: 'var(--muted, #64748b)', marginBottom: '1.75rem' }}>
            {result.feedback}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '1rem',
              background: 'var(--surface-2, rgba(0,0,0,0.02))',
              padding: '1.25rem',
              borderRadius: '12px',
              border: '1px solid var(--line, #e2e8f0)',
              marginBottom: '2rem',
            }}
          >
            <div>
              <span style={{ fontSize: '0.825rem', color: 'var(--muted, #64748b)', display: 'block', marginBottom: '0.25rem' }}>الدرجة المستحقة</span>
              <strong style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text, #18181b)' }}>
                {result.score} / {result.maxScore}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.825rem', color: 'var(--muted, #64748b)', display: 'block', marginBottom: '0.25rem' }}>النسبة المئوية</span>
              <strong style={{ fontSize: '1.4rem', fontWeight: 800, color: result.passed ? '#16a34a' : '#d7193f' }}>
                {result.percentage}%
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {isReviewAllowed && (
              <button
                type="button"
                className="btn btn-primary btn-large"
                style={{
                  minHeight: '48px',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  width: '100%',
                }}
                onClick={() => setShowReviewScreen(true)}
              >
                <ClipboardCheck size={20} /> مراجعة الإجابات
              </button>
            )}

            <Link
              href="/account"
              className={isReviewAllowed ? 'btn btn-outline btn-large' : 'btn btn-primary btn-large'}
              style={{
                minHeight: '48px',
                fontSize: '1rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                width: '100%',
              }}
            >
              العودة إلى حسابي <ArrowLeft size={18} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const question = payload.questions[active];
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="quiz-shell">
      {focusWarning && (
        <div className="exam-focus-warning" role="alertdialog" aria-modal="true">
          <div>
            <AlertTriangle />
            <span>تحذير أول وأخير</span>
            <h2>لقد غادرت صفحة الامتحان مرة واحدة.</h2>
            <p>إذا غادرت الامتحان مرة أخرى سيتم إنهاء الامتحان تلقائيًا.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setFocusWarning(false)}
            >
              متابعة الامتحان
            </button>
          </div>
        </div>
      )}
      <header className="quiz-header">
        <div>
          <span className="section-label">امتحان إلكتروني</span>
          <h1>{payload.exam.title}</h1>
          <p>{payload.exam.instructions || payload.exam.description}</p>
        </div>
        <div className={`quiz-timer ${remaining < 300 ? 'urgent' : ''}`}>
          <Clock3 />
          <strong>
            {minutes}:{String(seconds).padStart(2, '0')}
          </strong>
          <span>الوقت المتبقي</span>
        </div>
      </header>
      <div className="quiz-progress">
        <span style={{ width: `${(answeredCount / payload.questions.length) * 100}%` }} />
      </div>
      <div className="quiz-layout">
        <aside className="question-nav" aria-label="التنقل بين الأسئلة">
          {payload.questions.map((item, index) => (
            <button
              key={item.id}
              onClick={() => setActive(index)}
              className={`${active === index ? 'active' : ''} ${answers[item.id]?.trim() ? 'answered' : ''}`}
            >
              {index + 1}
            </button>
          ))}
        </aside>
        <section className="question-card">
          <div className="question-meta">
            <span>
              السؤال {active + 1} من {payload.questions.length}
            </span>
            <strong>{question.points} درجة</strong>
          </div>
          <h2>{question.prompt}</h2>
          {question.hasImage && (
            <img
              src={`/api/student/questions/${question.id}/image`}
              alt="صورة السؤال"
              className="question-image"
              loading="lazy"
            />
          )}
          {question.type === 'short_answer' ? (
            <textarea
              rows={7}
              value={answers[question.id] || ''}
              onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
              placeholder="اكتب إجابتك بالتفصيل..."
            />
          ) : (
            <div className="choice-list">
              {question.options.map((option) => (
                <label key={option} className={answers[question.id] === option ? 'selected' : ''}>
                  <input
                    type="radio"
                    name={question.id}
                    value={option}
                    checked={answers[question.id] === option}
                    onChange={() => setAnswers({ ...answers, [question.id]: option })}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          )}
          <div className="question-actions">
            <button
              className="btn btn-ghost"
              disabled={active === 0}
              onClick={() => setActive((value) => value - 1)}
            >
              السابق
            </button>
            {active < payload.questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setActive((value) => value + 1)}>
                التالي <ArrowLeft />
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={submitting}
                onClick={() => void submit()}
              >
                <Send /> {submitting ? 'جاري التصحيح...' : 'تسليم الامتحان'}
              </button>
            )}
          </div>
          {error && <div className="error-toast">{error}</div>}
        </section>
      </div>
      <div className="quiz-note">
        <CheckCircle2 /> لا تفتح تبويبًا آخر أثناء الامتحان. لديك تحذير واحد فقط، والمخالفة الثانية تنهي الامتحان تلقائيًا.
      </div>
    </div>
  );
}
