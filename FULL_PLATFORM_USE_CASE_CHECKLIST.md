# Englizeka Full Platform Use-Case Checklist

Audit date: 2026-08-13. Status reflects execution against the local PostgreSQL database and `http://127.0.0.1:4180`, not source inspection alone.

Legend: `[x]` executed/closed; `[ ]` unresolved. Statuses: PASS, FIXED, FAIL, BLOCKED, NOT IMPLEMENTED, NEEDS DECISION, NOT APPLICABLE.

## Environment

- [x] **UC-ENV-001 — PASS** Preserve dirty working tree; no reset/clean performed.
- [x] **UC-ENV-002 — PASS** PostgreSQL 16 container healthy and migrations applied.
- [x] **UC-ENV-003 — PASS** Local Next.js 16.3.0 application started and `/api/ready` succeeded.
- [x] **UC-ENV-004 — PASS** Synthetic test identities/content used; no production payment/email was sent.

## Authentication

- [x] **UC-AUTH-001 — PASS** Register a student with valid multipart data and a PNG certificate.
- [x] **UC-AUTH-002 — PASS** Email verification with the locally returned test code.
- [x] **UC-AUTH-003 — PASS** Verified student login through API and real browser UI.
- [x] **UC-AUTH-004 — PASS** Invalid student and staff passwords return 401.
- [x] **UC-AUTH-005 — PASS** Unverified account is identified as verification-required.
- [x] **UC-AUTH-006 — PASS** Student and staff session cookies cannot substitute for one another.
- [x] **UC-AUTH-007 — PASS** Student logout is POST-only and revokes the session.
- [x] **UC-AUTH-008 — PASS** Password reset succeeds, is single-use, and revokes existing sessions.
- [x] **UC-AUTH-009 — FIXED** Production test-mode reset/verification code disclosure is now disabled at the runtime helper.
- [x] **UC-AUTH-010 — FIXED** Forgot-password now uses same-origin, trusted client identity, and a per-email quota.
- [x] **UC-AUTH-011 — FIXED** Verification resend no longer enumerates account existence/verification state.
- [x] **UC-AUTH-012 — PASS** Password policy requires 12+ chars with upper/lower/digit/symbol.
- [x] **UC-AUTH-013 — PASS** Anonymous protected dashboard/staff operations return 401 or redirect.

## Student Lifecycle

- [x] **UC-STUDENT-001 — PASS** Register → verify → login → dashboard → browse course.
- [x] **UC-STUDENT-002 — PASS** Enroll → staff approve → protected learning access.
- [x] **UC-STUDENT-003 — PASS** Take exam → view result → satisfy lesson prerequisite.
- [x] **UC-STUDENT-004 — PASS** Redeem one-video code without unlocking whole course.
- [x] **UC-STUDENT-005 — PASS** Complete video, reset password, log in again, and retain state.
- [x] **UC-STUDENT-006 — PASS** Account deletion removes the private certificate and tombstones identity.

## Courses

- [x] **UC-COURSE-001 — PASS** Teacher creates a published course through the live API journey.
- [x] **UC-COURSE-002 — PASS** Teacher edits course title, description, grade, price, and status.
- [x] **UC-COURSE-003 — PASS** Published course renders publicly; direct detail route works.
- [x] **UC-COURSE-004 — PASS** Grader cannot create courses (403).
- [x] **UC-COURSE-005 — PASS** Course-manager assistant can create courses.
- [x] **UC-COURSE-006 — PASS** Course form/list render responsively in staff UI.

## Lectures/Videos

- [x] **UC-VIDEO-001 — PASS** Teacher creates two YouTube-backed lectures.
- [x] **UC-VIDEO-002 — PASS** Teacher edits prerequisite exam/minimum score.
- [x] **UC-VIDEO-003 — PASS** Locked lesson denies student before prerequisite.
- [x] **UC-VIDEO-004 — PASS** Passing exam enables secure resolve; raw video download remains unavailable.
- [x] **UC-VIDEO-005 — PASS** Completion token is student/video-bound and rejects early use.
- [ ] **UC-VIDEO-006 — FAIL** A student can wait out a completion token without proving playback; needs a playback-session design.

## One-Time Lecture Codes

- [x] **UC-CODE-001 — PASS** Authorized teacher generates a cryptographically random code.
- [x] **UC-CODE-002 — PASS** Plaintext is returned once; bootstrap history contains only suffix/status.
- [x] **UC-CODE-003 — PASS** Anonymous/student/grader generation is denied.
- [x] **UC-CODE-004 — PASS** Student A redeems and gains only the selected lecture.
- [x] **UC-CODE-005 — PASS** Same student and Student B cannot replay consumed code.
- [x] **UC-CODE-006 — PASS** PostgreSQL 50-way concurrency yields exactly one owner and one grant.
- [x] **UC-CODE-007 — PASS** Existing grant does not accidentally consume another code.

## Assignments

- [x] **UC-ASSIGN-001 — PASS** Teacher creates a published course assignment.
- [x] **UC-ASSIGN-002 — PASS** Course-manager may create; grader may not create assignments.
- [x] **UC-ASSIGN-003 — PASS** Enrolled student receives assignment in dashboard/notifications.
- [x] **UC-ASSIGN-004 — PASS** Assignment update/delete handlers are permission-protected.

## Assignment Uploads

- [x] **UC-ASUPLOAD-001 — NOT IMPLEMENTED** No assignment-submission route, table, file relationship, or student upload UI exists.
- [x] **UC-ASUPLOAD-002 — NOT IMPLEMENTED** File-type/size/deadline/resubmission tests are inapplicable until submission exists.
- [x] **UC-ASUPLOAD-003 — NOT IMPLEMENTED** Cross-student submission download isolation has no implemented surface.

