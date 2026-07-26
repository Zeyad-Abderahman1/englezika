import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformEnv, getD1 } from "./platform";
import { ensureDatabase } from "../../db/runtime";

export const STUDENT_SESSION_COOKIE = "englizeka_student";
export const STUDENT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sessionSecret(): string {
  const env = getPlatformEnv();
  const secret = (env.VERIFICATION_SECRET ?? (env as Record<string, string | undefined>).SESSION_SECRET)?.trim();
  if (!secret || secret.length < 24) {
    throw new Error("FATAL STARTUP ERROR: VERIFICATION_SECRET / SESSION_SECRET environment variable is missing or invalid (must be >= 24 characters)");
  }
  return secret;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Generate a cryptographically secure random session token and store its SHA-256 hash
 * in native_sessions DB. (SEC-01 & SEC-03)
 */
export async function createStudentSession(email: string): Promise<{ token: string; expiresAt: number }> {
  // Validate secret exists
  sessionSecret();

  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = Date.now();
  const expiresAt = now + STUDENT_SESSION_MAX_AGE_MS;
  const targetEmail = normalizedEmail(email);

  await ensureDatabase();
  const db = getD1();
  await db.batch([
    db.prepare("DELETE FROM native_sessions WHERE expires_at <= ?").bind(now),
    db.prepare(
      `INSERT INTO native_sessions (session_hash, email, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_hash) DO UPDATE SET expires_at = excluded.expires_at`,
    ).bind(tokenHash, targetEmail, expiresAt, now),
  ]);

  return { token, expiresAt };
}

/** Legacy helper signature for backward compatibility during transition */
export async function createStudentSessionValue(email: string): Promise<string> {
  const session = await createStudentSession(email);
  return session.token;
}

export async function deleteStudentSession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = await sha256(token);
  await ensureDatabase();
  await getD1().prepare("DELETE FROM native_sessions WHERE session_hash = ?").bind(tokenHash).run();
}

export async function hasStudentSession(email: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(STUDENT_SESSION_COOKIE)?.value;
  if (!token || token.length < 16) return false;
  const tokenHash = await sha256(token);
  await ensureDatabase();
  const row = await getD1()
    .prepare("SELECT email FROM native_sessions WHERE session_hash = ? AND expires_at > ?")
    .bind(tokenHash, Date.now())
    .first<{ email: string }>();
  return Boolean(row && normalizedEmail(row.email) === normalizedEmail(email));
}

/**
 * Require a valid student session cookie. Looks up the email from native_sessions DB.
 * Redirects to /login if no valid session found.
 */
export async function requireStudentUser(returnTo = "/account"): Promise<{ email: string }> {
  const jar = await cookies();
  const token = jar.get(STUDENT_SESSION_COOKIE)?.value;
  if (!token || token.length < 16) {
    redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
  }
  try {
    const tokenHash = await sha256(token);
    await ensureDatabase();
    const row = await getD1()
      .prepare("SELECT email FROM native_sessions WHERE session_hash = ? AND expires_at > ?")
      .bind(tokenHash, Date.now())
      .first<{ email: string }>();
    if (!row) redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
    return { email: row.email };
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) {
      throw error;
    }
    redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
  }
}

export function studentSessionCookie(token: string, secure: boolean): string {
  return `${STUDENT_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(STUDENT_SESSION_MAX_AGE_MS / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearStudentSessionCookie(secure: boolean): string {
  return `${STUDENT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

