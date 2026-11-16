/**
 * Pure helpers (no server imports, safe for the browser) that make OCR exam
 * extraction scale to ANY number of questions:
 *
 * - `planBatches`: splits N pages into small overlapping windows so each model
 *   response stays far below the output limit and boundary questions are fully
 *   visible in at least one window.
 * - `mergeBatches`: merges window results in page order, removes the duplicates
 *   created by the overlap, stitches questions cut by a page break, renumbers
 *   sequentially and produces warnings (missing printed numbers, incomplete
 *   questions, empty/low-yield pages).
 *
 * There is intentionally NO question-count limit anywhere in this module.
 */

import type { ExtractedQuestion } from './exam-ocr';

/** Pages per model call. Small enough that one response never nears the output limit. */
export const OCR_BATCH_SIZE = 3;
/** Pages shared by consecutive windows so a question split across pages is seen whole. */
export const OCR_BATCH_OVERLAP = 1;

export interface BatchWindow {
  /** First page index (inclusive). */
  start: number;
  /** Last page index (exclusive). */
  end: number;
}

export interface BatchResult {
  window: BatchWindow;
  questions: ExtractedQuestion[];
}

export type OcrWarningCode =
  | 'MISSING_NUMBERS'
  | 'INCOMPLETE_QUESTION'
  | 'EMPTY_PAGES'
  | 'LOW_YIELD_PAGES';

export interface OcrWarning {
  code: OcrWarningCode;
  message: string;
  numbers?: number[];
  pages?: string;
}

export function planBatches(
  pageCount: number,
  options: { batchSize?: number; overlap?: number } = {}
): BatchWindow[] {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? OCR_BATCH_SIZE));
  const overlap = Math.min(Math.max(0, Math.floor(options.overlap ?? OCR_BATCH_OVERLAP)), batchSize - 1);
  if (!Number.isFinite(pageCount) || pageCount <= 0) return [];

  const stride = Math.max(1, batchSize - overlap);
  const windows: BatchWindow[] = [];
  for (let start = 0; ; start += stride) {
    const end = Math.min(start + batchSize, pageCount);
    windows.push({ start, end });
    if (end >= pageCount) break;
  }
  return windows;
}

// ── Question comparison ───────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function optionsSimilarity(a: string[], b: string[]): number {
  return jaccard(new Set(a.map(normalizeText)), new Set(b.map(normalizeText)));
}

/**
 * True when two extracted questions are the same question seen twice (overlap
 * between windows) or one is a cut-off fragment of the other. Questions with
 * different printed numbers are never the same.
 */
export function sameQuestion(a: ExtractedQuestion, b: ExtractedQuestion): boolean {
  const numberA = a.source_number ?? null;
  const numberB = b.source_number ?? null;
  if (numberA !== null && numberB !== null && numberA !== numberB) return false;

  const pa = normalizeText(a.prompt);
  const pb = normalizeText(b.prompt);
  if (!pa && !pb) return false;

  const bothHaveOptions = a.options.length >= 2 && b.options.length >= 2;
  const optionsAgree = bothHaveOptions ? optionsSimilarity(a.options, b.options) : null;

  if (pa === pb) {
    return optionsAgree === null || optionsAgree >= 0.5;
  }

  // One prompt is a cut-off prefix/suffix of the other.
  const shorter = pa.length <= pb.length ? pa : pb;
  const longer = pa.length <= pb.length ? pb : pa;
  if (shorter.length >= 12 && (longer.startsWith(shorter) || longer.endsWith(shorter))) {
    return optionsAgree === null || optionsAgree >= 0.5;
  }

  const similarPrompt = jaccard(tokenSet(a.prompt), tokenSet(b.prompt));
  if (numberA !== null && numberA === numberB && similarPrompt >= 0.6) return true;
  return similarPrompt >= 0.9 && (optionsAgree === null || optionsAgree >= 0.75);
}

function completeness(question: ExtractedQuestion): number {
  let score = 0;
  if (question.options.length >= 2) score += 3;
  if (question.correct_answer) score += 2;
  if (!question.cut_off || question.cut_off === 'none') score += 2;
  score += Math.min(question.prompt.length, 1000) / 1000;
  score += Math.min(question.options.length, 6) / 10;
  return score;
}

function better(existing: ExtractedQuestion, candidate: ExtractedQuestion): ExtractedQuestion {
  if (completeness(candidate) > completeness(existing)) {
    return { ...candidate, temp_id: existing.temp_id };
  }
  return existing;
}

// ── Stitching questions split across a page break ─────────────────────────────

function stitch(first: ExtractedQuestion, second: ExtractedQuestion): ExtractedQuestion {
  const prompt = [first.prompt, second.prompt].filter(Boolean).join(' ').trim();
  const options: string[] = [];
  for (const option of [...first.options, ...second.options]) {
    if (!options.some((existing) => normalizeText(existing) === normalizeText(option))) options.push(option);
  }
  const correct = [first.correct_answer, second.correct_answer].find((answer) =>
    answer ? options.some((option) => option === answer) : false
  );
  return {
    ...first,
    prompt,
    options,
    correct_answer: correct || '',
    source_number: first.source_number ?? second.source_number ?? null,
    cut_off: 'none',
    ai_confidence: 'low',
    needs_review: true,
    ai_explanation: 'سؤال كان مقسومًا بين صفحتين وتم دمجه تلقائيًا — يرجى مراجعته',
  };
}

