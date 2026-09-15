import { ProviderError } from '../ai-provider';
import type {
  AiProvider,
  LocalAiProvider,
  GenerateStructuredOutputOptions,
  StructuredOutputResult,
  PlanResult,
  ProviderHealthResult,
  ProviderRequestOptions,
} from '../ai-provider';

export type MockProviderMode =
  | 'success'
  | 'invalid_response'
  | 'offline'
  | 'timeout'
  | 'slow';

export interface MockProviderConfig {
  mode?: MockProviderMode;
  model?: string;
  mockData?: unknown;
  mockPlan?: PlanResult;
  mockPlans?: PlanResult[];
  planHandler?: (prompt: string, context?: unknown) => PlanResult | Promise<PlanResult>;
  latencyMs?: number;
  healthy?: boolean;
}

export class MockAiProvider implements LocalAiProvider {
  readonly name = 'mock';
  model: string;
  mode: MockProviderMode;
  mockData: unknown;
  mockPlan: PlanResult;
  mockPlans: PlanResult[];
  planHandler?: (prompt: string, context?: unknown) => PlanResult | Promise<PlanResult>;
  latencyMs: number;
  healthy: boolean;

  constructor(config: MockProviderConfig = {}) {
    this.model = config.model || 'mock-model-v1';
    this.mode = config.mode || 'success';
    this.mockData = config.mockData ?? { status: 'mock_success', items: [] };
    this.mockPlan = config.mockPlan ?? {
      planText: 'Mock educational plan',
      actions: [],
      explanation: 'This is a deterministic test plan.',
    };
    this.mockPlans = config.mockPlans ? [...config.mockPlans] : [];
    this.planHandler = config.planHandler;
    this.latencyMs = config.latencyMs ?? 0;
    this.healthy = config.healthy ?? true;
  }

  setMode(mode: MockProviderMode) {
    this.mode = mode;
  }

  setMockData(data: unknown) {
    this.mockData = data;
  }

  setMockPlan(plan: PlanResult) {
    this.mockPlan = plan;
  }

  setMockPlans(plans: PlanResult[]) {
    this.mockPlans = [...plans];
  }

  setPlanHandler(handler?: (prompt: string, context?: unknown) => PlanResult | Promise<PlanResult>) {
    this.planHandler = handler;
  }


  private async simulateDelay(options?: ProviderRequestOptions): Promise<void> {
    const delay = this.mode === 'slow' ? 2000 : this.latencyMs;
    if (delay <= 0) {
      if (options?.signal?.aborted) {
        throw new ProviderError('Operation was cancelled', 'CANCELLED');
      }
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve();
      }, delay);

      if (options?.signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new ProviderError('Operation was cancelled', 'CANCELLED'));
        };
        if (options.signal.aborted) {
          clearTimeout(timer);
          reject(new ProviderError('Operation was cancelled', 'CANCELLED'));
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async healthCheck(options?: ProviderRequestOptions): Promise<ProviderHealthResult> {
    await this.simulateDelay(options);

    if (this.mode === 'offline' || !this.healthy) {
      return {
        healthy: false,
        provider: this.name,
        model: this.model,
        message: 'Mock provider is set to offline or unhealthy',
      };
    }

    return {
      healthy: true,
      provider: this.name,
      model: this.model,
      latencyMs: this.latencyMs,
    };
  }

  async generateStructuredOutput<T = unknown>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredOutputResult<T>> {
    if (options.signal?.aborted) {
      throw new ProviderError('Operation was cancelled', 'CANCELLED');
    }

    if (this.mode === 'offline') {
      throw new ProviderError('Mock provider is offline', 'PROVIDER_OFFLINE');
    }

    if (this.mode === 'timeout') {
      throw new ProviderError('Mock provider request timed out', 'TIMEOUT');
    }

    await this.simulateDelay(options);

    if (this.mode === 'invalid_response') {
      return {
        success: false,
        error: 'Failed to parse structured JSON from mock provider',
        rawText: 'MALFORMED_NON_JSON_DATA_<<<',
      };
    }

    let payload = this.mockData as any;
    if (
      (!payload || !payload.questions) &&
      (options.userPrompt?.includes('questions') || options.systemPrompt?.includes('assessment'))
    ) {
      payload = {
        questions: [
          {
            prompt: 'The bank ........ by thieves last night.',
            options: ['robbed', 'was robbed', 'has robbed', 'is robbing'],
            correctAnswer: 'was robbed',
            correctIndex: 1,
            explanation: 'هنا البنك هو اللي اتعمل عليه الفعل، فمحتاجين Passive Voice. ومع Past Simple بنستخدم was/were + P.P.، علشان كده was robbed هي الصح.',
          },
          {
            prompt: 'While Ahmed was walking home, he ........ his old teacher.',
            options: ['meets', 'met', 'has met', 'was meet'],
            correctAnswer: 'met',
            correctIndex: 1,
            explanation: 'هنا عندنا حدث قطع حدث تاني كان مستمر في الماضي، فمحتاجين Past Simple، والماضي من meet هو met.',
          },
          {
            prompt: 'Mona has lived here ........ 2022.',
            options: ['for', 'since', 'ago', 'from'],
            correctAnswer: 'since',
            correctIndex: 1,
            explanation: 'وجود since مع نقطة بداية زي 2022 معناه إننا محتاجين Present Perfect، علشان كده الاختيار الصح since.',
          },
          {
            prompt: 'At eight, he ........ breakfast. He was in the middle of breakfast.',
            options: ['had eaten', 'has', 'is having', 'was having'],
            correctAnswer: 'was having',
            correctIndex: 3,
            explanation: 'وجود He was in the middle of breakfast معناه إن الفعل كان مستمر في اللحظة دي في الماضي، فمحتاجين Past Continuous. علشان كده was having هي الصح.',
          },
          {
            prompt: 'The thieves ........ the bank and killed the guard.',
            options: ['rob', 'robbed', 'robbing', 'are rob'],
            correctAnswer: 'robbed',
            correctIndex: 1,
            explanation: 'عندنا killed في نفس الجملة، وده حدث حصل وخلص في الماضي، فالفعل التاني لازم يمشي معاه في Past Simple. علشان كده robbed هي الصح.',
          },
        ],
      };
    }

    return {
      success: true,
      data: payload as T,
      rawText: JSON.stringify(payload),
      usage: {
        promptTokens: 50,
        completionTokens: 25,
        totalTokens: 75,
      },
    };
  }

  async generatePlan(
    _prompt: string,
    _context?: unknown,
    options?: ProviderRequestOptions
  ): Promise<PlanResult> {
    if (options?.signal?.aborted) {
      throw new ProviderError('Operation was cancelled', 'CANCELLED');
    }

    if (this.mode === 'offline') {
      throw new ProviderError('Mock provider is offline', 'PROVIDER_OFFLINE');
    }

    if (this.mode === 'timeout') {
      throw new ProviderError('Mock provider request timed out', 'TIMEOUT');
    }

    await this.simulateDelay(options);

    if (this.planHandler) {
      return this.planHandler(_prompt, _context);
    }

    if (this.mockPlans && this.mockPlans.length > 0) {
      return this.mockPlans.shift()!;
    }

    return this.mockPlan;
  }

  async unloadModel(): Promise<boolean> {
    return true;
  }
}
