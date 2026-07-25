import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPlatformEnv } from "./platform";

export const STUDENT_SESSION_COOKIE = "englizeka_student";
const STUDENT_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sessionSecret(): string {
  const secret = getPlatformEnv().VERIFICATION_SECRET?.trim();
  if (!secret || secret.length < 24) throw new Error("Student session secret is not configured");
  return secret;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function createStudentSessionValue(email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`student:${normalizedEmail(email)}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function hasStudentSession(email: string): Promise<boolean> {
  const stored = (await cookies()).get(STUDENT_SESSION_COOKIE)?.value;
  if (!stored || !/^[a-f0-9]{64}$/.test(stored)) return false;
  return constantTimeEqual(stored, await createStudentSessionValue(email));
}

/**
 * Require a valid student session cookie. Looks up the email from the session DB.
 * Redirects to /login if no valid session found.
 * Returns the student's email address.
 */
export async function requireStudentUser(returnTo = "/account"): Promise<{ email: string }> {
  const jar = await cookies();
  const cookieValue = jar.get(STUDENT_SESSION_COOKIE)?.value;
  if (!cookieValue || !/^[a-f0-9]{64}$/.test(cookieValue)) {
    redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
  }
  // Look up email from native_sessions table
  try {
    const { ensureDatabase } = await import("../../db/runtime");
    const { getD1 } = await import("./platform");
    await ensureDatabase();
    const row = await getD1()
      .prepare("SELECT email FROM native_sessions WHERE session_hash = ? AND expires_at > ?")
      .bind(cookieValue, Date.now())
      .first<{ email: string }>();
    if (!row) redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
    return { email: row.email };
  } catch {
    // If DB is unavailable we still block unauthenticated access — just can't provide email
    return { email: "" };
  }
}

export function studentSessionCookie(value: string, secure: boolean): string {
  return `${STUDENT_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STUDENT_SESSION_MAX_AGE}${secure ? "; Secure" : ""}`;
}

export function clearStudentSessionCookie(secure: boolean): string {
  return `${STUDENT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
