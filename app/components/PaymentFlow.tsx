'use client';

import { useState } from 'react';
import { CreditCard, Gift, Loader2, ShieldCheck } from 'lucide-react';

export default function PaymentFlow({
  courseId,
  isFree = false,
}: {
  courseId: string;
  isFree?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const startCheckout = async () => {
    setLoading(true);
    setError('');

    try {
      if (isFree) {
        const response = await fetch('/api/enrollments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ courseId }),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(result.error || 'تعذر تفعيل الكورس المجاني');
        window.location.assign(`/learn/${encodeURIComponent(courseId)}`);
        return;
      }
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseId }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!response.ok || !result.checkoutUrl) {
        throw new Error(result.error || 'تعذر فتح بوابة الدفع');
      }
      window.location.assign(result.checkoutUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تحقق من الإنترنت وحاول مرة أخرى');
      setLoading(false);
    }
  };

  return (
    <div className="payment-card">
      {isFree ? <Gift aria-hidden /> : <CreditCard aria-hidden />}
      <h2>{isFree ? 'ابدأ الكورس مجاناً' : 'الدفع الإلكتروني الآمن'}</h2>
      <p>
        {isFree
          ? 'اضغط على الزر لتفعيل الكورس المجاني فوراً على حسابك والانتقال إلى المحتوى.'
          : 'هتنتقل لصفحة الدفع الآمنة لاختيار وسيلة الدفع المتاحة وإكمال العملية. لن يتم فتح الكورس إلا بعد وصول تأكيد الدفع من بوابة الدفع.'}
      </p>

      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className="btn btn-primary btn-large"
      >
        {loading ? (
          <>
            <Loader2 size={18} className="spin" aria-hidden /> جاري فتح صفحة الدفع...
          </>
        ) : isFree ? (
          'فعّل الكورس المجاني'
        ) : (
          'ادفع الآن'
        )}
      </button>

      <p className="form-hint">
        <ShieldCheck size={16} aria-hidden />{' '}
        {isFree
          ? 'لا توجد أي رسوم أو بيانات دفع مطلوبة.'
          : 'بيانات البطاقة أو المحفظة لا تمر عبر منصة إنجليزيكا.'}
      </p>

      {error && (
        <div className="error-toast" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
