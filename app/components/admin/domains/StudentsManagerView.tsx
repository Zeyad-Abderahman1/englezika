'use client';

/**
 * app/components/admin/domains/StudentsManagerView.tsx
 *
 * Dedicated Students domain management page (/admin/students):
 * - Paginated directory with server-side multi-field search (name, email, phone)
 * - Grade level filtering
 * - Detailed student inspection drawer/modal (guardian info, school, academic profile)
 * - Confidential birth certificate streaming viewer
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap,
  Search,
  FileText,
  Phone,
  User,
  Shield,
  ChevronLeft,
  ChevronRight,
  X,
  BookOpen,
  Trash2,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Student } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminLoadingSkeleton } from '../shell/AdminLoadingSkeleton';

export function StudentsManagerView() {
  const { counts, can, mutate, openConfirm } = useAdmin();
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const fetchStudents = useCallback(
    async (pageNum = 1, searchQuery = search, gradeFilter = grade) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          limit: '50',
        });
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (gradeFilter) params.set('grade', gradeFilter);

        const res = (await adminApiRequest(
          `/api/admin/students?${params.toString()}`,
          { cache: 'no-store' }
        )) as { students: Student[]; total: number; pages: number };

        setStudents(res.students || []);
        setTotal(res.total || 0);
        setPages(res.pages || 1);
        setPage(pageNum);
      } catch (e) {
        console.error('Failed to load students:', e);
      } finally {
        setLoading(false);
      }
    },
    [search, grade]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchStudents(1, '', '');
  }, [fetchStudents]);

  const handleSearchSubmit = () => {
    void fetchStudents(1, search, grade);
  };

  const handleGradeChange = (newGrade: string) => {
    setGrade(newGrade);
    void fetchStudents(1, search, newGrade);
  };

  const handleDeleteStudent = (student: Student) => {
    const displayName = student.name || student.email;
    openConfirm({
      title: `حذف حساب «${displayName}»`,
      message: `هل أنت متأكد من حذف الطالب ${displayName} (${student.email})؟ سيتم إلغاء جلساته وحذف ملفاته الخاصة مع الاحتفاظ بالسجلات الأكاديمية بعد إخفاء هويته.`,
      confirmLabel: 'تأكيد حذف الطالب',
      isDestructive: true,
      onConfirm: async () => {
        const ok = await mutate(
          () =>
            adminApiRequest('/api/admin/students', {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: student.email }),
            }),
          'تم حذف حساب الطالب بأمان'
        );
        if (!ok) return;
        setSelectedStudent(null);
        setStudents((current) => current.filter((item) => item.email !== student.email));
        setTotal((current) => Math.max(0, current - 1));
        await fetchStudents(page, search, grade);
      },
    });
  };

  return (
    <div className="admin-students-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="دليل الطلاب والبيانات الأكاديمية"
        description="البحث في سجلات الطلاب، الاطلاع على أرقام أولياء الأمور، المحافظات، وفحص شهادات الميلاد المحمية."
        breadcrumbs={[{ label: 'الطلاب' }]}
        badge={
          <span className="admin-header-pill">
            <GraduationCap size={14} /> {total || counts.students} طالب مسجل
          </span>
        }
      />

      {/* ── Filter Toolbar ─────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالاسم الرباعي، البريد الإلكتروني، أو رقم الموبايل..."
        onSearchSubmit={handleSearchSubmit}
        resultCount={total}
        onClearFilters={() => {
          setSearch('');
          setGrade('');
          void fetchStudents(1, '', '');
        }}
        filters={
          <select
            value={grade}
            onChange={(e) => handleGradeChange(e.target.value)}
            className="admin-select"
            aria-label="تصفية الطلاب حسب الصف الدراسي"
          >
            <option value="">كل الصفوف الدراسية</option>
            <option value="أولى ثانوي">أولى ثانوي</option>
            <option value="تانية ثانوي">تانية ثانوي</option>
            <option value="تالتة ثانوي">تالتة ثانوي</option>
          </select>
        }
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSearchSubmit}
          >
            <Search size={14} /> بحث
          </button>
        }
      />

      {/* ── Students Content ────────────────────────────────────────────────── */}
      {loading ? (
        <AdminLoadingSkeleton type="table" rows={8} />
      ) : students.length === 0 ? (
        <AdminEmptyState
          icon={GraduationCap}
          title="لم يتم العثور على أي طلاب"
          description={
            search || grade
              ? 'جرّب تعديل عبارة البحث أو اختيار صف دراسي مختلف.'
              : 'لا يوجد طلاب مسجلون في المنصة حتى الآن.'
          }
        />
      ) : (
        <>
          <div className="admin-table-container">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>الصف والشعبة</th>
                  <th>المحافظة</th>
                  <th>بيانات الاتصال</th>
                  <th>النشاط الأكاديمي</th>
                  <th>شهادة الميلاد</th>
                  <th className="text-end">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr
                    key={student.email}
                    onClick={() => setSelectedStudent(student)}
                    className="clickable-row"
                  >
                    <td>
                      <div className="table-entity-cell">
                        <strong className="entity-primary-text">
                          {student.name || student.email}
                        </strong>
                        <span className="entity-secondary-text" dir="ltr">
                          {student.email}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="admin-grade-badge">
                        {student.grade}
                        {student.section && ` (${student.section})`}
                      </span>
                    </td>
                    <td>{student.governorate || '—'}</td>
                    <td>
                      <div className="table-contact-cell">
                        <span>{student.phone || '—'}</span>
                        {student.fatherPhone && (
                          <small className="text-muted">الأب: {student.fatherPhone}</small>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="admin-activity-pill">
                        {student.activeEnrollments} اشتراك · {student.totalAttempts} امتحان
                      </span>
                    </td>
                    <td>
                      {student.hasBirthCertificate ? (
                        <span className="badge-document-available">
                          <FileText size={13} /> متوفرة
                        </span>
                      ) : (
                        <span className="badge-document-missing">غير مرفوعة</span>
                      )}
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedStudent(student);
                        }}
                      >
                        عرض الملف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination Bar ───────────────────────────────────────────────── */}
          {pages > 1 && (
            <div className="admin-pagination-footer" aria-label="التنقل بين صفحات الطلاب">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={page <= 1 || loading}
                onClick={() => void fetchStudents(page - 1)}
              >
                <ChevronRight size={16} /> الصفحة السابقة
              </button>
              <span className="pagination-info">
                صفحة <strong>{page}</strong> من <strong>{pages}</strong> ({total} طالب)
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={page >= pages || loading}
                onClick={() => void fetchStudents(page + 1)}
              >
                الصفحة التالية <ChevronLeft size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Student Profile Inspection Modal / Drawer ───────────────────────── */}
      {selectedStudent && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedStudent(null);
          }}
        >
          <div className="admin-modal-card student-profile-modal">
            <header className="admin-modal-header">
              <div className="student-profile-header-info">
                <div className="student-avatar-placeholder">
                  <User size={28} />
                </div>
                <div>
                  <h3 id="student-modal-title" className="admin-modal-title">
                    {selectedStudent.name || selectedStudent.email}
                  </h3>
                  <span className="student-header-email" dir="ltr">
                    {selectedStudent.email}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setSelectedStudent(null)}
                aria-label="إغلاق الملف"
              >
                <X size={18} />
              </button>
            </header>

            <div className="student-profile-content">
              {/* Personal & Academic Info */}
              <section className="profile-section">
                <h4 className="profile-section-title">
                  <BookOpen size={16} /> البيانات الأكاديمية والشخصية
                </h4>
                <div className="profile-info-grid">
                  <div className="profile-info-item">
                    <span className="info-label">الصف الدراسي:</span>
                    <strong className="info-value">{selectedStudent.grade || '—'}</strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">الشعبة:</span>
                    <strong className="info-value">{selectedStudent.section || '—'}</strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">النوع:</span>
                    <strong className="info-value">{selectedStudent.gender || '—'}</strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">المحافظة:</span>
                    <strong className="info-value">{selectedStudent.governorate || '—'}</strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">المدرسة:</span>
                    <strong className="info-value">{selectedStudent.schoolName || '—'}</strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">وظيفة ولي الأمر:</span>
                    <strong className="info-value">{selectedStudent.parentJob || '—'}</strong>
                  </div>
                </div>
              </section>

              {/* Contact Information */}
              <section className="profile-section">
                <h4 className="profile-section-title">
                  <Phone size={16} /> أرقام التواصل وأولياء الأمور
                </h4>
                <div className="profile-info-grid">
                  <div className="profile-info-item">
                    <span className="info-label">موبايل الطالب:</span>
                    <strong className="info-value">
                      {selectedStudent.phone ? (
                        <a href={`tel:${selectedStudent.phone}`} className="phone-link">
                          {selectedStudent.phone}
                        </a>
                      ) : (
                        '—'
                      )}
                    </strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">هاتف الأب:</span>
                    <strong className="info-value">
                      {selectedStudent.fatherPhone ? (
                        <a href={`tel:${selectedStudent.fatherPhone}`} className="phone-link">
                          {selectedStudent.fatherPhone}
                        </a>
                      ) : (
                        '—'
                      )}
                    </strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">هاتف الأم:</span>
                    <strong className="info-value">
                      {selectedStudent.motherPhone ? (
                        <a href={`tel:${selectedStudent.motherPhone}`} className="phone-link">
                          {selectedStudent.motherPhone}
                        </a>
                      ) : (
                        '—'
                      )}
                    </strong>
                  </div>
                  <div className="profile-info-item">
                    <span className="info-label">تاريخ التسجيل بالمنصة:</span>
                    <strong className="info-value">
                      {selectedStudent.createdAt
                        ? new Date(selectedStudent.createdAt).toLocaleDateString('ar-EG')
                        : '—'}
                    </strong>
                  </div>
                </div>
              </section>

              {/* Confidential Document Stream */}
              <section className="profile-section confidential-section">
                <h4 className="profile-section-title">
                  <Shield size={16} /> المستندات الرسمية المحمية
                </h4>
                <div className="confidential-doc-box">
                  <div>
                    <strong>شهادة الميلاد الرسمية</strong>
                    <p>مستند خاص ومحمي مشفر ولا يظهر إلا للمدرس والمساعدين المصرح لهم.</p>
                  </div>
                  {selectedStudent.hasBirthCertificate ? (
                    <a
                      href={`/api/admin/students/${encodeURIComponent(selectedStudent.email)}/birth-certificate`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-primary btn-sm"
                    >
                      <FileText size={15} /> فتح المستند المحمي
                    </a>
                  ) : (
                    <span className="text-muted">لم يتم رفع شهادة الميلاد</span>
                  )}
                </div>
              </section>
            </div>

            <footer className="admin-modal-footer">
              {can('manage_staff') && (
                <button
                  type="button"
                  className="btn btn-outline btn-danger"
                  onClick={() => handleDeleteStudent(selectedStudent)}
                >
                  <Trash2 size={16} /> حذف الطالب
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setSelectedStudent(null)}
              >
                إغلاق
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
