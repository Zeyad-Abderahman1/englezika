import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile, readdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runCleanExamSessions } from '../scripts/clean-exam-sessions.mjs';
import {
  runCleanOrphanPrivateFiles,
  STORAGE_REFERENCE_SOURCES,
  parseCleanOrphanArgs,
} from '../scripts/clean-orphan-private-files.mjs';

class MockExamSessionDb {
  sessions = [];
  deletedIds = [];

  constructor(sessions = []) {
    this.sessions = sessions;
  }

  async connect() {}
  async end() {}

  async query(sql, params = []) {
    if (sql.includes('information_schema.tables')) {
      return { rowCount: 1, rows: [{ '1': 1 }] };
    }
    if (sql.includes('DELETE FROM exam_sessions')) {
      const cutoff = params[0];
      const beforeCount = this.sessions.length;
      this.sessions = this.sessions.filter((s) => {
        const matches = s.started_at < cutoff && (s.status === 'abandoned' || s.status === 'incomplete');
        if (matches) this.deletedIds.push(s.id);
        return !matches;
      });
      const deleted = beforeCount - this.sessions.length;
      return { rowCount: deleted, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }
}

const SCHEMA_COLUMNS = {
  users: new Set(['birth_certificate_key']),
  assignments: new Set(['teacher_file_key']),
  assignment_submissions: new Set(['pdf_storage_key']),
  exams: new Set(['teacher_file_key']),
  questions: new Set(['image_file_key']),
  assignment_questions: new Set(['image_file_key']),
  attempts: new Set(['pdf_storage_key']),
  lecture_materials: new Set(['file_key']),
};

class MockOrphanFilesDb {
  constructor({
    certificates = [],
    assignmentTeacherFiles = [],
    assignmentSubmissions = [],
    examTeacherFiles = [],
    questionImages = [],
    assignmentQuestionImages = [],
    attemptPdfs = [],
    lectureMaterials = [],
    failingTable = null,
    failureError = new Error('Simulated database connection error'),
  } = {}) {
    this.tableData = {
      users: certificates,
      assignments: assignmentTeacherFiles,
      assignment_submissions: assignmentSubmissions,
      exams: examTeacherFiles,
      questions: questionImages,
      assignment_questions: assignmentQuestionImages,
      attempts: attemptPdfs,
      lecture_materials: lectureMaterials,
    };
    this.failingTable = failingTable;
    this.failureError = failureError;
  }

  async connect() {}
  async end() {}

  async query(sql) {
    const match = sql.match(/SELECT\s+(\w+)\s+AS\s+key\s+FROM\s+(\w+)/i);
    if (!match) {
      throw new Error(`Unexpected query format: ${sql}`);
    }
    const [, column, table] = match;

    if (this.failingTable && (this.failingTable === table || this.failingTable === `${table}.${column}`)) {
      throw this.failureError;
    }

    const tableSchema = SCHEMA_COLUMNS[table];
    if (!tableSchema) {
      throw new Error(`relation "${table}" does not exist in schema`);
    }
    if (!tableSchema.has(column)) {
      throw new Error(`column "${column}" does not exist in relation "${table}"`);
    }

    const rows = (this.tableData[table] || []).map((k) => ({ key: k }));
    return { rowCount: rows.length, rows };
  }
}

test('cleanExamSessions deletes only abandoned/incomplete sessions older than 24h', async () => {
  const now = Date.now();
  const oldTime = now - 25 * 60 * 60 * 1000;
  const recentTime = now - 2 * 60 * 60 * 1000;

  const db = new MockExamSessionDb([
    { id: '1', started_at: oldTime, status: 'abandoned' },
    { id: '2', started_at: oldTime, status: 'incomplete' },
    { id: '3', started_at: oldTime, status: 'completed' }, // should NOT be deleted
    { id: '4', started_at: recentTime, status: 'abandoned' }, // should NOT be deleted (recent)
  ]);

  const result = await runCleanExamSessions({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
  });

  assert.equal(result.success, true);
  assert.equal(result.deleted, 2);
  assert.deepEqual(db.deletedIds, ['1', '2']);
  assert.equal(db.sessions.length, 2);
});

test('cleanOrphanPrivateFiles: preserves all 8 referenced storage sources and deletes genuine orphans', async () => {
  const testStorageDir = path.resolve('tmp/test-storage-orphan-all-8');
  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});

  // Create disk directories for all 8 types + orphans
  await mkdir(path.join(testStorageDir, 'students'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'assignments'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'submissions'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'exams'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'questions'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'assignment_questions'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'attempts'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'videos/materials'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'orphans'), { recursive: true });

  const referencedFiles = {
    certificates: ['students/birth-cert-1.pdf'],
    assignmentTeacherFiles: ['assignments/teacher-guide-1.pdf'],
    assignmentSubmissions: ['submissions/student-sub-1.pdf'],
    examTeacherFiles: ['exams/exam-spec-1.pdf'],
    questionImages: ['questions/question-diagram-1.png'],
    assignmentQuestionImages: ['assignment_questions/aq-image-1.png'],
    attemptPdfs: ['attempts/attempt-file-1.pdf'],
    lectureMaterials: ['videos/materials/lecture-notes-1.pdf'],
  };

  // Write all 8 referenced files to disk
  await writeFile(path.join(testStorageDir, referencedFiles.certificates[0]), 'cert data');
  await writeFile(path.join(testStorageDir, referencedFiles.assignmentTeacherFiles[0]), 'teacher guide');
  await writeFile(path.join(testStorageDir, referencedFiles.assignmentSubmissions[0]), 'student submission');
  await writeFile(path.join(testStorageDir, referencedFiles.examTeacherFiles[0]), 'exam file');
  await writeFile(path.join(testStorageDir, referencedFiles.questionImages[0]), 'question image');
  await writeFile(path.join(testStorageDir, referencedFiles.assignmentQuestionImages[0]), 'assignment question image');
  await writeFile(path.join(testStorageDir, referencedFiles.attemptPdfs[0]), 'attempt pdf');
  await writeFile(path.join(testStorageDir, referencedFiles.lectureMaterials[0]), 'lecture material');

  // Write 1 genuine orphan file
  const orphanFile = 'orphans/genuine-orphan.pdf';
  await writeFile(path.join(testStorageDir, orphanFile), 'orphan content');

  const db = new MockOrphanFilesDb(referencedFiles);

  // 1. Dry run
  const dryRunResult = await runCleanOrphanPrivateFiles({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
    storageRoot: testStorageDir,
    execute: false,
  });

  assert.equal(dryRunResult.success, true);
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.orphanCount, 1);
  assert.equal(dryRunResult.deletedCount, 0);

