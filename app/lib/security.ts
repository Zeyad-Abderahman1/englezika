export function safeText(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function safeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function isStrongPassword(value: string, minLength = 6, maxLength = 9): boolean {
  return (
    value.length >= minLength &&
    value.length <= maxLength &&
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

const CANONICAL_PRODUCTION_ORIGINS = new Set([
  'https://englezika.com',
  'https://www.englezika.com',
]);

function isAllowedOrigin(originUrl: URL, request: Request): boolean {
  // 1. Production canonical domains (always HTTPS)
  if (CANONICAL_PRODUCTION_ORIGINS.has(originUrl.origin)) {
    return true;
  }

  // 2. Configured APP_URL environment variable
  const appUrl = (
    (globalThis as unknown as { __ENGLIZEKA_ENV__?: { APP_URL?: string } }).__ENGLIZEKA_ENV__?.APP_URL ||
    process.env.APP_URL
  )?.trim();

  if (appUrl) {
    try {
      const parsedAppUrl = new URL(appUrl);
      if (originUrl.origin === parsedAppUrl.origin) {
        return true;
      }
      // Tolerate www vs non-www for configured APP_URL with same scheme and port
      if (originUrl.protocol === parsedAppUrl.protocol && originUrl.port === parsedAppUrl.port) {
        if (parsedAppUrl.hostname.startsWith('www.')) {
          if (originUrl.hostname === parsedAppUrl.hostname.slice(4)) return true;
        } else if (originUrl.hostname === `www.${parsedAppUrl.hostname}`) {
          return true;
        }
      }
    } catch {
      // Ignore invalid APP_URL
    }
  }

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.trim()?.split(',')[0]?.trim();
  const hostHeader = request.headers.get('host')?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.trim()?.toLowerCase();

  // In production, enforce HTTPS and only allow authorized domain hosts
  if (process.env.NODE_ENV === 'production') {
    const isHttps =
      originUrl.protocol === 'https:' &&
      (forwardedProto === 'https' || isSecureRequest(request));

    if (isHttps) {
      const incomingHost = forwardedHost || hostHeader;
      if (incomingHost && originUrl.host === incomingHost) {
        if (
          incomingHost === 'englezika.com' ||
          incomingHost === 'www.englezika.com' ||
          (appUrl && new URL(appUrl).host === incomingHost)
        ) {
          return true;
        }
      }
      if (originUrl.host === requestUrl.host) {
        return true;
      }
    }
    return false;
  }

  // Non-production / development / test runner
  if (originUrl.host === requestUrl.host) return true;
  if (hostHeader && originUrl.host === hostHeader) return true;
  if (forwardedHost && originUrl.host === forwardedHost) return true;

  const localHostnames = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (
    localHostnames.has(originUrl.hostname) &&
    (localHostnames.has(requestUrl.hostname) ||
      (hostHeader && localHostnames.has(hostHeader.split(':')[0])) ||
      (forwardedHost && localHostnames.has(forwardedHost.split(':')[0])))
  ) {
    if (
      originUrl.port === requestUrl.port ||
      (hostHeader?.includes(':') && originUrl.port === hostHeader.split(':')[1])
    ) {
      return true;
    }
  }

  return false;
}

export function requireSameOrigin(request: Request): Response | null {
  const rawOrigin = request.headers.get('origin')?.trim();
  const rawReferer = request.headers.get('referer')?.trim();

  // If neither origin nor referer is provided, allow request (non-browser clients / unit tests)
  if (!rawOrigin && !rawReferer) {
    return null;
  }

  // When origin is missing or 'null' (e.g. mobile sandbox/webview), use referer
  let candidate = rawOrigin;
  if (!candidate || candidate === 'null') {
    if (rawReferer) {
      try {
        candidate = new URL(rawReferer).origin;
      } catch {
        return jsonError('طلب غير مسموح', 403);
      }
    } else if (candidate === 'null') {
      return jsonError('طلب غير مسموح', 403);
    } else {
      return null;
    }
  }

  try {
    const originUrl = new URL(candidate);
    if (isAllowedOrigin(originUrl, request)) {
      // If referer is also present, ensure it does not come from a foreign origin
      if (rawReferer) {
        try {
          const refererUrl = new URL(rawReferer);
          if (
            (refererUrl.protocol === 'http:' || refererUrl.protocol === 'https:') &&
            !isAllowedOrigin(refererUrl, request)
          ) {
            return jsonError('طلب غير مسموح', 403);
          }
        } catch {
          return jsonError('طلب غير مسموح', 403);
        }
      }
      return null;
    }
  } catch {
    // Fall through to the rejection below.
  }
  return jsonError('طلب غير مسموح', 403);
}
