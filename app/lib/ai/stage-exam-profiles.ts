/**
 * Egyptian School Stages Exam Profiles & Blueprint Engine
 * Supports Primary, Preparatory, Secondary, and Grade 12 (Thanaweya Amma).
 */

export type SchoolStage = 'primary' | 'preparatory' | 'secondary' | 'thanaweya';

export type SchoolGrade =
  | 'primary_1'
  | 'primary_2'
  | 'primary_3'
  | 'primary_4'
  | 'primary_5'
  | 'primary_6'
  | 'prep_1'
  | 'prep_2'
  | 'prep_3'
  | 'sec_1'
  | 'sec_2'
  | 'sec_3';

export type ExamPreset =
  | 'school_simple_exam'
  | 'unit_test'
  | 'worksheet_quiz'
  | 'monthly_exam'
  | 'midterm_exam'
  | 'final_exam'
  | 'thanaweya_mock';

export type SectionType =
  | 'listening'
  | 'vocabulary'
  | 'grammar'
  | 'reading'
  | 'writing'
  | 'dialogue'
  | 'translation'
  | 'mixed';

export type QuestionType =
  | 'mcq'
  | 'mcq_two_correct'
  | 'circle_word'
  | 'match'
  | 'complete'
  | 'reorder'
  | 'dialogue_complete'
  | 'reading_comprehension'
  | 'find_mistake'
  | 'rewrite'
  | 'short_writing'
  | 'translation'
  | 'listening_mcq'
  | 'listening_complete';

export interface StageGradeInfo {
  grade: SchoolGrade;
  stage: SchoolStage;
  labelAr: string;
  labelEn: string;
  defaultTimeMinutes: number;
  typicalPassageWordCount: { min: number; max: number };
}

export const SCHOOL_GRADES: Record<SchoolGrade, StageGradeInfo> = {
  primary_1: { grade: 'primary_1', stage: 'primary', labelAr: 'الصف الأول الابتدائي', labelEn: 'Primary 1', defaultTimeMinutes: 30, typicalPassageWordCount: { min: 20, max: 40 } },
  primary_2: { grade: 'primary_2', stage: 'primary', labelAr: 'الصف الثاني الابتدائي', labelEn: 'Primary 2', defaultTimeMinutes: 35, typicalPassageWordCount: { min: 30, max: 50 } },
  primary_3: { grade: 'primary_3', stage: 'primary', labelAr: 'الصف الثالث الابتدائي', labelEn: 'Primary 3', defaultTimeMinutes: 40, typicalPassageWordCount: { min: 40, max: 60 } },
  primary_4: { grade: 'primary_4', stage: 'primary', labelAr: 'الصف الرابع الابتدائي', labelEn: 'Primary 4', defaultTimeMinutes: 45, typicalPassageWordCount: { min: 50, max: 80 } },
  primary_5: { grade: 'primary_5', stage: 'primary', labelAr: 'الصف الخامس الابتدائي', labelEn: 'Primary 5', defaultTimeMinutes: 45, typicalPassageWordCount: { min: 60, max: 90 } },
  primary_6: { grade: 'primary_6', stage: 'primary', labelAr: 'الصف السادس الابتدائي', labelEn: 'Primary 6', defaultTimeMinutes: 45, typicalPassageWordCount: { min: 70, max: 100 } },
  prep_1: { grade: 'prep_1', stage: 'preparatory', labelAr: 'الصف الأول الإعدادي', labelEn: 'Prep 1', defaultTimeMinutes: 60, typicalPassageWordCount: { min: 100, max: 130 } },
  prep_2: { grade: 'prep_2', stage: 'preparatory', labelAr: 'الصف الثاني الإعدادي', labelEn: 'Prep 2', defaultTimeMinutes: 60, typicalPassageWordCount: { min: 120, max: 150 } },
  prep_3: { grade: 'prep_3', stage: 'preparatory', labelAr: 'الصف الثالث الإعدادي', labelEn: 'Prep 3 (Cert)', defaultTimeMinutes: 90, typicalPassageWordCount: { min: 140, max: 180 } },
  sec_1: { grade: 'sec_1', stage: 'secondary', labelAr: 'الصف الأول الثانوي', labelEn: 'Secondary 1', defaultTimeMinutes: 90, typicalPassageWordCount: { min: 180, max: 240 } },
  sec_2: { grade: 'sec_2', stage: 'secondary', labelAr: 'الصف الثاني الثانوي', labelEn: 'Secondary 2', defaultTimeMinutes: 90, typicalPassageWordCount: { min: 200, max: 280 } },
  sec_3: { grade: 'sec_3', stage: 'thanaweya', labelAr: 'الصف الثالث الثانوي (الثانوية العامة)', labelEn: 'Secondary 3 (Thanaweya)', defaultTimeMinutes: 180, typicalPassageWordCount: { min: 250, max: 350 } },
};

