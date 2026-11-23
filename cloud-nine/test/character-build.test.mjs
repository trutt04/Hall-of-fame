// Geometry and runtime: triangle budgets for every option, valid skinning data, and the Contract 3
// character object (animations, looks, anchors, highlight, dispose). three.js runs fine under node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacter } from '../js/art/character-build.js';
import { BONES } from '../js/art/character-rig.js';
import { createCharacter, LOOK_OPTIONS, DEFAULT_LOOK, randomLook, ANIM_NAMES, ANIM_INFO } from '../js/art/character.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkGeometry(b, label) {
  const pos = b.body.attributes.position.array, si = b.body.attributes.skinIndex.array, sw = b.body.attributes.skinWeight.array;
  assert.equal(pos.length / 9, b.tris, label);
  for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), label + ' finite');
  for (let v = 0; v < si.length / 4; v++) {
    const w = sw[v * 4] + sw[v * 4 + 1] + sw[v * 4 + 2] + sw[v * 4 + 3];
    assert.ok(Math.abs(w - 1) < 1e-4, label + ' weights sum to 1');
    for (let k = 0; k < 4; k++) assert.ok(si[v * 4 + k] < BONES.length, label + ' bone index');
  }
  // feet on the ground, about 1.45 m tall (the bow and the pony go a little higher)
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
  assert.ok(Math.abs(minY) < 0.01, label + ' feet at y = 0');
  assert.ok(maxY > 1.35 && maxY < 2.0, label + ' height ' + maxY.toFixed(2));
}

test('every option builds within budget at both qualities', () => {
  let maxHigh = 0, maxLow = 0, sumHigh = 0, sumLow = 0, n = 0;
  for (const slot of Object.keys(LOOK_OPTIONS)) {
    for (const o of LOOK_OPTIONS[slot]) {
      const look = { ...DEFAULT_LOOK, [slot]: o.id };
      const hi = buildCharacter(look, 'high'), lo = buildCharacter(look, 'low');
      checkGeometry(hi, `${slot}=${o.id} high`);
      checkGeometry(lo, `${slot}=${o.id} low`);
      maxHigh = Math.max(maxHigh, hi.tris); maxLow = Math.max(maxLow, lo.tris);
      sumHigh += hi.tris; sumLow += lo.tris; n++;
    }
  }
  assert.ok(sumHigh / n < 3300, 'about 3k triangles at high: ' + Math.round(sumHigh / n));
  assert.ok(sumLow / n < 1700, 'about 1.5k triangles at low: ' + Math.round(sumLow / n));
  assert.ok(maxHigh < 3700 && maxLow < 1950, `worst single option ${maxHigh} / ${maxLow}`);
});

test('random looks stay within budget', () => {
  const r = seeded(3);
  for (let i = 0; i < 60; i++) {
    const look = randomLook(r);
    assert.ok(buildCharacter(look, 'high').tris < 4000);
    assert.ok(buildCharacter(look, 'low').tris < 2100);
  }
});

test('sparkle level controls the glints', () => {
  const none = buildCharacter({ ...DEFAULT_LOOK, sparkle: 'none' });
  const some = buildCharacter({ ...DEFAULT_LOOK, sparkle: 'some' });
  const max = buildCharacter({ ...DEFAULT_LOOK, sparkle: 'max' });
  assert.equal(none.glints, null);
  const count = (b) => b.glints.attributes.position.count / 6;
  assert.ok(count(some) >= 3 && count(some) < count(max), `${count(some)} < ${count(max)}`);
});

test('createCharacter follows Contract 3', () => {
  const c = createCharacter();
  assert.ok(c.group && c.group.isObject3D);
  for (const k of ['handL', 'handR', 'head', 'back']) assert.ok(c.anchors[k] && c.anchors[k].isObject3D, k);
  assert.deepEqual(c.getLook(), { ...DEFAULT_LOOK });
  for (const n of ANIM_NAMES) {
    c.setAnim(n);
    assert.equal(c.anim, n);
    for (let i = 0; i < 20; i++) c.update(1 / 30, i / 30);
  }
  c.setAnim('not-a-real-anim');
  assert.equal(c.anim, 'idle');
  c.setSpeed(4);
  c.setAnim('run');
  for (let i = 0; i < 30; i++) c.update(1 / 30, 1 + i / 30);
  // nothing in the scene graph went NaN
  c.group.updateMatrixWorld(true);
  c.group.traverse((o) => {
    for (const v of o.matrixWorld.elements) assert.ok(Number.isFinite(v), o.name);
  });
  c.dispose();
});

