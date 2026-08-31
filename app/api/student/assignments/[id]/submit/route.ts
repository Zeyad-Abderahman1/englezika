import { apiUser, isResponse } from '../../../../../lib/api-auth';
import { getDatabase } from '../../../../../lib/platform';
import { getPrivateStorage } from '../../../../../lib/private-storage';
import { jsonError, requireSameOrigin, safeInteger } from '../../../../../lib/security';
import { isEmailVerified } from '../../../../../lib/email-verification';
import {
  hasAllowedContentLength,
  isPdfUpload,
  MAX_JSON_BODY_SIZE,
  MAX_PDF_SIZE,
  MAX_UPLOAD_BODY_SIZE,
  stableStorageIdentifier,
} from '../../../../../lib/upload-validation';

/**
 * POST /api/student/assignments/[id]/submit
 *
 * Handles two submission types:
 * 1. PDF assignment: multipart/form-data with a 'file' field (PDF)
 * 2. MCQ assignment: application/json with an 'answers' array
 *
 * Rules:
 * - Student must be enrolled and email-verified
 * - Student may only submit once (UNIQUE constraint on assignment_id + student_email)
 * - MCQ is auto-graded server-side; score is never trusted from client
 * - PDF is stored in private storage
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await apiUser();
  if (isResponse(user)) return user;

  if (!(await isEmailVerified(user.email))) {
    return jsonError('يجب تأكيد البريد الإلكتروني أولاً', 403);
  }

  const { id } = await params;
  const db = getDatabase();
  const email = user.email.toLowerCase();

  // Fetch assignment + enrollment check
  const assignment = await db
    .prepare(
      `SELECT a.id, COALESCE(a.type, 'pdf') AS type, a.max_score AS maxScore, a.status
       FROM assignments a
       JOIN enrollments e ON e.course_id = a.course_id
       WHERE a.id = ? AND e.user_email = ? AND e.status = 'approved'
         AND a.status = 'published' LIMIT 1`
    )
    .bind(id, email)
    .first<{ id: string; type: string; maxScore: number; status: string }>();

  if (!assignment) return jsonError('الواجب غير متاح', 404);

  // Check if submissions table exists
  const tableCheck = await db
    .prepare(
      `SELECT 1 FROM information_schema.tables
       WHERE table_name = 'assignment_submissions' LIMIT 1`
    )
    .first()
    .catch(() => null);

  if (!tableCheck) {
    return jsonError('نظام التسليم غير جاهز بعد. تواصل مع المدرس.', 503);
  }

  // Check for existing submission
  const existing = await db
    .prepare('SELECT id, status FROM assignment_submissions WHERE assignment_id = ? AND student_email = ?')
    .bind(id, email)
    .first<{ id: string; status: string }>();

  if (existing) {
    return jsonError('لقد أرسلت إجابتك بالفعل. لا يمكن التسليم مرتين.', 409);
  }

  const contentType = request.headers.get('content-type') || '';
  const maximumBodySize = assignment.type === 'mcq' ? MAX_JSON_BODY_SIZE : MAX_UPLOAD_BODY_SIZE;
  if (!hasAllowedContentLength(request, maximumBodySize)) {
    return jsonError('حجم الطلب غير صالح أو يتجاوز الحد المسموح', 413);
  }
  const subId = crypto.randomUUID();
  const now = Date.now();

  if (assignment.type === 'mcq') {
    // ─── MCQ auto-grading path ────────────────────────────────────────────────
    if (!contentType.includes('application/json')) {
      return jsonError('يجب إرسال الإجابات بصيغة JSON', 400);
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rawAnswers = body.answers;
    if (!Array.isArray(rawAnswers)) return jsonError('يجب إرسال مصفوفة الإجابات', 400);

    // Load questions with correct answers
    let questions: Array<{ id: string; correctIndex: number; points: number }>;
    try {
      const qResult = await db
        .prepare(
          'SELECT id, correct_index AS correctIndex, points FROM assignment_questions WHERE assignment_id = ?'
        )
        .bind(id)
        .all<{ id: string; correctIndex: number; points: number }>();
      questions = qResult.results;
    } catch {
      return jsonError('أسئلة الواجب غير موجودة', 500);
    }

    // Build answer map from client: { questionId: chosenIndex }
    const answerMap = new Map<string, number>();
    for (const item of rawAnswers as Array<{ questionId?: unknown; answer?: unknown }>) {
      if (typeof item?.questionId === 'string' && typeof item?.answer === 'number') {
        answerMap.set(item.questionId, safeInteger(item.answer, -1, -1, 10));
      }
    }

    // Compute score
    let score = 0;
    let totalPoints = 0;
    for (const q of questions) {
      totalPoints += q.points;
      if (answerMap.get(q.id) === q.correctIndex) {
        score += q.points;
      }
    }

    const maxScore = totalPoints || assignment.maxScore;
    const answersJson = JSON.stringify(
      questions.map((q) => ({ questionId: q.id, chosen: answerMap.get(q.id) ?? -1 }))
    );

    await db
      .prepare(
        `INSERT INTO assignment_submissions
         (id, assignment_id, student_email, mcq_answers, score, max_score,
          submitted_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'graded')`
      )
      .bind(subId, id, email, answersJson, score, maxScore, now)
      .run();

    return Response.json({ ok: true, score, maxScore, percentage: maxScore > 0 ? Math.round((score * 100) / maxScore) : 0 });
  } else {
    // ─── PDF submission path ───────────────────────────────────────────────────
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return jsonError('يجب رفع ملف PDF عبر form-data', 400);
    }
    const formData = await request.formData().catch(() => null);
    if (!formData) return jsonError('تعذر قراءة البيانات', 400);
    const file = formData.get('file');
    if (!(file instanceof Blob)) return jsonError('لم يتم اختيار ملف', 400);

    const mimeType = file.type || '';
    const fileBytes = await file.arrayBuffer();
    if (fileBytes.byteLength > MAX_PDF_SIZE) {
      return jsonError('حجم الملف يتجاوز الحد الأقصى (15 ميجابايت)', 400);
    }
    if (!isPdfUpload(mimeType, fileBytes)) {
      return jsonError('يجب رفع ملف PDF صالح فقط', 400);
    }

    const storageIdentifier = await stableStorageIdentifier(email);
    const storageKey = `assignments/${id}/submissions/${storageIdentifier}-${subId}.pdf`;
    const storage = getPrivateStorage();
    await storage.put(storageKey, new Uint8Array(fileBytes), {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { studentEmail: email, assignmentId: id },
    });

    try {
      await db
        .prepare(
          `INSERT INTO assignment_submissions
           (id, assignment_id, student_email, pdf_storage_key, submitted_at, status)
           VALUES (?, ?, ?, ?, ?, 'submitted')`
        )
        .bind(subId, id, email, storageKey, now)
        .run();
    } catch (error) {
      await storage.delete(storageKey).catch(() => undefined);
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        return jsonError('لقد أرسلت إجابتك بالفعل. لا يمكن التسليم مرتين.', 409);
      }
      throw error;
    }

    return Response.json({ ok: true, submissionId: subId });
  }
}
