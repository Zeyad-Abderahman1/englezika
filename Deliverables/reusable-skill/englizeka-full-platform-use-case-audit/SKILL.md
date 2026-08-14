---
name: englizeka-full-platform-use-case-audit
description: Execute and document Englizeka full-platform acceptance, regression, and role/permission verification. Use for repository-wide feature audits, release-readiness checks, major user-journey regression, or updates to FULL_PLATFORM_USE_CASE_CHECKLIST.md, FULL_PLATFORM_USE_CASE_MATRIX.md, and FULL_PLATFORM_ACCEPTANCE_REPORT.md.
---

# Englizeka Full Platform Use-Case Audit

## Preserve evidence integrity

1. Capture `git status` before work; preserve all unrelated changes.
2. Read the current `AGENTS.md` and relevant Next.js 16 docs under `node_modules/next/dist/docs/` before code edits.
3. Treat source as feature inventory, not proof of PASS. Use PASS only for executed behavior.
4. Use synthetic users/content and local PostgreSQL. Never send real payments or uncontrolled email.
5. Report unavailable features as NOT IMPLEMENTED and concrete environment limits as BLOCKED.

## Actual role model

- Student states: anonymous, unverified, verified without enrollment, enrolled, exact-video lecture grant.
- Staff roles: `teacher` and `assistant`.
- Assistant presets: `grader`, `course_manager`, `enrollment_manager`.
- Permissions: `manage_courses`, `manage_exams`, `manage_assignments`, `manage_videos`, `manage_enrollments`, `grade_exams`, `manage_announcements`, `manage_messages`, `view_students`, `manage_staff`.
- Student and staff sessions are separate and must never substitute for one another.

## Critical executable journeys

Run the repository commands from `package.json`; do not invent aliases.

1. Apply local migrations and prove PostgreSQL is healthy.
2. Execute `npm run test:security`, `node --test tests/unit.test.mjs`, the lecture-code PostgreSQL suite with `LECTURE_CODE_INTEGRATION_TEST=1`, and `npm run test:e2e`.
3. Exercise teacher course → exam → assignment → two lectures → lecture code.
4. Exercise student registration → verification → enrollment approval → exam/result → gated lesson → completion → exact-video code grant → password reset/re-login.
5. Prove grader and course-manager negative/positive permission boundaries.
6. Query PostgreSQL after the journey for course relationships, enrollment, attempt, progress, code consumption, and grant cardinality.
7. Use the real browser for student and staff UI checks. Validate 320, 360, 390, 430, 768, and 1440 widths, Arabic RTL, page overflow, named controls, console errors, and failed requests. Save evidence under `docs/uiux/`.
8. Run `npm run typecheck`, `npm run lint`, `npm audit`, and `npm run build` after fixes.

## Known feature boundary

Assignment authoring and dashboard visibility exist. Assignment submission/upload/download, submission records, assignment grading/feedback, and student assignment-grade display do not exist as of the baseline audit. Rediscover before every audit; do not assume this remains true.

Video content is YouTube-backed; server video upload is intentionally absent. Birth certificates are the implemented private-upload surface.

## Security priorities

Validate same-origin enforcement, trusted proxy/client identity, student/staff separation, object ownership, private certificate access, payment webhook signature/amount/idempotency, exam session transitions, grading integrity, video access/completion, lecture-code hashing/atomicity, and restricted staff metadata.

For a proven small defect with unambiguous behavior, add a focused regression, patch minimally, and rerun the exact use case plus neighboring gates. Leave product-policy changes as NEEDS DECISION.

## Required artifacts

Keep these synchronized with executed evidence:

- `FULL_PLATFORM_USE_CASE_CHECKLIST.md`: checkbox catalog and status for every discovered major case.
- `FULL_PLATFORM_USE_CASE_MATRIX.md`: actor, preconditions, execution, expected/observed, status, evidence.
- `FULL_PLATFORM_ACCEPTANCE_REPORT.md`: inventory, role matrix, data, results, bugs, blockers, deployment requirements, dashboard, and verdict.

Allowed verdicts: READY, READY WITH DEPLOYMENT REQUIREMENTS, PARTIALLY READY, NOT READY. Never use READY with a critical failed journey, authorization/data-isolation failure, or material blocker.
