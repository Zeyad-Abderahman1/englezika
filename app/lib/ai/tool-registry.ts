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

export type ToolIntentFamily =
  | 'course.read'
  | 'course.create'
  | 'course.metadata.update'
  | 'course.price.update'
  | 'course.delete'
  | 'course.publish'
  | 'course.reorder'
  | 'lecture.read'
  | 'lecture.create'
  | 'lecture.update'
  | 'lecture.delete'
  | 'lecture.publish'
  | 'assessment.read'
  | 'assessment.create'
  | 'assessment.delete'
  | 'assessment.publish'
  | 'assignment.create'
  | 'assignment.publish'
  | 'announcement.create';

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

export type ToolContextKey = 'courseId' | 'lectureId' | 'assessmentId';

export interface ToolDefinition {
  name: string;
  description: string;
  requiredPermission: StaffPermission;
  mutationType: ToolMutationType;
  intentFamily: ToolIntentFamily;
  riskLevel: ToolRiskLevel;
  confirmationPolicy: ToolConfirmationPolicy;
  allowedKeys: Record<string, ToolFieldSchema>;
  serverOwnedKeys?: readonly string[];
  contextBindings?: Record<string, ToolContextKey>;
}

const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // --- READ TOOLS ---
  get_course_structure: {
    name: 'get_course_structure',
    description: 'Retrieve course metadata and ordered sequence items (videos, exams, assignments).',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    intentFamily: 'course.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  get_course: {
    name: 'get_course',
    description: 'Retrieve course metadata and ordered sequence items (videos, exams, assignments).',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    intentFamily: 'course.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  search_courses: {
    name: 'search_courses',
    description: 'Search courses by title or filter by grade to resolve contextual references.',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    intentFamily: 'course.read',
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
    intentFamily: 'course.read',
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
    intentFamily: 'lecture.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { videoId: 'lectureId' },
  },

  get_assessment_details: {
    name: 'get_assessment_details',
    description: 'Retrieve exam/quiz metadata, question list, and attempt metrics.',
    requiredPermission: 'manage_exams',
    mutationType: 'read',
    intentFamily: 'assessment.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      assessmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { assessmentId: 'assessmentId' },
  },

  list_grades: {
    name: 'list_grades',
    description: 'List the class/grade values that can be used for courses (canonical list plus grades already in use).',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    intentFamily: 'course.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {},
  },

  list_lectures: {
    name: 'list_lectures',
    description: 'List the lectures of one course (title, status, duration, view limit).',
    requiredPermission: 'manage_videos',
    mutationType: 'read',
    intentFamily: 'lecture.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  get_platform_stats: {
    name: 'get_platform_stats',
    description:
      'Read one aggregate platform metric: students, active_enrollments, pending_enrollments, published_courses, or course_lecture_count (needs courseId).',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    intentFamily: 'course.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      metric: { type: 'string', required: true, minLength: 3, maxLength: 40 },
      courseId: { type: 'string', required: false, minLength: 1, maxLength: 64 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  // --- COURSE TOOLS ---
  create_course: {
    name: 'create_course',
    description:
      'Create a new course. Draft by default; `publish` is only honoured when the teacher explicitly confirmed publishing. `thumbnailUploadId` is a staged upload reference, never image data.',
    requiredPermission: 'manage_courses',
    mutationType: 'create',
    intentFamily: 'course.create',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    serverOwnedKeys: ['status', 'publish', 'thumbnailUploadId'],
    allowedKeys: {
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      grade: { type: 'string', required: true, minLength: 1, maxLength: 50 },
      description: { type: 'string', required: false, maxLength: 2000 },
      price: { type: 'number', required: false, min: 0, max: 100000 },
      publish: { type: 'boolean', required: false },
      thumbnailUploadId: { type: 'string', required: false, minLength: 1, maxLength: 80 },
    },
  },

  attach_course_thumbnail: {
    name: 'attach_course_thumbnail',
    description:
      'Attach (or replace) the thumbnail of an existing course from a staged upload reference (JPG/PNG/WebP, max 5MB).',
    requiredPermission: 'manage_courses',
    mutationType: 'update',
    intentFamily: 'course.metadata.update',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    serverOwnedKeys: ['thumbnailUploadId'],
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      thumbnailUploadId: { type: 'string', required: true, minLength: 1, maxLength: 80 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  unpublish_course: {
    name: 'unpublish_course',
    description: 'Move a published course back to draft so students no longer see it.',
    requiredPermission: 'manage_courses',
    mutationType: 'publish',
    intentFamily: 'course.publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  update_course: {
    name: 'update_course',
    description: 'Update metadata of an existing course (title, grade, description). Price is prohibited.',
    requiredPermission: 'manage_courses',
    mutationType: 'update',
    intentFamily: 'course.metadata.update',
    riskLevel: 'medium',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: false, minLength: 2, maxLength: 200 },
      grade: { type: 'string', required: false, minLength: 1, maxLength: 50 },
      description: { type: 'string', required: false, maxLength: 2000 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  update_course_price: {
    name: 'update_course_price',
    description: 'Update price of an existing course. Classified as a financial action requiring confirmation.',
    requiredPermission: 'manage_courses',
    mutationType: 'financial',
    intentFamily: 'course.price.update',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      price: { type: 'number', required: true, min: 0, max: 100000 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  delete_course: {
    name: 'delete_course',
    description: 'Cascade-delete a course and all associated lectures, exams, and items.',
    requiredPermission: 'manage_courses',
    mutationType: 'delete',
    intentFamily: 'course.delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    serverOwnedKeys: ['confirmName', 'expectedImpact'],
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      // Set by the assistant only (never by the model): typed-name and impact guards re-checked by the server.
      confirmName: { type: 'string', required: false, minLength: 1, maxLength: 300 },
      expectedImpact: { type: 'object', required: false },
    },
    contextBindings: { courseId: 'courseId' },
  },

  publish_course: {
    name: 'publish_course',
    description: 'Publish a draft course making it visible to enrolled students.',
    requiredPermission: 'manage_courses',
    mutationType: 'publish',
    intentFamily: 'course.publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  // --- LECTURE TOOLS ---
  add_lecture: {
    name: 'add_lecture',
    description: 'Add a new lecture video to a course in draft mode.',
    requiredPermission: 'manage_videos',
    mutationType: 'create',
    intentFamily: 'lecture.create',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    serverOwnedKeys: ['status', 'publish'],
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      youtubeUrl: { type: 'string', required: true, minLength: 5, maxLength: 500 },
      duration: { type: 'number', required: false, min: 0, max: 86400 },
      maxViews: { type: 'number', required: false, min: 0, max: 1000 },
      prerequisiteExamId: { type: 'string', required: false, minLength: 1, maxLength: 80 },
      minimumScore: { type: 'number', required: false, min: 0, max: 100 },
      publish: { type: 'boolean', required: false },
    },
    contextBindings: { courseId: 'courseId' },
  },

  update_lecture: {
    name: 'update_lecture',
    description: 'Update lecture title, YouTube URL, or duration.',
    requiredPermission: 'manage_videos',
    mutationType: 'update',
    intentFamily: 'lecture.update',
    riskLevel: 'medium',
    confirmationPolicy: 'none',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: false, minLength: 2, maxLength: 200 },
      youtubeUrl: { type: 'string', required: false, minLength: 5, maxLength: 500 },
      maxViews: { type: 'number', required: false, min: 0, max: 1000 },
    },
    contextBindings: { videoId: 'lectureId' },
  },

  delete_lecture: {
    name: 'delete_lecture',
    description: 'Delete a lecture and clean up associated storage materials.',
    requiredPermission: 'manage_videos',
    mutationType: 'delete',
    intentFamily: 'lecture.delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    serverOwnedKeys: ['confirmName', 'expectedImpact'],
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      // Set by the assistant only (never by the model): typed-name and impact guards re-checked by the server.
      confirmName: { type: 'string', required: false, minLength: 1, maxLength: 300 },
      expectedImpact: { type: 'object', required: false },
    },
    contextBindings: { videoId: 'lectureId' },
  },

  publish_lecture: {
    name: 'publish_lecture',
    description: 'Publish a draft lecture video.',
    requiredPermission: 'manage_videos',
    mutationType: 'publish',
    intentFamily: 'lecture.publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { videoId: 'lectureId' },
  },

  set_lecture_view_limit: {
    name: 'set_lecture_view_limit',
    description: 'Configure maximum view session limit for a lecture (0 for unlimited).',
    requiredPermission: 'manage_videos',
    mutationType: 'update',
    intentFamily: 'lecture.update',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      videoId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      maxViews: { type: 'number', required: true, min: 0, max: 1000 },
    },
    contextBindings: { videoId: 'lectureId' },
  },

  // --- SEQUENCE TOOL ---
  reorder_course_items: {
    name: 'reorder_course_items',
    description: 'Reorder course sequence items (lectures, exams, assignments).',
    requiredPermission: 'manage_courses',
    mutationType: 'structural',
    intentFamily: 'course.reorder',
    riskLevel: 'medium',
    confirmationPolicy: 'none',
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      items: { type: 'array', required: true },
    },
    contextBindings: { courseId: 'courseId' },
  },

  // --- ASSESSMENT TOOLS ---
  create_exam: {
    name: 'create_exam',
    description: 'Create an online exam in draft mode with validated question batches.',
    requiredPermission: 'manage_exams',
    mutationType: 'generated_content',
    intentFamily: 'assessment.create',
    riskLevel: 'medium',
    confirmationPolicy: 'preview_required',
    serverOwnedKeys: ['status', 'assessmentType', 'thumbnailUploadId'],
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      questions: { type: 'array', required: true },
      durationMinutes: { type: 'number', required: false, min: 5, max: 300 },
      passingScore: { type: 'number', required: false, min: 0, max: 100 },
      coverageStartLectureId: { type: 'string', required: false, minLength: 1, maxLength: 64 },
      coverageEndLectureId: { type: 'string', required: false, minLength: 1, maxLength: 64 },
      // Optional: publish the exam as a standalone all-classes course (same shared service as the forms).
      publishAsCourse: { type: 'boolean', required: false },
      listingPrice: { type: 'number', required: false, min: 0, max: 100000 },
      listingDescription: { type: 'string', required: false, maxLength: 1000 },
      isPublic: { type: 'boolean', required: false },
      showLeaderboard: { type: 'boolean', required: false },
      thumbnailUploadId: { type: 'string', required: false, minLength: 1, maxLength: 80 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  create_quiz: {
    name: 'create_quiz',
    description: 'Create an online quiz in draft mode with validated questions.',
    requiredPermission: 'manage_exams',
    mutationType: 'generated_content',
    intentFamily: 'assessment.create',
    riskLevel: 'medium',
    confirmationPolicy: 'preview_required',
    serverOwnedKeys: ['status', 'assessmentType', 'thumbnailUploadId'],
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      questions: { type: 'array', required: true },
      durationMinutes: { type: 'number', required: false, min: 5, max: 120 },
      passingScore: { type: 'number', required: false, min: 0, max: 100 },
      coverageStartLectureId: { type: 'string', required: false, minLength: 1, maxLength: 64 },
      coverageEndLectureId: { type: 'string', required: false, minLength: 1, maxLength: 64 },
      // Optional: publish the exam as a standalone all-classes course (same shared service as the forms).
      publishAsCourse: { type: 'boolean', required: false },
      listingPrice: { type: 'number', required: false, min: 0, max: 100000 },
      listingDescription: { type: 'string', required: false, maxLength: 1000 },
      isPublic: { type: 'boolean', required: false },
      showLeaderboard: { type: 'boolean', required: false },
      thumbnailUploadId: { type: 'string', required: false, minLength: 1, maxLength: 80 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  delete_exam: {
    name: 'delete_exam',
    description: 'Delete an exam or quiz and its questions/attempts.',
    requiredPermission: 'manage_exams',
    mutationType: 'delete',
    intentFamily: 'assessment.delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    serverOwnedKeys: ['confirmName', 'expectedImpact'],
    allowedKeys: {
      examId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      // Set by the assistant only (never by the model): typed-name and impact guards re-checked by the server.
      confirmName: { type: 'string', required: false, minLength: 1, maxLength: 300 },
      expectedImpact: { type: 'object', required: false },
    },
    contextBindings: { examId: 'assessmentId' },
  },

  publish_exam: {
    name: 'publish_exam',
    description: 'Publish an exam or quiz making it available to students.',
    requiredPermission: 'manage_exams',
    mutationType: 'publish',
    intentFamily: 'assessment.publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      examId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { examId: 'assessmentId' },
  },

  publish_assessment: {
    name: 'publish_assessment',
    description: 'Publish an exam or quiz making it available to students.',
    requiredPermission: 'manage_exams',
    mutationType: 'publish',
    intentFamily: 'assessment.publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      assessmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { assessmentId: 'assessmentId' },
  },

  delete_assessment: {
    name: 'delete_assessment',
    description: 'Delete an exam or quiz and its questions/attempts.',
    requiredPermission: 'manage_exams',
    mutationType: 'delete',
    intentFamily: 'assessment.delete',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      assessmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
    contextBindings: { assessmentId: 'assessmentId' },
  },

  // --- SAFE DELETE (assistant) ---
  find_items_for_deletion: {
    name: 'find_items_for_deletion',
    description:
      'Search courses, lectures, exams or assignments by name (read only) so the teacher can pick ONE item to delete or hide.',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    intentFamily: 'course.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      kind: { type: 'string', required: true, minLength: 4, maxLength: 12 },
      query: { type: 'string', required: false, maxLength: 100 },
    },
  },

  get_delete_impact: {
    name: 'get_delete_impact',
    description:
      'Count what deleting one item would remove (lectures, students, payments, attempts, files). Read only.',
    requiredPermission: 'manage_courses',
    mutationType: 'read',
    intentFamily: 'course.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      kind: { type: 'string', required: true, minLength: 4, maxLength: 12 },
      id: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  delete_assignment: {
    name: 'delete_assignment',
    description: 'Permanently delete one assignment with its submissions and files.',
    requiredPermission: 'manage_assignments',
    mutationType: 'delete',
    intentFamily: 'assignment.publish',
    riskLevel: 'high',
    confirmationPolicy: 'mandatory',
    serverOwnedKeys: ['confirmName', 'expectedImpact'],
    allowedKeys: {
      assignmentId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      // Set by the assistant only (never by the model): typed-name and impact guards re-checked by the server.
      confirmName: { type: 'string', required: false, minLength: 1, maxLength: 300 },
      expectedImpact: { type: 'object', required: false },
    },
  },

  hide_item: {
    name: 'hide_item',
    description:
      'Safer alternative to deleting: move one course, lecture, exam or assignment back to draft so students no longer see it. Nothing is removed and it can be published again.',
    requiredPermission: 'manage_courses',
    mutationType: 'publish',
    intentFamily: 'course.publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    allowedKeys: {
      kind: { type: 'string', required: true, minLength: 4, maxLength: 12 },
      id: { type: 'string', required: true, minLength: 1, maxLength: 64 },
    },
  },

  // --- EXAM FROM PHOTOS (assistant) ---
  extract_exam_from_images: {
    name: 'extract_exam_from_images',
    description:
      'Extract the questions of ONE window of staged exam-page photos (OCR pipeline). Stores the result server-side by extraction id; creates no exam.',
    requiredPermission: 'manage_exams',
    mutationType: 'read',
    intentFamily: 'assessment.read',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    allowedKeys: {
      extractionId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      windowIndex: { type: 'number', required: true, min: 0, max: 100000 },
    },
  },

  create_exam_from_extraction: {
    name: 'create_exam_from_extraction',
    description:
      'Create a general online exam (draft) from a stored photo extraction, by extraction id. Not tied to a class. Requires confirmation.',
    requiredPermission: 'manage_exams',
    mutationType: 'create',
    intentFamily: 'assessment.create',
    riskLevel: 'medium',
    confirmationPolicy: 'preview_required',
    serverOwnedKeys: ['status', 'assessmentType'],
    allowedKeys: {
      extractionId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 3, maxLength: 150 },
      durationMinutes: { type: 'number', required: false, min: 1, max: 300 },
      passingScore: { type: 'number', required: false, min: 0, max: 100 },
      showReview: { type: 'boolean', required: false },
      allowPartial: { type: 'boolean', required: false },
      skipInvalid: { type: 'boolean', required: false },
    },
  },

  publish_exam_as_course: {
    name: 'publish_exam_as_course',
    description:
      'Publish an existing exam as a standalone course for ALL classes (price, optional description/thumbnail, public page and leaderboard switches) through the shared listing service. Requires confirmation.',
    requiredPermission: 'manage_exams',
    mutationType: 'publish',
    intentFamily: 'assessment.publish',
    riskLevel: 'medium',
    confirmationPolicy: 'mandatory',
    serverOwnedKeys: ['thumbnailUploadId'],
    allowedKeys: {
      examId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      listingPrice: { type: 'number', required: false, min: 0, max: 100000 },
      listingDescription: { type: 'string', required: false, maxLength: 1000 },
      isPublic: { type: 'boolean', required: false },
      showLeaderboard: { type: 'boolean', required: false },
      thumbnailUploadId: { type: 'string', required: false, minLength: 1, maxLength: 80 },
    },
  },

  // --- ASSIGNMENT TOOLS ---
  create_assignment: {
    name: 'create_assignment',
    description: 'Create an assignment in draft mode.',
    requiredPermission: 'manage_assignments',
    mutationType: 'create',
    intentFamily: 'assignment.create',
    riskLevel: 'low',
    confirmationPolicy: 'none',
    serverOwnedKeys: ['status'],
    allowedKeys: {
      courseId: { type: 'string', required: true, minLength: 1, maxLength: 64 },
      title: { type: 'string', required: true, minLength: 2, maxLength: 200 },
      description: { type: 'string', required: false, maxLength: 2000 },
    },
    contextBindings: { courseId: 'courseId' },
  },

  publish_assignment: {
    name: 'publish_assignment',
    description: 'Publish a draft assignment for students.',
    requiredPermission: 'manage_assignments',
    mutationType: 'publish',
    intentFamily: 'assignment.publish',
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
    intentFamily: 'announcement.create',
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

export function getToolIntentFamily(toolName: string): ToolIntentFamily | undefined {
  return TOOL_DEFINITIONS[toolName]?.intentFamily;
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

