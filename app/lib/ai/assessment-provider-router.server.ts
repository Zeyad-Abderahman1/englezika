import 'server-only';
import type {
  GenerateStructuredOutputOptions,
  StructuredOutputResult,
} from './local-ai-provider';
import { getAiProvider } from './local-ai-provider';
import { getGlobalAiQueue, type ResourceGuardDecision } from './ai-queue';
import { loadAssessmentProviderConfig } from './assessment-provider-config.server';
import {
  AssessmentProviderError,
  OpenRouterAssessmentProvider,
  type AssessmentProviderFailureClass,
} from './providers/openrouter-assessment-provider.server';

export interface AssessmentGenerationProvider {
  readonly name: string;
  readonly model: string;
  readonly bypassLocalResourceGuard?: boolean;
  generateStructuredOutput<T = unknown>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredOutputResult<T>>;
}

export interface AssessmentProviderMetadata {
  provider: 'openrouter' | 'ollama';
  durationMs: number;
  openrouterModel: string;
  openrouterDurationMs: number;
  fallbackOccurred: boolean;
  ollamaDurationMs: number | null;
  failureClass: AssessmentProviderFailureClass | null;
  validationDurationMs?: number;
  completionPassDurationMs?: number;
}

export class AssessmentGenerationUnavailableError extends Error {
  readonly code = 'ASSESSMENT_GENERATION_UNAVAILABLE';
  readonly failureClass = 'local_load_high';
  constructor() {
    super('تعذر استخدام خدمة التوليد السحابية حاليًا، كما أن موارد الخادم المحلي مشغولة. حاول مرة أخرى بعد قليل.');
    this.name = 'AssessmentGenerationUnavailableError';
  }
}

function failureClassOf(error: unknown): AssessmentProviderFailureClass {
  if (error instanceof AssessmentProviderError) return error.failureClass;
  const value = (error as { failureClass?: unknown })?.failureClass;
  return typeof value === 'string'
    ? value as AssessmentProviderFailureClass
    : 'provider_unavailable';
}

function emitProviderEvent(event: Record<string, unknown>): void {
  console.info(JSON.stringify({ event: 'ai_assessment_provider', ...event }));
}

export class AssessmentProviderRouter implements AssessmentGenerationProvider {
  readonly name = 'assessment-provider-router';
  readonly model: string;
  readonly bypassLocalResourceGuard = true;
  private readonly primary: AssessmentGenerationProvider;
  private readonly fallback?: AssessmentGenerationProvider;
  private readonly checkLocalHeadroom: () => ResourceGuardDecision | Promise<ResourceGuardDecision>;

  constructor(options: {
    primary: AssessmentGenerationProvider;
    fallback?: AssessmentGenerationProvider;
    checkLocalHeadroom: () => ResourceGuardDecision | Promise<ResourceGuardDecision>;
  }) {
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.checkLocalHeadroom = options.checkLocalHeadroom;
    this.model = options.primary.model;
  }

  async generateStructuredOutput<T = unknown>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredOutputResult<T>> {
    const startedAt = Date.now();
    const openrouterModel = this.primary.model || 'openrouter/free';
    try {
      const result = await this.primary.generateStructuredOutput<T>(options);
      if (!result.success || !result.data) {
        throw new AssessmentProviderError('malformed_response');
      }
      const openrouterDurationMs = Date.now() - startedAt;
      const metadata: AssessmentProviderMetadata = {
        provider: 'openrouter',
        durationMs: openrouterDurationMs,
        openrouterModel,
        openrouterDurationMs,
        fallbackOccurred: false,
        ollamaDurationMs: null,
        failureClass: null,
      };
      emitProviderEvent(metadata as unknown as Record<string, unknown>);
      return Object.assign(result, {
        assessmentProviderMetadata: metadata,
      });
    } catch (error) {
      const openrouterDurationMs = Date.now() - startedAt;
      const primaryFailureClass = failureClassOf(error);
      if (primaryFailureClass === 'cancelled') throw error;
      if (!this.fallback) throw error;

      const headroom = await this.checkLocalHeadroom();
      if (!headroom.allowed) {
        emitProviderEvent({
          provider: 'ollama',
          durationMs: openrouterDurationMs,
          openrouterModel,
          openrouterDurationMs,
          fallbackOccurred: true,
          ollamaDurationMs: null,
          failureClass: 'local_load_high',
        });
        throw new AssessmentGenerationUnavailableError();
      }

      const ollamaStart = Date.now();
      const result = await this.fallback.generateStructuredOutput<T>(options);
      const ollamaDurationMs = Date.now() - ollamaStart;
      const totalDurationMs = Date.now() - startedAt;
      const metadata: AssessmentProviderMetadata = {
        provider: 'ollama',
        durationMs: totalDurationMs,
        openrouterModel,
        openrouterDurationMs,
        fallbackOccurred: true,
        ollamaDurationMs,
        failureClass: primaryFailureClass,
      };
      emitProviderEvent(metadata as unknown as Record<string, unknown>);
      return Object.assign(result, {
        assessmentProviderMetadata: metadata,
      });
    }
  }
}

export async function getAssessmentGenerationProvider(): Promise<AssessmentGenerationProvider> {
  const config = loadAssessmentProviderConfig();
  const localProvider = await getAiProvider();
  if (!config.remoteEnabled) return localProvider;

  const remoteProvider = new OpenRouterAssessmentProvider({
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
  });

  return new AssessmentProviderRouter({
    primary: remoteProvider,
    fallback: config.fallbackProvider === 'ollama' ? localProvider : undefined,
    checkLocalHeadroom: () => getGlobalAiQueue().checkResourceHeadroom(0),
  });
}