// ── Merge ─────────────────────────────────────────────────────────────────────

const OVERLAP_ZONE = 12;

export function mergeBatches(results: BatchResult[]): { questions: ExtractedQuestion[]; warnings: OcrWarning[] } {
  const ordered = [...results].sort((a, b) => a.window.start - b.window.start);
  const merged: ExtractedQuestion[] = [];
  let previousEnd = -1;

  for (const result of ordered) {
    const incoming = result.questions.map((question) => ({ ...question }));
    const overlaps = previousEnd > result.window.start && merged.length > 0;

    if (!overlaps) {
      merged.push(...incoming);
    } else {
      const tailStart = Math.max(0, merged.length - OVERLAP_ZONE);
      let cursor = tailStart;
      for (const question of incoming) {
        let matchAt = -1;
        for (let i = cursor; i < merged.length; i++) {
          if (sameQuestion(merged[i], question)) {
            matchAt = i;
            break;
          }
        }
        if (matchAt >= 0) {
          merged[matchAt] = better(merged[matchAt], question);
          cursor = matchAt + 1;
        } else if (cursor < merged.length) {
          merged.splice(cursor, 0, question);
          cursor += 1;
        } else {
          merged.push(question);
          cursor = merged.length;
        }
      }
    }
    previousEnd = Math.max(previousEnd, result.window.end);
  }

  // Stitch fragments that straddle a page break (end-cut followed by start-cut).
  const stitched: ExtractedQuestion[] = [];
  for (const question of merged) {
    const last = stitched[stitched.length - 1];
    if (last && last.cut_off === 'end' && question.cut_off === 'start') {
      stitched[stitched.length - 1] = stitch(last, question);
    } else {
      stitched.push(question);
    }
  }

  const questions = stitched.map((question, index) => ({ ...question, sort_order: index + 1 }));
  return { questions, warnings: buildWarnings(ordered, questions) };
}

// ── Warnings ──────────────────────────────────────────────────────────────────

function pageLabel(window: BatchWindow): string {
  return window.end - window.start <= 1 ? `${window.start + 1}` : `${window.start + 1}–${window.end}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildWarnings(results: BatchResult[], questions: ExtractedQuestion[]): OcrWarning[] {
  const warnings: OcrWarning[] = [];

  // 1. Gaps in the PRINTED numbering. Numbering may restart per section, so the
  //    sequence is split into runs that each start when the number stops growing.
  const missing: number[] = [];
  let previous: number | null = null;
  for (const question of questions) {
    const printed = question.source_number;
    if (typeof printed !== 'number' || !Number.isInteger(printed) || printed <= 0) continue;
    if (previous !== null && printed > previous + 1) {
      for (let n = previous + 1; n < printed; n++) missing.push(n);
    }
    previous = printed;
  }
  if (missing.length > 0) {
    const shown = missing.slice(0, 30);
    warnings.push({
      code: 'MISSING_NUMBERS',
      numbers: missing,
      message: `قد تكون هناك أسئلة لم تُستخرج: أرقام الأسئلة المفقودة المحتملة ${shown.join('، ')}${missing.length > shown.length ? ' …' : ''}. راجع الصور أو أضف السؤال يدويًا.`,
    });
  }

  // 2. Questions that are still incomplete after merging.
  const incomplete = questions
    .filter(
      (question) =>
        (question.cut_off && question.cut_off !== 'none') ||
        (question.type === 'multiple_choice' && question.options.length < 2)
    )
    .map((question) => question.sort_order);
  if (incomplete.length > 0) {
    warnings.push({
      code: 'INCOMPLETE_QUESTION',
      numbers: incomplete,
      message: `أسئلة غير مكتملة (مقطوعة بين صفحتين أو بدون خيارات كافية): ${incomplete.slice(0, 30).join('، ')}. يرجى مراجعتها.`,
    });
  }

  // 3. Pages that produced nothing, or far less than the other pages.
  const perPage = results
    .filter((result) => result.window.end > result.window.start)
    .map((result) => result.questions.length / (result.window.end - result.window.start));
  const typical = median(perPage);

  const empty = results.filter((result) => result.questions.length === 0);
  if (empty.length > 0) {
    warnings.push({
      code: 'EMPTY_PAGES',
      pages: empty.map((result) => pageLabel(result.window)).join('، '),
      message: `لم يُستخرج أي سؤال من الصفحات: ${empty.map((result) => pageLabel(result.window)).join('، ')}. تأكد من وضوح الصور.`,
    });
  } else if (typical >= 3) {
    const low = results.filter(
      (result) => result.questions.length / Math.max(1, result.window.end - result.window.start) < typical * 0.3
    );
    if (low.length > 0) {
      warnings.push({
        code: 'LOW_YIELD_PAGES',
        pages: low.map((result) => pageLabel(result.window)).join('، '),
        message: `عدد الأسئلة المستخرجة من الصفحات ${low.map((result) => pageLabel(result.window)).join('، ')} أقل بكثير من باقي الصفحات، فقد تكون ناقصة.`,
      });
    }
  }

  return warnings;
}
