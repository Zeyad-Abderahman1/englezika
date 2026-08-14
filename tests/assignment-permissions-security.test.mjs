import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { STAFF_PRESETS } from '../app/lib/staff-permissions.ts';

test('teachers and course-manager assistants can manage assignments without granting graders access', () => {
  assert.ok(STAFF_PRESETS.full_access.includes('manage_assignments'));
  assert.ok(STAFF_PRESETS.course_manager.includes('manage_assignments'));
  assert.equal(STAFF_PRESETS.grader.includes('manage_assignments'), false);
  assert.equal(STAFF_PRESETS.enrollment_manager.includes('manage_assignments'), false);
});

test('admin bootstrap hides pagination totals for resources outside staff permissions', async () => {
  const source = await readFile(
    new URL('../app/api/admin/bootstrap/route.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /assignments: makePagination\(can\('manage_assignments'\)/);
  assert.match(source, /attempts: makePagination\(can\('grade_exams'\)/);
  assert.match(source, /contacts: makePagination\(can\('manage_messages'\)/);
});
