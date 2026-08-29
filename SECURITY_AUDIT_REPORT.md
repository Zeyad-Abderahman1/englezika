# Englizeka Full Security Audit and Remediation Report

**Audit date:** 2026-08-29
**Application:** Englizeka (إنجليزيكا)
**Scope:** `D:\Englezika` source tree, database migrations, CI workflow, deployment configuration, tests, and private student-document storage
**Status:** Code remediation complete; production deployment and live E2E verification remain gated on infrastructure configuration

## Executive summary

This audit covered the Next.js App Router application, all API route handlers under `app/api`, server libraries under `app/lib`, PostgreSQL migrations, private storage handling, YouTube embedding, Fawaterak payment callbacks, transactional email, GitHub Actions, repository hygiene, and existing security tests.

The initial pass identified several confirmed weaknesses that were not represented by the existing 25-test security suite: request-time schema mutation, incomplete PDF upload validation and cleanup, password-reset abuse/error disclosure, missing abuse controls on verification and completion flows, payment amount tolerance, exam-session lifecycle races, unsafe proxy identity assumptions, incomplete log redaction, contradictory embed framing policy, an audit bypass in CI, and HTML injection in email templates. These have been remediated with focused changes and regression tests.

After remediation, no known Critical or High application findings remain open in the reviewed code. The code passes type checking, linting, the complete 38-test security suite, the 9-test unit suite, and a CI-like production build. The live E2E suite cannot complete in this workspace because PostgreSQL is unavailable at `127.0.0.1:5432`; this is an environment blocker, not a test assertion failure. Production readiness therefore remains conditional on applying the documented TLS/reverse-proxy/database controls and running the live E2E suite against a real PostgreSQL service.

## Overall risk posture

| Point in time | Critical | High | Medium | Low | Overall assessment |
|---|---:|---:|---:|---:|---|
| Before this audit’s remediation | 0 | 5 confirmed | 6 confirmed | 2 | Not publish-ready without the fixes below |
| After remediation | 0 open | 0 open | 0 open | 0 open | Code pass; deployment and product-integrity gates remain |

The pre-remediation counts group related route/configuration weaknesses rather than counting every affected endpoint separately. Informational residual risks are listed below and are not treated as exploitable application vulnerabilities.

## Methodology and evidence

The audit used the required security skill set and cross-checked overlapping findings before remediation:

- `codex-security-audit-skill` was installed globally and used as the primary source/secrets audit driver, including its `scan_secrets.py` pass.
- `security-quick-scan`, `threat-modeling`, and `data-governance-check` from `codex-skills-library` were installed and applied to the authentication, API, secrets, storage, PII, and trust-boundary review.
- The relevant `cybersecurity-skills` playbooks were installed and applied: `owasp-audit`, `secrets-audit`, and `dependency-audit`.
- Next.js 16 route, header, CSP, data-security, and server-action guidance under `node_modules/next/dist/docs/` was read before changing framework configuration.
- Static source review used route inventory, parameterization/XSS/SSRF searches, authorization-path review, storage-path review, CI review, and Git history checks.
- Dynamic/local verification used the existing security and unit tests, focused red-to-green regression tests, `npm audit`, a production build with CI-like variables, and the live E2E runner.

### Important audit boundary

No production host, DNS, TLS certificate, reverse proxy, external email provider, Fawaterak account, or live PostgreSQL instance was available in this workspace. Those controls are documented as deployment gates rather than claimed as live-verified facts.

## Threat model and data governance

| Asset / boundary | Threats considered | Current protection / result |
|---|---|---|
| Birth certificates and student PII | Unauthorized download, path traversal, public exposure, persistence after deletion | Stored under `PRIVATE_STORAGE_DIR`, outside `public/`; certificate reads require staff `view_students`; `safePath()` prevents traversal; account deletion removes the certificate before tombstoning the account. |
| Student and staff sessions | Session confusion, fixation, replay, privilege escalation | Separate cookies and tables; HttpOnly/SameSite controls; server-side hashed tokens; staff permission checks remain server-side. |
| Exam attempts and results | IDOR, duplicate submissions, timer manipulation, race conditions | Student/enrollment scoping, explicit start endpoint, atomic expiry claim, atomic submit claim, owner-scoped result access. |
| Assignment PDFs and answers | Oversized/malformed files, storage orphaning, duplicate submissions, unauthorized access | Exact upload limits, PDF magic-byte checks, private storage, cleanup on DB failure, unique `(assignment_id, student_email)` constraint, enrolled-student authorization. |
| Payment and enrollment state | Forged callbacks, overpayment/underpayment acceptance, replayed terminal transitions | HMAC callback verification, exact amount/currency matching, safe integer bounds, idempotent database transitions. |
| YouTube lesson access | Unenrolled access, prerequisite bypass, token substitution | Server-side enrollment/grant/prerequisite checks; signed student/video-bound tokens; YouTube IDs restricted to the expected 11-character format. |
| Trust boundaries | Spoofed client IP headers, CSRF, untrusted request bodies, provider URLs | Same-origin checks on mutations, trusted proxy header allowlist with production validation, input caps/enums, Fawaterak host allowlist, no user-supplied server-side fetch URL. |
| Observability and CI | Secret leakage, excessive log context, supply-chain compromise | Recursive sensitive-key redaction, credential-file ignores, immutable action references, least-privilege GitHub token, blocking dependency audits. |

