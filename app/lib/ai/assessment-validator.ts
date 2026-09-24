/**
 * Authoritative Canonical Assessment Question Contract & Output Validator
 *
 * Enforces strict structural, linguistic, and completeness contracts for AI-generated
 * and user-edited assessments before preview, confirmation, or DB insertion.
 */

export type QuestionValidationReason =
  | 'EMPTY_QUESTION'
  | 'WRONG_OPTION_COUNT'
  | 'EMPTY_OPTION'
  | 'DUPLICATE_OPTION'
  | 'INVALID_CORRECT_INDEX'
  | 'MISSING_CORRECT_ANSWER'
  | 'MALFORMED_QUESTION'
  | 'DUPLICATE_QUESTION_TEXT'
  | 'MISSING_EXPLANATION'
  | 'EMPTY_EXPLANATION'
  | 'MALFORMED_EXPLANATION'
  | 'THEORETICAL_QUESTION'
  | 'INVALID_QUESTION_STYLE'
  | 'MISSING_BLANK';

export const CANONICAL_BLANK = '........';

export interface CanonicalAssessmentQuestion {
  id?: string;
  prompt: string;
  options: [string, string, string, string];
  correctAnswer: string;
  correctIndex: number;
  explanation?: string;
  category?: string;
  difficulty?: string;
  skill?: string;
}

export interface QuestionValidationOptions {
  allowLegacyWithoutExplanation?: boolean;
  requireBlank?: boolean;
}

export const QUESTION_REASON_LABELS: Record<QuestionValidationReason, string> = {
  EMPTY_QUESTION: 'نص السؤال فارغ أو قصير جداً.',
  WRONG_OPTION_COUNT: 'يجب أن يحتوي السؤال على 4 اختيارات.',
  EMPTY_OPTION: 'يوجد خيار فارغ في السؤال.',
  DUPLICATE_OPTION: 'يوجد خيارات مكررة.',
  INVALID_CORRECT_INDEX: 'يرجى تحديد إجابة صحيحة صالحة.',
  MISSING_CORRECT_ANSWER: 'يرجى تحديد الإجابة الصحيحة.',
  MALFORMED_QUESTION: 'بيانات السؤال غير صالحة.',
  DUPLICATE_QUESTION_TEXT: 'نص السؤال مكرر.',
  MISSING_EXPLANATION: 'يرجى كتابة شرح الإجابة للطالب.',
  EMPTY_EXPLANATION: 'شرح الإجابة فارغ.',
  MALFORMED_EXPLANATION: 'شرح الإجابة غير صالح.',
  THEORETICAL_QUESTION: 'السؤال بصيغة نظرية غير مسموح بها. يجب صياغة الأسئلة بشكل تطبيقي في سياق جمل.',
  INVALID_QUESTION_STYLE: 'صيغة السؤال غير مقبولة.',
  MISSING_BLANK: 'يجب أن تحتوي الجملة على فراغ (........).',
};

export interface QuestionValidationResult {
  valid: boolean;
  reasons: QuestionValidationReason[];
  normalizedQuestion?: CanonicalAssessmentQuestion;
}

export interface AssessmentValidationResult {
  valid: boolean;
  validQuestions: CanonicalAssessmentQuestion[];
  invalidQuestions: Array<{
    index: number;
    question: unknown;
    reasons: QuestionValidationReason[];
  }>;
  errors?: string[];
}

/** Canonical structured-output schema shared by assessment inference providers. */
export const ASSESSMENT_QUESTIONS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'options', 'correctIndex', 'correctAnswer', 'explanation'],
        properties: {
          prompt: { type: 'string', minLength: 5 },
          options: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: { type: 'string', minLength: 1 },
          },
          correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
          correctAnswer: { type: 'string', minLength: 1 },
          explanation: { type: 'string', minLength: 5, maxLength: 1500 },
        },
      },
    },
  },
};

/**
 * Normalizes prompt text for deduplication comparison.
 */
