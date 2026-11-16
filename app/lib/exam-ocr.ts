import { getPlatformEnv } from './platform';
import { safeText } from './security';
import { checkExplanationConsistency } from './explanation-consistency';
import { mergeBatches, sameQuestion, planBatches, type BatchResult, type BatchWindow, type OcrWarning } from './exam-ocr-merge';
export { checkExplanationConsistency };

export type ExtractedQuestion = {
  temp_id: string;
  sort_order: number;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  prompt: string;
  options: string[];
  correct_answer: string;
  points: number;
  ai_confidence: 'high' | 'medium' | 'low';
  ai_explanation: string;
  explanation: string;
  needs_review?: boolean;
  /** Question number printed on the paper (used to detect missing questions). */
  source_number?: number | null;
  /** Set when the question is cut by a page break: its start or end is on another page. */
  cut_off?: 'none' | 'start' | 'end';
};

export type OcrExamResult = {
  ok: boolean;
  questions: ExtractedQuestion[];
  error?: string;
  code?: string;
  retryable?: boolean;
  warnings?: OcrWarning[];
};

export type ImageInput = {
  data: string; // base64 or raw buffer base64 string
  mimeType: string;
};

const VISION_SYSTEM_PROMPT = `You are a precision OCR engine and expert Egyptian Secondary School English examiner.
Read ALL questions from the provided image(s). Never stop early, never limit the count, and never skip or merge questions: output every single question visible, however many there are.
Rule 1: Transcribe every question prompt and every multiple-choice option 100% VERBATIM without changing a single character or word. Do NOT paraphrase, summarize, fix grammar, translate, or alter wording or fill-in-the-blank formatting (e.g. "......").
Rule 2: Strip leading question numbers (e.g., '1.', '2-', 'Q1:') and option letters ('a)', 'b)', 'A.', 'B.') from the text strings while keeping options in their exact original order.
Rule 3: Ignore page headers, footers, watermarks, teacher phone numbers, decorative borders.
Rule 4: Solve each question with 100% grammatical accuracy and select the single correct option as 'correct_answer' (must match one of the extracted 'options' strings character-for-character).
Rule 5: For each question, provide a student-facing 'explanation' written in clear, simple Modern Standard Arabic suitable for Egyptian secondary school students (no markdown, max about 400 characters). Structure: one sentence stating the correct answer and the rule or reason, then one short sentence on why the most tempting wrong option is wrong when relevant. Grammar terms and English words/examples stay in English inside the Arabic sentence.
Rule 6: Keep 'ai_explanation' as a separate short teacher note on model confidence.
Rule 7: Return strictly valid JSON matching the schema below without any markdown fences or preamble.
Rule 8: Set 'source_number' to the question number PRINTED on the paper (an integer), or null if none is printed. Numbering may restart in each section; report it exactly as printed.
Rule 9: If a question is cut by a page break, still output the part you can see and set 'cut_off' to "end" (its remainder is on the next page) or "start" (it began on the previous page). Otherwise use "none". Never invent the missing part.

Schema:
{
  "questions": [
    {
      "temp_id": "uuid-string",
      "sort_order": 1,
      "type": "multiple_choice",
      "prompt": "Exact verbatim question stem",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "source_number": 1,
      "cut_off": "none",
      "correct_answer": "Exact string matching winning option",
      "points": 1,
      "ai_confidence": "high",
      "ai_explanation": "Brief reasoning in Arabic or English for teacher",
      "explanation": "الإجابة الصحيحة هي Option A لأنها تعبر عن زمن Past Simple لوجود قرينة تدل على الماضي. أما Option B فغير صحيحة لأنها في زمن المضارع."
    }
  ]
}`;



/**
 * Strips markdown code fences (e.g. ```json ... ```) from model output.
 */
function cleanJsonOutput(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (match) {
    return match[1].trim();
  }
  const embeddedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (embeddedMatch) {
    return embeddedMatch[1].trim();
  }
  return trimmed;
}

/**
 * Normalizes and validates extracted questions from Vision output
 */
