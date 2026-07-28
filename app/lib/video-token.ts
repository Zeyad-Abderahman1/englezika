export const VIDEO_EMBED_TOKEN_TTL_MS = 3 * 60_000;

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToText(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function createSignedVideoToken(
  secret: string,
  email: string,
  videoId: string,
  now = Date.now()
): Promise<string> {
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = textToBase64Url(
    JSON.stringify({
      email: normalizedEmail(email),
      videoId,
      expiresAt: now + VIDEO_EMBED_TOKEN_TTL_MS,
      nonce,
    })
  );
  return `${payload}.${await sign(secret, payload)}`;
}

export async function verifySignedVideoToken(
  secret: string,
  token: string,
  email: string,
  videoId: string,
  now = Date.now()
): Promise<boolean> {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return false;
  const expectedSignature = await sign(secret, payload);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const decoded = JSON.parse(base64UrlToText(payload)) as {
      email?: string;
      videoId?: string;
      expiresAt?: number;
    };
    return (
      decoded.email === normalizedEmail(email) &&
      decoded.videoId === videoId &&
      typeof decoded.expiresAt === 'number' &&
      decoded.expiresAt > now
    );
  } catch {
    return false;
  }
}
