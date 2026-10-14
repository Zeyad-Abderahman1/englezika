# ENGLIZEKA PLATFORM: COMPREHENSIVE SYSTEM BLUEPRINT & ARCHITECTURE DOSSIER

> **Document Version:** 1.0.0  
> **Target System:** Englizeka (Educational Platform for Mr. Ahmed Hassan)  
> **Repository:** `Zeyad-Abderahman1/englezika`  
> **Workspace Root:** `d:\mr ahmed hassan`  
> **Target Audience:** Lead Architects, Systems Engineers, Security Auditors, AI Coding Agents  
> **Specification Standard:** Zero Placeholders, Source-Verified, Production Ground Truth  

---

## 1. System Overview & Purpose

### 1.1 Platform Goal
**Englizeka** is an Arabic-first educational web platform designed specifically for the teaching operations of **Mr. Ahmed Hassan**, an Egyptian English language educator. The platform provides a centralized, secure digital environment for high-school and preparatory stage students to access curriculum courses, watch protected video lectures, complete timed anti-cheat exams, submit assignments, track grades, and make digital payments.

### 1.2 Target Personas & Stakeholders
1. **Students (الطلاب):**
   - Egyptian preparatory and secondary school students.
   - Core activities: Registration with official academic data (governorate, parent phones, school name, section, and verified Egyptian birth certificate), browsing monthly packages, paying via Fawaterak, redeeming single-use lecture access vouchers (`ENG-...`), watching sequential YouTube lectures with watermark overlay and playback time gating, taking server-timed exams with anti-cheat monitoring, and viewing performance analytics.
2. **Parents (أولياء الأمور):**
   - Secondary recipients of progress reporting; emergency and follow-up contacts registered via father/mother phone numbers.
3. **Teaching Assistants & Staff (المساعدون):**
   - Support staff operating under strict Role-Based Access Control (RBAC):
     * **Grader (المصحح):** Evaluates student exam attempts, adjusts scores, and leaves pedagogical feedback.
     * **Course Manager (مدير المحتوى):** Creates and edits courses, schedules lectures, uploads assignments, and configures exam questionnaires.
     * **Enrollment Manager (مدير الاشتراكات):** Reviews offline/online payment requests, validates student documents, and approves/rejects course enrollments.
4. **Primary Teacher / Super-Admin (Mr. Ahmed Hassan):**
   - Holder of `full_access` permissions. Oversees staff delegating, financial reports, system audits, platform announcements, student profiles, code generation, and course publishing.

### 1.3 Core Business Model
- **Monthly Package Subscriptions:** Courses are structured as monthly curriculum units (e.g., September, October, Revision) with fixed prices in Egyptian Pounds (EGP).
- **Dual Payment & Access Streams:**
  1. **Automated Digital Gateways:** Fawaterak hosted checkout (Credit/Debit Card, Meeza, Fawry reference codes, Mobile Wallets) with server-to-server webhook confirmation.
  2. **Offline / Physical Voucher Access:** In-person center students purchase printed scratch cards with unique one-time codes (`ENG-XXXXX-XXXXX...`) that grant immediate access to an individual video lecture without enrolling in the full monthly course package.
  3. **Manual Administrative Enrollment:** Staff enrollment manager can manually approve bank transfers, Vodafone Cash receipts, or in-person cash payments.

---

## 2. Full Tech Stack & Dependencies

