/**
 * app/lib/course-thumbnail.ts
 *
 * Deterministic helper functions for course thumbnail versioning and URL construction.
 * Ensures client browsers, admin UI, and student-facing pages immediately reflect thumbnail
 * replacements without breaking HTTP caching when unrelated course attributes change.
 */

/**
 * Extracts a stable version token for a course thumbnail.
 * The token is derived from the thumbnail storage key (which contains a unique UUID per upload)
 * or falls back to the course's updatedAt timestamp.
 */
export function getCourseThumbnailVersion(
  thumbnailKey?: string | null,
  updatedAt?: number | string | null
): string | null {
  if (!thumbnailKey) return null;
  const fileName = thumbnailKey.split('/').pop() || '';
  const token = fileName.replace(/\.[^.]+$/, '').trim();
  if (token && token !== 'thumbnail') {
    return token;
  }
  if (updatedAt) {
    return String(updatedAt);
  }
  return token || null;
}

/**
 * Builds the canonical public image URL for a course thumbnail,
 * appending a version query parameter (?v=...) if a version token is available.
 */
export function getCourseThumbnailUrl(
  courseId: string,
  thumbnailKey?: string | null,
  updatedAt?: number | string | null
): string {
  if (!courseId || !thumbnailKey) return '';
  const version = getCourseThumbnailVersion(thumbnailKey, updatedAt);
  return version
    ? `/api/courses/${encodeURIComponent(courseId)}/thumbnail?v=${encodeURIComponent(version)}`
    : `/api/courses/${encodeURIComponent(courseId)}/thumbnail`;
}
