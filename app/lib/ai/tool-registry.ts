import type { StaffPermission } from '../staff-permissions';

/**
 * AI Tool Registry
 *
 * Defines authoritative metadata, schemas, RBAC requirements, and confirmation policies
 * for all tools exposed to the local AI teacher assistant.
 *
 * The registry, NOT the model, is authoritative for:
 * - required permission
 * - risk classification
 * - whether confirmation is mandatory
 * - whether action is mutating
 * - whether action can auto-execute
 */

export type ToolMutationType =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'publish'
  | 'structural'
  | 'financial'
  | 'generated_content';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolConfirmationPolicy =
  | 'none'
  | 'mandatory'
  | 'preview_required'
  | 'compound_escalation';

export interface ToolFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number;
  max?: number;
  description?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  requiredPermission: StaffPermission;
  mutationType: ToolMutationType;
  riskLevel: ToolRiskLevel;
  confirmationPolicy: ToolConfirmationPolicy;
  allowedKeys: Record<string, ToolFieldSchema>;
}

const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // --- READ TOOLS ---
  get_course_structure: {
    name: 'get_course_structure',
    description: 'Retrieve course metadata and ordered sequence items (videos, exams, assignments).',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  get_course: {
    name: 'get_course',
    description: 'Retrieve course metadata and ordered sequence items (videos, exams, assignments).',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  search_courses: {
    name: 'search_courses',
    description: 'Search courses by title or filter by grade to resolve contextual references.',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      query: { type: 'string', required: false, maxLength: 100 },
      grade: { type: 'string', required: false, maxLength: 30 },
    },
  },

  list_courses: {
    name: 'list_courses',
    description: 'List or search courses by title or filter by grade to resolve contextual references.',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      query: { type: 'string', required: false, maxLength: 100 },
      grade: { type: 'string', required: false, maxLength: 30 },
    },
  },

  get_lecture_details: {
    name: 'get_lecture_details',
    description: 'Retrieve lecture metadata, video access parameters, and duration.',
    requiredPermission: 'manage_videos',
    mutationType: 'read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  get_assessment_details: {
    name: 'get_assessment_details',
    description: 'Retrieve exam/quiz metadata, question list, and attempt metrics.',
    requiredPermission: 'manage_exams',
    mutationType: 'read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      assessmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  // --- COURSE TOOLS ---
  create_course: {
    name: 'create_course',
    description: 'Create a new course in draft mode.',
    requiredPermission: 'manage_courses',
    mutationType: 'create',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      grade: { type: 'string', required: true, minLength: 1, maxLength: 50 },
      description: { type: 'string', required: false, maxLength: 2000 },
      price: { type: 'number', required: false, min: 0, max: 100000 },
    },
  },

  update_course: {
    name: 'update_course',
    description: 'Update metadata of an existing course (title, grade, description). Price is prohibited.',
    requiredPermission: 'manage_courses',
    mutationType: 'update',
    riskLevel: 'medium',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: false, minLength: 2, maxLength: 200 },
      grade: { type: 'string', required: false, minLength: 1, maxLength: 50 },
      description: { type: 'string', required: false, maxLength: 2000 },
    },
  },

  update_course_price: {
    name: 'update_course_price',
    description: 'Update price of an existing course. Classified as a financial action requiring confirmation.',
    requiredPermission: 'manage_courses',
    mutationType: 'financial',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      price: { type: 'number', required: true, min: 0, max: 100000 },
    },
  },

  delete_course: {
    name: 'delete_course',
    description: 'Cascade-delete a course and all associated lectures, exams, and items.',
    requiredPermission: 'manage_courses',
    mutationType: 'delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  publish_course: {
    name: 'publish_course',
    description: 'Publish a draft course making it visible to enrolled students.',
    requiredPermission: 'manage_courses',
    mutationType: 'publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  // --- LECTURE TOOLS ---
  add_lecture: {
    name: 'add_lecture',
    description: 'Add a new lecture video to a course in draft mode.',
    requiredPermission: 'manage_videos',
    mutationType: 'create',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      youtubeUrl: { type: 'string', required: true, minLength: 5, maxLength: 500 },
      duration: { type: 'number', required: false, min: 0, max: 86400 },
      maxViews: { type: 'number', required: false, min: 0, max: 1000 },
    },
  },

  update_lecture: {
    name: 'update_lecture',
    description: 'Update lecture title, YouTube URL, or duration.',
    requiredPermission: 'manage_videos',
    mutationType: 'update',
    riskLevel: 'medium',
    confirmationPolicy: 'none',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: false, minLength: 2, maxLength: 200 },
      youtubeUrl: { type: 'string', required: false, minLength: 5, maxLength: 500 },
      maxViews: { type: 'number', required: false, min: 0, max: 1000 },
    },
  },

  delete_lecture: {
    name: 'delete_lecture',
    description: 'Delete a lecture and clean up associated storage materials.',
    requiredPermission: 'manage_videos',
    mutationType: 'delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  publish_lecture: {
    name: 'publish_lecture',
    description: 'Publish a draft lecture video.',
    requiredPermission: 'manage_videos',
    mutationType: 'publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  set_lecture_view_limit: {
    name: 'set_lecture_view_limit',
    description: 'Configure maximum view session limit for a lecture (0 for unlimited).',
    requiredPermission: 'manage_videos',
    mutationType: 'update',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      maxViews: { type: 'number', required: true, min: 0, max: 1000 },
    },
  },

  // --- SEQUENCE TOOL ---
  reorder_course_items: {
    name: 'reorder_course_items',
    description: 'Reorder course sequence items (lectures, exams, assignments).',
    requiredPermission: 'manage_courses',
    mutationType: 'structural',
    riskLevel: 'medium',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      items: { type: 'array', required: true },
    },
  },

  // --- ASSESSMENT TOOLS ---
  create_exam: {
    name: 'create_exam',
    description: 'Create an online exam in draft mode with validated question batches.',
    requiredPermission: 'manage_exams',
    mutationType: 'generated_content',
    riskLevel: 'medium',
    confirmationPolicy: 'preview_required',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      questions: { type: 'array', required: true },
      durationMinutes: { type: 'number', required: false, min: 5, max: 300 },
      passingScore: { type: 'number', required: false, min: 0, max: 100 },
    },
  },

  create_quiz: {
    name: 'create_quiz',
    description: 'Create an online quiz in draft mode with validated questions.',
    requiredPermission: 'manage_exams',
    mutationType: 'generated_content',
    riskLevel: 'medium',
    confirmationPolicy: 'preview_required',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      questions: { type: 'array', required: true },
      durationMinutes: { type: 'number', required: false, min: 5, max: 120 },
      passingScore: { type: 'number', required: false, min: 0, max: 100 },
    },
  },

  delete_exam: {
    name: 'delete_exam',
    description: 'Delete an exam or quiz and its questions/attempts.',
    requiredPermission: 'manage_exams',
    mutationType: 'delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      examId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  publish_exam: {
    name: 'publish_exam',
    description: 'Publish an exam or quiz making it available to students.',
    requiredPermission: 'manage_exams',
    mutationType: 'publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      examId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  publish_assessment: {
    name: 'publish_assessment',
    description: 'Publish an exam or quiz making it available to students.',
    requiredPermission: 'manage_exams',
    mutationType: 'publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      assessmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  delete_assessment: {
    name: 'delete_assessment',
    description: 'Delete an exam or quiz and its questions/attempts.',
    requiredPermission: 'manage_exams',
    mutationType: 'delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      assessmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },


  // --- ASSIGNMENT TOOLS ---
  create_assignment: {
    name: 'create_assignment',
    description: 'Create an assignment in draft mode.',
    requiredPermission: 'manage_assignments',
    mutationType: 'create',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      description: { type: 'string', required: false, maxLength: 2000 },
    },
  },

  publish_assignment: {
    name: 'publish_assignment',
    description: 'Publish a draft assignment for students.',
    requiredPermission: 'manage_assignments',
    mutationType: 'publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      assignmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  // --- ANNOUNCEMENT TOOL ---
  create_announcement: {
    name: 'create_announcement',
    description: 'Create a student announcement (broad impact requires review/confirmation).',
    requiredPermission: 'manage_announcements',
    mutationType: 'create',
    riskLevel: 'medium',
    confirmationPolicy: 'preview_required',
    allowedKeys: {
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      body: { type: 'string', required: true, minLength: 2, maxLength: 5000 },
    },
  },
};

export type AiToolName = keyof typeof TOOL_DEFINITIONS;

export const CANONICAL_TOOL_NAMES: readonly AiToolName[] = Object.keys(TOOL_DEFINITIONS) as AiToolName[];

export function isRegisteredTool(toolName: string): toolName is AiToolName {
  return typeof toolName === 'string' && Object.prototype.hasOwnProperty.call(TOOL_DEFINITIONS, toolName);
}

export function isReadOnlyTool(toolName: string): boolean {
  const def = TOOL_DEFINITIONS[toolName];
  return Boolean(def && def.mutationType === 'read');
}

export function getToolRegistry(): Map<string, ToolDefinition> {
  return new Map(Object.entries(TOOL_DEFINITIONS));
}

export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS[toolName];
}

/**
 * Authoritatively checks if a registered tool schema explicitly declares and accepts a given parameter.
 * Non-registered tools or undeclared parameters strictly return false.
 */
export function toolAcceptsParameter(toolName: string, parameterName: string): boolean {
  if (!isRegisteredTool(toolName)) {
    return false;
  }
  const def = TOOL_DEFINITIONS[toolName];
  if (!def || !def.allowedKeys) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(def.allowedKeys, parameterName);
}


