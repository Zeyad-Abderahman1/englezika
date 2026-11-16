import { recordAuditLog } from '../audit';

/**
 * Chat history for the admin AI assistant (list / open / search / rename / delete).
 *
 * It reuses the existing tables: ai_conversations, ai_messages (cards live in
 * tool_call_json), ai_agent_sessions (flow state), ai_confirmations (single-use tokens) and
 * ai_exam_extractions. Every function is scoped to ONE staff email: another user's id behaves
 * exactly like a missing one (callers answer 404).
 *
 * Deleting a chat removes the conversation, its messages (FK cascade), its session (FK cascade),
 * its unsaved exam extractions and unconsumed staged images. It never touches ai_action_logs or
 * audit_logs (they have no foreign key to conversations), nor anything the assistant created.
 * Still-pending confirmations of the chat are disabled (state 'failed') but the rows are kept
 * so the accountability trail stays intact.
 */

type Row = Record<string, unknown>;

export interface HistoryDb {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T = unknown>() => Promise<T | null>;
      all: <T = unknown>() => Promise<{ results?: T[] } | T[]>;
      run: () => Promise<unknown>;
    };
  };
  batch?: (statements: unknown[]) => Promise<unknown>;
}

export const DEFAULT_TITLE = 'محادثة جديدة';
export const TITLE_MAX = 80;
export const LIST_PAGE_SIZE = 20;
export const MESSAGE_PAGE_SIZE = 50;
const DELETE_ALL_BATCH = 200;

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

export type CardStatus = 'active' | 'used' | 'expired' | 'cancelled' | 'failed';

const rowsOf = <T = Row>(result: { results?: T[] } | T[] | null | undefined): T[] =>
  Array.isArray(result) ? result : Array.isArray(result?.results) ? (result?.results as T[]) : [];

const num = (value: unknown) => Number(value ?? 0) || 0;

