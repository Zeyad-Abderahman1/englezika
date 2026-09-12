import { getToolDefinition, getToolIntentFamily, isRegisteredTool, type ToolIntentFamily } from './tool-registry';

/**
 * Semantic Intent Guard
 *
 * Provides authoritative, deterministic validation ensuring planned AI actions
 * strictly match the user's requested domain mutation intent.
 *
 * CRITICAL INVARIANTS:
 * 1. A price update request MUST NEVER execute a publish, delete, or metadata action.
 * 2. Explicit publishing requires an explicit publish semantic request (e.g. "انشر").
 *    A request containing only price, title, description, lecture, exam, or reorder
 *    must NEVER infer publication.
 * 3. Deletion requires an explicit deletion semantic request (e.g. "احذف", "امسح").
 * 4. Plan repair must be intent-preserving and cannot perform tool substitution across
 *    different mutation categories or intent families.
 */

// Patterns indicating explicit intent to change/update course price
const PRICE_INTENT_PATTERNS: readonly RegExp[] = [
  // Arabic patterns
  /(?:غير|تغيير|عدل|تعديل|خلي|اجعل|ضع|حدد|تحديد)\s.*(?:سعر|تسعير|المبلغ|تكلفة|قيمة)/i,
  /(?:سعر|تسعير|المبلغ|تكلفة)\s.*(?:الى|إلى|بـ|ب\s*\d+|يبقى|يكون|اصبح|أصبح|\d+)/i,
  /(?:خلي|اجعل)\s.*(?:سعر|بـ\s*\d+|ب\s*\d+)/i,
  /(?:سعر|السعر)\s.*(?:يبقى|يكون)\s*\d+/i,
  /(?:سعر\s+كورس|سعر\s+الدورة|سعر\s+الكورس)/i,
  /(?:جنيه|ج\.م|جنية)\b/i,
  // English patterns
  /\b(?:price|cost|pricing)\b.*\b(?:to|be|is|\$|egp|\d+)\b/i,
  /\b(?:update|change|set|modify|edit)\b.*\b(?:price|cost)\b/i,
];

// Patterns indicating EXPLICIT intent to publish
const PUBLISH_INTENT_PATTERNS: readonly RegExp[] = [
  // Arabic publish keywords
  /(?:^|\s)(?:انشر|نشر|إتاحة|اتاحة|انشرها|انشره)(?:\s|$)/i,
  /(?:نشر\s+كورس|نشر\s+الدورة|نشر\s+الكورس|نشر\s+المحاضرة|نشر\s+الامتحان)/i,
  // English publish keywords
  /\b(?:publish|unhide|release|make\s+public)\b/i,
];

// Patterns indicating EXPLICIT intent to delete/destroy
const DELETE_INTENT_PATTERNS: readonly RegExp[] = [
  // Arabic delete keywords
  /(?:^|\s)(?:احذف|حذف|امسح|مسح|ازل|أزل|ازيل|أزيل|إزالة|ازالة|شيل)(?:\s|$)/i,
  // English delete keywords
  /\b(?:delete|remove|destroy|drop|purge)\b/i,
];

// Patterns indicating intent to create a new course
const CREATE_COURSE_PATTERNS: readonly RegExp[] = [
  /(?:انشئ|أنشئ|انشاء|إنشاء|اضف|أضف|اضافة|إضافة|سجل|تسجيل)\s.*(?:كورس|دورة|مادة)/i,
  /(?:كورس|دورة)\s.*(?:جديد|جديدة)/i,
  /\b(?:create|add|new)\s+.*course\b/i,
];

// Patterns indicating intent to reorder course items
const REORDER_PATTERNS: readonly RegExp[] = [
  /(?:رتب|ترتيب|اعد\s+ترتيب|أعد\s+ترتيب|إعادة\s+ترتيب)/i,
  /\b(?:reorder|re-order|sort|resequence)\b/i,
];

// Patterns indicating intent to add or update lectures
const LECTURE_PATTERNS: readonly RegExp[] = [
  /(?:محاضرة|محاضرات|فيديو|فيديوهات|درس|دروس)/i,
  /\b(?:lecture|lectures|video|videos)\b/i,
];

// Patterns indicating intent to create/manage exams, quizzes, or assignments
const ASSESSMENT_PATTERNS: readonly RegExp[] = [
  /(?:امتحان|امتحانات|كويز|كويزات|اختبار|اختبارات|واجب|واجبات|اسئلة|أسئلة)/i,
  /\b(?:exam|exams|quiz|quizzes|test|tests|assessment|assignment)\b/i,
];

// Patterns indicating general metadata update (title, description, grade) WITHOUT price
const METADATA_UPDATE_PATTERNS: readonly RegExp[] = [
  /(?:غير|تغيير|عدل|تعديل|حدث|تحديث)\s.*(?:عنوان|اسم|وصف|الصف)/i,
  /\b(?:update|change|rename|edit)\s+.*(?:title|name|description|grade)\b/i,
];

export function hasPriceIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return PRICE_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasExplicitPublishIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return PUBLISH_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasExplicitDeleteIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return DELETE_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasCreateCourseIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return CREATE_COURSE_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasReorderIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return REORDER_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasLectureIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return LECTURE_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasAssessmentIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return ASSESSMENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function hasMetadataUpdateIntent(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return METADATA_UPDATE_PATTERNS.some((pattern) => pattern.test(message));
}

export interface IntentCompatibilityResult {
  compatible: boolean;
  reason?: string;
  expectedFamily?: ToolIntentFamily;
}

