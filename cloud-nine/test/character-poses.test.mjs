// Animations: every Contract 3 name exists, poses stay finite, one-shots end, tricks hop or spin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIM_NAMES, ANIM_GROUPS, ANIM_INFO, ANIM_IK, CH, NCH, evalAnim, isDone, hasAnim, locomotion, trickSpin } from '../js/art/character-poses.js';

const CONTRACT = [
  'idle', 'walk', 'run', 'jump', 'fall', 'land', 'wave', 'cheer', 'clap', 'sit', 'dance', 'aww',
  'throw', 'catch', 'dodge', 'frozen', 'tagged', 'seek', 'hide', 'base', 'cradle',
  'highV', 'lowV', 'tMotion', 'touchdown', 'daggers', 'punch', 'clasp',
  'toeTouch', 'pike', 'kickDouble', 'twist', 'liberty', 'heelStretch', 'scorpion', 'bowArrow', 'arabesque',
];
const state = (o = {}) => Object.assign({ t: 0, seed: 0.4, phase: 0, ground: true, move: 0, run: 0, m: 1 }, o);

test('every animation in Contract 3 exists, and nothing else is required', () => {
  for (const n of CONTRACT) assert.ok(hasAnim(n), n);
  assert.deepEqual([...ANIM_NAMES].sort(), [...CONTRACT].sort());
  assert.deepEqual(Object.values(ANIM_GROUPS).flat().sort(), [...CONTRACT].sort());
  for (const n of ['', 'nope', '__proto__', 'constructor', 'toString', null, 42]) assert.equal(hasAnim(n), false);
});

test('unknown names fall back to idle', () => {
  const a = new Float32Array(NCH), b = new Float32Array(NCH);
  evalAnim('definitely-not-an-anim', a, 1.3, state());
  evalAnim('idle', b, 1.3, state());
  assert.deepEqual([...a], [...b]);
});

test('every pose is finite at every moment, on the ground and in the air', () => {
  const p = new Float32Array(NCH);
  for (const n of ANIM_NAMES) {
    for (const ground of [true, false]) {
      for (let t = 0; t <= 4; t += 0.033) {
        evalAnim(n, p, t, state({ t, phase: t * 9, ground, move: 0.6, run: 0.4 }));
        for (let i = 0; i < NCH; i++) assert.ok(Number.isFinite(p[i]), `${n} t=${t.toFixed(2)} ch=${i}`);
        assert.ok(p[CH.ikL] >= 0 && p[CH.ikL] <= 1 && p[CH.ikR] >= 0 && p[CH.ikR] <= 1);
      }
    }
  }
});

test('metadata: loops, durations, faces and extras for other owners', () => {
  const faces = new Set(['smile', 'grin', 'happy', 'wow', 'aww']);
  for (const n of ANIM_NAMES) {
    const i = ANIM_INFO[n];
    assert.equal(typeof i.loop, 'boolean');
    assert.ok(i.duration > 0, n);
    assert.ok(faces.has(i.face), n);
    assert.ok(Object.isFrozen(i));
  }
  for (const n of ANIM_GROUPS.trick) assert.equal(ANIM_INFO[n].trick, true);
  for (const n of ['jump', 'land', 'throw', 'catch', 'dodge', 'tagged', 'aww', ...ANIM_GROUPS.trick]) assert.equal(ANIM_INFO[n].loop, false, n);
  for (const n of ['idle', 'walk', 'run', 'fall', 'frozen', 'seek', 'hide', 'base', 'cradle', ...ANIM_GROUPS.arm, ...ANIM_GROUPS.position]) assert.equal(ANIM_INFO[n].loop, true, n);
  assert.ok(ANIM_INFO.throw.release > 0.3 && ANIM_INFO.throw.release < 0.7);
  assert.ok(ANIM_INFO.cradle.hipY > 0.4);
  assert.ok(ANIM_INFO.sit.seatY > 0.3);
});

