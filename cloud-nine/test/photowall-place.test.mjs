// The photo wall's spot (js/art/island-layout.js makePhotoWall): where it stands, that nothing of the
// island grows into it, that it blocks no path, game area, route or view, and the Go to / beacon spots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeIslandPlan, rectDistance, toWorld, toLocal, photoWallColliders, PHOTO_WALL, HEART, heartPoint } from '../js/art/island-layout.js';
import { planDecor, spotFor } from '../js/art/island-decor.js';
import { beaconSpots, BEACON_KINDS } from '../js/world/beacons.js';
import { SPIRIT_STICKS } from '../js/content/collectibles.js';

const plan = makeIslandPlan();
const decor = planDecor(plan);
const P = plan.places;
const W = plan.photoWall;
const G = plan.ground;
const solid = photoWallColliders(W);
const R = 0.45; // player radius
const segD = (ax, az, bx, bz, x, z) => {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
};
// how far a point is from the wall's solid parts (0 inside one)
const fromSolid = (x, z) => Math.min(...solid.map((c) => (c.kind === 'circle'
  ? Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r)
  : rectDistance(x, z, { x: c.x, z: c.z, w: c.w, d: c.d, facing: c.rot }))));
// the patio: a heart lying on the ground (as js/art/photowall-art.js paves it)
const patioRing = (() => {
  const s = W.patio.w / HEART.width;
  const out = [];
  for (let i = 0; i < 96; i++) {
    const p = heartPoint((i / 96) * Math.PI * 2);
    out.push(toWorld(W, p[0] * s, W.patio.at + (HEART.top - p[1]) * s));
  }
  return out;
})();
function onPatio(x, z) {
  let inside = false;
  for (let i = 0, j = patioRing.length - 1; i < patioRing.length; j = i++) {
    const [xi, zi] = patioRing[i];
    const [xj, zj] = patioRing[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// everything the wall takes up: its solid parts, its patio and its stones
const footprint = [...solid.map((c) => [c.x, c.z]), ...patioRing, ...W.stones.map((s) => [s.x, s.z])];
const fromWall = (x, z) => (onPatio(x, z) ? 0 : Math.min(fromSolid(x, z), ...patioRing.map(([px, pz]) => Math.hypot(x - px, z - pz))));

test('the photo wall is a place: west of the plaza, facing it, its heart about 5 m across', () => {
  assert.deepEqual(Object.keys(P.photoWall).sort(), ['facing', 'x', 'z']);
  assert.deepEqual([P.photoWall.x, P.photoWall.z, P.photoWall.facing], [W.x, W.z, W.facing]);
  assert.ok(W.board.w >= 4 && W.board.w <= 5.2 && W.board.h >= 4 && W.board.h <= 5, 'a 4 to 5 m heart: ' + W.board.w + ' x ' + W.board.h.toFixed(2));
  assert.ok(plan.main.margin(W.x, W.z) > 20, 'well inside the rim');
  for (const [x, z] of footprint) assert.ok(plan.main.margin(x, z) > 8, 'all of it on the island');
  // it faces the plaza's west side, so the plaza sees its front
  const toPlaza = Math.atan2(0 - W.x, 0 - W.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(toPlaza - W.facing), Math.cos(toPlaza - W.facing))) < 0.35, 'it faces the plaza');
  const d = Math.hypot(W.x - plan.plazaC.x, W.z - plan.plazaC.z) - plan.plazaC.r;
  assert.ok(d > 6 && d < 16, 'a short walk from the plaza: ' + d.toFixed(1) + ' m past its edge');
});

test('it stands where nothing else is: no tree, bush, lamp, bench or anything solid of the island in it', () => {
  for (const p of decor.props) {
    const r = p.type === 'tree' ? 2.1 * (p.s || 1) : p.type === 'bigTree' ? 4.2 : p.type === 'flowers' ? 1.2 * (p.s || 1) : 0.9 * (p.s || 1);
    const d = fromWall(p.x, p.z);
    assert.ok(d > r * 0.6 + 0.6, p.type + ' at ' + p.x.toFixed(1) + ',' + p.z.toFixed(1) + ' grows into the wall (' + d.toFixed(1) + ' m)');
  }
  for (const c of decor.colliders) {
    const pts = c.kind === 'circle' ? [[c.x, c.z]] : [-1, 1].flatMap((sx) => [-1, 1].map((sz) => toWorld({ x: c.x, z: c.z, facing: c.rot }, sx * c.w / 2, sz * c.d / 2)));
    for (const [x, z] of pts) assert.ok(fromWall(x, z) > 1, 'a ' + (c.tag || c.kind) + ' at ' + x.toFixed(1) + ',' + z.toFixed(1) + ' is in the wall');
  }
});

test('it overlaps no place, path, hide spot, spirit stick, slide, flight line, beacon or game area', () => {
  for (const a of decor.areas) {
    for (const [x, z] of footprint) {
      const d = a.kind === 'disc' ? Math.hypot(x - a.x, z - a.z) - a.r : rectDistance(x, z, a);
      assert.ok(d > 1, 'in the keep-out area at ' + a.x.toFixed(1) + ',' + a.z.toFixed(1) + ' (' + d.toFixed(1) + ')');
    }
  }
  for (const p of plan.paths) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      for (const c of solid) {
        assert.ok(segD(p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1], c.x, c.z) - p.w / 2 > 2, 'path ' + p.id + ' runs into the wall');
      }
    }
  }
  const at = (x, z) => fromWall(x, z);
  for (const h of P.hideGarden.hideSpots) assert.ok(at(h.x, h.z) > 8, 'hide spot ' + h.id);
  for (const st of SPIRIT_STICKS) {
    const s = spotFor(plan, decor, st.where);
    assert.ok(s && at(s.x, s.z) > 6, 'spirit stick ' + st.id);
  }
  for (const s of plan.secrets) assert.ok(at(s.x, s.z) > 6, 'secret ' + s.id);
  for (const s of plan.slides) assert.ok(segD(s.x0, s.z0, s.x1, s.z1, W.x, W.z) > 20, 'slide ' + s.id);
  plan.toss.pads.forEach((pad, k) => {
    const pf = plan.platforms[k];
    assert.ok(segD(pad.x, pad.z, pf.x, pf.z, W.x, W.z) > 20, 'flight line ' + pad.id);
  });
  for (const b of beaconSpots(P, () => 0)) if (b.id !== 'photoWall') assert.ok(at(b.x, b.z) > 8, 'beacon ' + b.id);
  // the game areas, the booth and the duck pond
  const lawn = P.tagZone.bounds;
  const garden = P.hideGarden.bounds;
  const rects = [
    ['the dodgeball court', P.court], ['Capture the Bow', P.bowField],
    ['freeze tag', { x: (lawn.x0 + lawn.x1) / 2, z: (lawn.z0 + lawn.z1) / 2, w: lawn.x1 - lawn.x0, d: lawn.z1 - lawn.z0, facing: 0 }],
    ['the hide garden', { x: (garden.x0 + garden.x1) / 2, z: (garden.z0 + garden.z1) / 2, w: garden.x1 - garden.x0, d: garden.z1 - garden.z0, facing: 0 }],
    ['the gym', P.gym],
  ];
  for (const [what, r] of rects) for (const [x, z] of footprint) assert.ok(rectDistance(x, z, r) > 4, what);
  for (const [x, z] of footprint) {
    assert.ok(Math.hypot(x - P.photoBooth.x, z - P.photoBooth.z) > 8, 'the photo booth');
    assert.ok(Math.hypot(x - P.pond.x, z - P.pond.z) > 30, 'the duck pond');
    assert.ok(Math.hypot(x - P.stage.x, z - P.stage.z) > 30, 'the stage');
    for (const pad of P.tossPads) assert.ok(Math.hypot(x - pad.x, z - pad.z) > 20, 'toss pad ' + pad.id);
  }
});