export function normalizePromptHash(prompt: string): string {
  return prompt
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Normalizes variable-length blanks (dots, underscores, ellipsis) to canonical 8-dot blank "........"
 */
export function normalizeBlank(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') return '';
  return prompt
    .replace(/(?:_{2,}|\.{3,}|…)/g, CANONICAL_BLANK)
    .trim();
}

/**
 * Detects theoretical/meta grammar-rule questions that should be rejected in favor of application-based questions.
 */
export function isTheoreticalQuestion(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim().toLowerCase();
  const theoreticalPatterns = [
    /^what\s+is\s+the\s+rule\b/i,
    /^what\s+rule\b/i,
    /^which\s+rule\b/i,
    /^which\s+tense\b/i,
    /^what\s+is\s+the\s+structure\b/i,
    /^what\s+is\s+the\s+formula\b/i,
    /^which\s+(?:of\s+the\s+following\s+|sentence\s+)(?:correctly\s+)?describes\b/i,
    /^which\s+(?:of\s+the\s+following\s+|sentence\s+)(?:correctly\s+)?explains\b/i,
    /^what\s+does\s+.*\s+mean\b/i,
    /^how\s+do\s+we\s+form\b/i,
    /^what\s+is\s+the\s+definition\s+of\b/i,
  ];
  return theoreticalPatterns.some((pattern) => pattern.test(p));
}

/**
 * Validates and normalizes a single question according to the authoritative MCQ contract:
 * - prompt: non-empty trimmed string (>= 5 chars), contextual application style, blanks normalized
 * - options: exactly 4 non-empty distinct trimmed strings
 * - correctIndex: integer between 0 and 3
 * - correctAnswer: matches options[correctIndex]
 * - explanation: non-empty string explaining reason
 */
export function validateGeneratedQuestion(
  raw: unknown,
  options: QuestionValidationOptions = {}
): QuestionValidationResult {
  const reasons: QuestionValidationReason[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, reasons: ['MALFORMED_QUESTION'] };
  }

  const r = raw as Record<string, unknown>;

  // 1. Prompt validation & normalization
  const rawPrompt =
    typeof r.prompt === 'string'
      ? r.prompt
      : typeof r.question === 'string'
      ? r.question
      : typeof r.questionText === 'string'
      ? r.questionText
      : '';
  let prompt = normalizeBlank(rawPrompt);
  if (!prompt || prompt.length < 5) {
    reasons.push('EMPTY_QUESTION');
  } else {
    // Quality check: Reject theoretical/meta grammar-rule questions
    if (isTheoreticalQuestion(prompt)) {
      reasons.push('THEORETICAL_QUESTION');
    }
    // Contextual blank requirement when enforced
    if (options.requireBlank && !prompt.includes(CANONICAL_BLANK)) {
      reasons.push('MISSING_BLANK');
    }
  }

  // 2. Options normalization & extraction
  let rawOptions: unknown[] = [];
  if (Array.isArray(r.options)) {
    rawOptions = r.options;
  } else if (Array.isArray(r.choices)) {
    rawOptions = r.choices;
  } else if (r.options && typeof r.options === 'object') {
    // Map {"A": "opt1", "B": "opt2", ...} to array
    rawOptions = Object.keys(r.options as Record<string, unknown>)
      .sort()
      .map((k) => (r.options as Record<string, unknown>)[k]);
  } else if (r.choices && typeof r.choices === 'object') {
    rawOptions = Object.keys(r.choices as Record<string, unknown>)
      .sort()
      .map((k) => (r.choices as Record<string, unknown>)[k]);
  }

  // MCQ requires exactly 4 options
  if (rawOptions.length !== 4) {
    reasons.push('WRONG_OPTION_COUNT');
  }

  const cleanedOptions: string[] = [];
  let hasEmptyOption = false;

  for (const opt of rawOptions) {
    let optStr = '';
    if (typeof opt === 'string') {
      optStr = opt.trim();
    } else if (opt && typeof opt === 'object') {
      const oObj = opt as Record<string, unknown>;
      if (typeof oObj.text === 'string') {
        optStr = oObj.text.trim();
      } else if (typeof oObj.value === 'string') {
        optStr = oObj.value.trim();
      } else if (typeof oObj.option === 'string') {
        optStr = oObj.option.trim();
      } else if (typeof oObj.content === 'string') {
        optStr = oObj.content.trim();
      } else if (typeof oObj.choice === 'string') {
        optStr = oObj.choice.trim();
      } else if (typeof oObj.answer === 'string') {
        optStr = oObj.answer.trim();
      }
    }

    if (!optStr) {
      hasEmptyOption = true;
    }
    cleanedOptions.push(optStr);
  }

  if (hasEmptyOption && !reasons.includes('EMPTY_OPTION')) {
    reasons.push('EMPTY_OPTION');
  }

  // Check duplicate options (case-insensitive) and dummy letter options
  if (cleanedOptions.length === 4 && !hasEmptyOption) {
    const normalizedOptions = cleanedOptions.map((o) => o.toLowerCase().trim());
    if (new Set(normalizedOptions).size !== 4) {
      reasons.push('DUPLICATE_OPTION');
    }
    // Reject dummy letter choices (e.g. ["A", "B", "C", "D"] or ["(A)", "(B)", "(C)", "(D)"])
    const isDummyLetterSet = normalizedOptions.every(
      (o) => /^[a-d]$/i.test(o) || /^\(?[a-d]\)?\.?$/i.test(o)
    );
    if (isDummyLetterSet) {
      reasons.push('EMPTY_OPTION');
    }
  }

  // 3. correctIndex & correctAnswer validation
  let correctIndex: number | undefined;
  if (typeof r.correctIndex === 'number' && Number.isInteger(r.correctIndex)) {
    correctIndex = r.correctIndex;
  } else if (typeof r.correctIndex === 'string') {
    if (/^[0-3]$/.test(r.correctIndex.trim())) {
      correctIndex = parseInt(r.correctIndex.trim(), 10);
    } else if (/^[A-D]$/i.test(r.correctIndex.trim())) {
      correctIndex = r.correctIndex.trim().toUpperCase().charCodeAt(0) - 65;
    } else {
      reasons.push('INVALID_CORRECT_INDEX');
    }
  } else if (r.correctIndex !== undefined) {
    reasons.push('INVALID_CORRECT_INDEX');
  }

  let correctAnswer = typeof r.correctAnswer === 'string' ? r.correctAnswer.trim() : '';
  if (!correctAnswer && typeof r.correct_answer === 'string') {
    correctAnswer = r.correct_answer.trim();
  }

  // Resolve correctIndex from correctAnswer if correctIndex was absent
  if (correctIndex === undefined && correctAnswer) {
    const letterMatch = correctAnswer.match(/^[A-D]$/i);
    if (letterMatch) {
      correctIndex = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
    } else {
      const matchIdx = cleanedOptions.findIndex(
        (opt) => opt.toLowerCase() === correctAnswer.toLowerCase()
      );
      if (matchIdx !== -1) {
        correctIndex = matchIdx;
      }
    }
  }

  // Validate correctIndex bounds [0, 3]
  if (correctIndex === undefined || correctIndex < 0 || correctIndex > 3) {
    if (!reasons.includes('INVALID_CORRECT_INDEX')) {
      reasons.push('INVALID_CORRECT_INDEX');
    }
  } else {
    // If correctIndex is valid, ensure correctAnswer matches the option
    if (cleanedOptions[correctIndex]) {
      correctAnswer = cleanedOptions[correctIndex];
    } else {
      reasons.push('MISSING_CORRECT_ANSWER');
    }
  }

  if (!correctAnswer && !reasons.includes('MISSING_CORRECT_ANSWER')) {
    reasons.push('MISSING_CORRECT_ANSWER');
  }

  // 4. Explanation validation
  let explanation: string | undefined;
  if (options.allowLegacyWithoutExplanation && (r.explanation === undefined || r.explanation === null)) {
    explanation = undefined;
  } else {
    if (r.explanation === undefined || r.explanation === null) {
      reasons.push('MISSING_EXPLANATION');
    } else if (typeof r.explanation !== 'string') {
      reasons.push('MALFORMED_EXPLANATION');
    } else {
      const expTrimmed = r.explanation.trim();
      if (expTrimmed.length === 0) {
        reasons.push('EMPTY_EXPLANATION');
      } else {
        explanation = expTrimmed.slice(0, 1500);
      }
    }
  }

  const id = typeof r.id === 'string' ? r.id : undefined;

  if (reasons.length > 0) {
    return { valid: false, reasons };
  }

  const category = typeof r.category === 'string' ? r.category.trim() : undefined;
  const difficulty = typeof r.difficulty === 'string' ? r.difficulty.trim() : undefined;
  const skill = typeof r.skill === 'string' ? r.skill.trim() : undefined;

  return {
    valid: true,
    reasons: [],
    normalizedQuestion: {
      id,
      prompt,
      options: cleanedOptions as [string, string, string, string],
      correctAnswer,
      correctIndex: correctIndex!,
      explanation,
      category,
      difficulty,
      skill,
    },
  };
}

