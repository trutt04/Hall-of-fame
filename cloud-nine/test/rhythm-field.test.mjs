// The playfield layout is pure numbers: check it on the screens Hit Zero will meet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldLayout, laneAt, project } from '../js/rhythm/field.js';

const SCREENS = [
  ['phone portrait', 390, 844, 136],
  ['small phone', 320, 568, 130],
  ['iPad portrait', 768, 1024, 150],
  ['iPad landscape', 1024, 768, 140],
  ['phone landscape', 844, 390, 64],
  ['laptop', 1440, 900, 140],
];

for (const [name, w, h, top] of SCREENS) {
  test(`layout: ${name} (${w}x${h})`, () => {
    const L = fieldLayout(w, h, top);
    // tap zones fill (at least) the bottom third
    assert.ok(L.zoneTop <= (h * 2) / 3, `zones start at ${L.zoneTop}, above ${(h * 2) / 3}`);
    assert.ok(L.hitY > L.zoneTop && L.hitY < h);
    // notes have room to travel, and start below the top UI
    assert.ok(L.farY >= top, 'the runway starts under the HUD');
    assert.ok(L.hitY - L.farY >= 120, `travel ${L.hitY - L.farY}px`);
    // three lanes, left to right, each zone reaching the screen edges
    assert.equal(laneAt(L, 0), 0);
    assert.equal(laneAt(L, w / 2), 1);
    assert.equal(laneAt(L, w - 1), 2);
    assert.ok(L.bounds[1] - L.bounds[0] >= 96, 'the middle zone is big enough for a thumb');
    for (let lane = 0; lane < 3; lane++) {
      const x = L.cx + (lane - 1) * L.laneW;
      assert.equal(laneAt(L, x), lane, 'a target sits in its own zone');
      assert.ok(x - L.targetR >= 0 && x + L.targetR <= w, 'targets are on screen');
    }
    assert.ok(L.targetR >= 24, 'targets big enough to see');
    // the performer stands clear of the hit line
    assert.ok(L.perf.y < L.hitY);
    if (L.perf.side) assert.ok(L.perf.x + L.perf.size * 0.4 < L.cx - L.nearW / 2, 'beside the runway');
  });
}

test('layout: perspective puts the hit line at full size and the horizon far away', () => {
  const L = fieldLayout(390, 844, 136);
  const near = project(L, 0);
  const far = project(L, 1);
  assert.ok(Math.abs(near.y - L.hitY) < 1e-9 && Math.abs(near.s - 1) < 1e-9);
  assert.ok(Math.abs(far.y - L.farY) < 1e-9 && Math.abs(far.s - L.farScale) < 1e-9);
  let prev = Infinity;
  for (let u = 0; u <= 1; u += 0.05) {
    const p = project(L, u);
    assert.ok(p.y < prev, 'farther is higher up');
    prev = p.y;
  }
  assert.ok(project(L, -0.2).y > L.hitY, 'past the line keeps going down');
});
