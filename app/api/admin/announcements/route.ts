import { ensureDatabase } from '../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../lib/staff-auth';
import { getD1 } from '../../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = await apiStaff(request, 'manage_announcements');
  if (isStaffResponse(admin)) return admin;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = safeText(body.title, 150);
  const content = safeText(body.body, 2000);
  if (title.length < 3 || content.length < 3) return jsonError('عنوان الإعلان ومحتواه مطلوبان');
  await ensureDatabase();
  await getD1()
    .prepare(
      "INSERT INTO announcements (id, title, body, status, created_at) VALUES (?, ?, ?, 'published', ?)"
    )
    .bind(crypto.randomUUID(), title, content, Date.now())
    .run();
  return Response.json({ ok: true });
}
