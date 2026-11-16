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

export async function createFawaterakSignature(
  transactionId: string,
  transactionKey: string,
  paymentMethod: string,
  secret: string
): Promise<string> {
  const message = `TransactionId=${transactionId}&TransactionKey=${transactionKey}&PaymentMethod=${paymentMethod}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export function amountToMinorUnits(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const minorUnits = Math.round(parsed * 100);
  return Number.isSafeInteger(minorUnits) && minorUnits <= 2_147_483_647 ? minorUnits : null;
}
