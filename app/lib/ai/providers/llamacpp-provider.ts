import { ProviderError } from '../local-ai-provider';
import type {
  LocalAiProvider,
  GenerateStructuredOutputOptions,
  StructuredOutputResult,
  PlanResult,
  ProviderHealthResult,
  ProviderRequestOptions,
} from '../local-ai-provider';
import { isLoopbackEndpoint } from '../ai-config.server';

export interface LlamaCppProviderConfig {
  endpoint?: string;
  model?: string;
  maxInferenceThreads?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  requestTimeoutMs?: number;
}

export class LlamaCppAiProvider implements LocalAiProvider {
  readonly name = 'llamacpp';
  readonly endpoint: string;
  readonly model: string;
  readonly maxInferenceThreads: number;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly requestTimeoutMs: number;

  constructor(config: LlamaCppProviderConfig = {}) {
    const rawEndpoint = config.endpoint || 'http://127.0.0.1:8080';
    if (!isLoopbackEndpoint(rawEndpoint)) {
      throw new ProviderError(
        `llama.cpp endpoint must be restricted to loopback (127.0.0.1, localhost, [::1]). Received: ${rawEndpoint}`,
        'CONFIG_ERROR'
      );
    }
    this.endpoint = rawEndpoint.replace(/\/+$/, '');
    this.model = config.model || 'qwen2.5-gguf';
    this.maxInferenceThreads = config.maxInferenceThreads ?? 2;
    this.maxContextTokens = config.maxContextTokens ?? 2048;
    this.maxOutputTokens = config.maxOutputTokens ?? 1024;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 180_000;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    customTimeoutMs?: number,
    parentSignal?: AbortSignal
  ): Promise<Response> {
    const timeoutMs = customTimeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const onParentAbort = () => {
      controller.abort();
    };

    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timer);
        throw new ProviderError('Operation was cancelled', 'CANCELLED');
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (err: unknown) {
      if (parentSignal?.aborted) {
        throw new ProviderError('Operation was cancelled', 'CANCELLED');
      }
      if (controller.signal.aborted) {
        throw new ProviderError(
          `llama.cpp request timed out after ${timeoutMs}ms`,
          'TIMEOUT'
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(
        `Cannot connect to llama.cpp at ${this.endpoint}: ${message}`,
        'PROVIDER_OFFLINE'
      );
    } finally {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  async healthCheck(options?: ProviderRequestOptions): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      const res = await this.fetchWithTimeout(
        `${this.endpoint}/health`,
        { method: 'GET' },
        options?.timeoutMs ?? 5000,
        options?.signal
      );

      if (!res.ok) {
        return {
          healthy: false,
          provider: this.name,
          model: this.model,
          message: `llama.cpp returned HTTP ${res.status}`,
          latencyMs: Date.now() - start,
        };
      }

      return {
        healthy: true,
        provider: this.name,
        model: this.model,
        latencyMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      return {
        healthy: false,
        provider: this.name,
        model: this.model,
        message,
        latencyMs: Date.now() - start,
      };
    }
  }

  async generateStructuredOutput<T = unknown>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredOutputResult<T>> {
    const prompt = options.systemPrompt
      ? `<|im_start|>system\n${options.systemPrompt}<|im_end|>\n<|im_start|>user\n${options.userPrompt}<|im_end|>\n<|im_start|>assistant\n`
      : options.userPrompt;

    const payload: Record<string, unknown> = {
      prompt,
      n_predict: options.maxTokens ?? this.maxOutputTokens,
      temperature: options.temperature ?? 0.2,
      stream: false,
    };

    if (options.schema) {
      payload.json_schema = options.schema;
    }

    const res = await this.fetchWithTimeout(
      `${this.endpoint}/completion`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      options.timeoutMs,
      options.signal
    );

    if (!res.ok) {
      throw new ProviderError(
        `llama.cpp returned error HTTP ${res.status}: ${res.statusText}`,
        'INVALID_RESPONSE'
      );
    }

    const data = (await res.json().catch(() => null)) as {
      content?: string;
      tokens_evaluated?: number;
      tokens_predicted?: number;
    } | null;

    if (!data || typeof data.content !== 'string') {
      throw new ProviderError('llama.cpp returned empty or malformed payload', 'INVALID_RESPONSE');
    }

    const rawText = data.content.trim();

    try {
      const parsed = JSON.parse(rawText) as T;
      return {
        success: true,
        data: parsed,
        rawText,
        usage: {
          promptTokens: data.tokens_evaluated,
          completionTokens: data.tokens_predicted,
          totalTokens: (data.tokens_evaluated || 0) + (data.tokens_predicted || 0),
        },
      };
    } catch {
      return {
        success: false,
        rawText,
        error: 'Model response was not valid JSON matching requested format',
      };
    }
  }

  async generatePlan(
    prompt: string,
    context?: unknown,
    options?: ProviderRequestOptions
  ): Promise<PlanResult> {
    const systemPrompt = `Output valid JSON with fields: { "planText": string, "actions": [{ "tool": string, "parameters": object, "description": string }], "explanation": string }`;
    const userPrompt = context
      ? `Context: ${JSON.stringify(context)}\n\nInstruction: ${prompt}`
      : prompt;

    const result = await this.generateStructuredOutput<PlanResult>({
      systemPrompt,
      userPrompt,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      temperature: 0.2,
    });

    if (!result.success || !result.data) {
      throw new ProviderError(
        result.error || 'Failed to generate valid plan from llama.cpp',
        'INVALID_RESPONSE'
      );
    }

    return {
      planText: result.data.planText || result.rawText || '',
      actions: Array.isArray(result.data.actions) ? result.data.actions : [],
      explanation: result.data.explanation,
    };
  }

  async unloadModel(): Promise<boolean> {
    return true;
  }
}
