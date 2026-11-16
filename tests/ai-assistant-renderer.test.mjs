import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  extractCourseResults,
  parseAssistantText,
} from '../app/components/admin/ai/assistant-response.ts';

describe('AI assistant response presentation', () => {
  test('parses Arabic headings, bold text, lists, and inline code without HTML', () => {
    const blocks = parseAssistantText([
      '## ملخص الكورسات',
      '',
      'هذه **أهم النتائج** المتاحة:',
      '',
      '1. الكورس الأول',
      '2. الكورس الثاني مع `courseId`',
    ].join('\n'));

    assert.deepEqual(blocks, [
      { type: 'heading', content: [{ text: 'ملخص الكورسات' }] },
      {
        type: 'paragraph',
        content: [
          { text: 'هذه ' },
          { text: 'أهم النتائج', strong: true },
          { text: ' المتاحة:' },
        ],
      },
      {
        type: 'ordered-list',
        items: [
          [{ text: 'الكورس الأول' }],
          [{ text: 'الكورس الثاني مع ' }, { text: 'courseId', code: true }],
        ],
      },
    ]);
  });

  test('preserves unsupported plain text as a safe paragraph', () => {
    const text = '<script>alert("x")</script> استجابة عادية';
    assert.deepEqual(parseAssistantText(text), [
      { type: 'paragraph', content: [{ text }] },
    ]);
  });

  test('groups bullet lists and fenced code into readable blocks', () => {
    assert.deepEqual(parseAssistantText('- نقطة أولى\n- نقطة ثانية\n\n```json\n{"ok":true}\n```'), [
      {
        type: 'unordered-list',
        items: [[{ text: 'نقطة أولى' }], [{ text: 'نقطة ثانية' }]],
      },
      { type: 'code-block', text: '{"ok":true}', language: 'json' },
    ]);
  });

  test('extracts minimized structured course rows from read-only action results', () => {
    const result = extractCourseResults([
      {
        tool: 'list_courses',
        result: {
          result: {
            courses: [
              { id: 'c_secret', title: 'القواعد المتقدمة', grade: '3sec', status: 'published', price: 900 },
              { id: 'c_hidden', title: 'تأسيس اللغة', grade: null, status: 'draft' },
            ],
          },
        },
      },
    ]);

    assert.deepEqual(result, {
      title: 'الكورسات المتاحة',
      courses: [
        { title: 'القواعد المتقدمة', grade: '3sec', status: 'published', statusLabel: 'منشور' },
        { title: 'تأسيس اللغة', status: 'draft', statusLabel: 'مسودة' },
      ],
    });
    assert.equal(JSON.stringify(result).includes('c_secret'), false);
    assert.equal(JSON.stringify(result).includes('900'), false);
  });

  test('ignores unrelated or malformed action results', () => {
    assert.equal(extractCourseResults([{ tool: 'get_course', result: { result: {} } }]), null);
    assert.equal(extractCourseResults([{ tool: 'list_courses', result: { result: { courses: 'invalid' } } }]), null);
  });
});
