export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export type LogContext = {
  requestId?: string;
  module?: string;
  url?: string;
  method?: string;
  userEmail?: string;
  action?: string;
  [key: string]: unknown;
};

const SENSITIVE_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "passwordConfirm",
  "password_hash",
  "password_salt",
  "token",
  "secret",
  "verificationSecret",
  "authorization",
  "cookie",
]);

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function sanitizeContext(context: LogContext = {}): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      try {
        sanitized[key] = JSON.parse(JSON.stringify(value));
      } catch {
        sanitized[key] = "[UNSERIALIZABLE]";
      }
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function captureException(error: unknown, context: LogContext = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const name = error instanceof Error ? error.name : "UnknownError";

  const payload = {
    timestamp: new Date().toISOString(),
    requestId: context.requestId || generateRequestId(),
    module: context.module || "core",
    environment: process.env.NODE_ENV || "production",
    level: "ERROR",
    error: {
      name,
      message,
      stack,
    },
    context: sanitizeContext(context),
  };

  console.error(JSON.stringify(payload));
}

export function captureMessage(message: string, level: LogLevel = "INFO", context: LogContext = {}): void {
  const payload = {
    timestamp: new Date().toISOString(),
    requestId: context.requestId || generateRequestId(),
    module: context.module || "core",
    environment: process.env.NODE_ENV || "production",
    level,
    message,
    context: sanitizeContext(context),
  };

  console.log(JSON.stringify(payload));
}
