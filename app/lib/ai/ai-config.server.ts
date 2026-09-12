import 'server-only';

/**
 * Server-Only AI Configuration
 *
 * Isolated configuration for AI integration (Google Gemini API).
 * Client components MUST NEVER import this file.
 */

export interface AiServerConfig {
  enabled: boolean;
  confirmationSecret: string;
  provider: 'gemini' | 'mock';
  model: string;
  timeoutMs: number;
  geminiApiKey: string;
  loadShedding: {
    maxActiveStudentExams: number;
    maxQueueLength: number;
  };
}

/**
 * Validates that an endpoint URL resolves strictly to a local loopback address.
 * Rejects external domains, internal RFC1918 subnets, and cloud metadata services.
 * Retained as a server-side SSRF security validator.
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
  if (!endpoint || typeof endpoint !== 'string') return false;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    const cleanHost = hostname.replace(/^\[|\]$/g, '');

    if (
      cleanHost === 'localhost' ||
      cleanHost === '127.0.0.1' ||
      cleanHost === '::1' ||
      cleanHost.startsWith('127.')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates confirmation secret according to AI enablement status.
 */
export function validateConfirmationSecret(secret: string | undefined, enabled: boolean): string {
  const trimmed = secret?.trim() || '';
  if (enabled) {
    if (!trimmed) {
      throw new Error('FATAL: AI_CONFIRMATION_SECRET is required when AI_ASSISTANT_ENABLED=true');
    }
    if (trimmed.length < 32) {
      throw new Error(
        'FATAL: AI_CONFIRMATION_SECRET must be configured with at least 32 characters of entropy when AI_ASSISTANT_ENABLED=true'
      );
    }
  }
  return trimmed;
}

/**
 * Loads and validates AI server configuration from environment.
 */
export function loadAiServerConfig(env: NodeJS.ProcessEnv = process.env): AiServerConfig {
  const enabled = env.AI_ASSISTANT_ENABLED === 'true';
  const confirmationSecret = validateConfirmationSecret(env.AI_CONFIRMATION_SECRET, enabled);

  const geminiApiKey = env.GEMINI_API_KEY?.trim() || '';
  const model = env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
  const parsedTimeout = Number(env.GEMINI_TIMEOUT_MS || env.AI_REQUEST_TIMEOUT_MS || 60_000);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.max(1_000, Math.min(600_000, parsedTimeout))
    : 60_000;

  const isMock = !enabled || env.AI_PROVIDER === 'mock' || !geminiApiKey;
  const provider: 'gemini' | 'mock' = isMock ? 'mock' : 'gemini';

  return {
    enabled,
    confirmationSecret,
    provider,
    model,
    timeoutMs,
    geminiApiKey,
    loadShedding: {
      maxActiveStudentExams: 25,
      maxQueueLength: 6,
    },
  };
}

let cachedConfig: AiServerConfig | null = null;

export function getAiServerConfig(): AiServerConfig {
  if (!cachedConfig) {
    cachedConfig = loadAiServerConfig(process.env);
  }
  return cachedConfig;
}

/** Reset cached configuration (useful for tests) */
export function resetAiServerConfigCache(): void {
  cachedConfig = null;
}

export const AI_SERVER_CONFIG = new Proxy({} as AiServerConfig, {
  get(_target, prop: keyof AiServerConfig) {
    return getAiServerConfig()[prop];
  },
});