  // Orphan file and all 8 referenced files must remain intact after dry run
  const orphanOnDiskAfterDry = await readdir(path.join(testStorageDir, 'orphans'));
  assert.ok(orphanOnDiskAfterDry.includes('genuine-orphan.pdf'));

  for (const fileList of Object.values(referencedFiles)) {
    const filePath = path.join(testStorageDir, fileList[0]);
    const fileContent = await readFile(filePath, 'utf8').catch(() => null);
    assert.ok(fileContent !== null, `File ${fileList[0]} must exist after dry run`);
  }

  // 2. Explicit execute
  const executeResult = await runCleanOrphanPrivateFiles({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
    storageRoot: testStorageDir,
    execute: true,
  });

  assert.equal(executeResult.success, true);
  assert.equal(executeResult.dryRun, false);
  assert.equal(executeResult.orphanCount, 1);
  assert.equal(executeResult.deletedCount, 1);

  // Genuine orphan must be deleted
  const orphanOnDiskAfterExecute = await readdir(path.join(testStorageDir, 'orphans'));
  assert.equal(orphanOnDiskAfterExecute.includes('genuine-orphan.pdf'), false);

  // ALL 8 referenced files MUST remain intact and untouched
  for (const fileList of Object.values(referencedFiles)) {
    const filePath = path.join(testStorageDir, fileList[0]);
    const fileContent = await readFile(filePath, 'utf8').catch(() => null);
    assert.ok(fileContent !== null, `Referenced file ${fileList[0]} was erroneously deleted!`);
  }

  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
});

