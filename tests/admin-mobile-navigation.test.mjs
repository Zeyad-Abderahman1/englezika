import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(rootDir, rel), 'utf8');
}

test('Admin Mobile Navigation Suite', async (t) => {
  await t.test('A. AdminMobileNav renders navigation items, not only its header', () => {
    const source = read('app/components/admin/shell/AdminMobileNav.tsx');
    assert.ok(source.includes('ADMIN_NAV_GROUPS'), 'Must import shared ADMIN_NAV_GROUPS');
    assert.ok(source.includes('admin-mobile-nav-body'), 'Must render nav body container');
    assert.ok(source.includes('admin-mobile-nav-group'), 'Must render nav groups');
    assert.ok(source.includes('admin-mobile-nav-item'), 'Must render nav items');
    assert.ok(source.includes('admin-mobile-nav-list'), 'Must render nav list');
  });

  await t.test('B. Mobile and desktop navigation use the same shared navigation source', () => {
    const mobileSource = read('app/components/admin/shell/AdminMobileNav.tsx');
    const sidebarSource = read('app/components/admin/shell/AdminSidebar.tsx');
    const sharedModule = read('app/components/admin/shell/admin-navigation.ts');

    assert.ok(mobileSource.includes("from './admin-navigation'"), 'Mobile nav must import from shared module');
    assert.ok(sidebarSource.includes("from './admin-navigation'"), 'Desktop sidebar must import from shared module');
    assert.ok(sharedModule.includes('ADMIN_NAV_GROUPS'), 'Shared module must export ADMIN_NAV_GROUPS');
    assert.ok(sharedModule.includes('NavGroup'), 'Shared module must export NavGroup type');
    assert.ok(sharedModule.includes('NavItem'), 'Shared module must export NavItem type');
  });

  await t.test('C. "المساعد الذكي" exists and points to /admin/ai when permission allows', () => {
    const navSource = read('app/components/admin/shell/admin-navigation.ts');
    assert.ok(navSource.includes("label: 'المساعد الذكي'"), 'Must have AI assistant label');
    assert.ok(navSource.includes("href: '/admin/ai'"), 'Must link to /admin/ai');
    assert.ok(navSource.includes('Sparkles'), 'Must use Sparkles icon');
    assert.ok(navSource.includes("permission: 'manage_courses'"), 'Must require manage_courses permission');
  });

  await t.test('D. Clicking a mobile nav link invokes drawer close behavior', () => {
    const source = read('app/components/admin/shell/AdminMobileNav.tsx');
    assert.ok(source.includes("onClick={() => setSidebarOpen(false)}"), 'Mobile nav items must close drawer on click');
  });

  await t.test('E. Permission-filtered items remain hidden', () => {
    const source = read('app/components/admin/shell/AdminMobileNav.tsx');
    assert.ok(source.includes('item.teacherOnly && !isTeacher'), 'Must filter teacherOnly items');
    assert.ok(source.includes('item.permission && !can(item.permission)'), 'Must filter by permission');
    assert.ok(source.includes("visibleItems.length === 0"), 'Must skip empty groups');
  });

  await t.test('F. Active route styling still works', () => {
    const source = read('app/components/admin/shell/AdminMobileNav.tsx');
    const navigationSource = read('app/components/admin/shell/admin-navigation.ts');
    assert.ok(source.includes('isActive'), 'Must compute active state');
    assert.ok(source.includes('isAdminNavItemActive'), 'Must use shared active-route matching');
    assert.ok(navigationSource.includes("href === '/admin'"), 'Must handle exact /admin match');
    assert.ok(navigationSource.includes('pathname.startsWith(`${href}/`)'), 'Must handle bounded prefix matching');
    assert.ok(source.includes("aria-current={pathname === item.href ? 'page'"), 'Must set aria-current for exact parent item');
  });

  await t.test('G. Topbar retains menu control, theme control, refresh control', () => {
    const source = read('app/components/admin/shell/AdminTopbar.tsx');
    assert.ok(source.includes('admin-hamburger-btn'), 'Must have hamburger button');
    assert.ok(source.includes('theme-toggle'), 'Must have theme toggle');
    assert.ok(source.includes('RefreshCw'), 'Must have refresh icon');
    assert.ok(source.includes('setSidebarOpen'), 'Must trigger sidebar open');
    assert.ok(source.includes('toggleTheme'), 'Must trigger theme toggle');
    assert.ok(source.includes('refreshData'), 'Must trigger data refresh');
  });

  await t.test('H. Old topbar AI assistant button remains absent', () => {
    const topbarSource = read('app/components/admin/shell/AdminTopbar.tsx');
    assert.ok(!topbarSource.includes('المساعد الذكي'), 'Topbar must NOT contain AI assistant button');
    assert.ok(!topbarSource.includes('setAiDrawerOpen'), 'Topbar must NOT reference setAiDrawerOpen');
  });

  await t.test('I. Mobile drawer supports scrollable navigation content', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('.admin-mobile-nav-body'), 'Must have mobile nav body class');
    assert.ok(cssSource.includes('overflow-y: auto'), 'Mobile nav body must be scrollable');
    assert.ok(cssSource.includes('-webkit-overflow-scrolling: touch'), 'Must support iOS momentum scrolling');
  });

  await t.test('J. CSS contains mobile-safe viewport behavior using 100dvh or equivalent', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('100dvh'), 'Must use 100dvh for mobile viewport');
    assert.ok(cssSource.includes('@supports (height: 100dvh)'), 'Must have 100dvh feature query fallback');
  });

  await t.test('K. Safe-area handling exists where required', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('safe-area-inset-top'), 'Must handle iPhone top safe area');
    assert.ok(cssSource.includes('safe-area-inset-bottom'), 'Must handle iPhone bottom safe area');
  });

  await t.test('L. No obvious mobile horizontal overflow rules are introduced', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('overflow-x: clip'), 'Admin layout must prevent horizontal overflow');
    assert.ok(cssSource.includes('max-width: 100vw'), 'Admin layout must not exceed viewport width');
  });

  await t.test('M. Desktop sidebar remains functional and unchanged in behavior', () => {
    const sidebarSource = read('app/components/admin/shell/AdminSidebar.tsx');
    assert.ok(sidebarSource.includes('admin-sidebar'), 'Desktop sidebar must use admin-sidebar class');
    assert.ok(sidebarSource.includes('admin-sidebar-header'), 'Must have sidebar header');
    assert.ok(sidebarSource.includes('admin-sidebar-nav'), 'Must have sidebar nav');
    assert.ok(sidebarSource.includes('admin-sidebar-footer'), 'Must have sidebar footer');
    assert.ok(sidebarSource.includes('admin-brand-icon'), 'Must have brand icon');
    assert.ok(sidebarSource.includes('admin-nav-badge'), 'Must support badge counts');
    assert.ok(sidebarSource.includes('handleLogout'), 'Must support logout');
  });

  await t.test('N. Mobile drawer opens from the right side (RTL)', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('justify-content: flex-end'), 'Container must justify drawer to end (right in RTL)');
    assert.ok(cssSource.includes('adminSlideInFromEnd'), 'Animation must slide from end');
    assert.ok(cssSource.includes('translateX(100%)'), 'Animation must translate from right');
  });

  await t.test('O. Mobile drawer width is min(86vw, 340px)', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('min(86vw, 340px)'), 'Drawer width must be min(86vw, 340px)');
  });

  await t.test('P. Mobile topbar is compact on small screens', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('.admin-topbar-page-identity'), 'Must have page identity that can be hidden');
    assert.ok(cssSource.includes('display: none'), 'Must hide elements on mobile');
  });

  await t.test('Q. Close button has proper touch target size', () => {
    const cssSource = read('app/admin.css');
    assert.ok(cssSource.includes('.admin-mobile-close-btn'), 'Close button must exist');
    assert.ok(cssSource.includes('min-width: 44px'), 'Close button must have min touch width');
    assert.ok(cssSource.includes('min-height: 44px'), 'Close button must have min touch height');
  });

  await t.test('R. Mobile drawer footer with user info and logout exists', () => {
    const mobileSource = read('app/components/admin/shell/AdminMobileNav.tsx');
    assert.ok(mobileSource.includes('admin-mobile-drawer-footer'), 'Must have drawer footer');
    assert.ok(mobileSource.includes('admin-mobile-logout-btn'), 'Must have mobile logout button');
    assert.ok(mobileSource.includes('admin-mobile-user-info'), 'Must show user info');
  });

  await t.test('S. AdminNavigation module contains all expected nav groups', () => {
    const navSource = read('app/components/admin/shell/admin-navigation.ts');
    const expectedGroups = [
      'الرئيسية',
      'المحتوى التعليمي',
      'الطلاب والمتابعة',
      'التواصل',
      'إدارة النظام',
    ];
    for (const group of expectedGroups) {
      assert.ok(navSource.includes(`'${group}'`), `Must include nav group: ${group}`);
    }

    const expectedItems = [
      'نظرة عامة',
      'الكورسات',
      'المحاضرات',
      'الامتحانات',
      'الواجبات',
      'المساعد الذكي',
      'الطلاب',
      'الاشتراكات',
      'النتائج والتصحيح',
      'الإعلانات',
      'الرسائل',
      'حسابات الفريق',
    ];
    for (const item of expectedItems) {
      assert.ok(navSource.includes(`'${item}'`), `Must include nav item: ${item}`);
    }
  });
});
