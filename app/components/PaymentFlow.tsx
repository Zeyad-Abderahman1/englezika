'use client';

import { useState } from 'react';
import { CreditCard, Loader2, ShieldCheck } from 'lucide-react';

export default function PaymentFlow({ courseId }: { courseId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const startCheckout = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/payments/fawaterak/checkout', {
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
      <CreditCard aria-hidden />
      <h2>الدفع الإلكتروني الآمن</h2>
      <p>
        هتنتقل لصفحة فواتيرك الآمنة لاختيار وسيلة الدفع المتاحة وإكمال العملية. لن يتم فتح الكورس
        إلا بعد وصول تأكيد الدفع من فواتيرك.
      </p>

      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className="btn btn-primary btn-large"
      >
        {loading ? (
          <>
            <Loader2 size={18} className="spin" aria-hidden /> جاري فتح بوابة الدفع...
          </>
        ) : (
          'ادفع الآن عبر فواتيرك'
        )}
      </button>

      <p className="form-hint">
        <ShieldCheck size={16} aria-hidden /> بيانات البطاقة أو المحفظة لا تمر عبر منصة إنجليزيكا.
      </p>

      {error && (
        <div className="error-toast" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
