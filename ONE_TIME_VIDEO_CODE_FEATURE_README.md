# Englizeka One-Time Video Access Code Feature

## 1. Feature Overview

Authorized staff can generate a high-entropy, single-use code for one existing lecture. A verified student can redeem that code once and receives persistent access to that exact video without receiving a course enrollment.

## 2. User Flow

The teacher generates and copies a code from the existing video-management screen. The student opens **كود المحاضرة**, enters the code, and is taken directly to the unlocked lecture after a successful server-side redemption.

## 3. Teacher Workflow

1. Sign in as active staff with `manage_videos`.
2. Open course/video management.
3. Select **إنشاء كود محاضرة** beside the intended video.
4. Copy the plaintext code shown once.
5. Use the masked history to see unused/redeemed status without revealing student identity or full codes.

## 4. Student Workflow

1. Sign in with a verified student account.
2. Open **استخدام كود المحاضرة** from the dashboard/navigation.
3. Enter or paste the code; the UI formats it without changing its normalized value.
4. Submit once and receive safe invalid, used, rate-limited, or success feedback.
5. On success, use the direct CTA to open only the granted lecture.

## 5. Business Rules

- A code belongs to one existing video and its actual course.
- A code is consumable by exactly one student.
- A grant unlocks one video, not the course, next lesson, or prerequisites for other videos.
- Approved enrollment behavior remains unchanged.
- Student account deletion removes the grant but preserves the consumed timestamp, so a code cannot become reusable.

## 6. Database Changes

`lecture_access_codes` stores `id`, unique `code_hash`, `display_suffix`, `course_id`, `video_id`, optional creator, creation time, optional redeemer, and redemption time. `student_video_access_grants` stores the student/video pair, source, unique source-code reference, and creation time. Primary, foreign-key, unique, check, and lookup constraints enforce the narrow grant model.

## 7. Migration Added

`database/migrations/003_one_time_video_access_codes.sql` creates both tables and `lecture_access_codes_video_created_idx`. It is additive and safe for existing rows.

## 8. Code Generation Security

Generation uses Node `randomBytes(30)` and a uniform 32-character unambiguous alphabet: 150 bits of entropy. The displayed form is `ENG-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`. The server normalizes and hashes it with SHA-256. Only the hash and last five display characters are stored; plaintext is returned once in a private, no-store response and is excluded from audit data.

## 9. Atomic Redemption Design

One PostgreSQL data-modifying CTE statement locks an unused candidate, inserts its exact grant, and only then marks the code redeemed. The claim depends on the inserted grant row. A grant conflict or malformed course/video relationship therefore leaves the code unconsumed. A conditional unused-state predicate plus row locking yields one winner under concurrency; every database error rolls back the statement.

## 10. Video Authorization Integration

The existing `authorizeVideoAccess()` gateway now accepts either an approved course enrollment or an indexed exact `(student_email, video_id)` grant. Raw, resolve, embed, and completion routes already converge on this gateway. Individual grants return before sequential/prerequisite course rules only for their exact video; the learning page disables sequential UI unlocking without an enrollment.

## 11. Rate Limiting

The redemption POST reuses the PostgreSQL rate limiter after same-origin, verified-session, and syntax checks. It applies an account bucket of 8 attempts per 15 minutes, then an IP/trusted-client bucket of 30 per 15 minutes. Account-blocked attempts do not consume the shared IP bucket. Production must configure the trusted proxy identity header correctly; without it, the hardened fallback intentionally does not trust spoofable forwarding headers.

## 12. UI Changes

The current admin video row contains generation, one-time reveal, copy feedback, and masked status history. The student dashboard contains a compact Arabic-first redemption form with formatting, local loading, inline accessible errors, success context, direct watch CTA, and an existing-grants list.

## 13. Mobile and RTL Verification

The real application was checked at 320×568, 360×800, 390×844, 430×932, and 1440×900. Teacher and student screens had no page-level horizontal overflow. Arabic shells remain RTL while access-code values are explicitly LTR and wrap safely. Light and dark presentation were both rendered.

