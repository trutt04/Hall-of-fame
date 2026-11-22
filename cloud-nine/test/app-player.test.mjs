// APP: js/world/player.js on the stand-in island, headless. Hops, landings, walking off the edge
// (never a death: a cloud floats you home), takeControl, slides, and the network state.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.min.js';
import { createPlayer, JUMP_SPEED } from '../js/world/player.js';
import { buildIsland, makeGroundAt, ISLAND_RADIUS } from '../js/world/fallback-island.js';
import { createColliders } from '../js/core/colliders.js';

function setup() {
  const scene = new THREE.Scene();
  const colliders = createColliders();
  const island = buildIsland({ scene, quality: 'low', colliders });
  const move = { x: 0, y: 0 };
  const input = { getMove(out) { out.x = move.x; out.y = move.y; return out; } };
  const events = [];
  const player = createPlayer({
    scene, groundAt: island.groundAt, platforms: island.platforms, slides: island.places.slides, colliders, input,
    rig: null, audio: { sfx: (n) => events.push('sfx:' + n) }, hud: null, home: () => island.places.plaza,
  });
  for (const e of ['jump', 'land', 'rescue', 'rescued']) player.on(e, () => events.push(e));
  let t = 0;
  const run = (seconds, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      t += dt;
      player.update(dt, t);
    }
  };
  return { scene, island, player, move, events, run };
}

test('a hop goes up about a meter and comes back down to land', () => {
  const { player, island, run, events } = setup();
  const p = island.places.plaza;
  player.place(p.x, p.z, 0);
  run(0.1);
  assert.equal(player.grounded, true);
  assert.equal(player.jump(), true);
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    run(1 / 60);
    peak = Math.max(peak, player.position.y);
  }
  assert.ok(peak > 0.95 && peak < 1.4, 'peak ' + peak);
  assert.equal(player.grounded, true);
  assert.equal(player.position.y, 0);
  assert.ok(events.includes('jump'));
  assert.ok(events.includes('land'));
  assert.ok(JUMP_SPEED > 0);
});

test('no double jumps in the air, but a jump pressed just before landing still happens', () => {
  const { player, island, run } = setup();
  player.place(island.places.plaza.x, island.places.plaza.z, 0);
  run(0.1);
  player.jump();
  run(0.15);
  assert.equal(player.jump(), false, 'already in the air');
  // fall back toward the ground and press jump a moment before touching down
  for (let i = 0; i < 120 && !(player.velocity.y < 0 && player.position.y < 0.25); i++) run(1 / 60);
  player.jump();
  run(0.1);
  assert.ok(player.position.y > 0.05 || player.velocity.y > 0, 'the buffered jump fired on landing');
});

test('walking off the edge: a gentle fall, a cloud catch, a ride home, never a death', () => {
  const { player, island, run, move, events } = setup();
  player.place(ISLAND_RADIUS - 2, 0, Math.PI / 2);
  run(0.1);
  // walk east (with no camera rig, "forward" on the stick is -Z, so push right: +X)
  move.x = 1;
  let rescued = false;
  for (let i = 0; i < 60 * 4 && !player.rescuing; i++) run(1 / 60);
  move.x = 0;
  assert.equal(player.rescuing, true, 'the cloud came');
  assert.ok(events.includes('rescue'));
  assert.ok(player.position.y > -20, 'caught well before falling far: ' + player.position.y);
  assert.equal(player.getState().anim === 'fall' || player.getState().anim === 'sit', true);
  for (let i = 0; i < 60 * 10 && !rescued; i++) {
    run(1 / 60);
    rescued = !player.rescuing && player.grounded;
  }
  assert.equal(rescued, true);
  const home = island.places.plaza;
  assert.ok(Math.hypot(player.position.x - home.x, player.position.z - home.z) < 1.5, 'back at the plaza');
  assert.equal(player.position.y, 0);
  assert.ok(events.includes('rescued'));
});

test('rescueTo sends the cloud somewhere else (a game arena)', () => {
  const { player, island, run } = setup();
  const court = island.places.court;
  player.rescueTo = { x: court.x, z: court.z, facing: 0 };
  player.place(100, 100, 0); // over open sky
  for (let i = 0; i < 60 * 12 && !(player.grounded && !player.rescuing); i++) run(1 / 60);
  assert.ok(Math.hypot(player.position.x - court.x, player.position.z - court.z) < 1.5);
});

