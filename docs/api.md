# API Documentation — Englizeka Platform

> **Base URL:** `https://englizeka.com` (production) · `http://localhost:3000` (local dev)
> **Auth:** Cookie-based sessions (`englizeka_student` for students, `englizeka_staff` for staff).
> All mutation endpoints require `Origin` to match the host (CSRF protection).

---

## Error Codes

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| `400`  | Bad request — missing or invalid fields                     |
| `401`  | Not authenticated — session cookie missing or expired       |
| `403`  | Forbidden — insufficient permissions or self-action blocked |
| `404`  | Resource not found                                          |
| `409`  | Conflict — duplicate email / resource already exists        |
| `204`  | Success — no content returned                               |

---

## Authentication Endpoints

### POST `/api/auth/register`

Create a new student account.

**Auth required:** No

**Request body:**

```json
{
  "email": "student@example.com",
  "password": "SecurePass1",
  "password_confirm": "SecurePass1",
  "first_name": "محمد",
  "second_name": "أحمد",
  "third_name": "",
  "last_name": "علي",
  "phone": "01012345678",
  "father_phone": "01098765432",
  "mother_phone": "01123456789",
  "school_name": "مدرسة النيل",
  "parent_job": "مهندس",
  "governorate": "القاهرة",
  "gender": "ذكر",
  "grade": "تالتة ثانوي",
  "section": "علمي علوم"
}
```

**Response `200`:**

```json
{ "ok": true }
```

---

### POST `/api/auth/login`

Log in with email + password.

**Auth required:** No

**Request body:**

```json
{ "email": "student@example.com", "password": "SecurePass1" }
```

**Response `200`:** Sets `englizeka_student` cookie. Returns `{ "ok": true }`.

---

### POST `/api/auth/logout` (student logout)

Clears the student session cookie.

**Response `200`:** `{ "ok": true }`

---

### POST `/api/auth/forgot-password`

Send a 6-digit reset code to the user's email.

**Request body:** `{ "email": "student@example.com" }`

**Response `200`:** `{ "ok": true }` (test mode also returns `testCode`)

---

### POST `/api/auth/reset-password`

Reset password using the 6-digit code.

**Request body:**

```json
{ "email": "student@example.com", "code": "123456", "new_password": "NewPass1!" }
```

**Response `200`:** `{ "ok": true }`

---

### POST `/api/auth/change-password`

Change password while logged in.

**Auth required:** Student session

**Request body:**

```json
{ "currentPassword": "OldPass1", "newPassword": "NewPass2!", "newPasswordConfirm": "NewPass2!" }
```

**Response `200`:** `{ "ok": true }`

---

## Student Dashboard

### GET `/api/dashboard`

Get the logged-in student's dashboard data.

**Auth required:** Student session

**Response `200`:**

```json
{
  "user": {
    "email": "...",
    "displayName": "...",
    "profile": { "name": "...", "phone": "...", "grade": "..." }
  },
  "verificationRequired": false,
  "enrollments": [
    { "id": "...", "courseId": "...", "title": "...", "grade": "...", "status": "approved" }
  ],
  "exams": [
    { "id": "...", "title": "...", "durationMinutes": 30, "attemptCount": 1, "bestPercentage": 75 }
  ],
  "attempts": [
    {
      "id": "...",
      "examId": "...",
      "title": "...",
      "score": 18,
      "maxScore": 20,
      "submittedAt": 1700000000000
    }
  ],
  "announcements": [{ "id": "...", "title": "...", "body": "...", "createdAt": 1700000000000 }]
}
```

---

### PUT `/api/profile`

Update student profile.

**Auth required:** Student session

**Request body:** `{ "name": "...", "phone": "...", "grade": "..." }`

**Response `200`:** `{ "ok": true }`

---

## Account Deletion

### DELETE `/api/users/me`

Permanently delete the logged-in student's account.

**Auth required:** Student session

**Request body:** `{ "password": "CurrentPassword1" }`

**Response `200`:** `{ "message": "Account deleted" }` + clears session cookie.

---

## Courses

### GET `/api/courses`

List published courses.

**Auth required:** No

**Response `200`:** `{ "courses": [{ "id": "...", "title": "...", "grade": "...", "price": 150, "status": "published" }] }`

---

## Exams & Attempts

### GET `/api/exams`

List available (published) exams for the current student.

