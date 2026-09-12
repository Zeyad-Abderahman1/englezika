import 'server-only';

export interface AssessmentProviderConfig {
  remoteEnabled: boolean;
  primaryProvider: 'openrouter' | 'ollama';
  fallbackProvider: 'ollama' | null;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function selectFreeOpenRouterModel(model: string | undefined): string {
  const configuredModel = model?.trim() || 'openrouter/free';
  return configuredModel === 'openrouter/free' || configuredModel.endsWith(':free')
    ? configuredModel
    : 'openrouter/free';
}

export function loadAssessmentProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): AssessmentProviderConfig {
  const selectedPrimary = env.AI_ASSESSMENT_PRIMARY_PROVIDER?.trim().toLowerCase();
  const remoteEnabled = selectedPrimary === 'openrouter';
  const selectedFallback = env.AI_ASSESSMENT_FALLBACK_PROVIDER?.trim().toLowerCase();
  const parsedTimeout = Number(env.OPENROUTER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    remoteEnabled,
    primaryProvider: remoteEnabled ? 'openrouter' : 'ollama',
    fallbackProvider: remoteEnabled && (!selectedFallback || selectedFallback === 'ollama')
      ? 'ollama'
      : null,
    apiKey: env.OPENROUTER_API_KEY?.trim() || '',
    model: selectFreeOpenRouterModel(env.OPENROUTER_MODEL),
    timeoutMs: Number.isFinite(parsedTimeout)
      ? Math.max(1_000, Math.min(600_000, parsedTimeout))
      : DEFAULT_TIMEOUT_MS,
  };
}
