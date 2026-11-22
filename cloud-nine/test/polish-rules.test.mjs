// Release polish: the held-toast queue (js/ui/hud.js) and the toss button's hysteresis over the base
// spots (js/world/toss.js). Pure parts only, so it runs under node --test with no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueToast, MAX_HELD, TOAST_GAP_MS } from '../js/ui/hud.js';
import { SPOT_SETTLE, settleOnSpot } from '../js/world/toss.js';
import { TOSS, matchSpots } from '../js/world/toss-rules.js';

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

// Walk in a straight line at `speed` m/s from (x0, 0) to (x1, 0) over a pad at the origin, and
// replay the offer rule frame by frame: on the mat, and not basing on a spot.
function walk(x0, x1, speed, { dt = 1 / 60, stopFor = 0 } = {}) {
  const spots = [{ x: TOSS.spotDist, y: 0, z: 0 }, { x: -TOSS.spotDist, y: 0, z: 0 }, { x: 0, y: 0, z: TOSS.spotDist }, { x: 0, y: 0, z: -TOSS.spotDist }];
  const offers = [];
  let t = 0;
  let x = x0;
  let stopped = 0;
  const dir = Math.sign(x1 - x0);
  for (let k = 0; k < 2000; k++) {
    const onMat = Math.abs(x) <= TOSS.padRadius;
    const onSpot = matchSpots(spots, [{ id: 'me', x, y: 0, z: 0 }]).taken.includes('me');
    t = settleOnSpot(t, onSpot, dt);
    offers.push(onMat && !(onSpot && t >= SPOT_SETTLE));
    if ((x - x1) * dir >= 0) {
      if (stopped >= stopFor) break;
      stopped += dt;
      continue;
    }
    x += dir * speed * dt;
  }
  return offers;
}
const flips = (offers) => offers.reduce((n, v, i) => n + (i && v !== offers[i - 1] ? 1 : 0), 0);

test('walking onto the mat across a base spot: "Basket toss!" comes up once and stays', () => {
  for (const speed of [2.6, 4.5, 7.2]) {
    const offers = walk(2.6, 0, speed);
    assert.equal(offers[0], false, 'off the mat at first');
    assert.equal(offers[offers.length - 1], true, 'offered in the middle of the mat');
    assert.equal(flips(offers), 1, speed + ' m/s: shows once, never hides and shows again');
  }
  // and walking off it the other way over a spot: it goes once, as she steps off the mat
  assert.equal(flips(walk(0, 2.6, 2.6)), 1);
});

test('standing still on a base spot is basing: the button steps aside, and comes back off the spot', () => {
  const offers = walk(2.6, TOSS.spotDist, 2.6, { stopFor: 2 });
  assert.equal(offers[offers.length - 1], false, 'she is a base now, no toss button');
  assert.equal(flips(offers), 2, 'up once on the mat, then down once she settles on the spot');
  assert.ok(SPOT_SETTLE >= 0.5 && SPOT_SETTLE <= 1, 'settles in about half a second (' + SPOT_SETTLE + ')');
  assert.equal(settleOnSpot(1.2, false, 0.016), 0, 'stepping off resets it');
});
