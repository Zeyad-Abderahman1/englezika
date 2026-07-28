import assert from 'node:assert/strict';
import test from 'node:test';

import { STAFF_PRESETS } from '../app/lib/staff-permissions.ts';

test('teachers and course-manager assistants can manage assignments without granting graders access', () => {
  assert.ok(STAFF_PRESETS.full_access.includes('manage_assignments'));
  assert.ok(STAFF_PRESETS.course_manager.includes('manage_assignments'));
  assert.equal(STAFF_PRESETS.grader.includes('manage_assignments'), false);
  assert.equal(STAFF_PRESETS.enrollment_manager.includes('manage_assignments'), false);
});
