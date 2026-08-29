# Englizeka Prelaunch Verification Report

Date: 2026-08-29
Workspace: `D:\Englezika`
Verdict: **NOT READY TO PUBLISH**

This pass used a disposable local PostgreSQL 16 instance and synthetic accounts/data. No real payment was sent, no uncontrolled email was sent, and no production secret was written or committed. Existing unrelated working-tree changes were preserved.

## Checklist status

| Step | Status | Observed evidence | Remaining action |
|---|---|---|---|
| 1. Verify it actually works | **Verified** | Fresh PostgreSQL 16, migrations, full test suite, lecture-code integration, and enhanced live E2E all passed. | None for the tested local release candidate. |
| 2. Lock down the network path | **Blocked-in-this-environment** | `getClientIp()` and audit logging correctly read `x-real-ip` in a runtime probe; no production reverse proxy, DNS, TLS endpoint, or Nginx is available here. | Deploy behind Nginx/Caddy/Cloudflare, overwrite the chosen client-IP header, block the Node port, then verify externally. |
| 3. Production environment values | **Blocked-in-this-environment** | Only synthetic CI/local values were available. No real HTTPS origin, provider credentials, delivery mailbox, production secrets, or production bootstrap account were supplied. | Configure these in the deployment secret manager and send a real test email. |
| 4. Storage and data | **Blocked-in-this-environment** | Local storage is outside `public` and deletion ordering passed, but the local ACL is broad and no production service account/database host exists to verify. | Set production storage ownership/permissions, retention jobs, private DB binding, and a strong non-default DB password on the target host. |
| 5. Post-deploy smoke test | **Blocked-in-this-environment** | Local production-mode headers and embed behavior passed; dependency audit found 0 vulnerabilities. There is no deployed app URL or app container image to scan. | Run the same checks against the live URL and deployed image after deployment. |
| 6. Product decisions | **Deferred-as-follow-up** | Questions remain open below; no policy was chosen unilaterally. | Product owner decision required. |

## Step 1 — executed evidence

### Database and migrations

- Started disposable image `postgres:16-alpine` with host binding `127.0.0.1:55432`.
- `pg_isready`: healthy.
- `npm run db:migrate`: **PASS**. Applied `001_initial.sql`, `002_dashboard_performance.sql`, `002_deleted_account_re_registration.sql`, `003_one_time_video_access_codes.sql`, and `004_assignment_system.sql`.
- Fresh database post-check: `5 migrations_applied`, `27 tables_created`.
- The disposable container was removed after verification.

### Automated tests

- `npm test`: **PASS**.
  - Security tests: **38/38 passed**.
  - Unit tests: **9/9 passed**.
  - Production build: **PASS**, including standalone asset preparation and 41 generated routes.
- `npm run test:lecture-code:postgres` with `LECTURE_CODE_INTEGRATION_TEST=1`: **2/2 passed**.
- `npm run typecheck`: **PASS**.
- `npm run lint`: **PASS**.
- `npm audit --audit-level=high`: **0 vulnerabilities**.
- `npm audit --audit-level=high --omit=dev`: **0 vulnerabilities**.

### Enhanced live E2E

`npm run test:e2e`: **PASS** against the fresh PostgreSQL database.

Observed output:

```text
E2E PASS: auth, reset, one-time lecture code generation/redemption/isolation,
course/exam editing, assignment submission and duplicate rejection,
signed payment webhook approval/idempotency, read notifications, payment,
quiz timing/gate/expiry, completion proof, storage deletion, and staff permissions
```

The live run specifically proved:

- Exam start/resume uses one session; a forcibly expired session is claimed, produces one `expired` timeout attempt, and a new session can then start.
- Quiz submission succeeds once and preserves the expected result.
- A verified/enrolled student submits a valid private PDF assignment (`200`), sees `submitted`/`hasPdf=1`, and a duplicate submission is rejected (`409`).
- A signed paid payment webhook approves the enrollment (`200`, `status: ok`) and an identical replay is idempotent (`200`, `status: ok`). This was a local signed simulation using a test-only vendor key, not a real gateway transaction.
- An authorized student opens the YouTube embed frame (`200`), response includes `new YT.Player`, `frame-ancestors 'self'`, and `X-Frame-Options: SAMEORIGIN`.

The first enhanced run exposed only a test-harness defect: `pg` rejected two parameterized SQL commands sent as one prepared statement (`42601`). The harness was corrected to issue two parameterized queries; the fresh rerun passed. No exam, assignment, or payment application regression was found.

