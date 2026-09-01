import assert from 'node:assert/strict';
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
