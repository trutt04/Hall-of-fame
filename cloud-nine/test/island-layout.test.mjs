// The island plan: Contract 1 place shapes, groundAt, and what is solid.
// Pure modules only (no WebGL): js/art/island-layout.js and js/art/island-decor.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeIslandPlan, rectDistance, toWorld, slideProfile } from '../js/art/island-layout.js';
import { planDecor } from '../js/art/island-decor.js';

const plan = makeIslandPlan();
const P = plan.places;
const groundAt = plan.ground.groundAt;
const decor = planDecor(plan, { quality: 'high' });
const KINDS = ['hedge', 'bush', 'slide', 'tent', 'rack', 'cloud', 'barrel', 'curtain'];
const MAX_CLIMB = 1.7; // the player treats steeper than this as a wall
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// collider hit test, same maths as js/core/colliders.js
function hits(x, z, r, list = decor.colliders) {
  return list.filter((c) => (c.kind === 'circle'
    ? Math.hypot(x - c.x, z - c.z) < c.r + r
    : rectDistance(x, z, { x: c.x, z: c.z, w: c.w, d: c.d, facing: c.rot }) < r));
}

test('places have the Contract 1 ids and shapes', () => {
  for (const key of ['plaza', 'stage', 'photoBooth']) {
    assert.ok(finite(P[key].x) && finite(P[key].z) && finite(P[key].facing), key);
  }
  for (const key of ['gym', 'court']) {
    const p = P[key];
    assert.ok(finite(p.x) && finite(p.z) && finite(p.w) && finite(p.d) && finite(p.facing), key);
    assert.ok(p.w > 0 && p.d > 0, key);
  }
  const f = P.bowField;
  assert.ok(finite(f.x) && finite(f.z) && f.w > 0 && f.d > 0 && finite(f.facing));
  assert.equal(f.bases.length, 2);
  assert.deepEqual(f.bases.map((b) => b.team), [0, 1]);
  for (const b of f.bases) assert.ok(finite(b.x) && finite(b.z) && b.r > 0);
  for (const key of ['tagZone']) {
    const b = P[key].bounds;
    assert.ok(b.x0 < b.x1 && b.z0 < b.z1, key);
  }
  const hg = P.hideGarden;
  assert.ok(hg.bounds.x0 < hg.bounds.x1 && hg.bounds.z0 < hg.bounds.z1);
  assert.ok(finite(hg.seekerStart.x) && finite(hg.seekerStart.z) && finite(hg.seekerStart.facing));
  assert.ok(hg.hideSpots.length >= 16, 'at least 16 hide spots');
  const ids = new Set();
  for (const s of hg.hideSpots) {
    assert.ok(KINDS.includes(s.kind), 'kind ' + s.kind);
    assert.ok(finite(s.x) && finite(s.z) && s.r > 0);
    assert.ok(!ids.has(s.id), 'unique id ' + s.id);
    ids.add(s.id);
  }
  assert.ok(new Set(hg.hideSpots.map((s) => s.kind)).size >= 6, 'varied hide spots');
});

test('toss pads aim at clouds that get higher pad by pad (about 8, 14, 22 m)', () => {
  assert.ok(P.tossPads.length >= 3);
  const ys = P.tossPads.map((pad) => {
    const target = plan.platforms.find((p) => p.id === pad.targetPlatformId);
    assert.ok(target, 'target exists for ' + pad.id);
    assert.ok(finite(pad.facing));
    // the pad faces its cloud
    const want = Math.atan2(target.x - pad.x, target.z - pad.z);
    const d = Math.atan2(Math.sin(want - pad.facing), Math.cos(want - pad.facing));
    assert.ok(Math.abs(d) < 0.35, pad.id + ' faces its cloud');
    return target.y;
  });
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1]);
  assert.ok(Math.abs(ys[0] - 8) <= 1.5 && Math.abs(ys[1] - 14) <= 1.5 && Math.abs(ys[2] - 22) <= 1.5);
  for (const p of plan.platforms) assert.ok(finite(p.x) && finite(p.z) && finite(p.y) && p.r > 2.5);
});

