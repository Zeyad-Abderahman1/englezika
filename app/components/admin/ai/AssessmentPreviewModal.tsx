'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Check, Trash2, Plus, LoaderCircle, AlertTriangle, BookOpen } from 'lucide-react';
import type { GeneratedAssessmentPreview, GeneratedQuestion } from '../../../lib/ai/content-generator';

interface AssessmentPreviewModalProps {
  assessment: GeneratedAssessmentPreview;
  isOpen: boolean;
  onClose: () => void;
  onSaveToCourse: (finalQuestions: GeneratedQuestion[], title: string, examType: 'exam' | 'quiz') => Promise<void>;
}

export function validateQuestionClient(q: GeneratedQuestion): { valid: boolean; reason?: string } {
  if (!q || typeof q !== 'object') {
    return { valid: false, reason: 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.' };
  }
  const promptTrimmed = typeof q.prompt === 'string' ? q.prompt.trim() : '';
  if (promptTrimmed.length === 0) {
    return { valid: false, reason: 'أدخل نصًا واضحًا للسؤال.' };
  }
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    return { valid: false, reason: 'يجب أن يحتوي السؤال على أربعة اختيارات.' };
  }
  for (let i = 0; i < 4; i++) {
    const opt = q.options[i];
    if (typeof opt !== 'string' || opt.trim().length === 0) {
      return { valid: false, reason: 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.' };
    }
  }
  const normalized = q.options.map((o) => (typeof o === 'string' ? o.trim().toLowerCase() : ''));
  if (new Set(normalized).size !== 4) {
    return { valid: false, reason: 'يجب أن تكون الاختيارات مختلفة وغير مكررة.' };
  }
  const isDummyLetterSet = normalized.every(
    (o) => /^[a-d]$/i.test(o) || /^\(?[a-d]\)?\.?$/i.test(o)
  );
  if (isDummyLetterSet) {
    return { valid: false, reason: 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.' };
  }
  const cIdx =
    typeof q.correctIndex === 'number' &&
    Number.isInteger(q.correctIndex) &&
    q.correctIndex >= 0 &&
    q.correctIndex <= 3
      ? q.correctIndex
      : q.options.indexOf(q.correctAnswer);
  if (cIdx < 0 || cIdx > 3) {
    return { valid: false, reason: 'حدد إجابة صحيحة واحدة.' };
  }
  if (!q.correctAnswer || q.correctAnswer !== q.options[cIdx]) {
    return { valid: false, reason: 'حدد الإجابة الصحيحة.' };
  }
  return { valid: true };
}

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

  const isAllValid = questions.length > 0 && questions.every((q) => validateQuestionClient(q).valid);
  const firstInvalid = questions.map((q, idx) => ({ q, idx, res: validateQuestionClient(q) })).find((item) => !item.res.valid);

  const handlePromptChange = (idx: number, val: string) => {
    setQuestions((current) => current.map((question, index) => index === idx ? { ...question, prompt: val } : question));
  };

  const handleOptionChange = (qIdx: number, optIdx: number, val: string) => {
    setQuestions((current) =>
      current.map((question, index) => {
        if (index !== qIdx) return question;
        const options = (Array.isArray(question.options) ? question.options : []).map(
          (option, optionIndex) => (optionIndex === optIdx ? val : (typeof option === 'string' ? option : ''))
        );
        const isThisCorrect = question.correctIndex === optIdx || question.correctAnswer === question.options?.[optIdx];
        return {
          ...question,
          options,
          correctAnswer: isThisCorrect ? val : question.correctAnswer,
        };
      })
    );
  };

  const handleCorrectAnswerSelect = (qIdx: number, optIdx: number) => {
    setQuestions((current) =>
      current.map((question, index) => {
        if (index !== qIdx) return question;
        const selectedText = typeof question.options?.[optIdx] === 'string' ? question.options[optIdx] : '';
        return {
          ...question,
          correctIndex: optIdx,
          correctAnswer: selectedText,
        };
      })
    );
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
    if (!isAllValid) {
      setError(firstInvalid?.res.reason || 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.');
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

          {!isAllValid && (
            <div className="p-2 mb-2 bg-amber-950/50 border border-amber-500/50 rounded text-amber-200 text-xs flex items-center gap-2" role="alert">
              <AlertTriangle size={15} className="text-amber-400 shrink-0" />
              <span>{firstInvalid?.res.reason || 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.'}</span>
            </div>
          )}

          {/* Assessment Metadata Banner */}
          <div className="ai-assessment-meta-banner">
            <div className="ai-meta-item">
              <span className="ai-meta-label">الدورة:</span>
              <span className="ai-meta-val">{assessment.coverage?.courseTitle || 'الدورة المحددة'}</span>
            </div>
            <div className="ai-meta-item">
              <span className="ai-meta-label">نوع التقييم:</span>
              <span className="ai-meta-val">{examType === 'quiz' ? 'Quiz' : 'Exam'}</span>
            </div>
            <div className="ai-meta-item">
              <span className="ai-meta-label">النطاق:</span>
              <span className="ai-meta-val">
                {assessment.coverage?.mode === 'range' && assessment.coverage.startLectureTitle && assessment.coverage.endLectureTitle
                  ? `من ${assessment.coverage.startLectureTitle} إلى ${assessment.coverage.endLectureTitle}`
                  : 'جميع المحاضرات'}
              </span>
            </div>
            <div className="ai-meta-item">
              <span className="ai-meta-label">المصدر:</span>
              <span className="ai-meta-val">{assessment.coverage?.sourceFileName || 'ملف PDF'}</span>
            </div>
            <div className="ai-meta-item">
              <span className="ai-meta-label">عدد الأسئلة:</span>
              <span className="ai-meta-val">{questions.length}</span>
            </div>
          </div>

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
              const qValidation = validateQuestionClient(q);
              return (
                <div
                  key={q.id || qIdx}
                  className="ai-question-card"
                  style={{
                    borderColor: !qValidation.valid ? '#ef4444' : undefined,
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
                    <p className="ai-question-validation text-red-400 text-xs flex items-center gap-1 mt-1" role="alert">
                      <AlertTriangle size={14} className="shrink-0" />
                      <span>{qValidation.reason || 'هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.'}</span>
                    </p>
                  )}

                  {/* Multiple choice options */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {(Array.isArray(q.options) ? q.options : []).map((rawOpt, optIdx) => {
                      const opt = typeof rawOpt === 'string' ? rawOpt : '';
                      const isCorrect = q.correctIndex === optIdx || (Boolean(q.correctAnswer) && q.correctAnswer === opt);
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
                            onChange={() => handleCorrectAnswerSelect(qIdx, optIdx)}
                            title={`تحديد الخيار ${letter} كإجابة صحيحة`}
                            aria-label={`تحديد الخيار ${letter} كإجابة صحيحة للسؤال ${qIdx + 1}`}
                          />
                          <input
                            type="text"
                            className="ai-option-input"
                            value={opt}
                            placeholder={`نص الخيار ${letter}...`}
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
                          {isCorrect && opt.trim().length > 0 && (
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
            disabled={submitting || !isAllValid}
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
