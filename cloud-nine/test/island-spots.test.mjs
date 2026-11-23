// Spots asked for by other parts: collectibles (CONTENT), hide spots and the court's bench space (GAMES).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeIslandPlan, rectDistance, toWorld, photoWallColliders } from '../js/art/island-layout.js';
import { planDecor, spotFor, COURT_SIDE } from '../js/art/island-decor.js';

const plan = makeIslandPlan();
const decor = planDecor(plan);
const P = plan.places;
const groundAt = plan.ground.groundAt;
const R = 0.45; // player radius

function hits(x, z, r) {
  return decor.colliders.filter((c) => (c.kind === 'circle'
    ? Math.hypot(x - c.x, z - c.z) < c.r + r
    : rectDistance(x, z, { x: c.x, z: c.z, w: c.w, d: c.d, facing: c.rot }) < r));
}

// the `where`s of the 12 spirit sticks in js/content/collectibles.js, plus the other edge spots
const WHERES = [
  { place: 'plaza' }, { place: 'gym' }, { place: 'stage' },
  { place: 'tossPads', index: 0, spot: 'target' }, { place: 'tossPads', index: 1, spot: 'target' }, { place: 'tossPads', index: 2, spot: 'target' },
  { place: 'slides', index: 0, spot: 'bottom' }, { place: 'hideGarden' }, { place: 'court' }, { place: 'bowField' }, { place: 'tagZone' },
  { place: 'edge' }, { place: 'edge', index: 1 }, { place: 'edge', index: 2 }, { place: 'edge', index: 3 },
];

test('spotFor gives every collectible a clear spot on walkable ground', () => {
  const spots = WHERES.map((w) => [w, spotFor(plan, decor, w)]);
  for (const [w, s] of spots) {
    const what = JSON.stringify(w);
    assert.ok(s, what + ' has a spot');
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z), what);
    assert.ok(Math.abs(groundAt(s.x, s.z) - s.y) < 1e-6, what + ' stands on the walkable surface');
    if (w.spot !== 'target') assert.equal(hits(s.x, s.z, R).length, 0, what + ' is clear of colliders');
  }
  // the clouds: each stick sits on its own pad's target cloud
  for (const k of [0, 1, 2]) {
    const s = spotFor(plan, decor, { place: 'tossPads', index: k, spot: 'target' });
    const cloud = plan.platforms.find((p) => p.id === P.tossPads[k].targetPlatformId);
    assert.equal(s.y, cloud.y);
    assert.ok(Math.hypot(s.x - cloud.x, s.z - cloud.z) < cloud.r - 0.8, 'on cloud ' + cloud.id);
    assert.ok(Math.hypot(s.x - cloud.x, s.z - cloud.z) > 1.2, 'off the landing spot of ' + cloud.id);
  }
  assert.equal(spotFor(plan, decor, { place: 'tossPads', index: 2, spot: 'target' }).treasure, 'spiritStick');
  // edges are at the rim
  for (let i = 0; i < 4; i++) {
    const s = spotFor(plan, decor, { place: 'edge', index: i });
    assert.ok(plan.main.margin(s.x, s.z) < 4 && plan.main.margin(s.x, s.z) > 1, 'edge ' + i + ' is at the rim');
  }
  // no two collectibles in the same place
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i][1];
      const b = spots[j][1];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 3, JSON.stringify(spots[i][0]) + ' vs ' + JSON.stringify(spots[j][0]));
    }
  }
  // the same answer every time, and nonsense gets null
  assert.deepEqual(spotFor(plan, decor, { place: 'gym' }), spotFor(makeIslandPlan(), planDecor(makeIslandPlan()), { place: 'gym' }));
  for (const bad of [null, undefined, 42, 'gym', {}, { place: 'moon' }, { place: 'tossPads', index: 9 }, { place: 'slides', index: 1, spot: 'sideways' }]) {
    assert.equal(spotFor(plan, decor, bad), null, JSON.stringify(bad));
  }
});

