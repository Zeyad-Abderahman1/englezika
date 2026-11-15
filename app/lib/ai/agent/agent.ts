import { randomUUID } from 'node:crypto';
import type { AiProvider } from '../ai-provider';
import { extractWithModel, type ModelExtraction } from './extract';
import {
  detectEditRequest,
  isCancelCommand,
  isNoCommand,
  isSameTitle,
  isSkipCommand,
  isYesCommand,
  matchCourses,
  matchGrade,
  normalizeArabic,
  parseLectureLines,
  parsePrice,
  parsePriceWithContext,
  parseYouTubeUrl,
  type CourseRef,
} from './normalize';
import {
  emptySession,
  type AgentSession,
  type AgentSessionStore,
  type FlowId,
  type LectureSlot,
} from './session';
import type { AgentChipOption, AgentConfirmRow, AgentEvent, AgentUi } from './ui-types';
import type { ConfirmationPreview } from '../preview-generator';

/**
 * Conversational agent for the admin AI assistant.
 *
 * Responsibilities (and non-responsibilities):
 * - It runs a deterministic slot-filling state machine for the supported flows
 *   (create course, add lecture(s), update course, add homework) and answers
 *   read-only platform questions.
 * - It NEVER writes to the database. A finished flow is turned into a pending
 *   confirmation (signed, durable, owned by the acting staff member). The write
 *   only happens when the teacher presses "تأكيد", through the existing
 *   /api/admin/ai/execute endpoint, which runs the registry-validated tool executor.
 * - The model (if configured) only helps to extract field candidates from free
 *   text. Everything it returns is validated like any other user input.
 */

// ── Dependencies (injectable for tests) ───────────────────────────────────────

export interface AgentActor {
  email: string;
  name?: string;
  role?: string;
  permissions?: string[];
}

export interface AgentStats {
  total: number;
  courses?: Array<{ id: string; title: string; grade?: string }>;
}

export interface AgentReadTools {
  listGrades(): Promise<string[]>;
  listCourses(): Promise<Array<CourseRef & { status?: string; price?: number }>>;
  listLectureTitles(courseId: string): Promise<string[]>;
  stats(metric: string, courseId?: string): Promise<AgentStats>;
}

export interface PendingConfirmation {
  token: string;
}

export interface ExecutedConfirmation {
  state: string;
  actionType: string;
  result: unknown;
  errorMessage?: string | null;
}

export interface AgentDeps {
  store: AgentSessionStore;
  readTools: AgentReadTools;
  /** Creates a signed, durable confirmation. This is the ONLY write path. */
  createConfirmation(args: {
    actionType: string;
    payload: Record<string, unknown>;
    preview: ConfirmationPreview;
  }): Promise<PendingConfirmation>;
  supersedeConfirmation(token: string): Promise<void>;
  loadConfirmation(token: string): Promise<ExecutedConfirmation | null>;
  stagedImageExists(uploadId: string): Promise<boolean>;
  persist: {
    ensureConversation(conversationId: string, title: string): Promise<void>;
    saveMessage(
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      toolCallJson: string | null
    ): Promise<void>;
  };
  provider?: AiProvider | null;
}

export interface AgentTurnInput {
  actor: AgentActor;
  message?: string;
  event?: AgentEvent;
  conversationId?: string;
}