/**
 * Authoritatively validates whether candidate tool is semantically compatible
 * with the user request. Enforces deterministic safety invariants before execution
 * or confirmation creation.
 */
export function isToolCompatibleWithRequest(
  userMessage: string,
  toolName: string
): IntentCompatibilityResult {
  if (!isRegisteredTool(toolName)) {
    return {
      compatible: false,
      reason: `Tool '${toolName}' is not registered in the authoritative tool catalog`,
    };
  }

  const tool = getToolDefinition(toolName);
  if (!tool) {
    return { compatible: false, reason: `No tool definition found for '${toolName}'` };
  }

  const isPublish = tool.mutationType === 'publish' || tool.intentFamily.endsWith('.publish');
  const isDelete = tool.mutationType === 'delete' || tool.intentFamily.endsWith('.delete');
  const isPriceUpdate = tool.intentFamily === 'course.price.update';
  const isCreateCourse = tool.intentFamily === 'course.create';
  const isReorder = tool.intentFamily === 'course.reorder';
  const isLectureTool = tool.intentFamily.startsWith('lecture.');
  const isMetadataUpdate = tool.intentFamily === 'course.metadata.update';

  const userHasPublish = hasExplicitPublishIntent(userMessage);
  const userHasDelete = hasExplicitDeleteIntent(userMessage);
  const userHasPrice = hasPriceIntent(userMessage);
  const userHasCreate = hasCreateCourseIntent(userMessage);
  const userHasReorder = hasReorderIntent(userMessage);
  const userHasLecture = hasLectureIntent(userMessage);
  const userHasMetadata = hasMetadataUpdateIntent(userMessage);

  // 1. PUBLISH SAFETY:
  // A publish action REQUIRES explicit publishing intent in the user's request.
  // A request containing only price, title, description, lecture, exam, or reorder
  // must NEVER infer publication.
  if (isPublish && !userHasPublish) {
    return {
      compatible: false,
      reason: `Publish tool '${toolName}' requires explicit publish semantics in user request; cannot infer publication from non-publish command.`,
    };
  }

  // 2. DELETE SAFETY:
  // A delete action REQUIRES explicit deletion intent in the user's request.
  if (isDelete && !userHasDelete) {
    return {
      compatible: false,
      reason: `Destructive tool '${toolName}' requires explicit delete semantics in user request; cannot infer deletion.`,
    };
  }

  // 3. PRICE MUTATION ISOLATION:
  // If user requested a price update:
  // - MUST NOT execute publish
  // - MUST NOT execute delete
  // - MUST NOT execute course metadata update without price
  // - MUST NOT execute create course
  if (userHasPrice && !userHasPublish && !userHasDelete) {
    if (tool.mutationType !== 'read' && !isPriceUpdate) {
      return {
        compatible: false,
        reason: `Price update request cannot execute '${toolName}' (${tool.intentFamily}); expected 'update_course_price'.`,
        expectedFamily: 'course.price.update',
      };
    }
  }

  // 4. PUBLISH REQUEST ISOLATION:
  // If user explicitly requested publishing without price keywords:
  // - MUST NOT execute price update
  // - MUST NOT execute delete
  if (userHasPublish && !userHasPrice && !userHasDelete) {
    if (isPriceUpdate || isDelete) {
      return {
        compatible: false,
        reason: `Publish request cannot execute '${toolName}' (${tool.intentFamily}).`,
      };
    }
  }

  // 5. DELETE REQUEST ISOLATION:
  // If user explicitly requested delete without publish or price:
  // - MUST NOT execute publish
  // - MUST NOT execute price update
  if (userHasDelete && !userHasPublish && !userHasPrice) {
    if (isPublish || isPriceUpdate) {
      return {
        compatible: false,
        reason: `Delete request cannot execute '${toolName}' (${tool.intentFamily}).`,
      };
    }
  }

  // 6. METADATA UPDATE ISOLATION:
  // If user requested title/description update (without delete/publish/price):
  // - MUST NOT execute delete or publish
  if (userHasMetadata && !userHasDelete && !userHasPublish && !userHasPrice) {
    if (isDelete || isPublish || isPriceUpdate) {
      return {
        compatible: false,
        reason: `Metadata update request cannot execute '${toolName}' (${tool.intentFamily}).`,
      };
    }
  }

  // 7. REORDER ISOLATION:
  // If user requested reorder (without delete/publish):
  // - MUST NOT execute publish or delete
  if (userHasReorder && !userHasDelete && !userHasPublish) {
    if (isPublish || isDelete) {
      return {
        compatible: false,
        reason: `Reorder request cannot execute '${toolName}' (${tool.intentFamily}).`,
      };
    }
  }

  // 8. CREATE COURSE ISOLATION:
  // If user requested course creation:
  // - MUST NOT execute publish or delete
  if (userHasCreate && !userHasPublish && !userHasDelete) {
    if (isPublish || isDelete) {
      return {
        compatible: false,
        reason: `Course creation request cannot execute '${toolName}' (${tool.intentFamily}).`,
      };
    }
  }

  // 9. LECTURE ADD/UPDATE ISOLATION:
  // If user requested lecture operation:
  // - MUST NOT execute course delete
  if (userHasLecture && !userHasDelete && !userHasPublish) {
    if (tool.intentFamily === 'course.delete') {
      return {
        compatible: false,
        reason: `Lecture operation request cannot execute '${toolName}' (${tool.intentFamily}).`,
      };
    }
  }

  return { compatible: true };
}
