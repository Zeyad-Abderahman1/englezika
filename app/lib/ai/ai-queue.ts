/**
 * AI Request Queue & Resource Guard
 *
 * Implements a bounded concurrency queue with load shedding,
 * bounded waiting queue, FIFO processing, timeout enforcement,
 * and cancellation support.
 */

export interface ResourceGuardOptions {
  maxQueueLength?: number;
  maxActiveStudentExams?: number;
  getActiveExamsCount?: () => Promise<number> | number;
}

export interface ResourceGuardDecision {
  allowed: boolean;
  reason?: string;
  details?: {
    queueLength?: number;
    activeExams?: number;
  };
}

export class ResourceGuard {
  private readonly maxQueueLength: number;
  private readonly maxActiveStudentExams: number;
  private readonly getActiveExamsCount?: () => Promise<number> | number;

  constructor(options: ResourceGuardOptions = {}) {
    this.maxQueueLength = options.maxQueueLength ?? 6;
    this.maxActiveStudentExams = options.maxActiveStudentExams ?? 25;
    this.getActiveExamsCount = options.getActiveExamsCount;
  }

  checkHeadroomSync(currentQueueLength: number = 0): ResourceGuardDecision {
    // 1. Queue saturation check
    if (currentQueueLength >= this.maxQueueLength) {
      return {
        allowed: false,
        reason: 'QUEUE_SATURATED',
        details: { queueLength: currentQueueLength },
      };
    }

    return {
      allowed: true,
      details: {
        queueLength: currentQueueLength,
      },
    };
  }

  async checkSystemHeadroom(currentQueueLength: number = 0): Promise<ResourceGuardDecision> {
    const syncCheck = this.checkHeadroomSync(currentQueueLength);
    if (!syncCheck.allowed) {
      return syncCheck;
    }

    // 2. Active Student Exams check (pluggable without DB coupling)
    if (this.getActiveExamsCount) {
      try {
        const activeExams = await this.getActiveExamsCount();
        if (activeExams > this.maxActiveStudentExams) {
          return {
            allowed: false,
            reason: 'ACTIVE_EXAMS_HIGH',
            details: { activeExams, queueLength: currentQueueLength },
          };
        }
      } catch {
        // If exam count check fails, continue
      }
    }

    return syncCheck;
  }
}

export interface QueueJob<T> {
  id: string;
  task: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  enqueuedAt: number;
}

export class QueueSaturatedError extends Error {
  readonly code = 'QUEUE_SATURATED';
  constructor(message = 'AI queue is currently full. Please wait for current generation to finish.') {
    super(message);
    this.name = 'QueueSaturatedError';
  }
}

export interface AiQueueOptions {
  maxConcurrent?: number;
  maxWaiting?: number;
  resourceGuard?: ResourceGuard;
  useGlobalGate?: boolean;
  workerId?: string;
  gateDb?: any;
}

export class AiQueue {
  readonly maxConcurrent: number;
  readonly maxWaiting: number;
  private running: number = 0;
  private queue: Array<QueueJob<unknown>> = [];
  private resourceGuard: ResourceGuard;
  private useGlobalGate: boolean;
  private workerId?: string;
  private gateDb?: any;

  constructor(options: AiQueueOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.maxWaiting = options.maxWaiting ?? 6;
    this.resourceGuard =
      options.resourceGuard ?? new ResourceGuard({ maxQueueLength: this.maxWaiting });
    this.useGlobalGate = options.useGlobalGate ?? false;
    this.workerId = options.workerId;
    this.gateDb = options.gateDb;
  }

  getStats() {
    return {
      executing: this.running,
      waiting: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxWaiting: this.maxWaiting,
    };
  }

  checkResourceHeadroom(currentQueueLength: number = this.queue.length): ResourceGuardDecision {
    return this.resourceGuard.checkHeadroomSync(currentQueueLength);
  }

  enqueue<T>(
    task: (signal: AbortSignal) => Promise<T>,
    options?: { signal?: AbortSignal; timeoutMs?: number; skipLocalResourceGuard?: boolean }
  ): Promise<T> {
    if (options?.signal?.aborted) {
      return Promise.reject(new Error('Task was cancelled before enqueuing'));
    }

    if (this.queue.length >= this.maxWaiting) {
      return Promise.reject(new QueueSaturatedError());
    }

    const decision = options?.skipLocalResourceGuard
      ? { allowed: true }
      : this.resourceGuard.checkHeadroomSync(this.queue.length);
    if (!decision.allowed) {
      if (decision.reason === 'QUEUE_SATURATED') {
        return Promise.reject(new QueueSaturatedError());
      }
      const err = new Error(`AI request rejected due to load shedding: ${decision.reason}`);
      (err as unknown as { code: string }).code = decision.reason || 'LOAD_SHEDDING';
      return Promise.reject(err);
    }

    return new Promise<T>((resolve, reject) => {
      let job: QueueJob<T>;

      const onAbort = () => {
        const index = this.queue.indexOf(job as QueueJob<unknown>);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Task was cancelled in queue'));
        }
      };

      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      job = {
        id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        task,
        resolve: (val: T) => {
          if (options?.signal) options.signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        reject: (err: unknown) => {
          if (options?.signal) options.signal.removeEventListener('abort', onAbort);
          reject(err);
        },
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        enqueuedAt: Date.now(),
      };

      this.queue.push(job as QueueJob<unknown>);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    if (job.signal?.aborted) {
      job.reject(new Error('Task was cancelled in queue'));
      return this.processNext();
    }

    this.running++;

    const abortController = new AbortController();
    let timeoutTimer: NodeJS.Timeout | null = null;

    if (job.timeoutMs && job.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        abortController.abort(new Error(`Task timed out after ${job.timeoutMs}ms`));
      }, job.timeoutMs);
    }

    const onParentAbort = () => {
      abortController.abort(new Error('Task was cancelled'));
    };

    if (job.signal) {
      job.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      let result: unknown;
      if (this.useGlobalGate) {
        const { withGlobalAiGate } = await import('./ai-global-gate.server');
        result = await withGlobalAiGate(
          (gateSignal) => job.task(gateSignal),
          {
            signal: abortController.signal,
            workerId: this.workerId,
            db: this.gateDb,
          }
        );
      } else {
        result = await job.task(abortController.signal);
      }
      job.resolve(result as any);
    } catch (err: unknown) {
      job.reject(err);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (job.signal) job.signal.removeEventListener('abort', onParentAbort);
      this.running--;
      setImmediate(() => this.processNext());
    }
  }
}

/** Global shared AI queue instance */
let globalAiQueue: AiQueue | null = null;

export function getGlobalAiQueue(): AiQueue {
  if (!globalAiQueue) {
    globalAiQueue = new AiQueue({
      maxConcurrent: Math.max(1, Math.min(10, Number(process.env.AI_QUEUE_MAX_CONCURRENT || 3))),
      maxWaiting: Math.max(1, Math.min(20, Number(process.env.AI_QUEUE_MAX_WAITING || 6))),
      useGlobalGate: Boolean(process.env.DATABASE_URL),
    });
  }
  return globalAiQueue;
}