/**
 * Deterministically validates an entire assessment question list.
 * Deduplicates questions by prompt and enforces exact count if requestedCount is provided.
 */
export function validateGeneratedAssessment(
  questions: unknown[],
  requestedCount?: number,
  options: QuestionValidationOptions = {}
): AssessmentValidationResult {
  const validQuestions: CanonicalAssessmentQuestion[] = [];
  const invalidQuestions: Array<{
    index: number;
    question: unknown;
    reasons: QuestionValidationReason[];
  }> = [];
  const seenPromptHashes = new Set<string>();

  if (!Array.isArray(questions)) {
    return {
      valid: false,
      validQuestions: [],
      invalidQuestions: [{ index: 0, question: questions, reasons: ['MALFORMED_QUESTION'] }],
    };
  }

  questions.forEach((rawQ, idx) => {
    const qResult = validateGeneratedQuestion(rawQ, options);
    if (!qResult.valid || !qResult.normalizedQuestion) {
      invalidQuestions.push({
        index: idx,
        question: rawQ,
        reasons: qResult.reasons,
      });
      return;
    }

    const hash = normalizePromptHash(qResult.normalizedQuestion.prompt);
    if (seenPromptHashes.has(hash)) {
      invalidQuestions.push({
        index: idx,
        question: rawQ,
        reasons: ['DUPLICATE_QUESTION_TEXT'],
      });
      return;
    }

    seenPromptHashes.add(hash);
    validQuestions.push(qResult.normalizedQuestion);
  });

  const errors: string[] = [];
  if (questions.length > 30 || (requestedCount !== undefined && requestedCount > 30)) {
    errors.push('عدد الأسئلة يتجاوز الحد الأقصى المسموح به (30 سؤالاً)');
  }

  const countMatches =
    requestedCount !== undefined ? validQuestions.length === requestedCount : true;

  const valid = countMatches && invalidQuestions.length === 0 && errors.length === 0;

  return {
    valid,
    validQuestions,
    invalidQuestions,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Determines whether an assessment is eligible for final submission/insertion.
 * Disables confirmation button if any question is incomplete, empty, or structurally invalid.
 */
export function isAssessmentSubmissionAllowed(
  questions: unknown[],
  options: QuestionValidationOptions = { allowLegacyWithoutExplanation: true }
): {
  allowed: boolean;
  reason?: string;
} {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { allowed: false, reason: 'يجب أن يحتوي التقييم على سؤال واحد على الأقل.' };
  }

  for (let i = 0; i < questions.length; i++) {
    const qResult = validateGeneratedQuestion(questions[i], options);
    if (!qResult.valid) {
      if (qResult.reasons.includes('THEORETICAL_QUESTION') || qResult.reasons.includes('INVALID_QUESTION_STYLE')) {
        return {
          allowed: false,
          reason: `السؤال رقم ${i + 1} بصيغة نظرية غير مسموح بها. يجب صياغة الأسئلة بشكل تطبيقي في سياق جمل.`,
        };
      }
      if (qResult.reasons.includes('EMPTY_OPTION')) {
        return { allowed: false, reason: `يوجد خيار فارغ في السؤال رقم ${i + 1}. هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.` };
      }
      if (qResult.reasons.includes('WRONG_OPTION_COUNT')) {
        return { allowed: false, reason: `السؤال رقم ${i + 1} لا يحتوي على 4 خيارات تماماً. هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.` };
      }
      if (qResult.reasons.includes('DUPLICATE_OPTION')) {
        return { allowed: false, reason: `يوجد خيارات مكررة في السؤال رقم ${i + 1}. هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.` };
      }
      if (qResult.reasons.includes('EMPTY_QUESTION')) {
        return { allowed: false, reason: `نص السؤال رقم ${i + 1} فارغ أو غير مكتمل.` };
      }
      if (qResult.reasons.includes('MISSING_CORRECT_ANSWER') || qResult.reasons.includes('INVALID_CORRECT_INDEX')) {
        return { allowed: false, reason: `يرجى تحديد الإجابة الصحيحة للسؤال رقم ${i + 1}.` };
      }
      if (
        qResult.reasons.includes('EMPTY_EXPLANATION') ||
        qResult.reasons.includes('MISSING_EXPLANATION') ||
        qResult.reasons.includes('MALFORMED_EXPLANATION')
      ) {
        return { allowed: false, reason: `يرجى كتابة شرح الإجابة للطالب في السؤال رقم ${i + 1}.` };
      }
      return { allowed: false, reason: `السؤال رقم ${i + 1}: هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.` };
    }
  }

  return { allowed: true };
}

export interface LectureCoverageInput {
  courseId: string;
  mode?: 'all' | 'range' | string;
  startLectureId?: string | null;
  endLectureId?: string | null;
  courseLectures?: Array<{
    id: string;
    courseId?: string;
    title?: string;
    sortOrder?: number;
    orderIndex?: number;
  }>;
}

export interface LectureCoverageValidationResult {
  valid: boolean;
  mode: 'all' | 'range';
  startLectureId: string | null;
  endLectureId: string | null;
  error?: string;
}

/**
 * Validates course lecture coverage range for PDF assessments.
 * Strict rules:
 * - 'all': canonical full-course coverage (startLectureId=null, endLectureId=null)
 * - 'range': both start and end required, must belong to course, start <= end in course sequence.
 */
export function validateLectureCoverageRange(
  input: LectureCoverageInput
): LectureCoverageValidationResult {
  const mode = input.mode === 'range' ? 'range' : 'all';
  if (mode === 'all') {
    return {
      valid: true,
      mode: 'all',
      startLectureId: null,
      endLectureId: null,
    };
  }

  const startId = typeof input.startLectureId === 'string' ? input.startLectureId.trim() : '';
  const endId = typeof input.endLectureId === 'string' ? input.endLectureId.trim() : '';

  if (!startId || !endId) {
    return {
      valid: false,
      mode: 'range',
      startLectureId: startId || null,
      endLectureId: endId || null,
      error: 'يرجى تحديد محاضرة البداية ومحاضرة النهاية لنطاق الاختبار',
    };
  }

  const lectures = Array.isArray(input.courseLectures) ? input.courseLectures : [];
  if (lectures.length > 0) {
    const startLec = lectures.find((l) => l.id === startId);
    const endLec = lectures.find((l) => l.id === endId);

    if (!startLec || (startLec.courseId && startLec.courseId !== input.courseId)) {
      return {
        valid: false,
        mode: 'range',
        startLectureId: startId,
        endLectureId: endId,
        error: 'محاضرة البداية المحددة غير تابعة لهذه الدورة التعليمية',
      };
    }

    if (!endLec || (endLec.courseId && endLec.courseId !== input.courseId)) {
      return {
        valid: false,
        mode: 'range',
        startLectureId: startId,
        endLectureId: endId,
        error: 'محاضرة النهاية المحددة غير تابعة لهذه الدورة التعليمية',
      };
    }

    const startIndex = lectures.indexOf(startLec);
    const endIndex = lectures.indexOf(endLec);

    if (startIndex > endIndex) {
      return {
        valid: false,
        mode: 'range',
        startLectureId: startId,
        endLectureId: endId,
        error: 'يجب أن تكون محاضرة البداية قبل أو نفس محاضرة النهاية في تسلسل الدورة',
      };
    }
  }

  return {
    valid: true,
    mode: 'range',
    startLectureId: startId,
    endLectureId: endId,
  };
}