test('a seeker can get within 2 m of every hide spot', () => {
  const hg = P.hideGarden;
  const b = hg.bounds;
  const STEP = 0.25;
  const x0 = b.x0 - 3;
  const z0 = b.z0 - 3;
  const nx = Math.ceil((b.x1 - b.x0 + 6) / STEP);
  const nz = Math.ceil((b.z1 - b.z0 + 6) / STEP);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP;
      const z = z0 + j * STEP;
      free[j * nx + i] = groundAt(x, z) > -1e9 && hits(x, z, R).length === 0 ? 1 : 0;
    }
  }
  // flood fill from where the seeker counts
  const seen = new Uint8Array(nx * nz);
  const si = Math.round((hg.seekerStart.x - x0) / STEP);
  const sj = Math.round((hg.seekerStart.z - z0) / STEP);
  assert.equal(free[sj * nx + si], 1, 'the seeker starts somewhere free');
  const queue = [sj * nx + si];
  seen[queue[0]] = 1;
  while (queue.length) {
    const k = queue.pop();
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
      const n = c * nx + a;
      if (free[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  for (const s of hg.hideSpots) {
    let best = Infinity;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (!seen[j * nx + i]) continue;
        best = Math.min(best, Math.hypot(x0 + i * STEP - s.x, z0 + j * STEP - s.z));
      }
    }
    assert.ok(best <= 0.5, s.id + ' (' + s.kind + ') can be reached: ' + best.toFixed(2) + ' m away');
  }
});

test('each dodgeball sideline has 3 m of free, flat deck beside it for the benches', () => {
  const c = P.court;
  const y0 = groundAt(c.x, c.z);
  assert.ok(COURT_SIDE >= 3);
  for (const side of [-1, 1]) {
    for (let lx = c.w / 2 + 0.5; lx <= c.w / 2 + 3; lx += 0.5) {
      for (let lz = -c.d / 2; lz <= c.d / 2; lz += 0.5) {
        const [x, z] = toWorld(c, side * lx, lz);
        assert.equal(hits(x, z, R).length, 0, 'side ' + side + ' blocked at ' + lx.toFixed(1) + ',' + lz.toFixed(1));
        assert.ok(plan.main.margin(x, z) > 3, 'side ' + side + ' on the island');
        assert.ok(Math.abs(groundAt(x, z) - y0) < 0.12, 'side ' + side + ' flat at ' + lx.toFixed(1) + ',' + lz.toFixed(1));
      }
    }
  }
});

test('the photo wall: from the plaza she can walk onto its patio, its stones and round behind it', () => {
  const W = plan.photoWall;
  const solid = [...decor.colliders, ...photoWallColliders(W)];
  const blocked = (x, z) => solid.some((c) => (c.kind === 'circle'
    ? Math.hypot(x - c.x, z - c.z) < c.r + R
    : rectDistance(x, z, { x: c.x, z: c.z, w: c.w, d: c.d, facing: c.rot }) < R));
  // a grid from the plaza's west edge out past the wall
  const STEP = 0.25;
  const x0 = -40;
  const z0 = -6;
  const nx = Math.ceil(32 / STEP);
  const nz = Math.ceil(30 / STEP);
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP;
      const z = z0 + j * STEP;
      free[j * nx + i] = groundAt(x, z) > -1e9 && !blocked(x, z) ? 1 : 0;
    }
  }
  const cell = (x, z) => Math.round((z - z0) / STEP) * nx + Math.round((x - x0) / STEP);
  // flood fill from where the garden path leaves the plaza
  const seen = new Uint8Array(nx * nz);
  const start = cell(-12, 2.5);
  assert.equal(free[start], 1, 'the garden path at the plaza is free');
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const k = queue.pop();
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
      const n = c * nx + a;
      if (free[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  const reach = (x, z, what) => assert.equal(seen[cell(x, z)], 1, what + ' can be reached at ' + x.toFixed(1) + ',' + z.toFixed(1));
  reach(W.spot.x, W.spot.z, 'the prompt spot on the patio');
  reach(W.travel.x, W.travel.z, 'the Go to spot');
  for (const st of W.stones) reach(st.x, st.z, 'a stepping stone');
  const [bx, bz] = toWorld(W, 0, -3.2);
  reach(bx, bz, 'the lawn behind the wall');
  const [fx, fz] = toWorld(W.bench, 0, 0.9);
  reach(fx, fz, 'the front of the bench');
  // the wall, its legs, its stakes and the whole patio stand on one level floor
  for (const [lx, lz] of [[0, 1], [-1.5, 1.4], [1.5, 1.4], [0, 3.5], [0, 5.1], [2.6, 0.9], [-2.6, 0.9], [0, -1.3], [3.05, 0.3], [-3.05, 0.3]]) {
    const [x, z] = toWorld(W, lx, lz);
    assert.ok(Math.abs(groundAt(x, z) - W.y) < 1e-6, 'level ground under the wall and its patio at ' + lx + ',' + lz);
  }
});

