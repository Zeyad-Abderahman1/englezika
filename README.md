# Englizeka

The full learning platform for Mr Ahmed Hassan: public course catalog, secure student area, private video delivery, subscriptions, timed exams, automatic grading, and an email-protected administration dashboard.

## Main product areas

- `/courses` — live course catalog managed from the database
- `/dashboard` — each student's courses, exams, results, announcements, and profile
- `/admin` — courses, exams, questions, video uploads, enrollments, results, messages, and announcements
- `/learn/:courseId` — entitlement-checked private video playback with a viewer watermark
- `/exam/:id` — timed, single-attempt exams with saved results and per-question feedback

Students use native email-and-password accounts with email verification. Staff authentication is separate, and server routes enforce the active session on every protected read and write.

## Configuration

Copy `.env.example` to `.env.local` for local configuration:

- `ADMIN_EMAILS` — comma-separated emails allowed to open `/admin`
  Objective questions are graded instantly, while written questions use the built-in answer-key and rubric grader.

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
```

Cloudflare D1 stores accounts, courses, enrollments, exams, attempts, scores, contacts, and announcements. R2 stores private video objects. The first request initializes the schema defensively, and `drizzle/0000_englizeka_platform.sql` is the deployment migration.

## Security notes

- Admin authorization is a server-side exact email allowlist.
- Course videos have no public object URL and stream only after a live enrollment check.
- Mutating endpoints check same-origin requests and validate/limit submitted fields.
- SQL access uses prepared statements.
- Exams keep server-side start and expiry times, prevent duplicate submissions, and never send answer keys to the browser.
- AI grading treats student text as untrusted data and falls back safely if the API is unavailable.

Browser-level download controls and visible watermarks discourage casual copying, but no web player can provide absolute DRM against screen recording. For high-value licensed content, pair this platform with a commercial DRM/transcoding provider.

## Contributors

- [Moamen](https://github.com/moamen5856)
