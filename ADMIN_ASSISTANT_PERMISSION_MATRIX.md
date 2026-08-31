# Englizeka Admin & Assistant Permission Matrix

> **Document Type:** Detailed Feature-by-Feature & Action-by-Action RBAC Matrix  
> **Target Roles:** Teacher (Super Admin) & Assistant (Role-Based Staff)  
> **Source Code Basis:** `app/lib/staff-permissions.ts`, `app/lib/staff-auth.ts`, `app/components/AdminDashboard.tsx`, and all API route handlers under `app/api/admin/`

---

## 1. Master RBAC Feature & Action Matrix

| Feature / Subsystem | Teacher / Super Admin | Assistant | Required Assistant Permission | Read | Create | Edit | Delete | Approve / Grade | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Course Catalog Management** | YES | PERMISSION-BASED | `manage_courses` | YES | YES | YES | YES | N/A | Deletion blocked with 409 if dependencies exist in enrollments/exams/videos/assignments |
| **Course Workspace Overview** | YES | PERMISSION-BASED | `manage_courses` | YES | N/A | N/A | N/A | N/A | Quick search and counters for lessons, exams, assignments, students |
| **Video Lecture Management** | YES | PERMISSION-BASED | `manage_videos` | YES | YES | YES | YES | N/A | Unlisted YouTube video integration; raw binary uploads return 410 |
| **Sequential Lesson Prerequisite Gating** | YES | PERMISSION-BASED | `manage_videos` | YES | YES | YES | N/A | N/A | Sets required prerequisite exam and minimum passing threshold (%) |
| **One-Time Lecture Access Code Generation** | YES | PERMISSION-BASED | `manage_videos` | YES | YES | N/A | N/A | N/A | Generates single-use 30-char token; logs audit trail; stores SHA-256 hash |
| **Lecture Access Code History** | YES | PERMISSION-BASED | `manage_videos` | YES | N/A | N/A | N/A | N/A | Displays last 100 codes with masked suffix and redemption timestamps |
| **MCQ Exam Creation & Question Builder** | YES | PERMISSION-BASED | `manage_exams` | YES | YES | YES | YES | N/A | Atomically saves exam and questions; question edits blocked if attempts exist |
| **Exam Schedule & Metadata Editing** | YES | PERMISSION-BASED | `manage_exams` | YES | N/A | YES | N/A | N/A | Edits duration (1–300 min), passing score (0–100%), max attempts (1–10), opens/closes dates |
| **Exam Publish State Toggle** | YES | PERMISSION-BASED | `manage_exams` | YES | N/A | YES | N/A | N/A | One-click toggle between draft and published |
| **Exam Deletion & Guard** | YES | PERMISSION-BASED | `manage_exams` | YES | N/A | N/A | YES | N/A | Deletion blocked with 409 if attempts exist or if exam is video prerequisite |
| **Exam Submission Review & Score Override** | YES | PERMISSION-BASED | `grade_exams` | YES | N/A | YES | N/A | YES | Manually overrides score, writes feedback, sets grading_method to `teacher_review` |
| **Assignment Creation & Metadata** | YES | PERMISSION-BASED | `manage_assignments` | YES | YES | YES | YES | N/A | Sets course, title, description, dueAt, maxScore, draft/published status |
| **Assignment Student Submissions & Grading** | NO | NO | N/A | N/A | N/A | N/A | N/A | N/A | **PARTIAL**: Assignment publishing works; online student submission uploads & grading table are not implemented |
| **Student Directory & Multi-Field Search** | YES | PERMISSION-BASED | `view_students` | YES | N/A | N/A | N/A | N/A | Paginated list (50/page) with full-text search across name, email, phone, and grade filter |
| **Student Detailed Profile Inspection** | YES | PERMISSION-BASED | `view_students` | YES | N/A | N/A | N/A | N/A | Four-part name, guardian phones, school, parent job, governorate, gender, grade, section |
| **Confidential Birth Certificate Viewer** | YES | PERMISSION-BASED | `view_students` | YES | N/A | N/A | N/A | N/A | Streams private storage document (PDF/PNG/JPG) with private, no-store headers |
| **Enrollment Request Review** | YES | PERMISSION-BASED | `manage_enrollments` | YES | N/A | N/A | N/A | N/A | Displays student email, course title, payment method, payment reference |
| **Enrollment Approval & Access Activation** | YES | PERMISSION-BASED | `manage_enrollments` | YES | N/A | YES | N/A | YES | Sets status to `approved`, immediately unlocking course content for student |
| **Enrollment Rejection** | YES | PERMISSION-BASED | `manage_enrollments` | YES | N/A | YES | N/A | YES | Sets status to `rejected` |
| **Manual Student Enrollment Creation** | NO | NO | N/A | N/A | N/A | N/A | N/A | N/A | **NOT IMPLEMENTED**: Staff can only approve/reject existing requests; no manual creation endpoint |
| **Global Broadcast Announcements** | YES | PERMISSION-BASED | `manage_announcements` | YES | YES | YES | YES | N/A | Posts title/body visible on student dashboard; edits reset notification read markers |
| **Contact Inquiries Management** | YES | PERMISSION-BASED | `manage_messages` | YES | N/A | YES | N/A | N/A | Displays incoming messages with direct phone dial link; marks status as reviewed |
| **Staff Account Creation** | **YES** | **NO** | `manage_staff` (Teacher Only) | YES | YES | N/A | N/A | N/A | Exclusive to Teacher; enforces 12+ char strong password; rejects `full_access` for assistant |
| **Staff Account List & Status Inspection** | **YES** | **NO** | `manage_staff` (Teacher Only) | YES | N/A | N/A | N/A | N/A | Exclusive to Teacher; shows active/locked status and assigned permission presets |
| **Staff Role & Preset Modification** | **YES** | **NO** | `manage_staff` (Teacher Only) | YES | N/A | YES | N/A | N/A | Exclusive to Teacher; assigns `grader`, `course_manager`, or `enrollment_manager` |
| **Staff Account Suspension / Activation** | **YES** | **NO** | `manage_staff` (Teacher Only) | YES | N/A | YES | N/A | N/A | Exclusive to Teacher; toggles `active` flag in `staff_users` |
| **Staff Password Reset & Session Revocation** | **YES** | **NO** | `manage_staff` (Teacher Only) | YES | N/A | YES | N/A | N/A | Exclusive to Teacher; changes password and wipes all sessions from `staff_sessions` |
| **Staff Account Deletion** | **YES** | **NO** | `manage_staff` (Teacher Only) | YES | N/A | N/A | YES | N/A | Exclusive to Teacher; prevents self-deletion via server-side email equality check |
| **Payment Gateway Administration & In-App Refunds** | NO | NO | N/A | N/A | N/A | N/A | N/A | N/A | **GATEWAY ONLY**: Fawaterak handles checkout/webhooks; no in-dashboard refund trigger |
| **UI Theme Toggle** | YES | YES | None | YES | N/A | YES | N/A | N/A | Client-side dark/light mode toggle with `localStorage` persistence |

