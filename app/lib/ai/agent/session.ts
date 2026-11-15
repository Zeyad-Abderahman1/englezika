import { getDatabase } from '../../platform';

/**
 * Per-conversation agent state: which flow is running, the slots collected so far
 * and the confirmation currently shown. Persisted so a page refresh (or a server
 * restart) does not lose a half-finished "add course" conversation. Sessions are
 * small and expire automatically.
 */

export type FlowId = 'create_course' | 'add_lecture' | 'update_course' | 'add_homework';

export interface LectureSlot {
  title: string;
  url: string;
}

export interface AgentSession {
  flow: FlowId | null;
  /** Slots collected so far. Always validated server-side before being used. */
  slots: Record<string, unknown>;
  /** The slot the assistant is currently asking about. */
  awaiting: string | null;
  /** Token of the confirmation card currently shown to the teacher (if any). */
  pendingToken: string | null;
  updatedAt: number;
}

export const SESSION_TTL_MS = 30 * 60 * 1000;

export function emptySession(): AgentSession {
  return { flow: null, slots: {}, awaiting: null, pendingToken: null, updatedAt: Date.now() };
}

export interface AgentSessionStore {
  load(conversationId: string, staffEmail: string): Promise<AgentSession | null>;
  save(conversationId: string, staffEmail: string, session: AgentSession): Promise<void>;
  clear(conversationId: string, staffEmail: string): Promise<void>;
}

/** In-memory store used by unit tests and as a safe fallback. */
export class MemorySessionStore implements AgentSessionStore {
  private readonly sessions = new Map<string, AgentSession>();

  private key(conversationId: string, staffEmail: string) {
    return `${staffEmail.toLowerCase()}::${conversationId}`;
  }

  async load(conversationId: string, staffEmail: string) {
    const session = this.sessions.get(this.key(conversationId, staffEmail));
    if (!session) return null;
    if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
      this.sessions.delete(this.key(conversationId, staffEmail));
      return null;
    }
    return structuredClone(session);
  }

  async save(conversationId: string, staffEmail: string, session: AgentSession) {
    this.sessions.set(this.key(conversationId, staffEmail), structuredClone({ ...session, updatedAt: Date.now() }));
  }

  async clear(conversationId: string, staffEmail: string) {
    this.sessions.delete(this.key(conversationId, staffEmail));
  }
}

type SqlDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T = unknown>() => Promise<T | null>;
      run: () => Promise<unknown>;
    };
  };
};

const MISSING_TABLE_MESSAGE =
  'جدول جلسات المساعد غير موجود في قاعدة البيانات. شغّل ترحيل قاعدة البيانات (012_ai_agent_sessions.sql) ثم أعد المحاولة.';

function translateStoreError(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (/ai_agent_sessions/.test(text) && /(does not exist|no such table)/i.test(text)) {
    return new Error(MISSING_TABLE_MESSAGE);
  }
  return error instanceof Error ? error : new Error(text);
}

/** PostgreSQL-backed store (table created by migration 012_ai_agent_sessions.sql). */
export class DatabaseSessionStore implements AgentSessionStore {
  private readonly db: SqlDb;

  constructor(db?: SqlDb) {
    this.db = db ?? (getDatabase() as unknown as SqlDb);
  }

  async load(conversationId: string, staffEmail: string): Promise<AgentSession | null> {
    let row: { state_json: string; expires_at: number | string } | null;
    try {
      row = await this.db
        .prepare(
          'SELECT state_json, expires_at FROM ai_agent_sessions WHERE conversation_id = ? AND staff_email = ?'
        )
        .bind(conversationId, staffEmail.toLowerCase())
        .first<{ state_json: string; expires_at: number | string }>();
    } catch (error) {
      throw translateStoreError(error);
    }
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) {
      await this.clear(conversationId, staffEmail);
      return null;
    }
    try {
      const parsed = JSON.parse(row.state_json) as AgentSession;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.slots !== 'object') return null;
      return { ...emptySession(), ...parsed };
    } catch {
      return null;
    }
  }

  async save(conversationId: string, staffEmail: string, session: AgentSession): Promise<void> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO ai_agent_sessions (conversation_id, staff_email, state_json, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (conversation_id) DO UPDATE
           SET state_json = EXCLUDED.state_json,
               updated_at = EXCLUDED.updated_at,
               expires_at = EXCLUDED.expires_at`
      )
      .bind(
        conversationId,
        staffEmail.toLowerCase(),
        JSON.stringify({ ...session, updatedAt: now }),
        now,
        now + SESSION_TTL_MS
      )
      .run();

    // Opportunistic cleanup of expired sessions (cheap, indexed).
    if (Math.random() < 0.05) {
      await this.db
        .prepare('DELETE FROM ai_agent_sessions WHERE expires_at < ?')
        .bind(now)
        .run()
        .catch(() => undefined);
    }
  }

  async clear(conversationId: string, staffEmail: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM ai_agent_sessions WHERE conversation_id = ? AND staff_email = ?')
      .bind(conversationId, staffEmail.toLowerCase())
      .run();
  }
}