## Findings and remediation status

| ID | Severity | Area | Finding | Status |
|---|---|---|---|---|
| SEC-01 | High | Database / admin API | Authenticated application requests could execute schema migration DDL through `/api/admin/migrate`; assignment schema was not delivered by the canonical migration pipeline. | **Fixed** |
| SEC-02 | High | Uploads / private storage | Assignment PDF endpoints accepted broad content types and lacked request-size and magic-byte enforcement; student storage keys exposed normalized email and DB failures could orphan files. | **Fixed** |
| SEC-03 | High | Authentication | Password reset accepted loose codes, lacked the required same-origin and layered throttling controls, and returned internal exception text. | **Fixed** |
| SEC-04 | Medium | Abuse controls | Verification resend, email verification, video completion, enrollment, and exam start lacked complete per-IP/account request controls. | **Fixed** |
| SEC-05 | High | Payments | Paid callbacks accepted amounts greater than or equal to the intent rather than requiring an exact safe amount. | **Fixed** |
| SEC-06 | High | Exams / concurrency | `GET /api/exams/[id]` mutated session state; expiration used separate insert/update operations and could race into duplicate timeout attempts. | **Fixed** |
| SEC-07 | Medium | Proxy / audit identity | Forwarded client identity could be misconfigured in production and audit logs used forwarding headers without the trusted-proxy policy. | **Mitigated** |
| SEC-08 | Medium | Observability | Camel-case secret keys were not redacted after lowercasing, and nested sensitive values could pass through. | **Fixed** |
| SEC-09 | Medium | Headers / embedding | Global `frame-ancestors 'none'` and `X-Frame-Options: DENY` conflicted with the YouTube embed route’s same-origin framing requirement. | **Fixed** |
| SEC-10 | Medium | CI / supply chain | CI ignored audit failures and used mutable major-version action tags. | **Fixed** |
| SEC-11 | Medium | HTML injection | Transactional email templates interpolated student names, course titles, and reset URLs into HTML without escaping. | **Fixed** |
| SEC-12 | Low | Repository hygiene | Private key/container credential extensions were not explicitly ignored; GitHub workflow token permissions were not narrowed. | **Fixed** |
| SEC-13 | Info | Video integrity | A signed completion token proves authorization and elapsed time, not actual YouTube playback. This is an integrity/product limitation, not a confidentiality bypass. | **Accepted risk / follow-up** |
| SEC-14 | Info | Written grading | Rule-based keyword coverage is not equivalent to human or model assessment and may produce grading-quality errors. | **Accepted risk / follow-up** |
| SEC-15 | Info | Deployment verification | Live TLS, reverse proxy behavior, database availability, storage permissions, provider configuration, and retention policy were not verifiable locally. | **Deployment gate** |

## Finding details

### SEC-01 — request-time migration and assignment schema drift

**Root cause:** `/api/admin/migrate` exposed DDL from an application request, and assignment routes contained fallback behavior for a schema that was not represented by the normal migration sequence.

**Changes:**

- Removed `app/api/admin/migrate/route.ts`.
- Added canonical `database/migrations/004_assignment_system.sql` for assignment type, teacher file references, submissions, questions, uniqueness, and indexes.
- Removed assignment create/update fallback writes that silently operated without the canonical `type` column.

**Verification:** The new migration-only regression test confirms the route is absent and migration 004 contains the assignment submission schema. The full security suite passes.

### SEC-02 — assignment PDF upload and storage hardening

**Root cause:** Upload handlers relied on MIME declarations and did not bound the full request before parsing. Student submission persistence could leave a private file behind if the database write failed, and the old key format used a normalized email.

**Changes:**

- Added `app/lib/upload-validation.ts` with 15 MiB PDF and bounded request limits, exact MIME handling, `%PDF-` magic-byte validation, and SHA-256 storage identifiers.
- Applied the checks to `app/api/student/assignments/[id]/submit/route.ts` and `app/api/admin/assignments/[id]/file/route.ts`.
- Delete the stored object on failed submission persistence and return a controlled duplicate response for the unique constraint.
- Kept teacher/student files private and served only through authorized routes with `no-store` and `nosniff` responses.

