import { getD1 } from './platform';
import { ensureDatabase } from '../../db/runtime';
import { captureMessage } from './observability';

export type AuditLogEntry = {
  userEmail: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  request?: Request;
};

/**
 * Record an administrative action into the audit_logs table and structured log. (SEC-03)
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  const now = Date.now();
  const id = crypto.randomUUID();
  let ip: string | null = null;
  let userAgent: string | null = null;

  if (entry.request) {
    ip =
      entry.request.headers.get('cf-connecting-ip') ||
      entry.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      '127.0.0.1';
    userAgent = entry.request.headers.get('user-agent') || null;
  }

  const detailsJson = entry.details ? JSON.stringify(entry.details) : null;

  captureMessage(
    `AUDIT: [${entry.action}] on ${entry.resource}${entry.resourceId ? `:${entry.resourceId}` : ''} by ${entry.userEmail}`,
    'INFO',
    {
      userEmail: entry.userEmail,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      ip,
    }
  );

  try {
    await ensureDatabase();
    await getD1()
      .prepare(
        `INSERT INTO audit_logs (id, user_email, action, resource, resource_id, details, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        entry.userEmail.toLowerCase(),
        entry.action,
        entry.resource,
        entry.resourceId || null,
        detailsJson,
        ip,
        userAgent,
        now
      )
      .run();
  } catch (error) {
    console.error('Failed to insert audit log entry into DB', error);
  }
}
