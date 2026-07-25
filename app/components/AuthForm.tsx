"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye, EyeOff, Loader2, CheckCircle2, AlertCircle,
  User, Phone, School, MapPin, BookOpen, Mail, Lock, Users, Briefcase,
} from "lucide-react";

// ─── Static data ───────────────────────────────────────────────────────────────

const GOVERNORATES = [
  "القاهرة", "الجيزة", "الإسكندرية", "الدقهلية", "الشرقية", "المنوفية",
  "القليوبية", "الغربية", "كفر الشيخ", "دمياط", "الإسماعيلية", "بورسعيد",
  "السويس", "شمال سيناء", "جنوب سيناء", "البحيرة", "المنيا", "أسيوط",
  "سوهاج", "قنا", "الأقصر", "أسوان", "البحر الأحمر", "الفيوم", "بني سويف",
  "مطروح", "الوادي الجديد",
];

const GRADES = ["أولى ثانوي", "تانية ثانوي", "تالتة ثانوي"];

const SECTIONS_BY_GRADE: Record<string, string[]> = {
  "أولى ثانوي": ["علمي", "أدبي"],
  "تانية ثانوي": ["علمي علوم", "علمي رياضة", "أدبي"],
  "تالتة ثانوي": ["علمي علوم", "علمي رياضة", "أدبي"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PasswordInput({
  id, name, placeholder, value, onChange,
}: { id: string; name: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-input-wrap">
      <Lock className="auth-input-icon" size={16} />
      <input
        id={id} name={name} type={show ? "text" : "password"} autoComplete="current-password"
        placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} required
        className="auth-input"
      />
      <button type="button" className="auth-eye-btn" onClick={() => setShow((s) => !s)} tabIndex={-1} aria-label="إظهار/إخفاء كلمة السر">
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Field({
  icon: Icon, id, name, placeholder, type = "text", value, onChange, required = false,
}: {
  icon: React.ElementType; id: string; name: string; placeholder: string; type?: string;
  value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div className="auth-input-wrap">
      <Icon className="auth-input-icon" size={16} />
      <input
        id={id} name={name} type={type} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)} required={required} className="auth-input"
      />
    </div>
  );
}

function SelectField({
  icon: Icon, id, name, placeholder, options, value, onChange,
}: {
  icon: React.ElementType; id: string; name: string; placeholder: string;
  options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="auth-input-wrap">
      <Icon className="auth-input-icon" size={16} />
      <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} required className="auth-input auth-select">
        <option value="">{placeholder}</option>
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

// ─── Login Form ───────────────────────────────────────────────────────────────

function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setError(data.error || "خطأ في تسجيل الدخول"); return; }
      router.push("/account");
    } catch {
      setError("تعذر الاتصال. تحقق من الإنترنت.");
    } finally {
      setLoading(false);
    }
  };

  return (
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

      <div className="auth-fields-col">
        <label className="auth-label" htmlFor="login-email">البريد الإلكتروني</label>
        <Field icon={Mail} id="login-email" name="email" type="email" placeholder="example@mail.com" value={email} onChange={setEmail} required />

        <label className="auth-label" htmlFor="login-password">كلمة السر</label>
        <PasswordInput id="login-password" name="password" placeholder="كلمة السر" value={password} onChange={setPassword} />
      </div>

      <button type="submit" className="btn btn-primary btn-large auth-submit-btn" disabled={loading}>
        {loading ? <><Loader2 size={18} className="spin" /> جاري الدخول...</> : "تسجيل الدخول"}
      </button>
    </form>
  );
}

// ─── Register Form ────────────────────────────────────────────────────────────

function RegisterForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Fields
  const [firstName, setFirstName] = useState("");
  const [secondName, setSecondName] = useState("");
  const [thirdName, setThirdName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [fatherPhone, setFatherPhone] = useState("");
  const [motherPhone, setMotherPhone] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [parentJob, setParentJob] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [gender, setGender] = useState("");
  const [grade, setGrade] = useState("");
  const [section, setSection] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const sections = grade ? (SECTIONS_BY_GRADE[grade] ?? []) : [];

  // Reset section when grade changes
  const handleGradeChange = (v: string) => { setGrade(v); setSection(""); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setLoading(true);
    if (password !== passwordConfirm) {
      setError("كلمتا السر غير متطابقتين"); setLoading(false); return;
    }
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email, password, password_confirm: passwordConfirm,
          first_name: firstName, second_name: secondName,
          third_name: thirdName, last_name: lastName,
          phone, father_phone: fatherPhone, mother_phone: motherPhone,
          school_name: schoolName, parent_job: parentJob,
          governorate, gender, grade, section,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; ok?: boolean };
      if (!res.ok) { setError(data.error || "حدث خطأ في التسجيل"); return; }
      setSuccess(true);
      setTimeout(() => router.push("/account"), 1200);
    } catch {
      setError("تعذر الاتصال. تحقق من الإنترنت.");
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
        <p className="auth-form-sub">ادخل بياناتك بشكل صحيح وسيتم التواصل معاك خلال ساعات قليلة لتفعيل الحساب !</p>
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
          <label className="auth-label" htmlFor="reg-first-name">الاسم الأول <span className="auth-req">*</span></label>
          <Field icon={User} id="reg-first-name" name="first_name" placeholder="الاسم الأول" value={firstName} onChange={setFirstName} required />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-second-name">الاسم الثاني</label>
          <Field icon={User} id="reg-second-name" name="second_name" placeholder="الاسم الثاني" value={secondName} onChange={setSecondName} />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-third-name">الاسم الثالث</label>
          <Field icon={User} id="reg-third-name" name="third_name" placeholder="الاسم الثالث" value={thirdName} onChange={setThirdName} />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-last-name">الاسم الأخير <span className="auth-req">*</span></label>
          <Field icon={User} id="reg-last-name" name="last_name" placeholder="الاسم الأخير" value={lastName} onChange={setLastName} required />
        </div>
      </div>

      {/* Phone row */}
      <div className="auth-grid-2">
        <div className="auth-field-group auth-col-span-2">
          <label className="auth-label" htmlFor="reg-phone">رقم الهاتف <span className="auth-req">*</span></label>
          <Field icon={Phone} id="reg-phone" name="phone" type="tel" placeholder="01xxxxxxxxx" value={phone} onChange={setPhone} required />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-father-phone">رقم هاتف الأب <span className="auth-req">*</span></label>
          <Field icon={Phone} id="reg-father-phone" name="father_phone" type="tel" placeholder="01xxxxxxxxx" value={fatherPhone} onChange={setFatherPhone} required />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-mother-phone">رقم هاتف الأم <span className="auth-req">*</span></label>
          <Field icon={Phone} id="reg-mother-phone" name="mother_phone" type="tel" placeholder="01xxxxxxxxx" value={motherPhone} onChange={setMotherPhone} required />
        </div>
      </div>

      {/* School & Parent job */}
      <div className="auth-grid-2">
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-school">اسم المدرسة <span className="auth-req">*</span></label>
          <Field icon={School} id="reg-school" name="school_name" placeholder="اسم المدرسة" value={schoolName} onChange={setSchoolName} required />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-parent-job">مهنة ولي الأمر</label>
          <Field icon={Briefcase} id="reg-parent-job" name="parent_job" placeholder="مهنة ولي الأمر" value={parentJob} onChange={setParentJob} />
        </div>
      </div>

      {/* Selects */}
      <div className="auth-grid-1">
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-gov">المحافظة <span className="auth-req">*</span></label>
          <SelectField icon={MapPin} id="reg-gov" name="governorate" placeholder="السويس" options={GOVERNORATES} value={governorate} onChange={setGovernorate} />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-gender">النوع <span className="auth-req">*</span></label>
          <SelectField icon={Users} id="reg-gender" name="gender" placeholder="النوع" options={["ذكر", "أنثى"]} value={gender} onChange={setGender} />
        </div>
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-grade">الصف الدراسي <span className="auth-req">*</span></label>
          <SelectField icon={BookOpen} id="reg-grade" name="grade" placeholder="الصف" options={GRADES} value={grade} onChange={handleGradeChange} />
        </div>
        {sections.length > 0 && (
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="reg-section">الشعبة <span className="auth-req">*</span></label>
            <SelectField icon={BookOpen} id="reg-section" name="section" placeholder="اختر الشعبه" options={sections} value={section} onChange={setSection} />
          </div>
        )}
      </div>

      {/* Email & Password */}
      <div className="auth-grid-1">
        <div className="auth-field-group">
          <label className="auth-label" htmlFor="reg-email">البريد الإلكتروني <span className="auth-req">*</span></label>
          <Field icon={Mail} id="reg-email" name="email" type="email" placeholder="example@mail.com" value={email} onChange={setEmail} required />
        </div>
        <div className="auth-grid-2">
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="reg-password">كلمة السر <span className="auth-req">*</span></label>
            <PasswordInput id="reg-password" name="password" placeholder="كلمة السر (8 أحرف+)" value={password} onChange={setPassword} />
          </div>
          <div className="auth-field-group">
            <label className="auth-label" htmlFor="reg-password-confirm">تأكيد كلمة السر <span className="auth-req">*</span></label>
            <PasswordInput id="reg-password-confirm" name="password_confirm" placeholder="تأكيد كلمة السر" value={passwordConfirm} onChange={setPasswordConfirm} />
          </div>
        </div>
      </div>

      {/* Avatar hint */}
      <p className="auth-avatar-hint">صورة شخصية إن وجدت (اختياري — يمكن إضافتها لاحقاً من الملف الشخصي)</p>

      <button type="submit" className="btn btn-primary btn-large auth-submit-btn" disabled={loading}>
        {loading ? <><Loader2 size={18} className="spin" /> جاري التسجيل...</> : "رفع"}
      </button>
    </form>
  );
}

// ─── Exported Component ───────────────────────────────────────────────────────

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  return mode === "register" ? <RegisterForm /> : <LoginForm />;
}