### 2.1 Core Framework & Runtime
- **Runtime Environment:** Node.js `>= 22.13.0` (Active LTS). Leverages native Node `crypto`, `Buffer`, native Node test runner (`node --test`), and the native `node:cluster` module.
- **Application Framework:** **Next.js 16.3.0** utilizing the App Router architecture. Configured with `output: 'standalone'` in [next.config.ts](file:///d:/mr%20ahmed%20hassan/next.config.ts) for containerized and multi-process deployments.
- **Rendering & UI Library:** **React 19.2.8** and **React DOM 19.2.8** leveraging Server Components (RSC), Client Components (`'use client'`), and Server Actions.
- **Type System:** **TypeScript 5.9.3** running in strict mode (`"strict": true` in [tsconfig.json](file:///d:/mr%20ahmed%20hassan/tsconfig.json)).

### 2.2 Styling & Frontend Design System
- **CSS Framework:** **Tailwind CSS 4.2.1** integrated via `@tailwindcss/postcss` (v4.2.1).
- **Core Design System:** Implemented across [globals.css](file:///d:/mr%20ahmed%20hassan/app/globals.css) and [design-system.css](file:///d:/mr%20ahmed%20hassan/app/design-system.css):
  - **Directionality:** Native Arabic-first Right-to-Left (`dir="rtl"`) with strict LTR isolation for access codes, timestamps, and mathematical scores.
  - **Color Palette Tokens:**
    * Dark Navy Backgrounds: Deep Midnight (`#050C1A`), Navy Card (`#0A192F`), Border Tone (`#1E293B`).
    * Accents: Emerald Green Accent (`#10B981` / `#059669`), Imperial Amber/Gold (`#F59E0B` / `#D97706`), Crimson/Ruby Warning (`#EF4444` / `#DC2626`).
  - **Typography:** Cairo font family imported from Google Fonts (`fonts.googleapis.com`), with fallbacks to system-ui sans-serif.
  - **UI Component Utilities:** Bespoke glassmorphism, glowing borders, animated gradients, and accessibility-compliant skip-links and focus states.
- **Icons:** **lucide-react** (v1.25.0).

### 2.3 Backend Libraries & Database Drivers
- **Database Driver:** **`pg` (v8.16.3)** with `@types/pg` (v8.15.5). Pure parameterized PostgreSQL client utilizing `Pool`. No heavy ORM (such as Prisma or Drizzle) is executed at runtime, ensuring direct control over connection pooling, query batching, and transaction locks.
- **Email Delivery:** **`nodemailer` (v9.0.3)** with `@types/nodemailer` (v8.0.1) for SMTP and Gmail App Password transports. Direct REST integration for Resend API (`api.resend.com/emails`).
- **Code Formatting & Linting:** `eslint` (v9.39.4), `eslint-config-next` (v16.2.12), and `prettier` (v3.9.6).

### 2.4 External Services & Third-Party Integrations
1. **Database:** PostgreSQL 16+ (Dockerized in [compose.yaml](file:///d:/mr%20ahmed%20hassan/compose.yaml), managed with custom advisory-locked migration runner [scripts/migrate.mjs](file:///d:/mr%20ahmed%20hassan/scripts/migrate.mjs)).
2. **Payment Gateway (Fawaterak):**
   - Endpoint: `https://staging.fawaterk.com` (Test) / `https://app.fawaterk.com` (Live).
   - Integration: Hosted invoice checkout API (`/api/v2/createInvoiceLink`) + Webhook receiver with HMAC-SHA256 signature verification.
3. **Video Delivery (YouTube Embedded CDN):**
   - Integration: Custom sandboxed YouTube iframe player with restricted referrer policy, disabled native controls, blocked context menu, and client-side watermarking.
4. **Email Services:**
   - Provider Options:
     * **Resend:** HTTP REST API via `RESEND_API_KEY`.
     * **Gmail SMTP:** `smtp.gmail.com:465` via `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
     * **Generic / ServerSMTP:** SMTP relay configured via `SERVERSMTP_CONSUMER_KEY` and `SERVERSMTP_CONSUMER_SECRET`.
5. **Private Document Storage:**
   - Local protected directory (`storage/private`) managed via [app/lib/private-storage.ts](file:///d:/mr%20ahmed%20hassan/app/lib/private-storage.ts), preventing direct web-server exposure of student birth certificates.

---

## 3. Database Schema & Data Architecture (`/database`)

The platform's data layer runs on PostgreSQL 16 and is governed by sequential migration scripts in `database/migrations/`:
- `001_initial.sql`: Core tables, indexes, relations, and initial schema.
- `002_dashboard_performance.sql`: Specialized partial composite indexes for fast student dashboard queries.
- `002_deleted_account_re_registration.sql`: Student account tombstoning, original email retention, and single-active-enrollment unique indexes.
- `003_one_time_video_access_codes.sql`: Tables and constraints for single-use lecture voucher generation and redemption.

```mermaid
erDiagram
    users ||--o{ enrollments : "places"
    users ||--o{ payment_intents : "initiates"
    users ||--o{ attempts : "submits"
    users ||--o{ exam_sessions : "holds"
    users ||--o{ video_progress : "completes"
    users ||--o{ student_video_access_grants : "receives"
    users ||--o{ native_sessions : "authenticates"
    
    courses ||--o{ videos : "contains"
    courses ||--o{ exams : "contains"
    courses ||--o{ assignments : "contains"
    courses ||--o{ enrollments : "enrolled_in"
    courses ||--o{ lecture_access_codes : "scoped_to"
    
    exams ||--o{ questions : "contains"
    exams ||--o{ attempts : "evaluated_in"
    exams ||--o{ exam_sessions : "tracks"
    attempts ||--o{ answers : "records"
    
    videos ||--o{ video_progress : "tracked_by"
    videos ||--o{ lecture_access_codes : "unlocked_by"
    videos ||--o{ student_video_access_grants : "granted_to"
    
    staff_users ||--o{ staff_sessions : "maintains"
    staff_users ||--o{ lecture_access_codes : "creates"
    
    lecture_access_codes ||--o| student_video_access_grants : "converts_to"
```

### 3.1 Entity Breakdown & Table Specifications

#### 3.1.1 Authentication & Session Tables
- **`schema_migrations`**:
  * `name` (TEXT PK): Migration filename (e.g., `001_initial.sql`).
  * `applied_at` (BIGINT NOT NULL): Epoch timestamp in seconds.
- **`native_sessions`**:
  * `session_hash` (TEXT PK): SHA-256 hash of the 32-byte client session token.
  * `email` (TEXT NOT NULL REFERENCES `users(email)` ON DELETE CASCADE).
  * `expires_at` (BIGINT NOT NULL): Absolute expiration timestamp (30 days TTL).
  * `created_at` (BIGINT NOT NULL).
- **`staff_users`**:
  * `email` (TEXT PK): Staff email identifier.
  * `name` (TEXT NOT NULL): Display name.
  * `role` (TEXT NOT NULL): High-level role descriptor (`teacher`, `assistant`, `admin`).
  * `permissions` (TEXT NOT NULL): JSON-serialized string array of discrete permissions (e.g. `["view_students","grade_exams"]`).
  * `password_hash`, `password_salt` (TEXT NOT NULL), `password_iterations` (INTEGER NOT NULL): PBKDF2-SHA512 parameters (100,000 iterations).
  * `active` (INTEGER NOT NULL DEFAULT 1): Soft-disable switch.
  * `failed_attempts` (INTEGER NOT NULL DEFAULT 0), `locked_until` (BIGINT): Brute-force lockout state.
  * `created_by` (TEXT NOT NULL), `created_at` (BIGINT NOT NULL), `updated_at` (BIGINT NOT NULL).
- **`staff_sessions`**:
  * `token_hash` (TEXT PK): SHA-256 hash of the staff session cookie.
  * `staff_email` (TEXT NOT NULL REFERENCES `staff_users(email)` ON DELETE CASCADE).
  * `expires_at` (BIGINT NOT NULL): 12-hour expiration window.
  * `created_at` (BIGINT NOT NULL), `last_seen` (BIGINT NOT NULL).
- **`email_verifications`**:
  * `email` (TEXT PK): Target recipient email.
  * `code_hash` (TEXT NOT NULL): SHA-256 hash of the 6-digit OTP code.
  * `expires_at` (BIGINT NOT NULL): 10-minute expiry window.
  * `attempts` (INTEGER NOT NULL DEFAULT 0): Brute-force counter on code verification.
  * `sent_at` (BIGINT NOT NULL), `verified_at` (BIGINT), `delivery_id` (TEXT).
- **`password_reset_codes`**:
  * `email` (TEXT PK): Target recipient email.
  * `code_hash` (TEXT NOT NULL): SHA-256 hash of the single-use reset OTP code.
  * `expires_at` (BIGINT NOT NULL): 15-minute expiry.
  * `attempts` (INTEGER NOT NULL DEFAULT 0), `sent_at` (BIGINT NOT NULL), `consumed_at` (BIGINT), `delivery_id` (TEXT).

#### 3.1.2 Student & Academic Profiles
- **`users`**:
  * `email` (TEXT PK): Student primary email (or tombstoned email `deleted_{timestamp}_{random}@deleted.local`).
  * `original_email` (TEXT): Retained if account is deleted to allow clean re-registration.
  * `name`, `first_name`, `second_name`, `third_name`, `last_name` (TEXT NOT NULL DEFAULT ''): Four-part Arabic naming standard.
  * `phone` (TEXT): Student personal phone number.
  * `father_phone`, `mother_phone` (TEXT NOT NULL DEFAULT ''): Parental contact numbers.
  * `school_name`, `parent_job`, `governorate`, `gender`, `section` (TEXT): Academic & demographic data.
  * `grade` (TEXT): Educational stage (e.g., `sec1`, `sec2`, `sec3`).
  * `role` (TEXT NOT NULL DEFAULT 'student'): Role descriptor (`student` or `deleted`).
  * `email_verified` (INTEGER NOT NULL DEFAULT 0): Boolean flag (0 = unverified, 1 = verified).
  * `birth_certificate_key` (TEXT), `birth_certificate_content_type` (TEXT): Identifier of encrypted local private document.
  * `account_use_agreement_accepted_at` (BIGINT), `account_use_agreement_version` (TEXT).
  * `password_hash`, `password_salt`, `password_iterations` (PBKDF2 credentials).
  * `failed_attempts` (INTEGER NOT NULL DEFAULT 0), `locked_until` (BIGINT): Lockout control.
  * `created_at`, `updated_at` (BIGINT NOT NULL).

#### 3.1.3 Courses, Lectures & Access Vouchers
- **`courses`**:
  * `id` (TEXT PK): Unique slug/UUID.
  * `title` (TEXT NOT NULL), `grade` (TEXT NOT NULL), `description` (TEXT NOT NULL DEFAULT '').
  * `price` (INTEGER NOT NULL DEFAULT 0): Base price in Egyptian Pounds (EGP).
  * `status` (TEXT NOT NULL DEFAULT 'draft'): Enum (`draft`, `published`, `archived`).
  * `created_at`, `updated_at` (BIGINT NOT NULL).
- **`videos`**:
  * `id` (TEXT PK): Video lecture UUID.
  * `course_id` (TEXT NOT NULL REFERENCES `courses(id)` ON DELETE CASCADE).
  * `title` (TEXT NOT NULL).
  * `source_type` (TEXT NOT NULL DEFAULT 'youtube'): Currently restricted to `'youtube'`.
  * `source_url` (TEXT), `youtube_id` (TEXT): Extracted 11-character YouTube video ID.
  * `duration_seconds` (INTEGER NOT NULL DEFAULT 0): Total run time.
  * `prerequisite_exam_id` (TEXT REFERENCES `exams(id)` ON DELETE SET NULL): Optional prerequisite exam required prior to playback.
  * `minimum_score` (INTEGER NOT NULL DEFAULT 0): Passing score percentage required on prerequisite exam.
  * `status` (TEXT NOT NULL DEFAULT 'published'): Enum (`draft`, `published`).
  * `created_at` (BIGINT NOT NULL).
- **`video_progress`**:
  * `id` (TEXT PK).
  * `user_email` (TEXT NOT NULL REFERENCES `users(email)` ON DELETE CASCADE).
  * `video_id` (TEXT NOT NULL REFERENCES `videos(id)` ON DELETE CASCADE).
  * `completed_at` (BIGINT NOT NULL).
  * Constraint: `UNIQUE (user_email, video_id)`.
- **`lecture_access_codes`**:
  * `id` (TEXT PK): Voucher identifier UUID.
  * `code_hash` (TEXT UNIQUE NOT NULL): SHA-256 hash of normalized plaintext code.
  * `display_suffix` (TEXT NOT NULL): Last 5 characters of the code for administrative reference.
  * `course_id` (TEXT NOT NULL REFERENCES `courses(id)` ON DELETE CASCADE).
  * `video_id` (TEXT NOT NULL REFERENCES `videos(id)` ON DELETE CASCADE).
  * `created_by_staff_email` (TEXT REFERENCES `staff_users(email)` ON DELETE SET NULL).
  * `created_at` (BIGINT NOT NULL).
  * `redeemed_by_student_email` (TEXT REFERENCES `users(email)` ON DELETE SET NULL).
  * `redeemed_at` (BIGINT).
  * Check Constraint: `redeemed_by_student_email IS NULL OR redeemed_at IS NOT NULL`.
- **`student_video_access_grants`**:
  * `id` (TEXT PK).
  * `student_email` (TEXT NOT NULL REFERENCES `users(email)` ON DELETE CASCADE).
  * `video_id` (TEXT NOT NULL REFERENCES `videos(id)` ON DELETE CASCADE).
  * `source` (TEXT NOT NULL DEFAULT 'one_time_code' CHECK (`source = 'one_time_code'`)).
  * `source_access_code_id` (TEXT UNIQUE REFERENCES `lecture_access_codes(id)` ON DELETE SET NULL).
  * `created_at` (BIGINT NOT NULL).
  * Constraint: `UNIQUE (student_email, video_id)`.

#### 3.1.4 Enrollments & Payments
- **`enrollments`**:
  * `id` (TEXT PK): Enrollment UUID.
  * `user_email` (TEXT NOT NULL REFERENCES `users(email)` ON DELETE CASCADE).
  * `course_id` (TEXT NOT NULL REFERENCES `courses(id)` ON DELETE CASCADE).
  * `status` (TEXT NOT NULL DEFAULT 'pending'): Enum (`pending`, `approved`, `rejected`, `cancelled`).
  * `payment_method` (TEXT): E.g. `fawaterak`, `manual_cash`, `vodafone_cash`.
  * `payment_reference` (TEXT): Invoice or transaction ID.
  * `created_at`, `updated_at` (BIGINT NOT NULL).
  * Partial Unique Index: `UNIQUE (user_email, course_id) WHERE status = 'pending'`.
- **`payment_intents`**:
  * `id` (TEXT PK): Internal transaction ID.
  * `enrollment_id` (TEXT NOT NULL REFERENCES `enrollments(id)` ON DELETE CASCADE).
  * `user_email` (TEXT NOT NULL REFERENCES `users(email)` ON DELETE CASCADE).
  * `course_id` (TEXT NOT NULL REFERENCES `courses(id)` ON DELETE CASCADE).
  * `gateway` (TEXT NOT NULL DEFAULT 'fawaterak').
  * `transaction_key` (TEXT UNIQUE): Fawaterak invoice key / ID.
  * `transaction_id` (TEXT): Gateway payment confirmation reference.
  * `amount_minor` (INTEGER NOT NULL): Amount in piastres (e.g. 15000 = 150.00 EGP).
  * `paid_amount_minor` (INTEGER): Confirmed paid amount.
  * `currency` (TEXT NOT NULL DEFAULT 'EGP').
  * `status` (TEXT NOT NULL DEFAULT 'creating'): Enum (`creating`, `created`, `paid`, `failed`, `expired`).
  * `payment_method` (TEXT).
  * `created_at`, `updated_at`, `paid_at` (BIGINT).
  * Partial Unique Index: `UNIQUE (enrollment_id) WHERE status IN ('creating', 'created')`.

#### 3.1.5 Examinations, Quizzes & Assignments
- **`exams`**:
  * `id` (TEXT PK): Exam UUID.
  * `course_id` (TEXT REFERENCES `courses(id)` ON DELETE SET NULL).
  * `title` (TEXT NOT NULL), `description` (TEXT), `instructions` (TEXT).
  * `duration_minutes` (INTEGER NOT NULL DEFAULT 30).
  * `passing_score` (INTEGER NOT NULL DEFAULT 50): Percentage threshold.
  * `max_attempts` (INTEGER NOT NULL DEFAULT 3).
  * `status` (TEXT NOT NULL DEFAULT 'draft'): Enum (`draft`, `published`, `archived`).
  * `opens_at`, `closes_at` (BIGINT).
  * `created_by` (TEXT NOT NULL), `created_at`, `updated_at` (BIGINT NOT NULL).
- **`questions`**:
  * `id` (TEXT PK).
  * `exam_id` (TEXT NOT NULL REFERENCES `exams(id)` ON DELETE CASCADE).
  * `sort_order` (INTEGER NOT NULL).
  * `type` (TEXT NOT NULL): Enum (`multiple_choice`, `true_false`, `short_answer`).
  * `prompt` (TEXT NOT NULL): Question stem.
  * `options` (TEXT): JSON-serialized array of option strings for multiple-choice.
  * `correct_answer` (TEXT NOT NULL): Answer string or option index.
  * `rubric` (TEXT NOT NULL DEFAULT ''): Grading criteria / keywords for written questions.
  * `points` (INTEGER NOT NULL DEFAULT 1).
- **`exam_sessions`**:
  * `id` (TEXT PK).
  * `exam_id` (TEXT NOT NULL REFERENCES `exams(id)` ON DELETE CASCADE).
  * `user_email` (TEXT NOT NULL REFERENCES `users(email)` ON DELETE CASCADE).
  * `started_at` (BIGINT NOT NULL): Server timestamp when exam was initialized.
  * `expires_at` (BIGINT NOT NULL): Server deadline (`started_at + duration_minutes * 60`).
  * `status` (TEXT NOT NULL DEFAULT 'active'): Enum (`active`, `submitted`, `expired`).
  * Constraint: `UNIQUE (exam_id, user_email)`.
- **`attempts`**:
  * `id` (TEXT PK).
  * `exam_id` (TEXT NOT NULL REFERENCES `exams(id)` ON DELETE CASCADE).
  * `user_email` (TEXT NOT NULL REFERENCES `users(email)` ON DELETE CASCADE).
  * `status` (TEXT NOT NULL DEFAULT 'submitted'): Enum (`submitted`, `graded`).
  * `score` (INTEGER NOT NULL DEFAULT 0), `max_score` (INTEGER NOT NULL DEFAULT 0).
  * `feedback` (TEXT NOT NULL DEFAULT ''): Grader remarks.
  * `grading_method` (TEXT NOT NULL DEFAULT 'rules'): E.g. `rules`, `manual`.
  * `started_at`, `submitted_at` (BIGINT NOT NULL).
- **`answers`**:
  * `id` (TEXT PK).
  * `attempt_id` (TEXT NOT NULL REFERENCES `attempts(id)` ON DELETE CASCADE).
  * `question_id` (TEXT NOT NULL REFERENCES `questions(id)` ON DELETE CASCADE).
  * `answer` (TEXT NOT NULL DEFAULT ''): Student's submitted text.
  * `score` (INTEGER NOT NULL DEFAULT 0), `feedback` (TEXT NOT NULL DEFAULT '').
- **`assignments`**:
  * `id` (TEXT PK).
  * `course_id` (TEXT NOT NULL REFERENCES `courses(id)` ON DELETE CASCADE).
  * `title` (TEXT NOT NULL), `description` (TEXT NOT NULL DEFAULT '').
  * `due_at` (BIGINT), `max_score` (INTEGER NOT NULL DEFAULT 0).
  * `status` (TEXT NOT NULL DEFAULT 'draft'): Enum (`draft`, `published`).
  * `created_by` (TEXT NOT NULL), `created_at`, `updated_at` (BIGINT NOT NULL).

#### 3.1.6 Operations, Communications & Auditing
- **`contacts`**: `id` (PK), `name`, `phone`, `message`, `status` (`new`, `replied`, `archived`), `created_at`.
- **`announcements`**: `id` (PK), `title`, `body`, `status` (`published`, `draft`), `created_at`.
- **`notification_reads`**: `user_email`, `notification_type`, `notification_id`, `read_at`. Unique constraint on `(user_email, notification_type, notification_id)`.
- **`rate_limits`**: `key` (PK), `count` (INTEGER), `reset_at` (BIGINT).
- **`audit_logs`**: `id` (PK), `user_email`, `action`, `resource`, `resource_id`, `details` (JSON text), `ip`, `user_agent`, `created_at`.

---

## 4. Detailed Routing & Page Directory (`/app`)

```
app/
├── layout.tsx                                # Root HTML shell (Arabic RTL, fonts, providers)
├── page.tsx                                  # Public Landing & Academy Homepage
├── error.tsx                                 # Global Error Boundary fallback
├── globals.css & design-system.css           # CSS Tokens & Styling rules
│
├── (public_marketing_pages)/
│   ├── about/page.tsx                        # Teacher biography & teaching credentials
│   ├── contact/page.tsx                      # Public inquiry & contact submission form
│   ├── courses/page.tsx                      # Public catalog explorer with stage filtering
│   ├── course/[id]/page.tsx                  # Public course overview & syllabus details
│   └── privacy-policy/page.tsx               # Academic privacy terms & data handling policies
│
├── (auth_flows)/
│   ├── login/page.tsx                        # Student authentication page
│   ├── register/page.tsx                     # 13-field student onboarding + certificate upload
│   ├── verify-email/page.tsx                 # 6-digit email OTP verification interface
│   ├── staff/login/page.tsx                  # Dedicated isolated staff login screen
│   └── student/logout/route.ts               # GET/POST student session termination handler
│
├── (student_portal)/
│   ├── account/page.tsx                      # Consolidated student dashboard & profile editor
│   ├── dashboard/page.tsx                    # Legacy dashboard redirection route -> /account
│   ├── subscribe/[courseId]/page.tsx         # Fawaterak checkout invoice redirect client
│   ├── learn/[courseId]/page.tsx             # Interactive video lecture theater & sequential gates
│   ├── exam/[id]/page.tsx                    # Anti-cheat timed examination runner
│   └── result/[id]/page.tsx                  # Exam attempt review, answer review, score feedback
│
├── (admin_staff_portal)/
│   └── admin/page.tsx                        # Unified Staff/Admin Management Console
│
└── api/                                      # API Handlers & Mutation Handlers (detailed below)
```

### 4.1 Detailed Route Breakdown by Persona

#### 4.1.1 Public Pages
* **`/` ([app/page.tsx](file:///d:/mr%20ahmed%20hassan/app/page.tsx)):** Academy showcase, featuring [Hero.tsx](file:///d:/mr%20ahmed%20hassan/app/components/Hero.tsx), [FeaturedCourses.tsx](file:///d:/mr%20ahmed%20hassan/app/components/FeaturedCourses.tsx), statistics ticker, student testimonials, and [ScrollEffects.tsx](file:///d:/mr%20ahmed%20hassan/app/components/ScrollEffects.tsx).
* **`/courses` ([app/courses/page.tsx](file:///d:/mr%20ahmed%20hassan/app/courses/page.tsx)):** Course catalog powered by [CoursesExplorer.tsx](file:///d:/mr%20ahmed%20hassan/app/components/CoursesExplorer.tsx) with search by grade (`sec1`, `sec2`, `sec3`).
* **`/course/[id]` ([app/course/[id]/page.tsx](file:///d:/mr%20ahmed%20hassan/app/course/[id]/page.tsx)):** Detailed course syllabus rendered via [CourseDetailClient.tsx](file:///d:/mr%20ahmed%20hassan/app/components/CourseDetailClient.tsx), showing lesson count, exam prerequisites, price, and enrollment CTA.
* **`/about` ([app/about/page.tsx](file:///d:/mr%20ahmed%20hassan/app/about/page.tsx)):** Background and credentials of Mr. Ahmed Hassan.
* **`/contact` ([app/contact/page.tsx](file:///d:/mr%20ahmed%20hassan/app/contact/page.tsx)):** Contact form backed by [ContactForm.tsx](file:///d:/mr%20ahmed%20hassan/app/components/ContactForm.tsx) and `/api/contact`.

#### 4.1.2 Student Portal Routes
* **`/account` ([app/account/page.tsx](file:///d:/mr%20ahmed%20hassan/app/account/page.tsx)):** Primary student cockpit powered by [StudentDashboard.tsx](file:///d:/mr%20ahmed%20hassan/app/components/StudentDashboard.tsx). Features:
  - Enrolled active courses with completion progress bars.
  - One-time lecture code redemption panel ([LectureCodeRedemption.tsx](file:///d:/mr%20ahmed%20hassan/app/components/LectureCodeRedemption.tsx)).
  - Published announcements and notifications with read-state persistence.
  - Profile data editor and account deletion flow.
* **`/subscribe/[courseId]` ([app/subscribe/[courseId]/page.tsx](file:///d:/mr%20ahmed%20hassan/app/subscribe/[courseId]/page.tsx)):** Checkout interface rendered by [SubscribeClient.tsx](file:///d:/mr%20ahmed%20hassan/app/components/SubscribeClient.tsx) and [PaymentFlow.tsx](file:///d:/mr%20ahmed%20hassan/app/components/PaymentFlow.tsx).
* **`/learn/[courseId]` ([app/learn/[courseId]/page.tsx](file:///d:/mr%20ahmed%20hassan/app/learn/[courseId]/page.tsx)):** Video lecture hub containing [SecureVideoPlayer.tsx](file:///d:/mr%20ahmed%20hassan/app/components/SecureVideoPlayer.tsx). Enforces prerequisite gates, displays sequential lesson locks, and requests time-signed completion tokens.
* **`/exam/[id]` ([app/exam/[id]/page.tsx](file:///d:/mr%20ahmed%20hassan/app/exam/[id]/page.tsx)):** The quiz runner environment powered by [QuizRunner.tsx](file:///d:/mr%20ahmed%20hassan/app/components/QuizRunner.tsx). Implements fullscreen prompts, server-timed countdowns, blur/tab-switch detection, and automatic payload submission.
* **`/result/[id]` ([app/result/[id]/page.tsx](file:///d:/mr%20ahmed%20hassan/app/result/[id]/page.tsx)):** Post-exam scorecard rendered by [ResultClient.tsx](file:///d:/mr%20ahmed%20hassan/app/components/ResultClient.tsx), detailing passing status, percentage, teacher feedback, and correct answers.

#### 4.1.3 Staff & Admin Portal Routes
* **`/staff/login` ([app/staff/login/page.tsx](file:///d:/mr%20ahmed%20hassan/app/staff/login/page.tsx)):** Authenticates staff members against `staff_users` with [StaffLoginForm.tsx](file:///d:/mr%20ahmed%20hassan/app/components/StaffLoginForm.tsx).
* **`/admin` ([app/admin/page.tsx](file:///d:/mr%20ahmed%20hassan/app/admin/page.tsx)):** The unified command center rendered by [AdminDashboard.tsx](file:///d:/mr%20ahmed%20hassan/app/components/AdminDashboard.tsx) and subdivided into modular subsystems:
  - **Analytics & Key Metrics:** [AdminStatsPanel.tsx](file:///d:/mr%20ahmed%20hassan/app/components/admin/AdminStatsPanel.tsx).
  - **Courses & Lectures:** [AdminCourseList.tsx](file:///d:/mr%20ahmed%20hassan/app/components/admin/AdminCourseList.tsx) & [TeacherCourseWorkspace.tsx](file:///d:/mr%20ahmed%20hassan/app/components/admin/TeacherCourseWorkspace.tsx).
  - **Lecture Access Code Manager:** [LectureAccessCodeManager.tsx](file:///d:/mr%20ahmed%20hassan/app/components/admin/LectureAccessCodeManager.tsx) (Generates `ENG-...` codes, reveals plaintext once, inspects masked redemption logs).
  - **Assignments:** [AdminAssignmentList.tsx](file:///d:/mr%20ahmed%20hassan/app/components/admin/AdminAssignmentList.tsx).
  - **Announcements:** [AdminAnnouncementsList.tsx](file:///d:/mr%20ahmed%20hassan/app/components/admin/AdminAnnouncementsList.tsx).
  - **Student Directory & Approvals:** [AdminUserTable.tsx](file:///d:/mr%20ahmed%20hassan/app/components/admin/AdminUserTable.tsx) (Approves/rejects enrollments, inspects birth certificate scans, manages staff accounts).

### 4.2 Complete API Route Catalog (`/app/api`)

| Route Path | HTTP Methods | Authentication & RBAC | Primary Function & Logic |
| :--- | :--- | :--- | :--- |
| **`/api/health`** | `GET` | Public | Returns database connectivity status and process uptime |
| **`/api/ready`** | `GET` | Public | Readiness probe verifying database and storage mounts |
| **`/api/performance`** | `GET` | Staff (`view_students`) | System latency metrics, DB pool stats, request durations |
| **`/api/contact`** | `POST` | Public + Rate Limiting | Validates and persists public inquiry messages into `contacts` |
| **`/api/courses`** | `GET` | Public (Cached) | Returns active published courses with in-memory caching |
| **`/api/courses/[id]`** | `GET` | Public | Returns course details, lecture list, and exam prerequisites |
| **`/api/auth/register`** | `POST` | Public + Rate Limiting | Multipart upload: validates 13 fields, saves birth certificate, generates OTP |
| **`/api/auth/login`** | `POST` | Public + Rate Limiting | Validates student credentials, enforces 5-attempt lockout, sets session cookie |
| **`/api/auth/logout`** | `POST` | Student Session | Destroys student session in DB (`native_sessions`) and clears cookie |
| **`/api/auth/send-code`** | `POST` | Student Session | Dispatches 6-digit email verification OTP code via configured email transport |
| **`/api/auth/resend-code`**| `POST` | Public + Rate Limiting | Non-enumerating OTP resend endpoint with target rate limiting |
| **`/api/auth/verify-code`**| `POST` | Public / Student | Validates 6-digit OTP hash and updates `users.email_verified = 1` |
| **`/api/auth/verify-email`**| `POST` | Student Session | Alias endpoint for verification code submission |
| **`/api/auth/forgot-password`**| `POST` | Public + Rate Limiting | Generates password reset OTP code with per-email and per-IP throttles |
| **`/api/auth/reset-password`**| `POST` | Public + Rate Limiting | Consumes reset OTP, verifies 12-char complexity, updates password hash |
| **`/api/auth/change-password`**| `POST` | Student Session | Validates current password, updates PBKDF2 hash, revokes other sessions |
| **`/api/staff/login`** | `POST` | Public + Rate Limiting | Authenticates staff, enforces lockout, creates `staff_sessions` row |
| **`/api/staff/logout`** | `POST` | Staff Session | Clears staff session record and deletes `staff_session` cookie |
| **`/api/dashboard`** | `GET` | Student Session | Batched query fetching enrolled courses, grades, grants, and notifications |
| **`/api/profile`** | `GET`, `PUT`, `DELETE` | Student Session | Reads profile, updates allowed demographic fields, or executes GDPR account deletion |
| **`/api/users/me`** | `GET` | Student Session | Returns active student profile, grade, and email verification status |
| **`/api/enrollments`** | `POST` | Student Session | Creates pending enrollment request for course access |
| **`/api/payments/fawaterak/checkout`** | `POST` | Student Session | Requests Fawaterak invoice link and records `payment_intents` row |
| **`/api/payments/fawaterak/webhook`** | `POST` | Fawaterak HMAC Header | Verifies HMAC-SHA256 signature, validates minor units, approves enrollment |
| **`/api/videos/[id]`** | `GET` | Student / Staff | Validates lecture authorization and returns video metadata |
| **`/api/videos/[id]/resolve`** | `GET` | Student (Authorized) | Issues short-lived signed video playback token and secure embed parameters |
| **`/api/videos/[id]/embed`** | `GET` | Signed Token | Validates embed token signature and serves protected iframe markup |
| **`/api/videos/[id]/complete`** | `POST` | Student (Authorized) | Validates signed time token (`now >= notBefore`), marks `video_progress` complete |
| **`/api/lecture-access-codes/redeem`** | `POST` | Student Session | Atomic CTE redemption: claims code, inserts access grant for exact lecture |
| **`/api/exams/[id]`** | `GET`, `POST` | Student (Enrolled) | `GET` returns questionnaire / starts session; `POST` scores attempt atomically |
| **`/api/attempts/[id]`** | `GET` | Student (Owner) / Staff | Returns attempt score breakdown, answers, and feedback remarks |
| **`/api/notifications/read`** | `POST` | Student Session | Records persistent read state for announcements and exam notifications |
| **`/api/admin/bootstrap`** | `GET` | Staff Session | Unified bootstrap endpoint providing data filtered by staff RBAC permissions |
| **`/api/admin/courses`** | `POST` | Staff (`manage_courses`) | Creates new course draft |
| **`/api/admin/courses/[id]`**| `PATCH`, `DELETE` | Staff (`manage_courses`) | Modifies course metadata or deletes course if no dependencies exist |
| **`/api/admin/videos`** | `POST` | Staff (`manage_videos`) | Creates lecture attached to course with duration and prerequisite rules |
| **`/api/admin/videos/[id]`** | `PATCH`, `DELETE` | Staff (`manage_videos`) | Edits lecture details or deletes video record |
| **`/api/admin/videos/[id]/access-codes`** | `GET`, `POST` | Staff (`manage_videos`) | `POST` generates new `ENG-...` code; `GET` lists masked history |
| **`/api/admin/exams`** | `POST` | Staff (`manage_exams`) | Creates exam definition with question sets, points, and passing criteria |
| **`/api/admin/exams/[id]`** | `GET`, `PATCH`, `DELETE`| Staff (`manage_exams`) | Edits exam questions, instructions, or passing scores |
| **`/api/admin/assignments`**| `POST` | Staff (`manage_assignments`) | Publishes homework/assignment description and due dates |
| **`/api/admin/assignments/[id]`**| `PATCH`, `DELETE`| Staff (`manage_assignments`)| Modifies assignment or deletes assignment row |
| **`/api/admin/enrollments/[id]`**| `PATCH` | Staff (`manage_enrollments`)| Approves or rejects student enrollment request |
| **`/api/admin/attempts/[id]`**| `PATCH` | Staff (`grade_exams`) | Updates subjective written scores and leaves teacher feedback |
| **`/api/admin/students`** | `GET` | Staff (`view_students`) | Lists students with grade filters, phone numbers, and verification status |
| **`/api/admin/students/[email]/birth-certificate`** | `GET` | Staff (`view_students`) | Streams encrypted birth certificate file from private disk storage |
| **`/api/admin/staff`** | `GET`, `POST` | Super-Admin Only | Lists staff accounts or provisions new staff user with specific permission preset |
| **`/api/admin/staff/[email]`** | `PATCH` | Super-Admin Only | Updates staff permissions, resets passwords, or toggles active state |
| **`/api/admin/announcements`**| `POST` | Staff (`manage_announcements`)| Broadcasts platform-wide announcement to student dashboards |
| **`/api/admin/announcements/[id]`**| `DELETE` | Staff (`manage_announcements`)| Removes platform announcement |
| **`/api/admin/contacts/[id]`** | `PATCH` | Staff (`manage_contacts`) | Updates status of student/parent contact message |

---

## 5. Core Feature Mechanisms & Custom Logic

### 5.1 The One-Time Video Access Code System
Designed to support physical center sales where students purchase single-lecture access vouchers without buying an entire monthly course package.

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as Staff (manage_videos)
    participant AdminUI as LectureAccessCodeManager
    participant CodeAPI as /api/admin/videos/[id]/access-codes
    participant DB as PostgreSQL 16
    actor Student as Student (Verified)
    participant StudentUI as LectureCodeRedemption
    participant RedeemAPI as /api/lecture-access-codes/redeem
    participant VideoGateway as authorizeVideoAccess()

    Teacher->>AdminUI: Click "إنشاء كود محاضرة"
    AdminUI->>CodeAPI: POST (video_id)
    Note over CodeAPI: Generate 30 random bytes<br/>Base32 Unambiguous Alphabet<br/>Entropy: 150 bits<br/>Format: ENG-XXXXX-XXXXX...
    Note over CodeAPI: Hash with SHA-256<br/>Store code_hash + display_suffix
    CodeAPI->>DB: INSERT INTO lecture_access_codes
    CodeAPI-->>AdminUI: 201 Created (Plaintext code shown once)
    Teacher->>Student: Issues printed / plaintext voucher

    Student->>StudentUI: Enters "ENG-XXXXX-XXXXX..."
    StudentUI->>RedeemAPI: POST { code: "ENG-..." }
    Note over RedeemAPI: Normalize code (uppercase, trim)<br/>SHA-256 Hash<br/>Rate-limit checks (8 / 15min)
    
    rect rgb(20, 30, 45)
    Note over RedeemAPI,DB: Single Atomic CTE Statement (FOR UPDATE)
    RedeemAPI->>DB: WITH candidate AS (SELECT ... FOR UPDATE),<br/>new_grant AS (INSERT INTO student_video_access_grants ...),<br/>claimed AS (UPDATE lecture_access_codes SET redeemed_by = student ...)<br/>RETURNING grant details;
    end

    alt Code Valid & Unused
        DB-->>RedeemAPI: 1 row returned
        RedeemAPI-->>StudentUI: 200 OK { granted: true, videoId, courseId }
        StudentUI->>Student: Display success message & "شاهد المحاضرة الآن" CTA
    else Code Already Used / Invalid
        DB-->>RedeemAPI: 0 rows returned
        RedeemAPI-->>StudentUI: 409 Conflict / 404 Not Found
    end

    Student->>VideoGateway: Requests /api/videos/[id]
    Note over VideoGateway: Checks enrollments OR<br/>student_video_access_grants
    VideoGateway-->>Student: 200 OK (Access Granted to this video only)
```

#### Key Technical Principles of the Code System:
1. **Zero Plaintext Persistence:** The raw voucher is never written to disk or database. Only the SHA-256 digest `code_hash` and `display_suffix` (last 5 characters) are saved.
2. **Atomic Concurrency Guarantee:** As proven in `tests/lecture-access-code-postgres.test.mjs` (50 concurrent requests against a single voucher), only a single student can redeem the code. The PostgreSQL data-modifying CTE binds the update of `lecture_access_codes` to the successful insertion of `student_video_access_grants`.
3. **Strict Scope Isolation:** Redeeming a code unlocks *only* that specific lecture. It does not enroll the student in the course, does not unlock sibling lessons, and does not bypass prerequisite exams for subsequent lessons.
4. **Resilience to Account Deletion:** When a student deletes their account, the foreign key on `lecture_access_codes.redeemed_by_student_email` is set to `NULL` via `ON DELETE SET NULL`, but `redeemed_at` remains populated. The database check constraint `CHECK (redeemed_by_student_email IS NULL OR redeemed_at IS NOT NULL)` ensures a consumed code can never become redeemable again.

### 5.2 Authentication & Role-Based Access Control (RBAC) Flow
The platform rejects combined monolithic sessions and operates two strictly segregated authentication layers.

```mermaid
graph TD
    Request[Incoming HTTP Request] --> RouteCheck{Target Route?}
    
    RouteCheck -->|Student API / Page| StudentAuth[Student Authentication Flow]
    RouteCheck -->|Staff / Admin API| StaffAuth[Staff Authentication Flow]
    
    subgraph StudentSecurity [Student Auth - native-auth.ts]
        StudentAuth --> CheckStudentCookie[Read 'session' HttpOnly Cookie]
        CheckStudentCookie --> HashStudentToken[SHA-256 Hash Token]
        HashStudentToken --> QueryNativeSession[Query native_sessions table]
        QueryNativeSession --> CheckExpiry{Expired or Missing?}
        CheckExpiry -->|Yes| RejectStudent[401 Unauthorized / Clear Cookie]
        CheckExpiry -->|No| LoadStudent[Load users row]
        LoadStudent --> CheckEmailVerified{email_verified == 1?}
        CheckEmailVerified -->|No| RestrictStudent[Permit only /verify-email & /api/auth/*]
        CheckEmailVerified -->|Yes| PermitStudent[Full Student Access Granted]
    end

    subgraph StaffSecurity [Staff Auth - staff-auth.ts]
        StaffAuth --> CheckStaffCookie[Read 'staff_session' HttpOnly Cookie]
        CheckStaffCookie --> HashStaffToken[SHA-256 Hash Token]
        HashStaffToken --> QueryStaffSession[Query staff_sessions JOIN staff_users]
        QueryStaffSession --> CheckStaffActive{Active & Valid?}
        CheckStaffActive -->|No| RejectStaff[401 Unauthorized / Redirect /staff/login]
        CheckStaffActive -->|Yes| EvaluateRBAC{Check staff_users.permissions}
        EvaluateRBAC -->|Permission Matches| PermitStaffAction[Execute Admin Action]
        EvaluateRBAC -->|Permission Missing| DenyStaffAction[403 Forbidden - Insufficient Permissions]
    end
```

#### 5.2.1 Password Hashing Specification
Both student and staff passwords utilize PBKDF2 (Password-Based Key Derivation Function 2) with the following mandatory security profile:
- **Digest Algorithm:** SHA-512.
- **Iterations:** 100,000 rounds.
- **Salt Length:** 32 cryptographically random bytes (hex-encoded).
- **Derived Key Length:** 64 bytes (hex-encoded).

#### 5.2.2 Staff Role & Permission Matrix
Staff permissions are stored as a JSON string array in `staff_users.permissions`. Available granular permissions:
1. `manage_courses`: Create, update, publish, and delete courses.
2. `manage_videos`: Add/edit lectures, manage YouTube links, generate one-time voucher codes.
3. `manage_exams`: Author exams, set questions, define passing thresholds.
4. `manage_assignments`: Publish assignments, set homework deadlines.
5. `manage_enrollments`: Approve or reject pending student enrollment requests.
6. `view_students`: View full student academic directory and download birth certificate scans.
7. `grade_exams`: Grade open-ended written exam questions and assign scores/feedback.
8. `manage_announcements`: Create and delete platform-wide announcements.
9. `manage_contacts`: Review and update contact inquiry tickets.
10. `manage_staff`: Super-admin only; manage other staff accounts and assign permissions.

**Standard Built-in Presets:**
- **Teacher (`full_access`):** Holds all 10 permissions.
- **Grader (`grader`):** `grade_exams`, `view_students`.
- **Course Manager (`course_manager`):** `manage_courses`, `manage_videos`, `manage_exams`, `manage_assignments`.
- **Enrollment Manager (`enrollment_manager`):** `manage_enrollments`, `view_students`.

### 5.3 Video DRM & Protection Strategies
Because video content is hosted via YouTube, the platform enforces an application-layer sandboxing and access verification pipeline:
1. **Dynamic Dynamic Player Sandboxing:**
   - [SecureVideoPlayer.tsx](file:///d:/mr%20ahmed%20hassan/app/components/SecureVideoPlayer.tsx) embeds YouTube via an iframe with restricted policies: `allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"`.
   - The player container intercepts and cancels the `contextmenu` event to prevent easy URL inspection or downloading.
   - Dynamic user-identity watermarking is overlaid on the video canvas (displaying the student's email and phone number at rotating positions) to deter screen-recording piracy.
2. **Sequential Prerequisite Gating:**
   - Lectures within a course are ordered sequentially. Lecture $N$ is locked until Lecture $N-1$ has a recorded completion row in `video_progress`, OR the student possesses an explicit `student_video_access_grants` row for Lecture $N$.
   - If a lecture specifies a `prerequisite_exam_id`, the student must score $\ge$ `minimum_score` on that exam before `/api/videos/[id]/resolve` will issue an embed token.
3. **Cryptographically Signed Time-Locked Completion Tokens:**
   - When a student begins playback, `/api/videos/[id]/resolve` signs a short-lived token using HMAC-SHA256 containing:
     $$\text{notBefore} = \text{currentTime} + (0.90 \times \text{durationSeconds})$$
   - When the student triggers completion, `/api/videos/[id]/complete` verifies the HMAC signature and verifies that:
     $$\text{currentTime} \ge \text{token.notBefore}$$
   - Any attempt to mark a lecture complete immediately or skip ahead is rejected with HTTP 403.

### 5.4 Exam Engine & Anti-Cheat Logic
1. **Server-Side Session Timers:**
   - Starting an exam creates a single atomic row in `exam_sessions`. The expiration timestamp is fixed on the server (`started_at + duration_minutes * 60`).
   - If a student refreshes their browser or closes the window, reopening the exam fetches the existing session; the remaining time is calculated strictly from `expires_at - now()`.
2. **Anti-Cheat Monitoring:**
   - [QuizRunner.tsx](file:///d:/mr%20ahmed%20hassan/app/components/QuizRunner.tsx) attaches listeners to `document.visibilitychange` and window `blur`.
   - **First Strike:** If the student switches browser tabs or minimizes the window, an immediate high-priority warning modal is displayed, and an incident event is logged.
   - **Repeated Strike:** Continued tab switching triggers automatic submission of the exam in its current state.
3. **Atomic Exam Submission & Grading:**
   - `/api/exams/[id]` POST consumes the session inside a PostgreSQL transaction.
   - Multiple-choice questions are scored instantly against server-stored correct answers.
   - Results are inserted into `attempts` and detailed in `answers`.

---

## 6. Agent Rules, Acceptance & Audit State

### 6.1 Agent Operational Guidelines (`AGENTS.md` & `CLAUDE.md`)
- **Next.js 16 Breaking Conventions:** `AGENTS.md` explicitly mandates compliance with Next.js 16 conventions:
  * Route params in App Router page and route handlers are asynchronous Promises (`params: Promise<{ id: string }>`) and must be resolved with `await params`.
  * The code re-added by `next dev` at `node_modules/next/dist/server/lib/generate-agent-files.js` must be kept clean in version control.
- **Arabic-First Design Tokens:** Workspaces must adhere to the palette tokens defined in `globals.css` and `design-system.css`. Any UI changes must be verified for RTL compliance, horizontal scrollbar containment, and accessibility landmarks.

### 6.2 Acceptance & Quality Status (`FULL_PLATFORM_ACCEPTANCE_REPORT.md`)
The comprehensive acceptance evaluation executed against the live platform yielded:
- **Final Verdict:** **PARTIALLY READY** (79 Use-Cases PASS, 4 FIXED, 3 FAIL, 1 BLOCKED, 5 NOT IMPLEMENTED, 1 NEEDS DECISION, 1 NOT APPLICABLE).
- **Core Educational Journey Verified (PASS):**
  * Student registration with private birth certificate validation.
  * Separate student/staff authentication and session isolation.
  * Course creation, lecture management, prerequisite locking.
  * Fawaterak checkout intent and webhook processing.
  * 50-client concurrent one-time access voucher redemption.
  * Timed exam runner and automated scorecard generation.
  * Student dashboard and notification read persistence.
  * Account deletion with private certificate unlink and tombstoning.

### 6.3 Outstanding Gaps, Known Issues & Product Decisions
1. **Assignment Submission & Grading (NOT IMPLEMENTED):**
   - While staff can create assignments and set deadlines, the student homework upload pipeline (submission records, file upload storage, student grades, teacher feedback) is not yet implemented.
2. **Exam Start on HTTP GET (SECURITY DEFECT / REMAINING FAIL):**
   - Opening an exam route via `GET /api/exams/[id]` initiates and persists the `exam_sessions` timer. A malicious link could theoretically trigger an exam countdown if clicked by an enrolled student. *Resolution needed: Migrate exam session start to an explicit `POST /api/exams/[id]/start`.*
3. **Elapsed-Time Video Completion (PRODUCT LIMITATION):**
   - Video completion verification currently proves that the student waited 90% of the duration before requesting completion, but does not verify continuous iframe playback telemetry.
4. **Free-Text Question Grading Heuristic (NEEDS DECISION):**
   - Short-answer questions in `app/lib/grading.ts` use keyword-token coverage scoring, which can be gamed by keyword stuffing. *Decision needed: Enforce manual staff grading (`grade_exams`) for all free-text questions.*
5. **Rate Limiter Proxy IP Configuration (PRODUCTION DEPLOYMENT REQUIREMENT):**
   - The in-memory / database rate limiter requires `TRUSTED_PROXY_IP_HEADER` (e.g. `cf-connecting-ip` or `x-real-ip`) to be set behind a reverse proxy (Nginx or Cloudflare). If deployed without this header, the limiter falls back to a single shared global client bucket.
6. **Password Length Validation Message Mismatch:**
   - In `app/api/auth/reset-password/route.ts`, the validation requires 12 characters, while the Arabic error message references 8 characters.

---

## 7. Environment Configuration Reference

The platform is configured via environment variables loaded from `.env` or the host system, validated at startup by [app/lib/env.ts](file:///d:/mr%20ahmed%20hassan/app/lib/env.ts):

| Variable Name | Required? | Default / Fallback | Purpose & Operational Description |
| :--- | :---: | :--- | :--- |
| **`DATABASE_URL`** | **YES** | None (Fatal if missing) | PostgreSQL connection URI (e.g., `postgresql://user:pass@127.0.0.1:5432/englizeka`). |
| **`DATABASE_POOL_MAX`** | NO | `20` | Maximum number of concurrent connections in the `pg` Pool. |
| **`DATABASE_READ_BATCH_CONCURRENCY`** | NO | `4` | Maximum parallel queries executed in batched dashboard reads (range 1–11). |
| **`VERIFICATION_SECRET`** | **YES** | None (Fatal if `< 24` chars) | High-entropy secret key used for HMAC-SHA256 signing of session tokens, OTPs, and video access tokens. Can also use `SESSION_SECRET`. |
| **`VIDEO_RESOLVE_SECRET`** | NO | Falls back to `VERIFICATION_SECRET` | Dedicated signing secret for short-lived video embed and completion tokens. |
| **`PRIVATE_STORAGE_DIR`** | **YES** | None (Fatal if missing) | Absolute or relative host path for storing sensitive student birth certificates (e.g. `./storage/private`). |
| **`APP_URL`** | **YES** | `http://localhost:3000` | Fully qualified public HTTPS base URL (no trailing slash) used for Fawaterak callbacks and webhook verification. |
| **`TRUSTED_PROXY_IP_HEADER`** | CONDITIONAL | Empty | Name of trusted proxy header containing true client IP (e.g. `cf-connecting-ip`, `x-real-ip`). Required behind Nginx/Cloudflare. |
| **`EMAIL_TEST_MODE`** | NO | `false` | When `true`, suppresses real email delivery and logs OTP codes to server output. **Forbidden in production.** |
| **`EMAIL_FROM`** | CONDITIONAL | `Englizeka <onboarding@resend.dev>` | Outgoing sender email address. Required when using Resend or ServerSMTP. |
| **`RESEND_API_KEY`** | CONDITIONAL | Empty | API key for Resend email delivery (e.g. `re_123456789`). |
| **`GMAIL_USER`** | CONDITIONAL | Empty | Gmail address for SMTP delivery (must be set with `GMAIL_APP_PASSWORD`). |
| **`GMAIL_APP_PASSWORD`** | CONDITIONAL | Empty | Google App Password for Gmail SMTP transport. |
| **`SERVERSMTP_CONSUMER_KEY`** | CONDITIONAL | Empty | Consumer key for ServerSMTP / TurboSMTP relay service. |
| **`SERVERSMTP_CONSUMER_SECRET`**| CONDITIONAL | Empty | Consumer secret for ServerSMTP / TurboSMTP relay service. |
| **`FAWATERAK_BASE_URL`** | **YES** | `https://staging.fawaterk.com` | Base URL for Fawaterak gateway API (`https://app.fawaterk.com` in production). |
| **`FAWATERAK_CLIENT_ID`** | CONDITIONAL | Empty | Fawaterak client identifier for hosted checkout initialization. |
| **`FAWATERAK_CLIENT_SECRET`**| CONDITIONAL | Empty | Fawaterak client secret. |
| **`FAWATERAK_VENDOR_API_KEY`** | CONDITIONAL | Empty | Fawaterak vendor API key. |
| **`FAWATERAK_WEBHOOK_SECRET`** | CONDITIONAL | Empty | HMAC secret key used to verify incoming payment webhook signatures. |
| **`INITIAL_STAFF_EMAIL`** | **YES** | None (Fatal if missing) | Email address for initial super-admin / teacher bootstrap account. |
| **`INITIAL_STAFF_NAME`** | NO | `Mr Ahmed Hassan` | Display name for initial super-admin account. |
| **`INITIAL_STAFF_PASSWORD_HASH`** | **YES** | None (Fatal if missing) | Hex-encoded PBKDF2-SHA512 hash of initial staff password. |
| **`INITIAL_STAFF_PASSWORD_SALT`** | **YES** | None (Fatal if missing) | Hex-encoded 32-byte salt used to generate the staff password hash. |
| **`INITIAL_STAFF_PASSWORD_ITERATIONS`**| NO | `100000` | PBKDF2 iteration count for staff password derivation. |

---

## 8. Verification & Operational Health Check

To verify the integrity and readiness of the platform, execute the following commands from the workspace root:

```powershell
# 1. Validate TypeScript type safety
npm run typecheck

# 2. Execute static analysis and linting
npm run lint

# 3. Run the automated security and cryptography test suite
npm run test:security

# 4. Run core business logic unit tests
node --test tests/unit.test.mjs

# 5. Run the lecture access code PostgreSQL concurrency integration test
npm run test:lecture-code:postgres

# 6. Verify production standalone build
npm run build
```

---
*This blueprint represents the definitive architectural ground truth for the Englizeka codebase as of October 2026.*
