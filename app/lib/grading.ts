export type WrittenGradingInput = {
  questionId: string;
  prompt: string;
  answer: string;
  correctAnswer: string;
  rubric: string;
  points: number;
};

export type WrittenGrade = {
  questionId: string;
  score: number;
  feedback: string;
};

function normalizedTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("en")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function fallbackGrade(item: WrittenGradingInput): WrittenGrade {
  const answer = new Set(normalizedTokens(item.answer));
  const expected = [...new Set(normalizedTokens(`${item.correctAnswer} ${item.rubric}`))];
  if (!item.answer.trim()) {
    return { questionId: item.questionId, score: 0, feedback: "لم تتم الإجابة عن هذا السؤال." };
  }
  const exact = item.answer.trim().toLocaleLowerCase("en") === item.correctAnswer.trim().toLocaleLowerCase("en");
  const coverage = expected.length ? expected.filter((token) => answer.has(token)).length / expected.length : 0;
  const score = exact ? item.points : Math.round(item.points * Math.min(1, coverage * 1.35));
  return {
    questionId: item.questionId,
    score,
    feedback: score >= item.points * 0.7
      ? "إجابة جيدة وتغطي أغلب عناصر الإجابة المطلوبة."
      : `راجع الإجابة النموذجية وركّز على: ${item.correctAnswer.slice(0, 180)}`,
  };
}

export async function gradeWrittenAnswers(items: WrittenGradingInput[]): Promise<{
  grades: WrittenGrade[];
  method: "rules";
}> {
  return { grades: items.map(fallbackGrade), method: "rules" };
}
