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

export function isSecureRequest(request: Request): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    request.headers.get('x-forwarded-proto')?.toLowerCase() === 'https' ||
    new URL(request.url).protocol === 'https:'
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

export async function readBoundedJson<T = Record<string, unknown>>(
  request: Request,
  maximum = 32 * 1024
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const rawLength = request.headers.get('content-length');
  if (rawLength) {
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length <= 0 || length > maximum) {
      return { ok: false, response: jsonError('حجم الطلب غير صالح', 413) };
    }
  }

  if (!request.body) {
    return { ok: false, response: jsonError('محتوى الطلب فارغ', 400) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maximum) {
          await reader.cancel();
          return { ok: false, response: jsonError('حجم الطلب غير صالح', 413) };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, response: jsonError('تعذر قراءة محتوى الطلب', 400) };
  }

  if (totalBytes === 0) {
    return { ok: false, response: jsonError('محتوى الطلب فارغ', 400) };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder().decode(combined);
    const data = JSON.parse(text) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, response: jsonError('صيغة البيانات غير صحيحة', 400) };
  }
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
