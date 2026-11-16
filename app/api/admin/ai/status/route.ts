import { loadAiServerConfig } from '../../../../lib/ai/ai-config.server';

export const runtime = 'nodejs';

/**
 * GET /api/admin/ai/status
 *
 * Lightweight check returning sanitized feature flag status to the admin UI.
 * Zero secrets, endpoints, or model internals are exposed.
 */
export async function GET() {
  const config = loadAiServerConfig();
  return Response.json({
    enabled: config.enabled,
  });
}
