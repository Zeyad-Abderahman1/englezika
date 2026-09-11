import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database';

export const AI_GATE_MAX_RUNNING = 1;
export const AI_GATE_MAX_WAITING = 2;
export const AI_GATE_MAX_TOTAL = 3;
export const AI_GATE_ADVISORY_LOCK = 2026091201;

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
export const DEFAULT_RUNNING_EXPIRY_MS = 30000;
export const DEFAULT_WAITING_EXPIRY_MS = 120000;
export const DEFAULT_POLL_INTERVAL_MS = 100;

export class AiGateSaturatedError extends Error {
  readonly code = 'AI_QUEUE_SATURATED';
  constructor(
    message = 'خدمة المساعد الذكي مشغولة حاليًا بعدد كبير من الطلبات. يرجى الانتظار قليلاً والمحاولة مرة أخرى.'
  ) {
    super(message);
    this.name = 'AiGateSaturatedError';
  }
}

export class AiGateCoordinationError extends Error {
  readonly code = 'AI_COORDINATION_FAILED';
  constructor(message = 'تعذر تنسيق طلب الذكاء الاصطناعي مع الخادم. يرجى المحاولة لاحقاً.') {
    super(message);
    this.name = 'AiGateCoordinationError';
  }
}

export interface GlobalAiGateOptions {
  db?: any;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  runningExpiryMs?: number;
  waitingExpiryMs?: number;
}

export interface GateExecuteParams<T> {
  requestId?: string;
  workerId?: string;
  signal?: AbortSignal;
  action: (signal: AbortSignal) => Promise<T>;
}

async function runQuery(db: any, sql: string, values: any[] = []): Promise<any> {
  const stmt = db.prepare(sql);
  if (typeof stmt.bind === 'function') {
    const bound = stmt.bind(...values);
    return bound.run();
  }
  return stmt.run(...values);
}

async function getFirstRow<T = any>(db: any, sql: string, values: any[] = []): Promise<T | null> {
  const stmt = db.prepare(sql);
  if (typeof stmt.bind === 'function') {
    const bound = stmt.bind(...values);
    if (typeof bound.first === 'function') {
      return bound.first();
    }
    if (typeof bound.get === 'function') {
      return bound.get();
    }
  }
  if (typeof stmt.first === 'function') {
    return stmt.first(...values);
  }
  if (typeof stmt.get === 'function') {
    return stmt.get(...values);
  }
  return null;
}

export class GlobalAiGate {
  private customDb?: any;
  private pollIntervalMs: number;
  private heartbeatIntervalMs: number;
  private runningExpiryMs: number;
  private waitingExpiryMs: number;

  constructor(options: GlobalAiGateOptions = {}) {
    this.customDb = options.db;
    this.pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.runningExpiryMs = options.runningExpiryMs || DEFAULT_RUNNING_EXPIRY_MS;
    this.waitingExpiryMs = options.waitingExpiryMs || DEFAULT_WAITING_EXPIRY_MS;
  }

  private getDb() {
    return this.customDb || getDatabase();
  }