**Verification:** Focused upload regression tests and the full security suite pass. Birth-certificate registration was re-reviewed separately and retains its existing 5 MiB allowlist, signature checks, private storage, and deletion ordering.

### SEC-03 — password-reset abuse and error disclosure

**Root cause:** Reset submission did not enforce same-origin, used only a length check for codes, lacked layered request throttling, and included internal error text in a client response.

**Changes:** `app/api/auth/reset-password/route.ts` now applies same-origin validation, a 32 KiB request cap, IP and per-account limits, strict six-digit code validation, and generic server-error responses. The resend endpoint also adds a per-IP limit before account lookup.

**Verification:** Password-reset account/code security tests, focused regression tests, and the full 38-test security suite pass.

### SEC-04 — missing abuse controls on mutation flows

**Root cause:** Some public or student-triggered actions had an account/email limit but no complementary IP/body control.

**Changes:** Added limits to verification resend and verification confirmation, video completion, enrollment creation, and explicit exam start. Added body limits to video completion and exam submission/start. Existing login, registration, contact, code redemption, checkout, and webhook controls were retained.

**Verification:** The focused request-limit regression test and full security suite pass.

### SEC-05 — exact payment amount enforcement

**Root cause:** The paid webhook condition rejected underpayment but accepted overpayment, and amount conversion did not reject values outside safe PostgreSQL integer bounds.

**Changes:** `app/api/payments/fawaterak/webhook/route.ts` now requires exact minor-unit and currency equality. `app/lib/fawaterak-crypto.ts` accepts only nonnegative values with at most two decimal places and bounds the result to the PostgreSQL integer range.

**Verification:** Payment idempotency/security tests, focused exact-amount tests, and unit tests pass. Both full and production-only npm audits report zero vulnerabilities.

### SEC-06 — exam lifecycle mutation and timeout race

**Root cause:** A read endpoint implicitly started/resumed an exam session. Expired session handling performed an insert and status update as separate operations, allowing concurrent requests to create duplicate timeout attempts.

**Changes:**

- Added `POST /api/exams/[id]/start` as the only start/resume mutation.
- Made `GET /api/exams/[id]` read-only and require an active, unexpired session.
- Changed `app/lib/exam-session.ts` to claim expiration and create the timeout attempt in one SQL CTE transaction path.
- Kept the existing atomic submit-session claim and added exam submit/start limits.
- Updated `QuizRunner` and the live E2E flow to call the explicit start endpoint.

**Verification:** Exam-session concurrency tests, focused source regression tests, full security tests, unit tests, typecheck, lint, and production build pass.

### SEC-07 — trusted proxy and audit identity

**Root cause:** Rate limiting correctly avoided arbitrary `X-Forwarded-For` by default, but production deployment had no enforced trusted header configuration and audit logging independently read spoofable forwarding headers.

**Changes:**

- Added `TRUSTED_PROXY_IP_HEADER` to the platform environment model.
- Production startup validation now requires `x-real-ip` or `cf-connecting-ip` and a valid HTTPS `APP_URL`.
- `app/lib/audit.ts` now uses the same trusted `getClientIp()` policy and bounds user-agent length.
- `.env.example` documents the required proxy overwrite behavior.

**Status rationale:** The application behavior is safe by default and production misconfiguration fails validation, but the live reverse proxy still must be configured and verified on the deployment host.

### SEC-08 — observability redaction

**Root cause:** Sensitive-key matching lowercased input keys while several configured entries were camel case; nested objects were copied without recursive redaction.

**Changes:** `app/lib/observability.ts` now uses normalized keys, redacts access/API/client/transaction secrets and codes, recursively sanitizes nested objects/arrays, and applies depth/item bounds.

**Verification:** Existing unit redaction tests and the focused observability regression test pass.

### SEC-09 — consistent security headers and CSP

**Root cause:** The global policy prohibited framing, while the isolated embed route only overrode X-Frame-Options and left the global CSP conflict in place.

**Changes:** `next.config.ts` now defines global production-aware CSP and security headers, and explicitly overrides both CSP and X-Frame-Options for `/api/videos/:id/embed`. Production HSTS is enabled. The embed response itself carries the same isolated policy.

**Verification:** Focused header/CSP regression tests and a successful production build pass. Live HTTP header verification remains a deployment follow-up because no server was available locally.

### SEC-10 — CI supply-chain controls

**Root cause:** The workflow used `npm audit ... || true`, which converted audit failure into success, and mutable action tags could move without a reviewed commit.

**Changes:** `.github/workflows/ci.yml` now runs full and production-only blocking audits, pins checkout/setup-node to immutable commit SHAs, supplies the production environment contract used by the build, and sets `permissions: contents: read`.

