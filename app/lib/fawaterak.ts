import { getPlatformEnv } from './platform';
import { constantTimeEqual, createFawaterakSignature } from './fawaterak-crypto';
import { isAllowedFawaterakBaseUrl, isAllowedFawaterakCheckoutUrl } from './fawaterak-validation';

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  message?: string;
};

type TransactionResponse = {
  status?: string;
  message?: string;
  data?: {
    intent_key?: string;
    url?: string;
    short_url?: string;
  };
};

export type FawaterakTransactionInput = {
  amount: number;
  currency: 'EGP';
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  item: {
    name: string;
    price: number;
  };
  paymentIntentId: string;
  enrollmentId: string;
  courseId: string;
  successUrl: string;
  failUrl: string;
  pendingUrl: string;
  backUrl: string;
  webhookUrl: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function config() {
  const env = getPlatformEnv();
  const baseUrl = env.FAWATERAK_BASE_URL?.replace(/\/$/, '');
  const clientId = env.FAWATERAK_CLIENT_ID?.trim();
  const clientSecret = env.FAWATERAK_CLIENT_SECRET?.trim();
  const vendorApiKey = env.FAWATERAK_VENDOR_API_KEY?.trim();

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('FAWATERAK_NOT_CONFIGURED');
  }
  if (!isAllowedFawaterakBaseUrl(`${baseUrl}/`)) {
    throw new Error('FAWATERAK_BASE_URL_INVALID');
  }

  return { baseUrl, clientId, clientSecret, vendorApiKey };
}

export function isFawaterakConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const { baseUrl, clientId, clientSecret } = config();
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(data.message || data.error || 'FAWATERAK_AUTH_FAILED');
  }

  cachedToken = {
    value: data.access_token,
    // Bound token reuse so revoking a gateway client takes effect promptly.
    expiresAt: Date.now() + Math.min(3_300, Math.max(60, Number(data.expires_in || 3600))) * 1000,
  };
  return cachedToken.value;
}

export async function createFawaterakTransaction(input: FawaterakTransactionInput) {
  const { baseUrl } = config();
  const token = await accessToken();
  const response = await fetch(`${baseUrl}/api/v3/createTransaction`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      cartTotal: input.amount,
      currency: input.currency,
      customer: {
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone,
        customer_unique_id: input.paymentIntentId,
      },
      cartItems: [{ name: input.item.name, price: input.item.price, quantity: 1 }],
      pay_load: {
        payment_intent_id: input.paymentIntentId,
        enrollment_id: input.enrollmentId,
        course_id: input.courseId,
      },
      redirectionUrls: {
        successUrl: input.successUrl,
        failUrl: input.failUrl,
        pendingUrl: input.pendingUrl,
        backUrl: input.backUrl,
        webhookUrl: input.webhookUrl,
      },
      tr_number: input.paymentIntentId,
      list_style: 'v',
      lang: 'ar',
      sendEmail: false,
      sendSMS: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as TransactionResponse;
  const checkoutUrl = data.data?.url || data.data?.short_url;
  const transactionKey = data.data?.intent_key;

  if (!response.ok || !checkoutUrl || !transactionKey) {
    throw new Error(data.message || 'FAWATERAK_CREATE_TRANSACTION_FAILED');
  }

  if (!isAllowedFawaterakCheckoutUrl(checkoutUrl, baseUrl)) {
    throw new Error('FAWATERAK_INVALID_CHECKOUT_URL');
  }

  return { checkoutUrl, transactionKey };
}

export async function signFawaterakWebhook(
  transactionId: string,
  transactionKey: string,
  paymentMethod: string,
  secret?: string
): Promise<string> {
  const vendorApiKey = secret || config().vendorApiKey;
  if (!vendorApiKey) throw new Error('FAWATERAK_WEBHOOK_NOT_CONFIGURED');

  return createFawaterakSignature(transactionId, transactionKey, paymentMethod, vendorApiKey);
}

export async function verifyFawaterakWebhook(input: {
  transactionId: string;
  transactionKey: string;
  paymentMethod: string;
  signature: string;
}): Promise<boolean> {
  if (!input.transactionId || !input.transactionKey || !input.paymentMethod || !input.signature) {
    return false;
  }
  const expected = await signFawaterakWebhook(
    input.transactionId,
    input.transactionKey,
    input.paymentMethod
  );
  return constantTimeEqual(expected.toLowerCase(), input.signature.toLowerCase());
}