---

## 2. Granular Assistant Preset Breakdown

| Preset Identifier | Display Label in Arabic | Exact Permissions Included | Key Capabilities Granted | Explicit Capabilities Forbidden |
|---|---|---|---|---|
| `course_manager` | مساعد كورسات وامتحانات وواجبات | `manage_courses`<br>`manage_exams`<br>`manage_assignments`<br>`manage_videos` | • Course CRUD & pricing<br>• Video CRUD & YouTube links<br>• Lecture access code generation & history<br>• MCQ exam creation & editing<br>• Assignment CRUD & scheduling<br>• Course workspace & counters | • Exam attempt grading & review<br>• Student directory & birth certificates<br>• Enrollment approval/rejection<br>• Contact messages<br>• Announcements<br>• Staff administration |
| `grader` | مساعد تصحيح ودرجات | `grade_exams`<br>`view_students` | • View student exam submissions<br>• Override attempt scores & write feedback<br>• Browse & search student directory<br>• Inspect full student profiles<br>• Stream private birth certificate files<br>• View attempt counts & average score | • Course CRUD & pricing<br>• Video lecture management<br>• Lecture access code generation<br>• Exam creation & editing<br>• Assignment management<br>• Enrollment approval/rejection<br>• Announcements<br>• Staff administration |
| `enrollment_manager` | مساعد طلاب واشتراكات | `manage_enrollments`<br>`view_students` | • View enrollment requests with payment info<br>• Approve or reject student enrollments<br>• Browse & search student directory<br>• Inspect full student profiles<br>• Stream private birth certificate files<br>• View active/pending enrollment stats | • Course CRUD & pricing<br>• Video lecture management<br>• Lecture access code generation<br>• Exam creation & editing<br>• Exam grading & review<br>• Assignment management<br>• Announcements<br>• Staff administration |
| `full_access` | مدرس — صلاحية كاملة | All 10 permissions (`STAFF_PERMISSIONS`) | • Unrestricted access to all features<br>• Teacher-only staff account management | **RESERVED FOR TEACHER ONLY** (API rejects assignment to Assistant role) |

