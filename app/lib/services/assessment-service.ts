import { getDatabase, getPrivateStorage } from '../platform';
import { safeInteger, safeText } from '../security';
import { invalidatePublicCourseCache } from '../public-course-cache';
import { recordAuditLog } from '../audit';
import { captureException } from '../observability';
import {
  isPdfUpload,
  MAX_PDF_SIZE,
} from '../upload-validation';
import { DomainError, type ServiceContext, type OperatorIdentity } from './types';

export interface RawExamQuestionInput {
  type?: unknown;
  prompt?: unknown;
  options?: unknown;
  correctAnswer?: unknown;
  rubric?: unknown;
  explanation?: unknown;
  points?: unknown;
}

export interface CreateExamInput {
  title?: unknown;
  description?: unknown;
  instructions?: unknown;
  courseId?: unknown;
  durationMinutes?: unknown;
  passingScore?: unknown;
  maxAttempts?: unknown;
  status?: unknown;
  assessmentType?: unknown;
  mode?: unknown;
  opensAt?: unknown;
  closesAt?: unknown;
  questions?: RawExamQuestionInput[];
}

export interface UpdateExamInput {
  title?: unknown;
  description?: unknown;
  instructions?: unknown;
  courseId?: unknown;
  durationMinutes?: unknown;
  passingScore?: unknown;
  maxAttempts?: unknown;
  status?: unknown;
  assessmentType?: unknown;
  mode?: unknown;
  opensAt?: unknown;
  closesAt?: unknown;
  questions?: RawExamQuestionInput[];
}

export interface CreateAssignmentInput {
  courseId?: unknown;
  title?: unknown;
  description?: unknown;
  dueAt?: unknown;
  maxScore?: unknown;
  status?: unknown;
  type?: unknown;
}

export interface UpdateAssignmentInput {
  courseId?: unknown;
  title?: unknown;
  description?: unknown;
  dueAt?: unknown;
  maxScore?: unknown;
  status?: unknown;
  type?: unknown;
}

export interface CreateAssignmentQuestionInput {
  question?: unknown;
  explanation?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  points?: unknown;
  sortOrder?: unknown;
}

function optionalTimestamp(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : undefined;
}

function parseExamQuestion(question: RawExamQuestionInput, sortOrder: number) {
  const type = 'multiple_choice';
  const prompt = safeText(question.prompt, 2000);
  const correctAnswer = safeText(question.correctAnswer, 1000);
  const rubric = safeText(question.rubric, 2000);
  const explanation = safeText(question.explanation, 5000);
  const points = safeInteger(question.points, 1, 1, 100);
  const options = Array.isArray(question.options)
    ? question.options
        .map((option) => safeText(option, 300))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return { type, prompt, correctAnswer, rubric, explanation, points, options, sortOrder };
}

export class AssessmentService {
  /* ──────────────────────────────────────────────────────────────────────────
     EXAMS & QUIZZES
     ────────────────────────────────────────────────────────────────────────── */

