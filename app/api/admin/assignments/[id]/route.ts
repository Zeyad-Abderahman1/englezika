import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { getDatabase, getPrivateStorage } from '../../../../lib/platform';
import { captureException } from '../../../../lib/observability';
import { jsonError, requireSameOrigin, safeInteger, safeText } from '../../../../lib/security';
import { recordAuditLog } from '../../../../lib/audit';

function optionalTimestamp(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : undefined;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { id } = await params;

  const db = getDatabase();
  const existing = await db
    .prepare(
      `SELECT course_id AS courseId, title, description, due_at AS dueAt,
       max_score AS maxScore, status, COALESCE(type, 'pdf') AS type FROM assignments WHERE id = ?`
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return jsonError('الواجب غير موجود', 404);

  const courseId = safeText(body.courseId ?? existing.courseId, 80);
  const title = safeText(body.title ?? existing.title, 150);
  const description = safeText(body.description ?? existing.description, 3000);
  const dueAt = optionalTimestamp(body.dueAt === undefined ? existing.dueAt : body.dueAt);
  const maxScore = safeInteger(body.maxScore ?? existing.maxScore, 0, 0, 10_000);
  const status =
    body.status === undefined
      ? String(existing.status)
      : body.status === 'published'
        ? 'published'
        : 'draft';
  const rawType = body.type === undefined ? String(existing.type) : String(body.type);
  const type = rawType === 'mcq' ? 'mcq' : rawType === 'generic' ? 'generic' : 'pdf';

  if (!courseId || title.length < 3) return jsonError('بيانات الواجب غير مكتملة');
  if (dueAt === undefined) return jsonError('موعد تسليم الواجب غير صالح');
  const course = await db.prepare('SELECT id FROM courses WHERE id = ?').bind(courseId).first();
  if (!course) return jsonError('الكورس المحدد غير موجود', 404);

  await db
    .prepare(
      `UPDATE assignments SET course_id = ?, title = ?, description = ?, due_at = ?,
       max_score = ?, status = ?, type = ?, updated_at = ? WHERE id = ?`
    )
    .bind(courseId, title, description, dueAt, maxScore, status, type, Date.now(), id)
    .run();

  await db
    .prepare(
      "DELETE FROM notification_reads WHERE notification_type = 'assignment' AND notification_id = ?"
    )
    .bind(id)
    .run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const staff = await apiStaff(request, 'manage_assignments');
  if (isStaffResponse(staff)) return staff;
  const { id } = await params;
  const db = getDatabase();
  const existing = await db
    .prepare('SELECT id, teacher_file_key AS teacherFileKey FROM assignments WHERE id = ?')
    .bind(id)
    .first<{ id: string; teacherFileKey?: string | null }>();
  if (!existing) return jsonError('الواجب غير موجود', 404);

  const storage = getPrivateStorage();
  const submissions = await db
    .prepare(
      'SELECT pdf_storage_key AS pdfStorageKey FROM assignment_submissions WHERE assignment_id = ? AND pdf_storage_key IS NOT NULL'
    )
    .bind(id)
    .all<{ pdfStorageKey: string }>()
    .catch(() => ({ results: [] as { pdfStorageKey: string }[] }));

  const filesToDelete = new Set<string>();
  if (existing.teacherFileKey) {
    filesToDelete.add(existing.teacherFileKey);
  } else {
    filesToDelete.add(`assignments/${id}/teacher.pdf`);
  }
  for (const sub of submissions.results) {
    if (sub.pdfStorageKey) filesToDelete.add(sub.pdfStorageKey);
  }

  for (const key of filesToDelete) {
    try {
      await storage.delete(key);
    } catch (error) {
      captureException(error, { module: 'assignment-delete-storage', storageKey: key, assignmentId: id });
    }
  }

  await db.batch([
    db
      .prepare(
        "DELETE FROM notification_reads WHERE notification_type = 'assignment' AND notification_id = ?"
      )
      .bind(id),
    db.prepare('DELETE FROM course_items WHERE assignment_id = ?').bind(id),
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').bind(id),
    db.prepare('DELETE FROM assignment_questions WHERE assignment_id = ?').bind(id),
    db.prepare('DELETE FROM assignments WHERE id = ?').bind(id),
  ]);

  await recordAuditLog({
    userEmail: staff.email,
    action: 'assignment.deleted',
    resource: 'assignment',
    resourceId: id,
    request,
  });

  return new Response(null, { status: 204 });
}
