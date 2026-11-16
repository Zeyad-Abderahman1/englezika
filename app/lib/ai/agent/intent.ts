import { normalizeArabic } from './normalize';
import type { DeleteKind } from './delete-impact';

/**
 * Intent classification for the admin assistant (pure, deterministic, no I/O).
 *
 * Supported requests (everything else is NOT a create-course request):
 *   add    : create a course / add a lecture / add homework / create an exam from photos
 *   edit   : change a course (price, name, class, description, publish state, thumbnail)
 *   delete : delete ONE course / lecture / exam / homework (typed-name confirmation)
 *   info   : read-only platform questions
 *
 * The old classifier treated "عايز" (I want) as a create verb, so "عايز احذف كورس" matched
 * "<verb> ... كورس" and started the create-course flow. Delete verbs are now checked FIRST,
 * and desire words ("عايز", "محتاج", ...) never act as an action verb on their own.
 */

export type TargetKind = DeleteKind | 'course_or_unknown';

export type Classified =
  | { type: 'delete'; kind: DeleteKind | null; bulk: boolean; unsupportedTarget?: string }
  | { type: 'edit'; kind: DeleteKind | null; unsupported: boolean }
  | { type: 'add'; flow: 'create_course' | 'add_lecture' | 'add_homework' | 'create_exam_from_images' }
  | { type: 'ambiguous'; kind: DeleteKind | null }
  | { type: 'none' };

const DELETE_VERB =
  '(?:احذف|احذفي|احذفلي|احذفه|احذفها|احذفهم|حذف|امسح|امسحي|امسحلي|امسحه|امسحها|مسح|شيل|شيلي|شيله|شيلها|ازل|ازيل|ازيلي|ازاله|ازالت|امحي|امحو|تخلص من|اتخلص من|اشيل|اشيله|اشيلها|اشيلهم|تشيل|تشيله|تمسح|تمسحه|تمسحلي|تحذف|تحذفه|تحذفلي|نمسح|نحذف|نشيل)';

const EDIT_VERB = '(?:غير|غيري|عدل|عدلي|بدل|تغيير|تعديل|غير اسم|سمي|سميلي|رجع|رجعلي)';

const ADD_VERB = '(?:اضيف|اضف|ضيف|ضيفلي|اضافه|انشئ|انشاء|اعمل|اعملي|سجل|سجلي|رفع|ارفع|ارفعلي|اعمللي)';

const DESIRE = '(?:عايز|عاوز|عايزه|عاوزه|محتاج|محتاجه|اريد|نفسي|حابب|ممكن|لو سمحت|من فضلك)';

const NOUNS: Array<[DeleteKind, string]> = [
  ['course', '(?:كورس|كورسات|الكورس|الكورسات|دوره|الدوره|دورات|الدورات)'],
  ['lecture', '(?:محاضره|محاضرات|المحاضره|المحاضرات|فيديو|فيديوهات|الفيديو|الفيديوهات|درس|دروس|الدرس|الدروس|حصه|حصص)'],
  ['exam', '(?:امتحان|امتحانات|الامتحان|الامتحانات|اختبار|اختبارات|الاختبار|الاختبارات|كويز|quiz)'],
  ['assignment', '(?:واجب|واجبات|الواجب|الواجبات|هوم ?ورك|homework|تكليف|تكليفات)'],
];

// Things the assistant can never delete: it must say so instead of guessing another flow.
const UNSUPPORTED_DELETE_TARGET =
  /(?:طالب|طلاب|الطلاب|طلبه|مستخدم|مستخدمين|اشتراك|اشتراكات|دفع|مدفوعات|فلوس|حساب|حسابات|كود|اكواد|اكوادي|سؤال|اسئله|صوره|ملف|ملفات|تعليق|تعليقات|اعلان|اعلانات|الكل|كل حاجه|كل شيء|قاعده البيانات|الداتا)/;

