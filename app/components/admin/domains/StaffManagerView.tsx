'use client';

/**
 * app/components/admin/domains/StaffManagerView.tsx
 *
 * Dedicated Staff Management domain page (/admin/staff):
 * - Teacher / Super Admin EXCLUSIVE
 * - Create Teacher or Assistant accounts with predefined presets and strong passwords
 * - Inspect staff accounts, active/suspended status, and assigned permissions
 * - Modify Assistant presets (grader, course_manager, enrollment_manager)
 * - Suspend / activate accounts
 * - Reset staff passwords (with immediate session revocation across all devices)
 * - Hard delete staff accounts with self-deletion protection
 */

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  CirclePlus,
  KeyRound,
  Trash2,
  Lock,
  Unlock,
  X,
  UserCheck,
} from 'lucide-react';
import { useAdmin, adminApiRequest, type StaffAccount } from '../../../lib/admin-context';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminStatusBadge } from '../shell/AdminStatusBadge';
import { AdminLoadingSkeleton } from '../shell/AdminLoadingSkeleton';

function presetFor(permissions: string[]): string {
  if (permissions.includes('manage_staff')) return 'full_access';
  if (permissions.includes('manage_courses')) return 'course_manager';
  if (permissions.includes('manage_enrollments')) return 'enrollment_manager';
  return 'grader';
}

function permissionLabel(permissions: string[]): string {
  const preset = presetFor(permissions);
  if (preset === 'course_manager') return 'مساعد كورسات وامتحانات وواجبات ومحاضرات';
  if (preset === 'enrollment_manager') return 'مساعد طلاب واشتراكات';
  return 'مساعد تصحيح ودرجات';
}

