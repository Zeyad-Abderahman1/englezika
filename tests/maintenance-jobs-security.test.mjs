import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { runCleanExamSessions } from '../scripts/clean-exam-sessions.mjs';
import { runCleanOrphanPrivateFiles } from '../scripts/clean-orphan-private-files.mjs';

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

class MockOrphanFilesDb {
  constructor({ certificates = [], teacherFiles = [], submissions = [] } = {}) {
    this.certificates = certificates;
    this.teacherFiles = teacherFiles;
    this.submissions = submissions;
  }

  async connect() {}
  async end() {}

  async query(sql) {
    if (sql.includes('FROM users')) {
      return { rowCount: this.certificates.length, rows: this.certificates.map((k) => ({ key: k })) };
    }
    if (sql.includes('FROM assignments')) {
      return { rowCount: this.teacherFiles.length, rows: this.teacherFiles.map((k) => ({ key: k })) };
    }
    if (sql.includes('FROM assignment_submissions')) {
      return { rowCount: this.submissions.length, rows: this.submissions.map((k) => ({ key: k })) };
    }
    return { rowCount: 0, rows: [] };
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

test('cleanOrphanPrivateFiles: DRY RUN by default, preserves known files across all 3 tables', async () => {
  const testStorageDir = path.resolve('tmp/test-storage-orphan');
  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(path.join(testStorageDir, 'students'), { recursive: true });
  await mkdir(path.join(testStorageDir, 'assignments'), { recursive: true });

  await writeFile(path.join(testStorageDir, 'students/cert1.pdf'), 'cert1');
  await writeFile(path.join(testStorageDir, 'assignments/teacher1.pdf'), 'teacher1');
  await writeFile(path.join(testStorageDir, 'assignments/sub1.pdf'), 'sub1');
  await writeFile(path.join(testStorageDir, 'students/orphan.pdf'), 'orphan');

  const db = new MockOrphanFilesDb({
    certificates: ['students/cert1.pdf'],
    teacherFiles: ['assignments/teacher1.pdf'],
    submissions: ['assignments/sub1.pdf'],
  });

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

  // File should still exist after dry run
  const filesAfterDryRun = await readdir(path.join(testStorageDir, 'students'));
  assert.ok(filesAfterDryRun.includes('orphan.pdf'));

  // 2. Explicit execute
  const executeResult = await runCleanOrphanPrivateFiles({
    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',
    pgClient: db,
    storageRoot: testStorageDir,
    execute: true,
  });

  assert.equal(executeResult.success, true);
  assert.equal(executeResult.dryRun, false);
  assert.equal(executeResult.deletedCount, 1);

  // Orphan deleted, known files intact
  const filesAfterExecute = await readdir(path.join(testStorageDir, 'students'));
  assert.equal(filesAfterExecute.includes('orphan.pdf'), false);
  assert.equal(filesAfterExecute.includes('cert1.pdf'), true);

  await rm(testStorageDir, { recursive: true, force: true }).catch(() => {});
});
