/**
 * Pure, dependency-free helpers for understanding the teacher's Arabic messages:
 * digit/price normalization, intent keywords, YouTube link extraction and fuzzy
 * course matching. Everything here is deterministic and unit-tested; the model is
 * only a fallback for messages these helpers cannot understand.
 */

import { extractYouTubeId } from '../../youtube';

// ── Text normalization ─────────────────────────────────────────────────────────

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** Converts Arabic-Indic and Persian digits to ASCII digits. */
export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const arabic = ARABIC_INDIC.indexOf(ch);
    if (arabic >= 0) return String(arabic);
    return String(PERSIAN_INDIC.indexOf(ch));
  });
}

/** Lowercases, strips diacritics/tatweel and unifies common Arabic letter variants. */
export function normalizeArabic(text: string): string {
  return normalizeDigits(text)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Price parsing ──────────────────────────────────────────────────────────────

const UNIT_WORDS: Record<string, number> = {
  واحد: 1,
  اتنين: 2,
  اثنين: 2,
  تلاته: 3,
  ثلاثه: 3,
  اربعه: 4,
  خمسه: 5,
  سته: 6,
  سبعه: 7,
  تمانيه: 8,
  ثمانيه: 8,
  تسعه: 9,
  عشره: 10,
  حداشر: 11,
  احدعشر: 11,
  اتناشر: 12,
  اثناعشر: 12,
  تلتاشر: 13,
  اربعتاشر: 14,
  خمستاشر: 15,
};

const TEN_WORDS: Record<string, number> = {
  عشرين: 20,
  تلاتين: 30,
  ثلاثين: 30,
  اربعين: 40,
  خمسين: 50,
  ستين: 60,
  سبعين: 70,
  تمانين: 80,
  ثمانين: 80,
  تسعين: 90,
};

const HUNDRED_WORDS: Record<string, number> = {
  ميه: 100,
  ميت: 100,
  مائه: 100,
  ميتين: 200,
  مئتين: 200,
  مائتين: 200,
  تلتميه: 300,
  ثلاثمائه: 300,
  ثلاثمئه: 300,
  تلاتميه: 300,
  ربعميه: 400,
  اربعمائه: 400,
  اربعميه: 400,
  خمسميه: 500,
  خمسمائه: 500,
  خمسمئه: 500,
  ستميه: 600,
  ستمائه: 600,
  سبعميه: 700,
  سبعمائه: 700,
  تمنميه: 800,
  ثمانمائه: 800,
  تمانميه: 800,
  تسعميه: 900,
  تسعمائه: 900,
};

const FREE_WORDS = new Set(['مجاني', 'مجانا', 'مجانيه', 'فري', 'free', 'ببلاش', 'بلاش']);

function parseNumberWords(text: string): number | null {
  const tokens = normalizeArabic(text)
    .split(' ')
    .map((token) => (token.startsWith('و') && token.length > 3 ? token.slice(1) : token))
    .filter(Boolean);

  let total = 0;
  let current = 0;
  let matched = false;

  for (const token of tokens) {
    if (token in UNIT_WORDS) {
      current += UNIT_WORDS[token];
      matched = true;
    } else if (token in TEN_WORDS) {
      current += TEN_WORDS[token];
      matched = true;
    } else if (token in HUNDRED_WORDS) {
      current += HUNDRED_WORDS[token];
      matched = true;
    } else if (token === 'الف') {
      total += (current || 1) * 1000;
      current = 0;
      matched = true;
    } else if (token === 'الفين') {
      total += 2000;
      matched = true;
    } else if (token === 'الاف' || token === 'تلاف') {
      total += (current || 1) * 1000;
      current = 0;
      matched = true;
    }
  }

  return matched ? total + current : null;
}

const CURRENCY_TOKENS = new Set(['جنيه', 'جنيها', 'جنيهات', 'جنيهًا', 'ج', 'جم', 'egp', 'le', 'ل', 'pound', 'pounds']);

/**
 * Finds a price only when the message makes it explicit: a number next to a
 * currency word ("500 ج", "خمسمية جنيه") or after "سعر"/"بسعر". Safe to run on a
 * long message that contains other numbers (grade, lecture count...).
 */
export function parsePriceWithContext(text: string): number | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const digits = normalizeDigits(text).replace(/[٬]/g, ',');

  const beforeCurrency = digits.match(
    /(\d[\d,]*(?:\.\d+)?)\s*(?:جنيه|جنية|جنيها|جنيهات|ج\.?\s?م\.?|ج(?![\p{L}])|egp|l\.?e\.?(?![\p{L}])|pounds?)/iu
  );
  if (beforeCurrency) {
    const value = Number(beforeCurrency[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value >= 0) return Math.round(value);
  }

  const afterPriceWord = digits.match(/(?:بسعر|سعره|سعرها|السعر|سعر)\s*(?:هو|يبقى|يكون|الى|إلى|:)?\s*(\d[\d,]*(?:\.\d+)?)/u);
  if (afterPriceWord) {
    const value = Number(afterPriceWord[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value >= 0) return Math.round(value);
  }

  // Number words directly before a currency word: "خمسمية جنيه".
  const tokens = normalizeArabic(text).split(' ');
  const currencyIndex = tokens.findIndex((token) => CURRENCY_TOKENS.has(token));
  if (currencyIndex > 0) {
    const window = tokens.slice(Math.max(0, currencyIndex - 4), currencyIndex).join(' ');
    const fromWords = parseNumberWords(window);
    if (fromWords !== null) return fromWords;
  }
  return null;
}

/**
 * Extracts a price in EGP from free text. Understands ASCII and Arabic-Indic
 * digits ("٥٠٠"), thousands separators ("1,500" / "١٬٥٠٠"), Egyptian number words
 * ("خمسمية جنيه", "ألف وخمسمية") and "free" words (→ 0). Returns null when no
 * price is present. The result is always a whole number of pounds.
 */
export function parsePrice(text: string): number | null {
  if (typeof text !== 'string' || !text.trim()) return null;

  const contextual = parsePriceWithContext(text);
  if (contextual !== null) return contextual;

  const digitsText = normalizeDigits(text).replace(/[٬،]/g, ',');
  const numeric = digitsText.match(/\d[\d,]*(?:\.\d+)?/);
  if (numeric) {
    const value = Number(numeric[0].replace(/,/g, ''));
    if (Number.isFinite(value) && value >= 0) return Math.round(value);
  }

  const words = normalizeArabic(text).split(' ');
  if (words.some((word) => FREE_WORDS.has(word))) return 0;

  const fromWords = parseNumberWords(text);
  return fromWords !== null ? fromWords : null;
}

// ── Command words ──────────────────────────────────────────────────────────────

const CANCEL_WORDS = ['الغاء', 'الغي', 'الغيه', 'cancel', 'وقف', 'خلاص مش عايز', 'مش عايز اكمل', 'سيبك'];
const SKIP_WORDS = ['تخطي', 'تخطى', 'skip', 'مفيش', 'بدون', 'لا شكرا', 'بعدين', 'لاحقا', 'مش دلوقتي', 'مش دلوقت'];
const YES_WORDS = ['تاكيد', 'اكد', 'ايوه', 'ايوا', 'اه', 'تمام', 'موافق', 'yes', 'ok', 'okay', 'نعم', 'اوكي', 'ماشي', 'كمل'];
const NO_WORDS = ['لا', 'no', 'مش موافق'];

function matchesCommand(text: string, words: string[]): boolean {
  const normalized = normalizeArabic(text);
  if (!normalized) return false;
  return words.some((word) => {
    const w = normalizeArabic(word);
    return normalized === w || normalized.startsWith(`${w} `) || (w.includes(' ') && normalized.includes(w));
  });
}

export const isCancelCommand = (text: string) => matchesCommand(text, CANCEL_WORDS);
export const isSkipCommand = (text: string) => matchesCommand(text, SKIP_WORDS);
export const isYesCommand = (text: string) => matchesCommand(text, YES_WORDS);
export const isNoCommand = (text: string) => matchesCommand(text, NO_WORDS);

// ── Edit phrases ("غير السعر") ─────────────────────────────────────────────────

export type EditableSlot = 'title' | 'grade' | 'price' | 'thumbnail' | 'description' | 'publish' | 'course' | 'lectures';

const EDIT_SLOT_PATTERNS: Array<[EditableSlot, RegExp]> = [
  ['price', /(سعر|الثمن|التسعير|بكام|المبلغ)/],
  ['title', /(اسم|عنوان)/],
  ['grade', /(الصف|صف|المرحله|مرحله)/],
  ['thumbnail', /(صوره|الصوره|الغلاف|thumbnail)/],
  ['description', /(وصف|الوصف)/],
  ['publish', /(النشر|نشر|مسوده|draft)/],
  ['course', /(الكورس|كورس)/],
];

/**
 * Detects "change the price" / "غير السعر" style edits made in the middle of a
 * flow. Returns the slot the teacher wants to revisit, or null.
 */
export function detectEditRequest(text: string): EditableSlot | null {
  const normalized = normalizeArabic(text);
  if (!/(غير|عدل|بدل|غيري|تعديل|تغيير|اقصد|قصدي)/.test(normalized)) return null;
  for (const [slot, pattern] of EDIT_SLOT_PATTERNS) {
    if (pattern.test(normalized)) return slot;
  }
  return null;
}

// ── YouTube ────────────────────────────────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s<>"'،]+/gi;

export function findUrls(text: string): string[] {
  return (text.match(URL_PATTERN) || []).map((url) => url.replace(/[).,؛]+$/, ''));
}

/** Validates a YouTube URL/ID using the same parser as the lecture service. */
export function parseYouTubeUrl(value: string): { valid: boolean; id: string | null; url: string | null } {
  const id = extractYouTubeId(value);
  return id
    ? { valid: true, id, url: `https://www.youtube.com/watch?v=${id}` }
    : { valid: false, id: null, url: null };
}

export interface LectureDraft {
  title: string;
  url: string;
}

/**
 * Parses one or many lectures from a message. Supports one lecture per line in
 * the forms `title - url`, `title: url`, `title url` or `url title`. A bare URL
 * (no title) is returned with an empty title so the agent can ask for it.
 * Non-YouTube URLs are reported in `invalid`.
 */
export function parseLectureLines(text: string): { lectures: LectureDraft[]; invalid: string[] } {
  const lectures: LectureDraft[] = [];
  const invalid: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const urls = findUrls(line);
    if (urls.length === 0) continue;
    for (const url of urls) {
      const parsed = parseYouTubeUrl(url);
      if (!parsed.valid) {
        invalid.push(url);
        continue;
      }
      const title = line
        .replace(url, ' ')
        .replace(/^[\s\d]+[.)\-–:]\s*/, '') // list numbering "1) "
        .replace(/^(?:محاضره|محاضرة|درس|فيديو|عنوان)\s*[:：-]?\s*/i, '')
        .replace(/(?:^|\s)(?:الرابط|لينك|رابط|link)\s*[:：-]?\s*/gi, ' ')
        .replace(/[\s\-–:：|]+$/g, '')
        .replace(/^[\s\-–:：|]+/g, '')
        .trim();
      lectures.push({ title: urls.length === 1 ? title : '', url: parsed.url as string });
    }
  }

  // A bare YouTube ID/URL typed without http(s):// on a single line.
  if (lectures.length === 0 && invalid.length === 0) {
    const bare = text.match(/(?:youtu\.be\/|youtube\.com\/\S*)\S+/i);
    if (bare) {
      const parsed = parseYouTubeUrl(bare[0]);
      if (parsed.valid) {
        lectures.push({ title: text.replace(bare[0], ' ').replace(/\s+/g, ' ').trim(), url: parsed.url as string });
      } else {
        invalid.push(bare[0]);
      }
    }
  }

  return { lectures, invalid };
}

