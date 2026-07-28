import { ensureDatabase } from '../../../../db/runtime';
import { apiUser, isResponse } from '../../../lib/api-auth';
import { getD1 } from '../../../lib/platform';
import { requireSameOrigin } from '../../../lib/security';

const ALLOWED_TYPES = ['announcement', 'exam', 'assignment'] as const;
type NotificationType = (typeof ALLOWED_TYPES)[number];

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as { types?: unknown };
  const requested = Array.isArray(body.types)
    ? body.types.filter((value): value is NotificationType =>
        ALLOWED_TYPES.includes(value as NotificationType)
      )
    : [...ALLOWED_TYPES];
  const types = [...new Set(requested)];
  if (!types.length) return Response.json({ ok: true });

  await ensureDatabase();
  const db = getD1();
  const email = user.email.toLowerCase();
  const now = Date.now();
  const statements = [];
  if (types.includes('announcement')) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO notification_reads
           (user_email, notification_type, notification_id, read_at)
           SELECT ?, 'announcement', id, ? FROM announcements WHERE status = 'published'`
        )
        .bind(email, now)
    );
  }
  if (types.includes('exam')) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO notification_reads
           (user_email, notification_type, notification_id, read_at)
           SELECT DISTINCT ?, 'exam', x.id, ?
           FROM exams x LEFT JOIN enrollments e
             ON e.course_id = x.course_id AND e.user_email = ? AND e.status = 'approved'
           WHERE x.status = 'published' AND (x.course_id IS NULL OR e.id IS NOT NULL)
             AND (x.opens_at IS NULL OR x.opens_at <= ?)
             AND (x.closes_at IS NULL OR x.closes_at >= ?)`
        )
        .bind(email, now, email, now, now)
    );
  }
  if (types.includes('assignment')) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO notification_reads
           (user_email, notification_type, notification_id, read_at)
           SELECT DISTINCT ?, 'assignment', a.id, ?
           FROM assignments a JOIN enrollments e ON e.course_id = a.course_id
           WHERE e.user_email = ? AND e.status = 'approved' AND a.status = 'published'`
        )
        .bind(email, now, email)
    );
  }
  if (statements.length) await db.batch(statements);
  return Response.json({ ok: true });
}
