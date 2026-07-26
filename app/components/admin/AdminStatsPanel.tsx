/**
 * app/components/admin/AdminStatsPanel.tsx
 *
 * Overview tab: stats grid, announcement post form, and attention list.
 * Extracted from the monolithic AdminDashboard.tsx.
 */

'use client';

import {
  BarChart3,
  BellRing,
  ClipboardCheck,
  FileQuestion,
  GraduationCap,
  Save,
  Users,
} from 'lucide-react';

type Counts = {
  students: number;
  activeEnrollments: number;
  pendingEnrollments: number;
  publishedExams: number;
  attempts: number;
  averageScore: number;
};

type Contact = {
  id: string;
  name: string;
  phone: string;
  message: string;
  status: string;
  createdAt: number;
};

type Permission =
  | 'manage_courses'
  | 'manage_exams'
  | 'manage_videos'
  | 'manage_enrollments'
  | 'grade_exams'
  | 'manage_announcements'
  | 'manage_messages'
  | 'view_students'
  | 'manage_staff';

interface AdminStatsPanelProps {
  counts: Counts;
  contacts: Contact[];
  busy: boolean;
  can: (perm: Permission) => boolean;
  onTabChange: (tab: string) => void;
  onAnnounce: (values: Record<string, string>, resetForm: () => void) => void;
}

export function AdminStatsPanel({
  counts,
  contacts,
  busy,
  can,
  onTabChange,
  onAnnounce,
}: AdminStatsPanelProps) {
  return (
    <>
      <section className="stats-grid admin-stats">
        <article>
          <Users />
          <span>الطلاب</span>
          <strong>{counts.students}</strong>
        </article>
        <article>
          <GraduationCap />
          <span>اشتراكات مفعّلة</span>
          <strong>{counts.activeEnrollments}</strong>
        </article>
        <article>
          <ClipboardCheck />
          <span>طلبات معلّقة</span>
          <strong>{counts.pendingEnrollments}</strong>
        </article>
        <article>
          <FileQuestion />
          <span>امتحانات منشورة</span>
          <strong>{counts.publishedExams}</strong>
        </article>
        <article>
          <BarChart3 />
          <span>متوسط النتائج</span>
          <strong>{Math.round(Number(counts.averageScore) || 0)}%</strong>
        </article>
      </section>

      <div className="admin-overview-grid">
        {can('manage_announcements') && (
          <section className="dashboard-panel">
            <div className="panel-title">
              <BellRing />
              <div>
                <h2>نشر إعلان</h2>
                <p>يظهر فوراً في لوحة كل الطلاب</p>
              </div>
            </div>
            <form
              className="stack-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
                onAnnounce(values, () => form.reset());
              }}
            >
              <label>
                العنوان
                <input name="title" required maxLength={150} />
              </label>
              <label>
                الإعلان
                <textarea name="body" rows={4} required maxLength={2000} />
              </label>
              <button className="btn btn-primary" disabled={busy}>
                <BellRing /> نشر الإعلان
              </button>
            </form>
          </section>
        )}

        <section className="dashboard-panel">
          <div className="panel-title">
            <ClipboardCheck />
            <div>
              <h2>بحاجة لمراجعتك</h2>
              <p>أهم الإجراءات المعلقة</p>
            </div>
          </div>
          <div className="attention-list">
            {can('manage_enrollments') && (
              <button onClick={() => onTabChange('enrollments')}>
                <strong>{counts.pendingEnrollments}</strong>
                <span>طلب اشتراك جديد</span>
              </button>
            )}
            {can('manage_messages') && (
              <button onClick={() => onTabChange('messages')}>
                <strong>{contacts.filter((c) => c.status === 'new').length}</strong>
                <span>رسالة جديدة</span>
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
