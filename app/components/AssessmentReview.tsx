'use client';

import { useState, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

export type ReviewQuestion = {
  id: string;
  prompt: string;
  sortOrder: number;
  points: number;
  studentAnswer: string | number;
  correctAnswer: string;
  isCorrect: boolean;
  explanation?: string | null;
  hasImage?: boolean;
  options?: string[];
  type?: string;
};

type Props = {
  title?: string;
  score: number;
  maxScore: number;
  percentage: number;
  questions: ReviewQuestion[];
  onBack?: () => void;
};

export default function AssessmentReview({
  title = 'مراجعة إجابات الامتحان',
  score,
  maxScore,
  percentage,
  questions,
  onBack,
}: Props) {
  const [filter, setFilter] = useState<'all' | 'incorrect' | 'correct'>('all');

  const getQuestionStatus = (q: ReviewQuestion): 'correct' | 'incorrect' | 'unanswered' => {
    const ans = String(q.studentAnswer ?? '').trim();
    if (!ans) return 'unanswered';
    if (q.isCorrect) return 'correct';
    return 'incorrect';
  };

  const correctCount = useMemo(
    () => questions.filter((q) => getQuestionStatus(q) === 'correct').length,
    [questions]
  );
  const wrongCount = useMemo(
    () => questions.filter((q) => getQuestionStatus(q) === 'incorrect').length,
    [questions]
  );
  const unansweredCount = useMemo(
    () => questions.filter((q) => getQuestionStatus(q) === 'unanswered').length,
    [questions]
  );

  const filteredQuestions = useMemo(() => {
    if (filter === 'correct') {
      return questions.filter((q) => getQuestionStatus(q) === 'correct');
    }
    if (filter === 'incorrect') {
      return questions.filter((q) => getQuestionStatus(q) !== 'correct');
    }
    return questions;
  }, [questions, filter]);

  return (
    <div className="assessment-review" dir="rtl" style={{ maxWidth: '840px', margin: '0 auto', width: '100%' }}>
      {/* Back Button */}
      {onBack && (
        <div style={{ marginBottom: '1.25rem' }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={onBack}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.625rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <ArrowRight size={18} /> العودة إلى النتيجة
          </button>
        </div>
      )}

      {/* Header & Top Summary */}
      <header className="assessment-review-header" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--text, #18181b)' }}>
          {title}
        </h2>

        <div
          className="assessment-summary-card"
          style={{
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--line, #e2e8f0)',
            borderRadius: '14px',
            padding: '1.25rem 1.5rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '1rem',
            boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted, #64748b)' }}>النتيجة الكلية</span>
            <strong style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text, #18181b)' }}>
              {score} / {maxScore} <small style={{ fontSize: '0.85rem', fontWeight: 600 }}>({percentage}%)</small>
            </strong>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted, #64748b)' }}>إجابات صحيحة</span>
            <strong style={{ fontSize: '1.25rem', fontWeight: 800, color: '#16a34a' }}>
              {correctCount}
            </strong>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted, #64748b)' }}>إجابات خاطئة</span>
            <strong style={{ fontSize: '1.25rem', fontWeight: 800, color: '#dc2626' }}>
              {wrongCount}
            </strong>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted, #64748b)' }}>لم تتم الإجابة</span>
            <strong style={{ fontSize: '1.25rem', fontWeight: 800, color: '#d97706' }}>
              {unansweredCount}
            </strong>
          </div>
        </div>
      </header>

      {/* Filter Tabs */}
      <div
        className="review-filters"
        role="tablist"
        aria-label="تصفية الأسئلة"
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          onClick={() => setFilter('all')}
          className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`}
          style={{
            minHeight: '44px',
            borderRadius: '8px',
            padding: '0.5rem 1.125rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          الكل ({questions.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'incorrect'}
          onClick={() => setFilter('incorrect')}
          className={`btn ${filter === 'incorrect' ? 'btn-primary' : 'btn-outline'}`}
          style={{
            minHeight: '44px',
            borderRadius: '8px',
            padding: '0.5rem 1.125rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          الخاطئة فقط ({wrongCount + unansweredCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'correct'}
          onClick={() => setFilter('correct')}
          className={`btn ${filter === 'correct' ? 'btn-primary' : 'btn-outline'}`}
          style={{
            minHeight: '44px',
            borderRadius: '8px',
            padding: '0.5rem 1.125rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          الصحيحة فقط ({correctCount})
        </button>
      </div>

      {/* Questions List */}
      <div className="assessment-questions" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {filteredQuestions.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              background: 'var(--surface, #ffffff)',
              borderRadius: '12px',
              border: '1px solid var(--line, #e2e8f0)',
              color: 'var(--muted, #64748b)',
            }}
          >
            لا توجد أسئلة في هذا القسم.
          </div>
        ) : (
          filteredQuestions.map((question, idx) => {
            const status = getQuestionStatus(question);
            const questionOptions = question.options && question.options.length > 0 ? question.options : [];

            return (
              <article
                key={question.id || idx}
                className={`assessment-question-card status-${status}`}
                style={{
                  background: 'var(--surface, #ffffff)',
                  border: '1px solid var(--line, #e2e8f0)',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                  overflow: 'hidden',
                }}
              >
                {/* Question Header: Number, Points, Status Badge */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    paddingBottom: '0.75rem',
                    borderBottom: '1px solid var(--line, #f1f5f9)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        color: 'var(--text, #18181b)',
                      }}
                    >
                      السؤال {question.sortOrder || idx + 1}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted, #64748b)' }}>
                      ({question.points} {question.points === 1 ? 'درجة' : 'درجات'})
                    </span>
                  </div>

                  <div>
                    {status === 'correct' && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.625rem',
                          borderRadius: '6px',
                          fontSize: '0.825rem',
                          fontWeight: 700,
                          background: 'rgba(34, 197, 94, 0.12)',
                          color: '#16a34a',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                        }}
                      >
                        <CheckCircle2 size={15} /> إجابة صحيحة
                      </span>
                    )}
                    {status === 'incorrect' && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.625rem',
                          borderRadius: '6px',
                          fontSize: '0.825rem',
                          fontWeight: 700,
                          background: 'rgba(239, 68, 68, 0.12)',
                          color: '#dc2626',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                        }}
                      >
                        <XCircle size={15} /> إجابة خاطئة
                      </span>
                    )}
                    {status === 'unanswered' && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.25rem 0.625rem',
                          borderRadius: '6px',
                          fontSize: '0.825rem',
                          fontWeight: 700,
                          background: 'rgba(245, 158, 11, 0.12)',
                          color: '#d97706',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                        }}
                      >
                        <AlertCircle size={15} /> لم تتم الإجابة
                      </span>
                    )}
                  </div>
                </div>

                {/* Prompt */}
                <p
                  dir="auto"
                  style={{
                    fontSize: '1.05rem',
                    lineHeight: 1.65,
                    margin: '0.875rem 0',
                    color: 'var(--text, #18181b)',
                    wordBreak: 'break-word',
                    fontWeight: 500,
                  }}
                >
                  {question.prompt}
                </p>

                {/* Question Image */}
                {question.hasImage && (
                  <div style={{ margin: '0.75rem 0' }}>
                    <img
                      src={`/api/student/questions/${question.id}/image`}
                      alt="صورة السؤال"
                      loading="lazy"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '360px',
                        borderRadius: '8px',
                        objectFit: 'contain',
                        border: '1px solid var(--line, #e2e8f0)',
                      }}
                    />
                  </div>
                )}

                {/* All Options with Markers */}
                {questionOptions.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                    {questionOptions.map((opt, optIdx) => {
                      const isStudentChoice = String(question.studentAnswer ?? '').trim() === opt.trim();
                      const isCorrectOption = question.correctAnswer?.trim() === opt.trim();

                      let borderColor = 'var(--line, #e2e8f0)';
                      let bgColor = 'var(--surface-2, rgba(0,0,0,0.02))';
                      let textColor = 'var(--text, #18181b)';

                      if (isStudentChoice && isCorrectOption) {
                        borderColor = '#16a34a';
                        bgColor = 'rgba(34, 197, 94, 0.08)';
                      } else if (isStudentChoice && !isCorrectOption) {
                        borderColor = '#dc2626';
                        bgColor = 'rgba(239, 68, 68, 0.08)';
                      } else if (isCorrectOption) {
                        borderColor = '#16a34a';
                        bgColor = 'rgba(34, 197, 94, 0.08)';
                      }

                      return (
                        <div
                          key={optIdx}
                          style={{
                            minHeight: '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            padding: '0.625rem 0.875rem',
                            borderRadius: '8px',
                            border: `1.5px solid ${borderColor}`,
                            background: bgColor,
                            color: textColor,
                            fontSize: '0.925rem',
                            lineHeight: 1.5,
                            wordBreak: 'break-word',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flex: 1 }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                flexShrink: 0,
                              }}
                            >
                              {isCorrectOption ? (
                                <CheckCircle2 size={18} color="#16a34a" />
                              ) : isStudentChoice ? (
                                <XCircle size={18} color="#dc2626" />
                              ) : (
                                <span
                                  style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: 'var(--muted, #94a3b8)',
                                  }}
                                />
                              )}
                            </span>
                            <span
                              dir="auto"
                              style={{
                                flex: 1,
                                fontWeight: isStudentChoice || isCorrectOption ? 600 : 400,
                              }}
                            >
                              {opt}
                            </span>
                          </div>

                          {/* Markers on Options */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                            {isStudentChoice && isCorrectOption && (
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  padding: '0.2rem 0.5rem',
                                  borderRadius: '4px',
                                  background: '#16a34a',
                                  color: '#ffffff',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                إجابتك (صحيحة) ✓
                              </span>
                            )}
                            {isStudentChoice && !isCorrectOption && (
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  padding: '0.2rem 0.5rem',
                                  borderRadius: '4px',
                                  background: '#dc2626',
                                  color: '#ffffff',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                إجابتك ✗
                              </span>
                            )}
                            {!isStudentChoice && isCorrectOption && (
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  padding: '0.2rem 0.5rem',
                                  borderRadius: '4px',
                                  background: 'rgba(34, 197, 94, 0.15)',
                                  color: '#16a34a',
                                  border: '1px solid #16a34a',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                الإجابة الصحيحة ✓
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div
                      style={{
                        padding: '0.625rem 0.875rem',
                        borderRadius: '8px',
                        border: '1px solid var(--line, #e2e8f0)',
                        background: 'var(--surface-2, rgba(0,0,0,0.02))',
                      }}
                    >
                      <strong style={{ display: 'block', fontSize: '0.85rem', color: 'var(--muted, #64748b)' }}>
                        إجابتك:
                      </strong>
                      <p dir="auto" style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
                        {String(question.studentAnswer).trim() || 'لم تتم الإجابة'}
                      </p>
                    </div>
                    {question.correctAnswer && (
                      <div
                        style={{
                          padding: '0.625rem 0.875rem',
                          borderRadius: '8px',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          background: 'rgba(34, 197, 94, 0.08)',
                        }}
                      >
                        <strong style={{ display: 'block', fontSize: '0.85rem', color: '#16a34a' }}>
                          الإجابة الصحيحة:
                        </strong>
                        <p dir="auto" style={{ margin: '0.25rem 0 0', fontWeight: 600, color: '#16a34a' }}>
                          {question.correctAnswer}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* 'الشرح' Section with Arabic explanation (hidden if empty) */}
                {question.explanation && question.explanation.trim() ? (
                  <div
                    className="assessment-explanation-card"
                    style={{
                      marginTop: '1rem',
                      padding: '0.875rem 1rem',
                      borderRadius: '8px',
                      background: 'var(--surface-2, rgba(0,0,0,0.02))',
                      border: '1px solid var(--line, #e2e8f0)',
                      borderRight: '4px solid var(--brand, #d7193f)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                        marginBottom: '0.375rem',
                        color: 'var(--brand, #d7193f)',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                      }}
                    >
                      <Sparkles size={16} />
                      <span>الشرح:</span>
                    </div>
                    <p
                      dir="auto"
                      style={{
                        margin: 0,
                        fontSize: '0.925rem',
                        lineHeight: 1.65,
                        color: 'var(--text, #18181b)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {question.explanation}
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