  async execute<T>(params: GateExecuteParams<T>): Promise<T> {
    const requestId = params.requestId?.trim() || `req_${randomUUID()}`;
    const workerId = params.workerId?.trim() || `worker_${process.pid}_${randomUUID().slice(0, 8)}`;
    const externalSignal = params.signal;

    if (externalSignal?.aborted) {
      const err = new Error('تم إلغاء الطلب قبل البدء');
      err.name = 'AbortError';
      throw err;
    }

    const abortController = new AbortController();
    const onExternalAbort = () => {
      abortController.abort(externalSignal?.reason);
    };

    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let isAdmitted = false;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      const db = this.getDb();

      // ==========================================
      // STEP 1: ATOMIC ADMISSION UNDER ADVISORY LOCK
      // ==========================================
      try {
        await db.withTransaction(async (txDb: any) => {
          // Acquire transaction-scoped advisory lock (PostgreSQL only)
          try {
            await getFirstRow(txDb, 'SELECT pg_advisory_xact_lock(?)', [AI_GATE_ADVISORY_LOCK]);
          } catch {
            // Mock DB or environment without advisory lock continues safely
          }

          const now = Date.now();

          // A. Sweep expired rows (recovers stale crashed entries)
          await runQuery(txDb, 'DELETE FROM ai_runtime_queue WHERE expires_at < ?', [now]);

          // B. Check current total active capacity (1 running + 2 waiting = max 3)
          const countRow = await getFirstRow<{ count: number | string }>(
            txDb,
            'SELECT COUNT(*) as count FROM ai_runtime_queue'
          );

          const currentCount = Number(countRow?.count ?? 0);
          if (currentCount >= AI_GATE_MAX_TOTAL) {
            throw new AiGateSaturatedError();
          }

          // C. Insert new waiting row
          const expiresAt = now + this.waitingExpiryMs;
          await runQuery(
            txDb,
            `INSERT INTO ai_runtime_queue 
              (request_id, worker_id, status, created_at, heartbeat_at, expires_at) 
             VALUES (?, ?, 'waiting', ?, ?, ?)`,
            [requestId, workerId, now, now, expiresAt]
          );

          isAdmitted = true;
        });
      } catch (err: any) {
        if (err instanceof AiGateSaturatedError) {
          throw err;
        }
        // Fail-closed: sanitize DB connection error
        throw new AiGateCoordinationError(
          'تعذر تنسيق طلب الذكاء الاصطناعي مع الخادم. يرجى المحاولة لاحقاً.'
        );
      }

      // ==========================================
      // STEP 2: FIFO WAIT & CLAIM LOOP
      // ==========================================
      let claimedRunning = false;

      while (!claimedRunning) {
        if (abortController.signal.aborted) {
          const err = new Error('تم إلغاء الطلب أثناء الانتظار');
          err.name = 'AbortError';
          throw err;
        }

        try {
          await db.withTransaction(async (txDb: any) => {
            try {
              await getFirstRow(txDb, 'SELECT pg_advisory_xact_lock(?)', [AI_GATE_ADVISORY_LOCK]);
            } catch {}

            const now = Date.now();

            // 1. Sweep expired rows in case a running worker crashed while we were waiting
            await runQuery(txDb, 'DELETE FROM ai_runtime_queue WHERE expires_at < ?', [now]);

            // 2. Check if a non-expired running row exists
            const runningRow = await getFirstRow<{ id: number; request_id: string }>(
              txDb,
              "SELECT id, request_id FROM ai_runtime_queue WHERE status = 'running' AND expires_at >= ? LIMIT 1",
              [now]
            );

            if (runningRow) {
              if (runningRow.request_id === requestId) {
                // We are already marked running
                claimedRunning = true;
                return;
              }
              // Another worker is running; we must wait
              return;
            }

            // 3. No one is currently running; check who is the oldest waiting row
            const oldestWaiting = await getFirstRow<{ id: number; request_id: string }>(
              txDb,
              "SELECT id, request_id FROM ai_runtime_queue WHERE status = 'waiting' ORDER BY id ASC LIMIT 1"
            );

            if (!oldestWaiting) {
              return;
            }

            if (oldestWaiting.request_id === requestId) {
              // It is our turn! Claim the running slot
              const newExpiresAt = now + this.runningExpiryMs;
              await runQuery(
                txDb,
                "UPDATE ai_runtime_queue SET status = 'running', started_at = ?, heartbeat_at = ?, expires_at = ? WHERE request_id = ?",
                [now, now, newExpiresAt, requestId]
              );

              claimedRunning = true;
            }
          });
        } catch (claimErr: any) {
          if (claimErr instanceof AiGateSaturatedError) throw claimErr;
          if (claimErr.name === 'AbortError') throw claimErr;
          throw new AiGateCoordinationError();
        }

        if (!claimedRunning) {
          // Sleep before polling again
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
      }

      // ==========================================
      // STEP 3: RUNNING WITH HEARTBEAT
      // ==========================================
      heartbeatTimer = setInterval(async () => {
        try {
          const now = Date.now();
          const newExpiresAt = now + this.runningExpiryMs;
          await runQuery(
            db,
            'UPDATE ai_runtime_queue SET heartbeat_at = ?, expires_at = ? WHERE request_id = ?',
            [now, newExpiresAt, requestId]
          );
        } catch {
          // Suppress heartbeat errors to avoid crashing running action
        }
      }, this.heartbeatIntervalMs);

      if (typeof (heartbeatTimer as any).unref === 'function') {
        (heartbeatTimer as any).unref();
      }

      // Execute actual generation action with the signal
      return await params.action(abortController.signal);
    } finally {
      // ==========================================
      // STEP 4: CLEANUP & SLOT RELEASE
      // ==========================================
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }

      if (isAdmitted) {
        try {
          const db = this.getDb();
          await runQuery(db, 'DELETE FROM ai_runtime_queue WHERE request_id = ?', [requestId]);
        } catch {
          // Suppress final delete error to preserve primary error or result
        }
      }
    }
  }
}

let globalAiGateInstance: GlobalAiGate | null = null;

export function getGlobalAiGate(options?: GlobalAiGateOptions): GlobalAiGate {
  if (!globalAiGateInstance || options) {
    globalAiGateInstance = new GlobalAiGate(options);
  }
  return globalAiGateInstance;
}

export async function withGlobalAiGate<T>(
  action: (signal: AbortSignal) => Promise<T>,
  options?: {
    requestId?: string;
    workerId?: string;
    signal?: AbortSignal;
    db?: any;
  }
): Promise<T> {
  const gate = options?.db ? new GlobalAiGate({ db: options.db }) : getGlobalAiGate();
  return gate.execute({
    requestId: options?.requestId,
    workerId: options?.workerId,
    signal: options?.signal,
    action,
  });
}
