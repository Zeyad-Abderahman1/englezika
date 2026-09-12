'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Check, Trash2, Plus, LoaderCircle, AlertTriangle, BookOpen } from 'lucide-react';
import type { GeneratedAssessmentPreview, GeneratedQuestion } from '../../../lib/ai/content-generator';
import { isAssessmentSubmissionAllowed, validateGeneratedQuestion } from '../../../lib/ai/assessment-validator';

interface AssessmentPreviewModalProps {
  assessment: GeneratedAssessmentPreview;
  isOpen: boolean;
  onClose: () => void;
  onSaveToCourse: (finalQuestions: GeneratedQuestion[], title: string, examType: 'exam' | 'quiz') => Promise<void>;
}

const QUESTION_REASON_LABELS: Record<string, string> = {
  EMPTY_QUESTION: 'أدخل نصًا واضحًا للسؤال.',
  WRONG_OPTION_COUNT: 'يجب أن يحتوي السؤال على أربعة اختيارات.',
  EMPTY_OPTION: 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.',
  DUPLICATE_OPTION: 'يجب أن تكون الاختيارات مختلفة وغير مكررة.',
  INVALID_CORRECT_INDEX: 'حدد إجابة صحيحة واحدة.',
  MISSING_CORRECT_ANSWER: 'حدد الإجابة الصحيحة.',
  MALFORMED_QUESTION: 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.',
  DUPLICATE_QUESTION_TEXT: 'نص السؤال مكرر.',
};

