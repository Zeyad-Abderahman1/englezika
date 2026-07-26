/**
 * cleanOrphanR2Files.ts
 *
 * Scheduled cleanup job: lists all objects in the Cloudflare R2 video bucket,
 * compares their keys against the `videos` table in D1, then deletes any R2
 * objects that have no matching DB record (orphans).
 *
 * Uses the native Cloudflare Workers R2Bucket binding — NOT the AWS SDK.
 *
 * @param dryRun - If true, logs what would be deleted without actually deleting.
 *
 * Usage:
 *   import { cleanOrphanR2Files } from './cleanOrphanR2Files';
 *   await cleanOrphanR2Files();          // live delete
 *   await cleanOrphanR2Files(true);      // dry-run only
 */

import { getD1, getVideoBucket } from '../lib/platform';

export async function cleanOrphanR2Files(dryRun = false): Promise<void> {
  const db = getD1();
  const bucket = getVideoBucket();

  // ── 1. Collect all r2_key values from the database ──────────────────────────
  const { results } = await db.prepare('SELECT r2_key FROM videos').all<{ r2_key: string }>();

  const knownKeys = new Set(results.map((row) => row.r2_key));
  console.log(`[cleanOrphanR2Files] Found ${knownKeys.size} known R2 key(s) in DB.`);

  // ── 2. List all objects in the R2 bucket (paginated) ────────────────────────
  const orphans: string[] = [];
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ cursor, limit: 1000 });
    for (const obj of listed.objects) {
      if (!knownKeys.has(obj.key)) {
        orphans.push(obj.key);
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  console.log(`[cleanOrphanR2Files] Found ${orphans.length} orphan R2 object(s).`);

  if (orphans.length === 0) {
    console.log('[cleanOrphanR2Files] Nothing to clean up.');
    return;
  }

  // ── 3. Delete orphans (or just log in dry-run mode) ─────────────────────────
  for (const key of orphans) {
    if (dryRun) {
      console.log(`[cleanOrphanR2Files] [DRY-RUN] Would delete: ${key}`);
    } else {
      await bucket.delete(key);
      console.log(`[cleanOrphanR2Files] Deleted: ${key}`);
    }
  }

  if (!dryRun) {
    console.log(`[cleanOrphanR2Files] Done. Deleted ${orphans.length} orphan object(s).`);
  } else {
    console.log(
      `[cleanOrphanR2Files] Dry-run complete. ${orphans.length} object(s) would be deleted.`
    );
  }
}
