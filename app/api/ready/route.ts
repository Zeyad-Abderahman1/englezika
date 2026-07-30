import { getDatabase } from '../../lib/platform';

export async function GET() {
  try {
    const db = getDatabase();
    await db.prepare('SELECT 1').first();
    return Response.json({ status: 'ready' }, { status: 200 });
  } catch {
    return Response.json({ status: 'not_ready' }, { status: 503 });
  }
}
