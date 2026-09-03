import { getPlatformEnv } from './platform';
import { verifyKashierSignature, amountToMinorUnits, mapKashierStatus } from './kashier-crypto';

export type KashierMode = 'test' | 'live';

type KashierConfig = {
  mode: KashierMode;
  merchantId: string;
  paymentApiKey: string;
  secretKey: string;
  apiBaseUrl: string;
};

type SessionResponse = {
  _id?: string;
  sessionUrl?: string;
  status?: string;
  paymentParams?: Record<string, unknown>;
  error?: string;
  message?: string;
};

type SessionStatusResponse = {
  message?: string;
  data?: {
    sessionId?: string;
    status?: string;
    merchantOrderId?: string;
    amount?: string;
    currency?: string;
    method?: string;
    history?: Array<{ status: string; date: string }>;
  };
};

export type KashierSessionInput = {
  amount: number;
  currency: 'EGP';
  orderId: string;
  merchantId: string;
  courseId: string;
  userEmail: string;
  description: string;
  merchantRedirect: string;
  webhookUrl: string;
};

function config(): KashierConfig {
  const env = getPlatformEnv();
  const mode = (env.KASHIER_MODE?.trim().toLowerCase() || 'test') as KashierMode;
  const merchantId = env.KASHIER_MERCHANT_ID?.trim() || '';
  const paymentApiKey = env.KASHIER_PAYMENT_API_KEY?.trim() || '';
  const secretKey = env.KASHIER_SECRET_KEY?.trim() || '';

  if (!merchantId || !paymentApiKey || !secretKey) {
    throw new Error('KASHIER_NOT_CONFIGURED');
  }

  const apiBaseUrl =
    mode === 'live' ? 'https://api.kashier.io' : 'https://test-api.kashier.io';

  return { mode, merchantId, paymentApiKey, secretKey, apiBaseUrl };
}

export function isKashierConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

export function getKashierMode(): KashierMode {
  try {
    return config().mode;
  } catch {
    return 'test';
  }
}

export async function createKashierSession(input: KashierSessionInput) {
  const cfg = config();
  const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const body = {
    expireAt,
    maxFailureAttempts: 3,
    paymentType: 'credit',
    amount: (input.amount / 100).toFixed(2),
    currency: input.currency,
    order: input.orderId,
    merchantId: cfg.merchantId,
    mode: cfg.mode,
    merchantRedirect: encodeURIComponent(input.merchantRedirect),
    serverWebhook: input.webhookUrl,
    display: 'ar',
    type: 'one-time',
    allowedMethods: 'card,wallet,bank_installments',
    failureRedirect: true,
    description: input.description.slice(0, 120),
    metaData: JSON.stringify(
      encodeURIComponent(
        JSON.stringify({
          course_id: input.courseId,
          user_email: input.userEmail,
        })
      )
    ),
    customer: JSON.stringify(
      encodeURIComponent(
        JSON.stringify({
          email: input.userEmail,
          reference: input.orderId,
        })
      )
    ),
  };

  const response = await fetch(`${cfg.apiBaseUrl}/v3/payment/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: cfg.secretKey,
      'api-key': cfg.paymentApiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await response.json().catch(() => ({}))) as SessionResponse;

  if (!response.ok || !data.sessionUrl) {
    throw new Error(data.message || data.error || 'KASHIER_SESSION_FAILED');
  }

  return {
    sessionId: data._id || '',
    sessionUrl: data.sessionUrl,
  };
}

export async function getKashierSessionStatus(sessionId: string): Promise<{
  status: string;
  merchantOrderId?: string;
  amount?: string;
  currency?: string;
  method?: string;
} | null> {
  const cfg = config();

  const response = await fetch(
    `${cfg.apiBaseUrl}/v3/payment/sessions/${sessionId}/payment`,
    {
      method: 'GET',
      headers: {
        Authorization: cfg.secretKey,
      },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) return null;

  const data = (await response.json().catch(() => ({}))) as SessionStatusResponse;
  if (!data.data) return null;

  return {
    status: data.data.status || 'UNKNOWN',
    merchantOrderId: data.data.merchantOrderId,
    amount: data.data.amount,
    currency: data.data.currency,
    method: data.data.method,
  };
}

export async function verifyKashierWebhook(
  body: Record<string, unknown>,
  signature: string
): Promise<boolean> {
  const cfg = config();
  const data = body.data as Record<string, unknown> | undefined;
  if (!data || !signature) return false;
  return verifyKashierSignature(data, signature, cfg.paymentApiKey);
}

export { amountToMinorUnits, mapKashierStatus };
