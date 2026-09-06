/**
 * YouTube utility functions for extracting video IDs and building
 * normalized media sources for Vidstack player.
 */

/**
 * Safely extracts an 11-character YouTube video ID from various formats:
 * - Clean 11-char ID: "dQw4w9WgXcQ"
 * - Standard URL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
 * - Short URL: "https://youtu.be/dQw4w9WgXcQ"
 * - Embed URL: "https://www.youtube.com/embed/dQw4w9WgXcQ"
 * - Shorts URL: "https://www.youtube.com/shorts/dQw4w9WgXcQ"
 * - Vidstack prefix: "youtube/dQw4w9WgXcQ"
 * - URL with query params: "https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ"
 */
export function extractYouTubeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|v\/|live\/)|youtube\/)([A-Za-z0-9_-]{11})/
  );
  if (match?.[1]) return match[1];
  return null;
}

/**
 * Returns a normalized Vidstack YouTube media source: "youtube/<VIDEO_ID>"
 * or null if no valid video ID could be extracted.
 */
export function toVidstackYouTubeSource(value: unknown): string | null {
  const id = extractYouTubeId(value);
  return id ? `youtube/${id}` : null;
}
