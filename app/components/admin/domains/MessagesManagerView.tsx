'use client';

/**
 * app/components/admin/domains/MessagesManagerView.tsx
 *
 * Dedicated Messages domain inbox page (/admin/messages):
 * - Support and contact messages management
 * - Filter by status (new / reviewed / all) and text search
 * - Direct `tel:` phone call links
 * - "تحديد كـ تمت المراجعة" action with instant status updates
 */

import { useState, useMemo } from 'react';
import {
  Mail,
  Phone,
  CheckCheck,
  Clock,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Contact } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';

export function MessagesManagerView() {
  const { data, busy, mutate } = useAdmin();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'reviewed'>('all');

  const contacts = useMemo(() => data?.contacts || [], [data?.contacts]);

  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((item) => {
      const matchSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.phone.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [contacts, search, statusFilter]);

  const counts = useMemo(() => {
    return {
      new: contacts.filter((c) => c.status === 'new').length,
      reviewed: contacts.filter((c) => c.status === 'reviewed').length,
      all: contacts.length,
    };
  }, [contacts]);

  const handleMarkReviewed = async (message: Contact) => {
    await mutate(
      () =>
        adminApiRequest(`/api/admin/contacts/${message.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'reviewed' }),
        }),
      'تمت مراجعة الرسالة وتحديث حالتها بنجاح'
    );
  };

  return (
    <div className="admin-messages-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="رسائل واستفسارات التواصل"
        description="صندوق الوارد لرسائل الطلاب وأولياء الأمور الواردة عبر نموذج الاتصال بالمنصة."
        breadcrumbs={[{ label: 'الرسائل' }]}
        badge={
          counts.new > 0 ? (
            <span className="admin-header-pill pill-warning">
              <Mail size={14} /> {counts.new} رسائل جديدة
            </span>
          ) : (
            <span className="admin-header-pill pill-success">
              <CheckCircle2 size={14} /> تمت مراجعة جميع الرسائل
            </span>
          )
        }
      />

      {/* ── Status Segments ─────────────────────────────────────────────────── */}
      <div className="admin-segments-bar" role="tablist" aria-label="تصفية الرسائل">
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'new'}
          className={`segment-btn ${statusFilter === 'new' ? 'active' : ''}`}
          onClick={() => setStatusFilter('new')}
        >
          <Clock size={15} />
          <span>رسائل جديدة</span>
          {counts.new > 0 && <span className="segment-badge warning">{counts.new}</span>}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'reviewed'}
          className={`segment-btn ${statusFilter === 'reviewed' ? 'active' : ''}`}
          onClick={() => setStatusFilter('reviewed')}
        >
          <CheckCheck size={15} />
          <span>تمت المراجعة</span>
          <span className="segment-badge">{counts.reviewed}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'all'}
          className={`segment-btn ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          <span>كل الرسائل</span>
          <span className="segment-badge">{counts.all}</span>
        </button>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالاسم، رقم الموبايل، أو نص الرسالة..."
        resultCount={filteredMessages.length}
        onClearFilters={() => setSearch('')}
      />

      {/* ── Messages Grid ───────────────────────────────────────────────────── */}
      {filteredMessages.length === 0 ? (
        <AdminEmptyState
          icon={Mail}
          title={
            statusFilter === 'new'
              ? 'لا توجد رسائل جديدة بانتظار المراجعة'
              : 'لا توجد رسائل مطابقة'
          }
          description={
            search
              ? 'جرّب تعديل عبارة البحث لعرض النتائج.'
              : statusFilter === 'new'
                ? 'رائع! لا توجد استفسارات معلقة حاليًا.'
                : 'لم يتم استلام أي رسائل في هذا القسم.'
          }
        />
      ) : (
        <div className="admin-messages-grid">
          {filteredMessages.map((msg) => {
            const isNew = msg.status === 'new';

            return (
              <article
                key={msg.id}
                className={`admin-message-card ${isNew ? 'is-unread' : ''}`}
              >
                <header className="admin-message-header">
                  <div className="admin-message-sender-info">
                    <strong className="sender-name">{msg.name}</strong>
                    <a href={`tel:${msg.phone}`} className="sender-phone-link" dir="ltr">
                      <Phone size={13} /> {msg.phone}
                    </a>
                  </div>

                  <div className="admin-message-header-meta">
                    <span className={`admin-message-status-pill ${isNew ? 'new' : 'reviewed'}`}>
                      {isNew ? 'جديد' : 'تمت المراجعة'}
                    </span>
                    <time className="admin-message-timestamp">
                      <Calendar size={12} />
                      {msg.createdAt
                        ? new Date(msg.createdAt).toLocaleDateString('ar-EG', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </time>
                  </div>
                </header>

                <div className="admin-message-body">
                  <p className="admin-message-text">{msg.message}</p>
                </div>

                <footer className="admin-message-footer">
                  <a href={`tel:${msg.phone}`} className="btn btn-outline btn-sm">
                    <Phone size={14} /> اتصال بالمُرسل
                  </a>

                  {isNew && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => handleMarkReviewed(msg)}
                    >
                      <CheckCheck size={14} /> تحديد كـ &quot;تمت المراجعة&quot;
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
