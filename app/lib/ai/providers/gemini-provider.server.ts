import 'server-only';
import type {
  GenerateStructuredOutputOptions,
  StructuredOutputResult,
  PlanResult,
  ProviderHealthResult,
  ProviderRequestOptions,
  AiProvider,
  LocalAiProvider,
} from '../ai-provider';
import { getPlannerSystemPrompt } from '../planner-prompt';

export type GeminiErrorCode =
  | 'CONFIG_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_UNAVAILABLE';

export class GeminiProviderError extends Error {
  readonly code: GeminiErrorCode;
  constructor(message: string, code: GeminiErrorCode) {
    super(message);
    this.name = 'GeminiProviderError';
    this.code = code;
  }
}

export interface GeminiProviderConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface GeminiServerConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;

export function loadGeminiConfig(env: NodeJS.ProcessEnv = process.env): GeminiServerConfig {
  const apiKey = env.GEMINI_API_KEY?.trim() || '';
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const parsedTimeout = Number(env.GEMINI_TIMEOUT_MS || DEFAULT_GEMINI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.max(1_000, Math.min(600_000, parsedTimeout))
    : DEFAULT_GEMINI_TIMEOUT_MS;

  return {
    apiKey,
    model,
    timeoutMs,
  };
}

/**
 * Strips JSON-Schema keywords unsupported by Gemini OpenAPI 3.0 subset
 * ($schema, additionalProperties) recursively to guarantee valid structured schemas.
 */
function cleanSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) {
    return schema.map(cleanSchemaForGemini);
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === '$schema' || k === 'additionalProperties') {
      continue;
    }
    result[k] = cleanSchemaForGemini(v);
  }
  return result;
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

export class GeminiAiProvider implements LocalAiProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly timeoutMs: number;
  readonly bypassLocalResourceGuard = true;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GeminiProviderConfig = {}) {
    const envConfig = loadGeminiConfig();
    this.apiKey = config.apiKey !== undefined ? config.apiKey.trim() : envConfig.apiKey;
    this.model = config.model?.trim() || envConfig.model;
    this.timeoutMs = config.timeoutMs ?? envConfig.timeoutMs;
    this.fetchImpl = config.fetchImpl || fetch;
  }

  private ensureApiKey(): void {
    if (!this.apiKey) {
      throw new GeminiProviderError(
        'خدمة المساعد الذكي غير مهيأة بشكل صحيح على الخادم: مفتاح Gemini API غير متوفر',
        'CONFIG_ERROR'
      );
    }
  }

  async healthCheck(options?: ProviderRequestOptions): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      this.ensureApiKey();
      // Test lightweight connectivity
      const res = await this.generateStructuredOutput<{ status?: string }>({
        userPrompt: 'Reply with {"status": "ok"}',
        temperature: 0.1,
        maxTokens: 50,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 5000,
      });

      if (!res.success) {
        return {
          healthy: false,
          provider: this.name,
          model: this.model,
          message: res.error || 'Health check failed',
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
    this.ensureApiKey();

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);

    const onParentAbort = () => {
      controller.abort(options.signal?.reason || new Error('CANCELLED'));
    };

    if (options.signal?.aborted) {
      clearTimeout(timer);
      throw new GeminiProviderError('تم إلغاء الطلب', 'CANCELLED');
    }
    options.signal?.addEventListener('abort', onParentAbort, { once: true });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent`;

    const contents = [
      {
        role: 'user',
        parts: [{ text: options.userPrompt }],
      },
    ];

    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxTokens ?? 2048,
      responseMimeType: 'application/json',
    };

    if (options.schema) {
      generationConfig.responseSchema = cleanSchemaForGemini(options.schema);
    }

    const payload: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (options.systemPrompt) {
      payload.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new GeminiProviderError(
            'تم الوصول إلى الحد المؤقت لخدمة الذكاء الاصطناعي. حاول مرة أخرى لاحقًا.',
            'RATE_LIMITED'
          );
        }
        throw new GeminiProviderError(
          'خدمة الذكاء الاصطناعي غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.',
          'PROVIDER_UNAVAILABLE'
        );
      }

      const body = (await response.json().catch(() => null)) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      } | null;

      const candidate = body?.candidates?.[0];
      if (!candidate) {
        return {
          success: false,
          error: 'خدمة الذكاء الاصطناعي لم تُرجع أي نتائج صالحة',
        };
      }

      const rawContent = candidate.content?.parts?.[0]?.text;
      if (typeof rawContent !== 'string' || !rawContent.trim()) {
        return {
          success: false,
          error: 'خدمة الذكاء الاصطناعي أرجعت استجابة فارغة',
        };
      }

      const cleanedText = stripMarkdownFences(rawContent);

      try {
        const parsed = JSON.parse(cleanedText) as T;
        return {
          success: true,
          data: parsed,
          rawText: cleanedText,
          usage: {
            promptTokens: body?.usageMetadata?.promptTokenCount,
            completionTokens: body?.usageMetadata?.candidatesTokenCount,
            totalTokens: body?.usageMetadata?.totalTokenCount,
          },
        };
      } catch {
        return {
          success: false,
          rawText: cleanedText,
          error: 'الاستجابة الناتجة ليست بصيغة JSON صالحة',
        };
      }
    } catch (error: unknown) {
      if (error instanceof GeminiProviderError) {
        throw error;
      }
      if (options.signal?.aborted) {
        throw new GeminiProviderError('تم إلغاء الطلب', 'CANCELLED');
      }
      if (controller.signal.aborted) {
        throw new GeminiProviderError(
          'خدمة الذكاء الاصطناعي غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.',
          'TIMEOUT'
        );
      }
      throw new GeminiProviderError(
        'خدمة الذكاء الاصطناعي غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.',
        'PROVIDER_UNAVAILABLE'
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);
    }
  }

  async generatePlan(
    prompt: string,
    context?: unknown,
    options?: ProviderRequestOptions
  ): Promise<PlanResult> {
    const systemPrompt = getPlannerSystemPrompt();
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
      throw new GeminiProviderError(
        result.error || 'تعذر توليد خطة صالحة من خدمة المساعد الذكي',
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
    // Remote cloud API, no local model unload needed
    return true;
  }
}

let globalGeminiProvider: GeminiAiProvider | null = null;

export function getGeminiProvider(): GeminiAiProvider {
  if (!globalGeminiProvider) {
    globalGeminiProvider = new GeminiAiProvider();
  }
  return globalGeminiProvider;
}

export function setGeminiProvider(provider: GeminiAiProvider | null): void {
  globalGeminiProvider = provider;
}
