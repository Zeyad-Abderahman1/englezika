import { NextResponse } from 'next/server';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import {
  generateStageExam,
  type StageExamGenerateOptions,
} from '../../../../lib/ai/stage-exam-generator';
import {
  SCHOOL_GRADES,
  EXAM_PRESETS,
  type SchoolGrade,
  type SchoolStage,
  type ExamPreset,
  type SectionType,
} from '../../../../lib/ai/stage-exam-profiles';

export const runtime = 'nodejs';

/**
 * POST /api/admin/ai/generate-stage-exam
 * Generates official Egyptian school English exams across all school stages.
 * Requires staff auth ('manage_exams').
 *
 * Security & Integrity:
 * - allowFallback is strictly hard-coded to FALSE for all API calls (cannot be enabled by client).
 * - Single Canonical Extraction: validates tempFileId (UUID) and passes it directly to generateStageExam.
 *   Does NOT independently extract PDF in route to prevent text duplication.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError('صيغة الطلب غير صالحة غير مطابق لـ JSON', 400);
  }

  const grade = body.grade as SchoolGrade;
  if (!grade || !SCHOOL_GRADES[grade]) {
    return jsonError('يجب تحديد مرحلة دراسية صالحة (الصف الدراسي)', 400);
  }

  const requestedQuestionCount =
    typeof body.questionCount === 'number'
      ? Math.min(60, Math.max(1, body.questionCount))
      : undefined;

  const preset = (body.preset && EXAM_PRESETS[body.preset as ExamPreset]
    ? body.preset
    : undefined) as ExamPreset | undefined;

  const validDifficulties = ['easy', 'medium', 'hard'] as const;
  const difficulty = validDifficulties.includes(body.difficulty)
    ? body.difficulty
    : undefined;

  const tempFileId = typeof body.tempFileId === 'string' ? body.tempFileId.trim() : null;
  if (tempFileId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tempFileId)) {
    return jsonError('معرف الملف المؤقت غير صالح', 400);
  }

  const referenceText = typeof body.referenceText === 'string' && body.referenceText.trim()
    ? body.referenceText.trim()
    : undefined;

  const options: StageExamGenerateOptions = {
    grade,
    stage: body.stage as SchoolStage | undefined,
    preset,
    term: body.term === 'term_2' ? 'term_2' : 'term_1',
    unit: typeof body.unit === 'string' ? body.unit.trim() : undefined,
    requestedQuestionCount,
    requestedSections: Array.isArray(body.sections) ? (body.sections as SectionType[]) : undefined,
    difficulty,
    timeMinutes: typeof body.timeMinutes === 'number' ? body.timeMinutes : undefined,
    totalMarks: typeof body.totalMarks === 'number' ? body.totalMarks : undefined,
    title: typeof body.title === 'string' ? body.title.trim() : undefined,
    schoolName: typeof body.schoolName === 'string' ? body.schoolName.trim() : undefined,
    governorate: typeof body.governorate === 'string' ? body.governorate.trim() : undefined,
    referenceText,
    tempFileId: tempFileId || undefined,
    unitTopic: typeof body.unitTopic === 'string' ? body.unitTopic.trim() : (typeof body.unit === 'string' ? body.unit.trim() : undefined),
    isGeneralPractice: Boolean(body.isGeneralPractice),
    // CRITICAL SECURITY CONSTRAINT: allowFallback is NEVER allowed from client body
    allowFallback: false,
    courseId: typeof body.courseId === 'string' ? body.courseId.trim() : undefined,
    lectureId: typeof body.lectureId === 'string' ? body.lectureId.trim() : undefined,
    lectureIds: Array.isArray(body.lectureIds) ? body.lectureIds.filter((id: any) => typeof id === 'string') : undefined,
  };

  try {
    const exam = await generateStageExam(options);
    return NextResponse.json({
      ok: true,
      exam,
    });
  } catch (error: any) {
    console.error('[GenerateStageExam API Error]:', error);
    return jsonError(
      error?.message || 'فشل في إنشاء نموذج الامتحان للمرحلة الدراسية',
      500
    );
  }
}