const BULK = /(?:كل|جميع|كافه|مجموع)\s*(?:ال)?(?:كورسات|دورات|محاضرات|فيديوهات|دروس|امتحانات|اختبارات|واجبات|حاجه|شيء|حاجات)|(?:الكورسات|المحاضرات|الامتحانات|الاختبارات|الواجبات|الفيديوهات)\s*(?:كلها|كلهم|جميعها)|(?:كلهم|كلها)(?![\p{L}\p{N}])/u;

function kindOf(n: string): DeleteKind | null {
  let best: { kind: DeleteKind; index: number } | null = null;
  for (const [kind, pattern] of NOUNS) {
    const match = new RegExp(`(?:^|\\s)${pattern}(?![\\p{L}\\p{N}])`, 'u').exec(n);
    if (match && (!best || match.index < best.index)) best = { kind, index: match.index };
  }
  return best?.kind ?? null;
}

const anyNoun = `(?:${NOUNS.map(([, pattern]) => pattern).join('|')})`;

export function detectTargetKind(message: string): DeleteKind | null {
  return kindOf(normalizeArabic(message));
}

export function hasDeleteVerb(message: string): boolean {
  return new RegExp(`(?:^|\\s)${DELETE_VERB}(?![\\p{L}\\p{N}])`, 'u').test(normalizeArabic(message));
}

/** Full classification of one free-text message. */
export function classifyRequest(message: string): Classified {
  const n = normalizeArabic(message);
  if (!n) return { type: 'none' };

  const kind = kindOf(n);
  const deleteVerb = new RegExp(`(?:^|\\s)${DELETE_VERB}(?![\\p{L}\\p{N}])`, 'u').test(n);

  // 1. Delete always wins: a delete verb + a target (or no target yet) is NEVER a create request.
  if (deleteVerb) {
    const unsupported = UNSUPPORTED_DELETE_TARGET.exec(n);
    const bulk = BULK.test(n);
    if (unsupported && !kind) {
      return { type: 'delete', kind: null, bulk: false, unsupportedTarget: unsupported[0] };
    }
    return { type: 'delete', kind, bulk };
  }

  // 2. Exam from photos (specific, checked before the generic add patterns).
  if (/(?:امتحان|اختبار).{0,25}(?:من|بال|عن طريق)\s*(?:ال)?(?:صور|صوره)|(?:صور|صوره).{0,20}(?:امتحان|اختبار)/.test(n)) {
    return { type: 'add', flow: 'create_exam_from_images' };
  }

  // 3. Edit / rename.
  const editVerb = new RegExp(`(?:^|\\s)${EDIT_VERB}(?![\\p{L}\\p{N}])`, 'u').test(n);
  if (editVerb && kind && kind !== 'course') {
    return { type: 'edit', kind, unsupported: true };
  }
  if (
    /(?:غير|عدل|بدل|خلي|تغيير|تعديل|اخفي|انشر|وقف نشر|الغي نشر|سمي).{0,30}(?:سعر|اسم|وصف|صوره|صف|كورس|نشر)/.test(n) ||
    (editVerb && kind === 'course')
  ) {
    return { type: 'edit', kind: kind ?? 'course', unsupported: false };
  }

  // 4. Add. Desire words may only introduce a real action verb ("عايز اضيف كورس") or a
  //    "new X" phrase ("عايز كورس جديد"); they are not action verbs by themselves.
  const addLead = `(?:${DESIRE}\\s+)?${ADD_VERB}`;
  if (new RegExp(`${addLead}.{0,25}(?:محاضره|محاضرات|فيديو|فيديوهات|درس|دروس|لينك)`).test(n)) {
    return { type: 'add', flow: 'add_lecture' };
  }
  if (new RegExp(`${addLead}.{0,25}(?:واجب|واجبات|هوم ?ورك|homework)`).test(n) || /^(?:واجب|هوم ?ورك)/.test(n)) {
    return { type: 'add', flow: 'add_homework' };
  }
  if (new RegExp(`${addLead}.{0,25}(?:كورس|دوره)`).test(n) || /(?:كورس|دوره) جديد/.test(n)) {
    return { type: 'add', flow: 'create_course' };
  }
  if (new RegExp(`${DESIRE}\\s+(?:محاضره|فيديو|درس)\\s+جديد`).test(n)) return { type: 'add', flow: 'add_lecture' };
  if (new RegExp(`${DESIRE}\\s+واجب\\s+جديد`).test(n)) return { type: 'add', flow: 'add_homework' };

  // 5. A desire word + a noun, with no action verb: do not guess. Ask add / edit / delete.
  if (new RegExp(`^(?:${DESIRE}\\s+)+(?:ال)?${anyNoun}\\s*$`).test(n) || new RegExp(`^${anyNoun}\\s*$`).test(n)) {
    return { type: 'ambiguous', kind: kind ?? 'course' };
  }

  return { type: 'none' };
}

