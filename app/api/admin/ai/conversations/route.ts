import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../lib/security';
import { checkRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { getDatabase } from '../../../../lib/platform';
import { deleteAllConversations, listConversations, type HistoryDb } from '../../../../lib/ai/conversation-history';
import { deleteStagedImage } from '../../../../lib/ai/agent/image-staging';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ai/conversations?cursor=&q=&limit=
 * The logged-in staff member's own chat list, newest first (cursor pagination, optional search).
 * Never logs message text or search terms.
 */
export async function GET(request: Request) {
  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const limit = await checkRateLimit('admin-ai-history', staff.email.toLowerCase(), 90, 60);
  if (!limit.allowed) return rateLimitResponse(limit.resetAfterSeconds, 'طلبات كتيرة على سجل المحادثات. استنى شوية.');

  const url = new URL(request.url);
  const page = await listConversations(getDatabase() as unknown as HistoryDb, staff.email, {
    cursor: url.searchParams.get('cursor'),
    query: url.searchParams.get('q') ?? '',
    limit: Number(url.searchParams.get('limit')) || undefined,
  });
  return Response.json({ success: true, ...page });
}

/**
 * DELETE /api/admin/ai/conversations  { "all": true }
 * Deletes every chat of the logged-in staff member (and only theirs). The explicit body flag
 * prevents an accidental bare DELETE from wiping the history.
 */
export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const limit = await checkRateLimit('admin-ai-history-delete-all', staff.email.toLowerCase(), 3, 600);
  if (!limit.allowed) return rateLimitResponse(limit.resetAfterSeconds, 'تم تنفيذ حذف المحادثات أكتر من مرة. استنى شوية.');

  const body = (await request.json().catch(() => null)) as { all?: unknown } | null;
  if (body?.all !== true) return jsonError('طلب غير صالح: لازم تأكيد حذف كل المحادثات', 400);

  const deleted = await deleteAllConversations(getDatabase() as unknown as HistoryDb, staff.email, {
    deleteStaged: (uploadId) => deleteStagedImage(staff.email, uploadId),
  });
  return Response.json({ success: true, deleted });
}
