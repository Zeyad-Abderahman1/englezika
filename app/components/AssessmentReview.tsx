'use client';

import { CheckCircle2, XCircle, Image as ImageIcon } from 'lucide-react';

export type ReviewQuestion = {
  id: string;
  prompt: string;
  sortOrder: number;
  points: number;
  studentAnswer: string | number;
  correctAnswer: string;
  isCorrect: boolean;
  explanation?: string;
  hasImage?: boolean;
};

type Props = {
  title: string;
  score: number;
  maxScore: number;
  percentage: number;
  questions: ReviewQuestion[];
};

export default function AssessmentReview({
  title,
  score,
  maxScore,
  percentage,
  questions,
}: Props) {
  const correctCount = questions.filter((q) => q.isCorrect).length;
  const incorrectCount = questions.length - correctCount;

  return (
    <div className="assessment-review">
      <div className="assessment-review-header">
        <h2>{title}</h2>
        <div className="assessment-summary-card">
          <div className="assessment-score-ring">
            <strong>{percentage}%</strong>
            <span>
              {score} / {maxScore}
            </span>
          </div>
          <div className="assessment-summary-stats">
            <div>
              <span className="assessment-stat-label">النتيجة</span>
              <span className="assessment-stat-value">
                {score} من {maxScore}
              </span>
            </div>
            <div>
              <span className="assessment-stat-label">النسبة</span>
              <span className="assessment-stat-value">{percentage}%</span>
            </div>
            <div>
              <span className="assessment-stat-label">صحيح</span>
              <span className="assessment-stat-value assessment-stat-correct">
                {correctCount}
              </span>
            </div>
            <div>
              <span className="assessment-stat-label">خطأ</span>
              <span className="assessment-stat-value assessment-stat-incorrect">
                {incorrectCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="assessment-questions">
        {questions.map((question) => (
          <article
            key={question.id}
            className={`assessment-question ${question.isCorrect ? 'correct' : 'incorrect'}`}
          >
            <div className="assessment-question-header">
              <span className="assessment-question-number">{question.sortOrder}</span>
              <span
                className={`assessment-indicator ${question.isCorrect ? 'correct' : 'incorrect'}`}
              >
                {question.isCorrect ? (
                  <>
                    <CheckCircle2 size={16} /> صحيح
                  </>
                ) : (
                  <>
                    <XCircle size={16} /> خطأ
                  </>
                )}
              </span>
              <span className="assessment-points">
                {question.points} درجة
              </span>
            </div>

            <p className="assessment-question-prompt">{question.prompt}</p>

            {question.hasImage && (
              <div className="assessment-question-image">
                <ImageIcon size={16} />
                <img
                  src={`/api/student/questions/${question.id}/image`}
                  alt="صورة السؤال"
                  loading="lazy"
                />
              </div>
            )}

            <div className="assessment-answers">
              <div className="assessment-answer-row">
                <span className="assessment-answer-label">إجابتك:</span>
                <span
                  className={`assessment-answer-value ${question.isCorrect ? 'correct' : 'incorrect'}`}
                >
                  {String(question.studentAnswer) || '—'}
                </span>
              </div>
              {!question.isCorrect && (
                <div className="assessment-answer-row">
                  <span className="assessment-answer-label">الإجابة الصحيحة:</span>
                  <span className="assessment-answer-value correct">
                    {question.correctAnswer}
                  </span>
                </div>
              )}
            </div>

            {!question.isCorrect && question.explanation && (
              <div className="assessment-explanation">
                <strong>شرح الإجابة:</strong>
                <p>{question.explanation}</p>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
