// Swipe recognition for basket toss tricks.
// Run with: node --test "cloud-nine/test/*.test.mjs"

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyStroke } from '../js/world/toss-swipe.js';

const SIZE = 390; // a phone's short side

// A straight stroke from (x0, y0) by (dx, dy) over ms, sampled at 120 Hz, with a little hand wobble.
function line(x0, y0, dx, dy, ms = 160, wobble = 3) {
  const pts = [];
  const n = Math.max(2, Math.round(ms / 8.3));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const w = Math.sin(u * 9) * wobble;
    pts.push([x0 + dx * u + (dy ? w : 0), y0 + dy * u + (dx ? w : 0), u * ms]);
  }
  return pts;
}

// A loop around (cx, cy) of radius r, starting at angle a0 and sweeping `sweep` radians (positive is
// clockwise on screen, where y grows downward). rx/ry make it an ellipse.
function loop(cx, cy, r, a0, sweep, ms = 420, ry = r) {
  const pts = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry, (ms * i) / n]);
  }
  return pts;
}

test('quick swipes in the four directions', () => {
  assert.deepEqual(classifyStroke(line(200, 500, 0, -160), { size: SIZE }), { gesture: 'up' });
  assert.deepEqual(classifyStroke(line(200, 300, 0, 160), { size: SIZE }), { gesture: 'down' });
  assert.deepEqual(classifyStroke(line(300, 400, -150, 0), { size: SIZE }), { gesture: 'left' });
  assert.deepEqual(classifyStroke(line(100, 400, 150, 0), { size: SIZE }), { gesture: 'right' });
});

test('messy diagonal swipes go to the stronger direction', () => {
  assert.equal(classifyStroke(line(200, 500, 40, -120), { size: SIZE }).gesture, 'up');
  assert.equal(classifyStroke(line(200, 300, -130, 70), { size: SIZE }).gesture, 'left');
  assert.equal(classifyStroke(line(200, 300, 100, 95), { size: SIZE }).gesture, 'right');
});

test('a short flick is still a swipe; a touch that barely moves is a tap', () => {
  assert.equal(classifyStroke(line(200, 400, 0, -40, 70, 0), { size: SIZE }).gesture, 'up');
  assert.deepEqual(classifyStroke(line(200, 400, 4, -5, 90, 0), { size: SIZE }), { gesture: 'tap' });
  assert.deepEqual(classifyStroke([[10, 10, 0]], { size: SIZE }), { gesture: 'tap' });
  assert.equal(classifyStroke(line(200, 400, 3, 3, 900, 0), { size: SIZE }), null, 'a long press is nothing');
});

test('slow drags are not tricks (a joystick or a camera drag)', () => {
  assert.equal(classifyStroke(line(100, 600, 0, -150, 1500), { size: SIZE }), null);
  assert.equal(classifyStroke(line(100, 600, 0, -150, 500), { size: SIZE, maxMs: 420 }), null, 'tighter limit in the stick zone');
  assert.equal(classifyStroke(line(100, 600, 0, -150, 300), { size: SIZE, maxMs: 420 }).gesture, 'up');
});

test('loops are circles, either way round, from any starting angle', () => {
  for (const a0 of [0, 1.3, Math.PI, -2]) {
    assert.deepEqual(classifyStroke(loop(200, 400, 60, a0, Math.PI * 2), { size: SIZE }), { gesture: 'circle', dir: 1 }, 'clockwise ' + a0);
    assert.deepEqual(classifyStroke(loop(200, 400, 60, a0, -Math.PI * 2), { size: SIZE }), { gesture: 'circle', dir: -1 }, 'anticlockwise ' + a0);
  }
  // most of a loop counts, an oval counts, and a slow careful loop counts
  assert.equal(classifyStroke(loop(200, 400, 60, 0, Math.PI * 1.6), { size: SIZE }).gesture, 'circle');
  assert.equal(classifyStroke(loop(200, 400, 80, 0.5, Math.PI * 2, 420, 45), { size: SIZE }).gesture, 'circle');
  assert.equal(classifyStroke(loop(200, 400, 60, 0, Math.PI * 2, 1600), { size: SIZE }).gesture, 'circle');
});

test('half a loop or a U-turn is not a circle', () => {
  const half = classifyStroke(loop(200, 400, 70, 0, Math.PI), { size: SIZE });
  assert.ok(!half || half.gesture !== 'circle');
  const u = [...line(150, 300, 0, 140, 120, 0), ...line(150, 440, 60, 0, 60, 0).map((p) => [p[0], p[1], p[2] + 120]), ...line(210, 440, 0, -140, 120, 0).map((p) => [p[0], p[1], p[2] + 180])];
  const r = classifyStroke(u, { size: SIZE });
  assert.ok(!r || r.gesture !== 'circle', 'a U is not a loop');
  // a tiny scribble is not a circle either
  const tiny = classifyStroke(loop(200, 400, 6, 0, Math.PI * 2, 200), { size: SIZE });
  assert.ok(!tiny || tiny.gesture !== 'circle');
});

test('nothing in, nothing out', () => {
  assert.equal(classifyStroke([]), null);
  assert.equal(classifyStroke(null), null);
  assert.equal(classifyStroke('swipe'), null);
});
