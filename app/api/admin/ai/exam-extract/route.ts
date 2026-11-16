import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { checkRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { getDatabase } from '../../../../lib/platform';
import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';
import { ToolExecutionError, executeTool } from '../../../../lib/ai/tool-executor';

export const runtime = 'nodejs';
// One window of pages per request keeps this short; the headroom covers retries/continuations.
export const maxDuration = 120;

/**
 * POST /api/admin/ai/exam-extract   { extractionId, windowIndex }
 *
 * Extracts ONE small window of an extraction's staged exam-page photos through the existing
 * OCR pipeline (via the registered `extract_exam_from_images` tool, with its permission
 * checks) and stores the result server-side. The browser calls this once per window, so a
 * long exam never depends on one long request. No exam is created here.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_exams');
  if (isStaffResponse(staff)) return staff;

  if (!loadAiServerConfig().enabled) {
    return jsonError('خدمة المساعد الذكي غير مفعلة حالياً على الخادم', 403);
  }

  const rate = await checkRateLimit('admin-ai-exam-extract', staff.email.toLowerCase(), 240, 300);
  if (!rate.allowed) return rateLimitResponse(rate.resetAfterSeconds, 'عدد كبير من الطلبات. انتظر قليلًا ثم حاول مرة أخرى.');

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const extractionId = typeof body.extractionId === 'string' ? body.extractionId.trim() : '';
  const windowIndex = Number(body.windowIndex);
  if (!extractionId || !Number.isInteger(windowIndex) || windowIndex < 0) {
    return jsonError('بيانات الطلب غير صالحة', 400);
  }

  try {
    const outcome = await executeTool({
      toolName: 'extract_exam_from_images',
      args: { extractionId, windowIndex },
      actor: {
        email: staff.email,
        name: (staff as { name?: string }).name,
        role: staff.role as string,
        permissions: staff.permissions,
      },
      context: { db: getDatabase() },
    });
    return Response.json({ ok: outcome.result.status === 'done', ...outcome.result });
  } catch (error) {
    if (error instanceof ToolExecutionError) return jsonError(error.message, error.status);
    return jsonError('تعذر استخراج الأسئلة من هذه الصفحات', 500);
  }
}
