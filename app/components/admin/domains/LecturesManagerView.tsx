'use client';

/**
 * app/components/admin/domains/LecturesManagerView.tsx
 *
 * Dedicated Lectures domain management page (/admin/lectures):
 * - Add YouTube Unlisted video lecture
 * - Prerequisite exam threshold selector (% and exam picker)
 * - Video catalog list with course association, search, and status filters
 * - Edit lecture title, status, and sequential prerequisite gates
 * - Delete lecture
 * - One-time lecture access code generator & history manager
 */

import { useState, useMemo, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  PlaySquare,
  Upload,
  PencilLine,
  Trash2,
  Save,
  X,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type Video } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminFilterBar } from '../shell/AdminFilterBar';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminStatusBadge } from '../shell/AdminStatusBadge';
import { LectureAccessCodeManager } from '../LectureAccessCodeManager';

export function LecturesManagerView() {
  const searchParams = useSearchParams();
  const defaultCourseIdFromUrl = searchParams.get('courseId') || '';

  const { data, busy, mutate, openConfirm, refreshData } = useAdmin();
  const [search, setSearch] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(defaultCourseIdFromUrl);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);

  const courses = useMemo(() => data?.courses || [], [data?.courses]);
  const videos = useMemo(() => data?.videos || [], [data?.videos]);
  const exams = useMemo(() => data?.exams || [], [data?.exams]);
  const accessCodes = useMemo(() => data?.accessCodes || [], [data?.accessCodes]);

  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter((video) => {
      const matchSearch =
        !q ||
        video.title.toLowerCase().includes(q) ||
        video.courseTitle.toLowerCase().includes(q);
      const matchCourse = !selectedCourseId || video.courseId === selectedCourseId;
      const matchStatus = statusFilter === 'all' || video.status === statusFilter;
      return matchSearch && matchCourse && matchStatus;
    });
  }, [videos, search, selectedCourseId, statusFilter]);

  const handleAddVideo = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const ok = await mutate(
      () =>
        adminApiRequest('/api/admin/videos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseId: fd.get('courseId'),
            title: fd.get('title'),
            durationSeconds: Number(fd.get('durationSeconds')) || 0,
            youtubeUrl: fd.get('youtubeUrl'),
            prerequisiteExamId: fd.get('prerequisiteExamId') || null,
            minimumScore: Number(fd.get('minimumScore')) || 0,
          }),
        }),
      'تم حفظ وإضافة المحاضرة بنجاح'
    );

    if (ok) {
      form.reset();
      setIsAddOpen(false);
    }
  };

  const handleEditVideo = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingVideo) return;
    const form = e.currentTarget;
    const fd = new FormData(form);

    const ok = await mutate(
      () =>
        adminApiRequest(`/api/admin/videos/${editingVideo.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: fd.get('title'),
            status: fd.get('status'),
            prerequisiteExamId: fd.get('prerequisiteExamId') || null,
            minimumScore: Number(fd.get('minimumScore')) || 0,
          }),
        }),
      'تم تحديث بيانات المحاضرة بنجاح'
    );

    if (ok) {
      setEditingVideo(null);
    }
  };

  const handleDeleteVideo = (video: Video) => {
    openConfirm({
      title: `حذف محاضرة «${video.title}»`,
      message:
        'هل أنت متأكد من رغبتك في حذف هذه المحاضرة؟ سيتم حذف جميع أكواد الوصول المرتبطة بها.',
      confirmLabel: 'تأكيد حذف المحاضرة',
      isDestructive: true,
      onConfirm: async () => {
        await mutate(
          () => adminApiRequest(`/api/admin/videos/${video.id}`, { method: 'DELETE' }),
          'تم حذف المحاضرة بنجاح'
        );
      },
    });
  };

  return (
    <div className="admin-lectures-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="المحاضرات ومكتبة الفيديو"
        description="إدارة روابط المحاضرات غير المدرجة على YouTube، تحديد امتحانات المرور، وإنشاء أكواد المحاضرات الفردية."
        breadcrumbs={[{ label: 'المحاضرات' }]}
        badge={
          <span className="admin-header-pill">
            <PlaySquare size={14} /> {videos.length} محاضرة
          </span>
        }
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsAddOpen(true)}
          >
            <Upload size={16} /> إضافة محاضرة جديدة
          </button>
        }
      />

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث باسم المحاضرة أو الكورس..."
        resultCount={filteredVideos.length}
        onClearFilters={() => {
          setSearch('');
          setSelectedCourseId('');
          setStatusFilter('all');
        }}
        filters={
          <>
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="admin-select"
              aria-label="تصفية المحاضرات حسب الكورس"
            >
              <option value="">كل الكورسات</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.grade})
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="admin-select"
              aria-label="تصفية المحاضرات حسب الحالة"
            >
              <option value="all">كل الحالات</option>
              <option value="published">منشور</option>
              <option value="draft">مسودة</option>
            </select>
          </>
        }
      />

      {/* ── Video Catalog List ──────────────────────────────────────────────── */}
      {filteredVideos.length === 0 ? (
        <AdminEmptyState
          icon={PlaySquare}
          title="لا توجد محاضرات مطابقة"
          description={
            search || selectedCourseId || statusFilter !== 'all'
              ? 'جرّب تعديل معايير البحث والتصفية لعرض النتائج.'
              : 'لم يتم تسجيل أي محاضرة فيديو بعد. انقر على الزر أدناه لإضافة أول محاضرة.'
          }
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsAddOpen(true)}
            >
              <Upload size={16} /> إضافة محاضرة
            </button>
          }
        />
      ) : (
        <div className="admin-table-container">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>المحاضرة والكورس</th>
                <th>الحالة</th>
                <th>الامتحان الفاصل المشروط</th>
                <th>أكواد الدخول</th>
                <th className="text-end">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredVideos.map((video) => (
                <tr key={video.id}>
                  <td>
                    <div className="table-entity-cell">
                      <strong className="entity-primary-text">{video.title}</strong>
                      <span className="entity-secondary-text">
                        {video.courseTitle} · {video.sourceType === 'youtube' ? 'YouTube غير مدرج' : 'ملف خاص'}
                        {video.durationSeconds > 0 && ` · ${Math.round(video.durationSeconds / 60)} دقيقة`}
                      </span>
                    </div>
                  </td>
                  <td>
                    <AdminStatusBadge status={video.status} />
                  </td>
                  <td>
                    {video.prerequisiteExamTitle ? (
                      <span className="admin-prereq-badge">
                        اجتياز <strong>{video.prerequisiteExamTitle}</strong> بنسبة{' '}
                        <strong>{video.minimumScore}%</strong>
                      </span>
                    ) : (
                      <span className="text-muted">بدون امتحان فاصل</span>
                    )}
                  </td>
                  <td>
                    <LectureAccessCodeManager
                      videoId={video.id}
                      videoTitle={video.title}
                      history={accessCodes}
                      onGenerated={() => refreshData(1)}
                    />
                  </td>
                  <td className="text-end">
                    <div className="admin-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingVideo(video)}
                        title="تعديل بيانات المحاضرة والامتحان الفاصل"
                      >
                        <PencilLine size={15} /> تعديل
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-danger"
                        onClick={() => handleDeleteVideo(video)}
                        title="حذف المحاضرة"
                        aria-label={`حذف محاضرة ${video.title}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Video Modal ─────────────────────────────────────────────────── */}
      {isAddOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-video-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddOpen(false);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="add-video-title" className="admin-modal-title">
                إضافة محاضرة فيديو من YouTube
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

            <form className="admin-modal-form stack-form" onSubmit={handleAddVideo}>
              <label className="admin-field-label">
                <span>الكورس التابع له <span className="text-danger">*</span></span>
                <select
                  name="courseId"
                  required
                  defaultValue={selectedCourseId || ''}
                  className="admin-select"
                >
                  <option value="">اختر الكورس</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} — {c.grade}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-field-label">
                <span>عنوان المحاضرة <span className="text-danger">*</span></span>
                <input
                  name="title"
                  required
                  placeholder="مثال: المحاضرة الأولى — شرح Unit 1 Vocabulary & Grammar"
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>رابط الفيديو على YouTube <span className="text-danger">*</span></span>
                <input
                  name="youtubeUrl"
                  type="url"
                  dir="ltr"
                  placeholder="https://youtu.be/... أو https://www.youtube.com/watch?v=..."
                  required
                  className="admin-input"
                />
                <small className="admin-field-hint">
                  ارفع الفيديو على قناتك كـ «غير مدرج / Unlisted» ثم الصق الرابط هنا.
                </small>
              </label>

              <div className="admin-form-row">
                <label className="admin-field-label">
                  <span>امتحان فاصل مشروط قبل فتح المحاضرة</span>
                  <select name="prerequisiteExamId" defaultValue="" className="admin-select">
                    <option value="">بدون امتحان فاصل</option>
                    {exams
                      .filter((e) => e.status === 'published')
                      .map((exam) => (
                        <option key={exam.id} value={exam.id}>
                          {exam.title} ({exam.courseTitle || 'عام'})
                        </option>
                      ))}
                  </select>
                </label>

                <label className="admin-field-label">
                  <span>الحد الأدنى لدرجة النجاح (%)</span>
                  <input
                    name="minimumScore"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue="50"
                    className="admin-input"
                  />
                </label>
              </div>

              <label className="admin-field-label">
                <span>مدة الفيديو بالثواني (اختياري)</span>
                <input
                  name="durationSeconds"
                  type="number"
                  min="0"
                  defaultValue="0"
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
                  <Upload size={16} /> حفظ وإضافة المحاضرة
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Video Modal ────────────────────────────────────────────────── */}
      {editingVideo && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-video-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingVideo(null);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="edit-video-title" className="admin-modal-title">
                تعديل محاضرة «{editingVideo.title}»
              </h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setEditingVideo(null)}
                aria-label="إغلاق النافذة"
              >
                <X size={18} />
              </button>
            </header>

            <form className="admin-modal-form stack-form" onSubmit={handleEditVideo}>
              <label className="admin-field-label">
                <span>عنوان المحاضرة <span className="text-danger">*</span></span>
                <input
                  name="title"
                  defaultValue={editingVideo.title}
                  required
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>الحالة</span>
                <select
                  name="status"
                  defaultValue={editingVideo.status}
                  className="admin-select"
                >
                  <option value="published">منشور</option>
                  <option value="draft">مسودة</option>
                </select>
              </label>

              <div className="admin-form-row">
                <label className="admin-field-label">
                  <span>الامتحان الفاصل المشروط</span>
                  <select
                    name="prerequisiteExamId"
                    defaultValue={editingVideo.prerequisiteExamId || ''}
                    className="admin-select"
                  >
                    <option value="">بدون امتحان فاصل</option>
                    {exams
                      .filter(
                        (e) =>
                          e.status === 'published' &&
                          (!editingVideo.courseId || e.courseId === editingVideo.courseId)
                      )
                      .map((exam) => (
                        <option key={exam.id} value={exam.id}>
                          {exam.title}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="admin-field-label">
                  <span>نسبة الاجتياز المطلوبة (%)</span>
                  <input
                    name="minimumScore"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={editingVideo.minimumScore || 50}
                    className="admin-input"
                  />
                </label>
              </div>

              <footer className="admin-modal-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingVideo(null)}
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