export function normalizeExtractedQuestions(rawQuestions: unknown[]): ExtractedQuestion[] {
  if (!Array.isArray(rawQuestions)) return [];

  return rawQuestions.map((item, index) => {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const tempId = typeof raw.temp_id === 'string' && raw.temp_id.length > 5
      ? raw.temp_id
      : crypto.randomUUID();

    const rawType = String(raw.type || 'multiple_choice').toLowerCase();
    const type: 'multiple_choice' | 'true_false' | 'short_answer' =
      rawType === 'true_false' || rawType === 'short_answer' ? rawType : 'multiple_choice';

    const prompt = safeText(raw.prompt, 2000);

    let options: string[] = [];
    if (Array.isArray(raw.options)) {
      options = raw.options
        .map((opt) => safeText(opt, 500))
        .filter((opt) => opt.length > 0);
    } else if (type === 'true_false') {
      options = ['True', 'False'];
    }

    let correctAnswer = safeText(raw.correct_answer, 500);
    let confidence: 'high' | 'medium' | 'low' = 'high';

    if (raw.ai_confidence === 'medium' || raw.ai_confidence === 'low') {
      confidence = raw.ai_confidence;
    }

    if (type === 'multiple_choice' && options.length > 0) {
      const matchIndex = options.findIndex(
        (opt) => opt.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
      );
      if (matchIndex >= 0) {
        correctAnswer = options[matchIndex];
      } else {
        // Leave unselected when unmatched; require teacher to explicitly choose
        correctAnswer = '';
        confidence = 'low';
      }
    }

    const points = typeof raw.points === 'number' && raw.points > 0 ? Math.min(raw.points, 100) : 1;
    const rawAiExplanation = safeText(raw.ai_explanation || '', 500);
    const aiExplanation =
      rawAiExplanation ||
      (type === 'multiple_choice' && !correctAnswer
        ? 'لم يتم تحديد إجابة صحيحة مطابقة تلقائياً، يرجى اختيار الإجابة الصحيحة يدوياً'
        : 'تم استخراج السؤال بالذكاء الاصطناعي');

    const rawStudentExp = safeText(raw.explanation || '', 1500);
    const consistency = checkExplanationConsistency(rawStudentExp, correctAnswer, options);
    const studentExplanation = consistency.explanation !== null ? consistency.explanation : '';
    if (consistency.needs_review) {
      confidence = 'low';
    }

    const printedNumber = Number(raw.source_number);
    const sourceNumber = Number.isInteger(printedNumber) && printedNumber > 0 ? printedNumber : null;
    const cutOff: 'none' | 'start' | 'end' = raw.cut_off === 'start' || raw.cut_off === 'end' ? raw.cut_off : 'none';

    return {
      temp_id: tempId,
      sort_order: index + 1,
      source_number: sourceNumber,
      cut_off: cutOff,
      type,
      prompt,
      options,
      correct_answer: correctAnswer,
      points,
      ai_confidence: confidence,
      ai_explanation: aiExplanation,
      explanation: studentExplanation,
      needs_review: consistency.needs_review || (!correctAnswer),
    };
  });
}

// ── Extraction ────────────────────────────────────────────────────────────────

/** Output budget per call. Falls back to a smaller budget if the model rejects it. */
const OCR_MAX_OUTPUT_TOKENS = 65536;
const OCR_FALLBACK_OUTPUT_TOKENS = 16384;
/** Hard ceiling for ONE HTTP request (the reverse proxy times out at 60s). */
const OCR_REQUEST_BUDGET_MS = 52_000;
const OCR_MAX_ATTEMPTS = 3;
const OCR_MAX_CONTINUATIONS = 3;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type OcrRuntime = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Epoch ms after which no new attempt should start. */
  deadlineAt?: number;
  maxAttempts?: number;
};

export class OcrError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
    this.retryable = retryable;
  }
}

