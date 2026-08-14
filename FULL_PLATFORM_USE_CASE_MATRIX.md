# Englizeka Full Platform Use-Case Matrix

| Use Case ID | Domain | Actor | Scenario | Preconditions | Execution | Expected | Observed | Status | Evidence/Notes |
|---|---|---|---|---|---|---|---|---|---|
| UC-ENV-001 | Environment | Auditor | Preserve workspace | Dirty tree | `git status`, no reset/clean | User work retained | 38 modified plus existing untracked work preserved | PASS | Initial Git capture |
| UC-ENV-002 | Environment | Auditor | Local services | Docker available | `docker compose ps`, migration | Healthy DB/current schema | PostgreSQL 16 healthy; migration success | PASS | CLI |
| UC-AUTH-001 | Auth | Visitor | Register | Synthetic multipart profile | Live E2E POST | Account/session/certificate | 200, cookie, stored account | PASS | `tests/live-platform-e2e.mjs` |
| UC-AUTH-002 | Auth | Student | Verify email | Unverified account/code | Live E2E POST | Verified state | 200; DB `email_verified=1` | PASS | API + DB |
| UC-AUTH-003 | Auth | Student | Login | Verified account | Browser form + API | Redirect/account session | Browser reached `/account` | PASS | Browser DOM |
| UC-AUTH-008 | Auth | Student | Reset password | Existing account | Request/reset/replay/login | One use; sessions revoked | Reset succeeds, replay 400, old cookie 401 | PASS | Live E2E |
| UC-AUTH-009 | Auth | Attacker | Production test-code leak | Misconfigured test flag | Static trace + regression | No production code disclosure | Runtime helper now returns false in production | FIXED | Security test |
| UC-AUTH-010 | Auth | Attacker | Reset flooding/header spoof | Anonymous | Static trace + tests | Trusted identity + target quota | Same-origin/getClientIp/per-email quota | FIXED | Rate-limit security tests |
| UC-AUTH-011 | Auth | Attacker | Account enumeration | Anonymous | Route response review | Uniform response | Missing/verified accounts now return `{ok:true}` | FIXED | Source regression |
| UC-COURSE-001 | Courses | Teacher | Create course | Teacher session | Live API journey | Persisted course | 200; published DB row | PASS | E2E + DB |
| UC-COURSE-002 | Courses | Teacher | Edit course | Existing course | PATCH | Updated metadata | Title/price/status persisted | PASS | E2E + browser |
| UC-COURSE-004 | Courses | Grader | Unauthorized create | Grader session | Direct POST | 403/no row | 403 | PASS | Live E2E |
| UC-COURSE-005 | Courses | Course manager | Authorized create | Assistant preset | Direct POST | 200 | Draft course created | PASS | Live E2E |
| UC-VIDEO-001 | Videos | Teacher | Create lectures | Course exists | Two POSTs | Course-linked videos | DB count 2 | PASS | E2E + DB |
| UC-VIDEO-003 | Videos | Student | Locked video | Enrollment, unmet prerequisite | Direct API | Denied | 403 `LESSON_QUIZ_REQUIRED` | PASS | Live E2E |
| UC-VIDEO-004 | Videos | Student | Resolve after pass | Passing attempt | Direct API/browser | Secure YouTube metadata | 200; no raw download | PASS | Live E2E |
| UC-VIDEO-005 | Videos | Student | Early completion | Fresh token | POST immediately/after delay | Early denial, later success | 403 then 200 | PASS | Live E2E |
| UC-VIDEO-006 | Videos | Student | Completion without playback | Authorized resolve | Security trace | Playback proof required | Elapsed-time bearer token is sufficient | FAIL | `app/lib/video-token.ts` |
| UC-CODE-001 | Lecture code | Teacher | Generate | `manage_videos` | Direct POST | Plaintext once/hash stored | 201 and format valid | PASS | Live E2E |
| UC-CODE-002 | Lecture code | Teacher | Reopen history | Code generated/redeemed | Bootstrap GET | Masked suffix only | Plaintext absent | PASS | E2E assertion |
| UC-CODE-004 | Lecture code | Student A | Redeem | No course enrollment | Direct POST | Exact video grant | 200; dashboard grant | PASS | API + DB |
| UC-CODE-005 | Lecture code | Student B | Replay | Consumed code | Direct POST | Rejected/no grant | 409; video remains 403 | PASS | Live E2E |
| UC-CODE-006 | Lecture code | 50 students | Concurrent redeem | Fresh code | PostgreSQL integration | One winner/one grant | Exactly 1/50 succeeds | PASS | PostgreSQL test |
| UC-ASSIGN-001 | Assignments | Teacher | Create assignment | Course exists | Direct POST | Published assignment | 200; student dashboard item | PASS | Live E2E |
| UC-ASSIGN-002 | Assignments | Staff | Permission split | Assistant presets | Direct POSTs | Manager yes/grader no | 200/403 | PASS | Live E2E |
| UC-ASUPLOAD-001 | Assignment upload | Student | Submit work | Assignment exists | Route/schema/UI inventory | Upload workflow | No submission implementation | NOT IMPLEMENTED | 0 relevant DB tables |
| UC-ASGRADE-001 | Assignment grading | Teacher | Grade submission | Submission required | Route/schema/UI inventory | Grade workflow | No submission or assignment-grade entity | NOT IMPLEMENTED | Inventory |
| UC-EXAM-001 | Exams | Teacher | Create/edit exam | Course exists | POST/PATCH | Published exam/questions | 200; DB exam row | PASS | Live E2E |
| UC-EXAM-002 | Exams | Student | Start/resume timed exam | Enrollment | Two GETs | Stable session/timer | Same id/expiry | PASS | Live E2E |
| UC-EXAM-003 | Exams | Student | Submit answer | Active session | POST | Atomic attempt/result | Passed; attempt persisted | PASS | E2E + DB |
| UC-EXAM-004 | Exams | Grader | Edit score/feedback | Attempt exists | PATCH | Authorized update | 200; 90% shown in browser | PASS | API + UI |
| UC-EXAM-005 | Exams | Wrong student | Read attempt | Other ID | Ownership trace/tests | Denied | Query binds id + user email | PASS | Security scan/source |
| UC-EXAM-006 | Exams | External attacker | Cross-site exam start | Victim logged in/known exam | Security trace | Explicit same-origin start | GET creates timer/session | FAIL | `app/api/exams/[id]/route.ts` |
| UC-EXAM-007 | Exams | Student | Keyword-stuff written answer | Short-answer exam | Grader trace | Robust/manual grading | Coverage heuristic ignores unrelated text | NEEDS DECISION | `app/lib/grading.ts` |
| UC-ENROLL-001 | Enrollment | Student | Request enrollment | Verified student/course | Direct POST | Pending request | Staff sees row | PASS | Live E2E |
| UC-ENROLL-002 | Enrollment | Teacher | Approve | Pending row | PATCH | Approved access | DB approved count 1 | PASS | E2E + DB |
| UC-PAY-002 | Payments | Gateway | Process webhook | Server intent/signature | Unit/security tests | HMAC/amount/idempotency | All assertions pass | PASS | 9 unit + security suite |
| UC-DASH-001 | Dashboard | Student | Load learning summary | Logged in | Real browser | Courses/exams/grades/grants | All visible in Arabic dashboard | PASS | Browser DOM/screenshot |
| UC-NOTIFY-001 | Notifications | Student | Mark read | Visible notifications | POST + reload | Persist read state | Assignment/exam/announcement `isRead=1` | PASS | Live E2E |
| UC-PROFILE-003 | Account | Student | Delete/re-register | Password/private file | DELETE + tests | File removed/tombstone/fresh account | All security tests pass | PASS | Tests |
| UC-STAFF-003 | Permissions | Grader | Restricted operations | Grader cookie | Course/assignment/code requests | 403 | All rejected | PASS | Live E2E |
| UC-STAFF-004 | Permissions | Course manager | Content not grading | Manager cookie | Course/assignment/grade requests | 200/200/403 | Matches preset | PASS | Live E2E |
| UC-STAFF-005 | Permissions | Restricted staff | Bootstrap totals | Any staff session | Static validation + test | Unauthorized totals hidden | Pagination now permission-filtered | FIXED | Security regression |
| UC-FILE-001 | File security | Student | Upload certificate | Registration | Multipart E2E/security review | Type/signature/size enforced | Valid PNG accepted; private storage used | PASS | E2E/tests |
| UC-FILE-003 | File security | Staff | Download certificate | `view_students` | Authorization trace | Only authorized staff | Permission and DB key required | PASS | Security scan |
| UC-MOBILE-001 | Responsive | Student/visitor | Critical routes | Retained fixture | Browser at 320/360/390/430/768/1440 | RTL/no page overflow | 36 route-width checks pass | PASS | `docs/uiux/after` |
| UC-MOBILE-002 | Responsive | Staff | Admin sections | Staff session | Browser responsive checks | Contained layout/tables | No page overflow; table content scroll-contained | PASS | Browser diagnostics |
| UC-A11Y-001 | Accessibility | Keyboard/screen reader | Semantics | Live pages | DOM snapshots | Names/labels/landmarks | Skip links, labels, named radio/buttons present | PASS | Browser DOM |
| UC-A11Y-002 | Accessibility | User | Full WCAG audit | Tooling required | Partial browser inspection | Contrast/full keyboard proof | Not fully automated | BLOCKED | Explicit limitation |
| UC-SEC-003 | Rate limit | Attacker | Shared fallback bucket | No trusted proxy header | Source validation | Per-client isolation | Fallback key is global | FAIL | Deployment requirement |
| UC-REG-001 | Regression | CI | Automated gates | Dependencies/DB | typecheck/lint/unit/security/Postgres | Green | 35 tests pass | PASS | Command logs |
| UC-REG-002 | Regression | CI | Live E2E | Local DB | Run twice | Green lifecycle | Both modes pass | PASS | Command logs |
| UC-BUILD-001 | Build | Release | Production build | Local env | `npm run build` | Optimized standalone output | 41 routes, build success | PASS | Next build |
| UC-AUDIT-001 | Dependencies | Release | Dependency audit | Lockfile | `npm audit --json` | No known vulnerabilities | 0 total | PASS | npm audit |
