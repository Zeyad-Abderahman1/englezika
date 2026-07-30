/**
 * cleanExamSessions.ts
 *
 * Scheduled cleanup job: deletes abandoned or incomplete exam sessions
 * older than 24 hours. Safe to call manually or from the server scheduler.
 *
 * Usage:
 *   import { cleanExamSessions } from './cleanExamSessions';
 *   await cleanExamSessions();
 */

import { getDatabase } from '../lib/platform';

/**
 * Deletes exam_sessions rows that are:
 *  - older than 24 hours (started_at < now - 86_400_000 ms)
 *  - AND have status 'abandoned' or 'incomplete'
 *
 * @returns The number of rows deleted.
 */
export async function cleanExamSessions(): Promise<number> {
  const db = getDatabase();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago in ms

  const result = await db
    .prepare(
      `DELETE FROM exam_sessions
       WHERE started_at < ?
         AND status IN ('abandoned', 'incomplete')`
    )
    .bind(cutoff)
    .run();

  const deleted = result.meta?.changes ?? 0;
  console.log(`[cleanExamSessions] Deleted ${deleted} stale exam session(s) older than 24 hours.`);
  return deleted;
}