export type OcrUnitResult = {
  questions: ExtractedQuestion[];
  /** True when the first answer was truncated/invalid and had to be recovered. */
  recovered: boolean;
};

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function resolveModel(): string {
  const env = getPlatformEnv();
  const raw =
    process.env.GEMINI_MODEL?.trim() ||
    (env as Record<string, string | undefined>).GEMINI_MODEL?.trim() ||
    'gemini-3.8-flash';
  return raw.replace(/^models\//, '').trim() || 'gemini-3.8-flash';
}

function resolveApiKey(injected?: string): string | undefined {
  const env = getPlatformEnv();
  return (
    injected?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    (env as Record<string, string | undefined>).GEMINI_API_KEY?.trim() ||
    undefined
  );
}

type ModelAnswer = { text: string; finishReason?: string };

/**
 * One Gemini call with retry + exponential backoff on transient failures
 * (429/5xx/network/timeout). Honors the request deadline so a retry never pushes
 * the HTTP request past the proxy timeout.
 */
async function callModel(
  parts: Array<Record<string, unknown>>,
  apiKey: string,
  model: string,
  runtime: OcrRuntime
): Promise<ModelAnswer> {
  const doFetch = runtime.fetchImpl ?? fetch;
  const sleep = runtime.sleep ?? defaultSleep;
  const attempts = runtime.maxAttempts ?? OCR_MAX_ATTEMPTS;
  let maxOutputTokens = OCR_MAX_OUTPUT_TOKENS;
  let lastError: OcrError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remaining = runtime.deadlineAt ? runtime.deadlineAt - Date.now() : OCR_REQUEST_BUDGET_MS;
    if (remaining < 4_000) {
      throw lastError ?? new OcrError('انتهى الوقت المتاح لمعالجة هذه الصفحات. أعد المحاولة.', 'AI_TIMEOUT', true);
    }

    try {
      const response = await doFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens },
          }),
          signal: AbortSignal.timeout(Math.min(OCR_REQUEST_BUDGET_MS, remaining)),
        }
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[Gemini OCR API Error]', { status: response.status, message: errText.slice(0, 300) });

        if (response.status === 404) {
          throw new OcrError('نموذج الذكاء الاصطناعي غير متاح حالياً، يرجى التواصل مع المطور.', 'AI_MODEL_UNAVAILABLE', false);
        }
        if (response.status === 400 && maxOutputTokens !== OCR_FALLBACK_OUTPUT_TOKENS && /output.?token/i.test(errText)) {
          maxOutputTokens = OCR_FALLBACK_OUTPUT_TOKENS;
          attempt -= 1; // retry immediately with a smaller budget, without spending an attempt
          continue;
        }
        const transient = TRANSIENT_STATUSES.has(response.status);
        lastError = new OcrError(
          'تعذر استخراج الأسئلة من الصور عبر خدمة الذكاء الاصطناعي. يرجى المحاولة لاحقاً.',
          'AI_OCR_FAILED',
          transient
        );
        if (!transient) throw lastError;
      } else {
        const data = (await response.json()) as {
          candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
        };
        const candidate = data?.candidates?.[0];
        const text = (candidate?.content?.parts || []).map((part) => part?.text || '').join('');
        if (candidate?.finishReason === 'MAX_TOKENS') {
          console.error('[Gemini OCR] output truncated (MAX_TOKENS)');
        }
        if (!text) {
          lastError = new OcrError('لم يُرجع الذكاء الاصطناعي أي استجابة صالحة لتحليل صور الامتحان.', 'AI_EMPTY_RESPONSE', true);
        } else {
          return { text, finishReason: candidate?.finishReason };
        }
      }
    } catch (error) {
      if (error instanceof OcrError) {
        if (!error.retryable) throw error;
        lastError = error;
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Gemini OCR Exception]', { message: message.slice(0, 300) });
        lastError = new OcrError(
          'تعذر الاتصال بخدمة الذكاء الاصطناعي. يرجى التحقق من اتصال الخادم والمحاولة لاحقاً.',
          'AI_CONNECTION_ERROR',
          true
        );
      }
    }

    if (attempt < attempts) {
      await sleep(700 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new OcrError('تعذر استخراج الأسئلة من الصور.', 'AI_OCR_FAILED', true);
}

/**
 * Extracts every COMPLETE top-level question object from a (possibly truncated)
 * JSON answer, so a response cut off at the token limit keeps everything before
 * the cut instead of being thrown away.
 */
export function salvageQuestionObjects(text: string): unknown[] {
  const cleaned = cleanJsonOutput(text);
  const keyIndex = cleaned.indexOf('"questions"');
  const arrayStart = cleaned.indexOf('[', keyIndex >= 0 ? keyIndex : 0);
  if (arrayStart < 0) return [];

  const objects: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let i = arrayStart + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try {
          objects.push(JSON.parse(cleaned.slice(objectStart, i + 1)));
        } catch {
          // skip a malformed object, keep going
        }
        objectStart = -1;
      } else if (depth < 0) {
        depth = 0;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return objects;
}

type ParsedAnswer = { items: unknown[]; complete: boolean };

function parseAnswer(answer: ModelAnswer): ParsedAnswer {
  const truncated = answer.finishReason === 'MAX_TOKENS';
  try {
    const parsed = JSON.parse(cleanJsonOutput(answer.text)) as { questions?: unknown[] };
    const items = Array.isArray(parsed?.questions) ? parsed.questions : [];
    return { items, complete: !truncated };
  } catch {
    return { items: salvageQuestionObjects(answer.text), complete: false };
  }
}

function imageParts(images: ImageInput[]): Array<Record<string, unknown>> {
  return images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } }));
}

