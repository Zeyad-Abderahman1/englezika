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
  parseDurationMinutes,
  parseLectureLines,
  parsePassingScore,
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
import type { ExtractionSummary } from './exam-extraction-store';
import {
  DELETE_KINDS,
  DELETE_TOOL_BY_KIND,
  hasDependents,
  impactRows,
  KIND_LABEL,
  type DeleteCandidate,
  type DeleteImpact,
  type DeleteKind,
} from './delete-impact';
import {
  CAPABILITIES_MESSAGE,
  classifyRequest,
  detectTargetKind,
  extractDeleteQuery,
  hasDeleteVerb,
  hasSwitchCue,
  type Classified,
} from './intent';

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
    /** Shorter lifetime for risky confirmations (deleting). */
    expiresInMs?: number;
  }): Promise<PendingConfirmation>;
  /** Read-only helpers of the delete flow (search + impact counts). They never delete. */
  deleteTools: {
    find(kind: DeleteKind, query: string): Promise<DeleteCandidate[]>;
    impact(kind: DeleteKind, id: string): Promise<DeleteImpact | null>;
  };
  supersedeConfirmation(token: string): Promise<void>;
  loadConfirmation(token: string): Promise<ExecutedConfirmation | null>;
  stagedImageExists(uploadId: string): Promise<boolean>;
  /** Server-side state of "exam from photos" extractions (windows are extracted by the browser). */
  examExtraction: {
    create(conversationId: string, pages: string[]): Promise<{ id: string; windowCount: number }>;
    summary(
      extractionId: string
    ): Promise<{ summary: ExtractionSummary; pageCount: number; windowCount: number } | null>;
  };
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

  const classified = classifyRequest(message);
  if (classified.type === 'delete') return 'delete_item';
  if (classified.type === 'add') return classified.flow;
  if (classified.type === 'edit') return classified.unsupported ? null : 'update_course';

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
  await deps.persist.ensureConversation(conversationId, message ? message.replace(/s+/g, ' ').slice(0, 40) : 'محادثة جديدة');
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
  if (event?.type === 'choice' && event.slot === 'del_mode' && event.value === 'cancel') {
    return cancelFlow(ctx, session);
  }
  if (event?.type === 'start_flow') {
    await cancelPending(ctx, session);
    resetFlow(session, event.flow);
    return advance(ctx, session, true);
  }

  // Exam-paper photos (staged by the browser). They start (or feed) the exam-from-photos flow.
  if (event?.type === 'pages') return handlePages(ctx, session, event.uploadIds);
  if (event?.type === 'extraction_done') return handleExtractionDone(ctx, session, event.extractionId);
  if (event?.type === 'choice' && session.flow === 'create_exam_from_images') {
    const special = await handleExamChoice(ctx, session, event.slot, event.value);
    if (special) return special;
  }

  if (event?.type === 'choice' && event.slot === '__start') {
    const [flowId, ...rest] = event.value.split(':');
    if (isFlowId(flowId)) {
      await cancelPending(ctx, session);
      resetFlow(session, flowId);
      const prefill = rest.join(':').trim();
      if (prefill && flowId === 'create_course') session.slots.title = cleanText(prefill, 120);
      if (prefill && flowId === 'delete_item' && (DELETE_KINDS as string[]).includes(prefill)) session.slots.kind = prefill;
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

    const classified = classifyRequest(message);
    const handledRequest = await handleClassified(ctx, session, classified, null);
    if (handledRequest) return handledRequest;

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
      // The model may only pick a flow whose target noun the teacher actually wrote: it can never
      // turn an unrelated or unsupported request into "create a course".
      if (extraction?.intent && extraction.intent !== 'other' && modelIntentIsGrounded(extraction.intent, message)) {
        intent = extraction.intent;
      }
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

  // Delete flow: while the confirmation card is open, only the card (typed name) can confirm.
  if (message && !event && session.flow === 'delete_item' && session.pendingToken && session.awaiting === null) {
    if (isNoCommand(message)) return cancelFlow(ctx, session);
    const classified = classifyRequest(message);
    if (
      classified.type === 'none' ||
      classified.type === 'ambiguous' ||
      (classified.type === 'delete' && !classified.kind && !classified.bulk && !classified.unsupportedTarget)
    ) {
      return reply(
        'الحذف بيتأكد من البطاقة بس: اكتب اسم العنصر بالضبط في الخانة واضغط «حذف نهائي». لو غيّرت رأيك قول «إلغاء».',
        [],
        session.flow
      );
    }
  }

  // Mid-flow: a clear request for something else switches (or cleanly rejects) instead of being
  // swallowed as an answer for the open question.
  if (message && !event) {
    const switched = await maybeSwitchFlow(ctx, session);
    if (switched) return switched;
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
  return (
    value === 'create_course' ||
    value === 'add_lecture' ||
    value === 'update_course' ||
    value === 'add_homework' ||
    value === 'delete_item'
  );
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

  if (flow === 'delete_item') return applyDeleteInput(ctx, session);

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
    create_exam_from_images: ['title', 'price', 'description', 'thumbnail', 'publish'],
    delete_item: [],
  };
  if (!allowed[flow].includes(slot)) return null;
  return flow === 'create_exam_from_images' && slot === 'publish' ? 'publish_course' : slot;
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
  if (flow === 'create_exam_from_images') applyExamSettingsFromText(slots, message);
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
    case 'duration': {
      const minutes = parseDurationMinutes(text) ?? (/^\d{1,3}$/.test(normalizeArabic(text)) ? Number(normalizeArabic(text)) : null);
      if (minutes === null || minutes < 1 || minutes > 300) return 'اكتب المدة بالدقائق (من 1 إلى 300)، مثلًا 45 دقيقة.';
      slots.durationMinutes = minutes;
      slots.settingsConfirmed = true;
      session.awaiting = 'settings';
      return null;
    }
    case 'passing': {
      const score = parsePassingScore(text) ?? (/^\d{1,3}$/.test(normalizeArabic(text)) ? Number(normalizeArabic(text)) : null);
      if (score === null || score < 0 || score > 100) return 'اكتب نسبة النجاح من 0 إلى 100، مثلًا 60.';
      slots.passingScore = score;
      slots.settingsConfirmed = true;
      session.awaiting = 'settings';
      return null;
    }
    case 'settings': {
      if (text === 'ok') {
        slots.settingsConfirmed = true;
        session.awaiting = null;
        return null;
      }
      if (text === 'edit_duration') {
        session.awaiting = 'duration';
        return null;
      }
      if (text === 'edit_passing') {
        session.awaiting = 'passing';
        return null;
      }
      if (text === 'toggle_review') {
        slots.showReview = slots.showReview === false;
        return null; // stay on the settings question so the new value is shown
      }
      applyExamSettingsFromText(slots, text);
      if (slots.settingsConfirmed) {
        session.awaiting = null;
        return null;
      }
      return 'اختار من الأزرار، أو اكتب المدة (مثل 45 دقيقة) أو نسبة النجاح (مثل نجاح 60).';
    }
    case 'publish_course': {
      if (text !== 'yes' && text !== 'no') return 'اختار: نعم أو لا.';
      slots.publish = text;
      session.awaiting = null;
      return null;
    }
    case 'description': {
      if (input.skip) {
        slots.descriptionSkipped = true;
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
    case 'create_exam_from_images':
      return withLead(lead, await nextCreateExamFromImages(ctx, session));
    case 'delete_item':
      return withLead(lead, await nextDeleteItem(ctx, session));
  }
}

function withLead(lead: string, outcome: Omit<AgentTurnResult, 'conversationId'>) {
  return lead ? { ...outcome, reply: `${lead}\n${outcome.reply}` } : outcome;
}

function startLine(flow: FlowId, slots: Record<string, unknown>): string {
  if (flow === 'delete_item') return '';
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

  if (flow === 'delete_item') return askDeleteSlot(session, slot);

  switch (slot) {
    case 'title':
      if (flow === 'create_exam_from_images') return reply('عنوان الامتحان إيه؟', [], flow);
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
    case 'pages':
      return reply(
        'ابعت صور ورق الامتحان بالترتيب (تقدر تختار أكتر من صورة مرة واحدة من زر المرفقات)، وبعدين اضغط إرسال.',
        [{ kind: 'pages_request', accept: THUMBNAIL_ACCEPT, maxBytesPerPage: 10 * 1024 * 1024 }],
        flow
      );
    case 'settings': {
      const duration = Number(slots.durationMinutes ?? 30);
      const passing = Number(slots.passingScore ?? 70);
      const review = slots.showReview !== false;
      return reply(
        `الإعدادات الحالية: المدة ${duration} دقيقة، نسبة النجاح ${passing}%، مراجعة الإجابات بعد التسليم ${review ? 'مسموحة' : 'غير مسموحة'}. أكمل بيها ولا تعدّل؟`,
        [
          {
            kind: 'chips',
            slot: 'settings',
            options: [
              { label: 'تمام، كمّل', value: 'ok' },
              { label: 'تعديل المدة', value: 'edit_duration' },
              { label: 'تعديل نسبة النجاح', value: 'edit_passing' },
              { label: review ? 'منع المراجعة بعد التسليم' : 'السماح بالمراجعة', value: 'toggle_review' },
            ],
          },
        ],
        flow
      );
    }
    case 'duration':
      return reply('مدة الامتحان كام دقيقة؟', [], flow);
    case 'passing':
      return reply('نسبة النجاح كام في المية؟', [], flow);
    case 'publish_course':
      return reply(
        'تحب تنشر الامتحان ككورس لكل الصفوف (بسعر أو مجانًا) عشان يظهر للطلاب في قائمة الكورسات؟',
        [
          {
            kind: 'chips',
            slot: 'publish_course',
            options: [
              { label: 'نعم، انشره ككورس لكل الصفوف', value: 'yes' },
              { label: 'لا، امتحان عادي فقط', value: 'no' },
            ],
          },
        ],
        flow
      );
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

// ── Exam from photos ─────────────────────────────────────────────────────────

function applyExamSettingsFromText(slots: Record<string, unknown>, message: string): void {
  const minutes = parseDurationMinutes(message);
  if (minutes !== null) {
    slots.durationMinutes = minutes;
    slots.settingsConfirmed = true;
  }
  const passing = parsePassingScore(message);
  if (passing !== null) {
    slots.passingScore = passing;
    slots.settingsConfirmed = true;
  }
  const n = normalizeArabic(message);
  if (/(?:منع|بدون|من غير|مفيش).{0,12}مراجع/.test(n)) {
    slots.showReview = false;
    slots.settingsConfirmed = true;
  }
}

function indices(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

async function handlePages(
  ctx: TurnContext,
  session: AgentSession,
  uploadIds: string[]
): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  for (const uploadId of uploadIds) {
    if (!(await ctx.deps.stagedImageExists(uploadId))) {
      return reply('بعض الصور مش لاقيها (ممكن تكون انتهت صلاحيتها). ارفعها تاني من فضلك.', [], session.flow);
    }
  }

  // Photos always belong to the exam flow. Starting it replaces any other unfinished flow.
  if (session.flow !== 'create_exam_from_images') {
    await cancelPending(ctx, session);
    resetFlow(session, 'create_exam_from_images');
  } else {
    // New photos replace the previous extraction (it was made from other pages).
    const slots = session.slots as Record<string, unknown>;
    delete slots.extractionId;
    delete slots.extractionDone;
    delete slots.partialAck;
    await cancelPending(ctx, session);
  }

  const slots = session.slots as Record<string, unknown>;
  slots.pages = uploadIds;
  session.awaiting = null;

  if (ctx.message) {
    const title = extractAfterKeyword(ctx.message, /(?:اسمه|اسمها|بعنوان|عنوانه)/);
    if (title && cleanText(title, 150).length >= 3) slots.title = cleanText(title, 150);
    applyExamSettingsFromText(slots, ctx.message);
  }

  const lead = `استلمت ${uploadIds.length} صفحة.`;
  return withLead(lead, await advance(ctx, session, false));
}

async function nextCreateExamFromImages(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  const pages = (Array.isArray(slots.pages) ? slots.pages : []) as string[];

  if (pages.length === 0) return forceAsk(ctx, session, 'pages');
  if (!slots.title) return forceAsk(ctx, session, 'title');
  if (!slots.settingsConfirmed) return forceAsk(ctx, session, 'settings');
  if (slots.publish === undefined) return forceAsk(ctx, session, 'publish_course');
  if (slots.publish === 'yes') {
    if (typeof slots.price !== 'number') return forceAsk(ctx, session, 'price');
    if (!slots.description && !slots.descriptionSkipped) return forceAsk(ctx, session, 'description');
    if (!slots.thumbnailUploadId && !slots.thumbnailSkipped) return forceAsk(ctx, session, 'thumbnail');
  }

  // The exam already exists (draft): only the publishing step is left.
  if (typeof slots.examId === 'string') return confirmPublishExam(ctx, session);

  if (!slots.extractionId) {
    const created = await ctx.deps.examExtraction.create(ctx.conversationId, pages);
    slots.extractionId = created.id;
    slots.windowCount = created.windowCount;
    slots.extractionDone = false;
  }
  if (!slots.extractionDone) {
    session.awaiting = 'extracting';
    const windowCount = Number(slots.windowCount ?? 1);
    return reply(
      `تمام، هبدأ أستخرج الأسئلة من ${pages.length} صفحة. ممكن ياخد شوية وقت حسب العدد، وهتشوف التقدم هنا.`,
      [
        {
          kind: 'extract',
          extractionId: String(slots.extractionId),
          windowIndices: indices(windowCount),
          windowCount,
          pageCount: pages.length,
        },
      ],
      session.flow
    );
  }
  return confirmCreateExam(ctx, session);
}

function pageLabelFor(window: { start: number; end: number }): string {
  return window.end - window.start <= 1 ? String(window.start + 1) : `${window.start + 1}–${window.end}`;
}

function buildResultCard(
  extractionId: string,
  info: { summary: ExtractionSummary; pageCount: number }
): AgentUi {
  const { summary } = info;
  return {
    kind: 'extraction_result',
    extractionId,
    questionCount: summary.questions.length,
    pageCount: info.pageCount,
    invalidCount: summary.invalidCount,
    duplicatesRemoved: summary.duplicatesRemoved,
    warnings: summary.warnings.map((warning) => warning.message),
    failedPages: summary.failedWindows.map((failed) => pageLabelFor(failed.window)),
    preview: summary.questions.slice(0, 3).map((question) => ({
      number: question.source_number ?? question.sort_order,
      prompt: question.prompt.slice(0, 160),
      options: question.options.slice(0, 4).map((option) => option.slice(0, 80)),
    })),
    reviewHref: `/admin/exams?extraction=${encodeURIComponent(extractionId)}`,
  };
}

async function handleExtractionDone(
  ctx: TurnContext,
  session: AgentSession,
  extractionId: string
): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  const slots = session.slots as Record<string, unknown>;
  if (session.flow !== 'create_exam_from_images' || slots.extractionId !== extractionId) {
    return reply('الاستخراج ده مش تابع للمحادثة الحالية. ابدأ من جديد من فضلك.');
  }
  const info = await ctx.deps.examExtraction.summary(extractionId);
  if (!info) {
    delete slots.extractionId;
    return reply('انتهت صلاحية الاستخراج. ارفع الصور تاني وهنبدأ من جديد.', [], session.flow);
  }

  slots.extractionDone = true;
  session.awaiting = null;
  const card = buildResultCard(extractionId, info);
  const { summary } = info;
  const unresolved = summary.failedWindows.length + summary.pendingWindows.length;

  if (summary.questions.length === 0) {
    session.awaiting = 'extract_failed';
    return reply('معرفتش أستخرج أي سؤال من الصور.', [
      card,
      {
        kind: 'chips',
        slot: 'extract_failed',
        options: [{ label: 'إعادة المحاولة', value: 'retry' }],
      },
    ], session.flow);
  }

  if (unresolved > 0 && slots.partialAck !== true) {
    session.awaiting = 'extract_failed';
    return reply(
      `استخرجت ${summary.questions.length} سؤال، لكن فشلت صفحات: ${summary.failedWindows.map((f) => pageLabelFor(f.window)).join('، ') || 'بعض الدفعات'}.`,
      [
        card,
        {
          kind: 'chips',
          slot: 'extract_failed',
          options: [
            { label: 'إعادة محاولة الصفحات الفاشلة فقط', value: 'retry' },
            { label: 'متابعة بالأسئلة المستخرجة', value: 'partial' },
          ],
        },
      ],
      session.flow
    );
  }

  const confirm = await confirmCreateExam(ctx, session);
  return {
    ...confirm,
    reply: `استخرجت ${summary.questions.length} سؤال من ${info.pageCount} صفحة.\n${confirm.reply}`,
    ui: [card, ...confirm.ui],
  };
}

async function handleExamChoice(
  ctx: TurnContext,
  session: AgentSession,
  slot: string,
  value: string
): Promise<Omit<AgentTurnResult, 'conversationId'> | null> {
  const slots = session.slots as Record<string, unknown>;

  if (slot === 'extract_failed') {
    if (value === 'partial') {
      slots.partialAck = true;
      session.awaiting = null;
      return advance(ctx, session, false);
    }
    // Retry ONLY the windows that failed (or never ran).
    const info = typeof slots.extractionId === 'string' ? await ctx.deps.examExtraction.summary(slots.extractionId) : null;
    if (!info) return reply('انتهت صلاحية الاستخراج. ارفع الصور تاني.', [], session.flow);
    const pending = [
      ...info.summary.failedWindows.map((failed) => failed.index),
      ...info.summary.pendingWindows,
    ];
    if (pending.length === 0) {
      slots.extractionDone = true;
      return advance(ctx, session, false);
    }
    slots.extractionDone = false;
    session.awaiting = 'extracting';
    return reply(`هعيد محاولة ${pending.length} دفعة من الصفحات الفاشلة فقط.`, [
      {
        kind: 'extract',
        extractionId: String(slots.extractionId),
        windowIndices: pending,
        windowCount: info.windowCount,
        pageCount: info.pageCount,
      },
    ], session.flow);
  }

  if (slot === '__edit' && (value === 'toggle_public' || value === 'toggle_leaderboard')) {
    await cancelPending(ctx, session);
    if (value === 'toggle_public') {
      slots.isPublic = slots.isPublic === false;
      if (slots.isPublic === false) slots.showLeaderboard = false;
    } else {
      slots.showLeaderboard = slots.showLeaderboard === false;
      if (slots.showLeaderboard !== false) slots.isPublic = true;
    }
    session.awaiting = null;
    return advance(ctx, session, false);
  }
  return null;
}

async function confirmCreateExam(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  const extractionId = String(slots.extractionId);
  const info = await ctx.deps.examExtraction.summary(extractionId);
  if (!info) {
    delete slots.extractionId;
    return reply('انتهت صلاحية الاستخراج. ارفع الصور تاني وهنبدأ من جديد.', [], session.flow);
  }
  const { summary } = info;
  const savable = summary.questions.length - summary.invalidCount;
  const unresolved = summary.failedWindows.length + summary.pendingWindows.length;
  const duration = Number(slots.durationMinutes ?? 30);
  const passing = Number(slots.passingScore ?? 70);
  const showReview = slots.showReview !== false;

  const rows: AgentConfirmRow[] = [
    { label: 'عنوان الامتحان', value: String(slots.title) },
    { label: 'النوع', value: 'امتحان عام (غير مرتبط بصف معيّن)' },
    { label: 'عدد الأسئلة', value: String(savable) },
    { label: 'المدة', value: `${duration} دقيقة` },
    { label: 'نسبة النجاح', value: `${passing}%` },
    { label: 'مراجعة الإجابات بعد التسليم', value: showReview ? 'مسموحة' : 'غير مسموحة' },
    { label: 'الحالة', value: 'مسودة (تُنشر لاحقًا)' },
  ];
  if (summary.invalidCount > 0) {
    rows.push({ label: 'أسئلة مستبعدة (بلا إجابة صحيحة)', value: String(summary.invalidCount) });
  }
  if (unresolved > 0) {
    rows.push({ label: 'صفحات لم تُستخرج', value: String(unresolved) + ' دفعة' });
  }
  if (slots.publish === 'yes') {
    rows.push({ label: 'بعد الإنشاء', value: 'هيتعرض عليك تأكيد منفصل لنشره ككورس لكل الصفوف' });
  }

  return buildConfirmation(ctx, session, {
    title: 'مراجعة الامتحان قبل الإنشاء',
    rows,
    editable: [
      { label: 'العنوان', value: 'title' },
      { label: 'المدة والنجاح', value: 'settings' },
      { label: 'نشره ككورس', value: 'publish_course' },
    ],
    steps: [
      {
        tool: 'create_exam_from_extraction',
        parameters: {
          extractionId,
          title: String(slots.title),
          durationMinutes: duration,
          passingScore: passing,
          showReview,
          ...(unresolved > 0 ? { allowPartial: true } : {}),
          ...(summary.invalidCount > 0 ? { skipInvalid: true } : {}),
        },
      },
    ],
  });
}

async function confirmPublishExam(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  const price = Number(slots.price ?? 0);
  const isPublic = slots.isPublic !== false;
  const showLeaderboard = isPublic && slots.showLeaderboard !== false;

  const rows: AgentConfirmRow[] = [
    { label: 'الامتحان', value: String(slots.title) },
    { label: 'الفئة', value: 'كل الصفوف' },
    { label: 'السعر', value: formatPrice(price) },
    ...(slots.description ? [{ label: 'الوصف', value: String(slots.description) }] : []),
    { label: 'الصورة المصغرة', value: slots.thumbnailUploadId ? 'مرفقة' : 'بدون صورة' },
    { label: 'صفحة عامة للامتحان', value: isPublic ? 'مفعّلة' : 'غير مفعّلة' },
    { label: 'لوحة أفضل 10 طلاب', value: showLeaderboard ? 'مفعّلة' : 'غير مفعّلة' },
    { label: 'الحالة بعد التأكيد', value: 'منشور ككورس لكل الصفوف' },
  ];

  return buildConfirmation(ctx, session, {
    title: 'مراجعة نشر الامتحان ككورس',
    rows,
    editable: [
      { label: 'السعر', value: 'price' },
      { label: 'الوصف', value: 'description' },
      { label: 'الصورة', value: 'thumbnail' },
      { label: isPublic ? 'إلغاء الصفحة العامة' : 'تفعيل الصفحة العامة', value: 'toggle_public' },
      { label: showLeaderboard ? 'إخفاء لوحة الأوائل' : 'إظهار لوحة الأوائل', value: 'toggle_leaderboard' },
    ],
    steps: [
      {
        tool: 'publish_exam_as_course',
        parameters: {
          examId: String(slots.examId),
          listingPrice: price,
          isPublic,
          showLeaderboard,
          ...(slots.description ? { listingDescription: String(slots.description) } : {}),
          ...(slots.thumbnailUploadId ? { thumbnailUploadId: String(slots.thumbnailUploadId) } : {}),
        },
      },
    ],
  });
}

async function handleExamExecuted(
  ctx: TurnContext,
  session: AgentSession,
  actionType: string,
  results: ToolResultLike[]
): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  const slots = session.slots as Record<string, unknown>;
  session.pendingToken = null;

  if (actionType === 'create_exam_from_extraction') {
    const exam = results.map((r) => r.result?.exam as { id?: string } | undefined).find((e) => e?.id);
    const detail = results[0]?.result as { questionCount?: number; skipped?: number } | undefined;
    if (!exam?.id) {
      return reply('الامتحان اتنفّذ لكن مقدرتش أقرأ رقمه. افتح صفحة الامتحانات وراجع.', [
        { kind: 'error', message: 'تعذر قراءة نتيجة الإنشاء.', retry: false },
      ]);
    }
    slots.examId = exam.id;

    const lines = [`عدد الأسئلة: ${detail?.questionCount ?? ''}`.trim()];
    if (detail?.skipped) lines.push(`أسئلة مستبعدة بلا إجابة صحيحة: ${detail.skipped}`);
    const success: AgentUi = {
      kind: 'success',
      title: `تم إنشاء الامتحان «${String(slots.title)}» كمسودة`,
      lines,
      link: { href: '/admin/exams', label: 'فتح الامتحانات' },
    };

    if (slots.publish === 'yes') {
      const confirm = await confirmPublishExam(ctx, session);
      return {
        ...confirm,
        reply: 'تم إنشاء الامتحان كمسودة ✅\nدلوقتي راجع نشره ككورس لكل الصفوف وأكّد لو تمام:',
        ui: [success, ...confirm.ui],
      };
    }
    session.flow = null;
    session.slots = {};
    session.awaiting = null;
    return reply('تم إنشاء الامتحان كمسودة ✅\nتحب أساعدك في حاجة تانية؟', [success]);
  }

  // publish_exam_as_course finished
  const listing = results.map((r) => r.result?.listing as { publicSlug?: string; isPublic?: boolean } | undefined).find(Boolean);
  const thumbnail = results.map((r) => r.result?.thumbnail as { attached?: boolean; error?: string } | undefined).find(Boolean);
  const lines = ['الامتحان ظاهر دلوقتي في قائمة الكورسات لكل الصفوف.'];
  if (thumbnail && !thumbnail.attached) lines.push(`الصورة المصغرة لم تُحفظ: ${thumbnail.error ?? 'خطأ غير معروف'}. تقدر ترفعها بعدين.`);
  const link =
    listing?.isPublic && listing.publicSlug
      ? { href: `/exams/${encodeURIComponent(listing.publicSlug)}`, label: 'فتح الصفحة العامة' }
      : { href: '/admin/exams', label: 'فتح الامتحانات' };
  const title = `تم نشر «${String(slots.title)}» ككورس لكل الصفوف`;
  session.flow = null;
  session.slots = {};
  session.awaiting = null;
  return reply(`${title} ✅\nتحب أساعدك في حاجة تانية؟`, [{ kind: 'success', title, lines, link }]);
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
  await cancelPending(ctx, session);
  session.awaiting = null;
  if (session.flow === 'delete_item') return refreshDeleteConfirmation(ctx, session);
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
  if (flow === 'delete_item') return handleDeleteExecuted(session, record.actionType, results);
  if (flow === 'create_exam_from_images') {
    return handleExamExecuted(ctx, session, record.actionType, results);
  }
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

// ── Safe delete flow (one item at a time, typed-name confirmation) ───────────

const KIND_NOUN: Record<DeleteKind, string> = {
  course: 'كورس',
  lecture: 'محاضرة',
  exam: 'امتحان',
  assignment: 'واجب',
};
const KIND_CHIPS: AgentChipOption[] = DELETE_KINDS.map((kind) => ({ label: KIND_NOUN[kind], value: kind }));
const DELETE_ID_KEY: Record<DeleteKind, string> = {
  course: 'courseId',
  lecture: 'videoId',
  exam: 'examId',
  assignment: 'assignmentId',
};
const DELETE_CONFIRM_TTL_MS = 5 * 60 * 1000;

const FLOW_LABEL: Record<FlowId, string> = {
  create_course: 'إضافة الكورس',
  add_lecture: 'إضافة المحاضرة',
  update_course: 'تعديل الكورس',
  add_homework: 'إضافة الواجب',
  create_exam_from_images: 'إنشاء الامتحان من الصور',
  delete_item: 'الحذف',
};

function isDeleteKind(value: unknown): value is DeleteKind {
  return typeof value === 'string' && (DELETE_KINDS as string[]).includes(value);
}

function modelIntentIsGrounded(intent: string, message: string): boolean {
  const kind = detectTargetKind(message);
  if (hasDeleteVerb(message)) return false;
  if (intent === 'create_course') return kind === 'course';
  if (intent === 'add_lecture') return kind === 'lecture' || findYouTubeAnywhere(message);
  if (intent === 'add_homework') return kind === 'assignment';
  return intent === 'update_course' ? kind === 'course' : true;
}

function ambiguityChips(kind: DeleteKind | null): AgentUi {
  const noun = kind ? KIND_NOUN[kind] : 'كورس';
  const add = kind === 'lecture' ? 'add_lecture' : kind === 'assignment' ? 'add_homework' : 'create_course';
  const options: AgentChipOption[] = [{ label: `إضافة ${noun}`, value: add }];
  if (!kind || kind === 'course') options.push({ label: 'تعديل كورس', value: 'update_course' });
  options.push({ label: `حذف ${noun}`, value: `delete_item:${kind ?? 'course'}` });
  return { kind: 'chips', slot: '__start', options };
}

/** Handles delete / unsupported-edit / ambiguous requests. Returns null for "add" and "none". */
async function handleClassified(
  ctx: TurnContext,
  session: AgentSession,
  classified: Classified,
  notice: string | null
): Promise<Omit<AgentTurnResult, 'conversationId'> | null> {
  const lead = (text: string) => (notice ? `${notice}\n${text}` : text);

  if (classified.type === 'delete') {
    if (classified.unsupportedTarget) {
      const everything = /(?:الكل|كل حاجه|كل شيء|قاعده البيانات|الداتا)/.test(classified.unsupportedTarget);
      if (!everything) {
        return reply(lead(`مقدرش أحذف «${classified.unsupportedTarget}» من هنا.\n${CAPABILITIES_MESSAGE}`), [], session.flow);
      }
      classified = { ...classified, bulk: true, unsupportedTarget: undefined };
    }
    if (classified.type === 'delete' && classified.bulk) {
      const kind = classified.kind;
      const noun = kind ? KIND_NOUN[kind] : 'عنصر';
      await cancelPending(ctx, session);
      session.flow = null;
      session.slots = {};
      session.awaiting = null;
      const options: AgentChipOption[] = kind
        ? [{ label: `حذف ${noun} واحد`, value: `delete_item:${kind}` }]
        : KIND_CHIPS.map((chip) => ({ label: `حذف ${chip.label}`, value: `delete_item:${chip.value}` }));
      return reply(
        lead(
          `مبحذفش أكتر من عنصر في المرة الواحدة، علشان الحذف نهائي ومحدش يمسح حاجة بالغلط. نبدأ نحذف ${noun} واحد واحد؟ اختار وأنا أدور عليه وأطلب تأكيدك.`
        ),
        [{ kind: 'chips', slot: '__start', options }],
        null
      );
    }
    if (classified.type === 'delete') {
      await cancelPending(ctx, session);
      resetFlow(session, 'delete_item');
      if (classified.kind) session.slots.kind = classified.kind;
      const query = extractDeleteQuery(ctx.message);
      if (query) session.slots.query = cleanText(query, 80);
      return withLead(notice ?? '', await advance(ctx, session, true));
    }
  }

  if (classified.type === 'edit' && classified.unsupported) {
    return reply(
      lead(`تعديل ${classified.kind ? KIND_NOUN[classified.kind] : 'العنصر'} مش متاح من المساعد دلوقتي.\n${CAPABILITIES_MESSAGE}`),
      [],
      session.flow
    );
  }

  if (classified.type === 'ambiguous' && !session.flow) {
    return reply('تحب تعمل إيه بالضبط؟', [ambiguityChips(classified.kind)], null);
  }

  return null;
}

async function maybeSwitchFlow(
  ctx: TurnContext,
  session: AgentSession
): Promise<Omit<AgentTurnResult, 'conversationId'> | null> {
  const flow = session.flow as FlowId;
  const classified = classifyRequest(ctx.message);
  if (classified.type === 'none' || classified.type === 'ambiguous') return null;

  const cue = hasSwitchCue(ctx.message);
  const awaiting = session.awaiting ?? '';
  const typedAnswer = FREE_TEXT_SLOTS.has(awaiting) || awaiting === 'del_query' || awaiting === 'del_pick';
  const notice = `تمام، وقفت «${FLOW_LABEL[flow]}» ومفيش حاجة اتنفّذت.`;

  if (classified.type === 'delete') {
    // "احذفه" (no item type) inside the delete flow is just an answer, not a new request.
    if (flow === 'delete_item' && !classified.kind && !classified.bulk && !classified.unsupportedTarget) return null;
    // A delete request is never swallowed as a name/title. Inside the delete flow it restarts the search.
    return handleClassified(ctx, session, classified, flow === 'delete_item' ? null : notice);
  }

  if (typedAnswer && !cue) return null;
  // Edit phrases ("غير السعر") belong to the running flow's own edit handling unless the teacher
  // explicitly walks away from it.
  if (classified.type === 'edit' && !classified.unsupported && flow !== 'delete_item' && !cue) return null;

  if (classified.type === 'edit' && classified.unsupported) {
    return handleClassified(ctx, session, classified, null);
  }

  const target: FlowId | null =
    classified.type === 'add' ? classified.flow : classified.type === 'edit' ? 'update_course' : null;
  if (!target || target === flow) return null;

  await cancelPending(ctx, session);
  resetFlow(session, target);
  await prefillFromMessage(ctx, session, ctx.message, null);
  const started = await advance(ctx, session, true);
  return { ...started, reply: `${notice}\n${started.reply}` };
}

function askDeleteSlot(session: AgentSession, slot: string): Omit<AgentTurnResult, 'conversationId'> | null {
  const kind = session.slots.kind;
  if (slot === 'del_kind') {
    return reply('تحب تحذف إيه؟ اختار النوع:', [{ kind: 'chips', slot: 'del_kind', options: KIND_CHIPS }], session.flow);
  }
  if (slot === 'del_query') {
    const noun = isDeleteKind(kind) ? KIND_NOUN[kind] : 'العنصر';
    return reply(`اكتب اسم الـ${noun} اللي عايز تحذفه (أو جزء منه) وأنا أدوّر عليه.`, [], session.flow);
  }
  return null;
}

async function applyDeleteInput(ctx: TurnContext, session: AgentSession): Promise<string | null> {
  const { event, message } = ctx;
  const slots = session.slots as Record<string, unknown>;

  const resetTarget = () => {
    delete slots.targetId;
    delete slots.targetName;
    delete slots.impact;
    delete slots.mode;
    delete slots.candidateIds;
  };

  if (event?.type === 'choice') {
    if (event.slot === 'del_kind') {
      if (!isDeleteKind(event.value)) return 'النوع ده مش مدعوم. اختار من القائمة.';
      slots.kind = event.value;
      delete slots.query;
      resetTarget();
      session.awaiting = null;
      return null;
    }
    if (event.slot === 'del_pick') {
      const ids = Array.isArray(slots.candidateIds) ? (slots.candidateIds as string[]) : [];
      if (!ids.includes(event.value)) return 'الاختيار ده مش من النتائج اللي ظهرت. اختار من القايمة أو اكتب الاسم تاني.';
      resetTarget();
      slots.targetId = event.value; // from here on the target is locked by id, never by name
      session.awaiting = null;
      return null;
    }
    if (event.slot === 'del_mode') {
      if (event.value !== 'hide' && event.value !== 'delete') return 'اختار إخفاء أو حذف أو إلغاء.';
      slots.mode = event.value;
      session.awaiting = null;
      return null;
    }
    return null;
  }
  if (event) return null;
  if (!message) return null;

  const awaiting = session.awaiting;
  if (awaiting === 'del_kind') {
    const kind = detectTargetKind(message);
    if (!kind) return 'مفهمتش نوع العنصر. اختار: كورس أو محاضرة أو امتحان أو واجب.';
    slots.kind = kind;
    session.awaiting = null;
    return null;
  }
  if (awaiting === 'del_query' || awaiting === 'del_pick') {
    // In the delete flow, a typed name is a SEARCH for the item to delete.
    resetTarget();
    slots.query = cleanText(message, 80);
    session.awaiting = null;
    return null;
  }
  if (awaiting === 'del_mode') {
    if (/(?:اخف|مسوده|وقف|ايقاف)/.test(normalizeArabic(message))) slots.mode = 'hide';
    else if (hasDeleteVerb(message) || /(?:حذف|نهائي)/.test(normalizeArabic(message))) slots.mode = 'delete';
    else return 'اختار: إخفاء (مسودة) أو حذف نهائي أو إلغاء.';
    session.awaiting = null;
    return null;
  }
  return null;
}

function candidateChip(candidate: DeleteCandidate): AgentChipOption {
  const parts = [candidate.title, candidate.subtitle, candidate.stat].filter(Boolean);
  const label = parts.join(' — ');
  return { label: label.length > 90 ? `${label.slice(0, 89)}…` : label, value: candidate.id };
}

function impactSummaryText(impact: DeleteImpact): string {
  const rows = impactRows(impact);
  return rows.length ? rows.map((row) => `• ${row.label}: ${row.value}`).join('\n') : '• مفيش بيانات مرتبطة.';
}

async function nextDeleteItem(ctx: TurnContext, session: AgentSession): Promise<Omit<AgentTurnResult, 'conversationId'>> {
  const slots = session.slots as Record<string, unknown>;
  const kind = slots.kind;
  if (!isDeleteKind(kind)) return forceAsk(ctx, session, 'del_kind');
  const noun = KIND_NOUN[kind];

  if (!slots.targetId) {
    const query = typeof slots.query === 'string' ? slots.query : '';
    if (!query) return forceAsk(ctx, session, 'del_query');

    const found = await ctx.deps.deleteTools.find(kind, query);
    if (found.length === 0) {
      delete slots.query;
      session.awaiting = 'del_query';
      return reply(`مش لاقي ${noun} باسم «${query}». اكتب الاسم تاني أو جزء مميز منه.`, [], session.flow);
    }
    const shown = found.slice(0, MAX_CHIPS);
    slots.candidateIds = shown.map((item) => item.id);
    session.awaiting = 'del_pick';
    const text =
      found.length === 1
        ? `لقيت ${noun} واحد مطابق. اضغط عليه علشان أتأكد إنه هو المقصود:`
        : `لقيت ${found.length} نتيجة${found.length > shown.length ? ` (هعرض أول ${shown.length}، اكتب اسم أدق لتضييق البحث)` : ''}. اختار الـ${noun} المقصود:`;
    return reply(text, [{ kind: 'chips', slot: 'del_pick', options: shown.map(candidateChip) }], session.flow);
  }

  const id = String(slots.targetId);
  let impact = slots.impact as DeleteImpact | undefined;
  if (!impact) {
    const fresh = await ctx.deps.deleteTools.impact(kind, id);
    if (!fresh) {
      delete slots.targetId;
      delete slots.impact;
      session.awaiting = 'del_query';
      return reply(`الـ${noun} ده مبقاش موجود. اكتب اسم تاني أو قول «إلغاء».`, [], session.flow);
    }
    slots.impact = fresh;
    slots.targetName = fresh.name;
    impact = fresh;
  }

  if (!slots.mode) {
    if (hasDependents(impact)) {
      session.awaiting = 'del_mode';
      return reply(
        `«${impact.name}» عليه بيانات مرتبطة:\n${impactSummaryText(impact)}\n\nالأأمن إنك تخفيه عن الطلاب الأول (مسودة) من غير ما يتمسح حاجة. وتقدر برضه تحذفه نهائيًا.`,
        [
          {
            kind: 'chips',
            slot: 'del_mode',
            options: [
              { label: 'إخفاء بدل الحذف (الأأمن)', value: 'hide' },
              { label: 'حذف نهائي', value: 'delete' },
              { label: 'إلغاء', value: 'cancel' },
            ],
          },
        ],
        session.flow
      );
    }
    slots.mode = 'delete';
  }

  return slots.mode === 'hide' ? confirmHide(ctx, session, impact) : confirmDelete(ctx, session, impact);
}

async function confirmHide(ctx: TurnContext, session: AgentSession, impact: DeleteImpact) {
  return buildConfirmation(ctx, session, {
    title: `إخفاء ${KIND_NOUN[impact.kind]} «${impact.name.slice(0, 80)}»`,
    rows: [
      { label: 'العنصر', value: impact.name },
      { label: 'الإجراء', value: 'إخفاء عن الطلاب (مسودة) — من غير حذف أي بيانات' },
    ],
    editable: [],
    steps: [{ tool: 'hide_item', parameters: { kind: impact.kind, id: impact.id } }],
  });
}

async function confirmDelete(ctx: TurnContext, session: AgentSession, impact: DeleteImpact) {
  await cancelPending(ctx, session);
  session.awaiting = null;

  const actionType = DELETE_TOOL_BY_KIND[impact.kind];
  const payload: Record<string, unknown> = {
    [DELETE_ID_KEY[impact.kind]]: impact.id,
    confirmName: impact.name,
    expectedImpact: impact.counts,
  };
  const rows = impactRows(impact);
  const preview: ConfirmationPreview = {
    actionType,
    title: `حذف ${KIND_NOUN[impact.kind]} «${impact.name.slice(0, 80)}»`,
    titleAr: `حذف ${KIND_NOUN[impact.kind]} «${impact.name.slice(0, 80)}»`,
    description: 'حذف نهائي',
    descriptionAr: rows.map((row) => `${row.label}: ${row.value}`).join(' | ').slice(0, 500) || 'حذف نهائي',
    riskLevel: 'high',
    requiresConfirmation: true,
    items: [],
    metadata: { rows },
  };

  const { token } = await ctx.deps.createConfirmation({
    actionType,
    payload,
    preview,
    expiresInMs: DELETE_CONFIRM_TTL_MS,
  });
  session.pendingToken = token;

  return reply(
    `ده حذف نهائي ومش هتقدر ترجّعه. راجع اللي هيتمسح، واكتب اسم الـ${KIND_NOUN[impact.kind]} بالضبط علشان يتفعّل زر الحذف:`,
    [
      {
        kind: 'delete_confirm',
        token,
        itemKind: KIND_NOUN[impact.kind],
        name: impact.name,
        rows,
        expectText: impact.name,
        irreversible: true,
        expiresInSec: DELETE_CONFIRM_TTL_MS / 1000,
      },
    ],
    session.flow
  );
}

/** After a changed-counts rejection (or "retry"): re-read the impact and show a fresh card. */
async function refreshDeleteConfirmation(ctx: TurnContext, session: AgentSession) {
  const slots = session.slots as Record<string, unknown>;
  const kind = slots.kind;
  const previous = slots.impact as DeleteImpact | undefined;
  if (!isDeleteKind(kind) || !slots.targetId) return advance(ctx, session, false);

  const fresh = await ctx.deps.deleteTools.impact(kind, String(slots.targetId));
  if (!fresh) {
    delete slots.targetId;
    delete slots.impact;
    delete slots.mode;
    session.awaiting = 'del_query';
    return reply(`الـ${KIND_NOUN[kind]} ده مبقاش موجود (اتحذف أو اتغيّر). اكتب اسم تاني أو قول «إلغاء».`, [], session.flow);
  }
  slots.impact = fresh;
  slots.targetName = fresh.name;
  // Students/attempts appeared since the first summary: offer "hide instead" again.
  if (previous && !hasDependents(previous) && hasDependents(fresh)) delete slots.mode;
  const changed = !previous || JSON.stringify(previous.counts) !== JSON.stringify(fresh.counts) || previous.name !== fresh.name;
  const outcome = await advance(ctx, session, false);
  return changed
    ? { ...outcome, reply: `البيانات اتغيّرت من وقت ما عرضت التأكيد، فحدّثت الملخص. راجعه وأكّد من جديد.\n${outcome.reply}` }
    : outcome;
}

function handleDeleteExecuted(
  session: AgentSession,
  actionType: string,
  results: ToolResultLike[]
): Omit<AgentTurnResult, 'conversationId'> {
  const slots = session.slots as Record<string, unknown>;
  const kind = isDeleteKind(slots.kind) ? slots.kind : 'course';
  const name = String(slots.targetName ?? (slots.impact as DeleteImpact | undefined)?.name ?? '');
  const result = results.map((r) => r.result).find(Boolean) as Record<string, unknown> | undefined;
  const lines: string[] = [];
  let title: string;

  if (actionType === 'hide_item') {
    title = `تم إخفاء ${KIND_LABEL[kind]} «${name}»`;
    lines.push('اتحوّل لمسودة ومبقاش ظاهر للطلاب، ومفيش بيانات اتمسحت.', 'تقدر ترجّعه بنشره تاني من الصفحة الخاصة بيه.');
  } else {
    title = `تم حذف ${KIND_LABEL[kind]} «${name}»`;
    const counts = (result?.impact as Record<string, number> | undefined) ?? {};
    const rows = impactRows({ kind, id: String(slots.targetId ?? ''), name, counts });
    if (rows.length) lines.push(...rows.map((row) => `اتحذف/اتأثر: ${row.label} (${row.value})`));
    lines.push('الحذف نهائي ولا يمكن التراجع عنه.');
  }
  const pages: Record<DeleteKind, [string, string]> = {
    course: ['/admin/courses', 'فتح الكورسات'],
    lecture: ['/admin/lectures', 'فتح المحاضرات'],
    exam: ['/admin/exams', 'فتح الامتحانات'],
    assignment: ['/admin/assignments', 'فتح الواجبات'],
  };
  const link = { href: pages[kind][0], label: pages[kind][1] };

  session.flow = null;
  session.slots = {};
  session.awaiting = null;
  session.pendingToken = null;
  return reply(`${title} ✅\nتحب أساعدك في حاجة تانية؟`, [{ kind: 'success', title, lines, link }]);
}