// ── Grade matching ─────────────────────────────────────────────────────────────

const ORDINALS: Array<[number, string[]]> = [
  [1, ['اولي', 'اول', '1']],
  [2, ['تانيه', 'ثانيه', 'تاني', 'ثاني', '2']],
  [3, ['تالته', 'ثالثه', 'تالت', 'ثالث', '3']],
  [4, ['رابعه', 'رابع', '4']],
  [5, ['خامسه', 'خامس', '5']],
  [6, ['سادسه', 'سادس', '6']],
];
const STAGES = ['ثانوي', 'اعدادي', 'ابتدائي'];

function gradeTraits(text: string): { ordinal?: number; stage?: string } {
  const tokens = normalizeArabic(text)
    .split(' ')
    .map((token) => token.replace(/^ال/, ''));
  const ordinal = ORDINALS.find(([, words]) => tokens.some((token) => words.includes(token)))?.[0];
  const stage = STAGES.find((candidate) => tokens.includes(candidate));
  return { ordinal, stage };
}

/**
 * Maps whatever the teacher typed ("تالتة ثانوي", "الصف الثالث الثانوي", "3 ثانوي")
 * to one of the real grade values. Returns null when nothing matches, so the agent
 * can show the real list instead of guessing.
 */
export function matchGrade(text: string, grades: string[]): string | null {
  const normalized = normalizeArabic(text);
  if (!normalized) return null;

  for (const grade of grades) {
    if (normalizeArabic(grade) === normalized) return grade;
  }

  const wanted = gradeTraits(text);
  if (wanted.ordinal !== undefined) {
    const candidates = grades.filter((grade) => {
      const traits = gradeTraits(grade);
      if (traits.ordinal !== wanted.ordinal) return false;
      return wanted.stage ? traits.stage === wanted.stage : true;
    });
    if (candidates.length === 1) return candidates[0];
  }

  for (const grade of grades) {
    const g = normalizeArabic(grade);
    if (g.length >= 4 && normalized.includes(g)) return grade;
  }

  if (/(^| )كل (ال)?صفوف( |$)/.test(normalized)) {
    return grades.find((grade) => normalizeArabic(grade).includes('كل')) ?? null;
  }
  return null;
}