test('groundAt: islands are ground, open sky is -Infinity', () => {
  assert.ok(Math.abs(groundAt(P.plaza.x, P.plaza.z)) < 0.05, 'spawn sits at y = 0');
  assert.equal(groundAt(500, 500), -Infinity);
  assert.equal(groundAt(0, -200), -Infinity);
  // walk out from the plaza in every direction: ground, then sky, and never ground again
  // (except the platforms, slides, bridge and isle, which we skip by bearing)
  const m = plan.main;
  for (let deg = 0; deg < 360; deg += 7.5) {
    const b = (deg * Math.PI) / 180;
    const r = m.radiusAt(b);
    const x = m.cx + Math.sin(b) * (r - 1);
    const z = m.cz - Math.cos(b) * (r - 1);
    assert.ok(finite(groundAt(x, z)), 'inside the rim at ' + deg);
    const ox = m.cx + Math.sin(b) * (r + 1.5);
    const oz = m.cz - Math.cos(b) * (r + 1.5);
    const g = groundAt(ox, oz);
    const onStructure = plan.slides.some((s) => Math.hypot(ox - s.x1, oz - s.z1) < 40) || Math.hypot(ox - plan.bridge.x0, oz - plan.bridge.z0) < 8;
    if (!onStructure) assert.equal(g, -Infinity, 'sky past the rim at ' + deg);
  }
});

test('groundAt: cloud platforms are flat discs over open sky', () => {
  for (const p of plan.platforms) {
    assert.equal(groundAt(p.x, p.z), p.y);
    assert.equal(groundAt(p.x + p.r * 0.7, p.z), p.y);
    // nothing of the island underneath
    assert.ok(plan.main.margin(p.x, p.z) < -(p.r + 2), p.id + ' floats past the rim');
    assert.ok(!plan.ground.insideIsle(p.x, p.z));
    // the far side of the cloud drops to open sky
    const slide = plan.slides.find((s) => s.fromPlatformId === p.id);
    const ax = p.x - slide.x0;
    const az = p.z - slide.z0;
    const l = Math.hypot(ax, az);
    assert.equal(groundAt(p.x + (ax / l) * (p.r + 0.6), p.z + (az / l) * (p.r + 0.6)), -Infinity);
  }
});

test('groundAt: each rainbow slide runs smoothly from its cloud to the grass, walkable all the way', () => {
  for (const s of plan.slides) {
    const pf = plan.platforms.find((p) => p.id === s.fromPlatformId);
    assert.ok(pf, s.id + ' starts on a platform');
    assert.ok(Math.hypot(s.x0 - pf.x, s.z0 - pf.z) < pf.r, s.id + ' starts inside its cloud');
    assert.ok(plan.main.margin(s.x1, s.z1) > 2, s.id + ' ends on the island');
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    let prev = groundAt(s.x0, s.z0);
    assert.ok(Math.abs(prev - pf.y) < 0.05, s.id + ' top meets the cloud');
    let maxSlope = 0;
    const step = 0.25;
    for (let d = step; d <= len; d += step) {
      const x = s.x0 + ((s.x1 - s.x0) * d) / len;
      const z = s.z0 + ((s.z1 - s.z0) * d) / len;
      const y = groundAt(x, z);
      assert.ok(finite(y), s.id + ' walkable at ' + d.toFixed(2));
      maxSlope = Math.max(maxSlope, Math.abs(y - prev) / step);
      prev = y;
    }
    assert.ok(maxSlope < MAX_CLIMB, s.id + ' max slope ' + maxSlope.toFixed(2));
    assert.ok(Math.abs(prev - plan.ground.gridHeight(s.x1, s.z1)) < 0.15, s.id + ' lands on the grass');
    // the profile is monotonic
    for (let t = 0.05; t <= 1; t += 0.05) assert.ok(slideProfile(t) <= slideProfile(t - 0.05));
  }
});

test('slides never cross each other', () => {
  const cross = (a, b) => {
    const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const A = [a.x0, a.z0], B = [a.x1, a.z1], C = [b.x0, b.z0], D = [b.x1, b.z1];
    return d(A, B, C) * d(A, B, D) < 0 && d(C, D, A) * d(C, D, B) < 0;
  };
  for (let i = 0; i < plan.slides.length; i++) for (let j = i + 1; j < plan.slides.length; j++) assert.ok(!cross(plan.slides[i], plan.slides[j]));
});

