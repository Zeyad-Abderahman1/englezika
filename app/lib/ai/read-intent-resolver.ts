/**
 * Read-Only Intent Resolver
 *
 * Deterministic, server-side fallback resolver for safe read-only tool intents.
 *
 * When the local AI planner returns an empty-action plan for a request that
 * clearly requires a read-only tool (e.g., "اعرض لي الكورسات"), and the bounded
 * repair replan also fails, this resolver provides a narrow deterministic fallback.
 *
 * STRICT SAFETY RULES:
 * - Only resolves read-only tools (mutationType === 'read', confirmationPolicy === 'none')
 * - NEVER resolves mutations (create, update, delete, publish, financial, structural)
 * - NEVER resolves tools that require confirmation
 * - Uses explicit keyword patterns — NOT NLP / ML inference
 * - Returns null for any ambiguous or unrecognized intent
 */

import type { AiToolName } from './tool-registry';

export interface SafeReadIntent {
  tool: AiToolName;
  parameters: Record<string, unknown>;
}

/**
 * Normalized Arabic/English keyword patterns that unambiguously signal
 * a request to list/view all courses.
 *
 * Each pattern is tested against the lowercased, trimmed user message.
 */
const LIST_COURSES_PATTERNS: readonly RegExp[] = [
  // Arabic patterns
  /(?:اعرض|عرض|اظهر|اظهري|شوف|ابين|بين)\s.*(?:الكورسات|كورسات|الدورات|دورات)/,
  /(?:قائمة|لائحة)\s.*(?:الكورسات|كورسات|الدورات|دورات)/,
  /(?:الكورسات|كورسات|الدورات|دورات)\s.*(?:الموجودة|الحالية|المتاحة|المسجلة|كلها|جميعها)/,
  // English patterns
  /\b(?:show|list|display|view|get)\b.*\b(?:courses?|all\s+courses?)\b/i,
  /\b(?:current|existing|available)\s+courses?\b/i,
  /\bshow\s+me\b.*\bcourses?\b/i,
];

/**
 * Patterns that indicate the user is requesting a MUTATION, not a read.
 * If any of these match, the resolver returns null regardless of read patterns.
 */
const MUTATION_PATTERNS: readonly RegExp[] = [
  // Arabic mutation keywords
  /(?:احذف|حذف|امسح|ازل|ازيل|شيل)/,
  /(?:انشئ|انشاء|اضف|اضافة|سجل)/,
  /(?:عدل|تعديل|غير|تغيير|حدث|تحديث)/,
  /(?:انشر|نشر|فعل|تفعيل)/,
  /(?:السعر|سعر)\s.*(?:الى|إلى|ل\s)/,
  // English mutation keywords
  /\b(?:delete|remove|drop|destroy)\b/i,
  /\b(?:create|add|new|insert)\b/i,
  /\b(?:update|edit|modify|change|set)\b.*\b(?:price|title|grade)\b/i,
  /\b(?:publish|unpublish|activate|deactivate)\b/i,
];

/**
 * Resolves a user message to a safe read-only tool intent, or null.
 *
 * This is ONLY called after:
 * 1. The planner returned zero actions
 * 2. A bounded repair replan also returned zero actions
 * 3. The request appears to require a tool (not purely conversational)
 *
 * @returns SafeReadIntent if a deterministic, safe read-only match is found, otherwise null.
 */
export function resolveSafeReadIntent(message: string): SafeReadIntent | null {
  if (!message || typeof message !== 'string') return null;

  const normalized = message.trim().toLowerCase();
  if (normalized.length < 3) return null;

  // Safety: if any mutation pattern matches, refuse to resolve
  for (const pattern of MUTATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return null;
    }
  }

  // Check list_courses patterns
  for (const pattern of LIST_COURSES_PATTERNS) {
    if (pattern.test(normalized)) {
      return { tool: 'list_courses' as AiToolName, parameters: {} };
    }
  }

  // No deterministic match found
  return null;
}

/**
 * Returns true if the user message appears to be a purely conversational/greeting
 * message that does NOT require any tool execution.
 *
 * Used to skip the empty-action repair path for non-actionable messages.
 */
export function isConversationalMessage(message: string): boolean {
  if (!message || typeof message !== 'string') return true;

  const normalized = message.trim();
  if (normalized.length < 2) return true;

  // Short messages that are likely greetings or simple questions
  const CONVERSATIONAL_PATTERNS: readonly RegExp[] = [
    // Arabic greetings
    /^(?:مرحبا|مرحبًا|اهلا|أهلا|السلام عليكم|سلام|هلا|يا هلا|صباح الخير|مساء الخير|شكرا|شكرًا)[\s!؟?.]*$/,
    // Arabic capability questions (allow trailing words like أن تفعل, etc.)
    /^(?:ماذا يمكنك|ما الذي يمكنك|ماذا تستطيع|ما الذي تستطيع|كيف يمكنك مساعدتي|ماذا تفعل|من أنت|عرفني بنفسك)[\s\u0600-\u06FF؟?]*$/,
    // English greetings
    /^(?:hi|hello|hey|good\s+(?:morning|evening|afternoon)|thanks?|thank\s+you)[\s!?.]*$/i,
    // English capability questions
    /^(?:what\s+can\s+you\s+do|how\s+can\s+you\s+help|who\s+are\s+you|what\s+are\s+you)[\s?]*$/i,
  ];

  for (const pattern of CONVERSATIONAL_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}