/**
 * Extracts ALL questions from a small set of pages (one "unit"). If the answer is
 * truncated or invalid it is recovered rather than dropped: complete questions are
 * salvaged and the model is asked to continue after the last one; if nothing could
 * be salvaged from several pages, the pages are processed one by one.
 */
export async function extractExamUnit(
  images: ImageInput[],
  injectedApiKey?: string,
  runtime: OcrRuntime = {}
): Promise<OcrUnitResult> {
  if (!images.length) {
    throw new OcrError('لم يتم توفير أي صور للاستخراج', 'NO_IMAGES', false);
  }
  const apiKey = resolveApiKey(injectedApiKey);
  if (!apiKey) {
    throw new OcrError(
      'مفتاح الذكاء الاصطناعي (GEMINI_API_KEY) غير مضبوط في إعدادات الخادم. يرجى تهيئة المفتاح للبدء في استخراج الأسئلة.',
      'GEMINI_KEY_MISSING',
      false
    );
  }
  const model = resolveModel();
  const rt: OcrRuntime = { ...runtime, deadlineAt: runtime.deadlineAt ?? Date.now() + OCR_REQUEST_BUDGET_MS };

  const baseParts: Array<Record<string, unknown>> = [
    { text: VISION_SYSTEM_PROMPT },
    { text: 'Analyze these uploaded exam question images and extract all questions strictly following the rules:' },
    ...imageParts(images),
  ];

  const first = await callModel(baseParts, apiKey, model, rt);
  const firstParsed = parseAnswer(first);
  if (firstParsed.complete) {
    return { questions: normalizeExtractedQuestions(firstParsed.items), recovered: false };
  }

  // Truncated or malformed answer → recover.
  if (firstParsed.items.length === 0) {
    if (images.length > 1) {
      const collected: BatchResult[] = [];
      for (let index = 0; index < images.length; index++) {
        const single = await extractExamUnit([images[index]], apiKey, rt);
        collected.push({ window: { start: index, end: index + 1 }, questions: single.questions });
      }
      return { questions: mergeBatches(collected).questions, recovered: true };
    }
    throw new OcrError(
      'لم نتمكن من تحليل إجابة نموذج الذكاء الاصطناعي بشكل صحيح. يرجى المحاولة مرة أخرى.',
      'AI_PARSE_ERROR',
      true
    );
  }

  let all = normalizeExtractedQuestions(firstParsed.items);
  for (let round = 0; round < OCR_MAX_CONTINUATIONS; round++) {
    const lastPrompts = all
      .slice(-3)
      .map((question, index) => `${all.length - Math.min(3, all.length) + index + 1}. ${question.prompt.slice(0, 160)}`)
      .join('\n');
    const continuation = await callModel(
      [
        ...baseParts,
        {
          text: `Your previous answer was cut off after ${all.length} complete questions. The last extracted questions were:\n${lastPrompts}\nContinue extracting from the NEXT question after the last one listed. Return ONLY the remaining questions in the same JSON schema. If none remain, return {"questions": []}.`,
        },
      ],
      apiKey,
      model,
      rt
    );
    const parsed = parseAnswer(continuation);
    const more = normalizeExtractedQuestions(parsed.items);
    const fresh = more.filter((question) => !all.slice(-4).some((existing) => sameQuestion(existing, question)));
    if (fresh.length === 0) break;
    all = [...all, ...fresh];
    if (parsed.complete) break;
  }

  return { questions: all.map((question, index) => ({ ...question, sort_order: index + 1 })), recovered: true };
}

// ── Whole-document pipeline (server side) ─────────────────────────────────────