/**
 * Message that tries to switch away from the running flow: starts with a correction cue
 * ("لا", "بلاش", "استنى"...) which marks the previous answer as wrong.
 */
export function hasSwitchCue(message: string): boolean {
  return /^(?:لا|لأ|لاء|بلاش|استني|استنى|لحظه|سيب|مش عايز|مش عاوز|بدل كده|خلاص)(?![\p{L}\p{N}])/u.test(normalizeArabic(message));
}

/** Words that do not identify an item ("احذفه بالكامل", "موجود", "اللي عندي"...). */
const QUERY_STOP = new Set(
  [
    'موجود', 'موجوده', 'احذفه', 'احذفها', 'احذف', 'امسح', 'امسحه', 'امسحها', 'شيل', 'شيله', 'شيلها', 'بالكامل', 'كامل', 'نهائي', 'نهائيا',
    'خالص', 'تماما', 'عايز', 'عاوز', 'عايزه', 'محتاج', 'اريد', 'انا', 'ان', 'انو', 'ا', 'من', 'في', 'ده', 'دي', 'ها', 'لو', 'سمحت', 'من', 'فضلك',
    'ممكن', 'اللي', 'الي', 'عندي', 'عندنا', 'حاجه', 'واحد', 'واحده', 'بتاع', 'بتاعت', 'باسم', 'اسمه', 'اسمها', 'اسم', 'يسمي', 'نهايي', 'ال',
    'ازاله', 'حذف', 'مسح', 'ازل', 'ازيل', 'كل', 'جميع', 'هذا', 'هذه', 'ده', 'دا', 'دة', 'الحالي', 'الحاليه', 'بتاعي', 'بتاعتي', 'لو', 'تمام', 'لا',
  ].map((word) => normalizeArabic(word))
);

/** The item name the teacher mentioned after a delete request, or '' when none ("احذف كورس موجود"). */
export function extractDeleteQuery(message: string): string {
  const quoted = message.match(/["«“'](.{2,80}?)["»”']/u);
  if (quoted?.[1]) return quoted[1].trim();
  const nounPattern = new RegExp(`(?:^|\\s)${anyNoun}(?![\\p{L}\\p{N}])`, 'u');
  const tokens = normalizeArabic(message).split(' ');
  const rest: string[] = [];
  let seenNoun = false;
  for (const token of tokens) {
    if (!seenNoun && nounPattern.test(` ${token}`)) {
      seenNoun = true;
      continue;
    }
    if (!seenNoun) continue;
    if (QUERY_STOP.has(token) || token.length < 2) continue;
    if (new RegExp(`^${DELETE_VERB}$`, 'u').test(token)) continue;
    rest.push(token);
  }
  return rest.join(' ').trim();
}

export const CAPABILITIES_MESSAGE = [
  'ده طلب مش مدعوم عندي دلوقتي، ومش هنفّذ حاجة مختلفة بدله. اللي أقدر أعمله:',
  '• إضافة: كورس، محاضرة، واجب، أو امتحان من صور',
  '• تعديل كورس: السعر، الاسم، الصف، الوصف، النشر أو الإخفاء، الصورة',
  '• حذف عنصر واحد في كل مرة: كورس، محاضرة، امتحان، أو واجب (مع تأكيد بكتابة الاسم)',
  '• أسئلة عن المنصة: عدد الطلاب، الاشتراكات، الكورسات المنشورة',
].join('\n');
