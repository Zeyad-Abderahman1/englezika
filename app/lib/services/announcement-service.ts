import { getDatabase } from '../platform';
import { safeText } from '../security';
import { DomainError, type ServiceContext, type OperatorIdentity } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateAnnouncementInput {
  title?: unknown;
  body?: unknown;
}

export interface UpdateAnnouncementInput {
  title?: unknown;
  body?: unknown;
}

export class AnnouncementService {
  async createAnnouncement(
    input: CreateAnnouncementInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true; id: string }> {
    const title = safeText(input.title, 150);
    const content = safeText(input.body, 2000);

    if (title.length < 3 || content.length < 3) {
      throw new DomainError('عنوان الإعلان ومحتواه مطلوبان', 400);
    }

    const id = crypto.randomUUID();
    const db = context?.db ?? getDatabase();

    await db
      .prepare(
        "INSERT INTO announcements (id, title, body, status, created_at) VALUES (?, ?, ?, 'published', ?)"
      )
      .bind(id, title, content, Date.now())
      .run();

    return { ok: true, id };
  }

  async updateAnnouncement(
    id: string,
    input: UpdateAnnouncementInput,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    if (!UUID_RE.test(id)) {
      throw new DomainError('معرّف الإعلان غير صالح', 400);
    }

    const title = safeText(input.title, 150);
    const content = safeText(input.body, 2000);

    if (title.length < 3 || content.length < 3) {
      throw new DomainError('عنوان الإعلان ومحتواه مطلوبان', 400);
    }

    const db = context?.db ?? getDatabase();
    const result = await db
      .prepare('UPDATE announcements SET title = ?, body = ? WHERE id = ?')
      .bind(title, content, id)
      .run();

    if (result.meta.changes !== 1) {
      throw new DomainError('الإعلان غير موجود', 404);
    }

    await db
      .prepare(
        "DELETE FROM notification_reads WHERE notification_type = 'announcement' AND notification_id = ?"
      )
      .bind(id)
      .run();

    return { ok: true };
  }

  async deleteAnnouncement(
    id: string,
    _operator?: OperatorIdentity,
    context?: ServiceContext
  ): Promise<{ ok: true }> {
    if (!UUID_RE.test(id)) {
      throw new DomainError('معرّف الإعلان غير صالح', 400);
    }

    const db = context?.db ?? getDatabase();
    const existing = await db
      .prepare('SELECT id FROM announcements WHERE id = ?')
      .bind(id)
      .first<{ id: string }>();

    if (!existing) {
      throw new DomainError('الإعلان غير موجود', 404);
    }

    await db.batch([
      db
        .prepare(
          "DELETE FROM notification_reads WHERE notification_type = 'announcement' AND notification_id = ?"
        )
        .bind(id),
      db.prepare('DELETE FROM announcements WHERE id = ?').bind(id),
    ]);

    return { ok: true };
  }
}

export const announcementService = new AnnouncementService();
