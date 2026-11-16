# Englizeka Admin & Assistant Complete Features

> **Document Type:** Authoritative Staff Architecture & RBAC Feature Inventory  
> **Target Roles:** Teacher (Super Admin) & Assistant (Role-Based Staff)  
> **Codebase Verified:** Next.js 15 App Router, PostgreSQL (node-postgres Pool), TypeScript  
> **Status:** Ground Truth Code Audit Complete

---

## 1. Executive Summary

This document presents a comprehensive, evidence-based audit and specification of all features, administrative controls, UI screens, background APIs, and role-based permissions in the **Englizeka** platform.

Englizeka implements a **two-tier staff model** completely isolated from student authentication:
1. **Teacher (Super Admin):** The supreme administrative role. The teacher possesses unconditional server-side bypass across all administrative operations and exclusive ownership over staff creation, permission assignment, account suspension, password resets, and account deletion.
2. **Assistant (Restricted Staff):** A modular, permission-governed staff role. Assistants can be assigned predefined capability presets (`course_manager`, `grader`, `enrollment_manager`). Assistants can never access staff management, cannot elevate their own permissions, and are strictly bounded on both frontend and backend by granular permission middleware.

---

## 2. Current Staff Role Model

### 2.1 Staff Identity and Session Storage
- **Database Table:** `staff_users` ([001_initial.sql](file:///e:/Englezika/database/migrations/001_initial.sql#L224-L238))
- **Session Table:** `staff_sessions` with SHA-256 token hashing and rolling `last_seen` ([001_initial.sql](file:///e:/Englezika/database/migrations/001_initial.sql#L240-L246))
- **Cookie Name:** `englizeka_staff` (HttpOnly, SameSite=Strict, Max-Age 12 hours, Secure in HTTPS) ([staff-auth.ts](file:///e:/Englezika/app/lib/staff-auth.ts#L15-L184))
- **Password Security:** PBKDF2 with SHA-256, 100,000 iterations, 16-byte random salt, constant-time hash comparison ([staff-auth.ts](file:///e:/Englezika/app/lib/staff-auth.ts#L62-L92))
- **Brute-Force Protection:** 5 failed attempts locks the staff account for 15 minutes (`locked_until`), plus IP-level rate limiting on login (5 attempts per minute via `checkRateLimit('staff-login', ip, 5, 60)`) ([staff-auth.ts](file:///e:/Englezika/app/lib/staff-auth.ts#L133-L141), [login route](file:///e:/Englezika/app/api/staff/login/route.ts#L9-L13))

### 2.2 Server-Side Authorization Engine
Authorization is enforced through `apiStaff(request, permission?)` in [`app/lib/staff-auth.ts`](file:///e:/Englezika/app/lib/staff-auth.ts#L224-L234):
1. Reads and verifies `englizeka_staff` session cookie against `staff_sessions` joined with `staff_users` where `active = 1` and `expires_at > now`.
2. Resolves permissions via `parsePermissions(row.permissions, row.role)`:
   - If `role === 'teacher'`, the user receives **all 10 system permissions** ([staff-auth.ts:45](file:///e:/Englezika/app/lib/staff-auth.ts#L45)).
   - If `role === 'assistant'`, permissions are parsed from stored JSON and validated against `STAFF_PERMISSIONS`.
   - **Auto-inclusion rule:** If an assistant has `manage_courses`, `manage_assignments` is automatically attached ([staff-auth.ts:53-55](file:///e:/Englezika/app/lib/staff-auth.ts#L53-L55)).
3. If an endpoint requires a specific permission (e.g. `manage_videos`), non-teachers missing that key receive an immediate `403 Forbidden` (`{"error": "ليس لديك صلاحية لتنفيذ هذا الإجراء"}`).

---

## 3. Teacher / Super Admin — Complete Feature List

The Teacher holds unrestricted access to every administrative tool and configuration surface in the repository.

| # | Feature | Description | Actions Available | UI Location | Backend / API Route | Status |
|---|---|---|---|---|---|---|
| 1 | **Staff Portal Authentication** | PBKDF2-secured login with IP rate limiting & lockout | Login, Logout | `/staff/login` ([StaffLoginForm.tsx](file:///e:/Englezika/app/components/StaffLoginForm.tsx)) | `POST /api/staff/login`, `POST /api/staff/logout` | FULLY IMPLEMENTED |
| 2 | **Dashboard Bootstrap & Scoped Sync** | Loads aggregated metrics, paginated entities, and staff identity | View all aggregated counts, paginated data | `/admin` ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L319-L331)) | `GET /api/admin/bootstrap` | FULLY IMPLEMENTED |
| 3 | **Platform KPI Overview Panel** | High-level statistics: total students, active/pending enrollments, published exams, average score, unread messages | View KPIs, click attention items | Overview Tab ([AdminStatsPanel.tsx](file:///e:/Englezika/app/components/admin/AdminStatsPanel.tsx#L67-L93)) | `GET /api/admin/bootstrap` | FULLY IMPLEMENTED |
| 4 | **Teacher Course Workspace** | Visual grid of all courses with quick counters (lessons, exams, assignments, students) and content shortcuts | Search courses, filter by draft/published, jump to exams/assignments/lessons | Overview Tab ([TeacherCourseWorkspace.tsx](file:///e:/Englezika/app/components/admin/TeacherCourseWorkspace.tsx)) | `GET /api/admin/bootstrap` | FULLY IMPLEMENTED |
| 5 | **Course Creation** | Create structured course with grade level, description, and EGP price | Create (draft or published) | Courses Tab ([AdminCourseList.tsx](file:///e:/Englezika/app/components/admin/AdminCourseList.tsx#L49-L101)) | `POST /api/admin/courses` | FULLY IMPLEMENTED |
| 6 | **Course Editing** | Update title, grade level, price, description, and draft/published status | Edit metadata, toggle publish state | Courses Tab ([AdminCourseList.tsx](file:///e:/Englezika/app/components/admin/AdminCourseList.tsx#L137-L209)) | `PATCH /api/admin/courses/[id]` | FULLY IMPLEMENTED |
| 7 | **Course Deletion & Dependency Guard** | Delete empty courses; blocked with 409 if linked to enrollments, exams, videos, or assignments | Delete course | Courses Tab ([AdminCourseList.tsx](file:///e:/Englezika/app/components/admin/AdminCourseList.tsx#L210-L218)) | `DELETE /api/admin/courses/[id]` | FULLY IMPLEMENTED |
| 8 | **Public Course Cache Invalidation** | Automatically purges cached public course directory on any course/exam/video mutation | Automatic system trigger | Background utility | `lib/public-course-cache.ts` | FULLY IMPLEMENTED |
| 9 | **Video Lecture Creation (YouTube Unlisted)** | Register unlisted YouTube URL, duration, prerequisite exam, and minimum passing score | Create video lesson | Videos Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1442-L1574)) | `POST /api/admin/videos` | FULLY IMPLEMENTED |
| 10 | **Video Prerequisite Exam Gating** | Configure exam threshold (%) required before student can unlock subsequent lecture | Set prerequisite exam & minimum score % | Videos Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L901-L959)) | `PATCH /api/admin/videos/[id]` | FULLY IMPLEMENTED |
| 11 | **Video Library Management & Deletion** | View all videos grouped by course, edit title/status, or delete | Edit, Delete | Videos Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L878-L974)) | `PATCH /api/admin/videos/[id]`, `DELETE /api/admin/videos/[id]` | FULLY IMPLEMENTED |
| 12 | **One-Time Lecture Access Code Generation** | Cryptographically generate single-use code (`ENG-XXXXX-XXXXX-...`) for a specific video; view code once, copy to clipboard | Generate code, copy plaintext code | Videos Tab ([LectureAccessCodeManager.tsx](file:///e:/Englezika/app/components/admin/LectureAccessCodeManager.tsx)) | `POST /api/admin/videos/[id]/access-codes` | FULLY IMPLEMENTED |
| 13 | **Lecture Access Code History** | View last 100 generated codes with masked suffix (`•••••-XXXXX`), creation time, redemption status, and redemption timestamp | View history | Videos Tab ([LectureAccessCodeManager.tsx](file:///e:/Englezika/app/components/admin/LectureAccessCodeManager.tsx#L89-L108)) | `GET /api/admin/bootstrap` | FULLY IMPLEMENTED |
| 14 | **MCQ Exam Builder** | Create exams with title, instructions, time limit (1-300 min), passing score (0-100%), max attempts, and dynamic MCQ question builder | Add questions, set options, choose correct answer, assign points | Exams Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1277-L1438)) | `POST /api/admin/exams` | FULLY IMPLEMENTED |
| 15 | **Exam Metadata & Schedule Editing** | Modify title, description, instructions, duration, passing score %, max attempts, opens_at, closes_at | Edit via modal prompt | Exams Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L751-L803)) | `PATCH /api/admin/exams/[id]` | FULLY IMPLEMENTED |
| 16 | **Exam Question Replacement** | Replace questions of existing exam (blocked if attempts already exist) | Replace questions | Exams Tab / API | `PATCH /api/admin/exams/[id]` | FULLY IMPLEMENTED |
| 17 | **Exam Publish Toggle** | One-click toggle between draft and published status | Publish / Unpublish | Exams Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L804-L822)) | `PATCH /api/admin/exams/[id]` | FULLY IMPLEMENTED |
| 18 | **Exam Deletion Guard** | Delete exam and questions (blocked if linked to student attempts or video prerequisites) | Delete exam | Exams Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L823-L834)) | `DELETE /api/admin/exams/[id]` | FULLY IMPLEMENTED |
| 19 | **Exam Submission Review & Score Override** | Inspect student exam submissions, override auto-graded score, and provide written teacher feedback (sets method to `teacher_review`) | Override score, write feedback, invalidate leaderboard | Results Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1067-L1143)) | `PATCH /api/admin/attempts/[id]` | FULLY IMPLEMENTED |
| 20 | **Assignment Creation** | Create assignment for course with title, description, due date/time, max score, and status | Create assignment | Assignments Tab ([AdminAssignmentList.tsx](file:///e:/Englezika/app/components/admin/AdminAssignmentList.tsx#L49-L105)) | `POST /api/admin/assignments` | FULLY IMPLEMENTED |
| 21 | **Assignment Editing & Deletion** | Modify assignment details, due date, max score, or delete | Edit, Delete | Assignments Tab ([AdminAssignmentList.tsx](file:///e:/Englezika/app/components/admin/AdminAssignmentList.tsx#L128-L198)) | `PATCH /api/admin/assignments/[id]`, `DELETE /api/admin/assignments/[id]` | FULLY IMPLEMENTED |
| 22 | **Student Directory & Multi-Field Search** | Paginated list (50/page) searchable by student name, email, phone number, and filterable by grade level | Search, filter by grade, paginate | Students Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1859-L2053)) | `GET /api/admin/students` | FULLY IMPLEMENTED |
| 23 | **Student Detailed Profile Inspection** | View complete student registration profile (full 4-part name, parent phones, school name, parent job, governorate, gender, grade, section, registration date, active enrollments count, total attempts count) | Expand student row | Students Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1966-L2023)) | `GET /api/admin/students` | FULLY IMPLEMENTED |
| 24 | **Confidential Birth Certificate Viewer** | Stream uploaded confidential birth certificate document directly from private storage (R2/S3/local) | View / download PDF or image | Students Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L2008-L2021)) | `GET /api/admin/students/[email]/birth-certificate` | FULLY IMPLEMENTED |
| 25 | **Enrollment Approval & Rejection** | Review student course enrollments with payment method & transaction reference; activate course access or reject | Approve (`approved`), Reject (`rejected`) | Enrollments Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L983-L1064)) | `PATCH /api/admin/enrollments/[id]` | FULLY IMPLEMENTED |
| 26 | **Announcement Publishing & Broadcasting** | Create broadcast announcements visible instantly on all student dashboard header feeds | Publish announcement | Overview Tab ([AdminStatsPanel.tsx](file:///e:/Englezika/app/components/admin/AdminStatsPanel.tsx#L97-L127)) | `POST /api/admin/announcements` | FULLY IMPLEMENTED |
| 27 | **Announcement Management** | Edit announcement text (resets unread badge for students) or delete announcement | Edit, Delete | Overview Tab ([AdminAnnouncementsList.tsx](file:///e:/Englezika/app/components/admin/AdminAnnouncementsList.tsx)) | `PATCH /api/admin/announcements/[id]`, `DELETE /api/admin/announcements/[id]` | FULLY IMPLEMENTED |
| 28 | **Contact Inquiries Management** | Review messages submitted via contact form (name, direct phone dial link, message body, date, status) | View messages, mark as reviewed | Messages Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1146-L1193)) | `PATCH /api/admin/contacts/[id]` | FULLY IMPLEMENTED |
| 29 | **Staff Account Creation (Teacher-Only)** | Create new teacher or assistant accounts with custom preset and 12+ char strong password | Create staff account | Staff Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1652-L1723)) | `POST /api/admin/staff` | FULLY IMPLEMENTED |
| 30 | **Staff Role & Preset Modification (Teacher-Only)** | Change assistant presets (`grader`, `course_manager`, `enrollment_manager`) or promote to teacher | Change role / preset | Staff Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1777-L1800)) | `PATCH /api/admin/staff/[email]` | FULLY IMPLEMENTED |
| 31 | **Staff Account Suspension (Teacher-Only)** | Deactivate staff account to immediately block further logins | Toggle Active / Suspended | Staff Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1759-L1776)) | `PATCH /api/admin/staff/[email]` | FULLY IMPLEMENTED |
| 32 | **Staff Password Reset & Session Revocation (Teacher-Only)** | Reset any staff password and immediately revoke all active sessions across all devices | Reset password | Staff Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1801-L1820)) | `PATCH /api/admin/staff/[email]` | FULLY IMPLEMENTED |
| 33 | **Staff Account Hard Deletion (Teacher-Only)** | Permanently delete assistant or other teacher account (with self-deletion guard) | Delete staff account | Staff Tab ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1821-L1830)) | `DELETE /api/admin/staff/[email]` | FULLY IMPLEMENTED |
| 34 | **Theme Toggle & UI Preference** | Switch between high-contrast dark theme and clean light theme with local persistence | Toggle Theme | Top Bar ([AdminDashboard.tsx](file:///e:/Englezika/app/components/AdminDashboard.tsx#L453-L466)) | Frontend Local Storage | FULLY IMPLEMENTED |

---

## 4. Assistant — Complete Feature List

The Assistant's capabilities are strictly gated by the permissions assigned to their account in `staff_users.permissions`.

| # | Feature | Description | Permission Required | Actions Available | UI Location | Backend / API Route | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Staff Authentication** | Login with email and password | None (Valid active staff row) | Login, Logout | `/staff/login` | `POST /api/staff/login`, `POST /api/staff/logout` | FULLY IMPLEMENTED |
| 2 | **Dashboard Bootstrap (Scoped)** | Bootstrap endpoint returns only data categories permitted to this assistant | Any valid assistant session | View permitted sections & KPIs | `/admin` | `GET /api/admin/bootstrap` | FULLY IMPLEMENTED |
| 3 | **Overview Course Workspace** | View course cards with lesson/exam counts | `manage_courses` | Search courses, view course cards | Overview Tab | `GET /api/admin/bootstrap` | FULLY IMPLEMENTED |
| 4 | **Create Course** | Add new course with grade and price | `manage_courses` | Create course | Courses Tab | `POST /api/admin/courses` | FULLY IMPLEMENTED |
| 5 | **Edit Course** | Edit course title, grade, price, description, status | `manage_courses` | Edit course | Courses Tab | `PATCH /api/admin/courses/[id]` | FULLY IMPLEMENTED |
| 6 | **Delete Course** | Delete empty course | `manage_courses` | Delete course | Courses Tab | `DELETE /api/admin/courses/[id]` | FULLY IMPLEMENTED |
| 7 | **Create Video Lesson** | Add unlisted YouTube video with prerequisite gates | `manage_videos` | Create video | Videos Tab | `POST /api/admin/videos` | FULLY IMPLEMENTED |
| 8 | **Edit Video & Prerequisite Exam** | Update video title, status, prerequisite exam and score % | `manage_videos` | Edit video | Videos Tab | `PATCH /api/admin/videos/[id]` | FULLY IMPLEMENTED |
| 9 | **Delete Video** | Remove video lesson from course | `manage_videos` | Delete video | Videos Tab | `DELETE /api/admin/videos/[id]` | FULLY IMPLEMENTED |
| 10 | **Generate Lecture Access Code** | Generate cryptographic one-time redemption code for single video | `manage_videos` | Generate code, copy | Videos Tab | `POST /api/admin/videos/[id]/access-codes` | FULLY IMPLEMENTED |
| 11 | **View Lecture Access Code History** | Inspect last 100 generated lecture codes and redemption timestamps | `manage_videos` | View history | Videos Tab | `GET /api/admin/bootstrap` | FULLY IMPLEMENTED |
| 12 | **Create MCQ Exam** | Build MCQ exam with question order, points, options, and correct answer | `manage_exams` | Create exam | Exams Tab | `POST /api/admin/exams` | FULLY IMPLEMENTED |
| 13 | **Edit Exam Metadata & Schedule** | Edit duration, passing score, attempts limit, opens/closes dates | `manage_exams` | Edit metadata | Exams Tab | `PATCH /api/admin/exams/[id]` | FULLY IMPLEMENTED |
| 14 | **Toggle Exam Published State** | Publish or unpublish an exam | `manage_exams` | Toggle publish state | Exams Tab | `PATCH /api/admin/exams/[id]` | FULLY IMPLEMENTED |
| 15 | **Delete Exam** | Delete exam without attempts | `manage_exams` | Delete exam | Exams Tab | `DELETE /api/admin/exams/[id]` | FULLY IMPLEMENTED |
| 16 | **Review & Override Exam Scores** | View student exam attempts, override score, add review feedback | `grade_exams` | Modify score, save feedback | Results Tab | `PATCH /api/admin/attempts/[id]` | FULLY IMPLEMENTED |
| 17 | **Create Assignment** | Create assignment for course with due date and max score | `manage_assignments` | Create assignment | Assignments Tab | `POST /api/admin/assignments` | FULLY IMPLEMENTED |
| 18 | **Edit Assignment** | Update assignment details and due date | `manage_assignments` | Edit assignment | Assignments Tab | `PATCH /api/admin/assignments/[id]` | FULLY IMPLEMENTED |
| 19 | **Delete Assignment** | Remove assignment | `manage_assignments` | Delete assignment | Assignments Tab | `DELETE /api/admin/assignments/[id]` | FULLY IMPLEMENTED |
| 20 | **Browse & Search Students** | Search registered students by name, email, phone, and grade | `view_students` | Search, filter, paginate | Students Tab | `GET /api/admin/students` | FULLY IMPLEMENTED |
| 21 | **Inspect Student Profiles** | View student details (guardian phones, school, parent job, attempts count) | `view_students` | Expand student details | Students Tab | `GET /api/admin/students` | FULLY IMPLEMENTED |
| 22 | **View Student Birth Certificates** | Open and inspect private birth certificate document in storage | `view_students` | View / download PDF or image | Students Tab | `GET /api/admin/students/[email]/birth-certificate` | FULLY IMPLEMENTED |
| 23 | **Approve / Reject Enrollments** | Review student payment reference and approve or reject course enrollment | `manage_enrollments` | Approve, Reject | Enrollments Tab | `PATCH /api/admin/enrollments/[id]` | FULLY IMPLEMENTED |
| 24 | **Publish Announcements** | Broadcast system announcement to all students | `manage_announcements` | Publish announcement | Overview Tab | `POST /api/admin/announcements` | FULLY IMPLEMENTED |
| 25 | **Edit / Delete Announcements** | Modify or remove existing announcements | `manage_announcements` | Edit, Delete | Overview Tab | `PATCH /api/admin/announcements/[id]`, `DELETE /api/admin/announcements/[id]` | FULLY IMPLEMENTED |
| 26 | **Manage Contact Messages** | View student/parent messages and mark as reviewed | `manage_messages` | View, mark reviewed | Messages Tab | `PATCH /api/admin/contacts/[id]` | FULLY IMPLEMENTED |

---

## 5. Complete Assistant Permission List

Authoritative list of all 10 permissions declared in [`app/lib/staff-permissions.ts`](file:///e:/Englezika/app/lib/staff-permissions.ts#L1-L12).

| Permission Key | Meaning | Teacher | Assistant | Enables | Does NOT Enable | Code Reference |
|---|---|---|---|---|---|---|
| `manage_courses` | Course Curriculum Administration | Yes (Always) | Yes (If Assigned) | Create, edit, publish, delete courses; view course workspace; auto-attaches `manage_assignments` | Does NOT enable exam creation, video uploads, enrollment approval, or staff management | [`staff-permissions.ts:2`](file:///e:/Englezika/app/lib/staff-permissions.ts#L2), [`admin/courses/route.ts`](file:///e:/Englezika/app/api/admin/courses/route.ts#L9) |
| `manage_exams` | Exam Creation & Curriculum Testing | Yes (Always) | Yes (If Assigned) | Create exams, add/edit MCQ questions, set duration/pass mark, publish/unpublish, delete exams | Does NOT enable grading student submissions or overriding attempt scores | [`staff-permissions.ts:3`](file:///e:/Englezika/app/lib/staff-permissions.ts#L3), [`admin/exams/route.ts`](file:///e:/Englezika/app/api/admin/exams/route.ts#L26) |
| `manage_assignments` | Course Assignment Administration | Yes (Always) | Yes (If Assigned) | Create assignments, set due date & max score, edit, publish, delete assignments | Does NOT enable student submission grading (submission feature is not yet present) | [`staff-permissions.ts:4`](file:///e:/Englezika/app/lib/staff-permissions.ts#L4), [`admin/assignments/route.ts`](file:///e:/Englezika/app/api/admin/assignments/route.ts#L15) |
| `manage_videos` | Video Lectures & Access Codes | Yes (Always) | Yes (If Assigned) | Add YouTube unlisted videos, configure prerequisite exam gates & pass %, delete videos, generate one-time lecture access codes, view code history | Does NOT enable course pricing edits or exam grading | [`staff-permissions.ts:5`](file:///e:/Englezika/app/lib/staff-permissions.ts#L5), [`admin/videos/route.ts`](file:///e:/Englezika/app/api/admin/videos/route.ts#L32) |
| `manage_enrollments` | Student Subscription Approvals | Yes (Always) | Yes (If Assigned) | View enrollment requests with payment method & reference; approve or reject enrollments; view enrollment metrics | Does NOT enable manual student creation or course price modification | [`staff-permissions.ts:6`](file:///e:/Englezika/app/lib/staff-permissions.ts#L6), [`admin/enrollments/[id]/route.ts`](file:///e:/Englezika/app/api/admin/enrollments/[id]/route.ts#L8) |
| `grade_exams` | Student Exam Grading & Score Overrides | Yes (Always) | Yes (If Assigned) | View student exam submissions table, override score, provide teacher feedback, view platform average score & attempt counts | Does NOT enable exam question creation or exam deletion | [`staff-permissions.ts:7`](file:///e:/Englezika/app/lib/staff-permissions.ts#L7), [`admin/attempts/[id]/route.ts`](file:///e:/Englezika/app/api/admin/attempts/[id]/route.ts#L9) |
| `manage_announcements` | Global Student Announcements | Yes (Always) | Yes (If Assigned) | Create, edit, and delete broadcast announcements shown on student dashboard | Does NOT enable contact message management or student data export | [`staff-permissions.ts:8`](file:///e:/Englezika/app/lib/staff-permissions.ts#L8), [`admin/announcements/route.ts`](file:///e:/Englezika/app/api/admin/announcements/route.ts#L8) |
| `manage_messages` | Contact Inquiries & Support | Yes (Always) | Yes (If Assigned) | View student/parent contact form submissions and mark status as reviewed | Does NOT enable student profile viewing or enrollment management | [`staff-permissions.ts:9`](file:///e:/Englezika/app/lib/staff-permissions.ts#L9), [`admin/contacts/[id]/route.ts`](file:///e:/Englezika/app/api/admin/contacts/[id]/route.ts#L8) |
| `view_students` | Student Records & Private Documents | Yes (Always) | Yes (If Assigned) | Search and view student list, inspect full profile fields (parent phones, school, governorate), download private birth certificate files | Does NOT enable student account deletion or student password resets | [`staff-permissions.ts:10`](file:///e:/Englezika/app/lib/staff-permissions.ts#L10), [`admin/students/route.ts`](file:///e:/Englezika/app/api/admin/students/route.ts#L6) |
| `manage_staff` | Staff Account Administration (Teacher-Exclusive) | Yes (Always) | **NO (Hard Blocked)** | Create staff accounts, modify staff roles/presets, suspend accounts, reset staff passwords, delete staff | **CANNOT be granted to any Assistant**. API forbids `full_access` preset for assistant role. | [`staff-permissions.ts:11`](file:///e:/Englezika/app/lib/staff-permissions.ts#L11), [`admin/staff/route.ts`](file:///e:/Englezika/app/api/admin/staff/route.ts#L12) |

---

## 6. Course Management

- **Database Table:** `courses` (`id`, `title`, `grade`, `description`, `price`, `status`, `created_at`, `updated_at`) ([001_initial.sql:59-68](file:///e:/Englezika/database/migrations/001_initial.sql#L59-L68))
- **Authorized Roles:** Teacher (unconditional) or Assistant with `manage_courses`.
- **Creation Endpoint:** `POST /api/admin/courses` ([courses/route.ts](file:///e:/Englezika/app/api/admin/courses/route.ts))
  - Validates title (min 3 chars), grade (min 2 chars), price (0–100,000 EGP), status (`published` or `draft`).
  - Calls `invalidatePublicCourseCache()` upon insert.
- **Update Endpoint:** `PATCH /api/admin/courses/[id]` ([courses/[id]/route.ts](file:///e:/Englezika/app/api/admin/courses/[id]/route.ts#L6-L29))
  - Updates title, grade, description, price, status, and `updated_at`.
- **Deletion Endpoint:** `DELETE /api/admin/courses/[id]` ([courses/[id]/route.ts](file:///e:/Englezika/app/api/admin/courses/[id]/route.ts#L31-L53))
  - **Relational Integrity Check:** Counts linked records in `enrollments`, `exams`, `videos`, and `assignments`. If sum > 0, returns `409 Conflict` (`لا يمكن حذف كورس مرتبط بطلاب أو امتحانات أو فيديوهات`).
- **UI Components:**
  - `AdminCourseList.tsx` ([AdminCourseList.tsx](file:///e:/Englezika/app/components/admin/AdminCourseList.tsx)): Add form, course cards, inline details edit popover, delete button.
  - `TeacherCourseWorkspace.tsx` ([TeacherCourseWorkspace.tsx](file:///e:/Englezika/app/components/admin/TeacherCourseWorkspace.tsx)): Quick search, status filter, lesson/exam/student counters, shortcut buttons.

---

## 7. Video & Lecture Management

- **Database Table:** `videos` (`id`, `course_id`, `title`, `source_type`, `source_url`, `youtube_id`, `duration_seconds`, `prerequisite_exam_id`, `minimum_score`, `status`, `created_at`) ([001_initial.sql:159-171](file:///e:/Englezika/database/migrations/001_initial.sql#L159-L171))
- **Authorized Roles:** Teacher or Assistant with `manage_videos`.
- **Creation Endpoint:** `POST /api/admin/videos` ([videos/route.ts](file:///e:/Englezika/app/api/admin/videos/route.ts))
  - Parses YouTube ID (11 chars) from standard, short, embed, or shorts YouTube URLs.
  - Rejects multipart file uploads with `410 Gone` (`رفع ملفات الفيديو متوقف. أضف رابط YouTube غير مدرج بدلًا منه.`).
  - Validates prerequisite exam belongs to the same course.
- **Update Endpoint:** `PATCH /api/admin/videos/[id]` ([videos/[id]/route.ts](file:///e:/Englezika/app/api/admin/videos/[id]/route.ts#L6-L54))
  - Updates title, status (`draft` / `published`), `prerequisiteExamId`, and `minimumScore` (0–100%).
- **Deletion Endpoint:** `DELETE /api/admin/videos/[id]` ([videos/[id]/route.ts](file:///e:/Englezika/app/api/admin/videos/[id]/route.ts#L56-L68))
  - Deletes video row and invalidates public course cache.
- **Sequential Lesson & Exam Interlocking:**
  - When `prerequisite_exam_id` is set, a student cannot stream the video or get an playback token until they pass the prerequisite exam with score >= `minimum_score` (enforced server-side in `app/lib/video-access.ts`).

---

## 8. Lecture Access Codes

- **Database Tables:**
  - `lecture_access_codes` (`id`, `code_hash`, `display_suffix`, `course_id`, `video_id`, `created_by_staff_email`, `created_at`, `redeemed_by_student_email`, `redeemed_at`) ([003_one_time_video_access_codes.sql:1-14](file:///e:/Englezika/database/migrations/003_one_time_video_access_codes.sql#L1-L14))
  - `student_video_access_grants` (`id`, `student_email`, `video_id`, `source`, `source_access_code_id`, `created_at`) ([003_one_time_video_access_codes.sql:16-25](file:///e:/Englezika/database/migrations/003_one_time_video_access_codes.sql#L16-L25))
- **Authorized Roles:** Teacher or Assistant with `manage_videos`.
- **Generation Endpoint:** `POST /api/admin/videos/[id]/access-codes` ([access-codes/route.ts](file:///e:/Englezika/app/api/admin/videos/[id]/access-codes/route.ts))
  - Generates a high-entropy 30-character Crockford Base32 token (`ENG-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`) via `crypto.randomBytes(30)`.
  - Calculates SHA-256 hash. Stored in DB with only hash and 5-character suffix (`display_suffix`).
  - Returns plaintext code in the HTTP 201 response once with `Cache-Control: private, no-store`.
  - Records audit log in `audit_logs` table (`lecture_access_code.created`).
- **Redemption Workflow:**
  - Student redeems via `POST /api/lecture-access-codes/redeem` ([redeem route](file:///e:/Englezika/app/api/lecture-access-codes/redeem/route.ts)).
  - Executed inside an atomic PostgreSQL CTE with row-level locking (`FOR UPDATE`) in `app/lib/lecture-access-codes.ts` preventing any race condition.
  - Grants standalone access to that individual lecture without granting full course access or skipping other prerequisites.
- **Staff UI Component:** `LectureAccessCodeManager.tsx` ([LectureAccessCodeManager.tsx](file:///e:/Englezika/app/components/admin/LectureAccessCodeManager.tsx)): Generates code, provides single-click clipboard copy, and displays expandable history of previous codes.

---

## 9. Student Management

- **Database Table:** `users` where `role = 'student'` ([001_initial.sql:6-37](file:///e:/Englezika/database/migrations/001_initial.sql#L6-L37))
- **Authorized Roles:** Teacher or Assistant with `view_students`.
- **Listing Endpoint:** `GET /api/admin/students` ([students/route.ts](file:///e:/Englezika/app/api/admin/students/route.ts))
  - Paginated (1 to 200 per page, default 50).
  - Search query `q` searches `email`, `name`, `phone` with SQL LIKE wildcard.
  - Grade filter `grade` exact match.
  - Computes dynamic subqueries: `activeEnrollments` count, `totalAttempts` count, `hasBirthCertificate` flag.
- **Detailed Profile Fields Exposed:**
  - Student full name (`name`, `firstName`, `secondName`, `thirdName`, `lastName`)
  - Primary contact: `email`, `phone`
  - Guardian contacts: `fatherPhone`, `motherPhone`, `parentJob`
  - Academic metadata: `schoolName`, `governorate`, `gender`, `grade`, `section`
  - Registration timestamp `createdAt`
  - Total active subscriptions & total exam attempts
- **Birth Certificate Streaming:** `GET /api/admin/students/[email]/birth-certificate` ([birth-certificate/route.ts](file:///e:/Englezika/app/api/admin/students/[email]/birth-certificate/route.ts))
  - Streams binary file from storage with headers `Content-Disposition: inline; filename="birth-certificate.pdf/png/jpg"`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.
- **UI Component:** `StudentsPanel` in `AdminDashboard.tsx` ([AdminDashboard.tsx:1859-2053](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1859-L2053)).

---

## 10. Enrollment Management

- **Database Table:** `enrollments` (`id`, `user_email`, `course_id`, `status`, `payment_method`, `payment_reference`, `created_at`, `updated_at`) ([001_initial.sql:70-79](file:///e:/Englezika/database/migrations/001_initial.sql#L70-L79))
- **Authorized Roles:** Teacher or Assistant with `manage_enrollments`.
- **Status Values:** `pending` (default), `approved`, `rejected`.
- **Review & Mutation Endpoint:** `PATCH /api/admin/enrollments/[id]` ([enrollments/[id]/route.ts](file:///e:/Englezika/app/api/admin/enrollments/[id]/route.ts))
  - Accepts `{ "status": "approved" | "rejected" | "pending" }`.
  - Updates status and `updated_at`.
  - Once status is `approved`, student dashboard instantly unlocks the course and sequential video playback.
- **UI:** Tab `الاشتراكات` in `AdminDashboard.tsx` ([AdminDashboard.tsx:983-1064](file:///e:/Englezika/app/components/AdminDashboard.tsx#L983-L1064)). Displays student email, course title, payment method, payment reference, status badge, and immediate "تفعيل" (Approve) / "رفض" (Reject) buttons.

---

## 11. Payments

- **Database Tables:** `payment_intents` ([001_initial.sql:81-97](file:///e:/Englezika/database/migrations/001_initial.sql#L81-L97)) & `enrollments`
- **Gateway Integration:** Fawaterak API v3 (`fawaterak.ts`, `fawaterak-crypto.ts`, `fawaterak-validation.ts`)
- **Admin Visibility:**
  - Payment details are surfaced to staff via the `enrollments` table (`payment_method` and `payment_reference`).
  - Pending payment reference numbers (Vodafone Cash wallet reference, Fawaterak transaction reference, or manual transfer notes) are displayed directly in the enrollment approval table.
- **Refunds & Adjustments:** Handled via gateway webhooks; there is no manual in-app refund button exposed to staff.

---

## 12. Exam Management

- **Database Tables:** `exams` ([001_initial.sql:99-114](file:///e:/Englezika/database/migrations/001_initial.sql#L99-L114)) and `questions` ([001_initial.sql:116-126](file:///e:/Englezika/database/migrations/001_initial.sql#L116-L126))
- **Authorized Roles:** Teacher or Assistant with `manage_exams`.
- **Creation Endpoint:** `POST /api/admin/exams` ([exams/route.ts](file:///e:/Englezika/app/api/admin/exams/route.ts))
  - Accepts `title`, `description`, `instructions`, `courseId` (optional, can be general exam), `durationMinutes` (1–300), `passingScore` (0–100%), `maxAttempts` (1–10), `status` (`published`/`draft`), `opensAt`, `closesAt`, and `questions` array.
  - Inserts exam and child questions in a single atomic database batch.
  - Enforces that each MCQ question has at least 2 options and that the correct answer is one of the listed options.
- **Detail Endpoint:** `GET /api/admin/exams/[id]` ([exams/[id]/route.ts:6-35](file:///e:/Englezika/app/api/admin/exams/[id]/route.ts#L6-L35))
- **Update Endpoint:** `PATCH /api/admin/exams/[id]` ([exams/[id]/route.ts:37-154](file:///e:/Englezika/app/api/admin/exams/[id]/route.ts#L37-L154))
  - Updates metadata and schedule.
  - If `questions` array is provided, validates that no attempts exist in `attempts` table; if attempts exist, returns `409 Conflict` to preserve score integrity.
  - Clears `notification_reads` for this exam so students receive updated alerts.
- **Deletion Endpoint:** `DELETE /api/admin/exams/[id]` ([exams/[id]/route.ts:156-190](file:///e:/Englezika/app/api/admin/exams/[id]/route.ts#L156-L190))
  - Blocked with `409 Conflict` if attempts exist or if exam is linked as a video prerequisite.
- **UI:** Tab `الامتحانات` with `ExamBuilder` and exam list in `AdminDashboard.tsx` ([AdminDashboard.tsx:697-840](file:///e:/Englezika/app/components/AdminDashboard.tsx#L697-L840)).

---

## 13. Exam Grading & Result Review

- **Database Table:** `attempts` (`id`, `exam_id`, `user_email`, `status`, `score`, `max_score`, `feedback`, `grading_method`, `started_at`, `submitted_at`) ([001_initial.sql:128-139](file:///e:/Englezika/database/migrations/001_initial.sql#L128-L139))
- **Authorized Roles:** Teacher or Assistant with `grade_exams`.
- **Review & Override Endpoint:** `PATCH /api/admin/attempts/[id]` ([attempts/[id]/route.ts](file:///e:/Englezika/app/api/admin/attempts/[id]/route.ts))
  - Accepts `score` (bounded 0 to max_score) and `feedback` text (up to 2000 chars).
  - Updates attempt: `UPDATE attempts SET score = ?, feedback = ?, grading_method = 'teacher_review' WHERE id = ?`.
  - Automatically invalidates leaderboard cache (`invalidateLeaderboardCache()`).
- **UI:** Tab `النتائج والتصحيح` in `AdminDashboard.tsx` ([AdminDashboard.tsx:1067-1143](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1067-L1143)). Table shows student email, exam title, score/maxScore, grading method, and modal button to edit score and input feedback.

---

## 14. Assignment Management

- **Database Table:** `assignments` (`id`, `course_id`, `title`, `description`, `due_at`, `max_score`, `status`, `created_by`, `created_at`, `updated_at`) ([001_initial.sql:204-215](file:///e:/Englezika/database/migrations/001_initial.sql#L204-L215))
- **Authorized Roles:** Teacher or Assistant with `manage_assignments`.
- **Endpoints:**
  - `POST /api/admin/assignments` ([assignments/route.ts](file:///e:/Englezika/app/api/admin/assignments/route.ts)): Creates assignment with course linkage, title, description, timestamp `dueAt`, and `maxScore`.
  - `PATCH /api/admin/assignments/[id]` ([assignments/[id]/route.ts:12-60](file:///e:/Englezika/app/api/admin/assignments/[id]/route.ts#L12-L60)): Updates assignment details and clears `notification_reads`.
  - `DELETE /api/admin/assignments/[id]` ([assignments/[id]/route.ts:62-80](file:///e:/Englezika/app/api/admin/assignments/[id]/route.ts#L62-L80)): Deletes assignment and associated notification read rows.
- **UI:** Tab `الواجبات` rendered via `AdminAssignmentList.tsx` ([AdminAssignmentList.tsx](file:///e:/Englezika/app/components/admin/AdminAssignmentList.tsx)).
- **Implementation Status:** PARTIALLY IMPLEMENTED (Assignment publishing and student viewing are fully functional; online file upload submissions and individual grading table are not present in schema).

---

## 15. Staff & Permission Management (Teacher-Exclusive)

- **Database Table:** `staff_users` & `staff_sessions`
- **Authorized Roles:** **Teacher Only** (`manage_staff`). Assistants are hard-blocked from ever receiving or executing this permission.
- **Endpoints:**
  - `GET /api/admin/staff` ([staff/route.ts:11-22](file:///e:/Englezika/app/api/admin/staff/route.ts#L11-L22)): Returns list of all staff accounts sorted with teacher first.
  - `POST /api/admin/staff` ([staff/route.ts:24-71](file:///e:/Englezika/app/api/admin/staff/route.ts#L24-L71)): Creates staff account. Rejects assistant creation if preset is `full_access`. Enforces 12+ char strong password.
  - `PATCH /api/admin/staff/[email]` ([staff/[email]/route.ts:25-79](file:///e:/Englezika/app/api/admin/staff/[email]/route.ts#L25-L79)): Updates role, preset permissions, active flag, or resets password (revoking existing sessions).
  - `DELETE /api/admin/staff/[email]` ([staff/[email]/route.ts:81-113](file:///e:/Englezika/app/api/admin/staff/[email]/route.ts#L81-L113)): Permanently deletes staff account and all active sessions. Throws `403 Forbidden` if actor attempts self-deletion.
- **UI:** Tab `حسابات الفريق` (`StaffManager`) in `AdminDashboard.tsx` ([AdminDashboard.tsx:1578-1839](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1578-L1839)).

---

## 16. Announcements

- **Database Table:** `announcements` (`id`, `title`, `body`, `status`, `created_at`) ([001_initial.sql:196-202](file:///e:/Englezika/database/migrations/001_initial.sql#L196-L202))
- **Authorized Roles:** Teacher or Assistant with `manage_announcements`.
- **Endpoints:**
  - `POST /api/admin/announcements` ([announcements/route.ts](file:///e:/Englezika/app/api/admin/announcements/route.ts))
  - `PATCH /api/admin/announcements/[id]` ([announcements/[id]/route.ts:15-39](file:///e:/Englezika/app/api/admin/announcements/[id]/route.ts#L15-L39))
  - `DELETE /api/admin/announcements/[id]` ([announcements/[id]/route.ts:41-75](file:///e:/Englezika/app/api/admin/announcements/[id]/route.ts#L41-L75))
- **UI:** Create form in Overview panel ([AdminStatsPanel.tsx:97-127](file:///e:/Englezika/app/components/admin/AdminStatsPanel.tsx#L97-L127)) and announcement management list ([AdminAnnouncementsList.tsx](file:///e:/Englezika/app/components/admin/AdminAnnouncementsList.tsx)).

---

## 17. Contact Messages

- **Database Table:** `contacts` (`id`, `name`, `phone`, `message`, `status`, `created_at`) ([001_initial.sql:187-194](file:///e:/Englezika/database/migrations/001_initial.sql#L187-L194))
- **Authorized Roles:** Teacher or Assistant with `manage_messages`.
- **Endpoint:** `PATCH /api/admin/contacts/[id]` ([contacts/[id]/route.ts](file:///e:/Englezika/app/api/admin/contacts/[id]/route.ts))
  - Toggles message status between `new` and `reviewed`.
- **UI:** Tab `الرسائل` in `AdminDashboard.tsx` ([AdminDashboard.tsx:1146-1193](file:///e:/Englezika/app/components/AdminDashboard.tsx#L1146-L1193)) with clickable `tel:` links and review toggle buttons.

---

## 18. Private Student Documents

- **Document Type:** Birth certificate upload (`birth_certificate_key`, `birth_certificate_content_type` in `users` table).
- **Authorized Roles:** Teacher or Assistant with `view_students`.
- **Endpoint:** `GET /api/admin/students/[email]/birth-certificate` ([birth-certificate/route.ts](file:///e:/Englezika/app/api/admin/students/[email]/birth-certificate/route.ts))
- **Security:** Private storage driver (`app/lib/private-storage.ts`). Not exposed as public URLs; streamed through authenticated API with zero client-side caching headers.

---

## 19. Dashboard & Analytics

- **Endpoint:** `GET /api/admin/bootstrap` ([bootstrap/route.ts](file:///e:/Englezika/app/api/admin/bootstrap/route.ts))
- **Metrics Calculated:**
  - `students`: Total registered student accounts (filtered if staff lacks `view_students` and `manage_enrollments`)
  - `activeEnrollments`: Total approved enrollments (filtered if staff lacks `manage_enrollments`)
  - `pendingEnrollments`: Total pending enrollments (filtered if staff lacks `manage_enrollments`)
  - `publishedExams`: Total published exams (filtered if staff lacks `manage_exams` and `grade_exams`)
  - `attempts`: Total exam submissions (filtered if staff lacks `grade_exams`)
  - `averageScore`: Platform-wide average exam score % (filtered if staff lacks `grade_exams`)
  - `newMessages`: Unreviewed contact inquiries count (filtered if staff lacks `manage_messages`)

---

## 20. Teacher-Only Capabilities

The following capabilities are **exclusive to the Teacher / Super Admin** and cannot be executed by any Assistant under any configuration:

1. **Staff Account Creation:** Creating new assistant or teacher accounts (`POST /api/admin/staff`).
2. **Staff Account Inspection:** Listing all staff members and their active status (`GET /api/admin/staff`).
3. **Staff Permission & Role Editing:** Promoting staff to Teacher or changing Assistant presets (`PATCH /api/admin/staff/[email]`).
4. **Staff Suspension / Activation:** Deactivating or re-enabling staff logins (`PATCH /api/admin/staff/[email]`).
5. **Staff Password Resets:** Changing staff passwords and instantly terminating their active sessions (`PATCH /api/admin/staff/[email]`).
6. **Staff Account Deletion:** Hard-deleting staff accounts (`DELETE /api/admin/staff/[email]`).
7. **Accessing the Staff Management UI Tab:** The `حسابات الفريق` tab is completely hidden from assistants.
8. **Server-Side Universal Bypass:** The teacher role automatically bypasses all 10 permission gates on all endpoints.

---

## 21. Assistant Profiles

### Profile 1: Course Manager Assistant (`course_manager`)
- **Permissions:** `manage_courses`, `manage_exams`, `manage_assignments`, `manage_videos`
- **Accessible Pages/Tabs:** Overview (Course Workspace), Courses, Exams, Assignments, Videos.
- **Available Capabilities:**
  - Create, edit, publish, delete courses
  - Create, edit, publish, delete MCQ exams and questions
  - Create, edit, publish, delete assignments
  - Add YouTube unlisted video lectures, configure prerequisite exams & passing scores, delete videos
  - Generate one-time lecture access codes and view code generation history
- **Forbidden Capabilities:**
  - Grade student submissions or override scores
  - View student directory or birth certificates
  - Approve or reject enrollments
  - View contact messages or manage announcements
  - Manage staff

### Profile 2: Grader Assistant (`grader`)
- **Permissions:** `grade_exams`, `view_students`
- **Accessible Pages/Tabs:** Overview, Students, Results and Grading.
- **Available Capabilities:**
  - View student exam submissions list
  - Manually review and override exam attempt scores with written feedback
  - Browse and search student directory (filter by grade, name, email, phone)
  - View detailed student profiles and guardian information
  - Download and inspect confidential student birth certificate files
  - View platform total attempts and average score metrics
- **Forbidden Capabilities:**
  - Create or edit courses, exams, assignments, or videos
  - Generate lecture access codes
  - Approve or reject enrollments
  - View contact messages or manage announcements
  - Manage staff

### Profile 3: Enrollment Manager Assistant (`enrollment_manager`)
- **Permissions:** `manage_enrollments`, `view_students`
- **Accessible Pages/Tabs:** Overview, Students, Enrollments.
- **Available Capabilities:**
  - View all course enrollment requests with payment methods & references
  - Approve enrollments (activating student course access) or reject enrollments
  - Search and inspect student directory profiles
  - Download and verify student birth certificate files
  - View active and pending enrollment counts
- **Forbidden Capabilities:**
  - Create or edit courses, exams, assignments, or videos
  - Grade exams or override scores
  - View contact messages or manage announcements
  - Manage staff

---

## 22. Feature / Permission Matrix

| Feature | Teacher / Super Admin | Assistant | Required Assistant Permission | Read | Create | Edit | Delete | Approve / Grade | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Course Management** | YES | PERMISSION-BASED | `manage_courses` | YES | YES | YES | YES | N/A | Deletion blocked if dependencies exist |
| **Exam Creation & Editing** | YES | PERMISSION-BASED | `manage_exams` | YES | YES | YES | YES | N/A | Question edit blocked if attempts exist |
| **Exam Grading & Review** | YES | PERMISSION-BASED | `grade_exams` | YES | N/A | YES | N/A | YES | Sets `grading_method = 'teacher_review'` |
| **Assignment Management** | YES | PERMISSION-BASED | `manage_assignments` | YES | YES | YES | YES | N/A | Publishing only; submissions not present |
| **Video Lecture Management** | YES | PERMISSION-BASED | `manage_videos` | YES | YES | YES | YES | N/A | YouTube unlisted integration |
| **Lecture Access Codes** | YES | PERMISSION-BASED | `manage_videos` | YES | YES | N/A | N/A | N/A | Generates single-use Crockford Base32 token |
| **Student Directory & Profiles** | YES | PERMISSION-BASED | `view_students` | YES | N/A | N/A | N/A | N/A | Search by name, email, phone, grade |
| **Birth Certificate Documents** | YES | PERMISSION-BASED | `view_students` | YES | N/A | N/A | N/A | N/A | Streamed from private storage |
| **Enrollment Approvals** | YES | PERMISSION-BASED | `manage_enrollments` | YES | N/A | YES | N/A | YES | Approves or rejects enrollment |
| **Announcements** | YES | PERMISSION-BASED | `manage_announcements` | YES | YES | YES | YES | N/A | Broadcast to all student dashboards |
| **Contact Inquiries** | YES | PERMISSION-BASED | `manage_messages` | YES | N/A | YES | N/A | N/A | Marks as reviewed |
| **Staff Account Administration** | YES | **NO** | `manage_staff` (Teacher Only) | YES | YES | YES | YES | N/A | Exclusive to Teacher |

---

## 23. API Authorization Matrix

| HTTP Method | Route | Purpose | Teacher Allowed | Assistant Allowed | Required Assistant Permission | Additional Conditions | Read/Write/Delete/Approve | Notes |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/admin/bootstrap` | Aggregated dashboard data | YES | YES | None | Scoped by caller permissions | Read | Returns filtered metrics & datasets |
| `POST` | `/api/admin/courses` | Create new course | YES | YES | `manage_courses` | Valid origin, title >= 3 | Create | Invalidates public cache |
| `PATCH` | `/api/admin/courses/[id]` | Update course | YES | YES | `manage_courses` | Valid origin, existing course | Edit | Invalidates public cache |
| `DELETE` | `/api/admin/courses/[id]` | Delete course | YES | YES | `manage_courses` | Valid origin, 0 dependencies | Delete | Blocked with 409 if dependencies exist |
| `POST` | `/api/admin/videos` | Add YouTube lecture | YES | YES | `manage_videos` | JSON body, valid YouTube URL | Create | Raw uploads return 410 |
| `PATCH` | `/api/admin/videos/[id]` | Edit video / prerequisite | YES | YES | `manage_videos` | Valid origin, title >= 2 | Edit | Updates prerequisite exam gate |
| `DELETE` | `/api/admin/videos/[id]` | Delete video | YES | YES | `manage_videos` | Valid origin, existing video | Delete | Clears video record |
| `POST` | `/api/admin/videos/[id]/access-codes` | Generate lecture access code | YES | YES | `manage_videos` | Valid origin, existing video | Generate | Logs `audit_logs` entry |
| `POST` | `/api/admin/exams` | Create MCQ exam | YES | YES | `manage_exams` | MCQ validation, valid options | Create | Inserts exam and questions atomically |
| `GET` | `/api/admin/exams/[id]` | Get exam & questions | YES | YES | `manage_exams` | Existing exam | Read | Returns parsed JSON options |
| `PATCH` | `/api/admin/exams/[id]` | Edit exam / questions | YES | YES | `manage_exams` | If questions provided: 0 attempts | Edit | Replaces questions if 0 attempts |
| `DELETE` | `/api/admin/exams/[id]` | Delete exam | YES | YES | `manage_exams` | 0 attempts, not prerequisite | Delete | Cleans questions & notification reads |
| `PATCH` | `/api/admin/attempts/[id]` | Override exam score | YES | YES | `grade_exams` | Valid origin, score <= maxScore | Grade / Approve | Invalidates leaderboard cache |
| `POST` | `/api/admin/assignments` | Create assignment | YES | YES | `manage_assignments` | Valid origin, title >= 3 | Create | Links to course |
| `PATCH` | `/api/admin/assignments/[id]` | Edit assignment | YES | YES | `manage_assignments` | Valid origin, valid dueAt | Edit | Resets notification read marks |
| `DELETE` | `/api/admin/assignments/[id]` | Delete assignment | YES | YES | `manage_assignments` | Valid origin, existing record | Delete | Removes notification reads |
| `PATCH` | `/api/admin/enrollments/[id]` | Approve/reject enrollment | YES | YES | `manage_enrollments` | Valid origin, valid status | Approve / Reject | Unlocks course for student |
| `GET` | `/api/admin/students` | List/search students | YES | YES | `view_students` | Page & limit bounds | Read | Paginated search across fields |
| `GET` | `/api/admin/students/[email]/birth-certificate` | Stream birth certificate | YES | YES | `view_students` | Existing storage file | Read / Download | Private storage streaming |
| `GET` | `/api/admin/staff` | List staff accounts | YES | **NO** | `manage_staff` | Teacher only | Read | Lists all staff accounts |
| `POST` | `/api/admin/staff` | Create staff account | YES | **NO** | `manage_staff` | Strong password, preset check | Create | Assistants cannot have `full_access` |
| `PATCH` | `/api/admin/staff/[email]` | Update staff account | YES | **NO** | `manage_staff` | Valid preset/role | Edit | Revokes sessions on password change |
| `DELETE` | `/api/admin/staff/[email]` | Delete staff account | YES | **NO** | `manage_staff` | Forbids self-deletion | Delete | Hard deletes user & sessions |
| `POST` | `/api/admin/announcements` | Create announcement | YES | YES | `manage_announcements` | Valid origin, title & body | Create | Broadcasts to students |
| `PATCH` | `/api/admin/announcements/[id]` | Edit announcement | YES | YES | `manage_announcements` | UUID validation, title & body | Edit | Clears notification reads |
| `DELETE` | `/api/admin/announcements/[id]` | Delete announcement | YES | YES | `manage_announcements` | UUID validation | Delete | Deletes announcement & reads |
| `PATCH` | `/api/admin/contacts/[id]` | Mark contact reviewed | YES | YES | `manage_messages` | Valid origin, status in list | Edit | Toggles reviewed status |
| `POST` | `/api/staff/login` | Staff login | ALL | ALL | None | 5 attempts/min rate limit | Authenticate | Sets `englizeka_staff` cookie |
| `POST` | `/api/staff/logout` | Staff logout | ALL | ALL | Valid staff session | None | Revoke | Clears cookie & deletes session |

---

## 24. Security Restrictions

1. **Server-Side Enforcement:** Every single admin route enforces `apiStaff(request, permission)` server-side. Removing or altering frontend UI elements does not permit unauthorized API calls.
2. **Self-Escalation & Privilege Tampering Prevention:** An Assistant cannot call `/api/admin/staff` endpoints to elevate their own role or permissions because `manage_staff` is never assigned to any assistant.
3. **Self-Deletion Prevention:** In `DELETE /api/admin/staff/[email]`, if `actor.email === email`, the API immediately aborts with `403 Forbidden` (`لا يمكنك حذف حسابك الخاص`).
4. **Session Invalidation on Password Reset:** When a staff member's password is changed via `PATCH /api/admin/staff/[email]`, all active sessions in `staff_sessions` for that email are immediately wiped, forcing instant logout on all devices.
5. **Account Lockout on Brute Force:** 5 consecutive failed login attempts locks the staff account for 15 minutes in `staff_users.locked_until`.
6. **Cross-Origin Request Forgery Guard:** Every modifying admin route calls `requireSameOrigin(request)` to ensure requests originate from the application's trusted origin.

---

## 25. Missing / Partial Features

| Area | Feature Identified | Current Implementation Status | Exact Implementation Gap |
|---|---|---|---|
| **Assignments** | Student Assignment Submission & Grading | **PARTIAL** | Staff can create, edit, and delete assignments. Students can view them on their dashboard. However, there is no database table for student submission file uploads, no submission tracking API, and no staff assignment grading interface. |
| **Enrollments** | Manual Staff-Created Enrollment | **NOT IMPLEMENTED** | Staff can approve or reject existing enrollment requests submitted by students. There is no API route or UI form for staff to manually register an enrollment from scratch without a prior student record. |
| **Exams** | Non-MCQ Question Types in Exam Builder | **PARTIAL** | The Exam Builder UI only provides MCQ questions with auto-grading. The backend update schema accepts `true_false` and `short_answer` strings, but creation hardcodes `multiple_choice` and automated evaluation is rule-based for MCQs. |
| **Payments** | In-Dashboard Refund Trigger | **BACKEND / GATEWAY ONLY** | Fawaterak payment webhooks and status transitions are implemented. There is no UI button in the Admin Dashboard to issue a refund directly through the API. |
| **Video Management** | Direct Binary Video File Upload | **DEPRECATED / REPLACED** | `POST /api/admin/videos` rejects binary multipart uploads with HTTP `410 Gone` and mandates unlisted YouTube URLs. |

---

## 26. Final Role Comparison

| Capability | Teacher / Super Admin | Course Manager Assistant | Grader Assistant | Enrollment Manager Assistant |
|---|---|---|---|---|
| **Manage Staff Accounts** | **YES (Exclusive)** | **NO** | **NO** | **NO** |
| **Course CRUD & Pricing** | **YES** | **YES** | **NO** | **NO** |
| **Video Lecture Management** | **YES** | **YES** | **NO** | **NO** |
| **Lecture Access Code Generation** | **YES** | **YES** | **NO** | **NO** |
| **Exam Creation & Editing** | **YES** | **YES** | **NO** | **NO** |
| **Exam Grading & Score Overrides** | **YES** | **NO** | **YES** | **NO** |
| **Assignment Creation & Editing** | **YES** | **YES** | **NO** | **NO** |
| **View Student Directory & Profiles** | **YES** | **NO** | **YES** | **YES** |
| **Download Birth Certificates** | **YES** | **NO** | **YES** | **YES** |
| **Approve / Reject Enrollments** | **YES** | **NO** | **NO** | **YES** |
| **Publish Global Announcements** | **YES** | **NO** | **NO** | **NO** |
| **Manage Contact Messages** | **YES** | **NO** | **NO** | **NO** |
| **Platform KPI Overview** | **Full (All Metrics)** | **Course & Exam Counts** | **Attempts & Avg Score** | **Student & Enrollment Counts** |
| **Bypass Permission Gating** | **YES (Universal Bypass)** | **NO (Gated)** | **NO (Gated)** | **NO (Gated)** |