export function AssessmentPreviewModal({
  assessment,
  isOpen,
  onClose,
  onSaveToCourse,
}: AssessmentPreviewModalProps) {
  const [title, setTitle] = useState(assessment.title);
  const [examType, setExamType] = useState<'exam' | 'quiz'>(assessment.examType);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>(assessment.questions || []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previousFocus?.focus(); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submissionCheck = isAssessmentSubmissionAllowed(questions);

  const handlePromptChange = (idx: number, val: string) => {
    setQuestions((current) => current.map((question, index) => index === idx ? { ...question, prompt: val } : question));
  };

  const handleOptionChange = (qIdx: number, optIdx: number, val: string) => {
    setQuestions((current) => current.map((question, index) => {
      if (index !== qIdx) return question;
      const oldOption = question.options[optIdx];
      const options = question.options.map((option, optionIndex) => optionIndex === optIdx ? val : option);
      return { ...question, options, correctAnswer: question.correctAnswer === oldOption ? val : question.correctAnswer };
    }));
  };

  const handleCorrectAnswerSelect = (qIdx: number, correctVal: string) => {
    setQuestions((current) => current.map((question, index) => index === qIdx ? { ...question, correctAnswer: correctVal, correctIndex: question.options.indexOf(correctVal) } : question));
  };

  const handleDeleteQuestion = (idx: number) => {
    if (questions.length <= 1) {
      setError('يجب أن يحتوي التقييم على سؤال واحد على الأقل.');
      return;
    }
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: `custom_q_${Date.now()}`,
        prompt: 'سؤال جديد...',
        options: ['الخيار A', 'الخيار B', 'الخيار C', 'الخيار D'],
        correctAnswer: 'الخيار A',
        correctIndex: 0,
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!submissionCheck.allowed) {
      setError(submissionCheck.reason || 'يوجد أخطاء في الأسئلة يجب تصحيحها قبل الإدراج.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSaveToCourse(questions, title, examType);
      onClose();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'تعذر حفظ الأسئلة في الدورة.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ai-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="assessment-modal-title">
      <div className="ai-modal-card" ref={dialogRef} tabIndex={-1}>
        {/* Header */}
        <div className="ai-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="ai-drawer-badge">
              <BookOpen size={18} />
            </div>
            <div>
              <h3 id="assessment-modal-title" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                مراجعة وتعديل الأسئلة
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>
                {questions.length} سؤالًا · {examType === 'quiz' ? 'Quiz' : 'Exam'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="ai-drawer-close-btn"
            onClick={onClose}
            aria-label="إغلاق نافذة المراجعة"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="ai-modal-body">
          {error && (
            <div className="p-3 bg-red-900/40 border border-red-500/40 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          {!submissionCheck.allowed && (
            <div className="p-2 mb-2 bg-amber-950/50 border border-amber-500/50 rounded text-amber-200 text-xs flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-400 shrink-0" />
              <span>{submissionCheck.reason}</span>
            </div>
          )}

          {/* Assessment Title & Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <div>
              <label className="text-xs text-slate-400 font-semibold mb-1 block">عنوان التقييم</label>
              <input
                type="text"
                className="ai-question-prompt-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-semibold mb-1 block">نوع التقييم</label>
              <select
                className="ai-question-prompt-input"
                value={examType}
                onChange={(e) => setExamType(e.target.value as 'exam' | 'quiz')}
              >
                <option value="quiz">كويز سريع (Quiz)</option>
                <option value="exam">امتحان شامل (Exam)</option>
              </select>
            </div>
          </div>

          {/* Questions Editor List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            {questions.map((q, qIdx) => {
              const qValidation = validateGeneratedQuestion(q);
              return (
                <div
                  key={q.id || qIdx}
                  className="ai-question-card"
                  style={{
                    borderColor: !qValidation.valid ? '#f59e0b' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-bold text-sky-400 text-sm">السؤال رقم {qIdx + 1}</span>
                    <button
                      type="button"
                      className="btn btn-ghost text-red-400"
                      onClick={() => handleDeleteQuestion(qIdx)}
                      style={{ padding: '0.2rem 0.5rem' }}
                      title="حذف هذا السؤال"
                      aria-label={`حذف السؤال رقم ${qIdx + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <input
                    type="text"
                    className="ai-question-prompt-input"
                    value={q.prompt}
                    onChange={(e) => handlePromptChange(qIdx, e.target.value)}
                    placeholder="نص السؤال..."
                    style={{
                      borderColor: !q.prompt?.trim() || q.prompt.trim().length < 5 ? '#ef4444' : undefined,
                    }}
                  />

                  {!qValidation.valid && (
                    <p className="ai-question-validation" role="alert">
                      <AlertTriangle size={14} />
                      {qValidation.reasons.map((reason) => QUESTION_REASON_LABELS[reason]).join(' ')}
                    </p>
                  )}

                  {/* Multiple choice options */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {(Array.isArray(q.options) ? q.options : []).map((rawOpt, optIdx) => {
                      const opt = typeof rawOpt === 'string'
                        ? rawOpt
                        : rawOpt && typeof rawOpt === 'object'
                        ? (rawOpt as any).text || (rawOpt as any).value || (rawOpt as any).option || (rawOpt as any).content || ''
                        : '';
                      const isCorrect = Boolean(q.correctAnswer && q.correctAnswer === opt);
                      const isOptEmpty = !opt || !opt.trim();
                      const letter = String.fromCharCode(65 + optIdx);
                      return (
                        <div
                          key={optIdx}
                          className="ai-option-row"
                          style={{
                            borderColor: isOptEmpty ? '#ef4444' : isCorrect ? '#22c55e' : undefined,
                          }}
                        >
                          <span
                            className="font-bold text-xs shrink-0"
                            style={{
                              color: isCorrect ? '#4ade80' : isOptEmpty ? '#f87171' : '#94a3b8',
                              minWidth: '1.2rem',
                            }}
                          >
                            {letter}.
                          </span>
                          <input
                            type="radio"
                            name={`correct_${qIdx}`}
                            checked={isCorrect}
                            onChange={() => handleCorrectAnswerSelect(qIdx, opt)}
                            title="تحديد كإجابة صحيحة"
                          />
                          <input
                            type="text"
                            className="ai-option-input"
                            value={opt}
                            placeholder={`الخيار ${letter}...`}
                            onChange={(e) => handleOptionChange(qIdx, optIdx, e.target.value)}
                            style={{
                              borderColor: isOptEmpty ? '#ef4444' : isCorrect ? '#22c55e' : undefined,
                              background: isCorrect
                                ? 'rgba(34, 197, 94, 0.08)'
                                : isOptEmpty
                                ? 'rgba(239, 68, 68, 0.08)'
                                : undefined,
                            }}
                          />
                          {isCorrect && (
                            <span className="text-xs text-green-400 font-bold" style={{ whiteSpace: 'nowrap' }}>
                              الإجابة الصحيحة
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="btn btn-ghost text-sky-400 text-xs mt-2"
            onClick={handleAddQuestion}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'fit-content' }}
          >
            <Plus size={14} />
            <span>إضافة سؤال جديد</span>
          </button>
        </div>

        {/* Footer */}
        <div className="ai-modal-footer">
          <button
            type="button"
            className="btn btn-secondary text-sm"
            onClick={onClose}
            disabled={submitting}
          >
            إلغاء
          </button>
          <button
            type="button"
            className="btn btn-primary text-sm"
            onClick={handleSubmit}
            disabled={submitting || !submissionCheck.allowed || questions.some((q) => !validateGeneratedQuestion(q).valid)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {submitting ? (
              <>
                <LoaderCircle size={16} className="spin" />
                <span>جاري إدراج الأسئلة في المنصة...</span>
              </>
            ) : (
              <>
                <Check size={16} />
                <span>تأكيد وإدراج {questions.length} سؤالًا</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
