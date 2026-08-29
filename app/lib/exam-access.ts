import { getDatabase } from './platform';

export type StudentExam = {
  id: string;
  courseId: string | null;
  title: string;
  description: string;
  instructions: string;
  durationMinutes: number;
  passingScore: number;
  maxAttempts: number;
  opensAt: number | null;
  closesAt: number | null;
};

export async function loadStudentExam(id: string, email: string): Promise<StudentExam | null> {
  return getDatabase()
    .prepare(
      `SELECT x.id, x.course_id AS courseId, x.title, x.description, x.instructions,
       x.duration_minutes AS durationMinutes, x.passing_score AS passingScore,
       x.max_attempts AS maxAttempts,
       x.opens_at AS opensAt, x.closes_at AS closesAt
       FROM exams x LEFT JOIN enrollments e
       ON e.course_id = x.course_id AND e.user_email = ? AND e.status = 'approved'
       WHERE x.id = ? AND x.status = 'published'
         AND (x.course_id IS NULL OR e.id IS NOT NULL)`
    )
    .bind(email, id)
    .first<StudentExam>();
}

export function examAvailabilityError(
  exam: Pick<StudentExam, 'opensAt' | 'closesAt'>,
  now: number
): 'not-open' | 'closed' | null {
  if (exam.opensAt && Number(exam.opensAt) > now) return 'not-open';
  if (exam.closesAt && Number(exam.closesAt) < now) return 'closed';
  return null;
}