// Tap to walk goes in a straight line: from where she stands on the plaza to every place, its way
// in and its middle, the line must not cross the wall (it sits off to the side of all of them).
test('walking to any place in a straight line (tap to walk) from the plaza never runs into it', () => {
  const starts = [[-11, 4.5], [P.plaza.x, P.plaza.z], [0, 0 + plan.cake.r + 1.5], [-14, 6], [-12, 12]];
  const lawn = P.tagZone.bounds;
  const g = P.hideGarden;
  const lawnWay = plan.paths.find((p) => p.id === 'toLawn').pts;
  const ends = [
    [(lawn.x0 + lawn.x1) / 2, (lawn.z0 + lawn.z1) / 2], [lawn.x1 - 1, lawn.z0 + 1], lawnWay[lawnWay.length - 1], [lawn.x1 - 6, lawn.z1 - 4],
    [g.gate ? g.gate.x : g.bounds.x1 + 1, -10], [g.seekerStart.x + 3, g.seekerStart.z], [P.photoBooth.x, P.photoBooth.z + 3],
    [P.pond.x, P.pond.z], [P.court.x, P.court.z], [P.bowField.x, P.bowField.z], ...P.bowField.bases.map((b) => [b.x, b.z]),
    ...P.tossPads.map((p) => [p.x, p.z]), [P.stage.x, P.stage.z], [P.gym.x, P.gym.z + 10], [0, -28],
  ];
  for (const [sx, sz] of starts) {
    for (const [ex, ez] of ends) {
      const n = Math.ceil(Math.hypot(ex - sx, ez - sz) / 0.25);
      for (let k = 0; k <= n; k++) {
        const x = sx + ((ex - sx) * k) / n;
        const z = sz + ((ez - sz) * k) / n;
        assert.ok(fromSolid(x, z) > R, 'the walk from ' + sx + ',' + sz + ' to ' + ex.toFixed(1) + ',' + ez.toFixed(1) + ' bumps into the wall');
      }
    }
  }
});

