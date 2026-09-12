import 'server-only';
import type {
  GenerateStructuredOutputOptions,
  StructuredOutputResult,
} from '../local-ai-provider';
import {
  ASSESSMENT_QUESTIONS_JSON_SCHEMA,
  validateGeneratedAssessment,
} from '../assessment-validator';
import { selectFreeOpenRouterModel } from '../assessment-provider-config.server';

export type AssessmentProviderFailureClass =
  | 'timeout'
  | 'rate_limit'
  | 'http_error'
  | 'malformed_response'
  | 'provider_unavailable'
  | 'cancelled';

export class AssessmentProviderError extends Error {
  readonly failureClass: AssessmentProviderFailureClass;
  constructor(
    failureClass: AssessmentProviderFailureClass,
    message = 'Assessment generation provider is unavailable'
  ) {
    super(message);
    this.name = 'AssessmentProviderError';
    this.failureClass = failureClass;
  }
}

export interface OpenRouterAssessmentProviderConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type OpenRouterPayload = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export class OpenRouterAssessmentProvider {
  readonly name = 'openrouter';
  readonly model: string;
  readonly bypassLocalResourceGuard = true;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenRouterAssessmentProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = selectFreeOpenRouterModel(config.model);
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.fetchImpl = config.fetchImpl || fetch;
  }

  async generateStructuredOutput<T = unknown>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredOutputResult<T>> {
    if (!this.apiKey) {
      throw new AssessmentProviderError('provider_unavailable');
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();

    if (options.signal?.aborted) {
      clearTimeout(timeout);
      throw new AssessmentProviderError('cancelled', 'Assessment generation was cancelled');
    }
    options.signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(options.systemPrompt
              ? [{ role: 'system', content: options.systemPrompt }]
              : []),
            { role: 'user', content: options.userPrompt },
          ],
          temperature: options.temperature ?? 0.3,
          max_tokens: Math.max(512, Math.min(16_384, options.maxTokens ?? 2_000)),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'englizeka_assessment_questions',
              strict: true,
              schema: options.schema || ASSESSMENT_QUESTIONS_JSON_SCHEMA,
            },
          },
          provider: {
            require_parameters: true,
            data_collection: 'deny',
            allow_fallbacks: true,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AssessmentProviderError(
          response.status === 429 ? 'rate_limit' : 'http_error'
        );
      }

      const payload = (await response.json().catch(() => null)) as OpenRouterPayload | null;
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw new AssessmentProviderError('malformed_response', 'Assessment response was truncated');
      }
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new AssessmentProviderError('malformed_response');
      }

      let data: T;
      try {
        data = JSON.parse(content) as T;
      } catch {
        throw new AssessmentProviderError('malformed_response');
      }
      if (
        !data || typeof data !== 'object' ||
        !Array.isArray((data as { questions?: unknown }).questions)
      ) {
        throw new AssessmentProviderError('malformed_response');
      }
      const questions = (data as unknown as { questions: unknown[] }).questions;
      if (validateGeneratedAssessment(questions).validQuestions.length === 0) {
        throw new AssessmentProviderError('malformed_response');
      }

      return {
        success: true,
        data,
        usage: {
          promptTokens: payload?.usage?.prompt_tokens,
          completionTokens: payload?.usage?.completion_tokens,
          totalTokens: payload?.usage?.total_tokens,
        },
      };
    } catch (error) {
      if (error instanceof AssessmentProviderError) throw error;
      if (options.signal?.aborted) {
        throw new AssessmentProviderError('cancelled', 'Assessment generation was cancelled');
      }
      if (controller.signal.aborted) {
        throw new AssessmentProviderError('timeout', 'Assessment provider request timed out');
      }
      throw new AssessmentProviderError('provider_unavailable');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onParentAbort);
    }
  }
}
