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
            prompt: 'Which sentence demonstrates the correct use of passive voice?',
            options: [
              'The lesson was explained by the teacher.',
              'The teacher explaining the lesson.',
              'The lesson explained the teacher.',
              'The teacher was explain the lesson.',
            ],
            correctAnswer: 'The lesson was explained by the teacher.',
            explanation: 'Passive voice uses was/were + past participle.',
          },
          {
            prompt: 'What is the past participle of the verb "write"?',
            options: ['Written', 'Wrote', 'Writing', 'Writes'],
            correctAnswer: 'Written',
            explanation: 'The three forms are write, wrote, written.',
          },
          {
            prompt: 'Choose the correct preposition: She has lived here ___ 2020.',
            options: ['Since', 'For', 'During', 'From'],
            correctAnswer: 'Since',
            explanation: 'Since is used with specific points in time.',
          },
          {
            prompt: 'Identify the synonym of the word "comprehend":',
            options: ['Understand', 'Confuse', 'Ignore', 'Forget'],
            correctAnswer: 'Understand',
            explanation: 'Comprehend means to grasp mentally or understand.',
          },
          {
            prompt: 'Complete the sentence: If it rains tomorrow, we ___ at home.',
            options: ['Will stay', 'Stayed', 'Would stay', 'Had stayed'],
            correctAnswer: 'Will stay',
            explanation: 'First conditional uses present simple in the if-clause and will + infinitive in the main clause.',
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
