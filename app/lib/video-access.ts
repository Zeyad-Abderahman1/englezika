import { ensureDatabase } from '../../db/runtime';
import { getD1, getPlatformEnv } from './platform';
import {
  createSignedVideoToken,
  verifySignedVideoToken,
  VIDEO_EMBED_TOKEN_TTL_MS,
  createSignedVideoCompletionToken,
  verifySignedVideoCompletionToken,
} from './video-token';

export { VIDEO_EMBED_TOKEN_TTL_MS };

export type AuthorizedVideo = {
  id: string;
  courseId: string;
  sourceType: string;
  youtubeId: string | null;
  durationSeconds: number;
  r2Key: string;
  contentType: string;
  title: string;
  prerequisiteExamId: string | null;
  minimumScore: number;
};

export type VideoAccessResult =
  | { ok: true; video: AuthorizedVideo }
  | { ok: false; status: number; error: string; code?: string };

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenSecret(): string {
  const env = getPlatformEnv();
  const secret = (env.VIDEO_RESOLVE_SECRET || env.VERIFICATION_SECRET)?.trim();
  if (!secret || secret.length < 24) throw new Error('Video resolve secret is not configured');
  return secret;
}

export function createVideoEmbedToken(email: string, videoId: string): Promise<string> {
  return createSignedVideoToken(tokenSecret(), email, videoId);
}

export function verifyVideoEmbedToken(
  token: string,
  email: string,
  videoId: string
): Promise<boolean> {
  return verifySignedVideoToken(tokenSecret(), token, email, videoId);
}

export function createVideoCompletionToken(
  email: string,
  videoId: string,
  durationSeconds: number
): Promise<string> {
  return createSignedVideoCompletionToken(tokenSecret(), email, videoId, durationSeconds);
}

export function verifyVideoCompletionToken(
  token: string,
  email: string,
  videoId: string
): Promise<boolean> {
  return verifySignedVideoCompletionToken(tokenSecret(), token, email, videoId);
}

export async function authorizeVideoAccess(
  email: string,
  videoId: string
): Promise<VideoAccessResult> {
  await ensureDatabase();
  const db = getD1();
  const normalized = normalizedEmail(email);
  const video = await db
    .prepare(
      `SELECT v.id, v.course_id AS courseId, v.source_type AS sourceType,
       v.youtube_id AS youtubeId, v.duration_seconds AS durationSeconds,
       v.r2_key AS r2Key, v.content_type AS contentType, v.title,
       v.prerequisite_exam_id AS prerequisiteExamId, v.minimum_score AS minimumScore
       FROM videos v JOIN enrollments e ON e.course_id = v.course_id
       WHERE v.id = ? AND v.status = 'published'
       AND e.user_email = ? AND e.status = 'approved' LIMIT 1`
    )
    .bind(videoId, normalized)
    .first<AuthorizedVideo>();
  if (!video) {
    return { ok: false, status: 403, error: 'هذه المحاضرة غير متاحة لهذا الحساب' };
  }

  const previousVideo = await db
    .prepare(
      `SELECT id FROM videos
       WHERE course_id = ? AND status = 'published' AND created_at < (
         SELECT created_at FROM videos WHERE id = ?
       ) ORDER BY created_at DESC LIMIT 1`
    )
    .bind(video.courseId, videoId)
    .first<{ id: string }>();
  if (previousVideo) {
    const completed = await db
      .prepare('SELECT id FROM video_progress WHERE user_email = ? AND video_id = ? LIMIT 1')
      .bind(normalized, previousVideo.id)
      .first();
    if (!completed) {
      return {
        ok: false,
        status: 403,
        error: 'يجب إنهاء المحاضرة السابقة أولاً',
        code: 'PREVIOUS_LESSON_REQUIRED',
      };
    }
  }

  if (video.prerequisiteExamId) {
    const bestAttempt = await db
      .prepare(
        `SELECT MAX(CASE WHEN max_score > 0 THEN (score * 100.0 / max_score) ELSE 0 END)
           AS bestPercentage
         FROM attempts
         WHERE exam_id = ? AND user_email = ? AND status = 'submitted'`
      )
      .bind(video.prerequisiteExamId, normalized)
      .first<{ bestPercentage: number | null }>();
    if (Number(bestAttempt?.bestPercentage ?? -1) < Number(video.minimumScore || 0)) {
      return {
        ok: false,
        status: 403,
        error: 'يجب اجتياز اختبار المحاضرة بالدرجة المطلوبة أولًا',
        code: 'LESSON_QUIZ_REQUIRED',
      };
    }
  }
  return { ok: true, video };
}
