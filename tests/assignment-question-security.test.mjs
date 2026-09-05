/**
 * Stage 5 — Assignment Question Management — Security Tests
 *
 * Validates:
 * 1. Admin assignment questions GET includes explanation and imageFileKey
 * 2. Admin assignment questions POST accepts explanation
 * 3. Admin assignment question PATCH validates and updates fields
 * 4. Admin assignment question DELETE removes question
 * 5. Admin assignment question image upload validates PDF/images
 * 6. Admin assignment question reorder persists order
 * 7. Student assignment GET excludes explanation before submission
 * 8. Student assignment GET includes hasImage boolean
 * 9. Student assignment GET never exposes image_file_key
 * 10. Admin endpoints require staff auth + same-origin
 * 11. Assignment question validation: min 2 options, min 3 char question
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';

describe('admin assignment questions GET', () => {
  test('includes explanation, imageFileKey, and hasImage', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/route.ts', 'utf-8');
    assert.ok(content.includes('explanation: q.explanation || null'), 'Returns explanation');
    assert.ok(content.includes('imageFileKey: q.imageFileKey || null'), 'Returns imageFileKey');
    assert.ok(content.includes('hasImage: q.imageFileKey != null'), 'Returns hasImage computed');
  });

  test('requires manage_assignments permission', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/route.ts', 'utf-8');
    assert.ok(content.includes("manage_assignments"), 'Requires manage_assignments');
  });
});

describe('admin assignment questions POST', () => {
  test('accepts explanation field', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/route.ts', 'utf-8');
    assert.ok(content.includes('safeText(body.explanation, 3000)'), 'Accepts explanation');
    assert.ok(content.includes('explanation'), 'INSERT includes explanation');
  });

  test('validates minimum options', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/route.ts', 'utf-8');
    assert.ok(content.includes('options.length < 2'), 'Validates min 2 options');
  });

  test('validates minimum question text length', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/route.ts', 'utf-8');
    assert.ok(content.includes('question.length < 3'), 'Validates min 3 chars');
  });

  test('requires same-origin', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Requires same-origin');
  });
});

describe('admin assignment question PATCH', () => {
  test('updates explanation field', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    assert.ok(content.includes('safeText(body.explanation ?? existing.explanation'), 'Updates explanation');
    assert.ok(content.includes('UPDATE assignment_questions SET'), 'Performs UPDATE');
  });

  test('validates question text length', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    assert.ok(content.includes('question.length < 3'), 'Validates min 3 chars');
  });

  test('validates minimum options', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    assert.ok(content.includes('options.length < 2'), 'Validates min 2 options');
  });

  test('requires same-origin', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Requires same-origin');
  });

  test('requires manage_assignments permission', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    assert.ok(content.includes("manage_assignments"), 'Requires manage_assignments');
  });
});

describe('admin assignment question DELETE', () => {
  test('requires same-origin', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('requireSameOrigin'), 'DELETE requires same-origin');
  });

  test('requires manage_assignments permission', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes("manage_assignments"), 'DELETE requires manage_assignments');
  });

  test('returns 204 on success', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('status: 204'), 'Returns 204');
  });
});

describe('admin assignment question image upload', () => {
  test('validates image MIME type', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/image/route.ts', 'utf-8');
    assert.ok(content.includes('isImageUpload'), 'Validates image upload');
    assert.ok(content.includes('MAX_IMAGE_SIZE'), 'Enforces size limit');
  });

  test('requires manage_assignments permission', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/image/route.ts', 'utf-8');
    assert.ok(content.includes("manage_assignments"), 'Requires manage_assignments');
  });

  test('requires same-origin for POST', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/image/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'POST requires same-origin');
  });

  test('stores at correct path', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/image/route.ts', 'utf-8');
    assert.ok(content.includes('assignments/${id}/questions/'), 'Stores at correct path');
  });

  test('deletes old image when replacing', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/image/route.ts', 'utf-8');
    assert.ok(content.includes('storage.delete(question.imageFileKey)'), 'Deletes old image');
  });

  test('DELETE clears image_file_key', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/[qId]/image/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('image_file_key = NULL'), 'DELETE clears image_file_key');
  });
});

describe('admin assignment question reorder', () => {
  test('requires same-origin', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/reorder/route.ts', 'utf-8');
    assert.ok(content.includes('requireSameOrigin'), 'Requires same-origin');
  });

  test('requires manage_assignments permission', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/reorder/route.ts', 'utf-8');
    assert.ok(content.includes("manage_assignments"), 'Requires manage_assignments');
  });

  test('validates order is array', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/reorder/route.ts', 'utf-8');
    assert.ok(content.includes('Array.isArray(body.order)'), 'Validates order is array');
  });

  test('updates sort_order atomically', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/questions/reorder/route.ts', 'utf-8');
    assert.ok(content.includes('db.batch(statements)'), 'Uses batch for atomicity');
    assert.ok(content.includes('SET sort_order'), 'Updates sort_order');
  });
});

describe('student assignment GET payload security', () => {
  test('masks explanation before submission', async () => {
    const content = await readFile('app/api/student/assignments/[id]/route.ts', 'utf-8');
    assert.ok(
      content.includes('hasSubmission ? (q.explanation || null) : null'),
      'Masks explanation when no submission'
    );
  });

  test('masks correctIndex before submission', async () => {
    const content = await readFile('app/api/student/assignments/[id]/route.ts', 'utf-8');
    assert.ok(
      content.includes('hasSubmission ? q.correctIndex : null'),
      'Masks correctIndex when no submission'
    );
  });

  test('computes hasImage from imageFileKey', async () => {
    const content = await readFile('app/api/student/assignments/[id]/route.ts', 'utf-8');
    assert.ok(
      content.includes('hasImage: q.imageFileKey != null'),
      'Computes hasImage from imageFileKey'
    );
  });

  test('never exposes imageFileKey in response', async () => {
    const content = await readFile('app/api/student/assignments/[id]/route.ts', 'utf-8');
    const getStart = content.indexOf('export async function GET');
    const responseStart = content.indexOf('return Response.json', getStart);
    const responseSection = content.slice(responseStart, responseStart + 500);
    assert.ok(
      !responseSection.includes('imageFileKey:') && !responseSection.includes('image_file_key:'),
      'Does not expose imageFileKey in response'
    );
  });

  test('includes sequence unlock check', async () => {
    const content = await readFile('app/api/student/assignments/[id]/route.ts', 'utf-8');
    assert.ok(content.includes('hasCourseItems'), 'Checks course sequence');
    assert.ok(content.includes('getCourseSequenceUnlockState'), 'Gets unlock state');
  });
});

describe('student assignment submit — explanation in response', () => {
  test('queries explanation from DB', async () => {
    const content = await readFile('app/api/student/assignments/[id]/submit/route.ts', 'utf-8');
    assert.ok(content.includes('explanation'), 'Queries explanation');
    assert.ok(content.includes('imageFileKey'), 'Queries imageFileKey for hasImage');
  });

  test('returns explanation for incorrect answers', async () => {
    const content = await readFile('app/api/student/assignments/[id]/submit/route.ts', 'utf-8');
    assert.ok(
      content.includes("explanation: isCorrect ? '' : (q.explanation || '')"),
      'Returns explanation for wrong answers only'
    );
  });

  test('computes hasImage from imageFileKey', async () => {
    const content = await readFile('app/api/student/assignments/[id]/submit/route.ts', 'utf-8');
    assert.ok(
      content.includes('q.imageFileKey != null'),
      'Computes hasImage from imageFileKey'
    );
  });
});

describe('admin assignment CRUD — staff auth', () => {
  test('admin assignment PATCH requires manage_assignments', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/route.ts', 'utf-8');
    assert.ok(content.includes("manage_assignments"), 'PATCH requires manage_assignments');
  });

  test('admin assignment DELETE requires manage_assignments', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes("manage_assignments"), 'DELETE requires manage_assignments');
  });

  test('admin assignment DELETE requires same-origin', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('requireSameOrigin'), 'DELETE requires same-origin');
  });

  test('admin assignment DELETE cleans up storage files', async () => {
    const content = await readFile('app/api/admin/assignments/[id]/route.ts', 'utf-8');
    const deleteStart = content.indexOf('export async function DELETE');
    const deleteSection = content.slice(deleteStart);
    assert.ok(deleteSection.includes('storage.delete'), 'DELETE cleans up storage');
  });
});
