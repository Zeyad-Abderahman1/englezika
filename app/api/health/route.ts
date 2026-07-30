import { getDatabase, getPrivateStorage } from '../../lib/platform';

const START_TIME = Date.now();

export async function GET() {
  let dbStatus = 'unknown';
  let storageStatus = 'unknown';
  let healthy = true;

  try {
    const db = getDatabase();
    await db.prepare('SELECT 1').first();
    dbStatus = 'healthy';
  } catch {
    dbStatus = 'unhealthy';
    healthy = false;
  }

  try {
    const videos = getPrivateStorage();
    if (videos) storageStatus = 'healthy';
  } catch {
    storageStatus = 'unhealthy';
    healthy = false;
  }

  const environment = process.env.NODE_ENV || 'production';
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);

  const body = {
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    environment,
    services: {
      database: dbStatus,
      storage: storageStatus,
    },
    version: '1.0.0',
  };

  return Response.json(body, { status: healthy ? 200 : 503 });
}