Post-journey PostgreSQL invariants:

```text
migrations|5
assignment_submissions|submitted:1
payment_intents|paid:1
attempts|expired:1
attempts|submitted:1
exam_sessions|active:1
video_progress|1
lecture_codes_redeemed|1
audit_payment_approved|1
```

## Steps 2–4 — deployment controls

### Network path

The reference [PRODUCTION_SECURITY_DEPLOYMENT.md](D:\Englezika\PRODUCTION_SECURITY_DEPLOYMENT.md) contains an Nginx design, but it is not evidence of deployment. This host reported `NGINX_NOT_FOUND`, has no configured production domain/TLS certificate, and has no proxy target to inspect. Direct Node-process blocking is therefore unverified.

The local runtime probe used `TRUSTED_PROXY_IP_HEADER=x-real-ip` with both `x-real-ip=198.51.100.77` and a conflicting `x-forwarded-for`; `getClientIp()` returned `198.51.100.77`. A real audit row recorded the same IP. The deployer must still prove that the proxy overwrites this header from the connection address and that only the proxy can reach Node.

### Production environment

`.env` was absent; `.env.local` exists as a local-only file and was not treated as production evidence or committed. The passing build/test commands used ephemeral CI/test placeholders. They prove validation behavior, not production readiness.

Not verified here:

- Real HTTPS `APP_URL` and matching public DNS.
- A real transactional email provider and delivery to a real test mailbox.
- Fresh production secrets and proof they are not reused from CI/dev.
- A production bootstrap staff/admin account.

The synthetic E2E bootstrap teacher was valid and authenticated successfully, but must not be reused as the production account.

### Storage, deletion, and database

- `PRIVATE_STORAGE_DIR` resolved to `D:\Englezika\storage\private`, outside `D:\Englezika\public`; local production smoke requests to `/storage/private/does-not-exist` returned `404`, and no public route references the private directory.
- The actual local ACL includes `NT AUTHORITY\Authenticated Users` with Modify and `BUILTIN\Users` with Read/Execute. This is not an application-service-account-only production ACL and is therefore a blocker, not a PASS.
- The live E2E and security test both confirmed birth-certificate deletion happens before account tombstoning; a storage-delete failure leaves the account retryable.
- Proposed operational retention policy: birth certificates and other identity PII remain only in private storage while needed for verification; access is limited to authorized staff; successful account deletion removes the certificate before tombstoning; orphaned unreferenced files are swept by the existing cleanup job; assignment submissions require a separate retention period approved by product/legal before launch. This policy needs deployment-owner/legal sign-off.
- The test PostgreSQL port was observed bound only to `127.0.0.1:55432` with a disposable non-production password. Production PostgreSQL binding, firewall rules, and a real non-default password remain unverified.

## Step 5 — local smoke and deployment gaps

A local `NODE_ENV=production` standalone server was started with synthetic values. Requests returned:

- `/`: `200`, global CSP with `frame-ancestors 'none'`, HSTS `max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict referrer policy, and restrictive permissions policy.
- `/api/videos/invalid/embed`: `401`, with the intentional embed override CSP (`frame-ancestors 'self'`) and `X-Frame-Options: SAMEORIGIN`.
- `/storage/private/does-not-exist`: `404`.

This is not a live-site check. No deployed app URL was supplied. No application Docker image exists locally; the only Docker image present for this verification was PostgreSQL 16. Trivy and Grype are not installed, so an image scan against the deployed build remains blocked.

## Step 6 — decisions required

1. Should YouTube lesson completion require stronger proof of actual playback before it can gate certification or progression? If yes, create a follow-up ticket for playback-attestation design; do not silently change this policy during deployment.
2. Is keyword-based written-answer grading acceptable for the current stakes, or must high-stakes decisions require human/model review? If review is required, create a follow-up ticket for the grading workflow.

## Files changed in this pass

- `tests/live-platform-e2e.mjs`: focused live assertions for assignment submission, webhook idempotency, exam expiry, and authorized embed framing.
- `PRELAUNCH_VERIFICATION_REPORT.md`: this report.

No `.env` file, credential, production proxy config, or real secret was created or committed. All unrelated pre-existing working-tree changes were preserved.

**Final verdict: NOT READY TO PUBLISH — production proxy/TLS, environment/email/secrets/bootstrap, storage/database controls, and live post-deploy verification remain blocked by missing deployment access; the two product decisions above are still open.**