export interface AgentTurnResult {
  /** False when the agent does not recognise the request (caller falls back to the planner). */
  handled: boolean;
  conversationId: string;
  reply: string;
  ui: AgentUi[];
  flow: FlowId | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CHIPS = 12;
const FREE_TEXT_SLOTS = new Set(['title', 'description', 'lectures', 'lecture_title', 'lecture_url']);
const FREE_TEXT_MAX = 400;
const THUMBNAIL_ACCEPT = 'image/jpeg,image/png,image/webp';
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

const UPDATE_FIELDS: AgentChipOption[] = [
  { label: 'السعر', value: 'price' },
  { label: 'الاسم', value: 'title' },
  { label: 'الصف', value: 'grade' },
  { label: 'الوصف', value: 'description' },
  { label: 'النشر / الإخفاء', value: 'publish' },
  { label: 'الصورة المصغرة', value: 'thumbnail' },
];

const PUBLISH_CHIPS: AgentChipOption[] = [
  { label: 'نشر الآن', value: 'published' },
  { label: 'حفظ كمسودة', value: 'draft' },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  return price === 0 ? 'مجاني' : `${price.toLocaleString('en-US')} جنيه`;
}

function publishLabel(publish: boolean): string {
  return publish ? 'منشور فورًا' : 'مسودة (غير ظاهر للطلاب)';
}

function cleanText(value: string, max = FREE_TEXT_MAX): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function gradeChips(grades: string[]): AgentUi {
  return {
    kind: 'chips',
    slot: 'grade',
    options: grades.slice(0, MAX_CHIPS).map((grade) => ({ label: grade, value: grade })),
  };
}

function courseChips(courses: CourseRef[], slot = 'course'): AgentUi {
  return {
    kind: 'chips',
    slot,
    options: courses.slice(0, MAX_CHIPS).map((course) => ({
      label: course.title.length > 48 ? `${course.title.slice(0, 47)}…` : course.title,
      value: course.id,
    })),
  };
}

function reply(
  text: string,
  ui: AgentUi[] = [],
  flow: FlowId | null = null,
  handled = true
): Omit<AgentTurnResult, 'conversationId'> {
  return { handled, reply: text, ui, flow };
}

// ── Intent detection (deterministic first) ────────────────────────────────────

export type SimpleIntent = FlowId | 'info' | null;

export function detectIntent(message: string): SimpleIntent {
  const n = normalizeArabic(message);
  if (!n) return null;

  const addVerb = '(?:اضيف|اضف|ضيف|ضيفلي|انشئ|انشاء|اعمل|اعملي|سجل|رفع|ارفع|عايز|عاوز|محتاج|اريد)';

  if (new RegExp(`${addVerb}.{0,25}(?:محاضره|محاضرات|فيديو|فيديوهات|درس|دروس|لينك)`).test(n)) {
    return 'add_lecture';
  }
  if (new RegExp(`${addVerb}.{0,25}(?:واجب|واجبات|هوم ?ورك|homework)`).test(n) || /^(?:واجب|هوم ?ورك)/.test(n)) {
    return 'add_homework';
  }
  if (new RegExp(`${addVerb}.{0,25}(?:كورس|دوره)`).test(n) || /(?:كورس|دوره) جديد/.test(n)) {
    return 'create_course';
  }
  if (/(?:غير|عدل|بدل|خلي|تغيير|تعديل|اخفي|انشر|وقف نشر|الغي نشر).{0,30}(?:سعر|اسم|وصف|صوره|صف|كورس|نشر)/.test(n)) {
    return 'update_course';
  }
  if (/(?:كام|عدد|اجمالي|اعرض|اظهر|قولي).{0,25}(?:طالب|طلاب|اشتراك|اشتراكات|كورسات|محاضرات|محاضره)/.test(n)) {
    return 'info';
  }
  if (/(?:اشتراك|اشتراكات|طلبات).{0,20}(?:معلق|مفعل|فعال|نشط)/.test(n)) return 'info';
  if (findYouTubeAnywhere(message)) return 'add_lecture';
  return null;
}

function findYouTubeAnywhere(message: string): boolean {
  return /(?:youtu\.be\/|youtube\.com\/)/i.test(message);
}

function classifyInfo(message: string): { metric: string; needsCourse?: boolean } | null {
  const n = normalizeArabic(message);
  if (/(?:معلق|معلقه|قيد المراجعه|بانتظار|في الانتظار).{0,25}(?:اشتراك|طلب)|(?:اشتراك|اشتراكات|طلبات).{0,20}(?:معلق|معلقه|قيد المراجعه|بانتظار)/.test(n)) {
    return { metric: 'pending_enrollments' };
  }
  if (/(?:اشتراك|اشتراكات).{0,20}(?:مفعل|مفعله|فعال|فعاله|نشط|نشطه)|(?:مفعل|مفعله|فعال|نشط).{0,12}(?:اشتراك|اشتراكات)/.test(n)) {
    return { metric: 'active_enrollments' };
  }
  if (/(?:كام|عدد|اجمالي).{0,15}(?:طالب|طلاب)|(?:طالب|طلاب).{0,12}(?:كام|عددهم)/.test(n)) {
    return { metric: 'students' };
  }
  if (/(?:كام|عدد|اعرض|اظهر|قولي|ايه).{0,20}(?:الكورسات|كورسات).{0,20}(?:منشور|المنشوره)|(?:الكورسات|كورسات).{0,15}(?:منشور|المنشوره)/.test(n)) {
    return { metric: 'published_courses' };
  }
  if (/(?:كام|عدد).{0,12}(?:محاضره|محاضرات|فيديو|فيديوهات)/.test(n)) {
    return { metric: 'course_lecture_count', needsCourse: true };
  }
  return null;
}

// ── Agent core ────────────────────────────────────────────────────────────────

interface TurnContext {
  actor: AgentActor;
  deps: AgentDeps;
  message: string;
  event?: AgentEvent;
  conversationId: string;
  grades?: string[];
  courses?: Array<CourseRef & { status?: string; price?: number }>;
}

async function getGrades(ctx: TurnContext): Promise<string[]> {
  if (!ctx.grades) ctx.grades = await ctx.deps.readTools.listGrades();
  return ctx.grades;
}

async function getCourses(ctx: TurnContext): Promise<Array<CourseRef & { status?: string; price?: number }>> {
  if (!ctx.courses) ctx.courses = await ctx.deps.readTools.listCourses();
  return ctx.courses;
}

export async function runAgentTurn(input: AgentTurnInput, deps: AgentDeps): Promise<AgentTurnResult> {
  const conversationId = input.conversationId?.trim() || randomUUID();
  const message = (input.message ?? '').trim().slice(0, 2000);
  const email = input.actor.email.toLowerCase();

  if (!message && !input.event) {
    throw new Error('رسالة المعلم لا يمكن أن تكون فارغة');
  }

  const session = (await deps.store.load(conversationId, email)) ?? emptySession();
  const ctx: TurnContext = { actor: input.actor, deps, message, event: input.event, conversationId };

  let outcome: Omit<AgentTurnResult, 'conversationId'>;
  try {
    outcome = await step(ctx, session);
  } catch (error) {
    outcome = reply(friendlyError(error), [{ kind: 'error', message: friendlyError(error), retry: false }], session.flow);
  }

  if (!outcome.handled) {
    return { conversationId, ...outcome };
  }

  // Only persist once the agent owns the turn, so an unhandled message that falls
  // through to the planner is not stored twice.
  await deps.persist.ensureConversation(conversationId, (message || 'محادثة جديدة').slice(0, 50));
  if (message) {
    await deps.persist.saveMessage(conversationId, 'user', message, null);
  }

  if (session.flow || session.awaiting || session.pendingToken) {
    await deps.store.save(conversationId, email, session);
  } else {
    await deps.store.clear(conversationId, email);
  }

  await deps.persist.saveMessage(
    conversationId,
    'assistant',
    outcome.reply,
    outcome.ui.length ? JSON.stringify({ ui: outcome.ui, flow: outcome.flow }) : null
  );
  return { conversationId, ...outcome };
}

function friendlyError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'FORBIDDEN') return 'مش معاك الصلاحية اللازمة لتنفيذ ده.';
  const message = error instanceof Error ? error.message : '';
  if (/[؀-ۿ]/.test(message) && message.length < 160) return message;
  return 'حصلت مشكلة غير متوقعة. جرّب تاني بعد شوية.';
}

async function step(ctx: TurnContext, session: AgentSession): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  const { event, message } = ctx;

  if (event?.type === 'executed') return handleExecuted(ctx, session, event.token);
  if (event?.type === 'cancel' || (message && session.flow && isCancelCommand(message))) {
    return cancelFlow(ctx, session);
  }
  if (event?.type === 'start_flow') {
    await cancelPending(ctx, session);
    resetFlow(session, event.flow);
    return advance(ctx, session, true);
  }

  if (event?.type === 'choice' && event.slot === '__start') {
    const [flowId, ...rest] = event.value.split(':');
    if (isFlowId(flowId)) {
      await cancelPending(ctx, session);
      resetFlow(session, flowId);
      const prefill = rest.join(':').trim();
      if (prefill && flowId === 'create_course') session.slots.title = cleanText(prefill, 120);
      if (prefill && flowId === 'update_course' && UPDATE_FIELDS.some((field) => field.value === prefill)) {
        session.slots.pendingField = prefill;
      }
      return advance(ctx, session, true);
    }
  }

  if (event && !session.flow) {
    return reply('الجلسة انتهت أو اتلغت. ابدأ من جديد بإحدى الأوامر السريعة أو اكتب طلبك.');
  }

  // Information questions are answered even in the middle of a flow, then the
  // open question is repeated so no collected data is lost.
  if (message && !event) {
    const info = classifyInfo(message);
    if (info && (!session.flow || !FREE_TEXT_SLOTS.has(session.awaiting ?? ''))) {
      const answer = await answerInfo(ctx, session, info);
      if (answer) {
        if (session.flow) {
          const resume = await advance(ctx, session, false);
          return { ...resume, reply: `${answer.reply}\n\n${resume.reply}`, ui: [...answer.ui, ...resume.ui] };
        }
        return answer;
      }
    }
  }

  if (session.awaiting === 'info_course' && event?.type === 'choice' && event.slot === 'info_course') {
    const courses = await getCourses(ctx);
    const course = courses.find((c) => c.id === event.value);
    session.awaiting = null;
    if (!course) return reply('مش لاقي الكورس ده. اكتب اسمه تاني من فضلك.');
    return (await answerInfo(ctx, session, { metric: 'course_lecture_count' }, course)) ?? reply('تعذر جلب البيانات.');
  }

  if (!session.flow) {
    if (!message) return reply('', [], null, false);

    let intent = detectIntent(message);
    let extraction: ModelExtraction | null = null;
    if (!intent) {
      const [grades, courses] = await Promise.all([getGrades(ctx), getCourses(ctx)]);
      extraction = await extractWithModel(ctx.deps.provider, {
        message,
        flow: null,
        awaiting: null,
        grades,
        courseTitles: courses.map((c) => c.title),
      });
      if (extraction?.intent && extraction.intent !== 'other') intent = extraction.intent;
    }
    if (!intent) return reply('', [], null, false);

    if (intent === 'info') {
      const info = classifyInfo(message);
      if (!info) return reply('', [], null, false);
      return (await answerInfo(ctx, session, info)) ?? reply('', [], null, false);
    }

    resetFlow(session, intent);
    await prefillFromMessage(ctx, session, message, extraction);
    return advance(ctx, session, true);
  }

  // Active flow ─ apply the teacher's input to the current slot.
  if (event?.type === 'retry') return rebuildConfirmation(ctx, session);

  const error = await applyInput(ctx, session);
  if (error) {
    const again = await advance(ctx, session, false);
    return { ...again, reply: `${error}\n\n${again.reply}` };
  }
  return advance(ctx, session, false);
}

