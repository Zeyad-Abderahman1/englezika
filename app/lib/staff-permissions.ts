export const STAFF_PERMISSIONS = [
  'manage_courses',
  'manage_exams',
  'manage_assignments',
  'manage_videos',
  'manage_enrollments',
  'grade_exams',
  'manage_announcements',
  'manage_messages',
  'view_students',
  'manage_staff',
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export type StaffPreset = 'full_access' | 'grader' | 'course_manager' | 'enrollment_manager';

export const STAFF_PRESETS: Record<StaffPreset, StaffPermission[]> = {
  full_access: [...STAFF_PERMISSIONS],
  grader: ['grade_exams', 'view_students'],
  course_manager: ['manage_courses', 'manage_exams', 'manage_assignments', 'manage_videos'],
  enrollment_manager: ['manage_enrollments', 'view_students'],
};

export function normalizeStaffPreset(value: unknown): StaffPreset {
  return value === 'grader' || value === 'course_manager' || value === 'enrollment_manager'
    ? value
    : 'full_access';
}