**Auth required:** Student session (verified)

---

### POST `/api/exams/:id/start`

Start an exam session.

**Auth required:** Student session (verified)

**Response `200`:** `{ "sessionId": "...", "questions": [...], "expiresAt": 1700000000000 }`

---

### POST `/api/exams/:id/submit`

Submit exam answers.

**Auth required:** Student session (verified)

**Request body:** `{ "sessionId": "...", "answers": { "<questionId>": "answer text" } }`

**Response `200`:** `{ "attemptId": "...", "score": 18, "maxScore": 20, "passed": true }`

---

### GET `/api/attempts/:id`

Get attempt result detail.

**Auth required:** Student session

---

## Contact

### POST `/api/contact`

Submit a contact message.

**Request body:** `{ "name": "...", "phone": "...", "message": "..." }`

**Response `200`:** `{ "ok": true }`

---

## Admin — Bootstrap

### GET `/api/admin/bootstrap`

Load all admin dashboard data in one request.

**Auth required:** Staff session (any valid permission)

**Response `200`:** Full `AdminData` object including counts, courses, exams, videos, enrollments, attempts, contacts, announcements.

---

## Admin — Courses

### POST `/api/admin/courses`

Create a new course.

**Auth required:** Staff — `manage_courses`

**Request body:** `{ "title": "...", "grade": "...", "description": "...", "price": 150, "status": "draft" }`

### DELETE `/api/admin/courses/:id`

Delete a course.

**Auth required:** Staff — `manage_courses`

**Response:** `204`

---

## Admin — Exams

### POST `/api/admin/exams`

Create an exam with questions.

**Auth required:** Staff — `manage_exams`

### PATCH `/api/admin/exams/:id`

Update exam (publish/unpublish, edit fields).

### DELETE `/api/admin/exams/:id`

Delete exam.

**Response:** `204`

---

## Admin — Announcements

### POST `/api/admin/announcements`

Create a new announcement.

**Auth required:** Staff — `manage_announcements`

**Request body:** `{ "title": "...", "body": "..." }`

### DELETE `/api/admin/announcements/:id`

Delete an announcement by UUID.

**Auth required:** Staff — `manage_announcements`

**Response:** `204` / `404` if not found

---

## Admin — Videos

### POST `/api/admin/videos`

Add an unlisted YouTube lesson.

**Auth required:** Staff — `manage_videos`

**JSON body:** `courseId`, `title`, `youtubeUrl`, `durationSeconds`,
`prerequisiteExamId`, and `minimumScore`.

Raw video file uploads are intentionally rejected.

### PATCH `/api/admin/videos/:id`

Edit video metadata.

### DELETE `/api/admin/videos/:id`

Delete the lesson record. The original video remains managed by YouTube.

---

## Admin — Enrollments

### PATCH `/api/admin/enrollments/:id`

Approve or reject an enrollment.

**Auth required:** Staff — `manage_enrollments`

**Request body:** `{ "status": "approved" | "rejected" }`

---

## Admin — Attempts (Grading)

### PATCH `/api/admin/attempts/:id`

Override a student's score and add teacher feedback.

**Auth required:** Staff — `grade_exams`

**Request body:** `{ "score": 18, "feedback": "أجاد الطالب" }`

---

## Admin — Staff

### GET `/api/admin/staff`

List all staff accounts.

**Auth required:** Staff — `manage_staff`

### POST `/api/admin/staff`

Create a staff account.

**Auth required:** Staff — `manage_staff`

**Request body:** `{ "name": "...", "email": "...", "password": "...", "role": "assistant", "preset": "grader" }`

### PATCH `/api/admin/staff/:email`

Update a staff account (role, permissions, active status, password).

**Auth required:** Staff — `manage_staff`

### DELETE `/api/admin/staff/:email`

Delete a staff account. Self-deletion returns `403`.

**Auth required:** Staff — `manage_staff`

**Response:** `204`

---

## Admin — Contacts

### PATCH `/api/admin/contacts/:id`

Mark a contact message as reviewed.

**Auth required:** Staff — `manage_messages`

---

## Admin — Students

### GET `/api/admin/students`

List students with pagination and search.

**Auth required:** Staff — `view_students`

**Query params:** `page`, `limit`, `q` (search), `grade`

**Response `200`:** `{ "students": [...], "total": 150, "pages": 3 }`
