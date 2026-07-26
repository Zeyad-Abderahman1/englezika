/**
 * app/components/admin/AdminAnnouncementsList.tsx
 *
 * Displays a list of existing announcements with delete support.
 * Used within the overview section of AdminDashboard.
 */

'use client';

import { BellRing, Trash2 } from 'lucide-react';

type Announcement = { id: string; title: string; body: string; createdAt: number };

interface AdminAnnouncementsListProps {
  announcements: Announcement[];
  busy: boolean;
  onDelete: (id: string) => void;
}

export function AdminAnnouncementsList({
  announcements,
  busy,
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
