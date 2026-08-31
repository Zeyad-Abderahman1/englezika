'use client';

/**
 * app/components/admin/domains/EnrollmentsManagerView.tsx
 *
 * Dedicated Enrollments domain management page (/admin/enrollments):
 * - Segmented status tabs: Pending (معلقة), Approved (مفعلة), Rejected (مرفوضة), All (الكل)
 * - Quick approval and rejection actions with instant optimistic and server updates
 * - Payment method & transaction reference inspection
 * - Search by student email, course, or reference
 */

import { useState, useMemo } from 'react';
import {
  Users,
  Check,
  X,
  CreditCard,
  RotateCcw,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Enrollment } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminStatusBadge } from '../shell/AdminStatusBadge';

export function EnrollmentsManagerView() {
  const { data, busy, mutate, openConfirm } = useAdmin();
  const [search, setSearch] = useState('');
  const [statusSegment, setStatusSegment] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');

  const enrollments = useMemo(() => data?.enrollments || [], [data?.enrollments]);

  const filteredEnrollments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrollments.filter((item) => {
      const matchSearch =
        !q ||
        item.userEmail.toLowerCase().includes(q) ||
        item.courseTitle.toLowerCase().includes(q) ||
        (item.paymentReference && item.paymentReference.toLowerCase().includes(q)) ||
        (item.paymentMethod && item.paymentMethod.toLowerCase().includes(q));

      const matchStatus = statusSegment === 'all' || item.status === statusSegment;
      return matchSearch && matchStatus;
    });
  }, [enrollments, search, statusSegment]);

  const countsByStatus = useMemo(() => {
    return {
      pending: enrollments.filter((e) => e.status === 'pending').length,
      approved: enrollments.filter((e) => e.status === 'approved').length,
      rejected: enrollments.filter((e) => e.status === 'rejected').length,
      all: enrollments.length,
    };
  }, [enrollments]);

  const handleUpdateStatus = async (
    enrollment: Enrollment,
    newStatus: 'approved' | 'rejected' | 'pending'
  ) => {
    if (newStatus === 'rejected') {
      openConfirm({
        title: `رفض اشتراك ${enrollment.userEmail}`,
        message: `هل أنت متأكد من رفض طلب اشتراك الطالب في كورس «${enrollment.courseTitle}»؟`,
        confirmLabel: 'تأكيد الرفض',
        isDestructive: true,
        onConfirm: async () => {
          await mutate(
            () =>
              adminApiRequest(`/api/admin/enrollments/${enrollment.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: 'rejected' }),
              }),
            'تم رفض طلب الاشتراك'
          );
        },
      });
      return;
    }

    const message =
      newStatus === 'approved'
        ? 'تم تفعيل الاشتراك وفتح محتوى الكورس للطالب'
        : 'تمت إعادة الطلب إلى قيد الانتظار';

    await mutate(
      () =>
        adminApiRequest(`/api/admin/enrollments/${enrollment.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        }),
      message
    );
  };

  return (
    <div className="admin-enrollments-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="طلبات الاشتراكات وتفعيل الكورسات"
        description="مراجعة عمليات الدفع، مطابقة الأرقام المرجعية، وتفعيل وصول الطلاب للمحتوى التعليمي."
        breadcrumbs={[{ label: 'الاشتراكات' }]}
        badge={
          countsByStatus.pending > 0 ? (
            <span className="admin-header-pill pill-warning">
              <Clock size={14} /> {countsByStatus.pending} طلبات معلقة
            </span>
          ) : (
            <span className="admin-header-pill pill-success">
              <CheckCircle size={14} /> جميع الطلبات مراجعة
            </span>
          )
        }
      />

      {/* ── Status Segment Tabs ────────────────────────────────────────────── */}
      <div className="admin-segments-bar" role="tablist" aria-label="تصفية حالة الاشتراكات">
        <button
          type="button"
          role="tab"
          aria-selected={statusSegment === 'pending'}
          className={`segment-btn ${statusSegment === 'pending' ? 'active' : ''}`}
          onClick={() => setStatusSegment('pending')}
        >
          <Clock size={15} />
          <span>الطلبات المعلقة</span>
          {countsByStatus.pending > 0 && (
            <span className="segment-badge warning">{countsByStatus.pending}</span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusSegment === 'approved'}
          className={`segment-btn ${statusSegment === 'approved' ? 'active' : ''}`}
          onClick={() => setStatusSegment('approved')}
        >
          <CheckCircle size={15} />
          <span>المفعلة</span>
          <span className="segment-badge">{countsByStatus.approved}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusSegment === 'rejected'}
          className={`segment-btn ${statusSegment === 'rejected' ? 'active' : ''}`}
          onClick={() => setStatusSegment('rejected')}
        >
          <XCircle size={15} />
          <span>المرفوضة</span>
          <span className="segment-badge">{countsByStatus.rejected}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={statusSegment === 'all'}
          className={`segment-btn ${statusSegment === 'all' ? 'active' : ''}`}
          onClick={() => setStatusSegment('all')}
        >
          <span>الكل</span>
          <span className="segment-badge">{countsByStatus.all}</span>
        </button>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالبريد الإلكتروني، الكورس، أو الرقم المرجعي..."
        resultCount={filteredEnrollments.length}
        onClearFilters={() => setSearch('')}
      />

      {/* ── Enrollments Table / Cards ───────────────────────────────────────── */}
      {filteredEnrollments.length === 0 ? (
        <AdminEmptyState
          icon={Users}
          title={
            statusSegment === 'pending'
              ? 'لا توجد أي طلبات اشتراك معلقة حاليًا'
              : 'لا توجد اشتراكات مطابقة'
          }
          description={
            search
              ? 'جرّب تعديل كلمة البحث لعرض النتائج.'
              : statusSegment === 'pending'
                ? 'رائع! لقد قمت بمراجعة جميع طلبات الاشتراك المعلقة.'
                : 'لا توجد سجلات اشتراك في هذا القسم حاليًا.'
          }
        />
      ) : (
        <div className="admin-table-container">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>الطالب</th>
                <th>الكورس المطلوب</th>
                <th>طريقة الدفع والرقم المرجعي</th>
                <th>تاريخ الطلب</th>
                <th>الحالة</th>
                <th className="text-end">اتخاذ القرار</th>
              </tr>
            </thead>
            <tbody>
              {filteredEnrollments.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="table-entity-cell">
                      <strong className="entity-primary-text" dir="ltr">
                        {item.userEmail}
                      </strong>
                    </div>
                  </td>
                  <td>
                    <span className="admin-course-cell-title">{item.courseTitle}</span>
                  </td>
                  <td>
                    <div className="table-payment-cell">
                      <span className="payment-method-text">
                        <CreditCard size={14} /> {item.paymentMethod || 'دفع إلكتروني'}
                      </span>
                      <code className="payment-reference-code" dir="ltr">
                        {item.paymentReference || 'بدون رقم مرجعي'}
                      </code>
                    </div>
                  </td>
                  <td>
                    <span className="table-date-text">
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleDateString('ar-EG')
                        : '—'}
                    </span>
                  </td>
                  <td>
                    <AdminStatusBadge status={item.status} />
                  </td>
                  <td className="text-end">
                    <div className="admin-row-actions">
                      {item.status !== 'approved' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy}
                          onClick={() => handleUpdateStatus(item, 'approved')}
                          title="تفعيل اشتراك الطالب"
                        >
                          <Check size={14} /> تفعيل
                        </button>
                      )}

                      {item.status !== 'rejected' && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm text-danger"
                          disabled={busy}
                          onClick={() => handleUpdateStatus(item, 'rejected')}
                          title="رفض طلب الاشتراك"
                        >
                          <X size={14} /> رفض
                        </button>
                      )}

                      {item.status !== 'pending' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => handleUpdateStatus(item, 'pending')}
                          title="إعادة الطلب لحالة الانتظار"
                        >
                          <RotateCcw size={13} /> معلق
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