test('one-shots finish, loops never do unless asked to stop', () => {
  assert.equal(isDone('toeTouch', 0.2), false);
  assert.equal(isDone('toeTouch', ANIM_INFO.toeTouch.duration + 0.01), true);
  assert.equal(isDone('idle', 999), false);
  assert.equal(isDone('wave', 999), false);
  assert.equal(isDone('wave', 999, false), true);
  assert.equal(isDone('toeTouch', 999, true), false);
});

test('tricks jump on their own from the ground and stay in place in the air', () => {
  const p = new Float32Array(NCH);
  for (const n of ANIM_GROUPS.trick) {
    const mid = ANIM_INFO[n].duration * 0.55;
    evalAnim(n, p, mid, state({ ground: true }));
    assert.ok(p[CH.rootY] > 0.25, `${n} hops (${p[CH.rootY].toFixed(2)})`);
    evalAnim(n, p, mid, state({ ground: false }));
    assert.ok(Math.abs(p[CH.rootY]) < 0.05, `${n} in place in a toss`);
  }
});

test('the toe touch hits a level straddle with arms in a T', () => {
  const p = new Float32Array(NCH);
  evalAnim('toeTouch', p, ANIM_INFO.toeTouch.duration * 0.55, state());
  const el = (x, z) => Math.hypot(x, z);
  assert.ok(Math.abs(el(p[CH.lLx], p[CH.lLz]) - Math.PI / 2) < 0.3, 'left leg about level');
  assert.ok(Math.abs(el(p[CH.lRx], p[CH.lRz]) - Math.PI / 2) < 0.3, 'right leg about level');
  assert.ok(p[CH.lLx] > 1.1 && p[CH.lRx] > 1.1, 'straddled out to the sides');
  assert.ok(Math.abs(p[CH.aLx] - Math.PI / 2) < 0.2 && Math.abs(p[CH.aRx] - Math.PI / 2) < 0.2, 'arms in a T');
  assert.ok(p[CH.fL] > 0.6 && p[CH.fR] > 0.6, 'toes pointed');
});

test('twists and kick doubles never turn the whole body; they tell the caller how far to turn her', () => {
  const p = new Float32Array(NCH);
  for (const n of ['kickDouble', 'twist']) {
    for (const ground of [true, false]) {
      for (let u = 0; u <= 1.001; u += 0.05) {
        evalAnim(n, p, ANIM_INFO[n].duration * u, state({ ground }));
        assert.equal(p[CH.spin], 0, `${n} spin`);
        assert.equal(p[CH.yaw], 0, `${n} yaw`);
      }
    }
  }
  assert.equal(ANIM_INFO.kickDouble.turns, 2);
  assert.equal(ANIM_INFO.twist.turns, 1);
  assert.ok(Math.abs(trickSpin('kickDouble', 1) - 4 * Math.PI) < 1e-6 && trickSpin('kickDouble', 0) === 0);
  assert.ok(Math.abs(trickSpin('twist', 1, false) - 2 * Math.PI) < 1e-6);
  assert.equal(trickSpin('toeTouch', 0.5), 0);
  evalAnim('kickDouble', p, ANIM_INFO.kickDouble.duration * 0.33, state());
  assert.ok(Math.hypot(p[CH.lRx], p[CH.lRz]) > 2.5, 'a high kick first');
});

test('tricks hold their last pose; in the air that is a straight body, not idle', () => {
  const a = new Float32Array(NCH), b = new Float32Array(NCH), idle = new Float32Array(NCH);
  evalAnim('idle', idle, 0, state({ m: 0 }));
  for (const n of ANIM_GROUPS.trick) {
    const d = ANIM_INFO[n].duration;
    evalAnim(n, a, d, state({ ground: false }));
    evalAnim(n, b, d + 5, state({ ground: false }));
    assert.deepEqual([...a], [...b], n + ' holds');
    assert.ok(a[CH.fL] > 0.5 && a[CH.fR] > 0.5, n + ' toes still pointed');
    assert.ok(Math.hypot(a[CH.aLx], a[CH.aLz]) > 2, n + ' arms still up');
    assert.ok(Math.abs(a[CH.aLx] - idle[CH.aLx]) > 1, n + ' is not idle');
  }
});

