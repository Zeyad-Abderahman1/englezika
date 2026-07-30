# النسخ الاحتياطي والاستعادة

يجب نسخ عنصرين معًا:

1. قاعدة PostgreSQL.
2. مجلد `PRIVATE_STORAGE_DIR` الذي يحتوي الملفات الخاصة.

## نسخة قاعدة البيانات

```bash
pg_dump --format=custom --file=backups/englizeka.dump "$DATABASE_URL"
```

## الاستعادة

أوقف التطبيق، أنشئ قاعدة فارغة، ثم:

```bash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" backups/englizeka.dump
```

استعد مجلد الملفات الخاصة إلى نفس المسار المحدد في `PRIVATE_STORAGE_DIR`، ثم شغّل
`npm run db:migrate` لتطبيق أي ترحيلات أحدث.

اختبر النسخ الاحتياطية دوريًا على قاعدة منفصلة. لا يكفي نجاح أمر النسخ وحده دون تجربة الاستعادة.