## Assignment Grading

- [x] **UC-ASGRADE-001 — NOT IMPLEMENTED** No assignment submission/grade entity or grading endpoint exists.
- [x] **UC-ASGRADE-002 — NOT IMPLEMENTED** Student assignment feedback/grade view is absent.

## Exams

- [x] **UC-EXAM-001 — PASS** Teacher creates and edits a published exam with questions.
- [x] **UC-EXAM-002 — PASS** Enrolled student starts/resumes one stable timed session.
- [x] **UC-EXAM-003 — PASS** Correct answer submission calculates score/result and prevents duplicate claiming.
- [x] **UC-EXAM-004 — PASS** Grader can adjust score/feedback; course manager cannot.
- [x] **UC-EXAM-005 — PASS** Student can view only their own attempt/result.
- [ ] **UC-EXAM-006 — FAIL** Authenticated GET starts the exam timer; cross-site top-level navigation can trigger it.
- [ ] **UC-EXAM-007 — NEEDS DECISION** Token-coverage grading of free text is gameable; manual review or a stricter rubric is a product decision.

## Enrollment

- [x] **UC-ENROLL-001 — PASS** Student submits an enrollment/payment request.
- [x] **UC-ENROLL-002 — PASS** Authorized staff sees and approves request.
- [x] **UC-ENROLL-003 — PASS** Approval persists and unlocks course-scoped resources.
- [x] **UC-ENROLL-004 — PASS** One-active-pending enrollment constraint prevents duplicate checkout state.

## Payments

- [x] **UC-PAY-001 — PASS** Checkout state and payment intent relationships are exercised locally.
- [x] **UC-PAY-002 — PASS** Webhook HMAC, amount, currency, transaction, and idempotency controls pass tests.
- [x] **UC-PAY-003 — NOT APPLICABLE** No real payment was sent; external gateway availability was intentionally excluded.

## Dashboard and Notifications

- [x] **UC-DASH-001 — PASS** Dashboard shows enrollment, exam, assignment, announcement, grade average, and lecture grant.
- [x] **UC-DASH-002 — PASS** Mark-visible-notifications-read persists for assignment/exam/announcement.
- [x] **UC-DASH-003 — PASS** Anonymous dashboard is denied; logged-out session returns 401.

## Profile/Account

- [x] **UC-PROFILE-001 — PASS** Profile and account sections render for authenticated student.
- [x] **UC-PROFILE-002 — PASS** Password change/reset and session revocation covered.
- [x] **UC-PROFILE-003 — PASS** Account deletion and clean-email re-registration security tests pass.

## Staff/Admin and Permissions

- [x] **UC-STAFF-001 — PASS** Teacher dashboard, course/exam/assignment/video/student/enrollment surfaces load.
- [x] **UC-STAFF-002 — PASS** Teacher creates grader and course-manager assistants.
- [x] **UC-STAFF-003 — PASS** Grader can grade exams but cannot create courses/assignments/codes.
- [x] **UC-STAFF-004 — PASS** Course manager can manage content but cannot grade.
- [x] **UC-STAFF-005 — FIXED** Restricted staff pagination totals no longer disclose unauthorized resource counts.

## File Security

- [x] **UC-FILE-001 — PASS** Registration accepts valid signature-checked PNG/JPEG/PDF up to configured limits.
- [x] **UC-FILE-002 — PASS** Certificate stored outside `public` with generated key.
- [x] **UC-FILE-003 — PASS** Only staff with `view_students` can download; response uses `nosniff`.
- [x] **UC-FILE-004 — PASS** Account deletion removes file before anonymizing database state.

## Mobile, RTL, Accessibility

- [x] **UC-MOBILE-001 — PASS** Home/courses/account/lesson/exam/result checked at 320, 360, 390, 430, 768, 1440 widths.
- [x] **UC-MOBILE-002 — PASS** Admin overview/courses/students/results checked at 320, 390, 768 and partially at 1440.
- [x] **UC-RTL-001 — PASS** Checked routes computed `direction: rtl` with no page-level overflow.
- [x] **UC-A11Y-001 — PASS** Skip link, landmarks, named controls, labeled exam radio buttons, and focusable semantic controls observed.
- [x] **UC-A11Y-002 — BLOCKED** Automated contrast ratio and complete keyboard traversal were not instrumented; DOM/visual checks only.

## Error Handling, Security, Performance, Regression, Build

- [x] **UC-ERR-001 — PASS** Invalid auth, unauthorized access, used codes, early completion, and expired/used reset tokens return safe errors.
- [x] **UC-SEC-001 — PASS** Same-origin enforcement and student/staff session separation exercised.
- [x] **UC-SEC-002 — PASS** Parameterized SQL/private storage/payment and lecture-code controls reviewed and tested.
- [ ] **UC-SEC-003 — FAIL** Production without a trusted proxy IP header shares an auth-rate-limit bucket; deployment validation is required.
- [x] **UC-PERF-001 — PASS** Dashboard uses bounded queries/pagination and indexed grant/enrollment/session access paths.
- [x] **UC-REG-001 — PASS** Typecheck, lint, 25 security tests, 9 unit tests, and 2 PostgreSQL tests pass.
- [x] **UC-REG-002 — PASS** Full live platform E2E passed twice (cleanup and retained-fixture modes).
- [x] **UC-BUILD-001 — PASS** Next.js production build generated 41 pages/routes and standalone assets.
- [x] **UC-AUDIT-001 — PASS** `npm audit` reports zero known vulnerabilities.
