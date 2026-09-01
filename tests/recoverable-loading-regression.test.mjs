import assert from 'node:assert/strict';
import test from 'node:test';

import {
  replaceAbortController,
  runRecoverableLoad,
} from '../app/lib/recoverable-load.ts';

function createLoadState() {
  return { loading: true, data: null, error: '' };
}

async function runLoad(state, task, fallbackMessage) {
  state.loading = true;
  state.error = '';
  await runRecoverableLoad(task, {
    fallbackMessage,
    onSuccess(value) {
      state.data = value;
    },
    onError(message) {
      state.error = message;
    },
    onSettled() {
      state.loading = false;
    },
  });
}

test('dashboard rejected initialization settles into a recoverable error state', async () => {
  const state = createLoadState();

  await runLoad(
    state,
    () => Promise.reject(new TypeError('Failed to fetch')),
    'تعذر تحميل مساحتك التعليمية'
  );

  assert.equal(state.loading, false);
  assert.equal(state.data, null);
  assert.equal(state.error, 'تعذر تحميل مساحتك التعليمية');
});

test('quiz rejected initialization settles and a retry can recover', async () => {
  const state = createLoadState();

  await runLoad(
    state,
    () => Promise.reject(new Error('تعذر بدء الامتحان')),
    'تعذر تجهيز الامتحان'
  );

  assert.equal(state.loading, false);
  assert.equal(state.error, 'تعذر بدء الامتحان');

  await runLoad(
    state,
    () => Promise.resolve({ exam: { id: 'qa-mobile-exam' } }),
    'تعذر تجهيز الامتحان'
  );

  assert.equal(state.loading, false);
  assert.equal(state.error, '');
  assert.deepEqual(state.data, { exam: { id: 'qa-mobile-exam' } });
});

test('an aborted load stays silent and does not publish stale state', async () => {
  const controller = new AbortController();
  const state = createLoadState();
  controller.abort();

  await runRecoverableLoad(() => Promise.reject(new Error('aborted request')), {
    signal: controller.signal,
    fallbackMessage: 'تعذر التحميل',
    onSuccess(value) {
      state.data = value;
    },
    onError(message) {
      state.error = message;
    },
    onSettled() {
      state.loading = false;
    },
  });

  assert.equal(state.loading, true);
  assert.equal(state.error, '');
  assert.equal(state.data, null);
});

test('starting a retry aborts the previous in-flight request', () => {
  const previous = new AbortController();

  const next = replaceAbortController(previous);

  assert.equal(previous.signal.aborted, true);
  assert.equal(next.signal.aborted, false);
  assert.notEqual(next, previous);
});