---

## 3. UI Section & Component Visibility Matrix

| Dashboard Tab / Component | Corresponding UI Element | Teacher Visibility | Course Manager Assistant | Grader Assistant | Enrollment Manager Assistant | Permission Gate in Code |
|---|---|---|---|---|---|---|
| **نظرة عامة (Overview)** | Main Welcome Hero & Quick Actions | YES | YES | YES | YES | Always visible |
| **Quick Action: إضافة كورس** | Hero Button | YES | YES | Hidden | Hidden | `can('manage_courses')` |
| **Quick Action: رفع محاضرة** | Hero Button | YES | YES | Hidden | Hidden | `can('manage_videos')` |
| **Quick Action: إنشاء امتحان** | Hero Button | YES | YES | Hidden | Hidden | `can('manage_exams')` |
| **Stats: إجمالي الطلاب** | KPI Card | YES | Hidden | Hidden | YES | `can('view_students') \|\| can('manage_enrollments')` |
| **Stats: اشتراكات مفعّلة / معلّقة** | KPI Cards | YES | Hidden | Hidden | YES | `can('manage_enrollments')` |
| **Stats: امتحانات منشورة** | KPI Card | YES | YES | YES | Hidden | `can('manage_exams') \|\| can('grade_exams')` |
| **Stats: متوسط النتائج & المحاولات** | KPI Card | YES | Hidden | YES | Hidden | `can('grade_exams')` |
| **Stats: نشر إعلان** | Announcement Post Card | YES | Hidden | Hidden | Hidden | `can('manage_announcements')` |
| **Stats: بحاجة لمراجعتك (طلبات)** | Attention Card Link | YES | Hidden | Hidden | YES | `can('manage_enrollments')` |
| **Stats: بحاجة لمراجعتك (رسائل)** | Attention Card Link | YES | Hidden | Hidden | Hidden | `can('manage_messages')` |
| **Teacher Course Workspace** | Course Cards Grid & Action Shortcuts | YES | YES | Hidden | Hidden | `can('manage_courses')` |
| **قائمة الإعلانات المنشورة** | Announcements Edit/Delete List | YES | Hidden | Hidden | Hidden | `can('manage_announcements')` |
| **الكورسات (Courses Tab)** | Add Course Form & Courses List | YES | YES | Hidden | Hidden | `can('manage_courses')` |
| **الامتحانات (Exams Tab)** | ExamBuilder & Saved Exams List | YES | YES | Hidden | Hidden | `can('manage_exams')` |
| **الواجبات (Assignments Tab)** | AdminAssignmentList & Form | YES | YES | Hidden | Hidden | `can('manage_assignments')` |
| **المحاضرات (Videos Tab)** | VideoUploader & Library List | YES | YES | Hidden | Hidden | `can('manage_videos')` |
| **كود المحاضرة (Lecture Code)** | Code Generator Trigger & History | YES | YES | Hidden | Hidden | `can('manage_videos')` |
| **الطلاب (Students Tab)** | StudentsPanel with Search & Accordion | YES | Hidden | YES | YES | `can('view_students')` |
| **عرض شهادة الميلاد** | Private File Stream Link | YES | Hidden | YES | YES | `can('view_students')` |
| **الاشتراكات (Enrollments Tab)** | Enrollment Table with Approve/Reject | YES | Hidden | Hidden | YES | `can('manage_enrollments')` |
| **النتائج والتصحيح (Results Tab)** | Attempts Table with Score Edit Modal | YES | Hidden | YES | Hidden | `can('grade_exams')` |
| **الرسائل (Messages Tab)** | Contact Messages with Review Toggle | YES | Hidden | Hidden | Hidden | `can('manage_messages')` |
| **حسابات الفريق (Staff Tab)** | StaffManager Form, Preset Picker, Delete | **YES** | **Hidden** | **Hidden** | **Hidden** | `can('manage_staff')` (Teacher Only) |
