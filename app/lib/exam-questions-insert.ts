import type { Database } from './database';
import type { ParsedExamQuestion } from './exam-validation';

/** Rows per INSERT. 10 bound values per row keeps each statement far below PostgreSQL's 65,535-parameter limit. */
export const QUESTION_INSERT_CHUNK = 40;

/**
 * Builds multi-row INSERT statements for ANY number of questions (no cap), instead of
 * one statement per question. The caller runs them inside its existing transaction
 * (`db.batch`).
 */
export function buildQuestionInsertStatements(
  db: Pick<Database, 'prepare'>,
  examId: string,
  questions: ParsedExamQuestion[],
  chunkSize = QUESTION_INSERT_CHUNK,
  /** Optional pre-generated question ids (same order as `questions`). */
  ids?: string[]
) {
  const statements: ReturnType<ReturnType<Database['prepare']>['bind']>[] = [];
  for (let start = 0; start < questions.length; start += chunkSize) {
    const chunk = questions.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: Array<string | number | null> = [];
    for (const [offset, question] of chunk.entries()) {
      values.push(
        ids?.[start + offset] ?? crypto.randomUUID(),
        examId,
        question.sortOrder,
        question.type,
        question.prompt,
        JSON.stringify(question.options),
        question.correctAnswer,
        question.rubric,
        question.points,
        question.explanation || null
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO questions
           (id, exam_id, sort_order, type, prompt, options, correct_answer, rubric, points, explanation)
           VALUES ${placeholders}`
        )
        .bind(...values)
    );
  }
  return statements;
}
