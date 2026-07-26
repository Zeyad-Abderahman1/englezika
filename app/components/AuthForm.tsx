'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User,
  Phone,
  School,
  MapPin,
  BookOpen,
  Mail,
  Lock,
  Users,
  Briefcase,
} from 'lucide-react';

// ─── Static data ───────────────────────────────────────────────────────────────

const GOVERNORATES = [
  'القاهرة',
  'الجيزة',
  'الإسكندرية',
  'الدقهلية',
  'الشرقية',
  'المنوفية',
  'القليوبية',
  'الغربية',
  'كفر الشيخ',
  'دمياط',
  'الإسماعيلية',
  'بورسعيد',
  'السويس',
  'شمال سيناء',
  'جنوب سيناء',
  'البحيرة',
  'المنيا',
  'أسيوط',
  'سوهاج',
  'قنا',
  'الأقصر',
  'أسوان',
  'البحر الأحمر',
  'الفيوم',
  'بني سويف',
  'مطروح',
  'الوادي الجديد',
];

const GRADES = ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];

const SECTIONS_BY_GRADE: Record<string, string[]> = {
  'أولى ثانوي': ['علمي', 'أدبي'],
  'تانية ثانوي': ['علمي علوم', 'علمي رياضة', 'أدبي'],
  'تالتة ثانوي': ['علمي علوم', 'علمي رياضة', 'أدبي'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PasswordInput({
  id,
  name,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  name: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-input-wrap">
      <Lock className="auth-input-icon" size={16} />
      <input
        id={id}
        name={name}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="auth-input"
      />
      <button
        type="button"
        className="auth-eye-btn"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label="إظهار/إخفاء كلمة السر"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Field({
  icon: Icon,
  id,
  name,
  placeholder,
  type = 'text',
  value,
  onChange,
  required = false,
}: {
  icon: React.ElementType;
  id: string;
  name: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div className="auth-input-wrap">
      <Icon className="auth-input-icon" size={16} />
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="auth-input"
      />
    </div>
  );
}

function SelectField({
  icon: Icon,
  id,
  name,
  placeholder,
  options,
  value,
  onChange,
}: {
  icon: React.ElementType;
  id: string;
  name: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="auth-input-wrap">
      <Icon className="auth-input-icon" size={16} />
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="auth-input auth-select"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Login Form ───────────────────────────────────────────────────────────────

// ─── Forgot Password Modal ───────────────────────────────────────────────────

function ForgotPasswordModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (email: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [testCode, setTestCode] = useState<string | null>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        testCode?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(data.error || 'تعذر إرسال كود التفعيل');
        return;
      }
      if (data.testCode) setTestCode(data.testCode);
      setStep(2);
    } catch {
      setError('تعذر الاتصال بالخادم. تحقق من الإنترنت.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== newPasswordConfirm) {
      setError('كلمتا السر غير متطابقتين');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code, new_password: newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        message?: string;
      };
      if (!res.ok) {
        setError(data.error || 'تعذر تحديث كلمة المرور');
        return;
      }
      onSuccess(email);
    } catch {
      setError('تعذر الاتصال بالخادم. تحقق من الإنترنت.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose} dir="rtl">
      <div
        className="admin-modal-card"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-header">
          <h3>إعادة ضبط كلمة المرور</h3>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && (
          <div className="auth-error-banner" style={{ margin: '12px 16px 0' }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {testCode && (
          <div
            style={{
              margin: '12px 16px 0',
              padding: 12,
              background: 'rgba(38,177,112,.15)',
              border: '1px solid rgba(64,203,140,.3)',
              borderRadius: 8,
              color: '#8ce7bd',
              fontSize: 13,
            }}
          >
            💡 كود التجربة المحلي: <strong>{testCode}</strong>
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleSendCode} style={{ padding: 16 }}>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
              أدخل البريد الإلكتروني المسجل في حسابك وسنرسل لك كود التفعيل المكون من 6 أرقام.
            </p>
            <div className="auth-field-group" style={{ marginBottom: 20 }}>
              <label className="auth-label" htmlFor="forgot-email">
                البريد الإلكتروني
              </label>
              <Field
                icon={Mail}
                id="forgot-email"
                name="email"
                type="email"
                placeholder="example@mail.com"
                value={email}
                onChange={setEmail}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                إلغاء
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={16} className="spin" /> جاري الإرسال...
                  </>
                ) : (
                  'إرسال كود التفعيل'
                )}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} style={{ padding: 16 }}>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
              أدخل كود التفعيل المكون من 6 أرقام الذي وصلك على البريد <strong>{email}</strong> وكلمة
              المرور الجديدة.
            </p>
            <div className="auth-field-group" style={{ marginBottom: 12 }}>
              <label className="auth-label" htmlFor="reset-code">
                كود التفعيل (6 أرقام)
              </label>
              <Field
                icon={Mail}
                id="reset-code"
                name="code"
                type="text"
                placeholder="123456"
                value={code}
                onChange={setCode}
                required
              />
            </div>
            <div className="auth-field-group" style={{ marginBottom: 12 }}>
              <label className="auth-label" htmlFor="reset-new-pass">
                كلمة المرور الجديدة
              </label>
              <PasswordInput
                id="reset-new-pass"
                name="new_password"
                placeholder="8 أحرف على الأقل"
                value={newPassword}
                onChange={setNewPassword}
              />
            </div>
            <div className="auth-field-group" style={{ marginBottom: 20 }}>
              <label className="auth-label" htmlFor="reset-confirm-pass">
                تأكيد كلمة المرور الجديدة
              </label>
              <PasswordInput
                id="reset-confirm-pass"
                name="new_password_confirm"
                placeholder="إعادة كتابة كلمة المرور"
                value={newPasswordConfirm}
                onChange={setNewPasswordConfirm}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
                رجوع
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={16} className="spin" /> جاري التحديث...
                  </>
                ) : (
                  'تحديث كلمة المرور'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Login Form ───────────────────────────────────────────────────────────────

function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || 'خطأ في تسجيل الدخول');
        return;
      }
      router.push('/account');
    } catch {
      setError('تعذر الاتصال. تحقق من الإنترنت.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSuccess = (userEmail: string) => {
    setShowForgotModal(false);
    setEmail(userEmail);
    setSuccessMsg('تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول.');
  };

  return (
    <>
      <form className="auth-native-form" onSubmit={handleSubmit} dir="rtl">
        <div className="auth-form-header">
          <h2 className="auth-form-title">تسجيل الدخول</h2>
          <p className="auth-form-sub">أدخل بياناتك للوصول لحسابك</p>
          <Link href="/register" className="auth-switch-link">
            مش عندك حساب؟ <span>سجّل الآن</span>
          </Link>
        </div>

        {error && (
          <div className="auth-error-banner">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {successMsg && (
          <div
            className="auth-error-banner"
            style={{
              background: 'rgba(38,177,112,.15)',
              borderColor: 'rgba(64,203,140,.3)',
              color: '#8ce7bd',
            }}
          >
            <CheckCircle2 size={16} /> {successMsg}
          </div>
        )}

        <div className="auth-fields-col">
          <label className="auth-label" htmlFor="login-email">
            البريد الإلكتروني
          </label>
          <Field
            icon={Mail}
            id="login-email"
            name="email"
            type="email"
            placeholder="example@mail.com"
            value={email}
            onChange={setEmail}
            required
          />

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 4,
            }}
          >
            <label className="auth-label" htmlFor="login-password">
              كلمة السر
            </label>
            <button
              type="button"
              onClick={() => setShowForgotModal(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--red-bright)',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 700,
                padding: 0,
              }}
            >
              نسيت كلمة المرور؟
            </button>
          </div>
          <PasswordInput
            id="login-password"
            name="password"
            placeholder="كلمة السر"
            value={password}
            onChange={setPassword}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-large auth-submit-btn"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="spin" /> جاري الدخول...
            </>
          ) : (
            'تسجيل الدخول'
          )}
        </button>

        <div className="staff-portal-banner">
          هل أنت مدرس أو مساعد في الفريق؟{' '}
          <Link href="/staff/login">اضغط هنا لدخول لوحة الإدارة</Link>
        </div>
      </form>

      {showForgotModal && (
        <ForgotPasswordModal
          onClose={() => setShowForgotModal(false)}
          onSuccess={handleResetSuccess}
        />
      )}
    </>
  );
}

// ─── Register Form ────────────────────────────────────────────────────────────

function RegisterForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Fields
  const [firstName, setFirstName] = useState('');
  const [secondName, setSecondName] = useState('');
  const [thirdName, setThirdName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [fatherPhone, setFatherPhone] = useState('');
  const [motherPhone, setMotherPhone] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [parentJob, setParentJob] = useState('');
  const [governorate, setGovernorate] = useState('');
  const [gender, setGender] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  // Inline validation errors (shown after the field is touched)
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const fieldErrors = {
    firstName: firstName.trim().length < 2 ? 'الاسم الأول يجب أن يكون حرفين على الأقل' : '',
    lastName: lastName.trim().length < 2 ? 'الاسم الأخير يجب أن يكون حرفين على الأقل' : '',
    email: !EMAIL_RE.test(email) ? 'أدخل بريداً إلكترونياً صحيحاً' : '',
    password:
      password.length < 8
        ? 'كلمة السر 8 أحرف على الأقل'
        : !/[A-Z]/.test(password)
          ? 'يجب أن تحتوي على حرف كبير'
          : !/\d/.test(password)
            ? 'يجب أن تحتوي على رقم'
            : '',
    passwordConfirm: password !== passwordConfirm ? 'كلمتا السر غير متطابقتين' : '',
  };

  const isFormValid = Object.values(fieldErrors).every((e) => e === '');

  const sections = grade ? (SECTIONS_BY_GRADE[grade] ?? []) : [];

  // Reset section when grade changes
  const handleGradeChange = (v: string) => {
    setGrade(v);
    setSection('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Mark all validated fields as touched so errors appear
    setTouched({
      firstName: true,
      lastName: true,
      email: true,
      password: true,
      passwordConfirm: true,
    });
    if (!isFormValid) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          password_confirm: passwordConfirm,
          first_name: firstName,
          second_name: secondName,
          third_name: thirdName,
          last_name: lastName,
          phone,
          father_phone: fatherPhone,
          mother_phone: motherPhone,
          school_name: schoolName,
          parent_job: parentJob,
          governorate,
          gender,
          grade,
          section,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(data.error || 'حدث خطأ في التسجيل');
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/account'), 1200);
    } catch {
      setError('تعذر الاتصال. تحقق من الإنترنت.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="auth-success-state" dir="rtl">
        <CheckCircle2 size={48} className="auth-success-icon" />
        <h2>تم إنشاء الحساب بنجاح!</h2>
        <p>جاري تحويلك لتأكيد البريد الإلكتروني...</p>
      </div>
    );
  }

  return (
    <form className="auth-native-form auth-register-form" onSubmit={handleSubmit} dir="rtl">
      <div className="auth-form-header">
        <h2 className="auth-form-title">طلب إنشاء حساب :</h2>
        <p className="auth-form-sub">
          ادخل بياناتك بشكل صحيح وسيتم التواصل معاك خلال ساعات قليلة لتفعيل الحساب !
        </p>
        <Link href="/login" className="auth-switch-link">
          يوجد لديك حساب بالفعل؟ <span>ادخل إلى حسابك الآن !</span>
        </Link>
      </div>

      {error && (
        <div className="auth-error-banner">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Name row */}
      <div className="auth-grid-2">
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-first-name">
            الاسم الأول <span className="auth-req">*</span>
          </label>
          <Field
            icon={User}
            id="reg-first-name"
            name="first_name"
            placeholder="الاسم الأول"
            value={firstName}
            onChange={(v) => {
              setFirstName(v);
              touch('firstName');
            }}
            required
          />
          {touched.firstName && fieldErrors.firstName && (
            <span className="auth-field-error">{fieldErrors.firstName}</span>
          )}
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-second-name">
            الاسم الثاني
          </label>
          <Field
            icon={User}
            id="reg-second-name"
            name="second_name"
            placeholder="الاسم الثاني"
            value={secondName}
            onChange={setSecondName}
          />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-third-name">
            الاسم الثالث
          </label>
          <Field
            icon={User}
            id="reg-third-name"
            name="third_name"
            placeholder="الاسم الثالث"
            value={thirdName}
            onChange={setThirdName}
          />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-last-name">
            الاسم الأخير <span className="auth-req">*</span>
          </label>
          <Field
            icon={User}
            id="reg-last-name"
            name="last_name"
            placeholder="الاسم الأخير"
            value={lastName}
            onChange={(v) => {
              setLastName(v);
              touch('lastName');
            }}
            required
          />
          {touched.lastName && fieldErrors.lastName && (
            <span className="auth-field-error">{fieldErrors.lastName}</span>
          )}
        </div>
      </div>

      {/* Phone row */}
      <div className="auth-grid-2">
        <div className="auth-field-group auth-col-span-2">
          <label className="auth-label" htmlFor="reg-phone">
            رقم الهاتف <span className="auth-req">*</span>
          </label>
          <Field
            icon={Phone}
            id="reg-phone"
            name="phone"
            type="tel"
            placeholder="01xxxxxxxxx"
            value={phone}
            onChange={setPhone}
            required
          />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-father-phone">
            رقم هاتف الأب <span className="auth-req">*</span>
          </label>
          <Field
            icon={Phone}
            id="reg-father-phone"
            name="father_phone"
            type="tel"
            placeholder="01xxxxxxxxx"
            value={fatherPhone}
            onChange={setFatherPhone}
            required
          />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-mother-phone">
            رقم هاتف الأم <span className="auth-req">*</span>
          </label>
          <Field
            icon={Phone}
            id="reg-mother-phone"
            name="mother_phone"
            type="tel"
            placeholder="01xxxxxxxxx"
            value={motherPhone}
            onChange={setMotherPhone}
            required
          />
        </div>
      </div>

      {/* School & Parent job */}
      <div className="auth-grid-2">
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-school">
            اسم المدرسة <span className="auth-req">*</span>
          </label>
          <Field
            icon={School}
            id="reg-school"
            name="school_name"
            placeholder="اسم المدرسة"
            value={schoolName}
            onChange={setSchoolName}
            required
          />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-parent-job">
            مهنة ولي الأمر
          </label>
          <Field
            icon={Briefcase}
            id="reg-parent-job"
            name="parent_job"
            placeholder="مهنة ولي الأمر"
            value={parentJob}
            onChange={setParentJob}
          />
        </div>
      </div>

      {/* Selects */}
      <div className="auth-grid-1">
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-gov">
            المحافظة <span className="auth-req">*</span>
          </label>
          <SelectField
            icon={MapPin}
            id="reg-gov"
            name="governorate"
            placeholder="السويس"
            options={GOVERNORATES}
            value={governorate}
            onChange={setGovernorate}
          />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-gender">
            النوع <span className="auth-req">*</span>
          </label>
          <SelectField
            icon={Users}
            id="reg-gender"
            name="gender"
            placeholder="النوع"
            options={['ذكر', 'أنثى']}
            value={gender}
            onChange={setGender}
          />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-grade">
            الصف الدراسي <span className="auth-req">*</span>
          </label>
          <SelectField
            icon={BookOpen}
            id="reg-grade"
            name="grade"
            placeholder="الصف"
            options={GRADES}
            value={grade}
            onChange={handleGradeChange}
          />
        </div>
        {sections.length > 0 && (
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="reg-section">
              الشعبة <span className="auth-req">*</span>
            </label>
            <SelectField
              icon={BookOpen}
              id="reg-section"
              name="section"
              placeholder="اختر الشعبه"
              options={sections}
              value={section}
              onChange={setSection}
            />
          </div>
        )}
      </div>

      {/* Email & Password */}
      <div className="auth-grid-1">
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-email">
            البريد الإلكتروني <span className="auth-req">*</span>
          </label>
          <Field
            icon={Mail}
            id="reg-email"
            name="email"
            type="email"
            placeholder="example@mail.com"
            value={email}
            onChange={setEmail}
            required
          />
        </div>
        <div className="auth-grid-2">
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="reg-email">
              البريد الإلكتروني <span className="auth-req">*</span>
            </label>
            <Field
              icon={Mail}
              id="reg-email"
              name="email"
              type="email"
              placeholder="example@mail.com"
              value={email}
              onChange={(v) => {
                setEmail(v);
                touch('email');
              }}
              required
            />
            {touched.email && fieldErrors.email && (
              <span className="auth-field-error">{fieldErrors.email}</span>
            )}
          </div>
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="reg-password">
              كلمة السر <span className="auth-req">*</span>
            </label>
            <PasswordInput
              id="reg-password"
              name="password"
              placeholder="كلمة السر (8 أحرف+)"
              value={password}
              onChange={(v) => {
                setPassword(v);
                touch('password');
              }}
            />
            {touched.password && fieldErrors.password && (
              <span className="auth-field-error">{fieldErrors.password}</span>
            )}
          </div>
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="reg-password-confirm">
              تأكيد كلمة السر <span className="auth-req">*</span>
            </label>
            <PasswordInput
              id="reg-password-confirm"
              name="password_confirm"
              placeholder="تأكيد كلمة السر"
              value={passwordConfirm}
              onChange={(v) => {
                setPasswordConfirm(v);
                touch('passwordConfirm');
              }}
            />
            {touched.passwordConfirm && fieldErrors.passwordConfirm && (
              <span className="auth-field-error">{fieldErrors.passwordConfirm}</span>
            )}
          </div>
        </div>
      </div>

      {/* Avatar hint */}
      <p className="auth-avatar-hint">
        صورة شخصية إن وجدت (اختياري — يمكن إضافتها لاحقاً من الملف الشخصي)
      </p>

      <button
        type="submit"
        className="btn btn-primary btn-large auth-submit-btn"
        disabled={loading || !isFormValid}
      >
        {loading ? (
          <>
            <Loader2 size={18} className="spin" /> جاري التسجيل...
          </>
        ) : (
          'رفع'
        )}
      </button>
      <p style={{ textAlign: 'center', fontSize: '0.8rem', opacity: 0.6, marginTop: '0.75rem' }}>
        بالتسجيل، أنت توافق على{' '}
        <a href="/privacy-policy" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
          سياسة الخصوصية
        </a>
      </p>
    </form>
  );
}

// ─── Exported Component ───────────────────────────────────────────────────────

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  return mode === 'register' ? <RegisterForm /> : <LoginForm />;
}
