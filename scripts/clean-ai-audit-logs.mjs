import { getDatabase } from '../app/lib/database.ts';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function run() {
  const db = getDatabase();
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  // Delete action logs older than 30 days
  const logsResult = await db
    .prepare('DELETE FROM ai_action_logs WHERE created_at < ?')
    .bind(cutoff)
    .run();

  // Delete conversation messages older than 30 days
  const messagesResult = await db
    .prepare('DELETE FROM ai_messages WHERE created_at < ?')
    .bind(cutoff)
    .run();

  // Clean empty conversations older than 30 days
  const convsResult = await db
    .prepare(
      `DELETE FROM ai_conversations
       WHERE updated_at < ? AND id NOT IN (SELECT DISTINCT conversation_id FROM ai_messages)`
    )
    .bind(cutoff)
    .run();

  process.stdout.write(
    `Retention cleanup complete: ${logsResult.meta.changes} action logs, ${messagesResult.meta.changes} messages, ${convsResult.meta.changes} conversations cleaned.\n`
  );
}

run().catch((err) => {
  process.stderr.write(`Error cleaning AI logs: ${err.message}\n`);
  process.exit(1);
});