// ── Flow lifecycle ────────────────────────────────────────────────────────────

function isFlowId(value: string): value is FlowId {
  return value === 'create_course' || value === 'add_lecture' || value === 'update_course' || value === 'add_homework';
}

function resetFlow(session: AgentSession, flow: FlowId): void {
  session.flow = flow;
  session.slots = flow === 'update_course' ? { changes: {} } : {};
  session.awaiting = null;
  session.pendingToken = null;
}

async function cancelPending(ctx: TurnContext, session: AgentSession): Promise<void> {
  if (session.pendingToken) {
    await ctx.deps.supersedeConfirmation(session.pendingToken).catch(() => undefined);
    session.pendingToken = null;
  }
}

async function cancelFlow(ctx: TurnContext, session: AgentSession): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  await cancelPending(ctx, session);
  const had = Boolean(session.flow);
  session.flow = null;
  session.slots = {};
  session.awaiting = null;
  return reply(had ? 'تمام، ألغيت العملية ومفيش حاجة اتغيّرت. أقدر أساعدك في إيه تاني؟' : 'مفيش عملية شغالة دلوقتي. أقدر أساعدك في إيه؟');
}

// ── Prefill from the first message ────────────────────────────────────────────

async function prefillFromMessage(
  ctx: TurnContext,
  session: AgentSession,
  message: string,
  extraction: ModelExtraction | null
): Promise<void> {
  const slots = session.slots as Record<string, unknown>;
  const [grades, courses] = await Promise.all([getGrades(ctx), getCourses(ctx)]);

  // Let the model help on richer first messages, then validate everything below.
  if (!extraction && message.length >= 12) {
    extraction = await extractWithModel(ctx.deps.provider, {
      message,
      flow: session.flow,
      awaiting: null,
      grades,
      courseTitles: courses.map((c) => c.title),
    });
  }

  const flow = session.flow as FlowId;

  if (flow === 'create_course') {
    const title = extractCourseTitle(message) ?? extraction?.title;
    if (title && cleanText(title, 120).length >= 3) slots.title = cleanText(title, 120);
    const grade = matchGrade(message, grades) ?? (extraction?.grade ? matchGrade(extraction.grade, grades) : null);
    if (grade) slots.grade = grade;
    const price = parsePriceWithContext(message) ?? (extraction?.priceText ? parsePrice(extraction.priceText) : null);
    if (price !== null && price >= 0 && price <= 100_000) slots.price = price;
    if (extraction?.description) slots.description = cleanText(extraction.description, 1000);
    if (typeof extraction?.publish === 'boolean') slots.publish = extraction.publish;
  }

  if (flow === 'add_lecture' || flow === 'add_homework' || flow === 'update_course') {
    const query = extraction?.courseQuery ?? extractCourseQuery(message);
    if (query) {
      const matches = matchCourses(query, courses);
      if (matches.length === 1 || (matches.length > 1 && matches[0].score - matches[1].score >= 0.25)) {
        slots.courseId = matches[0].id;
        slots.courseTitle = matches[0].title;
      }
    }
    if (!slots.courseId) {
      const direct = matchCourses(message, courses);
      if (direct.length === 1 || (direct.length > 1 && direct[0].score >= 0.9 && direct[1].score < 0.9)) {
        slots.courseId = direct[0].id;
        slots.courseTitle = direct[0].title;
      }
    }
  }

  if (flow === 'add_lecture') {
    const parsed = parseLectureLines(message);
    const fromModel = (extraction?.lectures ?? [])
      .map((lecture) => ({
        title: cleanText(lecture.title ?? '', 150),
        url: lecture.url ? (parseYouTubeUrl(lecture.url).url ?? '') : '',
      }))
      .filter((lecture) => lecture.url);
    const lectures = parsed.lectures.length ? parsed.lectures : fromModel;
    if (lectures.length) slots.lectures = lectures.slice(0, 20);
    if (parsed.invalid.length) slots.invalidUrl = parsed.invalid[0];
    applyLectureOptions(slots, message);
  }

  if (flow === 'add_homework') {
    const title = extractAfterKeyword(message, /(?:اسمه|اسمها|بعنوان|عنوانه|عنوانها)/) ?? extraction?.title;
    if (title && cleanText(title, 150).length >= 3) slots.title = cleanText(title, 150);
  }

  if (flow === 'update_course') {
    const changes = slots.changes as Record<string, unknown>;
    const price = parsePriceWithContext(message) ?? (extraction?.newPriceText ? parsePrice(extraction.newPriceText) : null);
    if (price !== null && price >= 0 && price <= 100_000 && /(?:سعر|ثمن|تسعير|بكام|جنيه|ج\b)/.test(normalizeArabic(message))) {
      changes.price = price;
    }
    if (/(?:اخفي|وقف نشر|الغي نشر|مسوده)/.test(normalizeArabic(message))) changes.publish = 'draft';
    else if (/(?:انشر|نشر)/.test(normalizeArabic(message))) changes.publish = 'published';
    if (extraction?.newTitle && cleanText(extraction.newTitle, 120).length >= 3) changes.title = cleanText(extraction.newTitle, 120);
    if (extraction?.newGrade) {
      const grade = matchGrade(extraction.newGrade, grades);
      if (grade) changes.grade = grade;
    }
  }
}

