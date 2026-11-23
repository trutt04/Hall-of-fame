import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterpBuffer, createStateSender } from '../js/net/interp.js';
import { GAME } from '../js/config.js';

const S = (t, x, z, anim = 'walk', h = 0, y = 0) => ({ t, x, y, z, h, anim });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('interp: drawn GAME.interpDelayMs in the past, between the samples around that moment', () => {
  const buf = createInterpBuffer();
  buf.push(S(1000, 0, 0));
  buf.push(S(1100, 1, 2));
  buf.push(S(1200, 2, 4));
  const d = GAME.interpDelayMs;
  const a = buf.sample(1050 + d);
  assert.ok(near(a.x, 0.5) && near(a.z, 1), JSON.stringify(a));
  const b = buf.sample(1175 + d);
  assert.ok(near(b.x, 1.75) && near(b.z, 3.5), JSON.stringify(b));
  assert.deepEqual(buf.sample(900 + d), { x: 0, y: 0, z: 0, h: 0, anim: 'walk' }, 'before the first sample: the first one');
});

test('interp: headings turn the short way round', () => {
  const buf = createInterpBuffer({ delayMs: 0 });
  buf.push(S(0, 0, 0, 'walk', Math.PI - 0.1));
  buf.push(S(100, 0, 0, 'walk', -Math.PI + 0.1));
  const h = buf.sample(50).h;
  assert.ok(Math.abs(Math.abs(h) - Math.PI) < 1e-6, 'halfway is straight back, not through zero: ' + h);
});

test('interp: past the newest sample it keeps going briefly while moving, then holds', () => {
  const buf = createInterpBuffer({ delayMs: 0, maxExtrapMs: 150 });
  buf.push(S(0, 0, 0));
  buf.push(S(100, 1, 0));
  assert.ok(near(buf.sample(150).x, 1.5), 'extrapolates');
  assert.ok(near(buf.sample(250).x, 2.5), 'up to maxExtrapMs');
  assert.ok(near(buf.sample(5000).x, 2.5), 'then holds');
});

test('interp: a player standing still is never pushed forward', () => {
  const buf = createInterpBuffer({ delayMs: 0 });
  buf.push(S(0, 0, 0, 'walk'));
  buf.push(S(100, 1, 0, 'idle'));
  assert.equal(buf.sample(400).x, 1);
  const rest = createInterpBuffer({ delayMs: 0 });
  rest.push(S(0, 0, 0, 'walk'));
  rest.push(S(100, 1, 0, 'walk'));
  rest.push(S(200, 1, 0, 'walk')); // the sender's "rest" copy
  assert.equal(rest.sample(400).x, 1);
});

test('interp: teleports are not smeared across the map', () => {
  const buf = createInterpBuffer({ delayMs: 0, snapDist: 8 });
  buf.push(S(0, 0, 0));
  buf.push(S(100, 50, 0));
  assert.equal(buf.sample(50).x, 0);
  assert.equal(buf.sample(100).x, 50);
  assert.equal(buf.sample(300).x, 50, 'no extrapolation after a jump');
});

test('interp: late and repeated samples are dropped, old ones pruned, at least two kept', () => {
  const buf = createInterpBuffer({ delayMs: 0, size: 8 });
  assert.equal(buf.sample(0), null);
  assert.equal(buf.push(S(100, 1, 0)), true);
  assert.equal(buf.push(S(100, 9, 0)), false);
  assert.equal(buf.push(S(50, 9, 0)), false);
  assert.equal(buf.push({ t: NaN, x: 0, y: 0, z: 0 }), false);
  for (let i = 2; i < 40; i++) buf.push(S(i * 100, i, 0));
  assert.ok(buf.size <= 8);
  buf.sample(100000);
  assert.ok(buf.size >= 2);
  assert.equal(buf.latest().x, 39);
  const out = {};
  assert.equal(buf.sample(3850, out), out, 'fills the object it is given');
});

test('sender: throttled to GAME.netHz however often it is called', () => {
  const sent = [];
  const tx = createStateSender({ send: (s, t) => sent.push([t, s.x]) });
  for (let f = 0; f <= 60; f++) {
    const t = f * (1000 / 60);
    tx.update({ x: f * 0.1, y: 0, z: 0, h: 0, anim: 'walk' }, t);
    if (f % 6 === 0) tx.tick(t);
  }
  assert.ok(sent.length >= GAME.netHz - 1 && sent.length <= GAME.netHz + 2, sent.length + ' sends in a second');
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i][0] - sent[i - 1][0] >= 1000 / GAME.netHz - 2);
  assert.equal(sent[0][0], 0, 'the first one goes at once');
});

test('sender: skips what did not change, but sends one rest copy after a stop, then a slow keepalive', () => {
  const sent = [];
  const tx = createStateSender({ send: (s, t) => sent.push(t), keepaliveMs: 5000 });
  const still = { x: 1, y: 0, z: 1, h: 0, anim: 'idle' };
  tx.update({ x: 0, y: 0, z: 0, h: 0, anim: 'walk' }, 0);
  tx.update(still, 50);
  for (let t = 100; t <= 4000; t += 100) {
    tx.update({ ...still, x: still.x + (t % 200 ? 0.001 : 0) }, t); // jitter under the threshold
    tx.tick(t);
  }
  assert.deepEqual(sent, [0, 100, 200], 'the move, the stop, one rest copy, then quiet');
  tx.tick(5300);
  assert.equal(sent.length, 4, 'a keepalive after five quiet seconds');
});

test('sender: an anim change goes out even when standing still, and reset() sends again', () => {
  const sent = [];
  const tx = createStateSender({ send: (s) => sent.push(s.anim) });
  tx.update({ x: 0, y: 0, z: 0, h: 0, anim: 'idle' }, 0);
  tx.tick(100);
  tx.tick(200);
  tx.update({ x: 0, y: 0, z: 0, h: 0, anim: 'cheer' }, 250);
  tx.tick(400);
  tx.reset();
  tx.tick(500);
  assert.deepEqual(sent, ['idle', 'idle', 'cheer', 'cheer', 'cheer']);
});
