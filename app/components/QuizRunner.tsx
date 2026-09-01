'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, LoaderCircle, Send } from 'lucide-react';
import { replaceAbortController, runRecoverableLoad } from '../lib/recoverable-load';

type Question = {
  id: string;
  sortOrder: number;
  type: string;
  prompt: string;
  options: string[];
  points: number;
};
type ExamPayload = {
  exam: {
    id: string;
    title: string;
    description: string;
    instructions: string;
    durationMinutes: number;
    passingScore: number;
  };
  session: { id: string; startedAt: number; expiresAt: number };
  questions: Question[];
};
type Result = {
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  feedback: string;
  gradingMethod: string;
  answers: Array<{ questionId: string; score: number; points: number; feedback: string }>;
};

export default function QuizRunner({ examId }: { examId: string }) {
  const [payload, setPayload] = useState<ExamPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [focusWarning, setFocusWarning] = useState(false);
  const visibilityViolations = useRef(0);
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
          };
          if (!startResponse.ok) {
            throw new Error(startData.error || 'تعذر بدء الامتحان');
          }
          const response = await fetch(`/api/exams/${examId}`, {
            cache: 'no-store',
            signal,
          });
          const data = (await response.json().catch(() => ({}))) as ExamPayload & {
            error?: string;
          };
          if (!response.ok) throw new Error(data.error || 'تعذر فتح الامتحان');
          return data;
        },
        {
          signal,
          fallbackMessage: 'تعذر تجهيز الامتحان. تحقق من اتصالك ثم حاول مرة أخرى.',
          onSuccess(data) {
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
    const controller = replaceAbortController(loadControllerRef.current);
    loadControllerRef.current = controller;
    void loadExam(controller.signal);
  }, [loadExam]);

  useEffect(() => {
    beginExamLoad();
    return () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    };
  }, [beginExamLoad]);

  useEffect(() => {
    if (!payload || result) return;
    const timer = window.setInterval(() => {
      const seconds = Math.max(
        0,
        Math.floor((Number(payload.session.expiresAt) - Date.now()) / 1000)
      );
      setRemaining(seconds);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [payload, result]);

  useEffect(() => {
    if (payload) localStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers, draftKey, payload]);

  useEffect(() => {
    if (!payload || result) return;
    const protectExam = () => {
      if (document.visibilityState !== 'hidden') return;
      visibilityViolations.current += 1;
      if (visibilityViolations.current === 1) {
        setFocusWarning(true);
        return;
      }
      localStorage.removeItem(draftKey);
      window.location.reload();
    };
    document.addEventListener('visibilitychange', protectExam);
    return () => document.removeEventListener('visibilitychange', protectExam);
  }, [draftKey, payload, result]);

  const submit = useCallback(async () => {
    if (!payload || submitting || result) return;
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
  }, [answers, draftKey, examId, payload, result, submitting]);

  useEffect(() => {
    // The server remains authoritative; this only initiates submission at timeout.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (payload && remaining === 0 && !result && !submitting) void submit();
  }, [payload, remaining, result, submit, submitting]);

  const answeredCount = useMemo(
    () => Object.values(answers).filter((answer) => answer.trim()).length,
    [answers]
  );

  if (loading)
    return (
      <div className="quiz-state">
        <LoaderCircle className="spin" /> جاري تجهيز الامتحان...
      </div>
    );
  if (error && !payload)
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
  if (!payload) return null;
  if (result)
    return (
      <div className="quiz-result">
        <div className={`result-ring ${result.passed ? 'passed' : 'needs-work'}`}>
          <strong>{result.percentage}%</strong>
          <span>
            {result.score} / {result.maxScore}
          </span>
        </div>
        <h1>{result.passed ? 'برافو عليك!' : 'خطوة كويسة ونكمّل'}</h1>
        <p>{result.feedback}</p>
        <div className="answer-feedback">
          {payload.questions.map((question) => {
            const grade = result.answers.find((item) => item.questionId === question.id);
            return (
              <article key={question.id}>
                <strong>
                  {question.sortOrder}. {question.prompt}
                </strong>
                <span>
                  {grade?.score || 0} / {question.points}
                </span>
                <p>{grade?.feedback}</p>
              </article>
            );
          })}
        </div>
        <Link href="/account" className="btn btn-primary btn-large">
          العودة إلى حسابي <ArrowLeft />
        </Link>
      </div>
    );

  const question = payload.questions[active];
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <div className="quiz-shell">
      {focusWarning && (
        <div className="exam-focus-warning" role="alertdialog" aria-modal="true">
          <div>
            <AlertTriangle />
            <span>التحذير الأول والأخير</span>
            <h2>لا تفتح أي نافذة أو تبويب آخر أثناء الامتحان</h2>
            <p>إذا غادرت صفحة الامتحان مرة ثانية سيُغلق الامتحان وتبدأ من السؤال الأول.</p>
            <button className="btn btn-primary" onClick={() => setFocusWarning(false)}>
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
        <CheckCircle2 /> لا تفتح تبويبًا آخر أثناء الامتحان. لديك تحذير واحد فقط، والمخالفة الثانية
        تعيد الامتحان من البداية.
      </div>
    </div>
  );
}
