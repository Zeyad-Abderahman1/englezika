/**
 * Local AI Provider Abstraction
 *
 * Provider-independent interface for local inference engines (Ollama, llama.cpp, mock).
 * This layer generates structured output ONLY. It NEVER executes LMS domain tools or DB operations.
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

let globalProviderInstance: LocalAiProvider | null = null;

export function setAiProvider(provider: LocalAiProvider | null): void {
  globalProviderInstance = provider;
}

export async function getAiProvider(): Promise<LocalAiProvider> {
  if (globalProviderInstance) return globalProviderInstance;

  const { loadAiServerConfig } = await import('./ai-config.server');
  const config = loadAiServerConfig();

  if (config.provider === 'ollama') {
    const { OllamaAiProvider } = await import('./providers/ollama-provider');
    globalProviderInstance = new OllamaAiProvider({
      endpoint: config.endpoint,
      model: config.model,
      idleTimeoutMinutes: config.idleTimeoutMinutes,
      maxInferenceThreads: config.maxInferenceThreads,
      maxContextTokens: config.maxContextTokens,
      maxOutputTokens: config.maxOutputTokens,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  } else if (config.provider === 'llamacpp') {
    const { LlamaCppAiProvider } = await import('./providers/llamacpp-provider');
    globalProviderInstance = new LlamaCppAiProvider({
      endpoint: config.endpoint,
      model: config.model,
      maxInferenceThreads: config.maxInferenceThreads,
      maxContextTokens: config.maxContextTokens,
      maxOutputTokens: config.maxOutputTokens,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  } else {
    const { MockAiProvider } = await import('./providers/mock-provider');
    globalProviderInstance = new MockAiProvider({ model: config.model });
  }

  return globalProviderInstance;
}

