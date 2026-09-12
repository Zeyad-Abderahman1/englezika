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
  | 'DUPLICATE_QUESTION_TEXT';

export interface CanonicalAssessmentQuestion {
  id?: string;
  prompt: string;
  options: [string, string, string, string];
  correctAnswer: string;
  correctIndex: number;
  explanation?: string;
}

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
          explanation: { type: 'string' },
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
 * Validates and normalizes a single question according to the authoritative MCQ contract:
 * - prompt: non-empty trimmed string (>= 5 chars)
 * - options: exactly 4 non-empty distinct trimmed strings
 * - correctIndex: integer between 0 and 3
 * - correctAnswer: matches options[correctIndex]
 */
export function validateGeneratedQuestion(raw: unknown): QuestionValidationResult {
  const reasons: QuestionValidationReason[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, reasons: ['MALFORMED_QUESTION'] };
  }

  const r = raw as Record<string, unknown>;

  // 1. Prompt validation
  const rawPrompt =
    typeof r.prompt === 'string'
      ? r.prompt
      : typeof r.question === 'string'
      ? r.question
      : typeof r.questionText === 'string'
      ? r.questionText
      : '';
  const prompt = rawPrompt.trim();
  if (!prompt || prompt.length < 5) {
    reasons.push('EMPTY_QUESTION');
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

  // Check duplicate options (case-insensitive)
  if (cleanedOptions.length === 4 && !hasEmptyOption) {
    const normalizedOptions = cleanedOptions.map((o) => o.toLowerCase().trim());
    if (new Set(normalizedOptions).size !== 4) {
      reasons.push('DUPLICATE_OPTION');
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

  const explanation =
    typeof r.explanation === 'string' ? r.explanation.trim().slice(0, 1000) : undefined;
  const id = typeof r.id === 'string' ? r.id : undefined;

  if (reasons.length > 0) {
    return { valid: false, reasons };
  }

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
    },
  };
}

/**
 * Deterministically validates an entire assessment question list.
 * Deduplicates questions by prompt and enforces exact count if requestedCount is provided.
 */
export function validateGeneratedAssessment(
  questions: unknown[],
  requestedCount?: number
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
    const qResult = validateGeneratedQuestion(rawQ);
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
export function isAssessmentSubmissionAllowed(questions: unknown[]): {
  allowed: boolean;
  reason?: string;
} {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { allowed: false, reason: 'يجب أن يحتوي التقييم على سؤال واحد على الأقل.' };
  }

  for (let i = 0; i < questions.length; i++) {
    const qResult = validateGeneratedQuestion(questions[i]);
    if (!qResult.valid) {
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
      return { allowed: false, reason: `السؤال رقم ${i + 1}: هذا السؤال يحتوي على اختيارات غير صالحة. يرجى تعديله أو إعادة التوليد.` };
    }
  }

  return { allowed: true };
}
