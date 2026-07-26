import { getD1 } from "./platform";
import { ensureDatabase } from "../../db/runtime";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAfterSeconds: number;
};

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "127.0.0.1";
}

/**
 * IP & action rate limiter backed by D1 rate_limits table. (SEC-05)
 */
export async function checkRateLimit(
  action: string,
  identifier: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const safeWindow = Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60;
  const now = Date.now();
  const resetAt = now + Math.round(safeWindow * 1000);
  const key = `ratelimit:${action}:${identifier}`;

  await ensureDatabase();
  const db = getD1();

  try {
    await db.prepare("DELETE FROM rate_limits WHERE key = ? OR reset_at IS NULL OR reset_at < ?;").bind(key, now).run();
  } catch {
    await db.prepare("DROP TABLE IF EXISTS rate_limits;").run().catch(() => {});
    await db.prepare("CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 1, reset_at INTEGER NOT NULL DEFAULT 0);").run().catch(() => {});
  }

  const current = await db.prepare(
    "SELECT count, reset_at AS resetAt FROM rate_limits WHERE key = ?",
  ).bind(key).first<{ count: number; resetAt: number }>();

  const effectiveMax = (identifier === "127.0.0.1" || identifier === "::1" || process.env.NODE_ENV !== "production")
    ? Math.max(maxRequests, 30)
    : maxRequests;

  if (!current) {
    await db.prepare(
      "INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)",
    ).bind(key, resetAt).run();

    return {
      allowed: true,
      remaining: effectiveMax - 1,
      resetAfterSeconds: safeWindow,
    };
  }

  const newCount = Number(current.count || 0) + 1;
  const remainingSeconds = Math.max(1, Math.ceil(((current.resetAt || resetAt) - now) / 1000));

  if (newCount > effectiveMax) {
    return {
      allowed: false,
      remaining: 0,
      resetAfterSeconds: remainingSeconds,
    };
  }

  await db.prepare("UPDATE rate_limits SET count = ?, reset_at = ? WHERE key = ?").bind(newCount, current.resetAt || resetAt, key).run();

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - newCount),
    resetAfterSeconds: remainingSeconds,
  };
}

export function rateLimitResponse(resetAfterSeconds: number, message = "تم تجاوز عدد المحاولات المسموح بها. حاول مرة أخرى لاحقاً."): Response {
  return new Response(
    JSON.stringify({ error: message, retryAfter: resetAfterSeconds }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(resetAfterSeconds),
        "cache-control": "no-store",
      },
    },
  );
}