  async createExam(
    input: CreateExamInput,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; id: string; questionIds: string[] }> {
    const title = safeText(input.title, 150);
    const description = safeText(input.description, 1200);
    const instructions = safeText(input.instructions, 2000);
    const courseId = safeText(input.courseId, 80) || null;
    const durationMinutes = safeInteger(input.durationMinutes, 30, 1, 300);
    const passingScore = safeInteger(input.passingScore, 50, 0, 100);
    const maxAttempts = safeInteger(input.maxAttempts, 3, 1, 10);
    const status = input.status === 'published' ? 'published' : 'draft';
    const assessmentType = input.assessmentType === 'quiz' ? 'quiz' : 'exam';
    const mode = input.mode === 'file' ? 'file' : 'online';

    const questions = Array.isArray(input.questions)
      ? input.questions
          .slice(0, 100)
          .map((question, index) => parseExamQuestion(question, index + 1))
      : [];

    if (title.length < 3) {
      throw new DomainError('اسم الامتحان مطلوب', 400);
    }

    if (mode === 'online') {
      if (
        !questions.length ||
        questions.some((question) => !question.prompt || !question.correctAnswer)
      ) {
        throw new DomainError('أضف سؤالاً واحداً على الأقل مع الإجابة الصحيحة', 400);
      }
      if (
        questions.some((question) => question.type === 'multiple_choice' && question.options.length < 2)
      ) {
        throw new DomainError('كل سؤال اختيار من متعدد يحتاج اختيارين على الأقل', 400);
      }
      if (questions.some((question) => !question.options.includes(question.correctAnswer))) {
        throw new DomainError('اختر الإجابة الصحيحة من اختيارات السؤال', 400);
      }
    }

    const db = context?.db ?? getDatabase();
    if (courseId) {
      const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
      if (!course) {
        throw new DomainError('الكورس المحدد غير موجود', 404);
      }
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const questionIds = questions.map(() => crypto.randomUUID());

    const statements = [
      db
        .prepare(
          `INSERT INTO exams
         (id, course_id, title, description, instructions, duration_minutes, passing_score, max_attempts,
          status, opens_at, closes_at, created_by, created_at, updated_at,
          assessment_type, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          courseId,
          title,
          description,
          instructions,
          durationMinutes,
          passingScore,
          maxAttempts,
          status,
          input.opensAt ? Number(input.opensAt) : null,
          input.closesAt ? Number(input.closesAt) : null,
          operator.email.toLowerCase(),
          now,
          now,
          assessmentType,
          mode
        ),
    ];

    if (mode === 'online') {
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        statements.push(
          db
            .prepare(
              `INSERT INTO questions
         (id, exam_id, sort_order, type, prompt, options, correct_answer, rubric, explanation, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              questionIds[i],
              id,
              question.sortOrder,
              question.type,
              question.prompt,
              JSON.stringify(question.options),
              question.correctAnswer,
              question.rubric,
              question.explanation,
              question.points
            )
        );
      }
    }

    await db.batch(statements);
    invalidatePublicCourseCache();
    return { ok: true, id, questionIds };
  }

  async getExam(
    id: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ exam: unknown; questions: unknown[] }> {
    const db = context?.db ?? getDatabase();
    const exam = await db
      .prepare(
        `SELECT id, course_id AS courseId, title, description, instructions,
       duration_minutes AS durationMinutes, passing_score AS passingScore, max_attempts AS maxAttempts, status,
       opens_at AS opensAt, closes_at AS closesAt,
       COALESCE(assessment_type, 'exam') AS assessmentType,
       COALESCE(mode, 'online') AS mode,
       CASE WHEN teacher_file_key IS NOT NULL THEN 1 ELSE 0 END AS hasTeacherFile
       FROM exams WHERE id = ?`
      )
      .bind(id)
      .first();

    if (!exam) {
      throw new DomainError('الامتحان غير موجود', 404);
    }

    const questions = await db
      .prepare(
        `SELECT id, sort_order AS sortOrder, type, prompt, options,
       correct_answer AS correctAnswer, rubric, explanation, points,
       image_file_key AS imageFileKey
       FROM questions WHERE exam_id = ? ORDER BY sort_order`
      )
      .bind(id)
      .all<{
        id: string;
        sortOrder: number;
        type: string;
        prompt: string;
        options: string;
        correctAnswer: string;
        rubric: string;
        explanation: string;
        points: number;
        imageFileKey: string | null;
      }>();

    return {
      exam,
      questions: questions.results.map((question) => ({
        ...question,
        options: question.options ? JSON.parse(String(question.options)) : [],
        imageFileKey: question.imageFileKey || null,
        hasImage: question.imageFileKey != null,
      })),
    };
  }

