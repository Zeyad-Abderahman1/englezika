import { cookies } from 'next/headers';
import { ensureDatabase } from '../../db/runtime';
import { getD1 } from './platform';
import { jsonError } from './security';
import {
  STAFF_PERMISSIONS,
  STAFF_PRESETS,
  normalizeStaffPreset,
  type StaffPermission,
  type StaffPreset,
} from './staff-permissions';

export { STAFF_PERMISSIONS, STAFF_PRESETS, normalizeStaffPreset };
export type { StaffPermission, StaffPreset };

export const STAFF_COOKIE = 'englizeka_staff';
export const STAFF_SESSION_MS = 12 * 60 * 60 * 1000;
// Cloudflare Workers currently caps Web Crypto PBKDF2 at 100,000 iterations.
export const PASSWORD_ITERATIONS = 100_000;

export type StaffSession = {
  email: string;
  name: string;
  role: 'teacher' | 'assistant';
  permissions: StaffPermission[];
  expiresAt: number;
};

type StaffRow = {
  email: string;
  name: string;
  role: string;
  permissions: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  active: number;
  failedAttempts: number;
  lockedUntil: number | null;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parsePermissions(value: string): StaffPermission[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StaffPermission =>
        typeof item === 'string' && (STAFF_PERMISSIONS as readonly string[]).includes(item)
    );
  } catch {
    return [];
  }
}

export async function hashPassword(
  password: string,
  saltHex?: string,
  iterations = PASSWORD_ITERATIONS
) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{1,2}/g) ?? [], (pair) => Number.parseInt(pair, 16))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt), iterations };
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function tokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === STAFF_COOKIE) return decodeURIComponent(value.join('='));
  }
  return null;
}

export async function verifyStaffCredentials(
  emailInput: string,
  password: string
): Promise<StaffSession | null> {
  await ensureDatabase();
  const email = emailInput.trim().toLowerCase();
  const db = getD1();
  const row = await db
    .prepare(
      `SELECT email, name, role, permissions, password_hash AS passwordHash,
     password_salt AS passwordSalt, password_iterations AS passwordIterations,
     active, failed_attempts AS failedAttempts, locked_until AS lockedUntil
     FROM staff_users WHERE email = ?`
    )
    .bind(email)
    .first<StaffRow>();
  if (!row) {
    await hashPassword(password, '00000000000000000000000000000000', PASSWORD_ITERATIONS);
    return null;
  }
  if (!row.active || (row.lockedUntil && row.lockedUntil > Date.now())) {
    await hashPassword(password, row.passwordSalt, row.passwordIterations);
    return null;
  }
  const candidate = await hashPassword(password, row.passwordSalt, row.passwordIterations);
  if (!constantTimeEqual(candidate.hash, row.passwordHash)) {
    const failures = Number(row.failedAttempts || 0) + 1;
    const lockedUntil = failures >= 5 ? Date.now() + 15 * 60_000 : null;
    await db
      .prepare(
        'UPDATE staff_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE email = ?'
      )
      .bind(failures, lockedUntil, Date.now(), email)
      .run();
    return null;
  }
  await db
    .prepare(
      'UPDATE staff_users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE email = ?'
    )
    .bind(Date.now(), email)
    .run();
  return {
    email: row.email,
    name: row.name,
    role: row.role === 'teacher' ? 'teacher' : 'assistant',
    permissions: parsePermissions(row.permissions),
    expiresAt: Date.now() + STAFF_SESSION_MS,
  };
}

export async function createStaffSession(
  staff: StaffSession
): Promise<{ token: string; expiresAt: number }> {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = Date.now();
  const expiresAt = now + STAFF_SESSION_MS;
  const db = getD1();
  await db.batch([
    db.prepare('DELETE FROM staff_sessions WHERE expires_at <= ?').bind(now),
    db
      .prepare(
        `INSERT INTO staff_sessions (token_hash, staff_email, expires_at, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?)`
      )
      .bind(tokenHash, staff.email, expiresAt, now, now),
  ]);
  return { token, expiresAt };
}

export function staffCookie(token: string, expiresAt: number, secure: boolean): string {
  return `${STAFF_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor((expiresAt - Date.now()) / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearStaffCookie(secure: boolean): string {
  return `${STAFF_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function getCurrentStaff(request?: Request): Promise<StaffSession | null> {
  const token = request
    ? tokenFromCookieHeader(request.headers.get('cookie'))
    : ((await cookies()).get(STAFF_COOKIE)?.value ?? null);
  if (!token) return null;
  await ensureDatabase();
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await getD1()
    .prepare(
      `SELECT s.expires_at AS expiresAt, u.email, u.name, u.role, u.permissions
     FROM staff_sessions s JOIN staff_users u ON u.email = s.staff_email
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
    )
    .bind(tokenHash, now)
    .first<{ expiresAt: number; email: string; name: string; role: string; permissions: string }>();
  if (!row) return null;
  await getD1()
    .prepare('UPDATE staff_sessions SET last_seen = ? WHERE token_hash = ?')
    .bind(now, tokenHash)
    .run();
  return {
    email: row.email,
    name: row.name,
    role: row.role === 'teacher' ? 'teacher' : 'assistant',
    permissions: parsePermissions(row.permissions),
    expiresAt: row.expiresAt,
  };
}

export async function deleteCurrentStaffSession(request: Request): Promise<void> {
  const token = tokenFromCookieHeader(request.headers.get('cookie'));
  if (!token) return;
  await ensureDatabase();
  await getD1()
    .prepare('DELETE FROM staff_sessions WHERE token_hash = ?')
    .bind(await sha256(token))
    .run();
}

export async function apiStaff(
  request: Request,
  permission?: StaffPermission
): Promise<StaffSession | Response> {
  const staff = await getCurrentStaff(request);
  if (!staff) return jsonError('يجب تسجيل الدخول بحساب المدرس أو المساعد', 401);
  if (permission && !staff.permissions.includes(permission)) {
    return jsonError('ليس لديك صلاحية لتنفيذ هذا الإجراء', 403);
  }
  return staff;
}

export function isStaffResponse(value: StaffSession | Response): value is Response {
  return value instanceof Response;
}