test('groundAt: the rainbow bridge carries you to the isle', () => {
  const b = plan.bridge;
  const len = Math.hypot(b.x1 - b.x0, b.z1 - b.z0);
  let prev = groundAt(b.x0, b.z0);
  let top = -Infinity;
  for (let d = 0; d <= len + 4; d += 0.25) {
    const x = b.x0 + ((b.x1 - b.x0) * d) / len;
    const z = b.z0 + ((b.z1 - b.z0) * d) / len;
    const y = groundAt(x, z);
    assert.ok(finite(y), 'bridge walkable at ' + d.toFixed(2));
    assert.ok(Math.abs(y - prev) < 0.85 * 0.5, 'no step you could not take at ' + d.toFixed(2));
    prev = y;
    top = Math.max(top, y);
  }
  assert.ok(top > 2, 'it arches');
  assert.ok(finite(groundAt(P.isle.x, P.isle.z)), 'the isle is ground');
  assert.ok(finite(groundAt(P.boutique.x, P.boutique.z)));
  // beside the bridge is open sky
  const mx = (b.x0 + b.x1) / 2;
  const mz = (b.z0 + b.z1) / 2;
  const nx = -(b.z1 - b.z0) / len;
  const nz = (b.x1 - b.x0) / len;
  assert.equal(groundAt(mx + nx * 3, mz + nz * 3), -Infinity);
});

test('groundAt: the stage mat is raised and the bleachers are steps', () => {
  const g0 = plan.ground.gridHeight(P.stage.x, P.stage.z);
  assert.ok(Math.abs(groundAt(P.stage.x, P.stage.z) - (g0 + plan.ground.stageMatY)) < 1e-6);
  for (const b of plan.ground.bleachers) {
    const ys = [0, 1, 2].map((k) => {
      const across = (k + 0.5) * b.depth - (b.rows * b.depth) / 2;
      const [x, z] = toWorld(P.stage, b.lx + across * b.side, b.lz);
      return groundAt(x, z) - plan.ground.gridHeight(x, z);
    });
    assert.ok(ys[0] > 0.3 && ys[1] > ys[0] && ys[2] > ys[1], 'rows climb: ' + ys.map((v) => v.toFixed(2)));
    assert.ok(ys[0] < 0.85 && ys[1] - ys[0] < 0.85, 'each row is a step');
  }
});

test('every place sits on the island with room to spare', () => {
  const land = (x, z, what, margin = 2) => {
    assert.ok(finite(groundAt(x, z)), what + ' on land');
    assert.ok(plan.main.margin(x, z) > margin, what + ' clear of the rim (' + plan.main.margin(x, z).toFixed(1) + ')');
  };
  land(P.plaza.x, P.plaza.z, 'spawn', 10);
  for (const key of ['gym', 'court', 'bowField']) {
    const p = P[key];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [x, z] = toWorld(p, (sx * p.w) / 2, (sz * p.d) / 2);
      land(x, z, key + ' corner');
    }
  }
  for (const key of ['tagZone', 'hideGarden']) {
    const b = P[key].bounds;
    for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]) land(x, z, key + ' corner');
  }
  land(P.stage.x, P.stage.z, 'stage', 10);
  land(P.photoBooth.x, P.photoBooth.z, 'photo booth');
  for (const pad of P.tossPads) land(pad.x, pad.z, pad.id, 3);
  for (const b of P.bowField.bases) land(b.x, b.z, 'base ' + b.team, 4);
  const hg = P.hideGarden;
  for (const s of hg.hideSpots) {
    assert.ok(s.x > hg.bounds.x0 && s.x < hg.bounds.x1 && s.z > hg.bounds.z0 && s.z < hg.bounds.z1, s.id + ' inside the garden');
  }
  // places do not overlap each other
  const rects = [
    ['gym', P.gym], ['court', P.court], ['field', P.bowField],
    ['lawn', { x: (P.tagZone.bounds.x0 + P.tagZone.bounds.x1) / 2, z: (P.tagZone.bounds.z0 + P.tagZone.bounds.z1) / 2, w: P.tagZone.bounds.x1 - P.tagZone.bounds.x0, d: P.tagZone.bounds.z1 - P.tagZone.bounds.z0, facing: 0 }],
    ['garden', { x: (hg.bounds.x0 + hg.bounds.x1) / 2, z: (hg.bounds.z0 + hg.bounds.z1) / 2, w: hg.bounds.x1 - hg.bounds.x0, d: hg.bounds.z1 - hg.bounds.z0, facing: 0 }],
  ];
  for (let i = 0; i < rects.length; i++) {
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const [na, a] = rects[i];
      const [nb, b] = rects[j];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const [x, z] = toWorld(a, (sx * a.w) / 2, (sz * a.d) / 2);
        assert.ok(rectDistance(x, z, b) > 1, na + ' overlaps ' + nb);
      }
    }
  }
});

