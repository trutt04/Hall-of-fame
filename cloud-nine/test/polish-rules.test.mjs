// Release polish: the held-toast queue (js/ui/hud.js). Pure parts only, so it runs under node --test
// with no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueToast, MAX_HELD, TOAST_GAP_MS } from '../js/ui/hud.js';

const item = (text) => ({ text, ms: 2600 });

test('held toasts keep their order, and nothing waits twice', () => {
  const q = [];
  assert.equal(queueToast(q, item('Ava joined!')), null);
  assert.equal(queueToast(q, item('The host locked the room for this game.')), null);
  assert.equal(queueToast(q, item('You are the host now! You pick the games.')), null);
  assert.deepEqual(q.map((h) => h.text), ['Ava joined!', 'The host locked the room for this game.', 'You are the host now! You pick the games.']);
  // the same news again: one copy, at the back (the latest moment it happened)
  assert.equal(queueToast(q, item('Ava joined!')), null);
  assert.deepEqual(q.map((h) => h.text), ['The host locked the room for this game.', 'You are the host now! You pick the games.', 'Ava joined!']);
});

test('a long wait never piles up: past MAX_HELD the oldest leaves the queue', () => {
  const q = [];
  const out = [];
  for (let i = 0; i < MAX_HELD + 3; i++) {
    const left = queueToast(q, item('Friend ' + i + ' joined!'));
    if (left) out.push(left.text);
  }
  assert.equal(q.length, MAX_HELD);
  assert.deepEqual(out, ['Friend 0 joined!', 'Friend 1 joined!', 'Friend 2 joined!']);
  assert.equal(q[0].text, 'Friend 3 joined!');
  assert.equal(q[q.length - 1].text, 'Friend ' + (MAX_HELD + 2) + ' joined!');
});

test('released toasts come far enough apart to read, three on screen at most', () => {
  // each toast stays 2.6 s by default; at this gap no more than three overlap, so none is pushed off early
  assert.ok(TOAST_GAP_MS >= 2600 / 3, 'gap ' + TOAST_GAP_MS);
  assert.ok(TOAST_GAP_MS <= 1500, 'gap ' + TOAST_GAP_MS + ' (a queue of six still clears in a few seconds)');
});
