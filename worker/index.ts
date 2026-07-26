/** Cloudflare Worker entry point for Englizeka. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from 'vinext/server/image-optimization';
import handler from 'vinext/server/app-router-entry';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  VIDEOS: R2Bucket;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_TEST_MODE?: string;
  VERIFICATION_SECRET?: string;
  INITIAL_STAFF_EMAIL?: string;
  INITIAL_STAFF_NAME?: string;
  INITIAL_STAFF_PASSWORD_HASH?: string;
  INITIAL_STAFF_PASSWORD_SALT?: string;
  INITIAL_STAFF_PASSWORD_ITERATIONS?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

import { validatePlatformEnv } from '../app/lib/env';
import { captureException } from '../app/lib/observability';

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    (globalThis as typeof globalThis & { __ENGLIZEKA_ENV__?: Env }).__ENGLIZEKA_ENV__ = env;
    const url = new URL(request.url);

    // Fail-fast environment variable validation (INFRA-04)
    const envValidation = validatePlatformEnv();
    if (!envValidation.valid) {
      const errorMsg = `[FATAL STARTUP ERROR] Environment Validation Failed:\n- ${envValidation.errors.join('\n- ')}`;
      captureException(new Error(errorMsg), { url: url.toString(), method: request.method });
      if (url.pathname.startsWith('/api/')) {
        return Response.json({ error: 'Server Configuration Error' }, { status: 500 });
      }
      return new Response('Server Configuration Error', { status: 500 });
    }

    try {
      if (url.pathname === '/_vinext/image') {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        return await handleImageOptimization(
          request,
          {
            fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
            transformImage: async (body, { width, format, quality }) => {
              const result = await env.IMAGES.input(body)
                .transform(width > 0 ? { width } : {})
                .output({ format, quality });
              return result.response();
            },
          },
          allowedWidths
        );
      }

      return await handler.fetch(request, env, ctx);
    } catch (error) {
      captureException(error, { url: url.toString(), method: request.method });
      if (process.env.NODE_ENV !== 'production') {
        const errorDetails = error instanceof Error ? error.stack || error.message : String(error);
        return new Response(
          `<!DOCTYPE html><html dir="rtl"><head><title>Dev Error</title></head><body style="font-family:sans-serif;padding:30px;background:#111216;color:#fff"><h2>خطأ في خادم التنمية المحلي (Dev Server Error)</h2><pre style="background:#181a1f;padding:20px;border-radius:10px;color:#ff8080;white-space:pre-wrap">${errorDetails}</pre></body></html>`,
          { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } }
        );
      }
      throw error;
    }
  },
};

export default worker;
