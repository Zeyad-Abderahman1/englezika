import { fileURLToPath } from 'node:url';
import process from 'node:process';
import pg from 'pg';

export async function runCleanExamSessions(options = {}) {
  const env = options.env || process.env;
  const databaseUrl = options.databaseUrl || env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run exam session cleanup');
  }

  const client = options.pgClient || options.client || new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const tableCheck = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'exam_sessions'"
    );
    if (tableCheck.rowCount === 0) {
      return {
        success: true,
        deleted: 0,
        message: "Table 'exam_sessions' does not exist yet. No action taken.",
      };
    }

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const result = await client.query(
      `DELETE FROM exam_sessions
       WHERE started_at < $1
         AND status IN ('abandoned', 'incomplete')`,
      [cutoff]
    );

    const deleted = result.rowCount || 0;
    return {
      success: true,
      deleted,
      message: `Deleted ${deleted} stale exam session(s) older than 24 hours.`,
    };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCleanExamSessions()
    .then((result) => {
      process.stdout.write(`[cleanExamSessions] ${result.message}\n`);
      process.exit(0);
    })
    .catch((error) => {
      process.stderr.write(`[cleanExamSessions error] ${error.message}\n`);
      process.exit(1);
    });
}
