import {
  DESTRUCTIVE_ACTIONS,
  impactSignature,
  type DeleteImpact,
  type DeleteKind,
} from './agent/delete-impact';

/**
 * Server-side gate for destructive confirmations (deleting a course, lecture, exam or
 * assignment). It runs BEFORE the single-use confirmation token is consumed, so a wrong
 * attempt never burns the token:
 *   1. the payload must carry the item's name (built by the server, never by the model);
 *   2. the teacher must have typed that exact name (checked here again, not just in the UI);
 *   3. the impact counts must be unchanged since the confirmation card was shown.
 */

type ConfirmationDb = {
  prepare: (sql: string) => {
    bind: (...values: Array<string | number>) => {
      first: <T = unknown>() => Promise<T | null>;
    };
  };
};

export type DestructiveGuardResult =
  | { ok: true; destructive: boolean }
  | { ok: false; status: number; code: string; message: string };

const KIND_BY_ACTION: Record<string, DeleteKind> = {
  delete_course: 'course',
  delete_lecture: 'lecture',
  delete_exam: 'exam',
  delete_assignment: 'assignment',
};

const ID_KEY_BY_ACTION: Record<string, string> = {
  delete_course: 'courseId',
  delete_lecture: 'videoId',
  delete_exam: 'examId',
  delete_assignment: 'assignmentId',
};

function sameText(a: string, b: string): boolean {
  return a.normalize('NFC').trim() === b.normalize('NFC').trim();
}

export function parseTokenId(token: unknown): string | null {
  if (typeof token === 'string') return token.split('.')[0]?.trim() || null;
  if (token && typeof token === 'object' && typeof (token as { tokenId?: unknown }).tokenId === 'string') {
    return (token as { tokenId: string }).tokenId.trim() || null;
  }
  return null;
}

export async function precheckDestructiveConfirmation(input: {
  db: ConfirmationDb;
  actorEmail: string;
  token: unknown;
  confirmText: unknown;
  impactFor: (kind: DeleteKind, id: string) => Promise<DeleteImpact | null>;
}): Promise<DestructiveGuardResult> {
  const tokenId = parseTokenId(input.token);
  if (!tokenId) return { ok: true, destructive: false };

  const row = await input.db
    .prepare('SELECT action_type, action_payload, staff_email FROM ai_confirmations WHERE id = ?')
    .bind(tokenId)
    .first<{ action_type: string; action_payload: string; staff_email: string }>();

  // Unknown token / someone else's token: the normal execution path reports it.
  if (!row || row.staff_email.toLowerCase() !== input.actorEmail.toLowerCase()) {
    return { ok: true, destructive: false };
  }

  // A compound plan could hide a delete step: it must never run a delete.
  if (row.action_type === 'compound_plan') {
    try {
      const steps = (JSON.parse(row.action_payload) as { steps?: Array<{ tool?: string }> }).steps ?? [];
      if (steps.some((step) => step.tool && DESTRUCTIVE_ACTIONS.has(step.tool))) {
        return {
          ok: false,
          status: 400,
          code: 'DELETE_IN_PLAN',
          message: 'الحذف لازم يتم لعنصر واحد في كل مرة مع تأكيد كتابة الاسم.',
        };
      }
    } catch {
      return { ok: true, destructive: false };
    }
    return { ok: true, destructive: false };
  }

  if (!DESTRUCTIVE_ACTIONS.has(row.action_type)) return { ok: true, destructive: false };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.action_payload) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, code: 'BAD_PAYLOAD', message: 'بيانات التأكيد غير صالحة.' };
  }

  const expectedName = typeof payload.confirmName === 'string' ? payload.confirmName : '';
  if (!expectedName) {
    return {
      ok: false,
      status: 400,
      code: 'MISSING_CONFIRM_NAME',
      message: 'هذا الحذف يحتاج تأكيدًا بكتابة اسم العنصر. اطلب الحذف من المساعد من جديد.',
    };
  }

  if (typeof input.confirmText !== 'string' || !sameText(input.confirmText, expectedName)) {
    return {
      ok: false,
      status: 400,
      code: 'CONFIRM_TEXT_MISMATCH',
      message: 'الاسم المكتوب غير مطابق. اكتب اسم العنصر بالضبط كما يظهر في البطاقة.',
    };
  }

  const kind = KIND_BY_ACTION[row.action_type];
  const id = String(payload[ID_KEY_BY_ACTION[row.action_type]] ?? '');
  const current = await input.impactFor(kind, id);
  if (!current) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'العنصر غير موجود أو اتحذف بالفعل.' };
  }
  const expectedImpact = payload.expectedImpact as Record<string, number> | undefined;
  if (!expectedImpact || impactSignature(expectedImpact) !== impactSignature(current.counts)) {
    return {
      ok: false,
      status: 409,
      code: 'IMPACT_CHANGED',
      message: 'تغيّرت بيانات العنصر بعد عرض التأكيد (طلاب أو محاولات جديدة). راجع الملخص وأكّد من جديد.',
    };
  }
  if (!sameText(current.name, expectedName)) {
    return { ok: false, status: 409, code: 'IMPACT_CHANGED', message: 'اسم العنصر اتغيّر. أعد التأكيد من جديد.' };
  }

  return { ok: true, destructive: true };
}
