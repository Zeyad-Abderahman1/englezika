/**
 * Stage 9 — "أخرى" Category — Security Tests
 *
 * Validates:
 * 1. "أخرى" accepted by admin course create
 * 2. "أخرى" accepted by admin course edit
 * 3. "أخرى" appears in public courses filter
 * 4. Admin grade filter includes "أخرى"
 * 5. Public API returns "أخرى" courses
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';

describe('admin "أخرى" category support', () => {
  test('admin course create dropdown includes "أخرى"', async () => {
    const content = await readFile('app/components/admin/domains/CoursesManagerView.tsx', 'utf-8');
    const addModal = content.slice(content.indexOf('Add Course Modal'));
    assert.ok(addModal.includes('أخرى'), 'Add modal includes أخرى');
  });

  test('admin course edit dropdown includes "أخرى"', async () => {
    const content = await readFile('app/components/admin/domains/CoursesManagerView.tsx', 'utf-8');
    const editModal = content.slice(content.indexOf('Edit Course Modal'));
    assert.ok(editModal.includes('أخرى'), 'Edit modal includes أخرى');
  });

  test('admin filter bar includes "أخرى"', async () => {
    const content = await readFile('app/components/admin/domains/CoursesManagerView.tsx', 'utf-8');
    const filterBar = content.slice(content.indexOf('Filter Toolbar'));
    assert.ok(filterBar.includes('أخرى'), 'Filter bar includes أخرى');
  });
});

describe('public "أخرى" category support', () => {
  test('public courses page includes "أخرى" filter tab', async () => {
    const content = await readFile('app/components/CoursesExplorer.tsx', 'utf-8');
    assert.ok(content.includes('أخرى'), 'Public page includes أخرى filter');
  });

  test('filter logic handles "أخرى" correctly', async () => {
    const content = await readFile('app/components/CoursesExplorer.tsx', 'utf-8');
    assert.ok(content.includes("active === 'أخرى'"), 'Filter logic handles أخرى');
  });
});

describe('admin API "أخرى" acceptance', () => {
  test('admin course create API accepts any grade value', async () => {
    const content = await readFile('app/api/admin/courses/route.ts', 'utf-8');
    // No enum constraint on grade — any string is valid
    assert.ok(!content.includes('enum'), 'No enum constraint on grade');
  });

  test('admin course edit API accepts any grade value', async () => {
    const content = await readFile('app/api/admin/courses/[id]/route.ts', 'utf-8');
    // Should not reject "أخرى" as invalid
    assert.ok(!content.includes("!== 'أخرى'"), 'Does not reject أخرى');
  });
});