function extractAfterKeyword(message: string, keyword: RegExp): string | null {
  const source = keyword.source;
  const pattern = new RegExp(`${source}\\s*[:：]?\\s*["«“]?(.+?)["»”]?(?=\\s+(?:للصف|لصف|الصف|بسعر|سعره|سعر|للكورس|في كورس|فى كورس|لكورس)(?![\\p{L}\\p{N}])|$)`, 'u');
  const match = message.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractCourseTitle(message: string): string | null {
  return extractAfterKeyword(message, /(?:اسمه|اسمها|باسم|بعنوان|اسم الكورس)/);
}

function extractCourseQuery(message: string): string | null {
  const match = message.match(/(?:كورس|دوره|الكورس)\s+["«“]?(.+?)["»”]?(?=\s+(?:الى|إلى|ل|لـ|بسعر|بـ|ب)\s*\d|\s*$)/u);
  const candidate = match?.[1]?.trim();
  return candidate && candidate.length >= 2 ? candidate : null;
}

function applyLectureOptions(slots: Record<string, unknown>, message: string): void {
  const n = normalizeArabic(message);
  const minutes = n.match(/(?:مدتها|مدته|مدة)\s*(?:المحاضره|الفيديو)?\s*(\d{1,3})\s*(?:دقيقه|دقايق|دقيقة)/);
  if (minutes) slots.durationSeconds = Math.min(86_400, Number(minutes[1]) * 60);
  const views = n.match(/(?:عدد المشاهدات|المشاهدات|مشاهدات|حد المشاهده)\s*(?:هو|يبقى|:)?\s*(\d{1,4})/);
  if (views) slots.maxViews = Math.min(1000, Number(views[1]));
  if (/(?:مشاهدات)\s*(?:غير محدود|مفتوحه)|بدون حد/.test(n)) slots.maxViews = 0;
  if (/(?:امتحان|اختبار).{0,20}(?:قبل|شرط|يسبق)|(?:قبل).{0,20}(?:امتحان|اختبار)/.test(n)) {
    slots.prereqNote = true;
  }
}

// ── Applying one piece of input to the open slot ──────────────────────────────

/** Returns an Arabic error string when the input was not usable, otherwise null. */
async function applyInput(ctx: TurnContext, session: AgentSession): Promise<string | null> {
  const { event, message } = ctx;
  const flow = session.flow as FlowId;

  // Edit phrases ("غير السعر") work from any point in a flow.
  if (message && !event) {
    const edit = detectEditRequest(message);
    if (edit && session.awaiting !== 'title' && session.awaiting !== 'lectures') {
      const slot = mapEditSlot(flow, edit);
      if (slot) {
        await cancelPending(ctx, session);
        session.awaiting = slot;
        // The same message may already carry the new value ("غير السعر إلى 600").
        const inline = parsePriceWithContext(message);
        if (slot === 'price' && inline !== null) {
          session.awaiting = 'price';
          return applyValue(ctx, session, 'price', { text: message });
        }
        return null;
      }
    }
  }

  // Chip / attachment / skip events carry an explicit slot.
  if (event?.type === 'choice') {
    if (event.slot === '__edit') {
      await cancelPending(ctx, session);
      session.awaiting = event.value;
      return null;
    }
    if (event.slot === '__confirm_hint') return null;
    return applyValue(ctx, session, event.slot, { choice: event.value });
  }
  if (event?.type === 'attachment') {
    return applyValue(ctx, session, 'thumbnail', { uploadId: event.uploadId });
  }
  if (event?.type === 'skip') {
    return applyValue(ctx, session, session.awaiting ?? '', { skip: true });
  }

  if (!message) return null;

  // While a confirmation card is open, plain text is only meaningful as an edit/cancel.
  if (session.pendingToken && session.awaiting === null) {
    if (isYesCommand(message)) {
      // Writes only happen through the card's confirm button (separate authenticated request).
      return 'اضغط على زر «تأكيد» في البطاقة علشان أنفّذ العملية.';
    }
    if (isNoCommand(message)) return null;
  }

  // Typed answer for the open slot.
  const awaiting = session.awaiting;
  if (awaiting) {
    if (isSkipCommand(message) && (awaiting === 'thumbnail' || awaiting === 'description' || awaiting === 'lectures_options')) {
      return applyValue(ctx, session, awaiting, { skip: true });
    }
    // Opportunistic extras on the same message (e.g. price mentioned while naming the course).
    await opportunisticExtras(ctx, session, message, awaiting);
    return applyValue(ctx, session, awaiting, { text: message });
  }

  // No open slot: treat the message as extra details for the current flow.
  await opportunisticExtras(ctx, session, message, null);
  return null;
}

function mapEditSlot(flow: FlowId, slot: ReturnType<typeof detectEditRequest>): string | null {
  if (!slot) return null;
  const allowed: Record<FlowId, string[]> = {
    create_course: ['title', 'grade', 'price', 'thumbnail', 'description', 'publish'],
    add_lecture: ['course', 'lectures'],
    update_course: ['price', 'title', 'grade', 'description', 'publish', 'thumbnail', 'course'],
    add_homework: ['course', 'title', 'description'],
  };
  return allowed[flow].includes(slot) ? slot : null;
}

async function opportunisticExtras(
  ctx: TurnContext,
  session: AgentSession,
  message: string,
  awaiting: string | null
): Promise<void> {
  const slots = session.slots as Record<string, unknown>;
  const flow = session.flow;
  if (flow === 'create_course') {
    if (awaiting !== 'price' && slots.price === undefined) {
      const price = parsePriceWithContext(message);
      if (price !== null && price <= 100_000) slots.price = price;
    }
    if (awaiting !== 'grade' && slots.grade === undefined) {
      const grade = matchGrade(message, await getGrades(ctx));
      if (grade) slots.grade = grade;
    }
  }
  if (flow === 'add_lecture') applyLectureOptions(slots, message);
}

async function applyValue(
  ctx: TurnContext,
  session: AgentSession,
  slot: string,
  input: { text?: string; choice?: string; uploadId?: string; skip?: boolean }
): Promise<string | null> {
  const flow = session.flow as FlowId;
  const slots = session.slots as Record<string, unknown>;
  if (flow === 'update_course' && !slots.changes) slots.changes = {};
  const changes = (slots.changes ?? {}) as Record<string, unknown>;
  const useChanges =
    flow === 'update_course' && ['price', 'title', 'grade', 'description', 'publish', 'thumbnail'].includes(slot);
  const target = useChanges ? changes : slots;
  if (input.choice === '__skip') {
    input = { skip: true };
  }
  const text = input.text !== undefined ? cleanText(input.text, 600) : input.choice !== undefined ? cleanText(input.choice, 200) : '';

  switch (slot) {
    case 'title': {
      const limit = flow === 'add_homework' ? 150 : 120;
      const value = cleanText(text, limit);
      if (value.length < 3) return 'الاسم لازم يكون ٣ حروف على الأقل.';
      target.title = value;
      delete slots.duplicateAck;
      session.awaiting = null;
      return null;
    }
    case 'grade': {
      const grades = await getGrades(ctx);
      const grade = grades.includes(text) ? text : matchGrade(text, grades);
      if (!grade) return `مقدرتش أحدد الصف من «${text.slice(0, 40)}». اختار من القائمة.`;
      target.grade = grade;
      session.awaiting = null;
      return null;
    }
    case 'price': {
      const price = parsePrice(text);
      if (price === null) return 'مقدرتش أفهم السعر. اكتبه كرقم بالجنيه (مثلًا 500) أو اكتب 0 لو الكورس مجاني.';
      if (price < 0 || price > 100_000) return 'السعر لازم يكون بين 0 و100000 جنيه.';
      target.price = price;
      session.awaiting = null;
      return null;
    }
    case 'description': {
      if (input.skip) {
        delete target.description;
      } else {
        const value = cleanText(text, 1000);
        if (!value) return 'اكتب الوصف أو اضغط تخطي.';
        target.description = value;
      }
      session.awaiting = null;
      return null;
    }
    case 'publish': {
      const value = text === 'published' || text === 'draft' ? text : /مسوده|draft/.test(normalizeArabic(text)) ? 'draft' : /نشر|انشر/.test(normalizeArabic(text)) ? 'published' : null;
      if (!value) return 'اختار: نشر الآن أو حفظ كمسودة.';
      if (flow === 'update_course') changes.publish = value;
      else slots.publish = value === 'published';
      session.awaiting = null;
      return null;
    }
    case 'thumbnail': {
      if (input.skip) {
        slots.thumbnailSkipped = true;
        delete target.thumbnailUploadId;
        session.awaiting = null;
        return null;
      }
      if (input.uploadId) {
        const ok = await ctx.deps.stagedImageExists(input.uploadId);
        if (!ok) return 'لم أجد الصورة المرفوعة. ارفعها مرة تانية من فضلك.';
        target.thumbnailUploadId = input.uploadId;
        delete slots.thumbnailSkipped;
        session.awaiting = null;
        return null;
      }
      if (isSkipCommand(text)) {
        slots.thumbnailSkipped = true;
        session.awaiting = null;
        return null;
      }
      return 'ارفع الصورة من زر المرفقات، أو اكتب «تخطي» وتضيفها بعدين.';
    }
    case 'course': {
      const courses = await getCourses(ctx);
      if (input.choice) {
        const byId = courses.find((c) => c.id === input.choice);
        if (byId) {
          slots.courseId = byId.id;
          slots.courseTitle = byId.title;
          session.awaiting = null;
          return null;
        }
      }
      const matches = matchCourses(text, courses);
      if (matches.length === 1 || (matches.length > 1 && matches[0].score - matches[1].score >= 0.25)) {
        slots.courseId = matches[0].id;
        slots.courseTitle = matches[0].title;
        session.awaiting = null;
        return null;
      }
      if (matches.length > 1) {
        slots.courseCandidates = matches.slice(0, MAX_CHIPS).map((m) => m.id);
        return 'لقيت أكتر من كورس قريب من كلامك. اختار الكورس المقصود:';
      }
      slots.courseMissing = text.slice(0, 120);
      return `مالقيتش كورس بالاسم «${text.slice(0, 60)}».`;
    }
    case 'lectures':
    case 'lecture_title':
    case 'lecture_url': {
      // Raw text keeps line breaks: each line is one "title - link" lecture.
      return applyLectureInput(slots, session, slot, (input.text ?? input.choice ?? '').trim().slice(0, 3000));
    }
    case 'lectures_options': {
      session.awaiting = null;
      return null;
    }
    case 'duplicate': {
      if (text === 'continue') slots.duplicateAck = true;
      else if (text === 'rename') {
        delete slots.duplicateAck;
        session.awaiting = flow === 'create_course' ? 'title' : 'lectures';
        if (flow === 'add_lecture') slots.lectures = [];
        return null;
      } else return 'اختار: أكمّل رغم التشابه، أو غيّر الاسم.';
      session.awaiting = null;
      return null;
    }
    case 'change_pick': {
      const known = UPDATE_FIELDS.find((field) => field.value === text);
      if (!known) return 'اختار الحاجة اللي عايز تعدلها من القائمة.';
      session.awaiting = known.value;
      return null;
    }
    default:
      return null;
  }
}

function applyLectureInput(
  slots: Record<string, unknown>,
  session: AgentSession,
  slot: string,
  text: string
): string | null {
  const lectures = (Array.isArray(slots.lectures) ? slots.lectures : []) as LectureSlot[];

  if (slot === 'lecture_title') {
    const missingIndex = lectures.findIndex((lecture) => !lecture.title);
    const value = cleanText(text, 150);
    if (value.length < 2) return 'عنوان المحاضرة لازم يكون حرفين على الأقل.';
    if (missingIndex >= 0) lectures[missingIndex].title = value;
    slots.lectures = lectures;
    session.awaiting = null;
    return null;
  }

  if (slot === 'lecture_url') {
    const pendingTitle = typeof slots.pendingTitle === 'string' ? slots.pendingTitle : '';
    const parsed = parseLectureLines(text);
    const direct = parseYouTubeUrl(text.trim());
    if (direct.valid && pendingTitle) {
      lectures.push({ title: pendingTitle, url: direct.url as string });
      delete slots.pendingTitle;
    } else if (parsed.lectures.length) {
      for (const lecture of parsed.lectures) lectures.push({ title: lecture.title || pendingTitle, url: lecture.url });
      delete slots.pendingTitle;
    } else {
      return youtubeHint();
    }
    slots.lectures = lectures;
    session.awaiting = null;
    return null;
  }

  // Free text: one or many "title - link" lines.
  const parsed = parseLectureLines(text);
  if (parsed.invalid.length && parsed.lectures.length === 0) {
    return `الرابط ده مش رابط YouTube صالح: ${parsed.invalid[0]}\n${youtubeHint()}`;
  }
  if (parsed.lectures.length) {
    for (const lecture of parsed.lectures) lectures.push(lecture);
    slots.lectures = lectures.slice(0, 20);
    delete slots.pendingTitle;
    session.awaiting = null;
    if (parsed.invalid.length) return `تجاهلت رابط مش YouTube: ${parsed.invalid[0]}`;
    return null;
  }

  // Title only → remember it and ask for the link next.
  const title = cleanText(text, 150);
  if (title.length >= 2 && !/https?:\/\//i.test(title)) {
    slots.pendingTitle = title;
    session.awaiting = 'lecture_url';
    return null;
  }
  return youtubeHint();
}

function youtubeHint(): string {
  return 'ابعت رابط YouTube صحيح (youtu.be أو youtube.com/watch أو shorts). ولو الفيديو Unlisted اتأكد إن الرابط مفتوح للمشاهدة بالرابط.';
}

// ── Asking the next question / building the confirmation ──────────────────────

async function advance(
  ctx: TurnContext,
  session: AgentSession,
  isStart: boolean
): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  const flow = session.flow as FlowId;
  const slots = session.slots as Record<string, unknown>;

  // An explicit awaiting slot (edit request / unresolved question) always wins.
  if (session.awaiting) {
    const asked = await askSlot(ctx, session, session.awaiting);
    if (asked) return asked;
    session.awaiting = null;
  }

  const lead = isStart ? startLine(flow, slots) : '';

  switch (flow) {
    case 'create_course':
      return withLead(lead, await nextCreateCourse(ctx, session));
    case 'add_lecture':
      return withLead(lead, await nextAddLecture(ctx, session));
    case 'update_course':
      return withLead(lead, await nextUpdateCourse(ctx, session));
    case 'add_homework':
      return withLead(lead, await nextAddHomework(ctx, session));
  }
}

