import { getDatabase } from '../../lib/platform';
import { jsonError, requireSameOrigin, safeText } from '../../lib/security';

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = safeText(body?.name, 100);
  const phone = safeText(body?.phone, 30);
  const message = safeText(body?.message, 2000);
  if (name.length < 2 || phone.length < 8 || message.length < 5) {
    return jsonError('من فضلك أكمل البيانات بشكل صحيح');
  }
  await getDatabase()
    .prepare(
      "INSERT INTO contacts (id, name, phone, message, status, created_at) VALUES (?, ?, ?, ?, 'new', ?)"
    )
    .bind(crypto.randomUUID(), name, phone, message, Date.now())
    .run();
  return Response.json({ ok: true });
}
