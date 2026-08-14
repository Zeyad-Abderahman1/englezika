import { getDatabase } from '../../lib/platform';

const SUCCESS_TTL_MS = 1_000;
const FAILURE_TTL_MS = 250;
let lastStatus: 200 | 503 | null = null;
let expiresAt = 0;
let pending: Promise<200 | 503> | null = null;

async function databaseStatus(): Promise<200 | 503> {
  if (lastStatus && Date.now() < expiresAt) return lastStatus;
  pending ??= getDatabase()
    .prepare('SELECT 1')
    .first()
    .then(() => 200 as const)
    .catch(() => 503 as const)
    .then((status) => {
      lastStatus = status;
      expiresAt = Date.now() + (status === 200 ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
      return status;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export async function GET() {
  const status = await databaseStatus();
  return Response.json(
    { status: status === 200 ? 'ready' : 'not_ready' },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}
