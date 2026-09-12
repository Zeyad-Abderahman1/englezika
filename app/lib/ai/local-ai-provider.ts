/**
 * AI Provider Abstraction
 *
 * Provider-independent interface for AI inference engines (Gemini, mock).
 * This layer generates structured output and plans ONLY.
 * It NEVER executes LMS domain tools or writes SQL to the database.
 */

export class ProviderError extends Error {
  readonly code:
    | 'PROVIDER_OFFLINE'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'INVALID_RESPONSE'
    | 'UNSUPPORTED'
    | 'CONFIG_ERROR';

  constructor(
    message: string,
    code:
      | 'PROVIDER_OFFLINE'
      | 'TIMEOUT'
      | 'CANCELLED'
      | 'INVALID_RESPONSE'
      | 'UNSUPPORTED'
      | 'CONFIG_ERROR'
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export interface ProviderRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GenerateStructuredOutputOptions<T = unknown> extends ProviderRequestOptions {
  systemPrompt?: string;
  userPrompt: string;
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredOutputResult<T = unknown> {
  success: boolean;
  data?: T;
  rawText?: string;
  error?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface PlannedAction {
  tool: string;
  parameters: Record<string, unknown>;
  description?: string;
}

export interface PlanResult {
  planText: string;
  actions: PlannedAction[];
  explanation?: string;
}

export interface ProviderHealthResult {
  healthy: boolean;
  provider: string;
  model: string;
  message?: string;
  latencyMs?: number;
}

export interface LocalAiProvider {
  readonly name: string;
  readonly model: string;
  readonly bypassLocalResourceGuard?: boolean;
  healthCheck(options?: ProviderRequestOptions): Promise<ProviderHealthResult>;
  generateStructuredOutput<T = unknown>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredOutputResult<T>>;
  generatePlan(
    prompt: string,
    context?: unknown,
    options?: ProviderRequestOptions
  ): Promise<PlanResult>;
  unloadModel?(): Promise<boolean>;
}

export type AiProvider = LocalAiProvider;

let globalProviderInstance: LocalAiProvider | null = null;

export function setAiProvider(provider: LocalAiProvider | null): void {
  globalProviderInstance = provider;
}

export async function getAiProvider(): Promise<LocalAiProvider> {
  if (globalProviderInstance) return globalProviderInstance;

  const { loadAiServerConfig } = await import('./ai-config.server');
  const config = loadAiServerConfig();

  if (config.provider === 'gemini' && config.geminiApiKey) {
    const { GeminiAiProvider } = await import('./providers/gemini-provider.server');
    globalProviderInstance = new GeminiAiProvider({
      apiKey: config.geminiApiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  } else {
    const { MockAiProvider } = await import('./providers/mock-provider');
    globalProviderInstance = new MockAiProvider({ model: config.model });
  }

  return globalProviderInstance;
}
