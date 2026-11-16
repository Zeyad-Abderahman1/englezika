import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Admin AI hub and tools navigation', async (t) => {
  const nav = read('app/components/admin/shell/admin-navigation.ts');
  const desktop = read('app/components/admin/shell/AdminSidebar.tsx');
  const mobile = read('app/components/admin/shell/AdminMobileNav.tsx');

  await t.test('1-5. shared AI navigation group has its parent, children, and path expansion', () => {
    assert.match(nav, /label: 'الذكاء الاصطناعي'/);
    assert.match(nav, /href: '\/admin\/ai'/);
    assert.match(nav, /label: 'المساعد الذكي'[\s\S]*href: '\/admin\/ai\/assistant'/);
    assert.match(nav, /label: 'مولد الاختبارات من PDF'[\s\S]*href: '\/admin\/ai\/pdf-exam'/);
    assert.match(nav, /children:/);
    assert.match(nav, /isAdminNavItemActive/);
    assert.equal((desktop.match(/from '\.\/admin-navigation'/g) || []).length, 1);
    assert.equal((mobile.match(/from '\.\/admin-navigation'/g) || []).length, 1);
    for (const source of [desktop, mobile]) {
      assert.match(source, /item\.children/);
      assert.match(source, /isAdminNavItemActive/);
    }
  });

  await t.test('6-8. hub renders two linked active tool cards', () => {
    const hub = read('app/components/admin/ai/AIHub.tsx');
    assert.match(hub, /أدوات الذكاء الاصطناعي/);
    assert.match(hub, /المساعد الذكي/);
    assert.match(hub, /مولد الاختبارات من PDF/);
    assert.match(hub, /href: '\/admin\/ai\/assistant'/);
    assert.match(hub, /href: '\/admin\/ai\/pdf-exam'/);
  });

  await t.test('9-10. dedicated routes mount the existing assistant and one PDF tool', () => {
    const assistantPage = read('app/admin/ai/assistant/page.tsx');
    const pdfPage = read('app/admin/ai/pdf-exam/page.tsx');
    const assistant = read('app/components/admin/ai/AIAssistantWorkspace.tsx');
    assert.match(assistantPage, /<AIAssistantWorkspace/);
    assert.match(pdfPage, /<PdfAssessmentWorkspace/);
    assert.doesNotMatch(assistant, /generate-assessment/);
  });

  await t.test('11. PDF question count is constrained to backend maximum 30', () => {
    const pdf = read('app/components/admin/ai/PdfAssessmentWorkspace.tsx');
    assert.match(pdf, /QUESTION_COUNT_MAX = 30/);
    assert.match(pdf, /Math\.min\(QUESTION_COUNT_MAX/);
    assert.match(pdf, /max=\{QUESTION_COUNT_MAX\}/);
  });

  await t.test('12-13. deterministic preview validation controls insertion', () => {
    const preview = read('app/components/admin/ai/AssessmentPreviewModal.tsx');
    const pdf = read('app/components/admin/ai/PdfAssessmentWorkspace.tsx');
    assert.match(preview, /isAssessmentSubmissionAllowed\(questions\)/);
    assert.match(preview, /disabled=\{submitting \|\| !submissionCheck\.allowed\}/);
    assert.match(preview, /validateGeneratedQuestion\(q\)/);
    assert.match(pdf, /parameters: \{ courseId: effectiveCourseId, title, questions,/);
    assert.match(pdf, /key=\{assessment\.previewId\}/);
  });

  await t.test('14-15. teacher-facing PDF UI contains no provider or raw load codes', () => {
    const pdf = read('app/components/admin/ai/PdfAssessmentWorkspace.tsx');
    const messageRenderer = read('app/components/admin/ai/AssistantMessageContent.tsx');
    assert.doesNotMatch(pdf, /OpenRouter|Ollama|SYSTEM_LOAD_HIGH|HTTP 429|HTTP 500/i);
    assert.match(pdf, /تعذر توليد الأسئلة حاليًا/);
    assert.match(messageRenderer, /\{richText\}\{courseResults/);
  });

  await t.test('16. AI surfaces explicitly preserve RTL, mobile, focus, and reduced motion', () => {
    const hub = read('app/components/admin/ai/AIHub.tsx');
    const pdf = read('app/components/admin/ai/PdfAssessmentWorkspace.tsx');
    const css = read('app/components/admin/ai/ai-assistant.css');
    assert.match(hub, /dir="rtl"/);
    assert.match(pdf, /dir="rtl"/);
    assert.match(css, /@media \(max-width: 768px\)/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion: reduce/);
  });
});
