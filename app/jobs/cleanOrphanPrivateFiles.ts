/**
 * Removes private files that no longer have matching database records.
 * Use dry-run mode before enabling this from a server scheduler.
 */
import { getDatabase, getPrivateStorage } from '../lib/platform';

export async function cleanOrphanPrivateFiles(dryRun = false): Promise<{ orphanCount: number; deletedCount: number }> {
  const db = getDatabase();
  const storage = getPrivateStorage();
  const [certificates, teacherFiles, submissions] = await Promise.all([
    db
      .prepare(
        `SELECT birth_certificate_key AS key
         FROM users
         WHERE birth_certificate_key IS NOT NULL AND birth_certificate_key != ''`
      )
      .all<{ key: string }>(),
    db
      .prepare(
        `SELECT teacher_file_key AS key
         FROM assignments
         WHERE teacher_file_key IS NOT NULL AND teacher_file_key != ''`
      )
      .all<{ key: string }>(),
    db
      .prepare(
        `SELECT file_key AS key
         FROM assignment_submissions
         WHERE file_key IS NOT NULL AND file_key != ''`
      )
      .all<{ key: string }>(),
  ]);

  const knownKeys = new Set([
    ...certificates.results.map((row) => row.key),
    ...teacherFiles.results.map((row) => row.key),
    ...submissions.results.map((row) => row.key),
  ]);

  const orphans: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await storage.list({ cursor, limit: 1000 });
    for (const object of listed.objects) {
      if (!knownKeys.has(object.key)) orphans.push(object.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

    for (const key of orphans) {
    if (dryRun) {
      console.log(`[cleanOrphanPrivateFiles] [DRY-RUN] Would delete: ${key}`);
    } else {
      await storage.delete(key);
      console.log(`[cleanOrphanPrivateFiles] Deleted: ${key}`);
    }
  }

  return {
    orphanCount: orphans.length,
    deletedCount: dryRun ? 0 : orphans.length,
  };
}
