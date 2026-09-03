function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * Verify Kashier webhook signature per official documentation.
 *
 * Algorithm:
 * 1. Sort data.signatureKeys alphabetically
 * 2. Extract those key-value pairs from data
 * 3. Build URL-encoded query string (key=value&key=value)
 * 4. HMAC-SHA256(queryString, paymentApiKey) → hex lowercase
 * 5. Constant-time compare with x-kashier-signature header
 */
export async function verifyKashierSignature(
  data: Record<string, unknown>,
  receivedSignature: string,
  paymentApiKey: string
): Promise<boolean> {
  if (!receivedSignature || !paymentApiKey) return false;

  const signatureKeys = data.signatureKeys;
  if (!Array.isArray(signatureKeys) || signatureKeys.length === 0) return false;

  const sortedKeys = [...signatureKeys].sort();
  const pairs: string[] = [];
  for (const key of sortedKeys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    pairs.push(`${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`);
  }
  const signaturePayload = pairs.join('&');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(paymentApiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const computedSignature = toHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signaturePayload))
  );

  return constantTimeEqual(computedSignature.toLowerCase(), receivedSignature.toLowerCase());
}

export function amountToMinorUnits(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const minorUnits = Math.round(parsed * 100);
  return Number.isSafeInteger(minorUnits) && minorUnits <= 2_147_483_647 ? minorUnits : null;
}

export function mapKashierStatus(kashierStatus: string): string {
  switch (kashierStatus.toUpperCase()) {
    case 'SUCCESS':
      return 'paid';
    case 'PENDING':
    case 'CREATED':
    case 'OPENED':
      return 'pending';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'failed';
    default:
      return 'failed';
  }
}
