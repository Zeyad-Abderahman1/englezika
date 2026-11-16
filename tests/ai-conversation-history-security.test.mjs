import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';

process.env.AI_ASSISTANT_ENABLED = 'true';
process.env.AI_CONFIRMATION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';

const history = await import('../app/lib/ai/conversation-history.ts');
const { runAgentTurn } = await import('../app/lib/ai/agent/agent.ts');
const { MemorySessionStore } = await import('../app/lib/ai/agent/session.ts');
const { createConfirmationRequest, verifyAndExecuteConfirmation } = await import('../app/lib/ai/confirmation.server.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SECRET = process.env.AI_CONFIRMATION_SECRET;
const ALICE = 'alice@englizeka.com';
const BOB = 'bob@englizeka.com';
const uploadA = '11111111-1111-4111-8111-111111111111.png';
const uploadB = '22222222-2222-4222-8222-222222222222.png';

// ── In-memory database that understands exactly the statements the history service issues ──

class FakeHistoryDb {
  constructor() {
    this.conversations = new Map();
    this.messages = [];
    this.sessions = new Map();
    this.confirmations = new Map();
    this.extractions = [];
    this.actionLogs = [{ id: 'log-1', action_type: 'create_course' }];
    this.auditLogs = [{ id: 'aud-1', action: 'course.created' }];
    this.deletedStatements = [];
  }

  addConversation(id, email, title, updatedAt) {
    this.conversations.set(id, { id, staff_email: email, title, created_at: updatedAt - 10, updated_at: updatedAt });
  }

  addMessage(conversationId, role, content, createdAt, ui) {
    this.messages.push({
      id: `m${this.messages.length}`,
      conversation_id: conversationId,
      role,
      content,
      tool_call_json: ui ? JSON.stringify({ ui }) : null,
      created_at: createdAt,
    });
  }

  prepare(rawSql) {
    const db = this;
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    return {
      bind: (...v) => ({
        sql,
        values: v,
        first: async () => (await db.run(sql, v)).rows[0] ?? null,
        all: async () => ({ results: (await db.run(sql, v)).rows }),
        run: async () => {
          await db.run(sql, v);
          return { success: true };
        },
      }),
    };
  }

  async run(sql, v) {
    const own = (id, email) => {
      const c = this.conversations.get(id);
      return c && c.staff_email === email ? c : null;
    };

    if (sql.startsWith('SELECT id FROM ai_conversations WHERE id = ? AND staff_email = ?')) {
      const c = own(v[0], v[1]);
      return { rows: c ? [{ id: c.id }] : [] };
    }
    if (sql.startsWith('SELECT id, title FROM ai_conversations WHERE id = ? AND staff_email = ?')) {
      const c = own(v[0], v[1]);
      return { rows: c ? [{ id: c.id, title: c.title }] : [] };
    }
    if (sql.startsWith('SELECT c.id, c.title, c.created_at, c.updated_at FROM ai_conversations c')) {
      let i = 0;
      const email = v[i++];
      let cursor = null;
      if (sql.includes('c.updated_at < ?')) {
        cursor = { updatedAt: v[i], id: v[i + 2] };
        i += 3;
      }
      let q = null;
      if (sql.includes('ILIKE')) {
        q = String(v[i]).replace(/%/g, '').toLowerCase();
        i += 2;
      }
      const limit = v[i];
      let rows = [...this.conversations.values()].filter((c) => c.staff_email === email);
      if (cursor) rows = rows.filter((c) => c.updated_at < cursor.updatedAt || (c.updated_at === cursor.updatedAt && c.id < cursor.id));
      if (q) {
        rows = rows.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            this.messages.some((m) => m.conversation_id === c.id && m.content.toLowerCase().includes(q))
        );
      }
      rows.sort((a, b) => b.updated_at - a.updated_at || (a.id < b.id ? 1 : -1));
      return { rows: rows.slice(0, limit) };
    }
    if (sql.startsWith('SELECT id, role, content, tool_call_json, created_at FROM ai_messages')) {
      const id = v[0];
      const before = sql.includes('created_at < ?') ? v[1] : null;
      const limit = v[v.length - 1];
      let rows = this.messages.filter((m) => m.conversation_id === id);
      if (before) rows = rows.filter((m) => m.created_at < before);
      rows.sort((a, b) => b.created_at - a.created_at);
      return { rows: rows.slice(0, limit) };
    }
    if (sql.startsWith('SELECT tool_call_json FROM ai_messages WHERE conversation_id = ?')) {
      return { rows: this.messages.filter((m) => m.conversation_id === v[0]).map((m) => ({ tool_call_json: m.tool_call_json })) };
    }
    if (sql.startsWith('SELECT id, state, expires_at, error_message FROM ai_confirmations')) {
      const email = v[0];
      const ids = v.slice(1);
      return { rows: ids.map((id) => this.confirmations.get(id)).filter((c) => c && c.staff_email === email) };
    }
    if (sql.startsWith('SELECT expires_at FROM ai_agent_sessions')) {
      const s = this.sessions.get(v[0]);
      return { rows: s && s.staff_email === v[1] ? [{ expires_at: s.expires_at }] : [] };
    }
    if (sql.startsWith('SELECT state_json FROM ai_agent_sessions')) {
      const s = this.sessions.get(v[0]);
      return { rows: s && s.staff_email === v[1] ? [{ state_json: s.state_json }] : [] };
    }
    if (sql.startsWith('SELECT pages_json FROM ai_exam_extractions')) {
      return { rows: this.extractions.filter((e) => e.conversation_id === v[0] && e.staff_email === v[1]).map((e) => ({ pages_json: e.pages_json })) };
    }
    if (sql.startsWith('SELECT id FROM ai_conversations WHERE staff_email = ?')) {
      const rows = [...this.conversations.values()].filter((c) => c.staff_email === v[0]).slice(0, v[1]);
      return { rows: rows.map((c) => ({ id: c.id })) };
    }
    if (sql.startsWith('UPDATE ai_conversations SET title = ? WHERE id = ? AND staff_email = ?')) {
      const c = own(v[1], v[2]);
      if (c) c.title = v[0];
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE ai_confirmations SET state = 'failed'")) {
      const c = this.confirmations.get(v[0]);
      if (c && c.staff_email === v[1] && c.state === 'pending') {
        c.state = 'failed';
        c.error_message = 'superseded: conversation deleted';
      }
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM ai_exam_extractions')) {
      this.deletedStatements.push('ai_exam_extractions');
      this.extractions = this.extractions.filter((e) => !(e.conversation_id === v[0] && e.staff_email === v[1]));
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM ai_agent_sessions')) {
      this.deletedStatements.push('ai_agent_sessions');
      this.sessions.delete(v[0]);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM ai_messages')) {
      this.deletedStatements.push('ai_messages');
      this.messages = this.messages.filter((m) => m.conversation_id !== v[0]);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM ai_conversations')) {
      this.deletedStatements.push('ai_conversations');
      const c = own(v[0], v[1]);
      if (c) this.conversations.delete(v[0]);
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      this.auditLogs.push({ id: v[0], action: v[2], resource: v[3], resourceId: v[4], details: v[5] });
      return { rows: [] };
    }
    // Any other statement touching these tables would be a bug in the service.
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

async function withPlatform(db, fn) {
  globalThis.__ENGLIZEKA_ENV__ = { DB: db, VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters' };
  try {
    return await fn();
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
}

function seed() {
  const db = new FakeHistoryDb();
  db.addConversation('a1', ALICE, 'Grammar course chat', 5000);
  db.addConversation('a2', ALICE, 'محادثة جديدة', 4000);
  db.addConversation('b1', BOB, 'Bob private chat', 6000);
  db.addMessage('a1', 'user', 'add a course called Grammar', 4990);
  db.addMessage('a1', 'assistant', 'which class?', 4995, [{ kind: 'chips', slot: 'grade', options: [] }]);
  db.addMessage('a2', 'user', 'secret keyword zebra', 3990);
  db.addMessage('b1', 'user', 'bob only message', 5990);
  return db;
}

// ── Listing, pagination, search ──────────────────────────────────────────────────

describe('list / search / pagination', () => {
  test('a user only sees their own chats, newest first', async () => {
    const db = seed();
    const alice = await history.listConversations(db, ALICE);
    assert.deepEqual(alice.items.map((c) => c.id), ['a1', 'a2']);
    const bob = await history.listConversations(db, BOB);
    assert.deepEqual(bob.items.map((c) => c.id), ['b1']);
  });

  test('cursor pagination walks every chat exactly once', async () => {
    const db = new FakeHistoryDb();
    for (let i = 0; i < 45; i += 1) db.addConversation(`c${String(i).padStart(2, '0')}`, ALICE, `chat ${i}`, 1000 + (i % 7)); // ties on updated_at
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const page = await history.listConversations(db, ALICE, { cursor, limit: 20 });
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    assert.equal(pages, 3);
    assert.equal(seen.length, 45);
    assert.equal(new Set(seen).size, 45, 'no duplicates or gaps even with equal timestamps');
    assert.equal(cursor, null);
  });

  test('search matches titles and message text, still only the owner\'s chats', async () => {
    const db = seed();
    const byTitle = await history.listConversations(db, ALICE, { query: 'grammar' });
    assert.deepEqual(byTitle.items.map((c) => c.id), ['a1']);
    const byMessage = await history.listConversations(db, ALICE, { query: 'zebra' });
    assert.deepEqual(byMessage.items.map((c) => c.id), ['a2']);
    const crossUser = await history.listConversations(db, ALICE, { query: 'bob only' });
    assert.deepEqual(crossUser.items, []);
  });

  test('cursors are validated', () => {
    assert.equal(history.decodeCursor("1;DROP TABLE x_a1"), null);
    assert.deepEqual(history.decodeCursor('123_abc-1'), { updatedAt: 123, id: 'abc-1' });
    assert.equal(history.decodeCursor(null), null);
  });

  test('auto title is about 40 characters, never empty, and uses no model', () => {
    assert.equal(history.autoTitle('   '), 'محادثة جديدة');
    const title = history.autoTitle('عايز اضيف كورس جديد اسمه Grammar Basics للصف الاول الثانوي بسعر 500');
    assert.ok(title.length <= 40);
    assert.ok(title.endsWith('…'));
    assert.equal(history.autoTitle('short'), 'short');
  });
});

// ── Opening a chat: ownership, lazy messages, card state ─────────────────────────

describe('opening a chat', () => {
  test("another user's chat id behaves exactly like a missing one", async () => {
    const db = seed();
    assert.equal(await history.getConversationMessages(db, BOB, 'a1'), null);
    assert.equal(await history.getConversationMessages(db, ALICE, 'nope'), null);
    assert.equal(await history.getConversationMessages(db, ALICE, 'b1'), null);
  });

  test('messages load lazily: latest page first, older pages by cursor', async () => {
    const db = new FakeHistoryDb();
    db.addConversation('big', ALICE, 'big', 9999);
    for (let i = 1; i <= 120; i += 1) db.addMessage('big', i % 2 ? 'user' : 'assistant', `msg ${i}`, i * 10);
    const first = await history.getConversationMessages(db, ALICE, 'big');
    assert.equal(first.messages.length, 50);
    assert.equal(first.messages.at(-1).text, 'msg 120');
    assert.equal(first.messages[0].text, 'msg 71');
    assert.equal(first.hasMore, true);
    const second = await history.getConversationMessages(db, ALICE, 'big', { before: first.messages[0].createdAt });
    assert.equal(second.messages.length, 50);
    assert.equal(second.messages.at(-1).text, 'msg 70');
    const third = await history.getConversationMessages(db, ALICE, 'big', { before: second.messages[0].createdAt });
    assert.equal(third.messages.length, 20);
    assert.equal(third.hasMore, false);
  });

  test('old confirmation cards are marked used / expired / cancelled and never active', async () => {
    const db = new FakeHistoryDb();
    const now = Date.now();
    db.addConversation('c', ALICE, 'cards', now);
    const confirm = (token) => ({ kind: 'confirm', token, title: 't', rows: [], editable: [] });
    db.addMessage('c', 'assistant', 'x', 1, [confirm('ok.sig'), confirm('used.sig'), confirm('late.sig'), confirm('cut.sig'), confirm('gone.sig'), { kind: 'delete_confirm', token: 'del.sig', itemKind: 'كورس', name: 'n', rows: [], expectText: 'n', irreversible: true, expiresInSec: 300 }, { kind: 'chips', slot: 's', options: [] }]);
    const row = (id, state, expires, error = null) => db.confirmations.set(id, { id, staff_email: ALICE, state, expires_at: expires, error_message: error });
    row('ok', 'pending', now + 60_000);
    row('used', 'succeeded', now + 60_000);
    row('late', 'pending', now - 1);
    row('cut', 'failed', now + 60_000, 'superseded by edit or cancel');
    row('del', 'failed', now + 60_000, 'boom');
    const { messages } = await history.getConversationMessages(db, ALICE, 'c');
    const status = Object.fromEntries(messages[0].ui.filter((b) => b.token).map((b) => [b.token, b.status]));
    assert.deepEqual(status, { 'ok.sig': 'active', 'used.sig': 'used', 'late.sig': 'expired', 'cut.sig': 'cancelled', 'gone.sig': 'expired', 'del.sig': 'failed' });
    assert.equal(messages[0].ui.at(-1).status, undefined, 'non-confirmation blocks are untouched');
  });

  test("a token of another user is never reported as active", async () => {
    const db = new FakeHistoryDb();
    db.addConversation('c', ALICE, 'cards', 1);
    db.addMessage('c', 'assistant', 'x', 1, [{ kind: 'confirm', token: 'bobtok.sig', title: 't', rows: [], editable: [] }]);
    db.confirmations.set('bobtok', { id: 'bobtok', staff_email: BOB, state: 'pending', expires_at: Date.now() + 60_000 });
    const { messages } = await history.getConversationMessages(db, ALICE, 'c');
    assert.equal(messages[0].ui[0].status, 'expired');
  });

  test('sessionActive reflects a live flow session of that chat only', async () => {
    const db = seed();
    db.sessions.set('a1', { staff_email: ALICE, state_json: '{}', expires_at: Date.now() + 60_000 });
    db.sessions.set('a2', { staff_email: ALICE, state_json: '{}', expires_at: Date.now() - 1 });
    assert.equal((await history.getConversationMessages(db, ALICE, 'a1')).sessionActive, true);
    assert.equal((await history.getConversationMessages(db, ALICE, 'a2')).sessionActive, false);
  });
});

// ── Rename ───────────────────────────────────────────────────────────────────────

describe('rename', () => {
  test('owner renames; title is trimmed and capped', async () => {
    const db = seed();
    assert.equal(await history.renameConversation(db, ALICE, 'a1', '  New   name  '), 'New name');
    assert.equal(db.conversations.get('a1').title, 'New name');
    const long = await history.renameConversation(db, ALICE, 'a1', 'x'.repeat(300));
    assert.equal(long.length, 80);
  });

  test('empty title and other users are rejected without changing anything', async () => {
    const db = seed();
    assert.equal(await history.renameConversation(db, ALICE, 'a1', '   '), null);
    assert.equal(await history.renameConversation(db, BOB, 'a1', 'hijack'), null);
    assert.equal(db.conversations.get('a1').title, 'Grammar course chat');
  });
});

// ── Delete one / all ─────────────────────────────────────────────────────────────

function seedForDelete() {
  const db = seed();
  const now = Date.now();
  db.addMessage('a1', 'assistant', 'card', 4996, [
    { kind: 'confirm', token: 'pend.sig', title: 't', rows: [], editable: [] },
    { kind: 'confirm', token: 'done.sig', title: 't', rows: [], editable: [] },
  ]);
  db.confirmations.set('pend', { id: 'pend', staff_email: ALICE, state: 'pending', expires_at: now + 60_000, error_message: null });
  db.confirmations.set('done', { id: 'done', staff_email: ALICE, state: 'succeeded', expires_at: now + 60_000, error_message: null });
  db.sessions.set('a1', {
    staff_email: ALICE,
    state_json: JSON.stringify({ pendingToken: 'pend.sig', slots: { thumbnailUploadId: uploadA, pages: [uploadB, '../../etc/passwd'] } }),
    expires_at: now + 60_000,
  });
  db.extractions.push({ id: 'x1', conversation_id: 'a1', staff_email: ALICE, pages_json: JSON.stringify([uploadB]) });
  db.extractions.push({ id: 'x2', conversation_id: 'a2', staff_email: ALICE, pages_json: '[]' });
  db.sessions.set('b1', { staff_email: BOB, state_json: '{}', expires_at: now + 60_000 });
  return db;
}

describe('delete', () => {
  test("another user's chat cannot be deleted (returns false, nothing changes)", async () => {
    const db = seedForDelete();
    const removed = await withPlatform(db, () => history.deleteConversation(db, BOB, 'a1'));
    assert.equal(removed, false);
    assert.ok(db.conversations.has('a1'));
    assert.equal(db.messages.filter((m) => m.conversation_id === 'a1').length, 3);
    assert.deepEqual(db.deletedStatements, []);
  });

  test('deleting one chat removes its data, its session, its extractions and staged uploads only', async () => {
    const db = seedForDelete();
    const staged = [];
    const removed = await withPlatform(db, () => history.deleteConversation(db, ALICE, 'a1', { deleteStaged: async (id) => void staged.push(id) }));
    assert.equal(removed, true);
    assert.equal(db.conversations.has('a1'), false);
    assert.equal(db.messages.some((m) => m.conversation_id === 'a1'), false);
    assert.equal(db.sessions.has('a1'), false);
    assert.equal(db.extractions.some((e) => e.conversation_id === 'a1'), false);
    assert.deepEqual([...staged].sort(), [uploadA, uploadB].sort(), 'only valid staged ids of THIS chat are removed');
    // Everything else is untouched.
    assert.ok(db.conversations.has('a2') && db.conversations.has('b1'));
    assert.ok(db.sessions.has('b1'));
    assert.equal(db.extractions.some((e) => e.id === 'x2'), true);
    assert.equal(db.messages.some((m) => m.conversation_id === 'b1'), true);
  });

  test('audit and action logs survive; only a content-free deletion record is added', async () => {
    const db = seedForDelete();
    await withPlatform(db, () => history.deleteConversation(db, ALICE, 'a1'));
    assert.ok(db.actionLogs.some((row) => row.id === 'log-1'), 'ai_action_logs untouched');
    assert.ok(db.auditLogs.some((row) => row.id === 'aud-1'), 'audit_logs untouched');
    const added = db.auditLogs.filter((row) => row.action === 'ai.conversation_deleted');
    assert.equal(added.length, 1);
    assert.ok(!/Grammar|zebra|secret/.test(JSON.stringify(added[0])), 'no message content in the audit row');
    // The service never issues DELETE against audit/confirmation tables.
    assert.ok(!db.deletedStatements.some((t) => /audit|action_logs|confirmations/.test(t)));
  });

  test('pending confirmations of the deleted chat are disabled, executed ones kept as they are', async () => {
    const db = seedForDelete();
    await withPlatform(db, () => history.deleteConversation(db, ALICE, 'a1'));
    assert.equal(db.confirmations.get('pend').state, 'failed');
    assert.match(db.confirmations.get('pend').error_message, /conversation deleted/);
    assert.equal(db.confirmations.get('done').state, 'succeeded');
    assert.equal(db.confirmations.size, 2, 'rows are kept for accountability');
  });

  test('a token of a deleted chat can no longer be executed', async () => {
    // Real confirmation engine on a tiny in-memory store.
    const rows = new Map();
    const engineDb = {
      async withTransaction(cb) {
        return cb(this);
      },
      prepare(sql) {
        return {
          bind: (...a) => ({
            first: async () => (sql.includes('FROM ai_confirmations WHERE id = ?') && rows.get(a[0]) ? { ...rows.get(a[0]) } : null),
            run: async () => {
              if (sql.includes('INSERT INTO ai_confirmations')) {
                const [id, token_hash, staff_email, action_type, action_payload, created_at, expires_at] = a;
                rows.set(id, { id, token_hash, staff_email, action_type, action_payload, state: 'pending', result_json: null, created_at, expires_at, executed_at: null, execution_id: null, error_message: null });
              } else if (sql.includes("state = 'executing'")) {
                const row = rows.get(a[2]);
                if (row?.state === 'pending') Object.assign(row, { state: 'executing' });
                else return { success: true, meta: { changes: 0 } };
              } else if (sql.includes("state = 'failed'") && sql.includes('conversation deleted') === false && a.length >= 2) {
                Object.assign(rows.get(a[a.length - 1]) ?? {}, { state: 'failed', error_message: a[0] });
              }
              return { success: true, meta: { changes: 1 } };
            },
          }),
        };
      },
    };
    const actor = { email: ALICE, role: 'teacher', permissions: [] };
    const created = await createConfirmationRequest({ actor, actionType: 'update_course_price', actionPayload: { courseId: 'c', price: 5 }, secret: SECRET, db: engineDb });
    // The history service disables it:
    rows.get(created.tokenId).state = 'failed';
    rows.get(created.tokenId).error_message = 'superseded: conversation deleted';
    let executed = false;
    await assert.rejects(verifyAndExecuteConfirmation({ token: created.token, actor, secret: SECRET, db: engineDb, executor: async () => { executed = true; return {}; } }));
    assert.equal(executed, false);
  });

  test('delete all removes every chat of this user and nobody else\'s', async () => {
    const db = seedForDelete();
    db.addConversation('a3', ALICE, 'third', 3000);
    const count = await withPlatform(db, () => history.deleteAllConversations(db, ALICE));
    assert.equal(count, 3);
    assert.deepEqual([...db.conversations.keys()], ['b1']);
    assert.ok(db.messages.every((m) => m.conversation_id === 'b1'));
    assert.ok(db.sessions.has('b1'));
    assert.ok(db.auditLogs.some((row) => row.id === 'aud-1') && db.actionLogs.length === 1);
  });
});

// ── Session isolation between chats (the real agent) ───────────────────────────

function makeAgentDeps() {
  return {
    store: new MemorySessionStore(),
    provider: null,
    readTools: {
      listGrades: async () => ['أولى ثانوي'],
      listCourses: async () => [{ id: 'c1', title: 'Grammar Basics', grade: 'أولى ثانوي', price: 100, status: 'published' }],
      listLectureTitles: async () => [],
      stats: async () => ({ total: 1 }),
    },
    createConfirmation: async () => ({ token: 't.sig' }),
    supersedeConfirmation: async () => {},
    loadConfirmation: async () => null,
    stagedImageExists: async () => false,
    examExtraction: { create: async () => ({ id: 'x', windowCount: 1 }), summary: async () => null },
    deleteTools: { find: async () => [], impact: async () => null },
    persist: { ensureConversation: async () => {}, saveMessage: async () => {} },
  };
}

describe('session isolation', () => {
  const teacher = { email: ALICE, role: 'teacher', permissions: [] };

  test('a new chat starts completely clean and the old chat keeps its own slots', async () => {
    const deps = makeAgentDeps();
    const a = await runAgentTurn({ actor: teacher, message: 'عايز اضيف كورس اسمه Algebra' }, deps);
    assert.equal(a.flow, 'create_course');
    const sessionA = await deps.store.load(a.conversationId, ALICE);
    assert.equal(sessionA.slots.title, 'Algebra');

    // New chat: no conversation id -> a different, empty session.
    const b = await runAgentTurn({ actor: teacher, message: 'احذف كورس' }, deps);
    assert.notEqual(b.conversationId, a.conversationId);
    assert.equal(b.flow, 'delete_item');
    const sessionB = await deps.store.load(b.conversationId, ALICE);
    assert.equal(sessionB.slots.title, undefined, 'no create-course slot leaked into the new chat');
    assert.equal(sessionB.pendingToken, null);

    // Going back to chat A: its flow and slots are intact, untouched by B.
    const again = await deps.store.load(a.conversationId, ALICE);
    assert.equal(again.flow, 'create_course');
    assert.equal(again.slots.title, 'Algebra');
  });

  test("another user cannot resume someone else's session by id", async () => {
    const deps = makeAgentDeps();
    const a = await runAgentTurn({ actor: teacher, message: 'عايز اضيف كورس اسمه Algebra' }, deps);
    const other = { email: BOB, role: 'teacher', permissions: [] };
    const attempt = await runAgentTurn({ actor: other, message: 'تمام', conversationId: a.conversationId }, deps);
    const sessionOfBob = await deps.store.load(a.conversationId, BOB);
    assert.equal(sessionOfBob?.slots?.title, undefined);
    assert.notEqual(attempt.flow, 'create_course');
  });
});

// ── Wiring ───────────────────────────────────────────────────────────────────────

describe('routes and storage wiring', () => {
  test('every history route is staff-scoped, same-origin for writes, and rate limited', () => {
    const list = read('../app/api/admin/ai/conversations/route.ts');
    const one = read('../app/api/admin/ai/conversations/[id]/route.ts');
    for (const source of [list, one]) {
      assert.match(source, /apiStaff\(request, 'manage_courses'\)/);
      assert.match(source, /checkRateLimit\(/);
    }
    assert.equal((list.match(/requireSameOrigin/g) ?? []).length >= 2, true, 'delete-all checks the origin');
    assert.equal((one.match(/requireSameOrigin\(request\)/g) ?? []).length, 2, 'PATCH and DELETE check the origin');
    assert.match(list, /all !== true|body\?\.all !== true/);
    assert.match(one, /jsonError\('المحادثة غير موجودة', 404\)/);
  });

  test('the history service never deletes from audit or confirmation tables and never logs content', () => {
    const source = read('../app/lib/ai/conversation-history.ts');
    assert.ok(!/DELETE FROM (audit_logs|ai_action_logs|ai_confirmations)/i.test(source));
    assert.ok(!/console\./.test(source));
  });

  test('the new-conversation title is filled from the first message (no model call)', () => {
    const deps = read('../app/lib/ai/agent/server-deps.ts');
    assert.match(deps, /autoTitle\(content\)/);
  });
});
