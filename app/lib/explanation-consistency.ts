/**
 * app/lib/explanation-consistency.ts
 *
 * Client-safe pure validation helper to verify consistency between an AI-generated
 * explanation and the target correct answer.
 * If inconsistent or ambiguous, drops explanation (returns null) and flags needs_review.
 */
export function checkExplanationConsistency(
  explanation: string,
  correctAnswer: string,
  options: string[]
): { explanation: string | null; needs_review: boolean } {
  const trimmedExp = explanation.trim();
  if (!trimmedExp) {
    return { explanation: '', needs_review: false };
  }
  if (!correctAnswer || !correctAnswer.trim()) {
    return { explanation: null, needs_review: true };
  }

  const normalizedCorrect = correctAnswer.trim().toLowerCase();
  const otherOptions = options.filter(
    (opt) => opt.trim().toLowerCase() !== normalizedCorrect && opt.trim().length > 0
  );

  // Check if explanation declares a different option text as correct
  for (const wrongOpt of otherOptions) {
    const escapedWrong = wrongOpt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const claimPatterns = [
      new RegExp(`(?:الإجابة|الاجابة|الاختيار|الخيار)\\s+(?:الصحيحة?|الصح|المناسبه?|المطلوبة?)\\s+(?:هي|هو|:)?\\s*["'«]?${escapedWrong}["'»]?\\b`, 'i'),
      new RegExp(`(?:الإجابة|الاجابة|الحل)\\s*[:=]\\s*["'«]?${escapedWrong}["'»]?\\b`, 'i'),
      new RegExp(`(?:الاختيار|الخيار)\\s+["'«]?${escapedWrong}["'»]?\\s+(?:هو|هي)\\s+(?:الصحيح|الصح|المناسب)`, 'i'),
      new RegExp(`(?:لذلك|علشان\\s+كده|لذا)\\s+(?:فإن|ف)?(?:الإجابة|الاجابة|الاختيار|الخيار)?\\s*["'«]?${escapedWrong}["'»]?\\s+(?:هي|هو)\\s+(?:الصحيحة?|الصح)`, 'i'),
    ];

    for (const pattern of claimPatterns) {
      if (pattern.test(trimmedExp)) {
        const escapedCorrect = correctAnswer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const correctPattern = new RegExp(`(?:الإجابة|الاجابة|الاختيار|الخيار)\\s+(?:الصحيحة?|الصح|المناسبه?|المطلوبة?)\\s+(?:هي|هو|:)?\\s*["'«]?${escapedCorrect}["'»]?\\b`, 'i');
        if (!correctPattern.test(trimmedExp)) {
          return { explanation: null, needs_review: true };
        }
      }
    }
  }

  // Check if explanation declares a different option letter (A, B, C, D) as correct
  const correctIndex = options.findIndex(
    (opt) => opt.trim().toLowerCase() === normalizedCorrect
  );
  if (correctIndex >= 0) {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 0; i < options.length; i++) {
      if (i !== correctIndex && letters[i]) {
        const wrongLetter = letters[i];
        const letterClaim = new RegExp(
          `(?:الإجابة|الاجابة|الاختيار|الخيار)\\s+(?:الصحيحة?|الصح|المناسبه?)\\s+(?:هي|هو|:)?\\s*["'«]?${wrongLetter}["'»]?\\b`,
          'i'
        );
        const letterClaimSuffix = new RegExp(
          `(?:الاختيار|الخيار)\\s+["'«]?${wrongLetter}["'»]?\\s+(?:هو|هي)\\s+(?:الصحيح|الصح)`,
          'i'
        );
        if (letterClaim.test(trimmedExp) || letterClaimSuffix.test(trimmedExp)) {
          return { explanation: null, needs_review: true };
        }
      }
    }
  }

  return { explanation: trimmedExp, needs_review: false };
}
