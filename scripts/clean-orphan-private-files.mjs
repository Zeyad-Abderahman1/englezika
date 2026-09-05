import { fileURLToPath } from 'node:url';
import { readdir, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';


export const STORAGE_REFERENCE_SOURCES = Object.freeze([
  {
    table: 'users',
    column: 'birth_certificate_key',
    query: "SELECT birth_certificate_key AS key FROM users WHERE birth_certificate_key IS NOT NULL AND birth_certificate_key != ''",
  },
  {
    table: 'assignments',
    column: 'teacher_file_key',
    query: "SELECT teacher_file_key AS key FROM assignments WHERE teacher_file_key IS NOT NULL AND teacher_file_key != ''",
  },
  {
    table: 'assignment_submissions',
    column: 'pdf_storage_key',
    query: "SELECT pdf_storage_key AS key FROM assignment_submissions WHERE pdf_storage_key IS NOT NULL AND pdf_storage_key != ''",
  },
  {
    table: 'exams',
    column: 'teacher_file_key',
    query: "SELECT teacher_file_key AS key FROM exams WHERE teacher_file_key IS NOT NULL AND teacher_file_key != ''",
  },
  {
    table: 'questions',
    column: 'image_file_key',
    query: "SELECT image_file_key AS key FROM questions WHERE image_file_key IS NOT NULL AND image_file_key != ''",
  },
  {
    table: 'assignment_questions',
    column: 'image_file_key',
    query: "SELECT image_file_key AS key FROM assignment_questions WHERE image_file_key IS NOT NULL AND image_file_key != ''",
  },
  {
    table: 'attempts',
    column: 'pdf_storage_key',
    query: "SELECT pdf_storage_key AS key FROM attempts WHERE pdf_storage_key IS NOT NULL AND pdf_storage_key != ''",
  },
  {
    table: 'lecture_materials',
    column: 'file_key',
    query: "SELECT file_key AS key FROM lecture_materials WHERE file_key IS NOT NULL AND file_key != ''",
  },
  {
    table: 'courses',
    column: 'thumbnail_key',
    query: "SELECT thumbnail_key AS key FROM courses WHERE thumbnail_key IS NOT NULL AND thumbnail_key != ''",
  },
]);

function storageRoot(env = process.env) {
  const configured = env.PRIVATE_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve('storage/private');
}

async function listFilesRecursively(directory, root) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const objects = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      objects.push(...(await listFilesRecursively(fullPath, root)));
    } else if (entry.isFile()) {
      objects.push(path.relative(root, fullPath).split(path.sep).join('/'));
    }
  }
  return objects;
}

export async function runCleanOrphanPrivateFiles(options = {}) {
  const env = options.env || process.env;
  const databaseUrl = options.databaseUrl || env.DATABASE_URL?.trim();
  const dryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : options.execute !== true;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run orphan file cleanup');
  }

  const root = options.storageRoot || storageRoot(env);
  await mkdir(root, { recursive: true });

  const client = options.pgClient || options.client || new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const queryResults = await Promise.all(
      STORAGE_REFERENCE_SOURCES.map(async (source) => {
        try {
          const res = await client.query(source.query);
          return { source, rows: res?.rows || [] };
        } catch (error) {
          const safeMessage = `Storage reference lookup failed for ${source.table}.${source.column}: ${error?.message || 'unknown error'}`;
          throw new Error(safeMessage);
        }
      })
    );

    const knownKeys = new Set();
    for (const { rows } of queryResults) {
      for (const row of rows) {
        if (row?.key && typeof row.key === 'string') {
          const rawKey = row.key.trim();
          if (rawKey) {
            knownKeys.add(rawKey);
            const normalizedKey = rawKey.replaceAll('\\', '/').replace(/^\/+/, '');
            if (normalizedKey) {
              knownKeys.add(normalizedKey);
            }
          }
        }
      }
    }

    const diskFiles = await listFilesRecursively(root, root);
    const orphans = diskFiles.filter((key) => !knownKeys.has(key));

    if (orphans.length === 0) {
      return {
        success: true,
        dryRun,
        orphanCount: 0,
        deletedCount: 0,
        message: 'No orphan private files found.',
      };
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        orphanCount: orphans.length,
        deletedCount: 0,
        message: `[DRY RUN] Found ${orphans.length} orphan file(s) on disk with no database record. Pass --execute to permanently delete.`,
      };
    }

    let deleted = 0;
    const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    for (const key of orphans) {
      const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '');
      if (normalized && !normalized.split('/').some((part) => part === '..' || part === '')) {
        const fullPath = path.resolve(root, ...normalized.split('/'));
        if (fullPath.startsWith(rootPrefix)) {
          await rm(fullPath, { force: true });
          deleted += 1;
        }
      }
    }

    return {
      success: true,
      dryRun: false,
      orphanCount: orphans.length,
      deletedCount: deleted,
      message: `Successfully deleted ${deleted} orphan file(s) from private storage.`,
    };
  } finally {
    await client.end();
  }
}

export function parseCleanOrphanArgs(argv = process.argv.slice(2)) {
  const isExecute = Array.isArray(argv) && argv.includes('--execute');
  return {
    execute: isExecute,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { execute } = parseCleanOrphanArgs(process.argv.slice(2));
  runCleanOrphanPrivateFiles({ execute })
    .then((result) => {
      process.stdout.write(`[cleanOrphanPrivateFiles] ${result.message}\n`);
      process.exit(0);
    })
    .catch((error) => {
      process.stderr.write(`[cleanOrphanPrivateFiles error] ${error.message}\n`);
      process.exit(1);
    });
}
