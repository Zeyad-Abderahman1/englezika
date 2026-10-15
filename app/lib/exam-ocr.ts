import { getPlatformEnv } from './platform';
import { safeText } from './security';

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
};

export type OcrExamResult = {
  ok: boolean;
  questions: ExtractedQuestion[];
  error?: string;
  code?: string;
};

export type ImageInput = {
  data: string; // base64 or raw buffer base64 string
  mimeType: string;
};

const VISION_SYSTEM_PROMPT = `You are a precision OCR engine and expert Egyptian Secondary School English examiner.
Read all questions from the provided image(s).
Rule 1: Transcribe every question prompt and every multiple-choice option 100% VERBATIM without changing a single character or word. Do NOT paraphrase, summarize, fix grammar, translate, or alter wording or fill-in-the-blank formatting (e.g. "......").
Rule 2: Strip leading question numbers (e.g., '1.', '2-', 'Q1:') and option letters ('a)', 'b)', 'A.', 'B.') from the text strings while keeping options in their exact original order.
Rule 3: Ignore page headers, footers, watermarks, teacher phone numbers, decorative borders.
Rule 4: Solve each question with 100% grammatical accuracy and select the single correct option as 'correct_answer' (must match one of the extracted 'options' strings character-for-character).
Rule 5: Return strictly valid JSON matching the schema below without any markdown fences or preamble.

Schema:
{
  "questions": [
    {
      "temp_id": "uuid-string",
      "sort_order": 1,
      "type": "multiple_choice",
      "prompt": "Exact verbatim question stem",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "Exact string matching winning option",
      "points": 1,
      "ai_confidence": "high",
      "ai_explanation": "Brief reasoning in Arabic or English for teacher"
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
    const rawExplanation = safeText(raw.ai_explanation || '', 500);
    const explanation =
      rawExplanation ||
      (type === 'multiple_choice' && !correctAnswer
        ? 'لم يتم تحديد إجابة صحيحة مطابقة تلقائياً، يرجى اختيار الإجابة الصحيحة يدوياً'
        : 'تم استخراج السؤال بالذكاء الاصطناعي');

    return {
      temp_id: tempId,
      sort_order: index + 1,
      type,
      prompt,
      options,
      correct_answer: correctAnswer,
      points,
      ai_confidence: confidence,
      ai_explanation: explanation,
    };
  });
}

/**
 * Extracts and solves questions from image buffers via Gemini Vision API
 */
export async function extractAndSolveExamFromImages(
  images: ImageInput[],
  injectedApiKey?: string
): Promise<OcrExamResult> {
  if (!images.length) {
    return { ok: false, questions: [], error: 'لم يتم توفير أي صور للاستخراج' };
  }

  const env = getPlatformEnv();
  const apiKey =
    injectedApiKey?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    (env as Record<string, string | undefined>).GEMINI_API_KEY?.trim();

  // If no API key configured, return explicit error
  if (!apiKey) {
    return {
      ok: false,
      questions: [],
      error: 'مفتاح الذكاء الاصطناعي (GEMINI_API_KEY) غير مضبوط في إعدادات الخادم. يرجى تهيئة المفتاح للبدء في استخراج الأسئلة.',
      code: 'GEMINI_KEY_MISSING',
    };
  }

  const rawModel =
    process.env.GEMINI_MODEL?.trim() ||
    (env as Record<string, string | undefined>).GEMINI_MODEL?.trim() ||
    'gemini-3.8-flash';

  const cleanModel = rawModel.replace(/^models\//, '').trim();
  const model = cleanModel || 'gemini-3.8-flash';

  try {
    const parts: Array<Record<string, unknown>> = [
      { text: VISION_SYSTEM_PROMPT },
      { text: 'Analyze these uploaded exam question images and extract all questions strictly following the rules:' },
    ];

    for (const img of images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data,
        },
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const truncatedMessage = errText.slice(0, 300);
      console.error('[Gemini OCR API Error]', { status: response.status, message: truncatedMessage });

      if (response.status === 404) {
        return {
          ok: false,
          questions: [],
          error: 'نموذج الذكاء الاصطناعي غير متاح حالياً، يرجى التواصل مع المطور.',
          code: 'AI_MODEL_UNAVAILABLE',
        };
      }

      return {
        ok: false,
        questions: [],
        error: 'تعذر استخراج الأسئلة من الصور عبر خدمة الذكاء الاصطناعي. يرجى المحاولة لاحقاً.',
        code: 'AI_OCR_FAILED',
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOutput) {
      console.error('[Gemini OCR Empty Response]', {
        hasCandidates: Boolean(data?.candidates?.length),
      });
      return {
        ok: false,
        questions: [],
        error: 'لم يُرجع الذكاء الاصطناعي أي استجابة صالحة لتحليل صور الامتحان.',
        code: 'AI_EMPTY_RESPONSE',
      };
    }

    let parsed: { questions?: unknown[] };
    try {
      const cleaned = cleanJsonOutput(textOutput);
      parsed = JSON.parse(cleaned) as { questions?: unknown[] };
    } catch (parseError) {
      const rawMsg = parseError instanceof Error ? parseError.message : String(parseError);
      console.error('[Gemini OCR Parse Error]', { message: rawMsg.slice(0, 300) });
      return {
        ok: false,
        questions: [],
        error: 'لم نتمكن من تحليل إجابة نموذج الذكاء الاصطناعي بشكل صحيح. يرجى المحاولة مرة أخرى.',
        code: 'AI_PARSE_ERROR',
      };
    }

    const questions = normalizeExtractedQuestions(parsed.questions || []);

    return {
      ok: true,
      questions,
    };
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    const rawMsg = error instanceof Error ? error.message : String(error);
    const truncatedMessage = rawMsg.slice(0, 300);
    console.error('[Gemini OCR Exception]', status ? { status, message: truncatedMessage } : { message: truncatedMessage });

    if (status === 404 || rawMsg.includes('404')) {
      return {
        ok: false,
        questions: [],
        error: 'نموذج الذكاء الاصطناعي غير متاح حالياً، يرجى التواصل مع المطور.',
        code: 'AI_MODEL_UNAVAILABLE',
      };
    }

    return {
      ok: false,
      questions: [],
      error: 'تعذر الاتصال بخدمة الذكاء الاصطناعي. يرجى التحقق من اتصال الخادم والمحاولة لاحقاً.',
      code: 'AI_CONNECTION_ERROR',
    };
  }
}
