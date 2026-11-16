import assert from 'node:assert/strict';
import test from 'node:test';

class MockStorage {
  files = new Map();
  async delete(key) {
    this.files.delete(key);
  }
}

class MockFullLmsDatabase {
  courses = new Map();
  enrollments = new Map();
  payment_intents = new Map();
  course_items = new Map();
  videos = new Map();
  video_progress = new Map();
  video_view_sessions = new Map();
  student_video_access_grants = new Map();
  lecture_access_codes = new Map();
  access_code_batches = new Map();
  lecture_materials = new Map();
  exams = new Map();
  questions = new Map();
  attempts = new Map();
  answers = new Map();
  exam_sessions = new Map();
  assignments = new Map();
  assignment_questions = new Map();
  assignment_submissions = new Map();
  notification_reads = new Map();
  audit_logs = [];
  shouldFailBatch = false;

  snapshot() {
    return {
      courses: new Map(this.courses),
      enrollments: new Map(this.enrollments),
      payment_intents: new Map(this.payment_intents),
      course_items: new Map(this.course_items),
      videos: new Map(this.videos),
      video_progress: new Map(this.video_progress),
      video_view_sessions: new Map(this.video_view_sessions),
      student_video_access_grants: new Map(this.student_video_access_grants),
      lecture_access_codes: new Map(this.lecture_access_codes),
      access_code_batches: new Map(this.access_code_batches),
      lecture_materials: new Map(this.lecture_materials),
      exams: new Map(this.exams),
      questions: new Map(this.questions),
      attempts: new Map(this.attempts),
      answers: new Map(this.answers),
      exam_sessions: new Map(this.exam_sessions),
      assignments: new Map(this.assignments),
      assignment_questions: new Map(this.assignment_questions),
      assignment_submissions: new Map(this.assignment_submissions),
      notification_reads: new Map(this.notification_reads),
    };
  }

  restore(snap) {
    this.courses = snap.courses;
    this.enrollments = snap.enrollments;
    this.payment_intents = snap.payment_intents;
    this.course_items = snap.course_items;
    this.videos = snap.videos;
    this.video_progress = snap.video_progress;
    this.video_view_sessions = snap.video_view_sessions;
    this.student_video_access_grants = snap.student_video_access_grants;
    this.lecture_access_codes = snap.lecture_access_codes;
    this.access_code_batches = snap.access_code_batches;
    this.lecture_materials = snap.lecture_materials;
    this.exams = snap.exams;
    this.questions = snap.questions;
    this.attempts = snap.attempts;
    this.answers = snap.answers;
    this.exam_sessions = snap.exam_sessions;
    this.assignments = snap.assignments;
    this.assignment_questions = snap.assignment_questions;
    this.assignment_submissions = snap.assignment_submissions;
    this.notification_reads = snap.notification_reads;
  }

