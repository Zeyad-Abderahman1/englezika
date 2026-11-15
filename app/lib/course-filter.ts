/** Grade tab filtering for the public course list (pure, unit-tested). */

export const STANDARD_GRADES = ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];

export interface FilterableCourse {
  grade: string;
  /** True for items offered to every class (e.g. an exam published as a course). */
  allGrades?: boolean;
}

/** Items offered to ALL classes appear under every class tab (but not under "أخرى"). */
export function filterCoursesByTab<T extends FilterableCourse>(courses: T[], active: string): T[] {
  if (active === 'الكل') return courses;
  if (active === 'أخرى') {
    return courses.filter((course) => !course.allGrades && !STANDARD_GRADES.includes(course.grade));
  }
  return courses.filter((course) => course.allGrades || course.grade === active);
}
