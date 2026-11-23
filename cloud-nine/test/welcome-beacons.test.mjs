// Activity beacons (js/world/beacons.js): where they float, how they fade, how big they draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BEACON_KINDS, beaconSpots, beaconFade, beaconHeight } from '../js/world/beacons.js';
import { makeIslandPlan } from '../js/art/island-layout.js';
import { copyProblems } from './content-copy-rules.mjs';

test('a beacon for each place with something to do, within the draw-call budget', () => {
  assert.deepEqual(BEACON_KINDS.map((k) => k.id), ['toss', 'stage', 'booth', 'court', 'bowField', 'tagZone', 'hideGarden', 'pond', 'photoWall']);
  assert.ok(BEACON_KINDS.length <= 15, 'the atlas pages (8 cells each) hold the badges and the glow');
  assert.ok(BEACON_KINDS.length <= 10, 'one sprite each: at most ~10 extra draw calls');
  const problems = [];
  for (const k of BEACON_KINDS) {
    problems.push(...copyProblems(k.label, k.id, { max: 16 }));
    assert.ok(k.far > k.near && k.near >= 6, k.id + ' fades out within ~10 m of her');
  }
  assert.deepEqual(problems, []);
});

test('on the real island every beacon floats over its place', () => {
  const plan = makeIslandPlan();
  const spots = beaconSpots(plan.places, () => 0);
  assert.equal(spots.length, 9);
  assert.deepEqual([spots[7].x, spots[7].z], [plan.places.pond.x, plan.places.pond.z], 'the duck pond has one too');
  assert.deepEqual([spots[8].x, spots[8].z], [plan.places.photoWall.x, plan.places.photoWall.z], 'and the photo wall');
  assert.equal(spots[8].label, 'Photo wall');
  const P = plan.places;
  const byId = Object.fromEntries(spots.map((s) => [s.id, s]));
  assert.deepEqual([byId.toss.x, byId.toss.z], [P.tossPads[1].x, P.tossPads[1].z], 'one badge over the middle pad');
  assert.deepEqual([byId.stage.x, byId.stage.z], [P.stage.x, P.stage.z]);
  const b = P.hideGarden.bounds;
  assert.deepEqual([byId.hideGarden.x, byId.hideGarden.z], [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]);
  for (const s of spots) assert.ok(s.y >= 5 && s.y <= 9, s.id + ' floats high enough to be seen over hedges');
});

test('missing places and a broken ground are fine', () => {
  assert.deepEqual(beaconSpots(null, null), []);
  const spots = beaconSpots({ stage: { x: 1, z: 2 }, court: { x: NaN, z: 0 }, tagZone: { bounds: { x0: 0, z0: 0, x1: 'a', z1: 4 } } }, () => {
    throw new Error('no ground');
  });
  assert.deepEqual(spots.map((s) => s.id), ['stage']);
  assert.ok(Number.isFinite(spots[0].y));
  assert.equal(beaconSpots({ stage: { x: 0, z: 0 } }, () => 3)[0].y, 3 + BEACON_KINDS[1].up);
});

test('a beacon fades away as she walks up to it', () => {
  assert.equal(beaconFade(0, 9, 15), 0);
  assert.equal(beaconFade(9, 9, 15), 0);
  assert.equal(beaconFade(15, 9, 15), 1);
  assert.equal(beaconFade(80, 9, 15), 1);
  let prev = 0;
  for (let d = 9; d <= 15; d += 0.5) {
    const f = beaconFade(d, 9, 15);
    assert.ok(f >= prev && f >= 0 && f <= 1);
    prev = f;
  }
  assert.equal(beaconFade(NaN, 9, 15), 0);
});

test('labels stay about 16 px tall on a phone at mid distance', () => {
  const ppr = 844 / 2 / Math.tan((70 * Math.PI) / 360); // a 390 x 844 phone, 70 degree field of view
  const labelPx = (d) => (ppr * beaconHeight(d, ppr) * (36 / 256)) / d;
  for (const d of [20, 30, 40]) assert.ok(labelPx(d) >= 16 && labelPx(d) <= 18.5, d + ' m: ' + labelPx(d).toFixed(1) + ' px');
  assert.ok(labelPx(100) >= 11, 'far away a little smaller, still there');
  assert.ok(beaconHeight(2, ppr) >= 3, 'never tiny up close');
  assert.ok(beaconHeight(0, ppr) >= 3 && Number.isFinite(beaconHeight(-5, ppr)));
});
