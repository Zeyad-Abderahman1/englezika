export function safeText(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function safeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function isStrongPassword(value: string): boolean {
  return (
    value.length >= 12 &&
    value.length <= 200 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function requestBodyWithinLimit(request: Request, maximum: number): boolean {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return false;
  const length = Number(rawLength);
  return Number.isSafeInteger(length) && length > 0 && length <= maximum;
}

export function requireSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const requestUrl = new URL(request.url);
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === requestUrl.host) return null;
    const localHostnames = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (
      process.env.NODE_ENV !== 'production' &&
      originUrl.port === requestUrl.port &&
      localHostnames.has(originUrl.hostname) &&
      localHostnames.has(requestUrl.hostname)
    ) {
      return null;
    }
  } catch {
    // Fall through to the rejection below.
  }
  return jsonError('طلب غير مسموح', 403);
}
