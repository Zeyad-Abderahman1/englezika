'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, MessageSquarePlus, MoreVertical, Pencil, Search, Trash2, X } from 'lucide-react';
import './conversation-history.css';

export interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

interface PanelProps {
  activeId?: string;
  /** Bump to reload the list (a chat was created or got activity). */
  refreshKey: number;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** The open chat was deleted (one or all): the workspace opens a fresh chat. */
  onActiveDeleted: () => void;
  onClose?: () => void;
  disabled?: boolean;
}

type Group = { label: string; items: ConversationListItem[] };

const DAY = 24 * 60 * 60 * 1000;

export function groupConversations(items: ConversationListItem[], now = Date.now()): Group[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const buckets: Group[] = [
    { label: 'اليوم', items: [] },
    { label: 'أمس', items: [] },
    { label: 'آخر 7 أيام', items: [] },
    { label: 'أقدم', items: [] },
  ];
  for (const item of items) {
    if (item.updatedAt >= today) buckets[0].items.push(item);
    else if (item.updatedAt >= today - DAY) buckets[1].items.push(item);
    else if (item.updatedAt >= today - 7 * DAY) buckets[2].items.push(item);
    else buckets[3].items.push(item);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}

type Dialog = { type: 'one'; id: string; title: string } | { type: 'all' } | null;

export function ConversationHistoryPanel({ activeId, refreshKey, onSelect, onNew, onActiveDeleted, onClose, disabled }: PanelProps) {
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  /** Key (search + refresh) of the list that is currently shown; loading = not yet the wanted key. */
  const [loadedKey, setLoadedKey] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const wantedKey = `${debounced}|${refreshKey}`;
  const loading = loadedKey !== wantedKey;

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (debounced) params.set('q', debounced);
      const res = await fetch(`/api/admin/ai/conversations?${params.toString()}`);
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'تعذر تحميل المحادثات');
      }
      return payload as { items: ConversationListItem[]; nextCursor: string | null };
    },
    [debounced]
  );

  // First page for the current search / refresh key. State is only set after the request settles.
  useEffect(() => {
    const request = ++requestRef.current;
    fetchPage(null)
      .then((payload) => {
        if (request !== requestRef.current) return;
        setItems(payload.items);
        setNextCursor(typeof payload.nextCursor === 'string' ? payload.nextCursor : null);
        setError('');
        setLoadedKey(wantedKey);
      })
      .catch((caught) => {
        if (request !== requestRef.current) return;
        setError(caught instanceof Error ? caught.message : 'تعذر تحميل المحادثات');
        setLoadedKey(wantedKey);
      });
  }, [fetchPage, wantedKey]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const request = ++requestRef.current;
    setLoadingMore(true);
    try {
      const payload = await fetchPage(nextCursor);
      if (request !== requestRef.current) return;
      setItems((prev) => [...prev, ...payload.items]);
      setNextCursor(typeof payload.nextCursor === 'string' ? payload.nextCursor : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل المحادثات');
    } finally {
      setLoadingMore(false);
    }
  };

  const closeOnEscape = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setMenuId(null);
      setDialog(null);
    }
  }, []);

  const commitRename = async (id: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    const previous = items;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, title } : item)));
    try {
      const res = await fetch(`/api/admin/ai/conversations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('rename failed');
    } catch {
      setItems(previous);
      setError('تعذر تغيير الاسم.');
    }
  };

  const confirmDelete = async () => {
    if (!dialog || busy) return;
    setBusy(true);
    setError('');
    try {
      if (dialog.type === 'one') {
        const res = await fetch(`/api/admin/ai/conversations/${encodeURIComponent(dialog.id)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error('delete failed');
        setItems((prev) => prev.filter((item) => item.id !== dialog.id));
        if (dialog.id === activeId) onActiveDeleted();
      } else {
        const res = await fetch('/api/admin/ai/conversations', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
        if (!res.ok) throw new Error('delete all failed');
        setItems([]);
        setNextCursor(null);
        onActiveDeleted();
      }
      setDialog(null);
      setAcknowledged(false);
    } catch {
      setError('تعذر الحذف. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const groups = groupConversations(items);

  return (
    <aside className="ai-history" aria-label="سجل المحادثات" onKeyDown={closeOnEscape}>
      <div className="ai-history-top">
        <button type="button" className="ai-history-new" onClick={onNew} disabled={disabled}>
          <MessageSquarePlus size={18} aria-hidden="true" /> محادثة جديدة
        </button>
        {onClose && (
          <button type="button" className="ai-history-close" onClick={onClose} aria-label="إغلاق سجل المحادثات">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="ai-history-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث في المحادثات"
          aria-label="ابحث في المحادثات"
          maxLength={60}
        />
      </div>

      {error && (
        <p className="ai-history-error" role="alert">
          {error}
        </p>
      )}

      <div className="ai-history-list" role="navigation" aria-label="المحادثات السابقة">
        {loading ? (
          <div className="ai-history-skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((n) => (
              <span key={n} />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="ai-history-empty">{debounced ? 'مفيش محادثات مطابقة للبحث.' : 'لسه مفيش محادثات. ابدأ محادثة جديدة وهتظهر هنا.'}</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="ai-history-group">
              <h2>{group.label}</h2>
              <ul>
                {group.items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id} className={`ai-history-item${active ? ' is-active' : ''}`}>
                      {renamingId === item.id ? (
                        <form
                          className="ai-history-rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void commitRename(item.id);
                          }}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            maxLength={80}
                            aria-label="اسم المحادثة"
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') setRenamingId(null);
                            }}
                          />
                          <button type="submit" aria-label="حفظ الاسم">
                            <Check size={16} aria-hidden="true" />
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ai-history-open"
                            aria-current={active ? 'true' : undefined}
                            disabled={disabled}
                            onClick={() => onSelect(item.id)}
                            title={item.title}
                          >
                            <bdi>{item.title}</bdi>
                          </button>
                          <button
                            type="button"
                            className="ai-history-more"
                            aria-label={`خيارات المحادثة: ${item.title}`}
                            aria-haspopup="menu"
                            aria-expanded={menuId === item.id}
                            onClick={() => setMenuId(menuId === item.id ? null : item.id)}
                          >
                            <MoreVertical size={16} aria-hidden="true" />
                          </button>
                          {menuId === item.id && (
                            <div className="ai-history-menu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuId(null);
                                  setRenamingId(item.id);
                                  setRenameValue(item.title);
                                }}
                              >
                                <Pencil size={14} aria-hidden="true" /> تغيير الاسم
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="danger"
                                onClick={() => {
                                  setMenuId(null);
                                  setDialog({ type: 'one', id: item.id, title: item.title });
                                }}
                              >
                                <Trash2 size={14} aria-hidden="true" /> حذف
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}

        {nextCursor && !loading && (
          <button type="button" className="ai-history-more-btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'جاري التحميل...' : 'عرض المزيد'}
          </button>
        )}
      </div>

      {items.length > 0 && (
        <button
          type="button"
          className="ai-history-delete-all"
          onClick={() => {
            setAcknowledged(false);
            setDialog({ type: 'all' });
          }}
        >
          <Trash2 size={15} aria-hidden="true" /> حذف كل المحادثات
        </button>
      )}

      {dialog && (
        <div className="ai-history-dialog-backdrop" onClick={() => !busy && setDialog(null)}>
          <div
            className="ai-history-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ai-history-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="ai-history-dialog-title">{dialog.type === 'one' ? 'حذف المحادثة؟' : 'حذف كل المحادثات؟'}</h3>
            {dialog.type === 'one' ? (
              <p>
                هتتحذف المحادثة «<bdi>{dialog.title}</bdi>» ورسايلها. الكورسات والمحاضرات والامتحانات اللي اتعملت منها هتفضل زي ما هي، وسجل العمليات المنفّذة محفوظ.
              </p>
            ) : (
              <>
                <p>هتتحذف كل محادثاتك ورسايلها ومسودات الاستخراج غير المحفوظة. اللي اتنفّذ فعلًا (كورسات، محاضرات، امتحانات) وسجل العمليات مش هيتأثروا.</p>
                <label className="ai-history-ack">
                  <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                  فاهم إن حذف المحادثات مش بيترجع
                </label>
              </>
            )}
            <div className="ai-history-dialog-actions">
              <button type="button" autoFocus onClick={() => setDialog(null)} disabled={busy}>
                إلغاء
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void confirmDelete()}
                disabled={busy || (dialog.type === 'all' && !acknowledged)}
              >
                {busy ? 'جاري الحذف...' : 'حذف'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