  async updateExam(
    id: string,
    input: UpdateExamInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();
    const existing = await db
      .prepare(
        `SELECT course_id AS courseId, title, description, instructions, duration_minutes AS durationMinutes,
       passing_score AS passingScore, max_attempts AS maxAttempts, status, opens_at AS opensAt, closes_at AS closesAt,
       COALESCE(assessment_type, 'exam') AS assessmentType,
       COALESCE(mode, 'online') AS mode
       FROM exams WHERE id = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();

    if (!existing) {
      throw new DomainError('الامتحان غير موجود', 404);
    }

    const status = input.status === 'published' ? 'published' : 'draft';
    const assessmentType = input.assessmentType === 'quiz' ? 'quiz' : 'exam';
    const mode = input.mode === 'file' ? 'file' : 'online';

    const nullableTimestamp = (value: unknown, fallback: unknown) => {
      if (value === null) return null;
      const candidate = value === undefined ? fallback : value;
      if (candidate === null || candidate === undefined || candidate === '') return null;
      const number = Number(candidate);
      return Number.isFinite(number) ? number : null;
    };

    const updateStmt = db
      .prepare(
        `UPDATE exams SET title = ?, description = ?, instructions = ?, course_id = ?,
       duration_minutes = ?, passing_score = ?, max_attempts = ?, status = ?, opens_at = ?, closes_at = ?,
       assessment_type = ?, mode = ?, updated_at = ?
       WHERE id = ?`
      )
      .bind(
        safeText(input.title ?? existing.title, 150),
        safeText(input.description ?? existing.description, 1200),
        safeText(input.instructions ?? existing.instructions, 2000),
        input.courseId === null ? null : safeText(input.courseId ?? existing.courseId, 80) || null,
        safeInteger(input.durationMinutes ?? existing.durationMinutes, 30, 1, 300),
        safeInteger(input.passingScore ?? existing.passingScore, 50, 0, 100),
        safeInteger(input.maxAttempts ?? existing.maxAttempts, 3, 1, 10),
        status,
        nullableTimestamp(input.opensAt, existing.opensAt),
        nullableTimestamp(input.closesAt, existing.closesAt),
        input.assessmentType ? assessmentType : (existing.assessmentType as string) || 'exam',
        input.mode ? mode : (existing.mode as string) || 'online',
        Date.now(),
        id
      );

    if (Array.isArray(input.questions) && input.questions.length > 0) {
      const hasAttempts = await db
        .prepare('SELECT id FROM attempts WHERE exam_id = ? LIMIT 1')
        .bind(id)
        .first();
      if (hasAttempts) {
        throw new DomainError('لا يمكن تعديل أسئلة امتحان له نتائج محفوظة. يمكنك إنشاء امتحان جديد.', 409);
      }

      const newQuestions = input.questions.slice(0, 100).map((q, idx) => {
        const type = ['multiple_choice', 'true_false', 'short_answer'].includes(String(q.type))
          ? String(q.type)
          : 'multiple_choice';
        const options = Array.isArray(q.options)
          ? q.options
              .map((o) => safeText(o, 300))
              .filter(Boolean)
              .slice(0, 8)
          : [];
        return {
          id: crypto.randomUUID(),
          sortOrder: idx + 1,
          type,
          prompt: safeText(q.prompt, 2000),
          options: JSON.stringify(options),
          correctAnswer: safeText(q.correctAnswer, 1000),
          rubric: safeText(q.rubric, 2000),
          explanation: safeText(q.explanation, 5000),
          points: safeInteger(q.points, 1, 1, 100),
        };
      });

      if (newQuestions.some((q) => !q.prompt || !q.correctAnswer)) {
        throw new DomainError('كل سؤال يحتاج نص وإجابة صحيحة', 400);
      }

      const oldIds = await db
        .prepare('SELECT id FROM questions WHERE exam_id = ?')
        .bind(id)
        .all<{ id: string }>();

      await db.batch([
        updateStmt,
        ...oldIds.results.map((q) => db.prepare('DELETE FROM questions WHERE id = ?').bind(q.id)),
        ...newQuestions.map((q) =>
          db
            .prepare(
              `INSERT INTO questions (id, exam_id, sort_order, type, prompt, options, correct_answer, rubric, explanation, points)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              q.id,
              id,
              q.sortOrder,
              q.type,
              q.prompt,
              q.options,
              q.correctAnswer,
              q.rubric,
              q.explanation,
              q.points
            )
        ),
      ]);
    } else {
      await updateStmt.run();
    }

    await db
      .prepare(
        "DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id = ?"
      )
      .bind(id)
      .run();

    invalidatePublicCourseCache();
    return { ok: true };
  }

  async deleteExam(
    id: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();

    const exam = await db
      .prepare('SELECT id, title, teacher_file_key AS teacherFileKey FROM exams WHERE id = ?')
      .bind(id)
      .first<{ id: string; title: string; teacherFileKey?: string | null }>();

    if (!exam) {
      throw new DomainError('الامتحان غير موجود', 404);
    }

    const filesToDelete = new Set<string>();
    if (exam.teacherFileKey) {
      filesToDelete.add(exam.teacherFileKey);
    }

    const [questions, attempts] = await Promise.all([
      db
        .prepare('SELECT id, image_file_key AS imageFileKey FROM questions WHERE exam_id = ?')
        .bind(id)
        .all<{ id: string; imageFileKey?: string | null }>()
        .catch(() => ({ results: [] as { id: string; imageFileKey?: string | null }[] })),
      db
        .prepare('SELECT id, pdf_storage_key AS pdfStorageKey FROM attempts WHERE exam_id = ?')
        .bind(id)
        .all<{ id: string; pdfStorageKey?: string | null }>()
        .catch(() => ({ results: [] as { id: string; pdfStorageKey?: string | null }[] })),
    ]);

    for (const q of questions.results) {
      if (q.imageFileKey) filesToDelete.add(q.imageFileKey);
    }
    for (const a of attempts.results) {
      if (a.pdfStorageKey) filesToDelete.add(a.pdfStorageKey);
    }

    try {
      await db.batch([
        // 1. Unlink prerequisite on any videos gating on this exam
        db
          .prepare('UPDATE videos SET prerequisite_exam_id = NULL, minimum_score = 0 WHERE prerequisite_exam_id = ?')
          .bind(id),
        // 2. Notification reads
        db
          .prepare("DELETE FROM notification_reads WHERE notification_type = 'exam' AND notification_id = ?")
          .bind(id),
        // 3. Course items
        db.prepare('DELETE FROM course_items WHERE exam_id = ?').bind(id),
        // 4. Exam sessions
        db.prepare('DELETE FROM exam_sessions WHERE exam_id = ?').bind(id),
        // 5. Answers (attempts or questions)
        db
          .prepare(
            'DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id = ?) OR question_id IN (SELECT id FROM questions WHERE exam_id = ?)'
          )
          .bind(id, id),
        // 6. Attempts
        db.prepare('DELETE FROM attempts WHERE exam_id = ?').bind(id),
        // 7. Questions
        db.prepare('DELETE FROM questions WHERE exam_id = ?').bind(id),
        // 8. Exam itself
        db.prepare('DELETE FROM exams WHERE id = ?').bind(id),
      ]);
    } catch (error) {
      captureException(error, { module: 'admin-exam-force-delete', examId: id });
      throw new DomainError('فشل حذف الامتحان وبياناته التابعة.', 500);
    }

    const storage = context?.storage ?? getPrivateStorage();
    for (const key of filesToDelete) {
      try {
        await storage.delete(key);
      } catch (storageError) {
        captureException(storageError, { module: 'exam-delete-storage', storageKey: key, examId: id });
      }
    }

    await recordAuditLog({
      userEmail: operator.email,
      action: 'exam.force_deleted',
      resource: 'exam',
      resourceId: id,
      details: { title: exam.title },
      request: context?.request,
    });

    invalidatePublicCourseCache();
    return { ok: true };
  }

  async uploadExamFile(
    id: string,
    fileBytes: ArrayBuffer,
    mimeType: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; key: string }> {
    const db = context?.db ?? getDatabase();
    const exam = await db.prepare('SELECT id FROM exams WHERE id = ?').bind(id).first();
    if (!exam) {
      throw new DomainError('الامتحان غير موجود', 404);
    }

    if (fileBytes.byteLength > MAX_PDF_SIZE) {
      throw new DomainError('حجم الملف يتجاوز الحد الأقصى (15 ميجابايت)', 400);
    }
    if (!isPdfUpload(mimeType, fileBytes)) {
      throw new DomainError('يجب رفع ملف PDF صالح فقط', 400);
    }

    const storage = context?.storage ?? getPrivateStorage();
    const storageKey = `exams/${id}/teacher.pdf`;

    await storage.delete(storageKey).catch(() => undefined);
    await storage.put(storageKey, new Uint8Array(fileBytes), {
      httpMetadata: { contentType: 'application/pdf', contentDisposition: 'inline' },
      customMetadata: { uploadedBy: operator.email },
    });

    try {
      await db
        .prepare('UPDATE exams SET teacher_file_key = ? WHERE id = ?')
        .bind(storageKey, id)
        .run();
    } catch {
      await storage.delete(storageKey).catch(() => undefined);
      throw new DomainError('تعذر حفظ ملف الامتحان', 500);
    }

    return { ok: true, key: storageKey };
  }

  async deleteExamFile(
    id: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();
    const exam = await db.prepare('SELECT id FROM exams WHERE id = ?').bind(id).first();
    if (!exam) {
      throw new DomainError('الامتحان غير موجود', 404);
    }

    const storage = context?.storage ?? getPrivateStorage();
    await storage.delete(`exams/${id}/teacher.pdf`).catch(() => undefined);

    await db
      .prepare('UPDATE exams SET teacher_file_key = NULL WHERE id = ?')
      .bind(id)
      .run();

    return { ok: true };
  }

  /* ──────────────────────────────────────────────────────────────────────────
     ASSIGNMENTS
     ────────────────────────────────────────────────────────────────────────── */

  async createAssignment(
    input: CreateAssignmentInput,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; id: string }> {
    const courseId = safeText(input.courseId, 80);
    const title = safeText(input.title, 150);
    const description = safeText(input.description, 3000);
    const dueAt = optionalTimestamp(input.dueAt);
    const maxScore = safeInteger(input.maxScore, 0, 0, 10_000);
    const status = input.status === 'published' ? 'published' : 'draft';
    const type = input.type === 'mcq' ? 'mcq' : input.type === 'generic' ? 'generic' : 'pdf';

    if (!courseId || title.length < 3) {
      throw new DomainError('اختر الكورس وأدخل عنواناً صحيحاً للواجب', 400);
    }
    if (input.dueAt !== undefined && dueAt === undefined) {
      throw new DomainError('موعد تسليم الواجب غير صالح', 400);
    }

    const db = context?.db ?? getDatabase();
    const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) {
      throw new DomainError('الكورس المحدد غير موجود', 404);
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await db
      .prepare(
        `INSERT INTO assignments
         (id, course_id, title, description, due_at, max_score, status, type, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, courseId, title, description, dueAt ?? null, maxScore, status, type, operator.email, now, now)
      .run();

    return { ok: true, id };
  }

  async updateAssignment(
    id: string,
    input: UpdateAssignmentInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();
    const existing = await db
      .prepare(
        `SELECT course_id AS courseId, title, description, due_at AS dueAt,
         max_score AS maxScore, status, COALESCE(type, 'pdf') AS type FROM assignments WHERE id = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();

    if (!existing) {
      throw new DomainError('الواجب غير موجود', 404);
    }

    const courseId = safeText(input.courseId ?? existing.courseId, 80);
    const title = safeText(input.title ?? existing.title, 150);
    const description = safeText(input.description ?? existing.description, 3000);
    const dueAt = optionalTimestamp(input.dueAt === undefined ? existing.dueAt : input.dueAt);
    const maxScore = safeInteger(input.maxScore ?? existing.maxScore, 0, 0, 10_000);
    const status =
      input.status === undefined
        ? String(existing.status)
        : input.status === 'published'
          ? 'published'
          : 'draft';
    const rawType = input.type === undefined ? String(existing.type) : String(input.type);
    const type = rawType === 'mcq' ? 'mcq' : rawType === 'generic' ? 'generic' : 'pdf';

    if (!courseId || title.length < 3) {
      throw new DomainError('بيانات الواجب غير مكتملة', 400);
    }
    if (dueAt === undefined) {
      throw new DomainError('موعد تسليم الواجب غير صالح', 400);
    }

    const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
    if (!course) {
      throw new DomainError('الكورس المحدد غير موجود', 404);
    }

    await db
      .prepare(
        `UPDATE assignments SET course_id = ?, title = ?, description = ?, due_at = ?,
         max_score = ?, status = ?, type = ?, updated_at = ? WHERE id = ?`
      )
      .bind(courseId, title, description, dueAt, maxScore, status, type, Date.now(), id)
      .run();

    await db
      .prepare(
        "DELETE FROM notification_reads WHERE notification_type = 'assignment' AND notification_id = ?"
      )
      .bind(id)
      .run();

    return { ok: true };
  }

  async deleteAssignment(
    id: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();
    const existing = await db
      .prepare('SELECT id, teacher_file_key AS teacherFileKey FROM assignments WHERE id = ?')
      .bind(id)
      .first<{ id: string; teacherFileKey?: string | null }>();

    if (!existing) {
      throw new DomainError('الواجب غير موجود', 404);
    }

    const storage = context?.storage ?? getPrivateStorage();
    const submissions = await db
      .prepare(
        'SELECT pdf_storage_key AS pdfStorageKey FROM assignment_submissions WHERE assignment_id = ? AND pdf_storage_key IS NOT NULL'
      )
      .bind(id)
      .all<{ pdfStorageKey: string }>()
      .catch(() => ({ results: [] as { pdfStorageKey: string }[] }));

    const filesToDelete = new Set<string>();
    if (existing.teacherFileKey) {
      filesToDelete.add(existing.teacherFileKey);
    } else {
      filesToDelete.add(`assignments/${id}/teacher.pdf`);
    }
    for (const sub of submissions.results) {
      if (sub.pdfStorageKey) filesToDelete.add(sub.pdfStorageKey);
    }

    for (const key of filesToDelete) {
      try {
        await storage.delete(key);
      } catch (error) {
        captureException(error, { module: 'assignment-delete-storage', storageKey: key, assignmentId: id });
      }
    }

    await db.batch([
      db
        .prepare(
          "DELETE FROM notification_reads WHERE notification_type = 'assignment' AND notification_id = ?"
        )
        .bind(id),
      db.prepare('DELETE FROM course_items WHERE assignment_id = ?').bind(id),
      db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').bind(id),
      db.prepare('DELETE FROM assignment_questions WHERE assignment_id = ?').bind(id),
      db.prepare('DELETE FROM assignments WHERE id = ?').bind(id),
    ]);

    await recordAuditLog({
      userEmail: operator.email,
      action: 'assignment.deleted',
      resource: 'assignment',
      resourceId: id,
      request: context?.request,
    });

    return { ok: true };
  }

  async uploadAssignmentFile(
    id: string,
    fileBytes: ArrayBuffer,
    mimeType: string,
    operator: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; key: string }> {
    const db = context?.db ?? getDatabase();
    const assignment = await db.prepare('SELECT id FROM assignments WHERE id = ?').bind(id).first();
    if (!assignment) {
      throw new DomainError('الواجب غير موجود', 404);
    }

    if (fileBytes.byteLength > MAX_PDF_SIZE) {
      throw new DomainError('حجم الملف يتجاوز الحد الأقصى (15 ميجابايت)', 400);
    }
    if (!isPdfUpload(mimeType, fileBytes)) {
      throw new DomainError('يجب رفع ملف PDF صالح فقط', 400);
    }

    const storage = context?.storage ?? getPrivateStorage();
    const storageKey = `assignments/${id}/teacher.pdf`;

    await storage.delete(storageKey).catch(() => undefined);
    await storage.put(storageKey, new Uint8Array(fileBytes), {
      httpMetadata: { contentType: 'application/pdf', contentDisposition: 'inline' },
      customMetadata: { uploadedBy: operator.email },
    });

    try {
      await db
        .prepare('UPDATE assignments SET teacher_file_key = ? WHERE id = ?')
        .bind(storageKey, id)
        .run();
    } catch {
      await storage.delete(storageKey).catch(() => undefined);
      throw new DomainError('تعذر حفظ ملف الواجب', 500);
    }

    return { ok: true, key: storageKey };
  }

  async deleteAssignmentFile(
    id: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    const db = context?.db ?? getDatabase();
    const assignment = await db.prepare('SELECT id FROM assignments WHERE id = ?').bind(id).first();
    if (!assignment) {
      throw new DomainError('الواجب غير موجود', 404);
    }

    const storage = context?.storage ?? getPrivateStorage();
    await storage.delete(`assignments/${id}/teacher.pdf`).catch(() => undefined);

    await db
      .prepare('UPDATE assignments SET teacher_file_key = NULL WHERE id = ?')
      .bind(id)
      .run();

    return { ok: true };
  }

  async getAssignmentQuestions(
    assignmentId: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ questions: unknown[] }> {
    const db = context?.db ?? getDatabase();
    const assignment = await db
      .prepare('SELECT id FROM assignments WHERE id = ?')
      .bind(assignmentId)
      .first();
    if (!assignment) {
      throw new DomainError('الواجب غير موجود', 404);
    }

    try {
      const questions = await db
        .prepare(
          `SELECT id, question, explanation, options, correct_index AS correctIndex, points, sort_order AS sortOrder,
                  image_file_key AS imageFileKey
           FROM assignment_questions WHERE assignment_id = ? ORDER BY sort_order ASC`
        )
        .bind(assignmentId)
        .all<{
          id: string;
          question: string;
          explanation: string | null;
          options: string;
          correctIndex: number;
          points: number;
          sortOrder: number;
          imageFileKey: string | null;
        }>();

      return {
        questions: questions.results.map((q) => ({
          ...q,
          explanation: q.explanation || null,
          options: JSON.parse(q.options) as string[],
          imageFileKey: q.imageFileKey || null,
          hasImage: q.imageFileKey != null,
        })),
      };
    } catch {
      return { questions: [] };
    }
  }

  async createAssignmentQuestion(
    assignmentId: string,
    input: CreateAssignmentQuestionInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; id: string }> {
    const question = safeText(input.question, 2000);
    const explanation = safeText(input.explanation, 3000);
    const options = Array.isArray(input.options)
      ? (input.options as unknown[])
          .slice(0, 6)
          .map((opt) => safeText(opt, 500))
          .filter(Boolean)
      : [];
    const correctIndex = safeInteger(input.correctIndex, 0, 0, options.length - 1);
    const points = safeInteger(input.points, 1, 1, 100);
    const sortOrder = safeInteger(input.sortOrder, 0, 0, 9999);

    if (question.length < 3) {
      throw new DomainError('نص السؤال قصير جداً', 400);
    }
    if (options.length < 2) {
      throw new DomainError('يجب إدخال خيارَين على الأقل', 400);
    }

    const db = context?.db ?? getDatabase();
    const assignment = await db
      .prepare('SELECT id FROM assignments WHERE id = ?')
      .bind(assignmentId)
      .first();
    if (!assignment) {
      throw new DomainError('الواجب غير موجود', 404);
    }

    const qId = crypto.randomUUID();
    try {
      await db
        .prepare(
          `INSERT INTO assignment_questions (id, assignment_id, question, explanation, options, correct_index, points, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(qId, assignmentId, question, explanation, JSON.stringify(options), correctIndex, points, sortOrder)
        .run();
    } catch {
      throw new DomainError('جدول الأسئلة غير موجود. يرجى تشغيل الترحيل أولاً', 500);
    }

    return { ok: true, id: qId };
  }
}

export const assessmentService = new AssessmentService();
