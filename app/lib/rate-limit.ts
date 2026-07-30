import { getDatabase } from './platform';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAfterSeconds: number;
};

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '127.0.0.1';
}

/**
 * IP & action rate limiter backed by the PostgreSQL rate_limits table. (SEC-05)
 */
export async function checkRateLimit(
  action: string,
  identifier: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const safeWindow = Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60;
  const safeMaximum = Number.isSafeInteger(maxRequests) && maxRequests > 0 ? maxRequests : 1;
  const now = Date.now();
  const resetAt = now + Math.round(safeWindow * 1000);
  const key = `ratelimit:${action.slice(0, 64)}:${identifier.slice(0, 160)}`;

  const db = getDatabase();

  const current = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.reset_at <= ? THEN 1
           ELSE rate_limits.count + 1
         END,
         reset_at = CASE
           WHEN rate_limits.reset_at <= ? THEN excluded.reset_at
           ELSE rate_limits.reset_at
         END
       RETURNING count, reset_at AS resetAt`
    )
    .bind(key, resetAt, now, now)
    .first<{ count: number; resetAt: number }>();

  if (!current) throw new Error('Rate limiter failed to persist its counter');

  const effectiveMax =
    identifier === '127.0.0.1' || identifier === '::1' || process.env.NODE_ENV !== 'production'
      ? Math.max(safeMaximum, 30)
      : safeMaximum;

  const requestCount = Number(current.count || 0);
  const remainingSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));

  if (requestCount > effectiveMax) {
    return {
      allowed: false,
      remaining: 0,
      resetAfterSeconds: remainingSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, effectiveMax - requestCount),
    resetAfterSeconds: remainingSeconds,
  };
}

export function rateLimitResponse(
  resetAfterSeconds: number,
  message = 'تم تجاوز عدد المحاولات المسموح بها. حاول مرة أخرى لاحقاً.'
): Response {
  return new Response(JSON.stringify({ error: message, retryAfter: resetAfterSeconds }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(resetAfterSeconds),
      'cache-control': 'no-store',
    },
  });
}