test('one-shots report animDone; tricks know when she is airborne', () => {
  const c = createCharacter(DEFAULT_LOOK, { quality: 'low' });
  c.setAnim('toeTouch');
  assert.equal(c.airborne, false);
  for (let t = 0; t < ANIM_INFO.toeTouch.duration + 0.1; t += 1 / 30) c.update(1 / 30, t);
  assert.equal(c.animDone, true);
  c.setAnim('jump');
  assert.equal(c.airborne, true);
  c.setAnim('kickDouble');
  assert.equal(c.airborne, true, 'a trick from a jump plays in place');
  c.setAnim('land');
  assert.equal(c.airborne, false);
  c.setAnim('twist', { air: true });
  assert.equal(c.airborne, true);
  c.dispose();
});

test('setLook cleans its input, rebuilds only on change, and keeps anchors attached', () => {
  const c = createCharacter({ bow: 'gold', top: 'nonsense' });
  assert.equal(c.getLook().bow, 'gold');
  assert.equal(c.getLook().top, DEFAULT_LOOK.top);
  const body = c.group.children.find((o) => o.name === 'cheerleader-body');
  c.setLook({ ...c.getLook() });
  assert.equal(c.group.children.find((o) => o.name === 'cheerleader-body'), body, 'same look: no rebuild');
  const hand = c.anchors.handR;
  c.setLook({ ...DEFAULT_LOOK, hairStyle: 'bob', bowSize: 'ridiculous', bottom: 'skirt-pink' });
  assert.notEqual(c.group.children.find((o) => o.name === 'cheerleader-body'), body, 'new look: rebuilt');
  assert.equal(c.anchors.handR, hand, 'same anchor object');
  let parent = hand.parent, attached = false;
  while (parent) { if (parent === c.group) attached = true; parent = parent.parent; }
  assert.ok(attached, 'anchor still under the character');
  c.setLook('garbage');
  assert.deepEqual(c.getLook(), { ...DEFAULT_LOOK });
  c.dispose();
});

test('a toss can hide her ground shadow, and tricks never yaw her hips', () => {
  const c = createCharacter();
  const shadows = c.group.children.filter((o) => o.name === 'blob' || o.name.includes('shadow'));
  assert.deepEqual(shadows, [c.shadow]);
  c.setAnim('jump');
  c.setAnim('kickDouble');
  let maxYaw = 0;
  const hips = c.group.getObjectByName('hips');
  for (let t = 0; t < 1.5; t += 1 / 30) {
    c.update(1 / 30, t);
    const e = hips.rotation;
    maxYaw = Math.max(maxYaw, Math.abs(e.y));
  }
  assert.ok(maxYaw < 0.2, 'no whole-body spin (' + maxYaw.toFixed(2) + ')');
  // carried upward fast (a toss): a trick started now plays in place, without asking
  const d = createCharacter();
  for (let i = 0; i < 10; i++) { d.group.position.y += 0.3; d.update(1 / 30, i / 30); }
  d.setAnim('toeTouch');
  assert.equal(d.airborne, true);
  c.dispose();
  d.dispose();
});

test('setHighlight accepts colours and ignores junk', () => {
  const c = createCharacter();
  c.setHighlight(true, 0x7b5cff);
  c.update(1 / 30, 1);
  c.setHighlight(true, '#ff2e93');
  c.setHighlight(true, 'javascript:alert(1)');
  c.setHighlight(true, { evil: true });
  c.update(1 / 30, 1.1);
  const ring = c.group.children.find((o) => o.name === 'highlight-ring');
  assert.ok(ring && ring.visible);
  c.setHighlight(false);
  assert.equal(ring.visible, false);
  c.dispose();
  c.dispose(); // twice is fine
  c.update(1 / 30, 2); // and so is updating a disposed character
});
