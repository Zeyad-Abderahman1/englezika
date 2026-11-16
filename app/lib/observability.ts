export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

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
  'password',
  'currentpassword',
  'newpassword',
  'passwordconfirm',
  'password_hash',
  'password_salt',
  'token',
  'secret',
  'verificationsecret',
  'access_token',
  'api_key',
  'client_secret',
  'transaction_key',
  'code',
  'authorization',
  'cookie',
]);

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function sanitizeContext(context: LogContext = {}): Record<string, unknown> {
  const sanitizeValue = (value: unknown, depth: number): unknown => {
    if (depth > 5) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
    if (typeof value !== 'object' || value === null) return value;
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? '[REDACTED]'
        : sanitizeValue(nestedValue, depth + 1);
    }
    return result;
  };
  return sanitizeValue(context, 0) as Record<string, unknown>;
}

export function captureException(error: unknown, context: LogContext = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const name = error instanceof Error ? error.name : 'UnknownError';

  const payload = {
    timestamp: new Date().toISOString(),
    requestId: context.requestId || generateRequestId(),
    module: context.module || 'core',
    environment: process.env.NODE_ENV || 'production',
    level: 'ERROR',
    error: {
      name,
      message,
      stack,
    },
    context: sanitizeContext(context),
  };

  console.error(JSON.stringify(payload));
}

export function captureMessage(
  message: string,
  level: LogLevel = 'INFO',
  context: LogContext = {}
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    requestId: context.requestId || generateRequestId(),
    module: context.module || 'core',
    environment: process.env.NODE_ENV || 'production',
    level,
    message,
    context: sanitizeContext(context),
  };

  console.log(JSON.stringify(payload));
}