export interface StageProfileDefinition {
  stage: SchoolStage;
  titleAr: string;
  titleEn: string;
  allowedGrades: SchoolGrade[];
  allowedSections: SectionType[];
  allowedQuestionTypes: QuestionType[];
  forbiddenQuestionTypes: QuestionType[];
  writingWordCountGuide: { min: number; max: number };
  supportsTranslation: boolean;
  supportsDialogue: boolean;
  supportsRewrite: boolean;
  supportsTwoCorrectMCQ: boolean;
  cognitiveLevelDescription: string;
}

export const STAGE_PROFILES: Record<SchoolStage, StageProfileDefinition> = {
  primary: {
    stage: 'primary',
    titleAr: 'المرحلة الابتدائية',
    titleEn: 'Primary Stage (P1-P6)',
    allowedGrades: ['primary_1', 'primary_2', 'primary_3', 'primary_4', 'primary_5', 'primary_6'],
    allowedSections: ['listening', 'vocabulary', 'grammar', 'reading', 'writing'],
    allowedQuestionTypes: [
      'mcq',
      'circle_word',
      'match',
      'complete',
      'reorder',
      'reading_comprehension',
      'short_writing',
      'listening_mcq',
      'listening_complete',
    ],
    forbiddenQuestionTypes: [
      'translation',
      'rewrite',
      'find_mistake',
      'dialogue_complete',
      'mcq_two_correct',
    ],
    writingWordCountGuide: { min: 15, max: 40 },
    supportsTranslation: false,
    supportsDialogue: false,
    supportsRewrite: false,
    supportsTwoCorrectMCQ: false,
    cognitiveLevelDescription: 'Simple, concrete, age-appropriate. Everyday vocabulary (family, animals, food, home, school). Simple sentences, no abstract grammar theory.',
  },
  preparatory: {
    stage: 'preparatory',
    titleAr: 'المرحلة الإعدادية',
    titleEn: 'Preparatory Stage (Prep 1-3)',
    allowedGrades: ['prep_1', 'prep_2', 'prep_3'],
    allowedSections: ['listening', 'dialogue', 'reading', 'vocabulary', 'grammar', 'writing', 'translation'],
    allowedQuestionTypes: [
      'mcq',
      'dialogue_complete',
      'match',
      'complete',
      'reorder',
      'reading_comprehension',
      'find_mistake',
      'short_writing',
      'translation',
      'listening_mcq',
      'listening_complete',
    ],
    forbiddenQuestionTypes: ['mcq_two_correct', 'rewrite'],
    writingWordCountGuide: { min: 70, max: 90 },
    supportsTranslation: true,
    supportsDialogue: true,
    supportsRewrite: false,
    supportsTwoCorrectMCQ: false,
    cognitiveLevelDescription: 'Structured school paper. Plausible distractors. Everyday conversational exchanges. Paragraph or guided email writing of 80-90 words. Short straightforward translation.',
  },
  secondary: {
    stage: 'secondary',
    titleAr: 'المرحلة الثانوية العامة (أولى وتانية ثانوي)',
    titleEn: 'General Secondary (Sec 1-2)',
    allowedGrades: ['sec_1', 'sec_2'],
    allowedSections: ['vocabulary', 'grammar', 'reading', 'writing', 'translation', 'listening'],
    allowedQuestionTypes: [
      'mcq',
      'mcq_two_correct',
      'reading_comprehension',
      'find_mistake',
      'rewrite',
      'short_writing',
      'translation',
      'listening_mcq',
    ],
    forbiddenQuestionTypes: ['circle_word', 'match'],
    writingWordCountGuide: { min: 140, max: 180 },
    supportsTranslation: true,
    supportsDialogue: false,
    supportsRewrite: true,
    supportsTwoCorrectMCQ: true,
    cognitiveLevelDescription: 'Contextual vocabulary and grammar application. Sophisticated distractors. Deep reading comprehension with inference. Sentence transformation and formal translation.',
  },
  thanaweya: {
    stage: 'thanaweya',
    titleAr: 'الثانوية العامة (الصف الثالث الثانوي)',
    titleEn: 'Grade 12 / Thanaweya Amma (Sec 3)',
    allowedGrades: ['sec_3'],
    allowedSections: ['vocabulary', 'grammar', 'reading', 'translation', 'writing'],
    allowedQuestionTypes: [
      'mcq',
      'mcq_two_correct',
      'reading_comprehension',
      'short_writing',
      'translation',
    ],
    forbiddenQuestionTypes: ['circle_word', 'match', 'dialogue_complete', 'reorder', 'complete'],
    writingWordCountGuide: { min: 180, max: 220 },
    supportsTranslation: true,
    supportsDialogue: false,
    supportsRewrite: false,
    supportsTwoCorrectMCQ: true,
    cognitiveLevelDescription: 'Official Ministry specification: High cognitive level, rigorous distractors, two-correct MCQs (5 choices), long inferential passages, advanced translation, essay prompt with analytical depth.',
  },
};