test('cleanOrphanPrivateFiles: FAIL CLOSED - aborts and deletes ZERO files if any reference query fails', async () => {
  const testStorageDir = path.resolve('tmp/test-storage-orphan-fail-closed');
  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});

  await mkdir(path.join(testStorageDir, 'submissions'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'orphans'), { recursive: true });

  await writeFile(path.join(testStorageDir, 'submissions/valid-sub.pdf'), 'sub data');
  await writeFile(path.join(testStorageDir, 'orphans/untracked.pdf'), 'untracked data');

  // Simulate query failure specifically on assignment_submissions
  const failingDb = new MockOrphanFilesDb({
    assignmentSubmissions: ['submissions/valid-sub.pdf'],
    failingTable: 'assignment_submissions',
    failureError: new Error('connection terminated unexpectedly'),
  });

  await assert.rejects(
    async () => {
      await runCleanOrphanPrivateFiles({
        databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
        pgClient: failingDb,
        storageRoot: testStorageDir,
        execute: true,
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('Storage reference lookup failed for assignment_submissions.pdf_storage_key'),
        `Expected lookup failure message, got: ${err.message}`
      );
      return true;
    }
  );

  // CRITICAL FAIL CLOSED VERIFICATION: ZERO files deleted from disk
  const filesSub = await readdir(path.join(testStorageDir, 'submissions'));
  assert.ok(filesSub.includes('valid-sub.pdf'), 'Valid file must not be touched');

  const filesOrphan = await readdir(path.join(testStorageDir, 'orphans'));
  assert.ok(filesOrphan.includes('untracked.pdf'), 'Orphan file must not be touched on query failure');

  // Verify fail closed on lecture_materials as well
  const failingDb2 = new MockOrphanFilesDb({
    failingTable: 'lecture_materials',
    failureError: new Error('permission denied for table lecture_materials'),
  });

  await assert.rejects(
    async () => {
      await runCleanOrphanPrivateFiles({
        databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
        pgClient: failingDb2,
        storageRoot: testStorageDir,
        execute: true,
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('Storage reference lookup failed for lecture_materials.file_key'),
        `Expected lookup failure message, got: ${err.message}`
      );
      return true;
    }
  );

  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
});

test('cleanOrphanPrivateFiles: STORAGE_REFERENCE_SOURCES strictly match migration schema columns', async () => {
  // 1. Verify that all 8 required sources are defined in STORAGE_REFERENCE_SOURCES
  assert.equal(STORAGE_REFERENCE_SOURCES.length, 8);

  const expectedSources = [
    { table: 'users', column: 'birth_certificate_key' },
    { table: 'assignments', column: 'teacher_file_key' },
    { table: 'assignment_submissions', column: 'pdf_storage_key' },
    { table: 'exams', column: 'teacher_file_key' },
    { table: 'questions', column: 'image_file_key' },
    { table: 'assignment_questions', column: 'image_file_key' },
    { table: 'attempts', column: 'pdf_storage_key' },
    { table: 'lecture_materials', column: 'file_key' },
  ];

  for (const expected of expectedSources) {
    const found = STORAGE_REFERENCE_SOURCES.find(
      (s) => s.table === expected.table && s.column === expected.column
    );
    assert.ok(found, `STORAGE_REFERENCE_SOURCES must include ${expected.table}.${expected.column}`);
    assert.ok(found.query.includes(`SELECT ${expected.column} AS key FROM ${expected.table}`));
  }

  // 2. Read migration files and verify column definitions exist in actual migrations
  const migrationsDir = path.resolve('database/migrations');
  const migrationFiles = await readdir(migrationsDir);
  const migrationContents = await Promise.all(
    migrationFiles.filter((f) => f.endsWith('.sql')).map((f) => readFile(path.join(migrationsDir, f), 'utf8'))
  );
  const combinedSql = migrationContents.join('\n');

  // Verify that assignment_submissions defines pdf_storage_key and NOT file_key
  assert.ok(combinedSql.includes('pdf_storage_key TEXT'), 'Migrations must define pdf_storage_key');
  assert.ok(
    !combinedSql.includes('assignment_submissions (\n  file_key'),
    'assignment_submissions must not define file_key'
  );

  // Verify all 8 column names exist in migration SQL
  assert.ok(combinedSql.includes('birth_certificate_key TEXT'));
  assert.ok(combinedSql.includes('teacher_file_key TEXT'));
  assert.ok(combinedSql.includes('image_file_key TEXT'));
  assert.ok(combinedSql.includes('file_key TEXT NOT NULL'));

  // 3. Schema-sensitive mock database rejects wrong column names
  const strictDb = new MockOrphanFilesDb();
  await assert.rejects(
    async () => {
      await strictDb.query('SELECT file_key AS key FROM assignment_submissions');
    },
    /column "file_key" does not exist in relation "assignment_submissions"/
  );
});

