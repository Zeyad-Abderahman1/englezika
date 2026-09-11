import { getToolDefinition, type ToolDefinition } from './tool-registry';
import type { StaffPermission } from '../staff-permissions';
import type { ServiceContext, OperatorIdentity } from '../services/types';
import { courseService } from '../services/course-service';
import { lectureService } from '../services/lecture-service';
import { assessmentService } from '../services/assessment-service';
import { announcementService } from '../services/announcement-service';
import { getDatabase } from '../platform';

export class ToolExecutionError extends Error {
  readonly code:
    | 'UNKNOWN_TOOL'
    | 'FORBIDDEN'
    | 'INVALID_ARGS'
    | 'CONFIRMATION_REQUIRED'
    | 'FINANCIAL_ESCALATION'
    | 'EXECUTION_FAILED';
  readonly status: number;

  constructor(
    message: string,
    code:
      | 'UNKNOWN_TOOL'
      | 'FORBIDDEN'
      | 'INVALID_ARGS'
      | 'CONFIRMATION_REQUIRED'
      | 'FINANCIAL_ESCALATION'
      | 'EXECUTION_FAILED',
    status = 400
  ) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
    this.status = status;
  }
}

export interface ToolExecutionContext extends ServiceContext {
  confirmationSatisfied?: boolean;
}

export type StaffActor = OperatorIdentity & { permissions?: StaffPermission[]; role?: string };

export interface ExecuteToolParams {
  actor: StaffActor;
  toolName: string;
  args: Record<string, unknown>;
  context?: ToolExecutionContext;
}

export interface ToolExecutionSuccessResult {
  ok: true;
  toolName: string;
  result: Record<string, unknown>;
}

export interface ToolExecutionFailureResult {
  ok: false;
  code: string;
  message: string;
}

export type ToolExecutionResult = ToolExecutionSuccessResult | ToolExecutionFailureResult;

const PROHIBITED_MODEL_ARG_KEYS = new Set([
  'staffemail',
  'staff_email',
  'email',
  'role',
  'permissions',
  'isadmin',
  'is_admin',
  'confirmationsatisfied',
  'confirmation_satisfied',
  'status',
  'is_active',
  'isactive',
]);

export function hasStaffPermission(
  actor: OperatorIdentity & { permissions?: StaffPermission[]; role?: string },
  permission: StaffPermission
): boolean {
  if (actor.role === 'teacher') return true;
  if (Array.isArray(actor.permissions) && actor.permissions.includes(permission)) {
    return true;
  }
  return false;
}

function validateToolArguments(
  tool: ToolDefinition,
  args: Record<string, unknown>
): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolExecutionError('Tool arguments must be a valid key-value object', 'INVALID_ARGS', 400);
  }

  // 1. Check for prohibited security/actor keys in model arguments
  for (const key of Object.keys(args)) {
    if (PROHIBITED_MODEL_ARG_KEYS.has(key.toLowerCase())) {
      throw new ToolExecutionError(
        `Prohibited parameter '${key}' in tool arguments. Actor identity and draft/publishing controls cannot be supplied by AI.`,
        'INVALID_ARGS',
        400
      );
    }
  }

  // 2. Reject unrecognized parameters not defined in tool schema
  for (const key of Object.keys(args)) {
    if (!tool.allowedKeys[key]) {
      throw new ToolExecutionError(
        `Unrecognized parameter '${key}' for tool '${tool.name}'`,
        'INVALID_ARGS',
        400
      );
    }
  }

  // 3. Validate presence, types, and constraints
  for (const [key, schema] of Object.entries(tool.allowedKeys)) {
    const val = args[key];

    if (val === undefined || val === null || val === '') {
      if (schema.required) {
        throw new ToolExecutionError(
          `Missing required parameter '${key}' for tool '${tool.name}'`,
          'INVALID_ARGS',
          400
        );
      }
      continue;
    }

    if (schema.type === 'string') {
      if (typeof val !== 'string') {
        throw new ToolExecutionError(`Parameter '${key}' must be a string`, 'INVALID_ARGS', 400);
      }
      if (schema.minLength !== undefined && val.trim().length < schema.minLength) {
        throw new ToolExecutionError(
          `Parameter '${key}' must be at least ${schema.minLength} characters`,
          'INVALID_ARGS',
          400
        );
      }
      if (schema.maxLength !== undefined && val.length > schema.maxLength) {
        throw new ToolExecutionError(
          `Parameter '${key}' exceeds maximum length of ${schema.maxLength}`,
          'INVALID_ARGS',
          400
        );
      }
    } else if (schema.type === 'number') {
      if (typeof val !== 'number' || isNaN(val)) {
        throw new ToolExecutionError(`Parameter '${key}' must be a valid number`, 'INVALID_ARGS', 400);
      }
      if (schema.min !== undefined && val < schema.min) {
        throw new ToolExecutionError(`Parameter '${key}' cannot be less than ${schema.min}`, 'INVALID_ARGS', 400);
      }
      if (schema.max !== undefined && val > schema.max) {
        throw new ToolExecutionError(`Parameter '${key}' cannot be greater than ${schema.max}`, 'INVALID_ARGS', 400);
      }
    } else if (schema.type === 'array') {
      if (!Array.isArray(val)) {
        throw new ToolExecutionError(`Parameter '${key}' must be an array`, 'INVALID_ARGS', 400);
      }
    }
  }
}

