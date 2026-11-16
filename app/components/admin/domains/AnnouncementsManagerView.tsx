'use client';

/**
 * app/components/admin/domains/AnnouncementsManagerView.tsx
 *
 * Dedicated Announcements domain management page (/admin/announcements):
 * - Create broadcast announcements instantly
 * - Chronological announcements feed
 * - Edit announcement title and body
 * - Delete announcement with confirmation
 */

import { useState, useMemo, type FormEvent } from 'react';
import {
  BellRing,
  CirclePlus,
  PencilLine,
  Trash2,
  Save,
  X,
  Megaphone,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Announcement } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';

export function AnnouncementsManagerView() {
  const { data, busy, mutate, openConfirm } = useAdmin();
  const [search, setSearch] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingAnnounce, setEditingAnnounce] = useState<Announcement | null>(null);

  const announcements = useMemo(() => data?.announcements || [], [data?.announcements]);

  const filteredAnnouncements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return announcements.filter((item) => {
      return (
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q)
      );
    });
  }, [announcements, search]);

  const handleCreateAnnouncement = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const ok = await mutate(
      () =>
        adminApiRequest('/api/admin/announcements', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: fd.get('title'),
            body: fd.get('body'),
          }),
        }),
      'تم نشر الإعلان بنجاح لجميع الطلاب'
    );

    if (ok) {
      form.reset();
      setIsAddOpen(false);
    }
  };

  const handleEditAnnouncement = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingAnnounce) return;
    const form = e.currentTarget;
    const fd = new FormData(form);

    const ok = await mutate(
      () =>
        adminApiRequest(`/api/admin/announcements/${editingAnnounce.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: fd.get('title'),
            body: fd.get('body'),
          }),
        }),
      'تم تحديث الإعلان بنجاح'
    );

    if (ok) {
      setEditingAnnounce(null);
    }
  };

  const handleDeleteAnnouncement = (announce: Announcement) => {
    openConfirm({
      title: `حذف إعلان «${announce.title}»`,
      message: 'هل أنت متأكد من رغبتك في حذف هذا الإعلان من لوحة الطلاب؟',
      confirmLabel: 'تأكيد حذف الإعلان',
      isDestructive: true,
      onConfirm: async () => {
        await mutate(
          () => adminApiRequest(`/api/admin/announcements/${announce.id}`, { method: 'DELETE' }),
          'تم حذف الإعلان'
        );
      },
    });
  };

  return (
    <div className="admin-announcements-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="الإعلانات والتنبيهات العامة"
        description="نشر إشعارات وتنبيهات مباشرة تظهر أعلى لوحة تحكم جميع الطلاب فور نشرها."
        breadcrumbs={[{ label: 'الإعلانات' }]}
        badge={
          <span className="admin-header-pill">
            <BellRing size={14} /> {announcements.length} إعلان
          </span>
        }
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsAddOpen(true)}
          >
            <CirclePlus size={16} /> نشر إعلان جديد
          </button>
        }
      />

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث في عناوين أو نصوص الإعلانات..."
        resultCount={filteredAnnouncements.length}
        onClearFilters={() => setSearch('')}
      />

      {/* ── Announcements Feed ─────────────────────────────────────────────── */}
      {filteredAnnouncements.length === 0 ? (
        <AdminEmptyState
          icon={Megaphone}
          title="لا توجد إعلانات منشورة"
          description={
            search
              ? 'لا توجد نتائج تطابق عبارة البحث الحالية.'
              : 'لم يتم نشر أي إعلان بعد. انقر على الزر أدناه لبث أول إعلان للطلاب.'
          }
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsAddOpen(true)}
            >
              <CirclePlus size={16} /> نشر إعلان الآن
            </button>
          }
        />
      ) : (
        <div className="admin-announcements-feed">
          {filteredAnnouncements.map((announce) => (
            <article key={announce.id} className="admin-announcement-card">
              <div className="admin-announcement-card-header">
                <div className="announcement-title-box">
                  <span className="announcement-badge-icon">
                    <Megaphone size={16} />
                  </span>
                  <h3 className="announcement-title">{announce.title}</h3>
                </div>
                <time className="announcement-date">
                  {announce.createdAt
                    ? new Date(announce.createdAt).toLocaleDateString('ar-EG', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : '—'}
                </time>
              </div>

              <p className="announcement-body-text">{announce.body}</p>

              <div className="admin-announcement-card-footer">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setEditingAnnounce(announce)}
                >
                  <PencilLine size={14} /> تعديل الإعلان
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon text-danger"
                  onClick={() => handleDeleteAnnouncement(announce)}
                  title="حذف الإعلان"
                  aria-label={`حذف إعلان ${announce.title}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── Add Announcement Modal ─────────────────────────────────────────── */}
      {isAddOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-announce-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddOpen(false);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="add-announce-title" className="admin-modal-title">
                نشر إعلان جديد للطلاب
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setIsAddOpen(false)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-modal-form stack-form" onSubmit={handleCreateAnnouncement}>
              <label className="admin-field-label">
                <span>عنوان الإعلان <span className="text-danger">*</span></span>
                <input
                  name="title"
                  required
                  maxLength={150}
                  placeholder="مثال: تنبيه بخصوص موعد المحاضرة القادمة"
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>نص وتفاصيل الإعلان <span className="text-danger">*</span></span>
                <textarea
                  name="body"
                  required
                  rows={5}
                  maxLength={2000}
                  placeholder="اكتب التنبيه والتعليمات الموجهة لجميع الطلاب هنا..."
                  className="admin-input"
                />
              </label>

              <footer className="admin-modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setIsAddOpen(false)}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <BellRing size={16} /> نشر الإعلان للجميع
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Announcement Modal ────────────────────────────────────────── */}
      {editingAnnounce && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-announce-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingAnnounce(null);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="edit-announce-title" className="admin-modal-title">
                تعديل إعلان «{editingAnnounce.title}»
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setEditingAnnounce(null)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-modal-form stack-form" onSubmit={handleEditAnnouncement}>
              <label className="admin-field-label">
                <span>عنوان الإعلان <span className="text-danger">*</span></span>
                <input
                  name="title"
                  defaultValue={editingAnnounce.title}
                  required
                  maxLength={150}
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>نص الإعلان <span className="text-danger">*</span></span>
                <textarea
                  name="body"
                  defaultValue={editingAnnounce.body}
                  required
                  rows={5}
                  maxLength={2000}
                  className="admin-input"
                />
              </label>

              <footer className="admin-modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingAnnounce(null)}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <Save size={16} /> حفظ التعديلات
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
