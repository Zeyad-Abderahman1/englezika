import { getToolDefinition, type ToolDefinition } from './tool-registry';
import type { StaffPermission } from '../staff-permissions';
import type { ServiceContext, OperatorIdentity } from '../services/types';
import { courseService } from '../services/course-service';
import { lectureService } from '../services/lecture-service';
import { assessmentService } from '../services/assessment-service';
import { announcementService } from '../services/announcement-service';
import { getDatabase } from '../platform';
import { COURSE_GRADE_OPTIONS } from '../course-grades';
import { DomainError } from '../services/types';
import { deleteStagedImage, isValidUploadId, loadStagedImage } from './agent/image-staging';

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

export function validateToolArguments(
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
    if (!Object.prototype.hasOwnProperty.call(tool.allowedKeys, key)) {
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
    } else if (schema.type === 'boolean') {
      if (typeof val !== 'boolean') {
        throw new ToolExecutionError(`Parameter '${key}' must be a boolean`, 'INVALID_ARGS', 400);
      }
    }
  }
}

/**
 * Attaches a staged chat upload as the course thumbnail through the SAME service
 * method (and therefore the same validation) as the admin thumbnail endpoint.
 * The staged reference is resolved against the acting staff member's own
 * namespace, so another user's upload can never be attached.
 */
