import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('AI Assistant Navigation & Admin Page Suite', async (t) => {
  await t.test('1. Sidebar contains "المساعد الذكي" pointing to /admin/ai with manage_courses permission', () => {
    const sidebarSource = fs.readFileSync(path.join(rootDir, 'app/components/admin/shell/AdminSidebar.tsx'), 'utf8');

    assert.ok(sidebarSource.includes('label: \'المساعد الذكي\''), 'Sidebar must contain label "المساعد الذكي"');
    assert.ok(sidebarSource.includes('href: \'/admin/ai\''), 'Sidebar must contain route /admin/ai');
    assert.ok(sidebarSource.includes('Sparkles'), 'Sidebar must use Sparkles icon for AI Assistant');
    assert.ok(sidebarSource.includes('permission: \'manage_courses\''), 'AI Assistant nav item must require manage_courses permission');
  });

  await t.test('2. Sidebar active state correctly resolves for /admin/ai', () => {
    const sidebarSource = fs.readFileSync(path.join(rootDir, 'app/components/admin/shell/AdminSidebar.tsx'), 'utf8');
    assert.ok(sidebarSource.includes("item.href === '/admin'"), 'Exact check for /admin root must be present');
    assert.ok(sidebarSource.includes('pathname.startsWith(item.href)'), 'Prefix check for subroutes must be present');

    // Replicate AdminSidebar active matching logic:
    const pathname = '/admin/ai';
    const isDashboardActive = '/admin' === '/admin' ? pathname === '/admin' : pathname.startsWith('/admin');
    const isAiActive = '/admin/ai' === '/admin' ? pathname === '/admin' : pathname.startsWith('/admin/ai');
    const isCoursesActive = '/admin/courses' === '/admin' ? pathname === '/admin' : pathname.startsWith('/admin/courses');

    assert.equal(isDashboardActive, false, 'Dashboard must NOT be active when on /admin/ai');
    assert.equal(isAiActive, true, 'AI nav item must be active when on /admin/ai');
    assert.equal(isCoursesActive, false, 'Courses nav item must NOT be active when on /admin/ai');
  });

  await t.test('3. Topbar "المساعد الذكي" button is removed from AdminTopbar.tsx', () => {
    const topbarSource = fs.readFileSync(path.join(rootDir, 'app/components/admin/shell/AdminTopbar.tsx'), 'utf8');
    assert.ok(!topbarSource.includes('المساعد الذكي'), 'AdminTopbar must NOT contain "المساعد الذكي" button');
    assert.ok(!topbarSource.includes('setAiDrawerOpen'), 'AdminTopbar must NOT reference setAiDrawerOpen');
  });

  await t.test('4. AIAssistantDrawer is removed from AdminShell.tsx', () => {
    const shellSource = fs.readFileSync(path.join(rootDir, 'app/components/admin/shell/AdminShell.tsx'), 'utf8');
    assert.ok(!shellSource.includes('<AIAssistantDrawer'), 'AdminShell must NOT render AIAssistantDrawer');
    assert.ok(!shellSource.includes('aiDrawerOpen'), 'AdminShell must NOT contain aiDrawerOpen state');
  });

  await t.test('5. Dedicated /admin/ai page route exists and is protected with PermissionGate', () => {
    const pagePath = path.join(rootDir, 'app/admin/ai/page.tsx');
    assert.ok(fs.existsSync(pagePath), 'app/admin/ai/page.tsx must exist');

    const pageSource = fs.readFileSync(pagePath, 'utf8');
    assert.ok(pageSource.includes('AIAssistantWorkspace'), 'app/admin/ai/page.tsx must render AIAssistantWorkspace');
    assert.ok(pageSource.includes('PermissionGate'), 'app/admin/ai/page.tsx must use PermissionGate');
    assert.ok(pageSource.includes('permission="manage_courses"'), 'PermissionGate must enforce manage_courses');
    assert.ok(pageSource.includes('المساعد الذكي'), 'Page metadata must mention המساعد الذكي');
  });

  await t.test('6. AIAssistantWorkspace contains all essential AI features and tabs', () => {
    const workspacePath = path.join(rootDir, 'app/components/admin/ai/AIAssistantWorkspace.tsx');
    assert.ok(fs.existsSync(workspacePath), 'AIAssistantWorkspace.tsx must exist');

    const workspaceSource = fs.readFileSync(workspacePath, 'utf8');
    // Tabs
    assert.ok(workspaceSource.includes('المحادثة والأوامر الذكية'), 'Workspace must include chat tab');
    assert.ok(workspaceSource.includes('توليد امتحان من PDF'), 'Workspace must include PDF assessment tab');

    // Chat features
    assert.ok(workspaceSource.includes('CompoundPlanCard'), 'Workspace must render CompoundPlanCard');
    assert.ok(workspaceSource.includes('AssessmentPreviewModal'), 'Workspace must render AssessmentPreviewModal');
    assert.ok(workspaceSource.includes('handleCancel'), 'Workspace must support aborting/cancelling generation');
    assert.ok(workspaceSource.includes('ai-quick-chip'), 'Workspace must include quick prompt chips');

    // PDF features
    assert.ok(workspaceSource.includes('ai-dropzone'), 'Workspace must include PDF dropzone');
    assert.ok(workspaceSource.includes('difficulty'), 'Workspace must include difficulty selector');
    assert.ok(workspaceSource.includes('questionCount'), 'Workspace must include question count');
  });

  await t.test('7. AI APIs and confirmation flow are preserved without modification', () => {
    const workspaceSource = fs.readFileSync(path.join(rootDir, 'app/components/admin/ai/AIAssistantWorkspace.tsx'), 'utf8');
    assert.ok(workspaceSource.includes('/api/admin/ai/chat'), 'Must call /api/admin/ai/chat');
    assert.ok(workspaceSource.includes('/api/admin/ai/execute'), 'Must call /api/admin/ai/execute');
    assert.ok(workspaceSource.includes('/api/admin/ai/upload'), 'Must call /api/admin/ai/upload');
    assert.ok(workspaceSource.includes('/api/admin/ai/generate-assessment'), 'Must call /api/admin/ai/generate-assessment');
    assert.ok(workspaceSource.includes('/api/admin/ai/prepare-confirmation'), 'Must call /api/admin/ai/prepare-confirmation');
    assert.ok(workspaceSource.includes('/api/admin/ai/status'), 'Must check /api/admin/ai/status');
  });

  await t.test('8. Safe disabled-AI fallback does not leak technical internals or secrets', () => {
    const workspaceSource = fs.readFileSync(path.join(rootDir, 'app/components/admin/ai/AIAssistantWorkspace.tsx'), 'utf8');
    assert.ok(workspaceSource.includes('خدمة المساعد الذكي غير مفعلة حالياً'), 'Must render safe disabled message');
    assert.ok(!workspaceSource.includes('OLLAMA'), 'Must not leak OLLAMA in client code');
    assert.ok(!workspaceSource.includes('LOCAL_AI_ENDPOINT'), 'Must not leak LOCAL_AI_ENDPOINT');
    assert.ok(!workspaceSource.includes('AI_CONFIRMATION_SECRET'), 'Must not leak AI_CONFIRMATION_SECRET');
  });

  await t.test('9. No browser-side direct Ollama endpoint usage', () => {
    const workspaceSource = fs.readFileSync(path.join(rootDir, 'app/components/admin/ai/AIAssistantWorkspace.tsx'), 'utf8');
    assert.ok(!workspaceSource.includes('11434'), 'Must not call Ollama port directly');
    assert.ok(!workspaceSource.includes('localhost:11434'), 'Must not call localhost:11434');
    assert.ok(!workspaceSource.includes('127.0.0.1:11434'), 'Must not call 127.0.0.1:11434');
  });

  await t.test('10. AIAssistantDrawer delegates to AIAssistantWorkspace for backward compatibility', () => {
    const drawerPath = path.join(rootDir, 'app/components/admin/ai/AIAssistantDrawer.tsx');
    assert.ok(fs.existsSync(drawerPath), 'AIAssistantDrawer.tsx must exist for compatibility');

    const drawerSource = fs.readFileSync(drawerPath, 'utf8');
    assert.ok(drawerSource.includes('AIAssistantWorkspace'), 'AIAssistantDrawer must delegate to AIAssistantWorkspace');
  });
});
