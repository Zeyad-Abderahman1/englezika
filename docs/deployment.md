# تشغيل Englizeka محليًا وعلى VPS

## محليًا

1. ثبّت Node.js 22 وDocker Desktop.
2. انسخ `.env.example` إلى `.env.local`.
3. شغّل قاعدة البيانات: `npm run db:up`.
4. طبّق الجداول: `npm run db:migrate`.
5. شغّل الموقع: `npm run dev`.

## متطلبات الـVPS لاحقًا

- Ubuntu حديث.
- Node.js 22.
- PostgreSQL 16.
- Nginx أمام التطبيق مع HTTPS.
- قرص دائم ومجلد خاص لشهادات الميلاد.
- نسخ احتياطي يومي لقاعدة البيانات ومجلد الملفات الخاصة.

ابنِ التطبيق بالأمر `npm run build` وشغّله بالأمر `npm run start`. يفضّل تشغيله عبر
systemd أو مدير عمليات يعيد تشغيله تلقائيًا عند فشل العملية.

## متغيرات التشغيل الأساسية

- `DATABASE_URL`: رابط PostgreSQL.
- `DATABASE_POOL_MAX`: الحد الأقصى لاتصالات كل نسخة من التطبيق.
- `PRIVATE_STORAGE_DIR`: مسار مطلق لمجلد الملفات الخاصة.
- `VERIFICATION_SECRET` و`VIDEO_RESOLVE_SECRET`: أسرار عشوائية طويلة.
- إعدادات البريد الموجودة في `.env.example`.
- `APP_URL`: رابط HTTPS النهائي عند تفعيل الدفع.

لا تضع `.env.local` أو النسخ الاحتياطية أو مجلد الملفات الخاصة داخل Git أو `public`.

## قبل النشر

```bash
npm ci
npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

الدفع يمكن إضافته أو تفعيله بعد تجهيز رابط HTTPS العام على الـVPS؛ بقية الموقع لا تعتمد عليه.
