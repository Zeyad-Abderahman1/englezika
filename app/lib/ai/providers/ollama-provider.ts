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

export interface OllamaProviderConfig {
  endpoint?: string;
  model?: string;
  idleTimeoutMinutes?: number;
  maxInferenceThreads?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  requestTimeoutMs?: number;
}

export class OllamaAiProvider implements LocalAiProvider {
  readonly name = 'ollama';
  readonly endpoint: string;
  readonly model: string;
  readonly idleTimeoutMinutes: number;
  readonly maxInferenceThreads: number;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly requestTimeoutMs: number;

  constructor(config: OllamaProviderConfig = {}) {
    const rawEndpoint = config.endpoint || 'http://127.0.0.1:11434';
    if (!isLoopbackEndpoint(rawEndpoint)) {
      throw new ProviderError(
        `Ollama endpoint must be restricted to loopback (127.0.0.1, localhost, [::1]). Received: ${rawEndpoint}`,
        'CONFIG_ERROR'
      );
    }
    this.endpoint = rawEndpoint.replace(/\/+$/, '');
    this.model = config.model || 'qwen2.5:1.5b-instruct-q4_K_M';
    this.idleTimeoutMinutes = config.idleTimeoutMinutes ?? 5;
    this.maxInferenceThreads = config.maxInferenceThreads ?? 2;
    this.maxContextTokens = config.maxContextTokens ?? 2048;
    this.maxOutputTokens = config.maxOutputTokens ?? 1024;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 180_000;
  }

  getKeepAliveString(): string {
    return `${Math.max(1, this.idleTimeoutMinutes)}m`;
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
          `Ollama request timed out after ${timeoutMs}ms`,
          'TIMEOUT'
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(
        `Cannot connect to Ollama at ${this.endpoint}: ${message}`,
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
        `${this.endpoint}/api/version`,
        { method: 'GET' },
        options?.timeoutMs ?? 5000,
        options?.signal
      );

      if (!res.ok) {
        return {
          healthy: false,
          provider: this.name,
          model: this.model,
          message: `Ollama returned HTTP ${res.status}`,
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
      ? `${options.systemPrompt}\n\n${options.userPrompt}`
      : options.userPrompt;

    const payload = {
      model: this.model,
      prompt,
      stream: false,
      format: options.schema ? options.schema : 'json',
      keep_alive: this.getKeepAliveString(),
      options: {
        num_ctx: this.maxContextTokens,
        num_predict: options.maxTokens ?? this.maxOutputTokens,
        num_thread: this.maxInferenceThreads,
        temperature: options.temperature ?? 0.2,
      },
    };

    const res = await this.fetchWithTimeout(
      `${this.endpoint}/api/generate`,
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
        `Ollama returned error HTTP ${res.status}: ${res.statusText}`,
        'INVALID_RESPONSE'
      );
    }

    const data = (await res.json().catch(() => null)) as {
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    } | null;

    if (!data || typeof data.response !== 'string') {
      throw new ProviderError('Ollama returned empty or malformed payload', 'INVALID_RESPONSE');
    }

    const rawText = data.response.trim();

    try {
      const parsed = JSON.parse(rawText) as T;
      return {
        success: true,
        data: parsed,
        rawText,
        usage: {
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
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
    const systemPrompt = `You are an educational assistant. Output JSON with fields: { "planText": string, "actions": [{ "tool": string, "parameters": object, "description": string }], "explanation": string }`;
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
        result.error || 'Failed to generate valid plan from Ollama',
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
    try {
      const res = await this.fetchWithTimeout(
        `${this.endpoint}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            keep_alive: 0,
          }),
        },
        5000
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
