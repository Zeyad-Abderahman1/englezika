/**
 * Client-side helper shared by EVERY exam creation path and the exam edit screen.
 *
 * After an exam exists (manual form, OCR, PDF generator, stage-exam generator), the caller
 * passes the teacher's choices here. It uses the same admin endpoints that wrap the single
 * server service (`examListingService`): thumbnail upload/remove and publish-as-course.
 * Failures never undo the exam: they come back as warnings the UI can show.
 */

export interface ExamPublishingDraft {
  thumbnailFile: File | null;
  /** Remove the existing thumbnail (edit screen). */
  removeThumbnail: boolean;
  /** Publish the exam as a standalone course for ALL classes. */
  enabled: boolean;
  /** Price in EGP (text from the input). 0 = free. */
  price: string;
  description: string;
  isPublic: boolean;
  showLeaderboard: boolean;
}

export function emptyPublishingDraft(): ExamPublishingDraft {
  return {
    thumbnailFile: null,
    removeThumbnail: false,
    enabled: false,
    price: '0',
    description: '',
    isPublic: true,
    showLeaderboard: true,
  };
}

export interface ExamPublishingResult {
  warnings: string[];
  publicSlug?: string | null;
  isPublic?: boolean;
  published: boolean;
}

export function publicExamPath(slug: string): string {
  return `/exams/${encodeURIComponent(slug)}`;
}

export function publicExamUrl(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${publicExamPath(slug)}`;
}

async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'تعذر تنفيذ العملية');
  }
  return data;
}

/** True when the draft would change anything on the server. */
export function hasPublishingChanges(draft: ExamPublishingDraft): boolean {
  return Boolean(draft.thumbnailFile) || draft.removeThumbnail || draft.enabled;
}

export async function applyExamPublishing(
  examId: string,
  draft: ExamPublishingDraft
): Promise<ExamPublishingResult> {
  const warnings: string[] = [];
  const result: ExamPublishingResult = { warnings, published: false };
  const base = `/api/admin/exams/${encodeURIComponent(examId)}`;

  if (draft.thumbnailFile) {
    try {
      const formData = new FormData();
      formData.append('file', draft.thumbnailFile);
      await call(`${base}/thumbnail`, { method: 'POST', body: formData });
    } catch (error) {
      warnings.push(`تم إنشاء الامتحان لكن تعذر حفظ الصورة: ${error instanceof Error ? error.message : ''}`.trim());
    }
  } else if (draft.removeThumbnail) {
    try {
      await call(`${base}/thumbnail`, { method: 'DELETE' });
    } catch (error) {
      warnings.push(`تعذر حذف الصورة: ${error instanceof Error ? error.message : ''}`.trim());
    }
  }

  if (draft.enabled) {
    try {
      const price = Math.max(0, Math.min(100_000, Math.round(Number(draft.price) || 0)));
      const data = await call(`${base}/listing`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          price,
          description: draft.description.trim() || undefined,
          isPublic: draft.isPublic,
          showLeaderboard: draft.showLeaderboard,
        }),
      });
      result.published = true;
      result.publicSlug = typeof data.publicSlug === 'string' ? data.publicSlug : null;
      result.isPublic = Boolean(data.isPublic);
    } catch (error) {
      warnings.push(`تم إنشاء الامتحان لكن تعذر نشره ككورس: ${error instanceof Error ? error.message : ''}`.trim());
    }
  }

  return result;
}

/** Pulls the new exam id out of an executed AI confirmation result (compound or single). */
export function findExamIdInExecutionResult(result: unknown): string | null {
  const visit = (node: unknown): string | null => {
    if (!node || typeof node !== 'object') return null;
    const record = node as Record<string, unknown>;
    for (const key of ['exam', 'quiz']) {
      const candidate = record[key] as { id?: unknown } | undefined;
      if (candidate && typeof candidate.id === 'string') return candidate.id;
    }
    for (const value of Object.values(record)) {
      const found = visit(value);
      if (found) return found;
    }
    return null;
  };
  return visit(result);
}

/** Unpublishes an exam's course listing (hides the listing and the public page; attempts are kept). */
export async function unpublishExamListing(examId: string): Promise<void> {
  await call(`/api/admin/exams/${encodeURIComponent(examId)}/listing`, { method: 'DELETE' });
}
