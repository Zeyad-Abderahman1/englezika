import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { jsonError, requireSameOrigin } from '../../../../../lib/security';
import { checkRateLimit, rateLimitResponse } from '../../../../../lib/rate-limit';
import { getDatabase } from '../../../../../lib/platform';
import {
  deleteConversation,
  getConversationMessages,
  renameConversation,
  type HistoryDb,
} from '../../../../../lib/ai/conversation-history';
import { deleteStagedImage } from '../../../../../lib/ai/agent/image-staging';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => jsonError('المحادثة غير موجودة', 404);
const validId = (id: string | undefined) => Boolean(id && id.length <= 80 && /^[\w-]+$/.test(id));

/** GET /api/admin/ai/conversations/[id]?before=<createdAt>  — owner's messages, latest page first. */
export async function GET(request: Request, { params }: Params) {
  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const limit = await checkRateLimit('admin-ai-history', staff.email.toLowerCase(), 90, 60);
  if (!limit.allowed) return rateLimitResponse(limit.resetAfterSeconds, 'طلبات كتيرة على سجل المحادثات. استنى شوية.');

  const { id } = await params;
  if (!validId(id)) return NOT_FOUND();

  const before = Number(new URL(request.url).searchParams.get('before')) || null;
  const data = await getConversationMessages(getDatabase() as unknown as HistoryDb, staff.email, id, { before });
  if (!data) return NOT_FOUND();
  return Response.json({ success: true, conversationId: id, ...data });
}

/** PATCH /api/admin/ai/conversations/[id]  { title } */
export async function PATCH(request: Request, { params }: Params) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const { id } = await params;
  if (!validId(id)) return NOT_FOUND();

  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  if (typeof body?.title !== 'string' || !body.title.trim()) return jsonError('الاسم مطلوب', 400);

  const title = await renameConversation(getDatabase() as unknown as HistoryDb, staff.email, id, body.title);
  if (!title) return NOT_FOUND();
  return Response.json({ success: true, id, title });
}

/** DELETE /api/admin/ai/conversations/[id] — one chat of the logged-in staff member. */
export async function DELETE(request: Request, { params }: Params) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_courses');
  if (isStaffResponse(staff)) return staff;

  const limit = await checkRateLimit('admin-ai-history-delete', staff.email.toLowerCase(), 30, 60);
  if (!limit.allowed) return rateLimitResponse(limit.resetAfterSeconds, 'طلبات حذف كتيرة. استنى شوية.');

  const { id } = await params;
  if (!validId(id)) return NOT_FOUND();

  const removed = await deleteConversation(getDatabase() as unknown as HistoryDb, staff.email, id, {
    deleteStaged: (uploadId) => deleteStagedImage(staff.email, uploadId),
  });
  if (!removed) return NOT_FOUND();
  return Response.json({ success: true });
}
