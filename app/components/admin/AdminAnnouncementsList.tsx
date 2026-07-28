/**
 * app/components/admin/AdminAnnouncementsList.tsx
 *
 * Displays a list of existing announcements with delete support.
 * Used within the overview section of AdminDashboard.
 */

'use client';

import { BellRing, PencilLine, Save, Trash2 } from 'lucide-react';

type Announcement = { id: string; title: string; body: string; createdAt: number };

interface AdminAnnouncementsListProps {
  announcements: Announcement[];
  busy: boolean;
  onEdit: (id: string, values: { title: string; body: string }) => void;
  onDelete: (id: string) => void;
}

export function AdminAnnouncementsList({
  announcements,
  busy,
  onEdit,
  onDelete,
}: AdminAnnouncementsListProps) {
  if (announcements.length === 0) return null;

  return (
    <section className="dashboard-panel">
      <div className="panel-title">
        <BellRing />
        <div>
          <h2>الإعلانات المنشورة</h2>
          <p>{announcements.length} إعلان</p>
        </div>
      </div>
      <div className="management-list compact">
        {announcements.map((ann) => (
          <article key={ann.id}>
            <div>
              <strong>{ann.title}</strong>
              <small>{new Date(ann.createdAt).toLocaleDateString('ar-EG')}</small>
              <p style={{ opacity: 0.7, fontSize: '0.85rem', marginTop: '0.25rem' }}>{ann.body}</p>
            </div>
            <div className="list-actions">
              <details>
                <summary className="icon-button" aria-label="تعديل الإعلان">
                  <PencilLine />
                </summary>
                <form
                  className="stack-form dashboard-popover-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const values = Object.fromEntries(new FormData(form)) as {
                      title: string;
                      body: string;
                    };
                    onEdit(ann.id, values);
                  }}
                >
                  <label>
                    العنوان
                    <input name="title" defaultValue={ann.title} required maxLength={150} />
                  </label>
                  <label>
                    الإعلان
                    <textarea
                      name="body"
                      defaultValue={ann.body}
                      required
                      rows={5}
                      maxLength={2000}
                    />
                  </label>
                  <button className="btn btn-primary" disabled={busy}>
                    <Save /> حفظ التعديلات
                  </button>
                </form>
              </details>
              <button
                className="icon-button danger"
                aria-label="حذف الإعلان"
                disabled={busy}
                onClick={() => onDelete(ann.id)}
              >
                <Trash2 />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