export function cleanTitle(value: unknown, max = TITLE_MAX): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Title shown for a first user message: about 40 characters, no model call. */
export function autoTitle(message: string): string {
  const text = cleanTitle(message, 200);
  if (!text) return DEFAULT_TITLE;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

export function encodeCursor(updatedAt: number, id: string): string {
  return `${updatedAt}_${id}`;
}

export function decodeCursor(cursor: string | null | undefined): { updatedAt: number; id: string } | null {
  if (!cursor) return null;
  const match = /^(\d{1,16})_([\w-]{1,80})$/.exec(cursor);
  return match ? { updatedAt: Number(match[1]), id: match[2] } : null;
}

async function owns(db: HistoryDb, email: string, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM ai_conversations WHERE id = ? AND staff_email = ?')
    .bind(id, email.toLowerCase())
    .first();
  return Boolean(row);
}

export async function listConversations(
  db: HistoryDb,
  email: string,
  options: { cursor?: string | null; query?: string; limit?: number } = {}
): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? LIST_PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(options.cursor);
  const q = cleanTitle(options.query, 60).replace(/[%_\\]/g, ' ').trim();

  const where = ['c.staff_email = ?'];
  const values: unknown[] = [email.toLowerCase()];
  if (cursor) {
    where.push('(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))');
    values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  if (q) {
    where.push('(c.title ILIKE ? OR EXISTS (SELECT 1 FROM ai_messages m WHERE m.conversation_id = c.id AND m.content ILIKE ?))');
    values.push(`%${q}%`, `%${q}%`);
  }
  values.push(limit + 1);

  const result = await db
    .prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at FROM ai_conversations c
       WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`
    )
    .bind(...values)
    .all<Row>();

  const rows = rowsOf<Row>(result);
  const page = rows.slice(0, limit);
  const items = page.map((row) => ({
    id: String(row.id),
    title: cleanTitle(row.title) || DEFAULT_TITLE,
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  }));
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null };
}

/** State of the card behind a confirmation token, so stale cards are disabled when a chat is reopened. */
export function confirmationStatus(
  row: { state?: unknown; expires_at?: unknown; error_message?: unknown } | null | undefined,
  now = Date.now()
): CardStatus {
  if (!row) return 'expired';
  const state = String(row.state ?? '');
  if (state === 'succeeded') return 'used';
  if (state === 'failed') return /superseded/i.test(String(row.error_message ?? '')) ? 'cancelled' : 'failed';
  if (state === 'executing') return 'used';
  if (state === 'pending') return num(row.expires_at) > now ? 'active' : 'expired';
  return 'expired';
}

function tokenId(token: unknown): string | null {
  return typeof token === 'string' && token ? token.split('.')[0] || null : null;
}

function parseUi(toolCallJson: unknown): { ui: Array<Record<string, unknown>> | null; raw: Record<string, unknown> | null } {
  if (typeof toolCallJson !== 'string' || !toolCallJson) return { ui: null, raw: null };
  try {
    const parsed = JSON.parse(toolCallJson) as Record<string, unknown>;
    return { ui: Array.isArray(parsed.ui) ? (parsed.ui as Array<Record<string, unknown>>) : null, raw: parsed };
  } catch {
    return { ui: null, raw: null };
  }
}

export interface HistoryMessage {
  id: string;
  role: string;
  text: string;
  createdAt: number;
  ui?: Array<Record<string, unknown>>;
}

export async function getConversationMessages(
  db: HistoryDb,
  email: string,
  id: string,
  options: { before?: number | null; limit?: number } = {}
): Promise<{ title: string; messages: HistoryMessage[]; hasMore: boolean; sessionActive: boolean } | null> {
  const conversation = await db
    .prepare('SELECT id, title FROM ai_conversations WHERE id = ? AND staff_email = ?')
    .bind(id, email.toLowerCase())
    .first<Row>();
  if (!conversation) return null;

  const limit = Math.min(Math.max(options.limit ?? MESSAGE_PAGE_SIZE, 1), 100);
  const before = options.before && options.before > 0 ? options.before : null;
  const result = await db
    .prepare(
      `SELECT id, role, content, tool_call_json, created_at FROM ai_messages
       WHERE conversation_id = ?${before ? ' AND created_at < ?' : ''}
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(...(before ? [id, before, limit + 1] : [id, limit + 1]))
    .all<Row>();

  const rows = rowsOf<Row>(result);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();

  // Which confirmation tokens appear on these cards?
  const ids = new Set<string>();
  const parsed = page.map((row) => {
    const { ui } = parseUi(row.tool_call_json);
    for (const block of ui ?? []) {
      if (block.kind === 'confirm' || block.kind === 'delete_confirm') {
        const tid = tokenId(block.token);
        if (tid) ids.add(tid);
      }
    }
    return ui;
  });

  const statusById = new Map<string, CardStatus>();
  if (ids.size > 0) {
    const list = [...ids];
    const confirmations = await db
      .prepare(
        `SELECT id, state, expires_at, error_message FROM ai_confirmations
         WHERE staff_email = ? AND id IN (${list.map(() => '?').join(',')})`
      )
      .bind(email.toLowerCase(), ...list)
      .all<Row>();
    const found = new Map(rowsOf<Row>(confirmations).map((row) => [String(row.id), row]));
    for (const tid of list) statusById.set(tid, confirmationStatus(found.get(tid)));
  }

  const messages: HistoryMessage[] = page.map((row, index) => {
    const ui = row.role === 'assistant' ? parsed[index] : null;
    return {
      id: String(row.id),
      role: String(row.role),
      text: String(row.content ?? ''),
      createdAt: num(row.created_at),
      ui: ui
        ? ui.map((block) =>
            block.kind === 'confirm' || block.kind === 'delete_confirm'
              ? { ...block, status: statusById.get(tokenId(block.token) ?? '') ?? 'expired' }
              : block
          )
        : undefined,
    };
  });

  const session = await db
    .prepare('SELECT expires_at FROM ai_agent_sessions WHERE conversation_id = ? AND staff_email = ?')
    .bind(id, email.toLowerCase())
    .first<Row>()
    .catch(() => null);

  return {
    title: cleanTitle(conversation.title) || DEFAULT_TITLE,
    messages,
    hasMore,
    sessionActive: Boolean(session && num(session.expires_at) > Date.now()),
  };
}

export async function renameConversation(db: HistoryDb, email: string, id: string, title: unknown): Promise<string | null> {
  const next = cleanTitle(title);
  if (!next) return null;
  if (!(await owns(db, email, id))) return null;
  await db
    .prepare('UPDATE ai_conversations SET title = ? WHERE id = ? AND staff_email = ?')
    .bind(next, id, email.toLowerCase())
    .run();
  return next;
}

export interface DeleteOptions {
  /** Removes an unconsumed staged image. Missing files are fine. */
  deleteStaged?: (uploadId: string) => Promise<void>;
}

const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/**
 * Deletes ONE conversation owned by `email`. Returns false when it does not exist or belongs to
 * someone else (so the caller answers 404 in both cases).
 */
export async function deleteConversation(
  db: HistoryDb,
  email: string,
  id: string,
  options: DeleteOptions = {}
): Promise<boolean> {
  const staff = email.toLowerCase();
  if (!(await owns(db, staff, id))) return false;

  // 1. Collect what belongs to this chat only: tokens on its cards / session, staged uploads.
  const messages = rowsOf<Row>(
    await db.prepare('SELECT tool_call_json FROM ai_messages WHERE conversation_id = ?').bind(id).all<Row>()
  );
  const tokenIds = new Set<string>();
  for (const message of messages) {
    for (const block of parseUi(message.tool_call_json).ui ?? []) {
      if (block.kind === 'confirm' || block.kind === 'delete_confirm') {
        const tid = tokenId(block.token);
        if (tid) tokenIds.add(tid);
      }
    }
  }

  const uploads = new Set<string>();
  const session = await db
    .prepare('SELECT state_json FROM ai_agent_sessions WHERE conversation_id = ? AND staff_email = ?')
    .bind(id, staff)
    .first<Row>()
    .catch(() => null);
  if (session && typeof session.state_json === 'string') {
    try {
      const state = JSON.parse(session.state_json) as { pendingToken?: unknown; slots?: Record<string, unknown> };
      const pending = tokenId(state.pendingToken);
      if (pending) tokenIds.add(pending);
      const slots = state.slots ?? {};
      if (typeof slots.thumbnailUploadId === 'string') uploads.add(slots.thumbnailUploadId);
      if (Array.isArray(slots.pages)) for (const page of slots.pages) if (typeof page === 'string') uploads.add(page);
    } catch {
      /* unreadable state: nothing to collect */
    }
  }
  const extractions = rowsOf<Row>(
    await db
      .prepare('SELECT pages_json FROM ai_exam_extractions WHERE conversation_id = ? AND staff_email = ?')
      .bind(id, staff)
      .all<Row>()
      .catch(() => [] as Row[])
  );
  for (const extraction of extractions) {
    try {
      const pages = JSON.parse(String(extraction.pages_json ?? '[]')) as unknown;
      if (Array.isArray(pages)) for (const page of pages) if (typeof page === 'string') uploads.add(page);
    } catch {
      /* ignore */
    }
  }

  // 2. Disable (never delete) pending confirmations of this chat: the audit trail keeps the rows.
  for (const tid of tokenIds) {
    await db
      .prepare(
        "UPDATE ai_confirmations SET state = 'failed', error_message = 'superseded: conversation deleted' WHERE id = ? AND staff_email = ? AND state = 'pending'"
      )
      .bind(tid, staff)
      .run();
  }

  // 3. Unconsumed staged images (best effort, valid ids only).
  if (options.deleteStaged) {
    for (const uploadId of uploads) {
      if (!UPLOAD_ID.test(uploadId)) continue;
      await options.deleteStaged(uploadId).catch(() => undefined);
    }
  }

  // 4. Chat data. ai_messages and ai_agent_sessions go with the conversation (FK cascade);
  //    extraction windows go with their extraction. ai_action_logs / audit_logs are not touched.
  await db.prepare('DELETE FROM ai_exam_extractions WHERE conversation_id = ? AND staff_email = ?').bind(id, staff).run().catch(() => undefined);
  await db.prepare('DELETE FROM ai_agent_sessions WHERE conversation_id = ? AND staff_email = ?').bind(id, staff).run().catch(() => undefined);
  await db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').bind(id).run();
  await db.prepare('DELETE FROM ai_conversations WHERE id = ? AND staff_email = ?').bind(id, staff).run();

  // Accountability: only the fact of the deletion (no message content).
  await recordAuditLog({
    userEmail: staff,
    action: 'ai.conversation_deleted',
    resource: 'ai_conversation',
    resourceId: id,
    details: { messages: messages.length },
  });
  return true;
}

/** Deletes every conversation of `email`, in batches. Returns how many were removed. */
export async function deleteAllConversations(db: HistoryDb, email: string, options: DeleteOptions = {}): Promise<number> {
  let deleted = 0;
  for (let round = 0; round < 50; round += 1) {
    const batch = rowsOf<Row>(
      await db
        .prepare('SELECT id FROM ai_conversations WHERE staff_email = ? ORDER BY updated_at DESC LIMIT ?')
        .bind(email.toLowerCase(), DELETE_ALL_BATCH)
        .all<Row>()
    );
    if (batch.length === 0) break;
    for (const row of batch) {
      if (await deleteConversation(db, email, String(row.id), options)) deleted += 1;
    }
    if (batch.length < DELETE_ALL_BATCH) break;
  }
  return deleted;
}