test('takeControl pauses physics and input until released', () => {
  const { player, island, run, move } = setup();
  player.place(island.places.plaza.x, island.places.plaza.z, 0);
  run(0.1);
  const release = player.takeControl('toss');
  assert.equal(player.controller, 'toss');
  move.y = 1;
  player.position.set(5, 12, 5);
  player.setAnim('toeTouch');
  run(0.5);
  assert.deepEqual([player.position.x, player.position.y, player.position.z], [5, 12, 5], 'nothing moved it but the owner');
  assert.equal(player.getState().anim, 'toeTouch');
  assert.equal(player.jump(), false);
  move.y = 0;
  release();
  release(); // twice is harmless
  assert.equal(player.controller, null);
  run(1.6);
  assert.equal(player.grounded, true, 'released in the air, it falls and lands');
  assert.equal(player.position.y, 0);
});

test('frozen players do not walk, but still fall', () => {
  const { player, island, run, move } = setup();
  player.place(island.places.plaza.x, island.places.plaza.z, 0);
  player.position.y = 3;
  player.frozen = true;
  move.x = 1;
  const x0 = player.position.x;
  run(1.5);
  assert.equal(player.position.x, x0);
  assert.equal(player.grounded, true);
  assert.equal(player.position.y, 0);
});

test('slides carry you down to the island, sitting', () => {
  const { player, island, run } = setup();
  const s = island.places.slides[0];
  const top = island.platforms.find((p) => p.id === s.fromPlatformId);
  // stand at the top of the slide, a little way down the chute
  const x = s.x0 + (s.x1 - s.x0) * 0.08;
  const z = s.z0 + (s.z1 - s.z0) * 0.08;
  player.place(x, z, 0);
  assert.ok(player.position.y > top.y - 2);
  run(0.3);
  assert.equal(player.getState().anim, 'sit');
  for (let i = 0; i < 60 * 6 && player.position.y > 0.05; i++) run(1 / 60);
  assert.ok(player.position.y < 0.1, 'reached the bottom: ' + player.position.y);
  assert.equal(player.rescuing, false);
});

test('getState is small, rounded and finite', () => {
  const { player, island, run } = setup();
  player.place(island.places.plaza.x + 0.123456, island.places.plaza.z, -1);
  run(0.05);
  const s = player.getState();
  assert.deepEqual(Object.keys(s).sort(), ['anim', 'h', 'x', 'y', 'z']);
  assert.equal(s.x, Math.round(s.x * 100) / 100);
  assert.ok(s.h >= 0 && s.h < Math.PI * 2);
  assert.equal(typeof s.anim, 'string');
});

test('walkTo refuses open sky and stops at the target on land', () => {
  const { player, island, run } = setup();
  const p = island.places.plaza;
  player.place(p.x, p.z, 0);
  assert.equal(player.walkTo(500, 500), false);
  assert.equal(player.walkTo(p.x + 6, p.z + 2), true);
  run(3);
  assert.ok(Math.hypot(player.position.x - (p.x + 6), player.position.z - (p.z + 2)) < 0.6);
  assert.equal(player.walking, false);
});

test('the stand-in island has every Contract 1 place', () => {
  const { island } = setup();
  const pl = island.places;
  for (const k of ['plaza', 'gym', 'stage', 'tossPads', 'slides', 'hideGarden', 'court', 'bowField', 'tagZone', 'photoBooth']) assert.ok(pl[k], k);
  assert.ok(pl.tossPads.length >= 3);
  const heights = pl.tossPads.map((t) => island.platforms.find((q) => q.id === t.targetPlatformId).y);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b), 'targets get higher pad by pad');
  assert.ok(pl.hideGarden.hideSpots.length >= 16);
  const kinds = new Set(pl.hideGarden.hideSpots.map((s) => s.kind));
  for (const k of ['hedge', 'bush', 'slide', 'tent', 'rack', 'cloud', 'barrel', 'curtain']) assert.ok(kinds.has(k), k);
  assert.equal(pl.bowField.bases.length, 2);
  for (const s of pl.hideGarden.hideSpots) assert.ok(Number.isFinite(island.groundAt(s.x, s.z)), s.id + ' is on the island');
  for (const t of pl.tossPads) assert.ok(Number.isFinite(island.groundAt(t.x, t.z)), t.id);
  assert.equal(island.groundAt(0, 1000), -Infinity);
  const g = makeGroundAt(island.platforms, pl.slides);
  assert.equal(g(pl.plaza.x, pl.plaza.z), 0);
});