test('cleanOrphanPrivateFiles: strictly requires --execute for deletion; default, --force, and unknown flags remain dry-run', async () => {
  // 1. Validate parseCleanOrphanArgs unit behavior
  assert.equal(parseCleanOrphanArgs([]).execute, false);
  assert.equal(parseCleanOrphanArgs(['--force']).execute, false);
  assert.equal(parseCleanOrphanArgs(['--delete-all']).execute, false);
  assert.equal(parseCleanOrphanArgs(['--yes']).execute, false);
  assert.equal(parseCleanOrphanArgs(['--execute']).execute, true);
  assert.equal(parseCleanOrphanArgs(['--force', '--execute']).execute, true);
  assert.equal(parseCleanOrphanArgs(['--execute', '--force']).execute, true);

  const testStorageDir = path.resolve('tmp/test-storage-orphan-flags');
  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(path.join(testStorageDir, 'orphans'), { recursive: true });

  const orphanFilePath = path.join(testStorageDir, 'orphans/target-orphan.pdf');
  const db = new MockOrphanFilesDb();

  // Case A: Default invocation (no flags passed) -> dry-run, no deletion
  await writeFile(orphanFilePath, 'orphan payload');
  const defaultResult = await runCleanOrphanPrivateFiles({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
    storageRoot: testStorageDir,
    ...parseCleanOrphanArgs([]),
  });
  assert.equal(defaultResult.dryRun, true);
  assert.equal(defaultResult.deletedCount, 0);
  assert.ok((await readdir(path.join(testStorageDir, 'orphans'))).includes('target-orphan.pdf'));

  // Case B: Passing --force -> MUST NOT delete files (remains dry-run)
  const forceResult = await runCleanOrphanPrivateFiles({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
    storageRoot: testStorageDir,
    ...parseCleanOrphanArgs(['--force']),
  });
  assert.equal(forceResult.dryRun, true);
  assert.equal(forceResult.deletedCount, 0);
  assert.ok((await readdir(path.join(testStorageDir, 'orphans'))).includes('target-orphan.pdf'));

  // Case C: Passing unknown destructive flags -> MUST NOT delete files (remains dry-run)
  const unknownResult = await runCleanOrphanPrivateFiles({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
    storageRoot: testStorageDir,
    ...parseCleanOrphanArgs(['--force', '--delete-all', '--yes', '--wipe']),
  });
  assert.equal(unknownResult.dryRun, true);
  assert.equal(unknownResult.deletedCount, 0);
  assert.ok((await readdir(path.join(testStorageDir, 'orphans'))).includes('target-orphan.pdf'));

  // Case D: Explicit --execute -> real deletion
  const executeResult = await runCleanOrphanPrivateFiles({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
    storageRoot: testStorageDir,
    ...parseCleanOrphanArgs(['--execute']),
  });
  assert.equal(executeResult.dryRun, false);
  assert.equal(executeResult.deletedCount, 1);
  assert.equal((await readdir(path.join(testStorageDir, 'orphans'))).includes('target-orphan.pdf'), false);

  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
});