function withLead(lead: string, outcome: Omit<AgentTurnResult, 'conversationId'>) {
  return lead ? { ...outcome, reply: `${lead}\n${outcome.reply}` } : outcome;
}

function startLine(flow: FlowId, slots: Record<string, unknown>): string {
  const known = Object.keys(slots).filter((key) => !['changes', 'invalidUrl'].includes(key) && slots[key] !== undefined);
  if (known.length === 0) return flow === 'create_course' ? 'تمام.' : '';
  return 'تمام، سجّلت اللي قلته.';
}

async function askSlot(
  ctx: TurnContext,
  session: AgentSession,
  slot: string
): Promise<Omit<AgentTurnResult, 'conversationId'> | null> {
  const flow = session.flow as FlowId;
  const slots = session.slots as Record<string, unknown>;

  switch (slot) {
    case 'title':
      return reply(flow === 'add_homework' ? 'عنوان الواجب إيه؟' : flow === 'update_course' ? 'تحب الاسم الجديد للكورس يبقى إيه؟' : 'اسم الكورس إيه؟', [], flow);
    case 'grade': {
      const grades = await getGrades(ctx);
      return reply(flow === 'update_course' ? 'الصف الجديد إيه؟' : 'الكورس موجّه لأنهي صف؟', [gradeChips(grades)], flow);
    }
    case 'price':
      return reply(flow === 'update_course' ? 'السعر الجديد كام (بالجنيه)؟' : 'سعر الكورس كام (بالجنيه)؟ اكتب 0 لو مجاني.', [], flow);
    case 'description':
      return reply('اكتب وصف الكورس، أو اضغط «تخطي».', [{ kind: 'chips', slot: 'description', options: [{ label: 'تخطي', value: '__skip' }] }], flow);
    case 'publish':
      return reply('تحب تنشر الكورس دلوقتي ولا تحفظه كمسودة؟', [{ kind: 'chips', slot: 'publish', options: PUBLISH_CHIPS }], flow);
    case 'thumbnail':
      return reply('ابعت الصورة المصغرة للكورس (يفضّل 16:9)، أو اضغط «تخطي» وتضيفها بعدين.', [
        { kind: 'upload', slot: 'thumbnail', skippable: true, accept: THUMBNAIL_ACCEPT, maxBytes: THUMBNAIL_MAX_BYTES },
      ], flow);
    case 'course': {
      const courses = await getCourses(ctx);
      const candidates = Array.isArray(slots.courseCandidates)
        ? courses.filter((c) => (slots.courseCandidates as string[]).includes(c.id))
        : courses;
      delete slots.courseCandidates;
      if (courses.length === 0) {
        return reply('مفيش كورسات متسجلة لسه. تحب أنشئ كورس جديد الأول؟', [
          { kind: 'chips', slot: '__start', options: [{ label: 'إضافة كورس جديد', value: 'create_course' }] },
        ], flow);
      }
      const missing = typeof slots.courseMissing === 'string' ? slots.courseMissing : '';
      delete slots.courseMissing;
      const chips: AgentUi[] = [courseChips(candidates.length ? candidates : courses)];
      if (missing) {
        chips.push({ kind: 'chips', slot: '__start', options: [{ label: 'إنشاء كورس جديد بهذا الاسم', value: `create_course:${missing}` }] });
      }
      return reply('على أنهي كورس؟ اختار من القائمة أو اكتب اسمه.', chips, flow);
    }
    case 'lectures':
      return reply('ابعت عنوان المحاضرة ورابط YouTube. ولو عندك أكتر من محاضرة ابعتهم كل واحدة في سطر (العنوان - الرابط).', [], flow);
    case 'lecture_title':
      return reply('عنوان المحاضرة إيه؟', [], flow);
    case 'lecture_url': {
      const pendingTitle = typeof slots.pendingTitle === 'string' ? slots.pendingTitle : '';
      return reply(`تمام. ابعت رابط YouTube للمحاضرة${pendingTitle ? ` «${pendingTitle}»` : ''}.`, [], flow);
    }
    case 'change_pick':
      return reply('إيه اللي عايز تعدله في الكورس؟', [{ kind: 'chips', slot: 'change_pick', options: UPDATE_FIELDS }], flow);
    default:
      return null;
  }
}