  prepare(sql) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    return new (class {
      bindings = [];
      bind(...bindings) {
        this.bindings = bindings;
        return this;
      }
      async first() {
        const id = this.bindings[0];
        if (sql.includes('FROM staff_sessions')) {
          return {
            expiresAt: Date.now() + 60000,
            email: 'admin@example.test',
            name: 'Admin',
            role: 'owner',
            permissions: '["manage_courses","manage_videos","manage_exams","manage_assignments"]',
          };
        }
        if (sql.includes('FROM courses WHERE id = ?')) {
          const c = db.courses.get(id);
          return c ? { id: c.id, title: c.title } : null;
        }
        if (sql.includes('FROM videos WHERE id = ?')) {
          const v = db.videos.get(id);
          return v ? { id: v.id, courseId: v.course_id, title: v.title } : null;
        }
        if (sql.includes('FROM exams WHERE id = ?')) {
          const e = db.exams.get(id);
          return e ? { id: e.id, title: e.title, teacherFileKey: e.teacher_file_key } : null;
        }
        return null;
      }
      async all() {
        const id = this.bindings[0];
        const s = sql.toLowerCase();
        if (s.includes('from questions where exam_id in')) {
          const examIds = new Set(Array.from(db.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
          const results = Array.from(db.questions.values())
            .filter((q) => examIds.has(q.exam_id) && q.image_file_key)
            .map((q) => ({ id: q.id, key: q.image_file_key, imageFileKey: q.image_file_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from attempts where exam_id in')) {
          const examIds = new Set(Array.from(db.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
          const results = Array.from(db.attempts.values())
            .filter((a) => examIds.has(a.exam_id) && a.pdf_storage_key)
            .map((a) => ({ id: a.id, key: a.pdf_storage_key, pdfStorageKey: a.pdf_storage_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from lecture_materials where video_id in')) {
          const videoIds = new Set(Array.from(db.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
          const results = Array.from(db.lecture_materials.values())
            .filter((m) => videoIds.has(m.video_id) && m.file_key)
            .map((m) => ({ id: m.id, key: m.file_key, fileKey: m.file_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from assignment_submissions where assignment_id in')) {
          const assignIds = new Set(Array.from(db.assignments.values()).filter((a) => a.course_id === id).map((a) => a.id));
          const results = Array.from(db.assignment_submissions.values())
            .filter((s) => assignIds.has(s.assignment_id) && s.pdf_storage_key)
            .map((s) => ({ id: s.id, key: s.pdf_storage_key, pdfStorageKey: s.pdf_storage_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from assignment_questions where assignment_id in')) {
          const assignIds = new Set(Array.from(db.assignments.values()).filter((a) => a.course_id === id).map((a) => a.id));
          const results = Array.from(db.assignment_questions.values())
            .filter((q) => assignIds.has(q.assignment_id) && q.image_file_key)
            .map((q) => ({ id: q.id, key: q.image_file_key, imageFileKey: q.image_file_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from questions where exam_id = ?')) {
          const results = Array.from(db.questions.values())
            .filter((q) => q.exam_id === id)
            .map((q) => ({ id: q.id, imageFileKey: q.image_file_key, image_file_key: q.image_file_key, key: q.image_file_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from attempts where exam_id = ?')) {
          const results = Array.from(db.attempts.values())
            .filter((a) => a.exam_id === id)
            .map((a) => ({ id: a.id, pdfStorageKey: a.pdf_storage_key, pdf_storage_key: a.pdf_storage_key, key: a.pdf_storage_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from lecture_materials where video_id = ?')) {
          const results = Array.from(db.lecture_materials.values())
            .filter((m) => m.video_id === id)
            .map((m) => ({ id: m.id, fileKey: m.file_key, file_key: m.file_key, key: m.file_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from exams where course_id = ?')) {
          const results = Array.from(db.exams.values())
            .filter((e) => e.course_id === id && e.teacher_file_key)
            .map((e) => ({ id: e.id, key: e.teacher_file_key, teacherFileKey: e.teacher_file_key, teacher_file_key: e.teacher_file_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        if (s.includes('from assignments where course_id = ?')) {
          const results = Array.from(db.assignments.values())
            .filter((a) => a.course_id === id && a.teacher_file_key)
            .map((a) => ({ id: a.id, key: a.teacher_file_key, teacherFileKey: a.teacher_file_key }));
          return { results, success: true, meta: { changes: results.length } };
        }
        return { results: [], success: true, meta: { changes: 0 } };
      }
      async run() {
        return db.executeStatement(sql, this.bindings);
      }
    })();
  }

  executeStatement(sql, bindings) {
    const id = bindings[0];
    const s = sql.toLowerCase();

    // 1. Audit logs
    if (s.includes('insert into audit_logs')) {
      this.audit_logs.push({ sql, bindings });
      return { success: true, meta: { changes: 1 } };
    }

    // 2. Unlink prerequisite exam
    if (s.includes('update videos set prerequisite_exam_id = null')) {
      for (const v of this.videos.values()) {
        if (s.includes('where prerequisite_exam_id in (select id from exams where course_id = ?')) {
          const examIds = new Set(Array.from(this.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
          if (examIds.has(v.prerequisite_exam_id)) {
            v.prerequisite_exam_id = null;
            v.minimum_score = 0;
          }
        } else if (v.prerequisite_exam_id === id) {
          v.prerequisite_exam_id = null;
          v.minimum_score = 0;
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 3. Course items
    if (s.includes('delete from course_items where course_id = ?')) {
      for (const [key, item] of this.course_items.entries()) {
        if (item.course_id === id) this.course_items.delete(key);
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (s.includes('delete from course_items where video_id = ?')) {
      for (const [key, item] of this.course_items.entries()) {
        if (item.video_id === id) this.course_items.delete(key);
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (s.includes('delete from course_items where exam_id = ?')) {
      for (const [key, item] of this.course_items.entries()) {
        if (item.exam_id === id) this.course_items.delete(key);
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 4. Notification reads
    if (s.includes('delete from notification_reads')) {
      for (const [key, item] of this.notification_reads.entries()) {
        if (s.includes("notification_type = 'exam'")) {
          if (s.includes('in (select id from exams where course_id = ?')) {
            const examIds = new Set(Array.from(this.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
            if (examIds.has(item.notification_id)) this.notification_reads.delete(key);
          } else if (item.notification_id === id) {
            this.notification_reads.delete(key);
          }
        } else if (s.includes("notification_type = 'video'")) {
          if (s.includes('in (select id from videos where course_id = ?')) {
            const videoIds = new Set(Array.from(this.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
            if (videoIds.has(item.notification_id)) this.notification_reads.delete(key);
          } else if (item.notification_id === id) {
            this.notification_reads.delete(key);
          }
        } else if (s.includes("notification_type = 'assignment'")) {
          if (s.includes('in (select id from assignments where course_id = ?')) {
            const assignIds = new Set(Array.from(this.assignments.values()).filter((a) => a.course_id === id).map((a) => a.id));
            if (assignIds.has(item.notification_id)) this.notification_reads.delete(key);
          } else if (item.notification_id === id) {
            this.notification_reads.delete(key);
          }
        } else if (s.includes("notification_type = 'course'")) {
          if (item.notification_id === id) this.notification_reads.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 5. Exam sessions
    if (s.includes('delete from exam_sessions')) {
      for (const [key, session] of this.exam_sessions.entries()) {
        if (s.includes('in (select id from exams where course_id = ?')) {
          const examIds = new Set(Array.from(this.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
          if (examIds.has(session.exam_id)) this.exam_sessions.delete(key);
        } else if (session.exam_id === id) {
          this.exam_sessions.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 6. Answers
    if (s.includes('delete from answers')) {
      if (s.includes('where course_id = ?')) {
        const examIds = new Set(Array.from(this.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
        const attemptIds = new Set(Array.from(this.attempts.values()).filter((a) => examIds.has(a.exam_id)).map((a) => a.id));
        const questionIds = new Set(Array.from(this.questions.values()).filter((q) => examIds.has(q.exam_id)).map((q) => q.id));
        for (const [key, ans] of this.answers.entries()) {
          if (attemptIds.has(ans.attempt_id) || questionIds.has(ans.question_id)) {
            this.answers.delete(key);
          }
        }
      } else {
        const attemptIds = new Set(Array.from(this.attempts.values()).filter((a) => a.exam_id === id).map((a) => a.id));
        const questionIds = new Set(Array.from(this.questions.values()).filter((q) => q.exam_id === id).map((q) => q.id));
        for (const [key, ans] of this.answers.entries()) {
          if (attemptIds.has(ans.attempt_id) || questionIds.has(ans.question_id)) {
            this.answers.delete(key);
          }
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 7. Attempts
    if (s.includes('delete from attempts')) {
      for (const [key, att] of this.attempts.entries()) {
        if (s.includes('in (select id from exams where course_id = ?')) {
          const examIds = new Set(Array.from(this.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
          if (examIds.has(att.exam_id)) this.attempts.delete(key);
        } else if (att.exam_id === id) {
          this.attempts.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 8. Questions
    if (s.includes('delete from questions')) {
      for (const [key, q] of this.questions.entries()) {
        if (s.includes('in (select id from exams where course_id = ?')) {
          const examIds = new Set(Array.from(this.exams.values()).filter((e) => e.course_id === id).map((e) => e.id));
          if (examIds.has(q.exam_id)) this.questions.delete(key);
        } else if (q.exam_id === id) {
          this.questions.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 9. Exams
    if (s.includes('delete from exams')) {
      for (const [key, exam] of this.exams.entries()) {
        if (s.includes('where course_id = ?')) {
          if (exam.course_id === id) this.exams.delete(key);
        } else if (exam.id === id) {
          this.exams.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 10. Video progress
    if (s.includes('delete from video_progress')) {
      for (const [key, prog] of this.video_progress.entries()) {
        if (s.includes('in (select id from videos where course_id = ?')) {
          const videoIds = new Set(Array.from(this.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
          if (videoIds.has(prog.video_id)) this.video_progress.delete(key);
        } else if (prog.video_id === id) {
          this.video_progress.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 11. Video view sessions
    if (s.includes('delete from video_view_sessions')) {
      for (const [key, sess] of this.video_view_sessions.entries()) {
        if (s.includes('in (select id from videos where course_id = ?')) {
          const videoIds = new Set(Array.from(this.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
          if (videoIds.has(sess.video_id)) this.video_view_sessions.delete(key);
        } else if (sess.video_id === id) {
          this.video_view_sessions.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 12. Student video access grants
    if (s.includes('delete from student_video_access_grants')) {
      for (const [key, grant] of this.student_video_access_grants.entries()) {
        if (s.includes('in (select id from videos where course_id = ?')) {
          const videoIds = new Set(Array.from(this.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
          if (videoIds.has(grant.video_id)) this.student_video_access_grants.delete(key);
        } else if (grant.video_id === id) {
          this.student_video_access_grants.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 13. Lecture access codes
    if (s.includes('delete from lecture_access_codes')) {
      for (const [key, code] of this.lecture_access_codes.entries()) {
        if (s.includes('course_id = ? or video_id in')) {
          const videoIds = new Set(Array.from(this.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
          if (code.course_id === id || videoIds.has(code.video_id)) {
            this.lecture_access_codes.delete(key);
          }
        } else if (code.video_id === id) {
          this.lecture_access_codes.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 14. Access code batches
    if (s.includes('delete from access_code_batches')) {
      for (const [key, batch] of this.access_code_batches.entries()) {
        if (s.includes('course_id = ? or video_id in')) {
          const videoIds = new Set(Array.from(this.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
          if (batch.course_id === id || videoIds.has(batch.video_id)) {
            this.access_code_batches.delete(key);
          }
        } else if (batch.video_id === id) {
          this.access_code_batches.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 15. Lecture materials
    if (s.includes('delete from lecture_materials')) {
      for (const [key, mat] of this.lecture_materials.entries()) {
        if (s.includes('in (select id from videos where course_id = ?')) {
          const videoIds = new Set(Array.from(this.videos.values()).filter((v) => v.course_id === id).map((v) => v.id));
          if (videoIds.has(mat.video_id)) this.lecture_materials.delete(key);
        } else if (mat.video_id === id) {
          this.lecture_materials.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 16. Videos
    if (s.includes('delete from videos')) {
      for (const [key, vid] of this.videos.entries()) {
        if (s.includes('where course_id = ?')) {
          if (vid.course_id === id) this.videos.delete(key);
        } else if (vid.id === id) {
          this.videos.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 17. Assignment submissions
    if (s.includes('delete from assignment_submissions')) {
      for (const [key, sub] of this.assignment_submissions.entries()) {
        if (s.includes('in (select id from assignments where course_id = ?')) {
          const assignIds = new Set(Array.from(this.assignments.values()).filter((a) => a.course_id === id).map((a) => a.id));
          if (assignIds.has(sub.assignment_id)) this.assignment_submissions.delete(key);
        } else if (sub.assignment_id === id) {
          this.assignment_submissions.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 18. Assignment questions
    if (s.includes('delete from assignment_questions')) {
      for (const [key, q] of this.assignment_questions.entries()) {
        if (s.includes('in (select id from assignments where course_id = ?')) {
          const assignIds = new Set(Array.from(this.assignments.values()).filter((a) => a.course_id === id).map((a) => a.id));
          if (assignIds.has(q.assignment_id)) this.assignment_questions.delete(key);
        } else if (q.assignment_id === id) {
          this.assignment_questions.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 19. Assignments
    if (s.includes('delete from assignments')) {
      for (const [key, a] of this.assignments.entries()) {
        if (s.includes('where course_id = ?')) {
          if (a.course_id === id) this.assignments.delete(key);
        } else if (a.id === id) {
          this.assignments.delete(key);
        }
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 20. Enrollments
    if (s.includes('delete from enrollments where course_id = ?')) {
      for (const [key, enr] of this.enrollments.entries()) {
        if (enr.course_id === id) this.enrollments.delete(key);
      }
      return { success: true, meta: { changes: 1 } };
    }

    // 21. Courses
    if (s.includes('delete from courses where id = ?')) {
      this.courses.delete(id);
      return { success: true, meta: { changes: 1 } };
    }

    return { success: true, meta: { changes: 0 } };
  }

  async batch(statements) {
    const snap = this.snapshot();
    try {
      if (this.shouldFailBatch) {
        throw new Error('Simulated database transaction failure');
      }
      const results = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    } catch (err) {
      this.restore(snap);
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests Suite
// ─────────────────────────────────────────────────────────────────────────────

test('COURSE FORCE DELETE: removes course and all child LMS records, preserves payments and unrelated courses', async () => {
  const db = new MockFullLmsDatabase();
  const storage = new MockStorage();

  const targetCourseId = 'course-target';
  const otherCourseId = 'course-other';

  // Seed Target Course and Hierarchy
  db.courses.set(targetCourseId, { id: targetCourseId, title: 'Target Course' });
  db.enrollments.set('enr-target-1', { id: 'enr-target-1', course_id: targetCourseId, user_email: 'student1@test.com' });
  // Payment intent for target course (MUST BE PRESERVED)
  db.payment_intents.set('pi-target-1', { id: 'pi-target-1', course_id: targetCourseId, amount_minor: 50000, status: 'paid' });

  // Video in target course
  const targetVideoId = 'vid-target-1';
  db.videos.set(targetVideoId, { id: targetVideoId, course_id: targetCourseId, title: 'Target Video' });
  db.video_progress.set('vp-1', { video_id: targetVideoId, user_email: 'student1@test.com' });
  db.video_view_sessions.set('vvs-1', { video_id: targetVideoId, session_token: 'tok-1' });
  db.student_video_access_grants.set('grant-1', { video_id: targetVideoId, student_email: 'student1@test.com' });
  db.lecture_access_codes.set('lac-1', { id: 'lac-1', course_id: targetCourseId, video_id: targetVideoId });
  db.access_code_batches.set('acb-1', { id: 'acb-1', course_id: targetCourseId, video_id: targetVideoId });
  db.lecture_materials.set('mat-1', { id: 'mat-1', video_id: targetVideoId, file_key: 'materials/mat-1.pdf' });
  storage.files.set('materials/mat-1.pdf', 'material-pdf-data');

  // Exam in target course
  const targetExamId = 'exam-target-1';
  db.exams.set(targetExamId, { id: targetExamId, course_id: targetCourseId, title: 'Target Exam', teacher_file_key: 'exams/teacher-1.pdf' });
  storage.files.set('exams/teacher-1.pdf', 'teacher-exam-pdf');
  db.questions.set('q-1', { id: 'q-1', exam_id: targetExamId, image_file_key: 'questions/q1.png' });
  storage.files.set('questions/q1.png', 'question-image');
  db.attempts.set('att-1', { id: 'att-1', exam_id: targetExamId, pdf_storage_key: 'attempts/att1.pdf' });
  storage.files.set('attempts/att1.pdf', 'attempt-pdf');
  db.answers.set('ans-1', { id: 'ans-1', attempt_id: 'att-1', question_id: 'q-1' });
  db.exam_sessions.set('sess-1', { id: 'sess-1', exam_id: targetExamId, user_email: 'student1@test.com' });

  // Assignment in target course
  const targetAssignId = 'assign-target-1';
  db.assignments.set(targetAssignId, { id: targetAssignId, course_id: targetCourseId, teacher_file_key: 'assignments/teacher-1.pdf' });
  storage.files.set('assignments/teacher-1.pdf', 'assign-teacher-pdf');
  db.assignment_questions.set('aq-1', { id: 'aq-1', assignment_id: targetAssignId, image_file_key: 'assign/q1.png' });
  storage.files.set('assign/q1.png', 'assign-q-image');
  db.assignment_submissions.set('as-1', { id: 'as-1', assignment_id: targetAssignId, pdf_storage_key: 'assign/sub1.pdf' });
  storage.files.set('assign/sub1.pdf', 'assign-sub-pdf');

  // Course sequence items
  db.course_items.set('ci-1', { id: 'ci-1', course_id: targetCourseId, video_id: targetVideoId });
  db.course_items.set('ci-2', { id: 'ci-2', course_id: targetCourseId, exam_id: targetExamId });
  db.course_items.set('ci-3', { id: 'ci-3', course_id: targetCourseId, assignment_id: targetAssignId });

  // Notifications
  db.notification_reads.set('notif-1', { id: 'notif-1', notification_type: 'course', notification_id: targetCourseId });
  db.notification_reads.set('notif-2', { id: 'notif-2', notification_type: 'video', notification_id: targetVideoId });
  db.notification_reads.set('notif-3', { id: 'notif-3', notification_type: 'exam', notification_id: targetExamId });
  db.notification_reads.set('notif-4', { id: 'notif-4', notification_type: 'assignment', notification_id: targetAssignId });

  // Seed Unrelated Course
  db.courses.set(otherCourseId, { id: otherCourseId, title: 'Other Course' });
  db.enrollments.set('enr-other-1', { id: 'enr-other-1', course_id: otherCourseId, user_email: 'other@test.com' });
  db.payment_intents.set('pi-other-1', { id: 'pi-other-1', course_id: otherCourseId, amount_minor: 75000, status: 'paid' });
  db.videos.set('vid-other-1', { id: 'vid-other-1', course_id: otherCourseId, title: 'Other Video' });
  db.exams.set('exam-other-1', { id: 'exam-other-1', course_id: otherCourseId, title: 'Other Exam' });

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    STORAGE: storage,
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
  };

  try {
    const { DELETE } = await import('../app/api/admin/courses/[id]/route.ts');
    const req = new Request(`https://example.test/api/admin/courses/${targetCourseId}`, {
      method: 'DELETE',
      headers: {
        origin: 'https://example.test',
        cookie: 'englizeka_staff=valid-token',
      },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: targetCourseId }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // 1. Target Course is gone
    assert.equal(db.courses.has(targetCourseId), false, 'Target course should be deleted');
    assert.equal(db.enrollments.has('enr-target-1'), false, 'Target course enrollment deleted');
    assert.equal(db.videos.has(targetVideoId), false, 'Target course video deleted');
    assert.equal(db.video_progress.size, 0, 'Target course video progress deleted');
    assert.equal(db.video_view_sessions.size, 0, 'Target course view sessions deleted');
    assert.equal(db.student_video_access_grants.size, 0, 'Target course video grants deleted');
    assert.equal(db.lecture_access_codes.size, 0, 'Target course access codes deleted');
    assert.equal(db.access_code_batches.size, 0, 'Target course code batches deleted');
    assert.equal(db.lecture_materials.size, 0, 'Target course materials deleted');
    assert.equal(db.exams.has(targetExamId), false, 'Target course exam deleted');
    assert.equal(db.questions.has('q-1'), false, 'Target course questions deleted');
    assert.equal(db.attempts.has('att-1'), false, 'Target course attempts deleted');
    assert.equal(db.answers.has('ans-1'), false, 'Target course answers deleted');
    assert.equal(db.exam_sessions.has('sess-1'), false, 'Target course exam sessions deleted');
    assert.equal(db.assignments.has(targetAssignId), false, 'Target course assignments deleted');
    assert.equal(db.assignment_questions.size, 0, 'Target course assign questions deleted');
    assert.equal(db.assignment_submissions.size, 0, 'Target course submissions deleted');
    assert.equal(db.course_items.size, 0, 'Target course items deleted');
    assert.equal(db.notification_reads.size, 0, 'Target course notifications deleted');

    // 2. Storage files deleted
    assert.equal(storage.files.has('materials/mat-1.pdf'), false);
    assert.equal(storage.files.has('exams/teacher-1.pdf'), false);
    assert.equal(storage.files.has('questions/q1.png'), false);
    assert.equal(storage.files.has('attempts/att1.pdf'), false);
    assert.equal(storage.files.has('assignments/teacher-1.pdf'), false);
    assert.equal(storage.files.has('assign/q1.png'), false);
    assert.equal(storage.files.has('assign/sub1.pdf'), false);

    // 3. CRITICAL: Payment history MUST BE PRESERVED
    assert.equal(db.payment_intents.has('pi-target-1'), true, 'Payment intent for deleted course must be preserved for audit');
    assert.equal(db.payment_intents.has('pi-other-1'), true, 'Payment intent for other course must be preserved');

    // 4. Other course completely untouched
    assert.equal(db.courses.has(otherCourseId), true, 'Other course must remain untouched');
    assert.equal(db.enrollments.has('enr-other-1'), true, 'Other course enrollment untouched');
    assert.equal(db.videos.has('vid-other-1'), true, 'Other course video untouched');
    assert.equal(db.exams.has('exam-other-1'), true, 'Other course exam untouched');
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

test('LECTURE FORCE DELETE: removes video and all child dependencies, other videos remain', async () => {
  const db = new MockFullLmsDatabase();
  const storage = new MockStorage();

  const courseId = 'course-1';
  const targetVideoId = 'vid-del-1';
  const keepVideoId = 'vid-keep-2';

  db.courses.set(courseId, { id: courseId, title: 'Course 1' });
  db.videos.set(targetVideoId, { id: targetVideoId, course_id: courseId, title: 'Video to Delete' });
  db.videos.set(keepVideoId, { id: keepVideoId, course_id: courseId, title: 'Video to Keep' });

  // Dependencies of target video
  db.video_progress.set('vp-del', { video_id: targetVideoId, user_email: 's1@test.com' });
  db.video_view_sessions.set('vvs-del', { video_id: targetVideoId, session_token: 'tok-del' });
  db.student_video_access_grants.set('grant-del', { video_id: targetVideoId, student_email: 's1@test.com' });
  db.lecture_access_codes.set('lac-del', { id: 'lac-del', course_id: courseId, video_id: targetVideoId });
  db.access_code_batches.set('acb-del', { id: 'acb-del', course_id: courseId, video_id: targetVideoId });
  db.lecture_materials.set('mat-del', { id: 'mat-del', video_id: targetVideoId, file_key: 'mat/del.pdf' });
  db.course_items.set('ci-del', { id: 'ci-del', course_id: courseId, video_id: targetVideoId });
  storage.files.set('mat/del.pdf', 'pdf-data');

  // Dependencies of keep video
  db.video_progress.set('vp-keep', { video_id: keepVideoId, user_email: 's1@test.com' });
  db.course_items.set('ci-keep', { id: 'ci-keep', course_id: courseId, video_id: keepVideoId });

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    STORAGE: storage,
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
  };

  try {
    const { DELETE } = await import('../app/api/admin/videos/[id]/route.ts');
    const req = new Request(`https://example.test/api/admin/videos/${targetVideoId}`, {
      method: 'DELETE',
      headers: {
        origin: 'https://example.test',
        cookie: 'englizeka_staff=valid-token',
      },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: targetVideoId }) });
    assert.equal(res.status, 200);

    // Target video and dependencies gone
    assert.equal(db.videos.has(targetVideoId), false);
    assert.equal(db.video_progress.has('vp-del'), false);
    assert.equal(db.video_view_sessions.has('vvs-del'), false);
    assert.equal(db.student_video_access_grants.has('grant-del'), false);
    assert.equal(db.lecture_access_codes.has('lac-del'), false);
    assert.equal(db.access_code_batches.has('acb-del'), false);
    assert.equal(db.lecture_materials.has('mat-del'), false);
    assert.equal(db.course_items.has('ci-del'), false);
    assert.equal(storage.files.has('mat/del.pdf'), false);

    // Keep video and dependencies untouched
    assert.equal(db.videos.has(keepVideoId), true);
    assert.equal(db.video_progress.has('vp-keep'), true);
    assert.equal(db.course_items.has('ci-keep'), true);
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

test('EXAM FORCE DELETE: removes exam, questions, attempts, answers, unlinks prerequisite, other exams untouched', async () => {
  const db = new MockFullLmsDatabase();
  const storage = new MockStorage();

  const courseId = 'course-1';
  const targetExamId = 'exam-del-1';
  const keepExamId = 'exam-keep-2';

  db.courses.set(courseId, { id: courseId, title: 'Course 1' });
  db.exams.set(targetExamId, { id: targetExamId, course_id: courseId, title: 'Exam to Delete', teacher_file_key: 'ex/del.pdf' });
  db.exams.set(keepExamId, { id: keepExamId, course_id: courseId, title: 'Exam to Keep' });

  // A video gating on targetExamId
  db.videos.set('vid-gated', { id: 'vid-gated', course_id: courseId, title: 'Gated Video', prerequisite_exam_id: targetExamId, minimum_score: 80 });

  // Target exam dependencies
  db.questions.set('q-del-1', { id: 'q-del-1', exam_id: targetExamId, image_file_key: 'q/del.png' });
  db.attempts.set('att-del-1', { id: 'att-del-1', exam_id: targetExamId, pdf_storage_key: 'att/del.pdf' });
  db.answers.set('ans-del-1', { id: 'ans-del-1', attempt_id: 'att-del-1', question_id: 'q-del-1' });
  db.exam_sessions.set('sess-del-1', { id: 'sess-del-1', exam_id: targetExamId, user_email: 's1@test.com' });
  db.course_items.set('ci-exam-del', { id: 'ci-exam-del', course_id: courseId, exam_id: targetExamId });
  storage.files.set('ex/del.pdf', 'data');
  storage.files.set('q/del.png', 'data');
  storage.files.set('att/del.pdf', 'data');

  // Keep exam dependencies
  db.questions.set('q-keep-1', { id: 'q-keep-1', exam_id: keepExamId });
  db.attempts.set('att-keep-1', { id: 'att-keep-1', exam_id: keepExamId });

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    STORAGE: storage,
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
  };

  try {
    const { DELETE } = await import('../app/api/admin/exams/[id]/route.ts');
    const req = new Request(`https://example.test/api/admin/exams/${targetExamId}`, {
      method: 'DELETE',
      headers: {
        origin: 'https://example.test',
        cookie: 'englizeka_staff=valid-token',
      },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: targetExamId }) });
    assert.equal(res.status, 200);

    // Target exam and dependencies deleted
    assert.equal(db.exams.has(targetExamId), false);
    assert.equal(db.questions.has('q-del-1'), false);
    assert.equal(db.attempts.has('att-del-1'), false);
    assert.equal(db.answers.has('ans-del-1'), false);
    assert.equal(db.exam_sessions.has('sess-del-1'), false);
    assert.equal(db.course_items.has('ci-exam-del'), false);
    assert.equal(storage.files.has('ex/del.pdf'), false);
    assert.equal(storage.files.has('q/del.png'), false);
    assert.equal(storage.files.has('att/del.pdf'), false);

    // Gated video prerequisite unlinked
    const gatedVideo = db.videos.get('vid-gated');
    assert.equal(gatedVideo.prerequisite_exam_id, null, 'Video prerequisite should be cleared');
    assert.equal(gatedVideo.minimum_score, 0, 'Video minimum score should be reset');

    // Keep exam intact
    assert.equal(db.exams.has(keepExamId), true);
    assert.equal(db.questions.has('q-keep-1'), true);
    assert.equal(db.attempts.has('att-keep-1'), true);
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});

test('ROLLBACK TEST: transaction rollback leaves parent and children completely intact on failure', async () => {
  const db = new MockFullLmsDatabase();
  const storage = new MockStorage();

  const courseId = 'course-rollback-test';
  db.courses.set(courseId, { id: courseId, title: 'Rollback Course' });
  db.enrollments.set('enr-rb-1', { id: 'enr-rb-1', course_id: courseId, user_email: 's1@test.com' });
  db.videos.set('vid-rb-1', { id: 'vid-rb-1', course_id: courseId, title: 'Rollback Video' });

  // Simulate an unexpected error during the transaction batch
  db.shouldFailBatch = true;

  globalThis.__ENGLIZEKA_ENV__ = {
    DB: db,
    STORAGE: storage,
    VERIFICATION_SECRET: 'test-session-secret-that-is-at-least-24-characters',
  };

  try {
    const { DELETE } = await import('../app/api/admin/courses/[id]/route.ts');
    const req = new Request(`https://example.test/api/admin/courses/${courseId}`, {
      method: 'DELETE',
      headers: {
        origin: 'https://example.test',
        cookie: 'englizeka_staff=valid-token',
      },
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: courseId }) });
    assert.equal(res.status, 500, 'Should return structured 500 error');
    const body = await res.json();
    assert.ok(body.error, 'Should contain safe error message');
    assert.equal(body.error.includes('فشل حذف الكورس'), true);

    // Verify complete rollback: parent still exists and children still exist
    assert.equal(db.courses.has(courseId), true, 'Course must still exist after rollback');
    assert.equal(db.enrollments.has('enr-rb-1'), true, 'Enrollment must still exist after rollback');
    assert.equal(db.videos.has('vid-rb-1'), true, 'Video must still exist after rollback');
  } finally {
    delete globalThis.__ENGLIZEKA_ENV__;
  }
});
