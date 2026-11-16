'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  LoaderCircle,
  LogIn,
  Play,
  QrCode,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';

type VideoInfo = {
  id: string;
  title: string;
  description: string | null;
  courseId: string;
  courseTitle: string;
  stage: string | null;
};

type QRInfoResponse = {
  ok: boolean;
  isRedeemed?: boolean;
  alreadyHasAccess?: boolean;
  error?: string;
  message?: string;
  videoTitle?: string;
  courseTitle?: string;
  video?: VideoInfo;
  student?: {
    email: string;
    name: string;
  } | null;
};

type RedeemedLecture = {
  videoId: string;
  videoTitle: string;
  courseId: string;
  courseTitle: string;
  watchUrl: string;
};

const PENDING_QR_STORAGE_KEY = 'englizeka_pending_qr_token';
const QR_TOKEN_REGEX = /^eqr_[A-Za-z0-9_-]{24,80}$/;

export function extractLectureQRToken(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw) return null;

  try {
    raw = decodeURIComponent(raw).trim();
  } catch {}

  // 1. Direct valid token
  if (QR_TOKEN_REGEX.test(raw)) return raw;

  // 2. Hash fragment or percent-encoded fragment (#eqr_... or %23eqr_...)
  const hashMatch = raw.match(/(?:#|%23)(?:token=|code=)?(eqr_[A-Za-z0-9_-]{24,80})/i);
  if (hashMatch && QR_TOKEN_REGEX.test(hashMatch[1])) {
    return hashMatch[1];
  }

  // 3. Query parameter (?token=eqr_... or &token=eqr_... or code=...)
  const queryMatch = raw.match(/[?&](?:token|code)=(eqr_[A-Za-z0-9_-]{24,80})/i);
  if (queryMatch && QR_TOKEN_REGEX.test(queryMatch[1])) {
    return queryMatch[1];
  }

  // 4. Path-based (/redeem/eqr_...)
  const pathMatch = raw.match(/\/redeem\/(eqr_[A-Za-z0-9_-]{24,80})/i);
  if (pathMatch && QR_TOKEN_REGEX.test(pathMatch[1])) {
    return pathMatch[1];
  }

  // 5. Embedded token pattern inside input
  const embeddedMatch = raw.match(/\b(eqr_[A-Za-z0-9_-]{24,80})\b/i);
  if (embeddedMatch && QR_TOKEN_REGEX.test(embeddedMatch[1])) {
    return embeddedMatch[1];
  }

  return null;
}

function RedeemContent() {
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);
  const [info, setInfo] = useState<QRInfoResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [redeemedLecture, setRedeemedLecture] = useState<RedeemedLecture | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState('');

  // 1. Initial capture from hash, path, query, or sessionStorage
  useEffect(() => {
    let capturedToken = '';

    if (typeof window !== 'undefined') {
      const rawHash = window.location.hash || '';
      const rawPath = window.location.pathname || '';
      const rawHref = window.location.href || '';
      const rawSearch = window.location.search || '';

      // 1. Try window.location.hash
      if (rawHash) {
        capturedToken = extractLectureQRToken(rawHash) || '';
      }

      // 2. Try window.location.pathname / href (handles %23eqr_ or /redeem/eqr_ from mobile scanners)
      if (!capturedToken) {
        if (rawPath.includes('%23') || rawPath.includes('#') || rawPath.includes('eqr_')) {
          capturedToken = extractLectureQRToken(rawPath) || '';
        }
        if (!capturedToken && (rawHref.includes('%23') || rawHref.includes('eqr_'))) {
          capturedToken = extractLectureQRToken(rawHref) || '';
        }
      }

      // 3. Fallback to query parameters
      if (!capturedToken && rawSearch) {
        capturedToken = extractLectureQRToken(rawSearch) || '';
      }

      // 4. Check sessionStorage if hash/query is empty (e.g. returning from login / register)
      if (!capturedToken) {
        try {
          const stored = sessionStorage.getItem(PENDING_QR_STORAGE_KEY);
          if (stored) capturedToken = extractLectureQRToken(stored) || '';
        } catch {}
      }

      if (capturedToken) {
        try {
          sessionStorage.setItem(PENDING_QR_STORAGE_KEY, capturedToken);
        } catch {}

        // Immediately sanitize visible browser URL to /redeem
        if (window.location.hash || window.location.search || window.location.pathname !== '/redeem') {
          window.history.replaceState(null, '', '/redeem');
        }

        setToken(capturedToken);
      } else {
        // If there was an attempted token in URL but it was invalid
        const hadAttempt =
          (rawHash && rawHash !== '#') ||
          (rawSearch && (rawSearch.includes('token') || rawSearch.includes('code'))) ||
          rawPath.includes('%23') ||
          rawPath.includes('eqr_');

        if (hadAttempt) {
          try {
            sessionStorage.removeItem(PENDING_QR_STORAGE_KEY);
          } catch {}
          window.history.replaceState(null, '', '/redeem');
          setErrorMessage('صيغة رمز QR غير صحيحة أو تالفة.');
        }
        setToken('');
        setLoading(false);
      }
    }
  }, []);

  // 2. Fetch lecture QR info via secure POST body (no query string token exposure)
  useEffect(() => {
    if (!token) return;

    let isMounted = true;
    async function fetchQRInfo() {
      setLoading(true);
      setErrorMessage('');
      try {
        const res = await fetch('/api/student/qr/info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => ({}))) as QRInfoResponse;
        if (!isMounted) return;

        if (!res.ok && !data.isRedeemed) {
          setErrorMessage(data.message || 'رمز QR غير صالح أو غير موجود.');
          try {
            sessionStorage.removeItem(PENDING_QR_STORAGE_KEY);
          } catch {}
        }
        if (data.isRedeemed) {
          try {
            sessionStorage.removeItem(PENDING_QR_STORAGE_KEY);
          } catch {}
        }
        setInfo(data);
      } catch {
        if (isMounted) {
          setErrorMessage('تعذر الاتصال بالخادم. يرجى التأكد من اتصالك بالإنترنت والمحاولة مجددًا.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void fetchQRInfo();

    return () => {
      isMounted = false;
    };
  }, [token]);

  // 3. Handle single-use redemption via secure POST body
  const handleRedeem = async () => {
    if (!token || redeeming) return;
    setRedeeming(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/student/qr/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        lecture?: RedeemedLecture;
        error?: string;
      };

      if (!res.ok || !data.lecture) {
        throw new Error(data.error || 'تعذر تفعيل رمز QR. قد يكون تم استخدامه مسبقًا.');
      }

      // Immediately delete the pending token from storage upon successful redemption
      try {
        sessionStorage.removeItem(PENDING_QR_STORAGE_KEY);
      } catch {}

      setRedeemedLecture(data.lecture);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'حدث خطأ أثناء تفعيل رمز QR.');
    } finally {
      setRedeeming(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError('');
    const trimmed = manualInput.trim();
    if (!trimmed) {
      setManualError('يرجى إدخال رمز المحاضرة أو رابط التفعيل.');
      return;
    }

    const extracted = extractLectureQRToken(trimmed);
    if (!extracted) {
      setManualError('رمز QR غير صالح. يجب أن يبدأ الرمز بـ eqr_ (مثال: eqr_ABC123...).');
      return;
    }

    try {
      sessionStorage.setItem(PENDING_QR_STORAGE_KEY, extracted);
    } catch {}

    window.history.replaceState(null, '', '/redeem');
    setErrorMessage('');
    setInfo(null);
    setToken(extracted);
  };

  // State 1: No token provided
  if (!token && !loading) {
    return (
      <div className="auth-card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center', padding: '32px 24px' }} dir="rtl">
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#3b82f6' }}>
          <QrCode size={32} />
        </div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '10px' }}>تفعيل المحاضرة عبر رمز QR</h2>
        <p style={{ color: 'var(--muted, #94a3b8)', lineHeight: 1.6, marginBottom: '20px' }}>
          امسح رمز QR المطبوع على كارت المحاضرة باستخدام كاميرا هاتفك المحمول ليتم فتح المحاضرة مباشرة على حسابك.
        </p>

        <div style={{ margin: '24px 0', borderTop: '1px solid var(--border-color, rgba(255,255,255,0.1))', paddingTop: '20px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>أو أدخل رمز الكارت يدويًا</h3>
          <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.85rem', marginBottom: '16px' }}>
            إذا تعذر على كاميرا الهاتف قراءة الرمز تلقائيًا، يمكنك إدخال الرمز أو لصق الرابط هنا:
          </p>

          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'right' }}>
            <input
              type="text"
              value={manualInput}
              onChange={(e) => {
                setManualInput(e.target.value);
                if (manualError) setManualError('');
              }}
              placeholder="مثال: eqr_..."
              dir="ltr"
              className="input"
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '8px',
                fontSize: '0.95rem',
                border: manualError ? '1px solid #ef4444' : undefined,
              }}
            />
            {manualError && (
              <div style={{ color: '#ef4444', fontSize: '0.85rem', textAlign: 'right' }}>
                {manualError}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontWeight: 700 }}
            >
              تفعيل المحاضرة
            </button>
          </form>
        </div>

        <div style={{ marginTop: '16px' }}>
          <Link href="/account" className="btn btn-outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            الذهاب إلى لوحة التحكم <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  // State 2: Loading state
  if (loading) {
    return (
      <div className="auth-card" style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: '40px 24px' }} dir="rtl">
        <LoaderCircle size={40} className="spin" style={{ color: 'var(--accent, #3b82f6)', margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px' }}>جاري التحقق من رمز QR...</h3>
        <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.9rem' }}>لحظات قليلة لتجهيز بيانات المحاضرة</p>
      </div>
    );
  }

  // State 3: Success state after redemption
  if (redeemedLecture) {
    return (
      <div className="auth-card" style={{ maxWidth: 540, margin: '40px auto', textAlign: 'center', padding: '36px 24px' }} dir="rtl">
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#10b981' }}>
          <CheckCircle2 size={40} />
        </div>

        <span className="status-pill status-approved" style={{ fontSize: '0.85rem', marginBottom: '12px', display: 'inline-block' }}>
          تم التفعيل بنجاح!
        </span>

        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '10px' }}>
          تهانينا! فُتحت المحاضرة لك
        </h2>

        <div style={{ background: 'var(--surface-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', borderRadius: '12px', padding: '16px', margin: '20px 0', textAlign: 'right' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted, #94a3b8)', marginBottom: '4px' }}>
            {redeemedLecture.courseTitle}
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
            {redeemedLecture.videoTitle}
          </div>
        </div>

        <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.6 }}>
          أصبح بإمكانك الآن مشاهدة هذه المحاضرة في أي وقت من خلال حسابك التعليمي في إنجليزيكا.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link
            href={`/learn/${redeemedLecture.courseId}?video=${encodeURIComponent(redeemedLecture.videoId)}`}
            className="btn btn-primary btn-large"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700, fontSize: '1rem', padding: '12px 24px' }}
          >
            <Play size={18} /> بدء مشاهدة المحاضرة الآن
          </Link>
          <Link
            href="/account"
            className="btn btn-outline"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            الانتقال إلى لوحة التحكم
          </Link>
        </div>
      </div>
    );
  }

  // State 4: QR Code Already Used
  if (info?.isRedeemed) {
    return (
      <div className="auth-card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center', padding: '32px 24px' }} dir="rtl">
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(245, 158, 11, 0.12)', border: '2px solid #f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#f59e0b' }}>
          <AlertTriangle size={32} />
        </div>

        <h2 style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '10px' }}>
          رمز QR تم استخدامه من قبل
        </h2>

        {info.videoTitle && (
          <div style={{ background: 'var(--surface-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', borderRadius: '10px', padding: '12px 16px', margin: '16px 0', textAlign: 'right' }}>
            <small style={{ color: 'var(--muted, #94a3b8)', display: 'block' }}>محاضرة:</small>
            <strong style={{ fontSize: '1.05rem' }}>{info.videoTitle}</strong>
            {info.courseTitle && <div style={{ fontSize: '0.82rem', color: 'var(--muted, #94a3b8)', marginTop: '2px' }}>{info.courseTitle}</div>}
          </div>
        )}

        <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '24px' }}>
          تم تفعيل رمز QR هذا مسبقًا. كل رمز مخصص للاستخدام مرة واحدة فقط لطالب واحد.
          إذا كنت قد قمت بتفعيله بالفعل، يمكنك تسجيل الدخول ومشاهدة المحاضرة من حسابك.
        </p>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/login" className="btn btn-primary">
            تسجيل الدخول
          </Link>
          <Link href="/courses" className="btn btn-outline">
            تصفح الكورسات
          </Link>
        </div>
      </div>
    );
  }

  // State 5: General Error (Invalid token / Not found)
  if (errorMessage || !info?.ok || !info.video) {
    return (
      <div className="auth-card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center', padding: '32px 24px' }} dir="rtl">
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.12)', border: '2px solid #ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#ef4444' }}>
          <AlertCircle size={32} />
        </div>

        <h2 style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '10px' }}>
          رمز QR غير صالح
        </h2>

        <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: '24px' }}>
          {errorMessage || info?.message || 'لم نتمكن من العثور على محاضرة مرتبطة برمز QR هذا. تأكد من مسح الرمز المعتمد من منصة إنجليزيكا.'}
        </p>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              setErrorMessage('');
              setInfo(null);
              setToken('');
              setManualError('');
              setManualInput('');
              try {
                sessionStorage.removeItem(PENDING_QR_STORAGE_KEY);
              } catch {}
              window.history.replaceState(null, '', '/redeem');
            }}
            className="btn btn-outline"
          >
            إدخال الرمز يدويًا
          </button>
          <Link href="/" className="btn btn-primary">
            العودة للصفحة الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  const { video, student, alreadyHasAccess } = info;

  // State 6: Student is NOT logged in
  if (!student) {
    return (
      <div className="auth-card" style={{ maxWidth: 540, margin: '40px auto', textAlign: 'center', padding: '36px 24px' }} dir="rtl">
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(59, 130, 246, 0.12)', border: '2px solid #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#3b82f6' }}>
          <BookOpen size={30} />
        </div>

        <span className="status-pill status-approved" style={{ fontSize: '0.82rem', marginBottom: '8px', display: 'inline-block' }}>
          رمز QR جاهز للتفعيل
        </span>

        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '6px' }}>
          أنت على وشك فتح محاضرة:
        </h2>

        {/* Lecture Details Preview Card */}
        <div style={{ background: 'var(--surface-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', borderRadius: '12px', padding: '16px 20px', margin: '16px 0', textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>
              {video.courseTitle}
            </span>
            {video.stage && (
              <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '4px' }}>
                {video.stage}
              </span>
            )}
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
            {video.title}
          </div>
          {video.description && (
            <p style={{ fontSize: '0.85rem', color: 'var(--muted, #94a3b8)', marginTop: '8px', lineHeight: 1.5 }}>
              {video.description}
            </p>
          )}
        </div>

        <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '24px' }}>
          لتفعيل هذه المحاضرة وربطها بحسابك، يرجى تسجيل الدخول. إذا لم يكن لديك حساب، يمكنك إنشاء حساب جديد في دقيقة واحدة.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link
            href="/login?return_to=/redeem"
            className="btn btn-primary btn-large"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700 }}
          >
            <LogIn size={18} /> تسجيل الدخول لتفعيل المحاضرة
          </Link>
          <Link
            href="/register?return_to=/redeem"
            className="btn btn-outline"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            <UserPlus size={18} /> إنشاء حساب جديد
          </Link>
        </div>
      </div>
    );
  }

  // State 7: Student IS logged in & already has access
  if (alreadyHasAccess) {
    return (
      <div className="auth-card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center', padding: '36px 24px' }} dir="rtl">
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.12)', border: '2px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#10b981' }}>
          <ShieldCheck size={32} />
        </div>

        <h2 style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '8px' }}>
          أنت مشترك بالفعل في هذه المحاضرة!
        </h2>

        <div style={{ background: 'var(--surface-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', borderRadius: '10px', padding: '14px 18px', margin: '16px 0', textAlign: 'right' }}>
          <small style={{ color: 'var(--muted, #94a3b8)', display: 'block' }}>{video.courseTitle}</small>
          <strong style={{ fontSize: '1.1rem' }}>{video.title}</strong>
        </div>

        <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '24px' }}>
          هذه المحاضرة مفعّلة بالفعل على حسابك ({student.name}). لا حاجة لاستخدام رمز QR إضافي، يمكنك مشاهدتها مباشرة الآن!
        </p>

        <Link
          href={`/learn/${video.courseId}?video=${encodeURIComponent(video.id)}`}
          className="btn btn-primary btn-large"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 700 }}
        >
          <Play size={18} /> مشاهدة المحاضرة الآن
        </Link>
      </div>
    );
  }

  // State 8: Student IS logged in & ready to redeem (Confirmation Screen)
  return (
    <div className="auth-card" style={{ maxWidth: 540, margin: '40px auto', textAlign: 'center', padding: '36px 24px' }} dir="rtl">
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(59, 130, 246, 0.1)', padding: '6px 14px', borderRadius: '20px', color: '#60a5fa', fontSize: '0.85rem', marginBottom: '16px' }}>
        <GraduationCap size={16} /> أهلاً بك، {student.name}
      </div>

      <h2 style={{ fontSize: '1.45rem', fontWeight: 800, marginBottom: '8px' }}>
        تأكيد تفعيل المحاضرة
      </h2>

      <p style={{ color: 'var(--muted, #94a3b8)', fontSize: '0.9rem', marginBottom: '20px' }}>
        اضغط على الزر أدناه لتفعيل المحاضرة على حسابك التعليمي فورًا:
      </p>

      {/* Lecture Card */}
      <div style={{ background: 'var(--surface-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border-color, rgba(255,255,255,0.1))', borderRadius: '12px', padding: '18px 20px', margin: '0 0 24px', textAlign: 'right' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>
            {video.courseTitle}
          </span>
          {video.stage && (
            <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '4px' }}>
              {video.stage}
            </span>
          )}
        </div>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary, #fff)', marginBottom: '6px' }}>
          {video.title}
        </div>
        {video.description && (
          <p style={{ fontSize: '0.85rem', color: 'var(--muted, #94a3b8)', lineHeight: 1.5, margin: 0 }}>
            {video.description}
          </p>
        )}
      </div>

      {errorMessage && (
        <div className="auth-error-banner" style={{ marginBottom: '16px' }}>
          <AlertCircle size={16} /> {errorMessage}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleRedeem()}
        disabled={redeeming}
        className="btn btn-primary btn-large"
        style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '1.05rem', fontWeight: 700, padding: '14px 20px' }}
      >
        {redeeming ? (
          <>
            <LoaderCircle size={18} className="spin" /> جاري التفعيل...
          </>
        ) : (
          <>
            <Play size={18} /> تفعيل المحاضرة وفتحها الآن
          </>
        )}
      </button>

      <div style={{ marginTop: '16px', fontSize: '0.78rem', color: 'var(--muted, #94a3b8)' }}>
        سيتم ربط المحاضرة بحسابك المسجل ({student.email}) ولن يمكن استخدام رمز QR هذا مرة أخرى.
      </div>
    </div>
  );
}

export default function RedeemPage() {
  return (
    <main className="auth-page" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <Suspense fallback={
        <div className="auth-card" style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: '40px 24px' }}>
          <LoaderCircle size={40} className="spin" style={{ color: 'var(--accent, #3b82f6)', margin: '0 auto 16px' }} />
          <p>جاري تحميل الصفحة...</p>
        </div>
      }>
        <RedeemContent />
      </Suspense>
    </main>
  );
}