export type OcrPipelineOptions = {
  batchSize?: number;
  overlap?: number;
  concurrency?: number;
  /** Attempts per window before it is reported as failed. */
  windowAttempts?: number;
  onProgress?: (progress: { windowsDone: number; windowsTotal: number; questionsSoFar: number }) => void;
  runtime?: OcrRuntime;
};

export type OcrPipelineResult = {
  ok: boolean;
  questions: ExtractedQuestion[];
  warnings: OcrWarning[];
  failedBatches: Array<{ window: BatchWindow; error: string; code: string; retryable: boolean }>;
};

/**
 * Extracts questions from ANY number of pages: small overlapping windows, limited
 * concurrency, per-window retries (smaller windows on the retry), merge in page
 * order. Failed windows are reported individually instead of failing everything.
 */
export async function extractExamFromPages(
  images: ImageInput[],
  injectedApiKey?: string,
  options: OcrPipelineOptions = {}
): Promise<OcrPipelineResult> {
  const windows = planBatches(images.length, { batchSize: options.batchSize, overlap: options.overlap });
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const attempts = Math.max(1, options.windowAttempts ?? 2);
  const results = new Map<number, BatchResult>();
  const failed: OcrPipelineResult['failedBatches'] = [];
  let next = 0;

  const runWindow = async (index: number) => {
    const window = windows[index];
    const slice = images.slice(window.start, window.end);
    let lastError: OcrError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const unit =
          attempt === 1 || slice.length === 1
            ? await extractExamUnit(slice, injectedApiKey, options.runtime)
            : {
                // retry with smaller windows: one page at a time
                questions: mergeBatches(
                  await Promise.all(
                    slice.map(async (image, offset) => ({
                      window: { start: window.start + offset, end: window.start + offset + 1 },
                      questions: (await extractExamUnit([image], injectedApiKey, options.runtime)).questions,
                    }))
                  )
                ).questions,
              };
        results.set(index, { window, questions: unit.questions });
        return;
      } catch (error) {
        lastError =
          error instanceof OcrError ? error : new OcrError('تعذر استخراج الأسئلة من الصور.', 'AI_OCR_FAILED', true);
        if (!lastError.retryable) break;
      }
    }
    failed.push({
      window,
      error: lastError?.message ?? 'تعذر استخراج الأسئلة',
      code: lastError?.code ?? 'AI_OCR_FAILED',
      retryable: lastError?.retryable ?? true,
    });
  };

  const worker = async () => {
    while (next < windows.length) {
      const index = next++;
      await runWindow(index);
      options.onProgress?.({
        windowsDone: results.size + failed.length,
        windowsTotal: windows.length,
        questionsSoFar: mergeBatches([...results.values()]).questions.length,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));

  const merged = mergeBatches([...results.values()]);
  return {
    ok: failed.length === 0,
    questions: merged.questions,
    warnings: merged.warnings,
    failedBatches: failed.sort((a, b) => a.window.start - b.window.start),
  };
}

/**
 * Backwards-compatible entry point: extracts from any number of images and returns
 * the merged questions (plus warnings).
 */
export async function extractAndSolveExamFromImages(
  images: ImageInput[],
  injectedApiKey?: string,
  options: OcrPipelineOptions = {}
): Promise<OcrExamResult> {
  if (!images.length) {
    return { ok: false, questions: [], error: 'لم يتم توفير أي صور للاستخراج' };
  }
  try {
    const pipeline = await extractExamFromPages(images, injectedApiKey, options);
    if (!pipeline.ok) {
      const first = pipeline.failedBatches[0];
      return {
        ok: false,
        questions: pipeline.questions,
        warnings: pipeline.warnings,
        error: first.error,
        code: first.code,
        retryable: first.retryable,
      };
    }
    return { ok: true, questions: pipeline.questions, warnings: pipeline.warnings };
  } catch (error) {
    const ocr = error instanceof OcrError ? error : null;
    return {
      ok: false,
      questions: [],
      error: ocr?.message ?? 'تعذر الاتصال بخدمة الذكاء الاصطناعي. يرجى التحقق من اتصال الخادم والمحاولة لاحقاً.',
      code: ocr?.code ?? 'AI_CONNECTION_ERROR',
      retryable: ocr?.retryable ?? true,
    };
  }
}