## 14. Security Tests

The security suite covers entropy/normalization/hashing, lack of plaintext schema fields, authorization and same-origin gates, account/IP limiting, 50-way contention semantics, exact-video isolation, paid access, and account-deletion behavior. Result: 22/22 passing after the final security hardening.

## 15. Concurrency Tests

A real local PostgreSQL test launched 50 simultaneous redemptions for one code. Exactly one succeeded, one owner was persisted, and exactly one source-linked grant existed. A second integration case proves a pre-existing student/video grant cannot burn another code.

## 16. Functional Tests

The live E2E flow verifies authorized generation and copy, anonymous/student generation rejection, anonymous redemption rejection, target access before/after redemption, replay denial for owner and second student, unrelated-video denial, masked history, and existing enrollment/payment/prerequisite behavior.

## 17. Existing Feature Regression

Security tests, unit tests, live E2E, typecheck, lint, and production build cover existing authentication, payment, exam, enrollment, protected video, notification, account-removal, and staff-permission paths. No existing role or enrollment meaning was changed.

## 18. Performance Impact

Authorization adds two indexed `EXISTS` predicates to the existing per-video query. Redemption performs a hash lookup by a unique index and one atomic statement. Dashboard grant lists are batched; there is no application-memory table scan, unrelated-request query, or video-list N+1.

## 19. Files Modified

- `database/migrations/003_one_time_video_access_codes.sql`
- `app/lib/lecture-access-codes.ts`
- `app/api/admin/videos/[id]/access-codes/route.ts`
- `app/api/lecture-access-codes/redeem/route.ts`
- `app/lib/video-access.ts`
- `app/lib/account-deletion.ts`
- `app/api/admin/bootstrap/route.ts`
- `app/api/dashboard/route.ts`
- `app/components/admin/LectureAccessCodeManager.tsx`
- `app/components/LectureCodeRedemption.tsx`
- `app/components/AdminDashboard.tsx`
- `app/components/StudentDashboard.tsx`
- `app/components/SecureVideoPlayer.tsx`
- `app/learn/[courseId]/page.tsx`
- `app/globals.css`
- `tests/lecture-access-code-security.test.mjs`
- `tests/lecture-access-code-postgres.test.mjs`
- `tests/video-prerequisite-security.test.mjs`
- `tests/account-deletion-security.test.mjs`
- `tests/live-platform-e2e.mjs`
- `package.json`

The required project-local `.codex/skills/ui-ux-pro-max/` skill bundle was installed for design guidance only; it is not an application runtime dependency. The workspace contained unrelated pre-existing edits, which were preserved and are not claimed above.

## 20. Deployment Requirement

Back up the production database, deploy the application and migration together, run `npm run db:migrate` once with the production `DATABASE_URL`, and verify the migration ledger includes `003_one_time_video_access_codes.sql`. Configure `TRUSTED_PROXY_IP_HEADER` to a header stripped and set only by the trusted edge. No plaintext-code migration or backfill is required.

## 21. Remaining Limitations

- Plaintext codes cannot be recovered after the one-time response; teachers must generate a replacement if lost.
- The pre-existing email-keyed deleted-account lifecycle can reconnect retained enrollment/history records after re-registration and can fail on a second delete/re-register/delete cycle. This security-scan finding is outside this narrowly scoped feature and requires an immutable student ID migration.
- If trusted proxy identity is not configured, the existing limiter uses a shared fail-closed identity; deployment configuration is therefore important for availability.
- Rate-limit and already-used browser states are covered by API/E2E logic and source verification, while intentionally forcing the live shared limiter during visual QA was avoided.

## 22. Final Verdict

The one-time lecture code path is implemented end to end: protected generation, non-plaintext persistence, grant-dependent atomic redemption, exact-video authorization, account/IP defense, premium RTL UI, real concurrency proof, live E2E coverage, and a passing production build. Deployment requires migration 003 and correct trusted-proxy configuration.
