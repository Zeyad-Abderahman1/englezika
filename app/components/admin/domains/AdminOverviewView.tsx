'use client';

/**
 * app/components/admin/domains/AdminOverviewView.tsx
 *
 * Overview domain page view (/admin):
 * - Welcome hero banner with staff context
 * - Permission-gated quick actions
 * - Key performance indicator (KPI) metric cards
 * - "بحاجة لمراجعتك" (Requires Attention) priority section
 * - Course Workspace with search and direct content links
 * - Fast announcement publishing form & active announcements manager
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  BellRing,
  CirclePlus,
  ClipboardCheck,
  FileQuestion,
  GraduationCap,
  Mail,
  PlaySquare,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAdmin, adminApiRequest } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { TeacherCourseWorkspace } from '../TeacherCourseWorkspace';
import { AdminAnnouncementsList } from '../AdminAnnouncementsList';

export function AdminOverviewView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, admin, counts, can, busy, mutate } = useAdmin();
  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceBody, setAnnounceBody] = useState('');

  // Handle legacy ?tab=... query parameters by cleanly redirecting
  useEffect(() => {
    const legacyTab = searchParams.get('tab');
    if (legacyTab && legacyTab !== 'overview') {
      const tabMap: Record<string, string> = {
        courses: '/admin/courses',
        videos: '/admin/lectures',
        lectures: '/admin/lectures',
        exams: '/admin/exams',
        assignments: '/admin/assignments',
        students: '/admin/students',
        enrollments: '/admin/enrollments',
        results: '/admin/results',
        messages: '/admin/messages',
        staff: '/admin/staff',
      };
      if (tabMap[legacyTab]) {
        router.replace(tabMap[legacyTab]);
      }
    }
  }, [searchParams, router]);

  if (!data || !admin) return null;

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announceTitle.trim() || !announceBody.trim()) return;

    await mutate(
      () =>
        adminApiRequest('/api/admin/announcements', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: announceTitle, body: announceBody }),
        }),
      'تم نشر الإعلان بنجاح'
    );
    setAnnounceTitle('');
    setAnnounceBody('');
  };

  const handleEditAnnouncement = (id: string, values: { title: string; body: string }) => {
    void mutate(
      () =>
        adminApiRequest(`/api/admin/announcements/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        }),
      'تم تحديث الإعلان بنجاح'
    );
  };

  const handleDeleteAnnouncement = (id: string) => {
    void mutate(
      () => adminApiRequest(`/api/admin/announcements/${id}`, { method: 'DELETE' }),
      'تم حذف الإعلان'
    );
  };

  const hasAttentionItems =
    (can('manage_enrollments') && counts.pendingEnrollments > 0) ||
    (can('manage_messages') && counts.newMessages > 0);

  return (
    <div className="admin-overview-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title={`مرحبًا، ${admin.name}`}
        description="نظرة شاملة على نشاط المنصة، المحتوى التعليمي، والإجراءات التي تتطلب انتباهك."
        badge={
          <span className="admin-header-pill">
            <Sparkles size={14} /> {admin.role === 'teacher' ? 'مدرس — صلاحية كاملة' : 'مساعد'}
          </span>
        }
      />

      {/* ── Quick Action Shortcuts (Permission Filtered) ──────────────────── */}
      <section className="admin-quick-actions-bar" aria-label="إجراءات سريعة">
        <span className="admin-quick-actions-title">إجراءات سريعة:</span>
        <div className="admin-quick-actions-list">
          {can('manage_courses') && (
            <Link href="/admin/courses" className="btn btn-outline admin-quick-btn">
              <CirclePlus size={16} /> إضافة كورس
            </Link>
          )}
          {can('manage_videos') && (
            <Link href="/admin/lectures" className="btn btn-outline admin-quick-btn">
              <PlaySquare size={16} /> رفع محاضرة
            </Link>
          )}
          {can('manage_exams') && (
            <Link href="/admin/exams" className="btn btn-outline admin-quick-btn">
              <FileQuestion size={16} /> إنشاء امتحان
            </Link>
          )}
          {can('manage_assignments') && (
            <Link href="/admin/assignments" className="btn btn-outline admin-quick-btn">
              <ClipboardCheck size={16} /> إنشاء واجب
            </Link>
          )}
          {can('manage_enrollments') && counts.pendingEnrollments > 0 && (
            <Link href="/admin/enrollments" className="btn btn-primary admin-quick-btn">
              <Users size={16} /> مراجعة الاشتراكات ({counts.pendingEnrollments})
            </Link>
          )}
        </div>
      </section>

      {/* ── KPI Metric Cards ──────────────────────────────────────────────── */}
      <section className="admin-stats-grid" aria-label="إحصائيات المنصة">
        {(can('view_students') || can('manage_enrollments')) && (
          <div className="admin-stat-card">
            <div className="admin-stat-icon icon-students">
              <Users size={24} />
            </div>
            <div className="admin-stat-details">
              <span className="admin-stat-label">إجمالي الطلاب</span>
              <strong className="admin-stat-value">{counts.students}</strong>
            </div>
          </div>
        )}

        {can('manage_enrollments') && (
          <div className="admin-stat-card">
            <div className="admin-stat-icon icon-enrollments">
              <GraduationCap size={24} />
            </div>
            <div className="admin-stat-details">
              <span className="admin-stat-label">اشتراكات مفعلة</span>
              <strong className="admin-stat-value">{counts.activeEnrollments}</strong>
            </div>
          </div>
        )}

        {can('manage_enrollments') && (
          <div className="admin-stat-card">
            <div className="admin-stat-icon icon-pending">
              <ClipboardCheck size={24} />
            </div>
            <div className="admin-stat-details">
              <span className="admin-stat-label">طلبات اشتراك معلقة</span>
              <strong className="admin-stat-value">{counts.pendingEnrollments}</strong>
            </div>
          </div>
        )}

        {(can('manage_exams') || can('grade_exams')) && (
          <div className="admin-stat-card">
            <div className="admin-stat-icon icon-exams">
              <FileQuestion size={24} />
            </div>
            <div className="admin-stat-details">
              <span className="admin-stat-label">امتحانات منشورة</span>
              <strong className="admin-stat-value">{counts.publishedExams}</strong>
            </div>
          </div>
        )}

        {can('grade_exams') && (
          <div className="admin-stat-card">
            <div className="admin-stat-icon icon-average">
              <BarChart3 size={24} />
            </div>
            <div className="admin-stat-details">
              <span className="admin-stat-label">متوسط النتائج</span>
              <strong className="admin-stat-value">
                {Math.round(Number(counts.averageScore) || 0)}%
              </strong>
            </div>
          </div>
        )}

        {can('manage_messages') && (
          <div className="admin-stat-card">
            <div className="admin-stat-icon icon-messages">
              <Mail size={24} />
            </div>
            <div className="admin-stat-details">
              <span className="admin-stat-label">رسائل جديدة</span>
              <strong className="admin-stat-value">{counts.newMessages}</strong>
            </div>
          </div>
        )}
      </section>

      {/* ── Attention / Priority Section ──────────────────────────────────── */}
      {hasAttentionItems && (
        <section className="admin-attention-section">
          <div className="admin-attention-header">
            <span className="admin-section-tag">تنبيهات هامة</span>
            <h2>بحاجة لمراجعتك الآن</h2>
          </div>
          <div className="admin-attention-grid">
            {can('manage_enrollments') && counts.pendingEnrollments > 0 && (
              <Link href="/admin/enrollments" className="admin-attention-card">
                <div className="admin-attention-card-icon">
                  <Users size={22} />
                </div>
                <div className="admin-attention-card-text">
                  <strong>{counts.pendingEnrollments} طلب اشتراك جديد</strong>
                  <p>تحقق من بيانات الدفع وفعل اشتراكات الطلاب للوصول للمحاضرات.</p>
                </div>
                <span className="admin-attention-card-action">مراجعة &larr;</span>
              </Link>
            )}

            {can('manage_messages') && counts.newMessages > 0 && (
              <Link href="/admin/messages" className="admin-attention-card">
                <div className="admin-attention-card-icon">
                  <Mail size={22} />
                </div>
                <div className="admin-attention-card-text">
                  <strong>{counts.newMessages} استفسار دعم جديد</strong>
                  <p>رسائل جديدة من صفحة التواصل في انتظار الرد والمراجعة.</p>
                </div>
                <span className="admin-attention-card-action">فتح البريد &larr;</span>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── Teacher / Course Workspace ────────────────────────────────────── */}
      {can('manage_courses') && (
        <TeacherCourseWorkspace
          courses={data.courses}
          exams={data.exams}
          assignments={data.assignments}
          videos={data.videos}
          enrollments={data.enrollments}
          canManageExams={can('manage_exams')}
          canManageAssignments={can('manage_assignments')}
          canManageVideos={can('manage_videos')}
          onEditCourse={(courseId) => {
            router.push(`/admin/courses?focus=${courseId}`);
          }}
          onAddExam={(courseId) => {
            router.push(`/admin/exams?courseId=${courseId}`);
          }}
          onAddAssignment={(courseId) => {
            router.push(`/admin/assignments?courseId=${courseId}`);
          }}
          onManageLessons={(courseId) => {
            router.push(`/admin/lectures?courseId=${courseId}`);
          }}
        />
      )}

      {/* ── Broadcast Announcement Management ────────────────────────────── */}
      {can('manage_announcements') && (
        <div className="admin-overview-announcements-grid">
          <section className="dashboard-panel admin-announcement-composer">
            <div className="panel-title">
              <BellRing size={20} />
              <div>
                <h2>نشر إعلان عام</h2>
                <p>يظهر فورًا لجميع الطلاب في الشريط العلوي بلوحة حساباتهم</p>
              </div>
            </div>
            <form className="stack-form" onSubmit={handlePostAnnouncement}>
              <label>
                عنوان الإعلان
                <input
                  value={announceTitle}
                  onChange={(e) => setAnnounceTitle(e.target.value)}
                  placeholder="مثال: موعد الامتحان الشامل الأسبوع القادم"
                  required
                  maxLength={150}
                  className="admin-input"
                />
              </label>
              <label>
                نص الإعلان
                <textarea
                  value={announceBody}
                  onChange={(e) => setAnnounceBody(e.target.value)}
                  placeholder="اكتب تفاصيل الإعلان والتعليمات للطلاب هنا..."
                  rows={4}
                  required
                  maxLength={2000}
                  className="admin-input"
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !announceTitle.trim() || !announceBody.trim()}
              >
                <BellRing size={16} /> نشر الإعلان للطلاب
              </button>
            </form>
          </section>

          <AdminAnnouncementsList
            announcements={data.announcements ?? []}
            busy={busy}
            onEdit={handleEditAnnouncement}
            onDelete={handleDeleteAnnouncement}
          />
        </div>
      )}
    </div>
  );
}