test('nothing solid where people stand or play', () => {
  assert.equal(hits(P.plaza.x, P.plaza.z, 0.45).length, 0, 'spawn');
  const hg = P.hideGarden;
  assert.equal(hits(hg.seekerStart.x, hg.seekerStart.z, 0.45).length, 0, 'seeker start');
  for (const s of hg.hideSpots) assert.equal(hits(s.x, s.z, 0.45).length, 0, 'hide spot ' + s.id + ' (' + s.kind + ')');
  // every hide spot really has something solid next to it to crouch behind
  for (const s of hg.hideSpots) assert.ok(hits(s.x, s.z, 1.6).length > 0, s.id + ' has cover');
  for (const pad of P.tossPads) assert.equal(hits(pad.x, pad.z, 2.4).length, 0, pad.id);
  for (const s of P.slides) assert.equal(hits(s.x1, s.z1, 0.45).length, 0, s.id + ' bottom');
  // the court and the lawn are open; the field is open apart from its two flag poles
  const open = (place, w, d, what) => {
    for (let lx = -w / 2 + 0.6; lx <= w / 2 - 0.6; lx += 1) {
      for (let lz = -d / 2 + 0.6; lz <= d / 2 - 0.6; lz += 1) {
        const [x, z] = toWorld(place, lx, lz);
        const h = hits(x, z, 0.45).filter((c) => !(c.tag === 'field' && c.kind === 'circle'));
        assert.equal(h.length, 0, what + ' blocked at ' + x.toFixed(1) + ',' + z.toFixed(1) + ' by ' + h.map((c) => c.tag));
      }
    }
  };
  open(P.court, P.court.w, P.court.d, 'court');
  open(P.bowField, P.bowField.w, P.bowField.d, 'field');
  const t = P.tagZone.bounds;
  open({ x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2, facing: 0 }, t.x1 - t.x0, t.z1 - t.z0, 'lawn');
  // the walk from the spawn to every place's front door is not walled off
  for (const p of plan.paths) {
    for (const [x, z] of p.pts) {
      const h = hits(x, z, 0.3).filter((c) => c.tag !== 'gym' && c.tag !== 'stage');
      assert.equal(h.length, 0, 'path ' + p.id + ' blocked at ' + x.toFixed(1) + ',' + z.toFixed(1) + ' by ' + h.map((c) => c.tag));
    }
  }
});

test('solid things are the same at every quality (multiplayer agrees on walls)', () => {
  const low = planDecor(makeIslandPlan(), { quality: 'low' });
  assert.deepEqual(low.colliders, decor.colliders);
});

test('the plan is deterministic', () => {
  const again = makeIslandPlan();
  assert.equal(JSON.stringify(again.places), JSON.stringify(P));
  assert.equal(JSON.stringify(again.platforms), JSON.stringify(plan.platforms));
});

test('groundAt is fast', () => {
  // The best of three runs, so a busy machine (other test runs, a browser) doesn't fail it; a real
  // slowdown still shows in all three.
  let acc = 0;
  const n = 200000;
  let ns = Infinity;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const y = groundAt(Math.sin(i * 0.37) * 110, Math.cos(i * 0.73) * 110);
      if (y > -1e9) acc += y;
    }
    ns = Math.min(ns, ((performance.now() - t0) * 1e6) / n);
  }
  assert.ok(Number.isFinite(acc));
  assert.ok(ns < 2000, 'groundAt took ' + ns.toFixed(0) + ' ns per call');
});
