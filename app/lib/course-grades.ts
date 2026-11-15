/**
 * Canonical class/grade values offered when creating a course.
 *
 * Mirrors the options of the admin course form (a drift test in
 * tests/ai-agent-flows-security.test.mjs fails if they diverge). The AI assistant's
 * `list_grades` tool merges these with any grade already stored on existing
 * courses, so the list is never hardcoded in the assistant itself.
 */
export const COURSE_GRADE_OPTIONS = [
  'أولى ثانوي',
  'تانية ثانوي',
  'تالتة ثانوي',
  'كل الصفوف',
  'أخرى',
] as const;
