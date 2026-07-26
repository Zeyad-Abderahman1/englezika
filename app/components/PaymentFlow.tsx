'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Banknote, CheckCircle2, CreditCard, Smartphone } from 'lucide-react';

const methods = [
  { name: 'فوري', icon: Banknote },
  { name: 'فودافون كاش', icon: Smartphone },
  { name: 'إنستاباي', icon: Smartphone },
  { name: 'بطاقة بنكية', icon: CreditCard },
];

export default function PaymentFlow({ courseId }: { courseId: string }) {
  const [selected, setSelected] = useState('فوري');
  const [reference, setReference] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (done)
    return (
      <div className="payment-success">
        <CheckCircle2 />
        <h2>طلبك وصل يا بطل!</h2>
        <p>
          الإدارة هتراجع بيانات الدفع وتفعّل الكورس على حسابك. تقدر تتابع الحالة من مساحتك
          التعليمية.
        </p>
        <Link href="/account" className="btn btn-primary">
          افتح حسابي
        </Link>
      </div>
    );
  return (
    <div className="payment-card">
      <h2>اختر طريقة الدفع</h2>
      <div className="payment-methods">
        {methods.map(({ name, icon: Icon }) => (
          <button
            type="button"
            key={name}
            className={selected === name ? 'active' : ''}
            onClick={() => setSelected(name)}
          >
            <Icon />
            <span>{name}</span>
          </button>
        ))}
      </div>
      <label>
        رقم العملية أو التحويل
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="اكتب الرقم المرجعي إن وجد"
        />
      </label>
      <button
        onClick={async () => {
          setLoading(true);
          setError('');
          const response = await fetch('/api/enrollments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              courseId,
              paymentMethod: selected,
              paymentReference: reference,
            }),
          });
          const result = (await response.json().catch(() => ({}))) as { error?: string };
          setLoading(false);
          if (!response.ok) return setError(result.error || 'تعذر إرسال الطلب');
          setDone(true);
        }}
        disabled={loading}
        className="btn btn-primary btn-large"
      >
        {loading ? 'جاري الإرسال...' : 'تأكيد طلب الاشتراك'}
      </button>
      <p className="form-hint">
        لن يتم تخزين بيانات البطاقة على المنصة. الطلب يحتاج مراجعة الإدارة قبل فتح المحتوى.
      </p>
      {error && (
        <div className="error-toast" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
