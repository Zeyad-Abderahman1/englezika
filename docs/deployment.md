# تشغيل Englizeka محليًا وعلى VPS باستخدام PostgreSQL الأصلي

## محليًا

1. ثبّت Node.js 22 وPostgreSQL 16 كتثبيت أصلي على Windows. يمكن استخدام الأمر التالي
   من Command Prompt أو PowerShell:

```cmd
winget install --id PostgreSQL.PostgreSQL.16 --exact --source winget
```

   أكمل كلمة مرور مسؤول PostgreSQL داخل برنامج التثبيت ولا تحفظها في المستودع.
2. أنشئ دورًا مخصصًا للتطبيق بصلاحيات `NOSUPERUSER NOCREATEDB NOCREATEROLE` وقاعدة
   بيانات يملكها هذا الدور. استخدم `\password` داخل `psql` لإدخال كلمة المرور
   تفاعليًا، ولا تضعها في Git أو في أوامر محفوظة.
3. انسخ `.env.example` إلى `.env.local` واضبط `DATABASE_URL` على `127.0.0.1:5432`
   باستخدام دور التطبيق.
4. من Windows Command Prompt شغّل:

```cmd
npm install
npm run db:start
npm run db:migrate
npm run dev
```

لإيقاف خدمة PostgreSQL محليًا استخدم `npm run db:stop`. اسم الخدمة الافتراضي هو
`postgresql-x64-16` ويمكن تغييره عبر `POSTGRES_SERVICE_NAME` عند الحاجة.

## متطلبات الـVPS لاحقًا

Security deployment requirement: terminate HTTPS at a trusted reverse proxy, block direct public access to the Node origin, and strip incoming forwarding headers before Nginx writes the single header named by `TRUSTED_PROXY_IP_HEADER`. Set that variable only to a header Nginx controls. If it is empty, the application deliberately uses one shared untrusted-client limiter bucket instead of trusting caller-controlled headers. Configure Nginx request-body limits for public JSON and multipart routes as defense in depth.

- Ubuntu حديث.
- Node.js 22.
- PostgreSQL 16 مثبتًا من حزم النظام، ويعمل كخدمة systemd.
- Nginx أمام التطبيق مع HTTPS.
- قرص دائم ومجلد خاص لشهادات الميلاد.
- نسخ احتياطي يومي لقاعدة البيانات ومجلد الملفات الخاصة.

ثبّت PostgreSQL وشغّله قبل الترحيل:

```bash
sudo apt install postgresql-16
sudo systemctl enable --now postgresql
sudo -u postgres psql
```

أنشئ دور التطبيق وقاعدة البيانات من جلسة `psql`، واضبط كلمة المرور باستخدام
`\password englizeka`، ثم اخرج بـ`\q`. بعد ضبط الأسرار في ملف بيئة خارج مجلد
المستودع، نفّذ `npm ci` و`npm run db:migrate`. ابنِ التطبيق بالأمر `npm run build`
وشغّله بالأمر `npm run start` عبر systemd أو مدير عمليات يعيد تشغيله تلقائيًا.

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