async function attachStagedThumbnail(
  courseId: string,
  uploadId: string,
  actor: StaffActor,
  serviceContext: ServiceContext
): Promise<{ attached: boolean; error?: string }> {
  if (!isValidUploadId(uploadId)) {
    return { attached: false, error: 'مرجع الصورة غير صالح' };
  }
  const staged = await loadStagedImage(actor.email, uploadId, serviceContext.storage as never);
  if (!staged) {
    return { attached: false, error: 'لم أجد الصورة المرفوعة (ربما انتهت صلاحيتها). ارفعها مرة أخرى.' };
  }
  try {
    await courseService.uploadThumbnail(courseId, staged.bytes, staged.mime, actor, serviceContext);
  } catch (error) {
    if (error instanceof DomainError) {
      return { attached: false, error: error.message };
    }
    throw error;
  }
  await deleteStagedImage(actor.email, uploadId, serviceContext.storage as never);
  return { attached: true };
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
    metadataDb: context.metadataDb,
    afterCommit: context.afterCommit,
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

        resultPayload = { courses: filtered.slice(0, 100) };
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

      case 'list_grades': {
        const gradesRes = await db.query(
          "SELECT DISTINCT grade FROM courses WHERE grade IS NOT NULL AND grade <> ''"
        );
        const rows: Array<{ grade?: unknown }> = gradesRes?.rows
          ? gradesRes.rows
          : Array.isArray(gradesRes)
            ? gradesRes
            : [];
        const merged = [...COURSE_GRADE_OPTIONS] as string[];
        for (const row of rows) {
          const grade = typeof row.grade === 'string' ? row.grade.trim() : '';
          if (grade && !merged.includes(grade)) merged.push(grade);
        }
        resultPayload = { grades: merged };
        break;
      }

      case 'list_lectures': {
        const courseId = String(args.courseId);
        const lecturesRes = await db.query(
          `SELECT id, title, status, duration_seconds, max_views
           FROM videos WHERE course_id = $1 ORDER BY created_at ASC LIMIT 100`,
          [courseId]
        );
        const rows: Array<Record<string, unknown>> = lecturesRes?.rows
          ? lecturesRes.rows
          : Array.isArray(lecturesRes)
            ? lecturesRes
            : [];
        resultPayload = {
          lectures: rows.map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status,
            durationSeconds: row.duration_seconds,
            maxViews: row.max_views,
          })),
        };
        break;
      }

      case 'get_platform_stats': {
        const metric = String(args.metric);
        const queries: Record<string, { sql: string; permission: StaffPermission }> = {
          students: {
            sql: "SELECT COUNT(*) AS total FROM users WHERE role = 'student'",
            permission: 'view_students',
          },
          active_enrollments: {
            sql: "SELECT COUNT(*) AS total FROM enrollments WHERE status = 'approved'",
            permission: 'manage_enrollments',
          },
          pending_enrollments: {
            sql: "SELECT COUNT(*) AS total FROM enrollments WHERE status = 'pending'",
            permission: 'manage_enrollments',
          },
        };

        if (queries[metric]) {
          const { sql, permission } = queries[metric];
          if (!hasStaffPermission(actor, permission)) {
            throw new ToolExecutionError(
              `Staff actor does not have required permission '${permission}' for metric '${metric}'`,
              'FORBIDDEN',
              403
            );
          }
          const res = await db.query(sql);
          const row = res?.rows ? res.rows[0] : Array.isArray(res) ? res[0] : res;
          resultPayload = { metric, total: Number(row?.total ?? 0) };
        } else if (metric === 'published_courses') {
          const res = await db.query(
            "SELECT id, title, grade FROM courses WHERE status = 'published' ORDER BY title ASC LIMIT 30"
          );
          const rows: Array<Record<string, unknown>> = res?.rows ? res.rows : Array.isArray(res) ? res : [];
          resultPayload = {
            metric,
            total: rows.length,
            courses: rows.map((row) => ({ id: row.id, title: row.title, grade: row.grade })),
          };
        } else if (metric === 'course_lecture_count') {
          const courseId = args.courseId ? String(args.courseId) : '';
          if (!courseId) {
            throw new ToolExecutionError("Metric 'course_lecture_count' requires courseId", 'INVALID_ARGS', 400);
          }
          if (!hasStaffPermission(actor, 'manage_videos')) {
            throw new ToolExecutionError(
              "Staff actor does not have required permission 'manage_videos' for this metric",
              'FORBIDDEN',
              403
            );
          }
          const res = await db.query(
            'SELECT COUNT(*) AS total FROM videos WHERE course_id = $1',
            [courseId]
          );
          const row = res?.rows ? res.rows[0] : Array.isArray(res) ? res[0] : res;
          resultPayload = { metric, courseId, total: Number(row?.total ?? 0) };
        } else {
          throw new ToolExecutionError(`Unsupported metric '${metric}'`, 'INVALID_ARGS', 400);
        }
        break;
      }

      // --- COURSE TOOLS ---
      case 'create_course': {
        // Draft unless the teacher explicitly confirmed publishing through the
        // server-built confirmation payload (never from a model-supplied status).
        const course = await courseService.createCourse(
          {
            title: args.title,
            grade: args.grade,
            description: args.description,
            price: args.price,
            status: args.publish === true ? 'published' : 'draft',
          },
          actor,
          serviceContext
        );

        let thumbnail: { attached: boolean; error?: string } | undefined;
        if (typeof args.thumbnailUploadId === 'string' && args.thumbnailUploadId) {
          thumbnail = await attachStagedThumbnail(
            course.id,
            args.thumbnailUploadId,
            actor,
            serviceContext
          );
        }
        resultPayload = { course, ...(thumbnail ? { thumbnail } : {}) };
        break;
      }

      case 'attach_course_thumbnail': {
        const thumbnail = await attachStagedThumbnail(
          String(args.courseId),
          String(args.thumbnailUploadId),
          actor,
          serviceContext
        );
        if (!thumbnail.attached) {
          throw new ToolExecutionError(thumbnail.error || 'تعذر حفظ صورة الكورس', 'EXECUTION_FAILED', 400);
        }
        resultPayload = { courseId: String(args.courseId), thumbnail };
        break;
      }

      case 'unpublish_course': {
        const courseId = String(args.courseId);
        const course = await courseService.updateCourse(
          courseId,
          { status: 'draft' },
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
        // Draft unless publishing was explicitly confirmed server-side.
        const video = await lectureService.createLecture(
          {
            courseId,
            title: args.title,
            youtubeUrl: args.youtubeUrl,
            durationSeconds: args.duration,
            maxViews: args.maxViews,
            prerequisiteExamId: args.prerequisiteExamId,
            minimumScore: args.minimumScore,
            status: args.publish === true ? 'published' : 'draft',
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
            coverageStartLectureId: args.coverageStartLectureId ? String(args.coverageStartLectureId) : undefined,
            coverageEndLectureId: args.coverageEndLectureId ? String(args.coverageEndLectureId) : undefined,
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
            coverageStartLectureId: args.coverageStartLectureId ? String(args.coverageStartLectureId) : undefined,
            coverageEndLectureId: args.coverageEndLectureId ? String(args.coverageEndLectureId) : undefined,
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
