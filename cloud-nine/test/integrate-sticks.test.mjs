// Spirit sticks as the app wires them: every stick finds a spot on the real island, the creator's
// locks match CONTENT's unlocks and CHARACTER's options, and touching works at the right reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockedLooks, touching } from '../js/world/sticks.js';
import { SPIRIT_STICKS, unlocksFor } from '../js/content/collectibles.js';
import { LOOK_OPTIONS, DEFAULT_LOOK } from '../js/art/character.js';
import { spotFor } from '../js/world/island.js';

test('every spirit stick has a spot on the island, at least 3 m from the others', () => {
  const spots = SPIRIT_STICKS.map((s) => ({ id: s.id, spot: spotFor(s.where) }));
  for (const { id, spot } of spots) {
    assert.ok(spot, 'no spot for ' + id);
    assert.ok(Number.isFinite(spot.x) && Number.isFinite(spot.z) && Number.isFinite(spot.y), 'bad spot for ' + id);
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i].spot;
      const b = spots[j].spot;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3, spots[i].id + ' and ' + spots[j].id + ' are too close');
    }
  }
});

test('the locks name real look options, never the default outfit', () => {
  const locked = lockedLooks(SPIRIT_STICKS, []);
  let n = 0;
  for (const [slot, ids] of Object.entries(locked)) {
    assert.ok(Array.isArray(LOOK_OPTIONS[slot]), 'unknown slot ' + slot);
    for (const [id, info] of Object.entries(ids)) {
      n++;
      assert.ok(LOOK_OPTIONS[slot].some((o) => o.id === id), slot + ' has no option ' + id);
      assert.notEqual(DEFAULT_LOOK[slot], id, 'the default look must not start locked: ' + slot);
      assert.ok(info.hint && info.name, 'a lock needs a hint and a stick name');
    }
  }
  // every stick locks one option, the cloud puppy included
  assert.equal(n, SPIRIT_STICKS.filter((s) => !s.unlock.later).length);
});

test('finding a stick unlocks exactly its option', () => {
  const all = lockedLooks(SPIRIT_STICKS, []);
  const found = ['party', 'skyHigh'];
  const left = lockedLooks(SPIRIT_STICKS, found);
  for (const u of unlocksFor(found)) {
    assert.ok(all[u.slot] && all[u.slot][u.id], 'was locked: ' + u.id);
    assert.ok(!(left[u.slot] && left[u.slot][u.id]), 'still locked: ' + u.id);
  }
  assert.deepEqual(lockedLooks(SPIRIT_STICKS, SPIRIT_STICKS.map((s) => s.id)), {});
  assert.deepEqual(lockedLooks(null, null), {});
});

test('touching: close by, a little above or below, never across a lawn', () => {
  const stick = { x: 10, y: 2, z: -4 };
  assert.ok(touching(stick, { x: 10.5, y: 2, z: -4.3 }));
  assert.ok(touching(stick, { x: 10, y: 3.5, z: -4 }));
  assert.ok(!touching(stick, { x: 12, y: 2, z: -4 }));
  assert.ok(!touching(stick, { x: 10, y: 6, z: -4 }));
  assert.ok(!touching(stick, { x: 10, y: -1, z: -4 }));
  assert.ok(!touching(null, { x: 0, y: 0, z: 0 }));
});
