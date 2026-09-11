import 'server-only';
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getDatabase } from '../database';
import { loadAiServerConfig } from './ai-config.server';
import { generateActionPreview, type ConfirmationPreview } from './preview-generator';

export const CONFIRMATION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
export const STALE_EXECUTION_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export type ConfirmationState = 'pending' | 'executing' | 'succeeded' | 'failed';

export interface ConfirmationRecord {
  id: string;
  token_hash: string;
  staff_email: string;
  action_type: string;
  action_payload: string;
  state: ConfirmationState;
  result_json: string | null;
  created_at: number;
  expires_at: number;
  executed_at: number | null;
  execution_id: string | null;
  error_message: string | null;
}

export interface CreateConfirmationOptions {
  actor: {
    email: string;
    role: string;
    permissions?: string[];
  };
  actionType: string;
  actionPayload: Record<string, any>;
  preview?: ConfirmationPreview;
  expiresInMs?: number;
  secret?: string;
  db?: any;
}

export interface ConfirmationTokenResult {
  tokenId: string;
  signature: string;
  token: string;
  actionType: string;
  expiresAt: number;
  preview: ConfirmationPreview;
}

export interface ExecuteConfirmationOptions {
  token: string | { tokenId: string; signature: string };
  actor: {
    email: string;
    role: string;
    permissions?: string[];
  };
  executor: (actionType: string, payload: Record<string, any>, txDb?: any) => Promise<any>;
  secret?: string;
  ipAddress?: string;
  db?: any;
}

export interface ConfirmationExecutionResult {
  success: boolean;
  cached: boolean;
  executionId: string;
  actionType: string;
  result: any;
  error?: string;
}

/**
 * Derives or validates the server confirmation secret
 */
function getConfirmationSecret(overrideSecret?: string): string {
  if (overrideSecret && overrideSecret.trim().length >= 32) {
    return overrideSecret.trim();
  }
  const config = loadAiServerConfig();
  if (!config.confirmationSecret || config.confirmationSecret.length < 32) {
    throw new Error('FATAL: AI_CONFIRMATION_SECRET is missing or has insufficient entropy (>= 32 chars required)');
  }
  return config.confirmationSecret;
}

/**
 * Computes deterministic HMAC signature for a confirmation token
 */