export interface PresetConfig {
  preset: ExamPreset;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  defaultQuestionCount: number;
  defaultTimeMinutes: number;
  defaultTotalMarks: number;
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  sections: SectionType[];
  formalityLevel: 'informal_quiz' | 'standard_test' | 'official_paper';
}

export const EXAM_PRESETS: Record<ExamPreset, PresetConfig> = {
  school_simple_exam: {
    preset: 'school_simple_exam',
    titleAr: 'امتحان مدرسي بسيط',
    titleEn: 'Simple School Exam',
    descriptionAr: 'ورقة امتحانية بسيطة وسريعة تغطي المفردات والقواعد والقراءة المناسبة للمستوى.',
    defaultQuestionCount: 10,
    defaultTimeMinutes: 45,
    defaultTotalMarks: 30,
    defaultDifficulty: 'medium',
    sections: ['vocabulary', 'grammar', 'reading'],
    formalityLevel: 'standard_test',
  },
  unit_test: {
    preset: 'unit_test',
    titleAr: 'اختبار وحدة دراسية',
    titleEn: 'Unit Test',
    descriptionAr: 'اختبار متوازن يركز على الكلمات والقواعد المقررة بالوحدة مع سؤال قراءة أو كتابة.',
    defaultQuestionCount: 15,
    defaultTimeMinutes: 45,
    defaultTotalMarks: 20,
    defaultDifficulty: 'medium',
    sections: ['vocabulary', 'grammar', 'reading', 'writing'],
    formalityLevel: 'standard_test',
  },
  worksheet_quiz: {
    preset: 'worksheet_quiz',
    titleAr: 'ورقة عمل / كويز قصير',
    titleEn: 'Worksheet / Short Quiz',
    descriptionAr: 'تدريب سريع ومباشر للتأكد من استيعاب النقاط الرئيسية في دقائق معدودة.',
    defaultQuestionCount: 5,
    defaultTimeMinutes: 15,
    defaultTotalMarks: 10,
    defaultDifficulty: 'easy',
    sections: ['vocabulary', 'grammar'],
    formalityLevel: 'informal_quiz',
  },
  monthly_exam: {
    preset: 'monthly_exam',
    titleAr: 'امتحان شهري (أكتوبر / نوفمبر / مارس)',
    titleEn: 'Monthly School Exam',
    descriptionAr: 'اختبار شهر رسمي مطابق لنظام التقييم الشهري بمدارس جمهورية مصر العربية.',
    defaultQuestionCount: 15,
    defaultTimeMinutes: 60,
    defaultTotalMarks: 30,
    defaultDifficulty: 'medium',
    sections: ['vocabulary', 'grammar', 'reading', 'writing'],
    formalityLevel: 'standard_test',
  },
  midterm_exam: {
    preset: 'midterm_exam',
    titleAr: 'امتحان نصف الفصل الدراسي',
    titleEn: 'Midterm Exam',
    descriptionAr: 'اختبار موسع وشامل لنصف المنهج الدراسي مع توزيع درجات متكامل.',
    defaultQuestionCount: 20,
    defaultTimeMinutes: 90,
    defaultTotalMarks: 40,
    defaultDifficulty: 'medium',
    sections: ['listening', 'dialogue', 'vocabulary', 'grammar', 'reading', 'writing', 'translation'],
    formalityLevel: 'official_paper',
  },
  final_exam: {
    preset: 'final_exam',
    titleAr: 'امتحان نهاية الفصل الدراسي',
    titleEn: 'Final Term Exam',
    descriptionAr: 'الامتحان النهائي الرسمي الكامل وفق مواصفات الورقة الامتحانية لوزارة التربية والتعليم.',
    defaultQuestionCount: 25,
    defaultTimeMinutes: 120,
    defaultTotalMarks: 50,
    defaultDifficulty: 'hard',
    sections: ['listening', 'dialogue', 'vocabulary', 'grammar', 'reading', 'writing', 'translation'],
    formalityLevel: 'official_paper',
  },
  thanaweya_mock: {
    preset: 'thanaweya_mock',
    titleAr: 'نموذج محاكاة للثانوية العامة',
    titleEn: 'Thanaweya Amma Official Mock',
    descriptionAr: 'نموذج مطابق لمواصفات المركز القومي للامتحانات لشهادة إتمام الثانوية العامة المصرية.',
    defaultQuestionCount: 35,
    defaultTimeMinutes: 180,
    defaultTotalMarks: 50,
    defaultDifficulty: 'hard',
    sections: ['vocabulary', 'grammar', 'reading', 'translation', 'writing'],
    formalityLevel: 'official_paper',
  },
};

