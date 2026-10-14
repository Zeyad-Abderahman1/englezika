import { safeInteger, safeText } from './security';

export type RawQuestion = Record<string, unknown>;

export type ParsedExamQuestion = {
  type: string;
  prompt: string;
  correctAnswer: string;
  rubric: string;
  points: number;
  options: string[];
  sortOrder: number;
};

export function parseQuestion(question: RawQuestion, sortOrder: number): ParsedExamQuestion {
  const rawType = String(question.type || 'multiple_choice').toLowerCase();
  const type =
    rawType === 'true_false' || rawType === 'short_answer' ? rawType : 'multiple_choice';
  const prompt = safeText(question.prompt, 2000);
  const correctAnswer = safeText(question.correctAnswer ?? question.correct_answer, 1000);
  const rubric = safeText(question.rubric, 2000);
  const points = safeInteger(question.points, 1, 1, 100);
  const options = Array.isArray(question.options)
    ? question.options
        .map((option) => safeText(option, 300))
        .filter(Boolean)
        .slice(0, 8)
    : type === 'true_false'
      ? ['True', 'False']
      : [];
  return { type, prompt, correctAnswer, rubric, points, options, sortOrder };
}

export function validateQuestion(question: ParsedExamQuestion): string | null {
  if (!question.prompt || !question.correctAnswer) {
    return 'أضف سؤالاً واحداً على الأقل مع الإجابة الصحيحة';
  }
  if (question.type === 'multiple_choice') {
    if (question.options.length < 2) {
      return 'كل سؤال اختيار من متعدد يحتاج اختيارين على الأقل';
    }
    if (!question.options.includes(question.correctAnswer)) {
      return 'اختر الإجابة الصحيحة من اختيارات السؤال لكل الأسئلة';
    }
  }
  return null;
}