async function nextCreateCourse(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  if (!slots.title) return forceAsk(ctx, session, 'title');
  if (!slots.grade) return forceAsk(ctx, session, 'grade');
  if (typeof slots.price !== 'number') return forceAsk(ctx, session, 'price');
  if (!slots.thumbnailUploadId && !slots.thumbnailSkipped) return forceAsk(ctx, session, 'thumbnail');

  if (!slots.duplicateAck) {
    const courses = await getCourses(ctx);
    const clash = courses.find((course) => isSameTitle(course.title, String(slots.title)));
    if (clash) {
      session.awaiting = 'duplicate';
      return reply(`فيه كورس بنفس الاسم «${clash.title}» موجود بالفعل. أكمّل ولا أغيّر الاسم؟`, [
        { kind: 'chips', slot: 'duplicate', options: [{ label: 'أكمّل رغم التشابه', value: 'continue' }, { label: 'غيّر الاسم', value: 'rename' }] },
      ], 'create_course');
    }
  }

  const publish = slots.publish !== false;
  const rows: AgentConfirmRow[] = [
    { label: 'اسم الكورس', value: String(slots.title) },
    { label: 'الصف', value: String(slots.grade) },
    { label: 'السعر', value: formatPrice(Number(slots.price)) },
    { label: 'الصورة المصغرة', value: slots.thumbnailUploadId ? 'مرفقة' : 'بدون صورة (تضيفها لاحقًا)' },
    ...(slots.description ? [{ label: 'الوصف', value: String(slots.description) }] : []),
    { label: 'الحالة', value: publishLabel(publish) },
  ];
  const editable: AgentChipOption[] = [
    { label: 'الاسم', value: 'title' },
    { label: 'الصف', value: 'grade' },
    { label: 'السعر', value: 'price' },
    { label: 'الصورة', value: 'thumbnail' },
    { label: 'الوصف', value: 'description' },
    { label: 'النشر', value: 'publish' },
  ];

  return buildConfirmation(ctx, session, {
    title: 'مراجعة الكورس الجديد',
    rows,
    editable,
    steps: [
      {
        tool: 'create_course',
        parameters: {
          title: String(slots.title),
          grade: String(slots.grade),
          price: Number(slots.price),
          publish,
          ...(slots.description ? { description: String(slots.description) } : {}),
          ...(slots.thumbnailUploadId ? { thumbnailUploadId: String(slots.thumbnailUploadId) } : {}),
        },
      },
    ],
  });
}

