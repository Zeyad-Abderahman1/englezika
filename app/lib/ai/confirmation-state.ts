/**
 * Authoritative UI and durable state machine rules for AI confirmation cards.
 */

export type ConfirmationCardState = 'pending' | 'executing' | 'succeeded' | 'failed' | 'expired';

/**
 * An action is actionable (clickable by user to start execution) ONLY when in 'pending' state.
 */
export function isConfirmationActionable(state: ConfirmationCardState): boolean {
  return state === 'pending';
}

/**
 * Execute button is strictly omitted for terminal states: 'failed', 'succeeded', 'expired'.
 * It is rendered ONLY for 'pending' (active) and 'executing' (disabled with loader).
 */
export function shouldRenderExecuteButton(state: ConfirmationCardState): boolean {
  return state === 'pending' || state === 'executing';
}

/**
 * Formats technical or server error strings into human-friendly Arabic product messages.
 */
export function formatUserFacingConfirmationError(errorMsg: string | undefined | null): string {
  if (!errorMsg) {
    return 'تعذر تنفيذ الإجراء المؤكد. يرجى إنشاء طلب جديد للمحاولة مرة أخرى.';
  }
  const raw = String(errorMsg);
  if (
    raw.includes('الكورس غير موجود') ||
    raw.includes('not found') ||
    raw.includes('already failed') ||
    raw.includes('لم يعد متاحًا')
  ) {
    return 'تعذر تنفيذ الإجراء لأن الكورس لم يعد متاحًا. أنشئ طلبًا جديدًا للمحاولة مرة أخرى.';
  }
  if (raw.includes('expired') || raw.includes('انتهت')) {
    return 'انتهت صلاحية رمز التأكيد. يرجى إنشاء طلب جديد للمتابعة.';
  }
  return raw;
}