export const QUESTION_INSTRUCTIONS_EN: Record<QuestionType, string> = {
  mcq: 'Choose the correct answer from a, b, c or d:',
  mcq_two_correct: 'Choose the TWO correct answers out of the FIVE options given:',
  circle_word: 'Circle the odd word out or the correct word:',
  match: 'Match the words in Column (A) with their appropriate meanings/sentences in Column (B):',
  complete: 'Complete the following sentences using words from the list:',
  reorder: 'Reorder the following words to form correct, meaningful sentences:',
  dialogue_complete: 'Complete the following dialogue between the two speakers:',
  reading_comprehension: 'Read the following passage carefully, then answer the questions below:',
  find_mistake: 'Read the following sentences, find the mistake in each, and correct it:',
  rewrite: 'Rewrite the following sentences using the word(s) in brackets to give the same meaning:',
  short_writing: 'Write a well-organized paragraph on the following topic:',
  translation: 'Translate the following into English / Arabic:',
  listening_mcq: 'Listen to the recording and choose the correct answer from a, b, c or d:',
  listening_complete: 'Listen to the recording and complete the missing information:',
};

export const QUESTION_INSTRUCTIONS_AR: Record<QuestionType, string> = {
  mcq: 'اختر الإجابة الصحيحة من بين (a, b, c, d):',
  mcq_two_correct: 'اختر إجابتين صحيحتين من بين الاختيارات الخمسة المعطاة:',
  circle_word: 'ضع دائرة حول الكلمة المختلفة أو الصحيحة:',
  match: 'صل من العمود (أ) ما يناسبه من العمود (ب):',
  complete: 'أكمل الجمل التالية باستخدام الكلمات المعطاة:',
  reorder: 'أعد ترتيب الكلمات لتكوين جمل مفيدة وصحيحة:',
  dialogue_complete: 'أكمل المحادثة التالية بين الطرفين:',
  reading_comprehension: 'اقرأ القطعة التالية بعناية ثم أجب عن الأسئلة:',
  find_mistake: 'اكتشف الخطأ في كل جملة وصححه:',
  rewrite: 'أعد كتابة الجمل باستخدام الكلمات بين الأقواس مع الحفاظ على نفس المعنى:',
  short_writing: 'اكتب فقرة إنشائية منظمة حول الموضوع التالي:',
  translation: 'ترجم ما يلي إلى الإنجليزية / العربية:',
  listening_mcq: 'استمع إلى نص الاستماع واختر الإجابة الصحيحة:',
  listening_complete: 'استمع إلى نص الاستماع وأكمل البيانات الناقصة:',
};

export const SECTION_TITLES_EN: Record<SectionType, string> = {
  listening: 'A. Listening Comprehension',
  dialogue: 'B. Language Functions (Dialogue)',
  vocabulary: 'C. Vocabulary in Context',
  grammar: 'D. Structure & Grammar',
  reading: 'E. Reading Comprehension',
  writing: 'F. Guided Writing & Composition',
  translation: 'G. Translation Skills',
  mixed: 'Vocabulary & Language Practice',
};

