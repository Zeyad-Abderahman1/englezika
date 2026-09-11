import { getPrivateStorage } from '../app/lib/platform.ts';

const ONE_HOUR_MS = 60 * 60 * 1000;

async function run() {
  const storage = getPrivateStorage();
  const list = await storage.list({ limit: 500 });
  const tempFiles = (list?.objects || []).filter((obj) => obj.key.startsWith('ai_temp/'));

  let deleted = 0;
  const now = Date.now();

  for (const item of tempFiles) {
    const meta = await storage.head(item.key);
    if (meta) {
      await storage.delete(item.key);
      deleted++;
    }
  }

  process.stdout.write(`Cleaned ${deleted} temporary AI files.\n`);
}

run().catch((err) => {
  process.stderr.write(`Error cleaning temp files: ${err.message}\n`);
  process.exit(1);
});