test('the view she gets when she arrives (the toss pads and their clouds) has no photo wall in it', () => {
  const ax = -11;
  const az = 4.5; // the arrival spot main.js picks on the plaza
  const pad = P.tossPads[1];
  const look = Math.atan2(pad.x - ax, pad.z - az);
  for (const [x, z] of [[W.x, W.z], ...solid.map((c) => [c.x, c.z])]) {
    const a = Math.atan2(x - ax, z - az);
    const off = Math.abs(Math.atan2(Math.sin(a - look), Math.cos(a - look)));
    assert.ok(off > (40 * Math.PI) / 180, 'the wall is ' + ((off * 180) / Math.PI).toFixed(0) + ' degrees from the middle of her first view');
  }
});

test('its prompt, its "Go to" spot and the beacon over it', () => {
  // the prompt: on the patio, a stride in front of the board; Go to: at the patio's tip, looking at it
  assert.ok(onPatio(W.spot.x, W.spot.z), 'the prompt spot is on the patio');
  assert.ok(onPatio(W.travel.x, W.travel.z) || fromWall(W.travel.x, W.travel.z) < 0.8, 'Go to puts her on (or at) the patio');
  const [, lz] = toLocal(W, W.travel.x, W.travel.z);
  assert.ok(lz > 4.5 && lz < 7, 'far enough back to see the whole heart: ' + lz.toFixed(1));
  const toWall = Math.atan2(W.x - W.travel.x, W.z - W.travel.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(toWall - W.travel.facing), Math.cos(toWall - W.travel.facing))) < 0.05, 'facing the heart');
  for (const p of [W.spot, W.travel]) assert.ok(fromSolid(p.x, p.z) > R, 'clear of the wall');
  const b = beaconSpots(P, () => W.y).find((s) => s.id === 'photoWall');
  const kind = BEACON_KINDS.find((k) => k.id === 'photoWall');
  assert.ok(b && kind, 'a beacon');
  assert.equal(b.label, 'Photo wall');
  const top = W.board.cy + HEART.top * W.board.scale + 0.8; // the banner over the heart
  assert.ok(b.y - W.y > top + 1, 'it floats above the banner and the balloons');
  // the stepping stones lead from the patio to the garden path's kerb
  assert.ok(W.stones.length >= 1, 'stepping stones');
  const path = plan.paths.find((p) => p.id === 'toGarden');
  const last = W.stones[W.stones.length - 1];
  let best = Infinity;
  for (let i = 0; i < path.pts.length - 1; i++) best = Math.min(best, segD(path.pts[i][0], path.pts[i][1], path.pts[i + 1][0], path.pts[i + 1][1], last.x, last.z));
  assert.ok(best - path.w / 2 < 1.2, 'the last stone is by the path (' + (best - path.w / 2).toFixed(2) + ' m)');
  for (const s of W.stones) assert.ok(fromSolid(s.x, s.z) > R && Number.isFinite(G.groundAt(s.x, s.z)), 'a stone she can step on');
});

test('the plan is the same every time, and its solid parts the same on every device', () => {
  const again = makeIslandPlan();
  assert.deepEqual(JSON.parse(JSON.stringify(again.photoWall)), JSON.parse(JSON.stringify(W)));
  assert.deepEqual(photoWallColliders(again.photoWall), solid);
  assert.ok(solid.every((c) => c.tag === 'photoWall'));
  assert.ok(PHOTO_WALL.w === W.board.w);
});