export const SECTION_TITLES_AR: Record<SectionType, string> = {
  listening: 'أولاً: الاستماع (Listening)',
  dialogue: 'ثانياً: الوظائف اللغوية والمحادثة (Dialogue)',
  vocabulary: 'ثالثاً: المفردات اللغوية (Vocabulary)',
  grammar: 'رابعاً: القواعد والتراكيب (Grammar)',
  reading: 'خامساً: القراءة والفهم (Reading)',
  writing: 'سادساً: التعبير والكتابة (Writing)',
  translation: 'سابعاً: مهارات الترجمة (Translation)',
  mixed: 'المفردات والتراكيب اللغوية',
};

/**
 * Returns the SchoolStage for any given SchoolGrade.
 */
export function getStageForGrade(grade: SchoolGrade): SchoolStage {
  const info = SCHOOL_GRADES[grade];
  if (!info) {
    if (grade.startsWith('primary_')) return 'primary';
    if (grade.startsWith('prep_')) return 'preparatory';
    if (grade === 'sec_3') return 'thanaweya';
    return 'secondary';
  }
  return info.stage;
}

/**
 * Validates whether a question type is allowed for a given stage.
 */
export function isQuestionTypeAllowedForStage(arg1: any, arg2: any): boolean {
  const stages = ['primary', 'preparatory', 'secondary', 'thanaweya'];
  const stage = stages.includes(arg1) ? arg1 : arg2;
  const qType = stage === arg1 ? arg2 : arg1;
  const profile = STAGE_PROFILES[stage as SchoolStage];
  if (!profile) return false;
  if (profile.forbiddenQuestionTypes.includes(qType)) return false;
  return profile.allowedQuestionTypes.includes(qType);
}

/**
 * Returns stage-appropriate sections for a given preset and stage.
 */
export function getAvailableSectionsForStage(stage: SchoolStage): SectionType[] {
  const profile = STAGE_PROFILES[stage];
  return profile ? [...profile.allowedSections] : ['vocabulary', 'grammar', 'reading'];
}

/**
 * Resolves default sections for a preset filtered by stage capability.
 */
export function resolvePresetSections(arg1: any, arg2: any): SectionType[] {
  const stages = ['primary', 'preparatory', 'secondary', 'thanaweya'];
  const stage: SchoolStage = stages.includes(arg1) ? arg1 : arg2;
  const preset: ExamPreset = stage === arg1 ? arg2 : arg1;
  const presetConfig = EXAM_PRESETS[preset];
  const allowed = getAvailableSectionsForStage(stage);
  if (!presetConfig) return allowed.slice(0, 3);

  const filtered = presetConfig.sections.filter((s) => allowed.includes(s));
  return filtered.length > 0 ? filtered : allowed.slice(0, 3);
}

export interface StageSectionAllocation {
  sectionType: SectionType;
  questionCount: number;
  marksPerQuestion: number;
  totalSectionMarks: number;
}

/**
 * Allocates requested total questions across requested sections deterministically.
 */
export function allocateStageSections(
  stage: SchoolStage,
  arg2: any,
  arg3?: any,
  totalMarks?: number
): StageSectionAllocation[] {
  const totalQuestions: number = typeof arg2 === 'number' ? arg2 : (typeof arg3 === 'number' ? arg3 : 10);
  const requestedSections: SectionType[] | undefined = Array.isArray(arg2) ? arg2 : (Array.isArray(arg3) ? arg3 : undefined);
  const available = getAvailableSectionsForStage(stage);
  const activeSections =
    requestedSections && requestedSections.length > 0
      ? requestedSections.filter((s) => available.includes(s))
      : available.slice(0, 4);

  const sectionsToUse = activeSections.length > 0 ? activeSections : available.slice(0, 3);
  const n = sectionsToUse.length;
  const count = Math.max(1, totalQuestions);

  const basePerSection = Math.floor(count / n);
  let remainder = count % n;

  const marksTarget = totalMarks || count * 2;
  const rawMarksPerQ = Math.max(1, Math.round(marksTarget / count));

  return sectionsToUse.map((sec, idx) => {
    const qCount = basePerSection + (idx < remainder ? 1 : 0);
    return {
      sectionType: sec,
      questionCount: qCount,
      marksPerQuestion: rawMarksPerQ,
      totalSectionMarks: qCount * rawMarksPerQ,
    };
  });
}