// ── Fuzzy course matching ──────────────────────────────────────────────────────

export interface CourseRef {
  id: string;
  title: string;
  grade?: string;
}

const STOP_WORDS = new Set(['كورس', 'دوره', 'ال', 'في', 'علي', 'على', 'من', 'الي', 'الى', 'بتاع', 'بتاعه', 'ده', 'دي']);

function significantTokens(text: string): string[] {
  return normalizeArabic(text)
    .split(' ')
    .map((token) => token.replace(/^ال/, ''))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * Ranks courses against a free-text query. Exact (normalized) title matches win
 * outright; otherwise courses are scored by the share of query tokens contained in
 * the title. Returns candidates best-first, only those with a meaningful score.
 */
export function matchCourses(query: string, courses: CourseRef[]): Array<CourseRef & { score: number }> {
  const normalizedQuery = normalizeArabic(query);
  if (!normalizedQuery) return [];

  const queryTokens = significantTokens(query);
  const scored = courses
    .map((course) => {
      const normalizedTitle = normalizeArabic(course.title);
      if (normalizedTitle === normalizedQuery) return { ...course, score: 1 };
      if (normalizedTitle.includes(normalizedQuery) && normalizedQuery.length >= 3) {
        return { ...course, score: 0.9 };
      }
      const titleTokens = significantTokens(course.title);
      if (queryTokens.length === 0 || titleTokens.length === 0) return { ...course, score: 0 };
      const hits = queryTokens.filter((token) =>
        titleTokens.some((titleToken) => titleToken.includes(token) || token.includes(titleToken))
      ).length;
      return { ...course, score: (hits / queryTokens.length) * 0.8 };
    })
    .filter((candidate) => candidate.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  return scored;
}

/** True when two titles are the same after normalization (duplicate guard). */
export function isSameTitle(a: string, b: string): boolean {
  const na = normalizeArabic(a);
  return na.length > 0 && na === normalizeArabic(b);
}

// ── Exam settings: duration and passing percentage ────────────────────────────

/** Exam duration in minutes from free text: "45 دقيقة", "ساعة", "ساعتين", "ساعة ونص". */
export function parseDurationMinutes(text: string): number | null {
  const n = normalizeArabic(text);
  if (/ساعه ونص|ساعه ونصف/.test(n)) return 90;
  if (/ساعتين/.test(n)) return 120;
  const hours = n.match(/(\d{1,2})\s*(?:ساعه|ساعات|ساعة)/);
  if (hours) return Math.min(300, Number(hours[1]) * 60);
  const minutes = n.match(/(\d{1,3})\s*(?:دقيقه|دقايق|دقيقة|min|m\b)/);
  if (minutes) {
    const value = Number(minutes[1]);
    return value >= 1 && value <= 300 ? value : null;
  }
  if (/(?:^| )ساعه(?: |$)/.test(n)) return 60;
  return null;
}

/** Passing percentage (0-100) from text such as "نجاح 60" or "60%". */
export function parsePassingScore(text: string): number | null {
  const n = normalizeDigits(text);
  const labelled = n.match(/(?:نجاح|النجاح|درجه النجاح|درجة النجاح)\D{0,12}(\d{1,3})/);
  const percent = n.match(/(\d{1,3})\s*(?:%|٪|بالمية|في المية|بالمائة)/);
  const raw = labelled?.[1] ?? percent?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  return value >= 0 && value <= 100 ? value : null;
}
