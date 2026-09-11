import 'server-only';

/**
 * Server-Only AI Configuration
 *
 * Isolated configuration for local AI integration.
 * Client components MUST NEVER import this file.
 */

export interface AiServerConfig {
  enabled: boolean;
  confirmationSecret: string;
  provider: 'ollama' | 'llamacpp' | 'mock';
  endpoint: string;
  model: string;
  idleTimeoutMinutes: number;
  maxInferenceThreads: number;
  maxContextTokens: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  loadShedding: {
    maxLoadAverage: number;
    maxActiveStudentExams: number;
    maxQueueLength: number;
  };
}

/**
 * Validates that an endpoint URL resolves strictly to a local loopback address.
 * Rejects external domains, internal RFC1918 subnets, and cloud metadata services.
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
 * Loads and validates AI server configuration from a given environment map.
 */
export function loadAiServerConfig(env: NodeJS.ProcessEnv = process.env): AiServerConfig {
  const enabled = env.AI_ASSISTANT_ENABLED === 'true';
  const confirmationSecret = validateConfirmationSecret(env.AI_CONFIRMATION_SECRET, enabled);

  const rawProvider = (env.LOCAL_AI_PROVIDER?.trim().toLowerCase() || 'mock');
  const provider = (rawProvider === 'ollama' || rawProvider === 'llamacpp' || rawProvider === 'mock')
    ? rawProvider
    : 'mock';

  const defaultEndpoint = provider === 'llamacpp' ? 'http://127.0.0.1:8080' : 'http://127.0.0.1:11434';
  const endpoint = env.LOCAL_AI_ENDPOINT?.trim() || defaultEndpoint;

  if (endpoint && !isLoopbackEndpoint(endpoint)) {
    throw new Error(
      `FATAL: Invalid LOCAL_AI_ENDPOINT "${endpoint}". AI endpoint must be restricted to loopback (127.0.0.1, localhost, [::1]). Arbitrary network targets are prohibited.`
    );
  }

  const model = env.LOCAL_AI_MODEL?.trim() || 'qwen2.5:1.5b-instruct-q4_K_M';
  const idleTimeoutMinutes = Math.max(1, Math.min(120, Number(env.LOCAL_AI_IDLE_MINUTES || 5)));
  const maxInferenceThreads = Math.max(1, Math.min(64, Number(env.LOCAL_AI_THREADS || 2)));
  const maxContextTokens = Math.max(512, Math.min(65536, Number(env.LOCAL_AI_MAX_CONTEXT_TOKENS || 2048)));
  const maxOutputTokens = Math.max(64, Math.min(16384, Number(env.LOCAL_AI_MAX_OUTPUT_TOKENS || 1024)));
  const requestTimeoutMs = Math.max(1000, Math.min(600000, Number(env.AI_REQUEST_TIMEOUT_MS || 180_000)));

  return {
    enabled,
    confirmationSecret,
    provider,
    endpoint,
    model,
    idleTimeoutMinutes,
    maxInferenceThreads,
    maxContextTokens,
    maxOutputTokens,
    requestTimeoutMs,
    loadShedding: {
      maxLoadAverage: 3.0,
      maxActiveStudentExams: 25,
      maxQueueLength: 2,
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
