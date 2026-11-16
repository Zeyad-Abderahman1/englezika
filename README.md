# Englizeka

Englizeka is an educational platform built with Next.js and PostgreSQL. It includes courses, student accounts, enrollments, exams, results, announcements, and a separate administration dashboard for teachers and staff.

## Local development

Requirements:

- Node.js 22 or later
- PostgreSQL 16 installed natively and running as a local service

In a Windows Command Prompt, copy `.env.example` to `.env.local`, set a local
`DATABASE_URL` for a dedicated non-superuser PostgreSQL role, then run:

```cmd
winget install --id PostgreSQL.PostgreSQL.16 --exact --source winget
copy .env.example .env.local
npm install
npm run db:start
npm run db:migrate
npm run dev
```

For a first-time database setup, connect as the PostgreSQL administrator and
create the application role interactively so its password is never placed in
the repository or shell history:

```cmd
psql -U postgres -h 127.0.0.1 -d postgres
```

```sql
CREATE ROLE englizeka LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password englizeka
CREATE DATABASE englizeka OWNER englizeka;
\q
```

The application uses the native PostgreSQL installation directly.

The application will be available at `http://127.0.0.1:3000`.

## Storage and video delivery

- PostgreSQL stores users, courses, enrollments, exams, results, and other platform data.
- Birth certificates are stored in a private directory outside `public`, configured with `PRIVATE_STORAGE_DIR`.
- Compressed public images are served directly from the `public` directory.
- Lectures use unlisted YouTube URLs only. Uploading video files to the application server is disabled.

This project does not depend on Cloudflare or any Cloudflare storage service.

## Testing

```bash
npm run typecheck
npm run lint
npm test
```

The end-to-end test suite requires a running PostgreSQL instance and a configured `DATABASE_URL`:

```bash
npm run test:e2e
```

## Security

- Student and staff sessions are kept separate.
- All administration endpoints enforce server-side authorization.
- Database queries are parameterized, and private files are never stored in `public`.
- Lecture access requires an active enrollment and can be gated by completion of a previous exam.

## Contributors

- [Moamen](https://github.com/moamen5856)