test('arm motions are where cheerleaders put them', () => {
  const p = new Float32Array(NCH);
  const arm = (side) => (side === 'L' ? [p[CH.aLx], p[CH.aLz], p[CH.eL]] : [p[CH.aRx], p[CH.aRz], p[CH.eR]]);
  evalAnim('highV', p, 0.5, state());
  for (const s of ['L', 'R']) { const [x, , e] = arm(s); assert.ok(x > 2.1 && x < 2.8 && e < 0.2, 'high V ' + s); }
  evalAnim('lowV', p, 0.5, state());
  for (const s of ['L', 'R']) { const [x, , e] = arm(s); assert.ok(x > 0.35 && x < 0.9 && e < 0.2, 'low V ' + s); }
  evalAnim('tMotion', p, 0.5, state());
  for (const s of ['L', 'R']) { const [x] = arm(s); assert.ok(Math.abs(x - Math.PI / 2) < 0.15, 'T ' + s); }
  evalAnim('touchdown', p, 0.5, state());
  for (const s of ['L', 'R']) { const [x, z] = arm(s); assert.ok(Math.hypot(x, z) > 2.8, 'touchdown ' + s); }
  evalAnim('daggers', p, 0.5, state());
  for (const s of ['L', 'R']) { const [x, , e] = arm(s); assert.ok(x < 0.4 && e > 2.3, 'daggers ' + s); }
  evalAnim('punch', p, 0.5, state());
  assert.ok(Math.hypot(p[CH.aRx], p[CH.aRz]) > 2.8 && p[CH.eL] > 1.6, 'punch: one up, one on the hip');
  evalAnim('clasp', p, 0.5, state());
  assert.ok(p[CH.ikL] === 1 && p[CH.ikR] === 1 && ANIM_IK.clasp.armL && ANIM_IK.clasp.armR, 'hands meet');
});

test('body positions stand on one straight leg', () => {
  const p = new Float32Array(NCH);
  for (const n of ANIM_GROUPS.position) {
    evalAnim(n, p, 1, state());
    assert.ok(Math.abs(p[CH.kL]) < 0.05, n + ' standing knee straight');
    assert.ok(Math.abs(p[CH.lLz] - p[CH.pitch]) < 0.05, n + ' standing leg vertical');
  }
  evalAnim('heelStretch', p, 1, state());
  assert.ok(Math.hypot(p[CH.lRx], p[CH.lRz]) > 2.4 && p[CH.kR] < 0.05 && p[CH.ikR] === 1, 'heel stretch: leg straight up, held');
  evalAnim('arabesque', p, 1, state());
  assert.ok(p[CH.lRz] < -1.1 && p[CH.kR] < 0.05, 'arabesque: leg straight back');
  evalAnim('liberty', p, 1, state());
  assert.ok(p[CH.kR] > 1.6 && ANIM_IK.liberty.legR.bone === 'shinL', 'liberty: foot at the standing knee');
  evalAnim('scorpion', p, 1, state());
  assert.ok(p[CH.ikL] === 1 && p[CH.ikR] === 1 && ANIM_IK.scorpion.armL.bone === 'footR', 'scorpion: both hands on the foot');
  evalAnim('bowArrow', p, 1, state());
  assert.ok(Math.hypot(p[CH.lRx], p[CH.lRz]) > 2.4 && p[CH.aRx] < 0 && p[CH.eR] > 1, 'bow and arrow: leg up, arm drawn across');
});

test('locomotion blends idle, walk and run by speed', () => {
  const p = new Float32Array(NCH);
  locomotion(p, 1, state({ move: 0 }));
  const idleSwing = Math.abs(p[CH.lLz]);
  locomotion(p, 1, state({ move: 1, run: 0, phase: Math.PI / 2 }));
  const walkSwing = Math.abs(p[CH.lLz]);
  locomotion(p, 1, state({ move: 1, run: 1, phase: Math.PI / 2 }));
  const runSwing = Math.abs(p[CH.lLz]);
  assert.ok(idleSwing < 0.05 && walkSwing > 0.3 && runSwing > walkSwing);
  assert.ok(p[CH.pitch] > 0.1, 'leans into a run');
});