async function nextAddLecture(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  if (!slots.courseId) return forceAsk(ctx, session, 'course');

  const lectures = (Array.isArray(slots.lectures) ? slots.lectures : []) as LectureSlot[];
  if (typeof slots.invalidUrl === 'string' && lectures.length === 0) {
    const bad = slots.invalidUrl;
    delete slots.invalidUrl;
    session.awaiting = 'lectures';
    return reply(`الرابط ده مش رابط YouTube صالح: ${bad}\n${youtubeHint()}`, [], 'add_lecture');
  }
  delete slots.invalidUrl;
  if (lectures.length === 0) {
    if (typeof slots.pendingTitle === 'string') return forceAsk(ctx, session, 'lecture_url');
    return forceAsk(ctx, session, 'lectures');
  }
  if (lectures.some((lecture) => !lecture.title)) return forceAsk(ctx, session, 'lecture_title');

  if (!slots.duplicateAck) {
    const existing = await ctx.deps.readTools.listLectureTitles(String(slots.courseId));
    const clash = lectures.find((lecture) => existing.some((title) => isSameTitle(title, lecture.title)));
    if (clash) {
      session.awaiting = 'duplicate';
      return reply(`فيه محاضرة بنفس العنوان «${clash.title}» في الكورس ده. أكمّل ولا أغيّر العنوان؟`, [
        { kind: 'chips', slot: 'duplicate', options: [{ label: 'أكمّل رغم التشابه', value: 'continue' }, { label: 'غيّر العنوان', value: 'rename' }] },
      ], 'add_lecture');
    }
  }

  const publish = slots.publish !== false;
  const rows: AgentConfirmRow[] = [
    { label: 'الكورس', value: String(slots.courseTitle ?? '') },
    ...lectures.map((lecture, index) => ({
      label: lectures.length > 1 ? `محاضرة ${index + 1}` : 'المحاضرة',
      value: `${lecture.title}\n${lecture.url}`,
    })),
    ...(typeof slots.durationSeconds === 'number'
      ? [{ label: 'المدة', value: `${Math.round(Number(slots.durationSeconds) / 60)} دقيقة` }]
      : []),
    ...(typeof slots.maxViews === 'number'
      ? [{ label: 'حد المشاهدات', value: Number(slots.maxViews) === 0 ? 'غير محدود' : String(slots.maxViews) }]
      : [{ label: 'حد المشاهدات', value: 'غير محدود (الافتراضي)' }]),
    { label: 'الحالة', value: publishLabel(publish) },
  ];

  const lead = slots.prereqNote
    ? 'ملحوظة: ربط المحاضرة باختبار سابق بيتم حاليًا من صفحة المحاضرات، فمش هيتضمن في العملية دي.'
    : '';
  delete slots.prereqNote;

  const result = await buildConfirmation(ctx, session, {
    title: lectures.length > 1 ? `مراجعة ${lectures.length} محاضرات` : 'مراجعة المحاضرة الجديدة',
    rows,
    editable: [
      { label: 'الكورس', value: 'course' },
      { label: 'العناوين والروابط', value: 'lectures' },
      { label: 'النشر', value: 'publish' },
    ],
    steps: lectures.map((lecture) => ({
      tool: 'add_lecture',
      parameters: {
        courseId: String(slots.courseId),
        title: lecture.title,
        youtubeUrl: lecture.url,
        publish,
        ...(typeof slots.durationSeconds === 'number' ? { duration: Number(slots.durationSeconds) } : {}),
        ...(typeof slots.maxViews === 'number' ? { maxViews: Number(slots.maxViews) } : {}),
      },
    })),
  });
  return lead ? { ...result, reply: `${lead}\n${result.reply}` } : result;
}

async function nextUpdateCourse(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  if (!slots.courseId) return forceAsk(ctx, session, 'course');
  const changes = (slots.changes ?? {}) as Record<string, unknown>;
  if (Object.keys(changes).length === 0) {
    const pending = typeof slots.pendingField === 'string' ? slots.pendingField : '';
    delete slots.pendingField;
    if (pending && UPDATE_FIELDS.some((field) => field.value === pending)) return forceAsk(ctx, session, pending);
    return forceAsk(ctx, session, 'change_pick');
  }

  const courses = await getCourses(ctx);
  const current = courses.find((course) => course.id === slots.courseId) as
    | (CourseRef & { status?: string; price?: number; description?: string })
    | undefined;
  if (!current) {
    session.flow = null;
    return reply('الكورس ده مبقاش موجود. ابدأ من جديد من فضلك.');
  }

  const rows: AgentConfirmRow[] = [{ label: 'الكورس', value: current.title }];
  const steps: Array<{ tool: string; parameters: Record<string, unknown> }> = [];

  if (typeof changes.price === 'number') {
    rows.push({ label: 'السعر', value: formatPrice(changes.price), previous: current.price !== undefined ? formatPrice(Number(current.price)) : undefined });
    steps.push({ tool: 'update_course_price', parameters: { courseId: current.id, price: changes.price } });
  }
  if (changes.title || changes.grade || changes.description) {
    if (changes.title) rows.push({ label: 'الاسم', value: String(changes.title), previous: current.title });
    if (changes.grade) rows.push({ label: 'الصف', value: String(changes.grade), previous: current.grade });
    if (changes.description) rows.push({ label: 'الوصف', value: String(changes.description) });
    steps.push({
      tool: 'update_course',
      parameters: {
        courseId: current.id,
        ...(changes.title ? { title: String(changes.title) } : {}),
        ...(changes.grade ? { grade: String(changes.grade) } : {}),
        ...(changes.description ? { description: String(changes.description) } : {}),
      },
    });
  }
  if (changes.publish === 'published' || changes.publish === 'draft') {
    const target = changes.publish === 'published';
    rows.push({
      label: 'الحالة',
      value: target ? 'منشور' : 'مسودة (إخفاء عن الطلاب)',
      previous: current.status === 'published' ? 'منشور' : 'مسودة',
    });
    steps.push({ tool: target ? 'publish_course' : 'unpublish_course', parameters: { courseId: current.id } });
  }
  if (typeof changes.thumbnailUploadId === 'string') {
    rows.push({ label: 'الصورة المصغرة', value: 'صورة جديدة (تستبدل الحالية)' });
    steps.push({
      tool: 'attach_course_thumbnail',
      parameters: { courseId: current.id, thumbnailUploadId: changes.thumbnailUploadId },
    });
  }
  if (steps.length === 0) return forceAsk(ctx, session, 'change_pick');

  return buildConfirmation(ctx, session, {
    title: 'مراجعة التعديلات',
    rows,
    editable: UPDATE_FIELDS,
    steps,
  });
}

async function nextAddHomework(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  if (!slots.courseId) return forceAsk(ctx, session, 'course');
  if (!slots.title) return forceAsk(ctx, session, 'title');

  const rows: AgentConfirmRow[] = [
    { label: 'الكورس', value: String(slots.courseTitle ?? '') },
    { label: 'عنوان الواجب', value: String(slots.title) },
    ...(slots.description ? [{ label: 'الوصف', value: String(slots.description) }] : []),
    { label: 'الحالة', value: 'مسودة (تنشرها بعد إضافة الأسئلة/الملف)' },
  ];
  return buildConfirmation(ctx, session, {
    title: 'مراجعة الواجب الجديد',
    rows,
    editable: [
      { label: 'الكورس', value: 'course' },
      { label: 'العنوان', value: 'title' },
      { label: 'الوصف', value: 'description' },
    ],
    steps: [
      {
        tool: 'create_assignment',
        parameters: {
          courseId: String(slots.courseId),
          title: String(slots.title),
          ...(slots.description ? { description: String(slots.description) } : {}),
        },
      },
    ],
  });
}

async function forceAsk(ctx: TurnContext, session: AgentSession, slot: string) {
  session.awaiting = slot;
  const asked = await askSlot(ctx, session, slot);
  return asked ?? reply('محتاج منك تفاصيل زيادة.', [], session.flow);
}

interface ConfirmationSpec {
  title: string;
  rows: AgentConfirmRow[];
  editable: AgentChipOption[];
  steps: Array<{ tool: string; parameters: Record<string, unknown> }>;
}

async function buildConfirmation(ctx: TurnContext, session: AgentSession, spec: ConfirmationSpec) {
  await cancelPending(ctx, session);
  session.awaiting = null;

  const single = spec.steps.length === 1;
  const actionType = single ? spec.steps[0].tool : 'compound_plan';
  const payload: Record<string, unknown> = single ? spec.steps[0].parameters : { steps: spec.steps };

  const preview: ConfirmationPreview = {
    actionType,
    title: spec.title,
    titleAr: spec.title,
    description: spec.title,
    descriptionAr: spec.rows.map((row) => `${row.label}: ${row.value}`).join(' | ').slice(0, 500),
    riskLevel: spec.steps.some((step) => step.tool === 'update_course_price' || step.tool === 'unpublish_course') ? 'high' : 'medium',
    requiresConfirmation: true,
    items: [],
    metadata: { rows: spec.rows },
  };

  const { token } = await ctx.deps.createConfirmation({ actionType, payload, preview });
  session.pendingToken = token;

  return reply(
    'راجع التفاصيل دي وأكّد لو كل حاجة تمام:',
    [{ kind: 'confirm', token, title: spec.title, rows: spec.rows, editable: spec.editable }],
    session.flow
  );
}