export async function executeTool(params: ExecuteToolParams): Promise<ToolExecutionSuccessResult> {
  const { actor, toolName, args, context = {} } = params;

  // 1. Lookup Tool Definition
  const tool = getToolDefinition(toolName);
  if (!tool) {
    throw new ToolExecutionError(`Tool '${toolName}' is not registered`, 'UNKNOWN_TOOL', 404);
  }

  // 2. Validate Tool Arguments against Schema & Anti-tampering Rules
  validateToolArguments(tool, args);

  // 3. Verify Actor Permission
  if (!hasStaffPermission(actor, tool.requiredPermission)) {
    throw new ToolExecutionError(
      `Staff actor '${actor.email}' does not have required permission '${tool.requiredPermission}' to execute '${toolName}'`,
      'FORBIDDEN',
      403
    );
  }

  // 4. Verify Confirmation Requirement
  if (tool.confirmationPolicy === 'mandatory' || tool.confirmationPolicy === 'preview_required') {
    if (!context.confirmationSatisfied) {
      throw new ToolExecutionError(
        `Tool '${toolName}' requires explicit confirmation. Execution halted until confirmed.`,
        'CONFIRMATION_REQUIRED',
        400
      );
    }
  }

  const db = context.db || getDatabase();
  const serviceContext: ServiceContext = {
    db,
    storage: context.storage,
    request: context.request,
  };

  try {
    let resultPayload: Record<string, unknown>;

    switch (toolName) {
      // --- READ TOOLS (Data-Minimized) ---
      case 'get_course':
      case 'get_course_structure': {
        const courseId = String(args.courseId);
        const courseRes = await db.query(
          'SELECT id, title, grade, price, status FROM courses WHERE id = $1',
          [courseId]
        );
        const course = courseRes?.rows ? courseRes.rows[0] : (Array.isArray(courseRes) ? courseRes[0] : courseRes);
        if (!course) {
          throw new ToolExecutionError(`Course '${courseId}' not found`, 'EXECUTION_FAILED', 404);
        }
        const itemsRes = await db.query(
          'SELECT id, item_type, item_id, sequence_order FROM course_items WHERE course_id = $1 ORDER BY sequence_order ASC',
          [courseId]
        );
        const itemRows = itemsRes?.rows ? itemsRes.rows : (Array.isArray(itemsRes) ? itemsRes : []);
        const isActive = course.status ? course.status === 'published' : course.is_active === 1;
        const status = course.status || (isActive ? 'published' : 'draft');
        resultPayload = {
          course: {
            id: course.id,
            title: course.title,
            grade: course.grade,
            price: course.price,
            status,
            isActive,
          },
          items: itemRows,
        };
        break;
      }

      case 'list_courses':
      case 'search_courses': {
        const query = args.query ? String(args.query).trim().toLowerCase() : '';
        const grade = args.grade ? String(args.grade).trim() : '';

        const coursesRes = await db.query('SELECT id, title, grade, price, status FROM courses');
        const courseRows: Array<Record<string, unknown>> = coursesRes?.rows
          ? coursesRes.rows
          : Array.isArray(coursesRes)
            ? coursesRes
            : [];
        let filtered = courseRows.map((c: Record<string, unknown>) => {
          const isActive = c.status ? c.status === 'published' : c.is_active === 1;
          const status = c.status || (isActive ? 'published' : 'draft');
          return {
            id: c.id,
            title: c.title,
            grade: c.grade,
            price: c.price,
            status,
            isActive,
          };
        });

        if (query) {
          filtered = filtered.filter((c: { title: unknown }) =>
            String(c.title || '').toLowerCase().includes(query)
          );
        }
        if (grade) {
          filtered = filtered.filter((c: { grade: unknown }) => String(c.grade || '') === grade);
        }

        resultPayload = { courses: filtered.slice(0, 20) };
        break;
      }

      case 'get_lecture_details': {
        const videoId = String(args.videoId);
        const vidRes = await db.query(
          'SELECT id, course_id, title, youtube_id, duration, order_num, is_active, max_views FROM videos WHERE id = $1',
          [videoId]
        );
        const vid = vidRes?.rows ? vidRes.rows[0] : (Array.isArray(vidRes) ? vidRes[0] : vidRes);
        if (!vid) {
          throw new ToolExecutionError(`Lecture '${videoId}' not found`, 'EXECUTION_FAILED', 404);
        }
        resultPayload = {
          lecture: {
            id: vid.id,
            courseId: vid.course_id,
            title: vid.title,
            youtubeId: vid.youtube_id,
            duration: vid.duration,
            orderNum: vid.order_num,
            isActive: vid.is_active === 1,
            maxViews: vid.max_views,
          },
        };
        break;
      }

      case 'get_assessment_details': {
        const assessmentId = String(args.assessmentId);
        const exam = await assessmentService.getExam(assessmentId, actor, serviceContext);
        resultPayload = { assessment: exam };
        break;
      }

      // --- COURSE TOOLS ---
      case 'create_course': {
        // Enforce STRICT DRAFT policy (status: 'draft')
        const course = await courseService.createCourse(
          {
            title: args.title,
            grade: args.grade,
            description: args.description,
            price: args.price,
            status: 'draft',
          },
          actor,
          serviceContext
        );
        resultPayload = { course };
        break;
      }

      case 'update_course': {
        const courseId = String(args.courseId);
        const course = await courseService.updateCourse(
          courseId,
          {
            title: args.title,
            grade: args.grade,
            description: args.description,
          },
          actor,
          serviceContext
        );
        resultPayload = { course };
        break;
      }

      case 'update_course_price': {
        const courseId = String(args.courseId);
        const course = await courseService.updateCourse(
          courseId,
          { price: args.price },
          actor,
          serviceContext
        );
        resultPayload = { course };
        break;
      }

      case 'delete_course': {
        const courseId = String(args.courseId);
        await courseService.deleteCourse(courseId, actor, serviceContext);
        resultPayload = { success: true, deletedCourseId: courseId };
        break;
      }

      case 'publish_course': {
        const courseId = String(args.courseId);
        const course = await courseService.updateCourse(
          courseId,
          { status: 'published' },
          actor,
          serviceContext
        );
        resultPayload = { course };
        break;
      }

      // --- LECTURE TOOLS ---
      case 'add_lecture': {
        const courseId = String(args.courseId);
        // Enforce STRICT DRAFT policy (status: 'draft')
        const video = await lectureService.createLecture(
          {
            courseId,
            title: args.title,
            youtubeUrl: args.youtubeUrl,
            durationSeconds: args.duration,
            maxViews: args.maxViews,
            status: 'draft',
          },
          actor,
          serviceContext
        );
        resultPayload = { video };
        break;
      }

      case 'update_lecture': {
        const videoId = String(args.videoId);
        const video = await lectureService.updateLecture(
          videoId,
          {
            title: args.title,
            maxViews: args.maxViews,
          },
          actor,
          serviceContext
        );
        resultPayload = { video };
        break;
      }

      case 'delete_lecture': {
        const videoId = String(args.videoId);
        await lectureService.deleteLecture(videoId, actor, serviceContext);
        resultPayload = { success: true, deletedVideoId: videoId };
        break;
      }

      case 'publish_lecture': {
        const videoId = String(args.videoId);
        const video = await lectureService.updateLecture(
          videoId,
          { status: 'published' },
          actor,
          serviceContext
        );
        resultPayload = { video };
        break;
      }

      case 'set_lecture_view_limit': {
        const videoId = String(args.videoId);
        const video = await lectureService.updateLecture(
          videoId,
          { maxViews: args.maxViews },
          actor,
          serviceContext
        );
        resultPayload = { video };
        break;
      }

      // --- SEQUENCE TOOL ---
      case 'reorder_course_items': {
        const courseId = String(args.courseId);
        const items = args.items as Array<{ id: string; type: 'video' | 'exam' | 'assignment' }>;
        const sequence = await courseService.saveSequence(
          courseId,
          items,
          actor,
          serviceContext
        );
        resultPayload = { sequence };
        break;
      }

      // --- ASSESSMENT TOOLS ---
      case 'create_exam': {
        const courseId = String(args.courseId);
        // Enforce STRICT DRAFT policy (status: 'draft')
        const exam = await assessmentService.createExam(
          {
            courseId,
            title: args.title,
            questions: args.questions as any,
            durationMinutes: args.durationMinutes,
            passingScore: args.passingScore,
            status: 'draft',
            assessmentType: 'exam',
          },
          actor,
          serviceContext
        );
        resultPayload = { exam };
        break;
      }

      case 'create_quiz': {
        const courseId = String(args.courseId);
        // Enforce STRICT DRAFT policy (status: 'draft')
        const quiz = await assessmentService.createExam(
          {
            courseId,
            title: args.title,
            questions: args.questions as any,
            durationMinutes: args.durationMinutes,
            passingScore: args.passingScore,
            status: 'draft',
            assessmentType: 'quiz',
          },
          actor,
          serviceContext
        );
        resultPayload = { quiz };
        break;
      }

      case 'delete_exam':
      case 'delete_assessment': {
        const examId = String(args.examId || args.assessmentId);
        await assessmentService.deleteExam(examId, actor, serviceContext);
        resultPayload = { success: true, deletedExamId: examId };
        break;
      }

      case 'publish_exam':
      case 'publish_assessment': {
        const examId = String(args.examId || args.assessmentId);
        const exam = await assessmentService.updateExam(
          examId,
          { status: 'published' },
          actor,
          serviceContext
        );
        resultPayload = { exam };
        break;
      }


      // --- ASSIGNMENT TOOLS ---
      case 'create_assignment': {
        const courseId = String(args.courseId);
        // Enforce STRICT DRAFT policy (status: 'draft')
        const assignment = await assessmentService.createAssignment(
          {
            courseId,
            title: args.title,
            description: args.description,
            status: 'draft',
          },
          actor,
          serviceContext
        );
        resultPayload = { assignment };
        break;
      }

      case 'publish_assignment': {
        const assignmentId = String(args.assignmentId);
        const assignment = await assessmentService.updateAssignment(
          assignmentId,
          { status: 'published' },
          actor,
          serviceContext
        );
        resultPayload = { assignment };
        break;
      }

      // --- ANNOUNCEMENT TOOL ---
      case 'create_announcement': {
        const announcement = await announcementService.createAnnouncement(
          {
            title: args.title,
            body: args.body,
          },
          actor,
          serviceContext
        );
        resultPayload = { announcement };
        break;
      }

      default:
        throw new ToolExecutionError(`Unhandled tool execution: ${toolName}`, 'UNKNOWN_TOOL', 404);
    }

    return {
      ok: true,
      toolName,
      result: resultPayload,
    };
  } catch (err: unknown) {
    if (err instanceof ToolExecutionError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolExecutionError(message, 'EXECUTION_FAILED', 400);
  }
}
