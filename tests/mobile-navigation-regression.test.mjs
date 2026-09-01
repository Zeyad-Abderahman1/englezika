import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  drawerPathAfterNavigation,
  drawerPathAfterToggle,
  isDrawerOpenForPathname,
} from '../app/lib/mobile-navigation-state.ts';

test('drawer closes when navigation leaves the pathname where it was opened', () => {
  const openedOnHome = drawerPathAfterToggle(null, '/');

  assert.equal(isDrawerOpenForPathname(openedOnHome, '/'), true);
  assert.equal(isDrawerOpenForPathname(openedOnHome, '/account'), false);
  assert.equal(isDrawerOpenForPathname(openedOnHome, '/login'), false);
});

test('drawer toggle and close state remain deterministic on one pathname', () => {
  const opened = drawerPathAfterToggle(null, '/courses');
  const closed = drawerPathAfterToggle(opened, '/courses');

  assert.equal(opened, '/courses');
  assert.equal(closed, null);
  assert.equal(isDrawerOpenForPathname(closed, '/courses'), false);
});

test('drawer stays closed when Forward returns to a pathname where it was previously open', () => {
  const openedOnHome = drawerPathAfterToggle(null, '/');
  const afterBack = drawerPathAfterNavigation(openedOnHome, '/account');
  const afterForward = drawerPathAfterNavigation(afterBack, '/');

  assert.equal(afterBack, null);
  assert.equal(afterForward, null);
  assert.equal(isDrawerOpenForPathname(afterForward, '/'), false);
});

test('Navbar uses isolated CSS module with deterministic mobile drawer tokens', () => {
  const navbarComponent = readFileSync(path.resolve('app/components/Navbar.tsx'), 'utf8');
  const navbarModuleCss = readFileSync(path.resolve('app/components/Navbar.module.css'), 'utf8');
  const globalsCss = readFileSync(path.resolve('app/globals.css'), 'utf8');

  // Verify Navbar imports and utilizes CSS module
  assert.match(navbarComponent, /import styles from '\.\/Navbar\.module\.css'/);
  assert.match(navbarComponent, /styles\.navMenu/);
  assert.match(navbarComponent, /styles\.navMenuOpen/);
  assert.match(navbarComponent, /styles\.siteHeader/);
  assert.match(navbarComponent, /styles\.navShell/);

  // Verify Navbar module defines isolated mobile drawer styles with dark/nav tokens
  assert.match(navbarModuleCss, /\.navMenu\s*\{/);
  assert.match(navbarModuleCss, /\.navMenuOpen\s*\{/);
  assert.match(navbarModuleCss, /background:\s*var\(--nav\)/);
  assert.match(navbarModuleCss, /border:\s*1px solid var\(--nav-border\)/);
  assert.match(navbarModuleCss, /border-radius:\s*16px/);

  // Guard against legacy globals.css overriding drawer background with fragile surface tokens
  assert.doesNotMatch(globalsCss, /\.nav-menu\s*\{[^}]*background:\s*var\(--surface\)/);
  assert.doesNotMatch(globalsCss, /\.nav-menu\s*\{[^}]*background:\s*#fff/);
});

