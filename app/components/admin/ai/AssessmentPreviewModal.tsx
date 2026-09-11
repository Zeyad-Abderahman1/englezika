'use client';

import React, { useState } from 'react';
import { X, Check, Trash2, Plus, LoaderCircle, HelpCircle, BookOpen } from 'lucide-react';
import type { GeneratedAssessmentPreview, GeneratedQuestion } from '../../../lib/ai/content-generator';

interface AssessmentPreviewModalProps {
  assessment: GeneratedAssessmentPreview;
  targetCourseId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSaveToCourse: (finalQuestions: GeneratedQuestion[], title: string, examType: 'exam' | 'quiz') => Promise<void>;
}

export function AssessmentPreviewModal({
  assessment,
  targetCourseId,
  isOpen,
  onClose,
  onSaveToCourse,
}: AssessmentPreviewModalProps) {
  const [title, setTitle] = useState(assessment.title);
  const [examType, setExamType] = useState<'exam' | 'quiz'>(assessment.examType);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>(assessment.questions || []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePromptChange = (idx: number, val: string) => {
    const updated = [...questions];
    updated[idx].prompt = val;
    setQuestions(updated);
  };

  const handleOptionChange = (qIdx: number, optIdx: number, val: string) => {
    const updated = [...questions];
    const oldOption = updated[qIdx].options[optIdx];
    updated[qIdx].options[optIdx] = val;
    // If this option was the correct answer, update correctAnswer as well
    if (updated[qIdx].correctAnswer === oldOption) {
      updated[qIdx].correctAnswer = val;
    }
    setQuestions(updated);
  };

  const handleCorrectAnswerSelect = (qIdx: number, correctVal: string) => {
    const updated = [...questions];
    updated[qIdx].correctAnswer = correctVal;
    setQuestions(updated);
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
        options: ['الخيار 1', 'الخيار 2', 'الخيار 3', 'الخيار 4'],
        correctAnswer: 'الخيار 1',
      },
    ]);
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSaveToCourse(questions, title, examType);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ الأسئلة في الدورة.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ai-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="assessment-modal-title">
      <div className="ai-modal-card">
        {/* Header */}
        <div className="ai-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="ai-drawer-badge">
              <BookOpen size={18} />
            </div>
            <div>
              <h3 id="assessment-modal-title" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                مراجعة وتعديل الأسئلة المُنشأة بواسطة الذكاء الاصطناعي
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>
                عدد الأسئلة: {questions.length} | المصدر: تحليل النصوص التعليمية
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
            {questions.map((q, qIdx) => (
              <div key={q.id || qIdx} className="ai-question-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="font-bold text-sky-400 text-sm">السؤال رقم {qIdx + 1}</span>
                  <button
                    type="button"
                    className="btn btn-ghost text-red-400"
                    onClick={() => handleDeleteQuestion(qIdx)}
                    style={{ padding: '0.2rem 0.5rem' }}
                    title="حذف هذا السؤال"
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
                />

                {/* Multiple choice options */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {q.options.map((opt, optIdx) => {
                    const isCorrect = q.correctAnswer === opt;
                    return (
                      <div key={optIdx} className="ai-option-row">
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
                          onChange={(e) => handleOptionChange(qIdx, optIdx, e.target.value)}
                          style={{
                            borderColor: isCorrect ? '#22c55e' : undefined,
                            background: isCorrect ? 'rgba(34, 197, 94, 0.08)' : undefined,
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
            ))}
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
            disabled={submitting || questions.length === 0}
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
                <span>تأكيد وإدراج الأسئلة في الدورة</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
