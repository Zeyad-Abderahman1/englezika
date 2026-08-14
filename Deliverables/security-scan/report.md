# Security Review: Englezika

## Scope

Whole current Englizeka repository, emphasizing security-sensitive product routes.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: target_sha256_7a997f48199816256d823da39333248fbfb15fc5e825c1b6b24cd13002ac642a
- Revision: 94980d831e6c59a6a03afbbd9ce7cd2564b7d580
- Snapshot digest: codex-security-snapshot/v1:sha256:f11a54c7d8f4108032701c945fada70ba00131ebeb7abbdb3fcf352032a3665b
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: Local PostgreSQL, API E2E, and browser available.
- Artifacts reviewed: package.json, database/migrations, app/api, app/lib, tests

Limitations and exclusions:
- Independent baseline fully reviewed 76 files.
- Excluded node_modules/\*\*: Third-party code; npm audit used.
- Excluded .next/\*\*: Generated output.
- Excluded .git/\*\*: Git history excluded.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 4 |
| Severity mix | medium: 4 |
| Confidence mix | high: 4 |
| Coverage | partial |
| Validation mode | Static trace plus focused tests. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Protect identities, private files, payment/enrollment state, video grants, lecture codes, and grades across browser, permission, database, storage, email and payment boundaries.

### Assets

- sessions
- private student data
- payment and enrollment state
- learning grants and grades

### Trust Boundaries

- browser to Next.js
- session to permissions
- application to PostgreSQL
- application to private storage
- payment webhook

### Attacker Capabilities

- anonymous requests
- student account
- restricted staff
- concurrent requests

### Security Objectives

- authentication
- least privilege
- ownership isolation
- atomic code redemption
- grade/payment integrity

### Assumptions

- Production uses a trusted proxy.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Video completion tokens prove elapsed time but not playback](#finding-1) | medium | high | inline below |
| [Exam sessions are started by a cross-site-triggerable GET request](#finding-2) | medium | high | inline below |
| [Short-answer grading can be manipulated with keyword stuffing](#finding-3) | medium | high | inline below |
| [Authentication rate limits collapse to a shared bucket without trusted proxy configuration](#finding-4) | medium | high | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Video completion tokens prove elapsed time but not playback

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Live E2E and source prove no playback checkpoint is required. |
| Category | business_logic |
| CWE | CWE-840 |
| Affected lines | app/lib/video-token.ts:97, app/lib/video-token.ts:143, app/api/videos/\[id\]/complete/route.ts:15 |

#### Summary

A token issued before playback becomes valid after elapsed time alone.

#### Root Cause

A token issued before playback becomes valid after elapsed time alone.

#### Validation

Live E2E and source prove no playback checkpoint is required.

Validation method: code understanding and focused local tests

#### Dataflow

Resolve -\> wait without playback -\> complete -\> progress row.

#### Reachability

Resolve -\> wait without playback -\> complete -\> progress row.

#### Severity

**Medium** — Reachable path with meaningful availability or integrity impact and prerequisites.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Track server-side playback sessions with sequential bounded checkpoints.

<a id="finding-2"></a>

### [2] Exam sessions are started by a cross-site-triggerable GET request

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Route trace proves GET invokes the database state transition. |
| Category | cross_site_request_forgery |
| CWE | CWE-352 |
| Affected lines | app/api/exams/\[id\]/route.ts:40, app/api/exams/\[id\]/route.ts:51, app/lib/exam-session.ts:45 |

#### Summary

GET creates/resumes a timed session, so top-level navigation with a Lax cookie can start a victim timer.

#### Root Cause

GET creates/resumes a timed session, so top-level navigation with a Lax cookie can start a victim timer.

#### Validation

Route trace proves GET invokes the database state transition.

Validation method: code understanding and focused local tests

#### Dataflow

Known exam link -\> victim GET -\> timer and possible expired attempt.

#### Reachability

Known exam link -\> victim GET -\> timer and possible expired attempt.

#### Severity

**Medium** — Reachable path with meaningful availability or integrity impact and prerequisites.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Make GET read-only and add a same-origin POST start action.

<a id="finding-3"></a>

### [3] Short-answer grading can be manipulated with keyword stuffing

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | The formula reaches full score whenever expected tokens occur despite arbitrary extra text. |
| Category | business_logic |
| CWE | CWE-20 |
| Affected lines | app/lib/grading.ts:34, app/lib/grading.ts:37, app/api/exams/\[id\]/route.ts:135 |

#### Summary

Recall-only token coverage awards points without penalizing unrelated text.

#### Root Cause

Recall-only token coverage awards points without penalizing unrelated text.

#### Validation

The formula reaches full score whenever expected tokens occur despite arbitrary extra text.

Validation method: code understanding and focused local tests

#### Dataflow

Student text -\> token set -\> coverage -\> authoritative score.

#### Reachability

Student text -\> token set -\> coverage -\> authoritative score.

#### Severity

**Medium** — Reachable path with meaningful availability or integrity impact and prerequisites.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Use manual grading or a bounded provisional rubric with relevance and precision controls.

<a id="finding-4"></a>

### [4] Authentication rate limits collapse to a shared bucket without trusted proxy configuration

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Source and atomic limiter tests confirm the shared key. |
| Category | denial_of_service |
| CWE | CWE-400 |
| Affected lines | app/lib/rate-limit.ts:15, app/api/auth/login/route.ts:11, app/api/staff/login/route.ts:9 |

#### Summary

Without a trusted proxy header, all clients share one rate-limit identifier.

#### Root Cause

Without a trusted proxy header, all clients share one rate-limit identifier.

#### Validation

Source and atomic limiter tests confirm the shared key.

Validation method: code understanding and focused local tests

#### Dataflow

Anonymous login requests reach one PostgreSQL counter.

#### Reachability

Anonymous login requests reach one PostgreSQL counter.

#### Severity

**Medium** — Reachable path with meaningful availability or integrity impact and prerequisites.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Require and validate a trusted proxy IP source; combine per-client and per-account throttles.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Authentication and sessions | not recorded | Reported | No additional canonical notes were recorded. |
| Staff authorization | not recorded | No issue found | No additional canonical notes were recorded. |
| Videos and lecture codes | not recorded | Reported | No additional canonical notes were recorded. |
| Exams and grading | not recorded | Reported | No additional canonical notes were recorded. |
| Payments and enrollment | not recorded | No issue found | No additional canonical notes were recorded. |
| Private storage/account lifecycle | not recorded | No issue found | No additional canonical notes were recorded. |
| Assignment submission | not recorded | Not applicable | No additional canonical notes were recorded. |

## Open Questions And Follow Up

- Playback attestation and free-text grading policy.
- 76 security-relevant files fully reviewed, not all 375.
  - Follow-up prompt: Review deferred unit deferred-496ec96a19fe87fb and close its stated proof gap.
- Real payment/email behavior excluded.
  - Follow-up prompt: Review deferred unit deferred-622044dac84dfed4 and close its stated proof gap.