async function rebuildConfirmation(ctx: TurnContext, session: AgentSession) {
  session.pendingToken = null;
  session.awaiting = null;
  return advance(ctx, session, false);
}

// ── Info questions ────────────────────────────────────────────────────────────

async function answerInfo(
  ctx: TurnContext,
  session: AgentSession,
  info: { metric: string; needsCourse?: boolean },
  knownCourse?: CourseRef
): Promise<Omit<AgentTurnResult, 'conversationId'> | null> {
  const { readTools } = ctx.deps;
  try {
    switch (info.metric) {
      case 'students': {
        const { total } = await readTools.stats('students');
        return reply(`عدد الطلاب المسجّلين حاليًا: ${total.toLocaleString('en-US')} طالب.`, [], session.flow);
      }
      case 'active_enrollments': {
        const { total } = await readTools.stats('active_enrollments');
        return reply(`الاشتراكات المفعّلة حاليًا: ${total.toLocaleString('en-US')}.`, [], session.flow);
      }
      case 'pending_enrollments': {
        const { total } = await readTools.stats('pending_enrollments');
        return reply(
          total === 0 ? 'مفيش طلبات اشتراك معلّقة دلوقتي.' : `طلبات الاشتراك المعلّقة بانتظار مراجعتك: ${total.toLocaleString('en-US')}.`,
          [],
          session.flow
        );
      }
      case 'published_courses': {
        const stats = await readTools.stats('published_courses');
        if (stats.total === 0) return reply('مفيش كورسات منشورة حاليًا.', [], session.flow);
        const lines = (stats.courses ?? []).slice(0, 15).map((course, index) => `${index + 1}. ${course.title}${course.grade ? ` (${course.grade})` : ''}`);
        return reply(`الكورسات المنشورة (${stats.total}):\n${lines.join('\n')}`, [], session.flow);
      }
      case 'course_lecture_count': {
        let course = knownCourse;
        if (!course) {
          const courses = await getCourses(ctx);
          const matches = matchCourses(ctx.message, courses);
          if (matches.length === 1 || (matches.length > 1 && matches[0].score - matches[1].score >= 0.25)) {
            course = matches[0];
          } else {
            session.awaiting = 'info_course';
            return reply('تقصد أنهي كورس؟', [courseChips(matches.length ? matches : courses, 'info_course')], session.flow);
          }
        }
        const { total } = await readTools.stats('course_lecture_count', course.id);
        return reply(`كورس «${course.title}» فيه ${total.toLocaleString('en-US')} محاضرة.`, [], session.flow);
      }
      default:
        return null;
    }
  } catch (error) {
    if ((error as { code?: string })?.code === 'FORBIDDEN') {
      return reply('مش معاك صلاحية الاطلاع على البيانات دي.', [], session.flow);
    }
    return reply('مقدرتش أجيب الرقم ده دلوقتي. جرّب تاني بعد شوية.', [], session.flow);
  }
}

// ── After the teacher pressed «تأكيد» ─────────────────────────────────────────

interface ToolResultLike {
  toolName?: string;
  result?: Record<string, unknown>;
}

function collectResults(raw: unknown): ToolResultLike[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw as Record<string, unknown>;
  if (Array.isArray(data.steps)) {
    return (data.steps as Array<{ tool?: string; result?: ToolResultLike }>).map((step) => ({
      toolName: step.tool ?? step.result?.toolName,
      result: (step.result?.result as Record<string, unknown> | undefined) ?? undefined,
    }));
  }
  return [{ toolName: data.toolName as string | undefined, result: data.result as Record<string, unknown> | undefined }];
}

async function handleExecuted(
  ctx: TurnContext,
  session: AgentSession,
  token: string
): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  const record = await ctx.deps.loadConfirmation(token);
  if (!record) {
    return reply('مقدرتش أتأكد من نتيجة العملية. افتح لوحة الإدارة وراجع التغييرات.', [
      { kind: 'error', message: 'تعذر التحقق من نتيجة العملية.', retry: false },
    ]);
  }

  if (record.state !== 'succeeded') {
    session.pendingToken = null;
    const message = record.errorMessage ? `فشل التنفيذ: ${record.errorMessage}`.slice(0, 220) : 'فشل تنفيذ العملية.';
    return reply('معرفتش أكمل العملية. بياناتك محفوظة وتقدر تحاول تاني.', [
      { kind: 'error', message, retry: true },
    ], session.flow);
  }

  const flow = session.flow;
  const results = collectResults(record.result);
  const lines: string[] = [];
  let link: { href: string; label: string } | undefined;
  let title = 'تم التنفيذ بنجاح';

  const course = results.map((r) => r.result?.course as { id?: string; title?: string } | undefined).find((c) => c?.id);
  const thumbnail = results.map((r) => r.result?.thumbnail as { attached?: boolean; error?: string } | undefined).find(Boolean);

  if (flow === 'create_course' && course?.id) {
    title = `تم إنشاء الكورس «${String(session.slots.title ?? course.title ?? '')}»`;
    lines.push('الكورس اتسجّل في المنصة.');
    if (thumbnail && !thumbnail.attached) lines.push(`الصورة المصغرة لم تُحفظ: ${thumbnail.error ?? 'خطأ غير معروف'}. تقدر ترفعها بعدين.`);
    link = { href: `/admin/courses?focus=${encodeURIComponent(course.id)}`, label: 'فتح الكورس' };
  } else if (flow === 'add_lecture') {
    const count = results.filter((r) => r.toolName === 'add_lecture').length || 1;
    title = count > 1 ? `تمت إضافة ${count} محاضرات` : 'تمت إضافة المحاضرة';
    lines.push(`الكورس: ${String(session.slots.courseTitle ?? '')}`);
    link = { href: `/admin/lectures?courseId=${encodeURIComponent(String(session.slots.courseId ?? ''))}`, label: 'فتح المحاضرات' };
  } else if (flow === 'update_course') {
    title = 'تم تعديل الكورس';
    lines.push(`الكورس: ${String(session.slots.courseTitle ?? '')}`);
    link = { href: `/admin/courses?focus=${encodeURIComponent(String(session.slots.courseId ?? ''))}`, label: 'فتح الكورس' };
  } else if (flow === 'add_homework') {
    title = 'تمت إضافة الواجب كمسودة';
    lines.push('تقدر تضيف الأسئلة أو الملف وتنشره من صفحة الواجبات.');
    link = { href: `/admin/assignments?courseId=${encodeURIComponent(String(session.slots.courseId ?? ''))}`, label: 'فتح الواجبات' };
  }

  session.flow = null;
  session.slots = {};
  session.awaiting = null;
  session.pendingToken = null;

  return reply(`${title} ✅\nتحب أساعدك في حاجة تانية؟`, [{ kind: 'success', title, lines, link }]);
}
