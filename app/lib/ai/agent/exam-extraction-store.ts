import { mergeBatches, planBatches, type BatchResult, type BatchWindow, type OcrWarning } from '../../exam-ocr-merge';
import type { ExtractedQuestion } from '../../exam-ocr';
import type { Database } from '../../database';

/**
 * Server-side state of one "exam from photos" extraction in the AI assistant.
 *
 * Pages are staged upload ids (never image data). Each window of pages is extracted by one
 * short request; its questions (or its error) are stored here and merged on demand with the
 * SAME merge logic as the OCR modal (exam-ocr-merge).
 */

export type ExtractionDb = Pick<Database, 'prepare'>;

export const EXTRACTION_TTL_MS = 2 * 60 * 60 * 1000;

export interface ExtractionRecord {
  id: string;
  conversationId: string;
  pages: string[];
  windows: BatchWindow[];
}

export interface WindowRow {
  index: number;
  questions: ExtractedQuestion[] | null;
  error: string | null;
  retryable: boolean;
}

export async function createExtraction(
  db: ExtractionDb,
  input: { conversationId: string; email: string; pages: string[] }
): Promise<ExtractionRecord> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO ai_exam_extractions (id, conversation_id, staff_email, pages_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.conversationId, input.email.toLowerCase(), JSON.stringify(input.pages), now, now + EXTRACTION_TTL_MS)
    .run();
  return { id, conversationId: input.conversationId, pages: input.pages, windows: planBatches(input.pages.length) };
}

/** Loads an extraction ONLY for its owner (staff e-mail), and only while it has not expired. */
export async function getExtraction(db: ExtractionDb, id: string, email: string): Promise<ExtractionRecord | null> {
  const row = await db
    .prepare(
      'SELECT id, conversation_id AS "conversationId", pages_json AS "pagesJson", expires_at AS "expiresAt" FROM ai_exam_extractions WHERE id = ? AND staff_email = ?'
    )
    .bind(id, email.toLowerCase())
    .first<{ id: string; conversationId: string; pagesJson: string; expiresAt: number | string }>();
  if (!row || Number(row.expiresAt) < Date.now()) return null;
  let pages: string[] = [];
  try {
    const parsed = JSON.parse(row.pagesJson);
    pages = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    pages = [];
  }
  return { id: row.id, conversationId: row.conversationId, pages, windows: planBatches(pages.length) };
}

export async function saveWindow(
  db: ExtractionDb,
  extractionId: string,
  index: number,
  outcome: { questions: ExtractedQuestion[] } | { error: string; retryable: boolean }
): Promise<void> {
  const questions = 'questions' in outcome ? JSON.stringify(outcome.questions) : null;
  const error = 'error' in outcome ? outcome.error.slice(0, 300) : null;
  const retryable = 'error' in outcome ? outcome.retryable : true;
  await db
    .prepare(
      `INSERT INTO ai_exam_extraction_windows (extraction_id, window_index, questions_json, error_message, retryable, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (extraction_id, window_index) DO UPDATE
         SET questions_json = EXCLUDED.questions_json,
             error_message = EXCLUDED.error_message,
             retryable = EXCLUDED.retryable,
             updated_at = EXCLUDED.updated_at`
    )
    .bind(extractionId, index, questions, error, retryable, Date.now())
    .run();
}

export async function loadWindows(db: ExtractionDb, extractionId: string): Promise<WindowRow[]> {
  const result = await db
    .prepare(
      `SELECT window_index AS "index", questions_json AS "questionsJson", error_message AS "error", retryable
       FROM ai_exam_extraction_windows WHERE extraction_id = ? ORDER BY window_index ASC`
    )
    .bind(extractionId)
    .all<{ index: number | string; questionsJson: string | null; error: string | null; retryable: boolean }>();
  return result.results.map((row) => {
    let questions: ExtractedQuestion[] | null = null;
    if (row.questionsJson) {
      try {
        const parsed = JSON.parse(row.questionsJson);
        questions = Array.isArray(parsed) ? (parsed as ExtractedQuestion[]) : null;
      } catch {
        questions = null;
      }
    }
    return { index: Number(row.index), questions, error: row.error, retryable: row.retryable !== false };
  });
}

export interface ExtractionSummary {
  questions: ExtractedQuestion[];
  warnings: OcrWarning[];
  /** Windows that failed, with their page ranges. */
  failedWindows: Array<{ index: number; window: BatchWindow; error: string; retryable: boolean }>;
  /** Windows with no result yet. */
  pendingWindows: number[];
  /** Questions that cannot be saved yet (no correct answer / fewer than 2 options). */
  invalidCount: number;
  /** Questions dropped or merged because the page overlap showed them twice (or split across pages). */
  duplicatesRemoved: number;
}

export function isSavableQuestion(question: ExtractedQuestion): boolean {
  if (!question.prompt?.trim() || !question.correct_answer?.trim()) return false;
  if (question.type === 'multiple_choice') {
    return question.options.length >= 2 && question.options.includes(question.correct_answer);
  }
  return true;
}

/** Merges everything extracted so far with the shared merge logic. */
export function summarizeExtraction(record: ExtractionRecord, rows: WindowRow[]): ExtractionSummary {
  const byIndex = new Map(rows.map((row) => [row.index, row]));
  const results: BatchResult[] = [];
  const failedWindows: ExtractionSummary['failedWindows'] = [];
  const pendingWindows: number[] = [];

  record.windows.forEach((window, index) => {
    const row = byIndex.get(index);
    if (!row) {
      pendingWindows.push(index);
    } else if (row.questions) {
      results.push({ window, questions: row.questions });
    } else {
      failedWindows.push({ index, window, error: row.error ?? 'تعذر استخراج هذه الصفحات', retryable: row.retryable });
    }
  });

  const merged = mergeBatches(results);
  const rawCount = results.reduce((sum, result) => sum + result.questions.length, 0);
  return {
    questions: merged.questions,
    warnings: merged.warnings,
    failedWindows,
    pendingWindows,
    invalidCount: merged.questions.filter((question) => !isSavableQuestion(question)).length,
    duplicatesRemoved: Math.max(0, rawCount - merged.questions.length),
  };
}