export function StaffManagerView() {
  const { admin, isTeacher, busy, mutate, openConfirm, openPrompt } = useAdmin();
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await adminApiRequest('/api/admin/staff', { cache: 'no-store' })) as {
        staff: StaffAccount[];
      };
      setStaff(res.staff || []);
    } catch (e) {
      console.error('Failed to load staff accounts:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isTeacher) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadStaff();
    }
  }, [isTeacher, loadStaff]);

  const handleCreateStaff = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));

    const ok = await mutate(
      () =>
        adminApiRequest('/api/admin/staff', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        }),
      'تم إنشاء حساب الفريق بنجاح'
    );

    if (ok) {
      form.reset();
      setIsAddOpen(false);
      await loadStaff();
    }
  };

  const handleToggleActive = async (account: StaffAccount) => {
    const nextActive = !account.active;
    let permissions: string[] = [];
    try {
      permissions = JSON.parse(account.permissions) as string[];
    } catch {
      permissions = [];
    }

    const ok = await mutate(
      () =>
        adminApiRequest(`/api/admin/staff/${encodeURIComponent(account.email)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            active: nextActive,
            role: account.role,
            preset: presetFor(permissions),
          }),
        }),
      nextActive ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب'
    );

    if (ok) await loadStaff();
  };

  const handleChangePreset = async (account: StaffAccount, newPreset: string) => {
    const ok = await mutate(
      () =>
        adminApiRequest(`/api/admin/staff/${encodeURIComponent(account.email)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            active: Boolean(account.active),
            role: 'assistant',
            preset: newPreset,
          }),
        }),
      'تم تحديث صلاحيات المساعد بنجاح'
    );

    if (ok) await loadStaff();
  };

  const handleResetPassword = (account: StaffAccount) => {
    let permissions: string[] = [];
    try {
      permissions = JSON.parse(account.permissions) as string[];
    } catch {
      permissions = [];
    }

    openPrompt({
      title: `تعيين كلمة مرور جديدة لـ «${account.name}»`,
      fields: [
        {
          name: 'password',
          label: 'كلمة المرور الجديدة (12 حرفًا على الأقل، تشمل حروف كبيرة وصغيرة وأرقام ورموز)',
          type: 'password',
          required: true,
        },
      ],
      onSubmit: async (values) => {
        if (!values.password || values.password.length < 12) {
          alert('يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل.');
          return;
        }

        const ok = await mutate(
          () =>
            adminApiRequest(`/api/admin/staff/${encodeURIComponent(account.email)}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                password: values.password.trim(),
                active: Boolean(account.active),
                role: account.role,
                preset: presetFor(permissions),
              }),
            }),
          'تم تغيير كلمة المرور وإنهاء جميع الجلسات النشطة للحساب'
        );

        if (ok) await loadStaff();
      },
    });
  };

  const handleDeleteStaff = (account: StaffAccount) => {
    if (account.email === admin?.email) {
      alert('لا يمكنك حذف حسابك الحالي.');
      return;
    }

    openConfirm({
      title: `حذف حساب «${account.name}»`,
      message: `هل أنت متأكد من حذف حساب ${account.email} نهائيًا؟ سيتم مسح الحساب وجميع جلسات الدخول على الفور.`,
      confirmLabel: 'تأكيد حذف الحساب',
      isDestructive: true,
      onConfirm: async () => {
        const ok = await mutate(
          () =>
            adminApiRequest(`/api/admin/staff/${encodeURIComponent(account.email)}`, {
              method: 'DELETE',
            }),
          'تم حذف حساب الفريق نهائيًا'
        );
        if (ok) await loadStaff();
      },
    });
  };

  return (
    <div className="admin-staff-view">
      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="إدارة حسابات الفريق وصلاحيات المساعدين"
        description="إنشاء حسابات المدرسين والمساعدين، تعيين حزم الصلاحيات، تعطيل الحسابات، وتغيير كلمات المرور."
        breadcrumbs={[{ label: 'حسابات الفريق' }]}
        badge={
          <span className="admin-header-pill pill-danger">
            <ShieldAlert size={14} /> خاص بالمعلم فقط
          </span>
        }
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsAddOpen(true)}
          >
            <CirclePlus size={16} /> إضافة عضو فريق جديد
          </button>
        }
      />

      {/* ── Security Notice Banner ──────────────────────────────────────────── */}
      <div className="admin-security-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>أمان وحماية الفريق</strong>
          <p>
            لا يمكن لأي مستخدم التسجيل كمدرس أو مساعد من الواجهة العامة. جميع الحسابات يتم إنشاؤها
            وإدارتها حصريًا من هذه الصفحة عبر حساب المعلم.
          </p>
        </div>
      </div>

      {/* ── Staff Table ─────────────────────────────────────────────────────── */}
      {loading ? (
        <AdminLoadingSkeleton type="table" rows={4} />
      ) : (
        <div className="admin-table-container">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>العضو والبريد</th>
                <th>الدور والصلاحيات</th>
                <th>حالة الحساب</th>
                <th>تغيير الصلاحية</th>
                <th className="text-end">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((account) => {
                let permissions: string[] = [];
                try {
                  permissions = JSON.parse(account.permissions) as string[];
                } catch {
                  permissions = [];
                }
                const isSelf = account.email === admin?.email;
                const isAccountTeacher = account.role === 'teacher';

                return (
                  <tr key={account.email}>
                    <td>
                      <div className="table-entity-cell">
                        <strong className="entity-primary-text">{account.name}</strong>
                        <span className="entity-secondary-text" dir="ltr">
                          {account.email} {isSelf && '(أنت)'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="staff-role-cell">
                        <span className={`staff-role-tag ${isAccountTeacher ? 'teacher' : 'assistant'}`}>
                          {isAccountTeacher ? 'مدرس — صلاحية كاملة' : permissionLabel(permissions)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <AdminStatusBadge
                        status={account.active ? 'active' : 'suspended'}
                        label={account.active ? 'نشط ومفعّل' : 'موقوف'}
                      />
                    </td>
                    <td>
                      {!isAccountTeacher ? (
                        <select
                          className="admin-select admin-select-sm"
                          value={presetFor(permissions)}
                          disabled={busy}
                          onChange={(e) => void handleChangePreset(account, e.target.value)}
                          aria-label={`تعديل صلاحيات ${account.name}`}
                        >
                          <option value="grader">التصحيح والدرجات فقط</option>
                          <option value="course_manager">الكورسات والامتحانات والواجبات والمحاضرات</option>
                          <option value="enrollment_manager">الطلاب والاشتراكات فقط</option>
                        </select>
                      ) : (
                        <span className="text-muted">صلاحيات كاملة مطلقة</span>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="admin-row-actions">
                        {!isSelf && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={busy}
                            onClick={() => void handleToggleActive(account)}
                            title={account.active ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                          >
                            {account.active ? (
                              <>
                                <Lock size={14} /> تعطيل
                              </>
                            ) : (
                              <>
                                <Unlock size={14} /> تفعيل
                              </>
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => handleResetPassword(account)}
                          title="تعيين كلمة مرور جديدة وإنهاء الجلسات القديمة"
                        >
                          <KeyRound size={14} /> تغيير كلمة المرور
                        </button>

                        {!isSelf && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon text-danger"
                            disabled={busy}
                            onClick={() => handleDeleteStaff(account)}
                            title="حذف الحساب نهائيًا"
                            aria-label={`حذف حساب ${account.name}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create Staff Account Modal ───────────────────────────────────────── */}
      {isAddOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-staff-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddOpen(false);
          }}
        >
          <div className="admin-modal-card">
            <header className="admin-modal-header">
              <h3 id="add-staff-title" className="admin-modal-title">
                إنشاء حساب فريق جديد
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

            <form className="admin-modal-form stack-form" onSubmit={handleCreateStaff}>
              <label className="admin-field-label">
                <span>الاسم بالكامل <span className="text-danger">*</span></span>
                <input
                  name="name"
                  required
                  minLength={2}
                  placeholder="مثال: أ/ محمد محمود (مساعد التصحيح)"
                  className="admin-input"
                />
              </label>

              <label className="admin-field-label">
                <span>البريد الإلكتروني لتسجيل الدخول <span className="text-danger">*</span></span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="staff@englizeka.com"
                  className="admin-input"
                  dir="ltr"
                />
              </label>

              <label className="admin-field-label">
                <span>كلمة المرور المؤقتة <span className="text-danger">*</span></span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  placeholder="12 حرفًا على الأقل تشمل أرقام ورموز وحروف كبيرة"
                  className="admin-input"
                  dir="ltr"
                />
                <small className="admin-field-hint">
                  يجب أن تكون كلمة المرور قوية لحماية لوحة الإدارة.
                </small>
              </label>

              <div className="admin-form-row">
                <label className="admin-field-label">
                  <span>نوع الحساب <span className="text-danger">*</span></span>
                  <select name="role" defaultValue="assistant" className="admin-select">
                    <option value="assistant">مساعد (صلاحيات مخصصة)</option>
                    <option value="teacher">مدرس (صلاحية كاملة مطلقة)</option>
                  </select>
                </label>

                <label className="admin-field-label">
                  <span>حزمة صلاحيات المساعد</span>
                  <select name="preset" defaultValue="grader" className="admin-select">
                    <option value="grader">التصحيح والدرجات فقط</option>
                    <option value="course_manager">الكورسات والامتحانات والواجبات والمحاضرات</option>
                    <option value="enrollment_manager">الطلاب والاشتراكات فقط</option>
                  </select>
                </label>
              </div>

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
                  <UserCheck size={16} /> إنشاء الحساب
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