**Verification:** Focused CI source regression tests pass. `npm ci` remains the workflow install command, so `package-lock.json` integrity is enforced.

### SEC-11 — transactional email HTML injection

**Root cause:** `app/lib/email.ts` inserted user-/admin-controlled names and course titles, plus reset URLs, directly into HTML.

**Changes:** Added `escapeHtml()` and applied it to every dynamic email-body value. The reset URL is escaped for both attribute and text contexts.

**Verification:** A red-to-green email-template regression test now passes, along with lint, typecheck, unit, security, and build checks.

### SEC-12 — repository credential hygiene

**Root cause:** `.gitignore` covered environment files and PEM files but not common private key/container credential extensions, and CI token scope was implicit.

**Changes:** Added `*.key`, `*.p12`, and `*.pfx` ignores and narrowed CI permissions. No `.env` or real credential file was added.

**Verification:** Focused repository-hygiene test passes. The required secret scanner emitted heuristic matches for code variables and test fixtures but no hardcoded production credential value; tracked history review found no committed `.env` secret.

## Dependency and supply-chain results

No dependency upgrade was required: both baseline and post-remediation audits reported zero vulnerabilities.

| Audit | Before remediation | After remediation |
|---|---|---|
| `npm audit --audit-level=high --json` | 0 vulnerabilities; 455 total dependencies | 0 vulnerabilities; 455 total dependencies |
| `npm audit --omit=dev --audit-level=high --json` | 0 vulnerabilities; 32 production dependencies | 0 vulnerabilities; 32 production dependencies |
| Lockfile / installation | `package-lock.json` present | CI uses `npm ci` |
| GitHub Actions | Mutable major tags; audit bypass | Immutable SHAs; blocking full and production audits |

## Confirmation tests

| Check | Result | Evidence |
|---|---|---|
| TypeScript | **PASS** | `npm run typecheck` |
| ESLint | **PASS** | `npm run lint` |
| Security suite | **PASS** | `npm run test:security` — 38/38 |
| Unit suite | **PASS** | `node --test tests/unit.test.mjs` — 9/9 |
| Focused remediation suite | **PASS** | `tests/security-hardening-security.test.mjs` — 13/13 |
| Production build | **PASS** | `npm run build` with CI-like nonsecret build variables; standalone output packaged |
| Full npm test | **PASS under CI-like environment** | `npm test` requires the production environment contract now enforced by `next.config.ts`; the same contract is defined in CI |
| Full dependency audit | **PASS** | `npm audit --audit-level=high --json` — 0 |
| Production dependency audit | **PASS** | `npm audit --omit=dev --audit-level=high --json` — 0 |
| Secret scan | **Manual pass** | Scanner exit was caused by heuristic matches in source/test fixture assignments; no real secret value was found |
| Live platform E2E | **BLOCKED BY ENVIRONMENT** | `npm run test:e2e` cannot migrate because PostgreSQL is unavailable: `ECONNREFUSED 127.0.0.1:5432`; Docker is not available in this workspace |

The repository-wide Prettier check is not used as a release gate in this report: it currently flags broad pre-existing formatting drift across the workspace. ESLint, typecheck, tests, build, and dependency audits are the enforced CI gates.

## Residual risks and required follow-ups

1. Run `npm run db:migrate`, `npm test`, and `npm run test:e2e` on a host with PostgreSQL 16 available. The live E2E run must pass before final launch approval.
2. Deploy behind a reverse proxy that overwrites `X-Real-IP` or `CF-Connecting-IP`, blocks direct Node access, terminates TLS, and sets `TRUSTED_PROXY_IP_HEADER` consistently with that behavior.
3. Set a real HTTPS `APP_URL`, production email provider, strong random secrets, and valid bootstrap staff configuration. Never reuse the CI placeholder values.
4. Restrict `PRIVATE_STORAGE_DIR` to the application service account, keep it outside the web root, and define a documented retention/deletion policy for birth certificates and other PII.
5. Keep PostgreSQL private and use a non-default production database password; the local Compose defaults are for development only.
6. Treat YouTube completion as an honor/integrity signal rather than proof of physical viewing. If completion affects certification or high-stakes progression, add provider/player attestation and server-side progress evidence.
7. Revisit written-answer grading before using scores for high-stakes decisions; current rules are deterministic keyword coverage and can misgrade semantically correct answers.
8. Run a production HTTP header smoke test and an external dependency/image scan after deployment. This pass did not claim live TLS, proxy, provider, or host-hardening verification.

## Final verdict

**Application code:** ready from the reviewed security findings; no known Critical or High vulnerabilities remain open.
**Production deployment:** conditional / not yet fully verified because live PostgreSQL E2E, TLS, reverse proxy, storage permissions, provider configuration, and retention controls must still be validated.