export function signConfirmation(
  tokenId: string,
  staffEmail: string,
  actionType: string,
  expiresAt: number,
  secret: string
): string {
  const payload = `${tokenId}:${staffEmail.toLowerCase()}:${actionType}:${expiresAt}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Parses client token string "tokenId.signature"
 */
export function parseConfirmationToken(
  tokenInput: string | { tokenId: string; signature: string }
): { tokenId: string; signature: string } {
  if (typeof tokenInput === 'object' && tokenInput !== null) {
    if (!tokenInput.tokenId || !tokenInput.signature) {
      throw new Error('Invalid confirmation token format: missing tokenId or signature');
    }
    return {
      tokenId: tokenInput.tokenId.trim(),
      signature: tokenInput.signature.trim(),
    };
  }

  if (typeof tokenInput !== 'string') {
    throw new Error('Invalid confirmation token: must be a string or token object');
  }

  const parts = tokenInput.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid confirmation token format: expected "tokenId.signature"');
  }

  return {
    tokenId: parts[0],
    signature: parts[1],
  };
}

/**
 * Constant-time signature verification
 */
export function verifyConfirmationSignature(
  tokenId: string,
  staffEmail: string,
  actionType: string,
  expiresAt: number,
  providedSignature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = signConfirmation(tokenId, staffEmail, actionType, expiresAt, secret);
    const providedBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Creates a durable confirmation record in PostgreSQL and returns the signed client token.
 * Canonical payload is saved server-side in the database.
 */
export async function createConfirmationRequest(
  options: CreateConfirmationOptions
): Promise<ConfirmationTokenResult> {
  const secret = getConfirmationSecret(options.secret);
  const database = options.db || getDatabase();

  const tokenId = randomUUID();
  const staffEmail = options.actor.email.trim().toLowerCase();
  const actionType = options.actionType.trim();
  const createdAt = Date.now();
  const expiresInMs = options.expiresInMs || CONFIRMATION_EXPIRY_MS;
  const expiresAt = createdAt + expiresInMs;

  const signature = signConfirmation(tokenId, staffEmail, actionType, expiresAt, secret);
  const tokenHash = createHash('sha256').update(signature).digest('hex');
  const payloadJson = JSON.stringify(options.actionPayload);

  const preview = options.preview || generateActionPreview(actionType, options.actionPayload);

  // Store in ai_confirmations table
  await database
    .prepare(
      `INSERT INTO ai_confirmations (
        id, token_hash, staff_email, action_type, action_payload,
        state, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .bind(tokenId, tokenHash, staffEmail, actionType, payloadJson, createdAt, expiresAt)
    .run();

  return {
    tokenId,
    signature,
    token: `${tokenId}.${signature}`,
    actionType,
    expiresAt,
    preview,
  };
}

/**
 * Durable execution engine for confirmed AI actions:
 * 1. Validates signature & actor identity
 * 2. Enforces expiration & durable state machine (pending -> executing -> succeeded/failed)
 * 3. Prevents duplicate execution and handles crashes safely
 * 4. Executes mutations inside database transaction where supported
 * 5. Returns cached result on retries of succeeded actions
 */
export async function verifyAndExecuteConfirmation(
  options: ExecuteConfirmationOptions
): Promise<ConfirmationExecutionResult> {
  const secret = getConfirmationSecret(options.secret);
  const database = options.db || getDatabase();
  const { tokenId, signature } = parseConfirmationToken(options.token);
  const staffEmail = options.actor.email.trim().toLowerCase();
  const now = Date.now();

  // 1. Fetch confirmation record from database
  const record = (await database
    .prepare('SELECT * FROM ai_confirmations WHERE id = ?')
    .bind(tokenId)
    .first()) as ConfirmationRecord | null;

  if (!record) {
    throw new Error('Confirmation token not found or invalid');
  }

  // 2. Validate actor identity
  if (record.staff_email.toLowerCase() !== staffEmail) {
    throw new Error(`Actor mismatch: confirmation was issued for ${record.staff_email}, not ${staffEmail}`);
  }

  // 3. Validate cryptographic signature
  const isSignatureValid = verifyConfirmationSignature(
    record.id,
    record.staff_email,
    record.action_type,
    record.expires_at,
    signature,
    secret
  );

  if (!isSignatureValid) {
    throw new Error('Invalid or tampered confirmation signature');
  }

  // 4. Handle existing durable states
  if (record.state === 'succeeded') {
    // Retry of already succeeded operation - return cached result without mutating
    const cachedResult = record.result_json ? JSON.parse(record.result_json) : {};
    return {
      success: true,
      cached: true,
      executionId: record.execution_id || tokenId,
      actionType: record.action_type,
      result: cachedResult,
    };
  }

  if (record.state === 'failed') {
    throw new Error(`Confirmation action already failed: ${record.error_message || 'Unknown error'}`);
  }

  // 5. Check expiration
  if (now > record.expires_at) {
    await database
      .prepare("UPDATE ai_confirmations SET state = 'failed', error_message = ? WHERE id = ? AND state = 'pending'")
      .bind('Confirmation token expired', tokenId)
      .run();
    throw new Error('Confirmation token has expired');
  }

  // 6. Handle executing state (crash / concurrency detection)
  if (record.state === 'executing') {
    const executedAt = record.executed_at || 0;
    const isStale = now - executedAt > STALE_EXECUTION_THRESHOLD_MS;

    if (isStale) {
      // Detected stale execution from crashed process.
      // Must NEVER blindly re-execute! Mark failed to require fresh approval.
      await database
        .prepare("UPDATE ai_confirmations SET state = 'failed', error_message = ? WHERE id = ?")
        .bind('Execution timed out or crashed previously; cannot safely re-execute', tokenId)
        .run();

      throw new Error('Confirmation execution is stale or crashed and cannot be safely re-executed');
    }

    // Currently executing by a concurrent request
    throw new Error('Confirmation action is currently executing in another process');
  }

  if (record.state !== 'pending') {
    throw new Error(`Invalid confirmation state: ${record.state}`);
  }

  // 7. Atomic transition: pending -> executing
  const executionId = randomUUID();
  const transitionResult = await database
    .prepare(
      "UPDATE ai_confirmations SET state = 'executing', execution_id = ?, executed_at = ? WHERE id = ? AND state = 'pending'"
    )
    .bind(executionId, now, tokenId)
    .run();

  if (transitionResult.meta.changes === 0) {
    throw new Error('Concurrent modification detected: confirmation state changed unexpectedly');
  }

  // 8. Execute canonical payload retrieved from database
  const canonicalPayload = JSON.parse(record.action_payload);

  try {
    let result: any;

    if (typeof database.withTransaction === 'function') {
      result = await database.withTransaction(async (txDb: any) => {
        // Run domain mutation inside transaction
        const opResult = await options.executor(record.action_type, canonicalPayload, txDb);

        const resultJson = JSON.stringify(opResult ?? {});
        const completionTime = Date.now();

        // Update confirmation to succeeded inside transaction
        await txDb
          .prepare(
            "UPDATE ai_confirmations SET state = 'succeeded', result_json = ?, executed_at = ? WHERE id = ?"
          )
          .bind(resultJson, completionTime, tokenId)
          .run();

        // Insert audit log inside transaction
        await txDb
          .prepare(
            `INSERT INTO ai_action_logs (
              id, staff_email, action_type, action_summary, status, details, ip_address, created_at
            ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)`
          )
          .bind(
            randomUUID(),
            staffEmail,
            record.action_type,
            `Confirmed execution of ${record.action_type}`,
            JSON.stringify({ executionId, tokenId }),
            options.ipAddress || null,
            completionTime
          )
          .run();

        return opResult;
      });
    } else {
      // Fallback for non-transactional database mocks
      result = await options.executor(record.action_type, canonicalPayload, database);
      const resultJson = JSON.stringify(result ?? {});
      const completionTime = Date.now();

      await database
        .prepare(
          "UPDATE ai_confirmations SET state = 'succeeded', result_json = ?, executed_at = ? WHERE id = ?"
        )
        .bind(resultJson, completionTime, tokenId)
        .run();

      await database
        .prepare(
          `INSERT INTO ai_action_logs (
            id, staff_email, action_type, action_summary, status, details, ip_address, created_at
          ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?)`
        )
        .bind(
          randomUUID(),
          staffEmail,
          record.action_type,
          `Confirmed execution of ${record.action_type}`,
          JSON.stringify({ executionId, tokenId }),
          options.ipAddress || null,
          completionTime
        )
        .run();
    }

    return {
      success: true,
      cached: false,
      executionId,
      actionType: record.action_type,
      result,
    };
  } catch (error: any) {
    // On failure: mark confirmation as failed and record audit log
    const failTime = Date.now();
    const errorMessage = error?.message || 'Execution error';

    try {
      await database
        .prepare(
          "UPDATE ai_confirmations SET state = 'failed', error_message = ?, executed_at = ? WHERE id = ?"
        )
        .bind(errorMessage, failTime, tokenId)
        .run();

      await database
        .prepare(
          `INSERT INTO ai_action_logs (
            id, staff_email, action_type, action_summary, status, details, ip_address, created_at
          ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?)`
        )
        .bind(
          randomUUID(),
          staffEmail,
          record.action_type,
          `Failed execution of ${record.action_type}: ${errorMessage}`,
          JSON.stringify({ executionId, tokenId, error: errorMessage }),
          options.ipAddress || null,
          failTime
        )
        .run();
    } catch {
      // Ignore secondary audit logging error
    }

    throw error;
  }
}
