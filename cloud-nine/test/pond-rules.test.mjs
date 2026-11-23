// The duck pond (js/world/pond.js, js/art/island-layout.js makePond): where it is, what the network
// may send about it, how the ducklings follow their mama, the gift link's pondName, and the to-do goal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeIslandPlan, rectDistance, pondColliders, POND } from '../js/art/island-layout.js';
import { planDecor, spotFor } from '../js/art/island-decor.js';
import { beaconSpots } from '../js/world/beacons.js';
import { SPIRIT_STICKS } from '../js/content/collectibles.js';
import { cleanDuckFx, createFxGate, followStep, clampToPond, pondNameOk, DUCK_SNACKS, SNACK_IDS, DUCK_FACT } from '../js/world/pond.js';
import { validateGift, decodeGift, encodeGift } from '../js/core/gift.js';
import { TODO_IDS, cleanTodo, tickTodo, withTodoLock, TODO_REWARD } from '../js/ui/todo.js';
import { copyProblems } from './content-copy-rules.mjs';

const plan = makeIslandPlan();
const decor = planDecor(plan);
const P = plan.places;
const pond = plan.pond;
const G = plan.ground;
const FOOT = pond.r + 3.4; // the water, its stones, the dock's foot, the bench and the sign
const segD = (ax, az, bx, bz, x, z) => {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0));
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
};

test('the pond is a place: on the east lawn, 10 to 14 m across with its shore', () => {
  assert.deepEqual(Object.keys(P.pond).sort(), ['facing', 'r', 'x', 'z']);
  assert.equal(P.pond.x, pond.x);
  assert.ok(pond.r * 2 + 2 >= 10 && pond.r * 2 + 2 <= 14, 'water and stones');
  assert.ok(plan.main.margin(pond.x, pond.z) > FOOT + 3, 'well inside the rim');
  const near = plan.waterfalls.find((w) => Math.hypot(w.x - pond.x, w.z - pond.z) < 20);
  assert.ok(near, 'a waterfall spills off the rim beyond it');
});

test('the pond overlaps no place, path, hide spot, spirit stick, slide landing, beacon, flight line or the court', () => {
  const at = (x, z) => Math.hypot(x - pond.x, z - pond.z);
  // every other place's keep-out area (the scatter's list, minus the pond's own)
  for (const a of decor.areas) {
    if (a.kind === 'disc' && a.x === pond.x && a.z === pond.z) continue;
    const d = a.kind === 'disc' ? at(a.x, a.z) - a.r : rectDistance(pond.x, pond.z, a);
    assert.ok(d > FOOT, 'too close to an area at ' + a.x.toFixed(1) + ',' + a.z.toFixed(1) + ': ' + d.toFixed(1));
  }
  for (const p of plan.paths) {
    let best = Infinity;
    for (let i = 0; i < p.pts.length - 1; i++) best = Math.min(best, segD(p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1], pond.x, pond.z));
    assert.ok(best - p.w / 2 > FOOT, 'path ' + p.id);
  }
  for (const h of P.hideGarden.hideSpots) assert.ok(at(h.x, h.z) > FOOT + 5, 'hide spot ' + h.id);
  for (const st of SPIRIT_STICKS) {
    const s = spotFor(plan, decor, st.where);
    assert.ok(s && at(s.x, s.z) > FOOT + 2, 'spirit stick ' + st.id);
  }
  for (const s of plan.secrets) assert.ok(at(s.x, s.z) > FOOT + 2, 'secret ' + s.id);
  for (const s of plan.slides) {
    assert.ok(at(s.x1, s.z1) > FOOT + 4, 'slide landing ' + s.id);
    assert.ok(segD(s.x0, s.z0, s.x1, s.z1, pond.x, pond.z) > FOOT, 'slide ' + s.id);
  }
  plan.toss.pads.forEach((pad, k) => {
    const pf = plan.platforms[k];
    assert.ok(segD(pad.x, pad.z, pf.x, pf.z, pond.x, pond.z) > FOOT + 10, 'flight line ' + pad.id);
  });
  for (const b of beaconSpots(P, () => 0)) if (b.id !== 'pond') assert.ok(at(b.x, b.z) > FOOT + 5, 'beacon ' + b.id);
  assert.ok(rectDistance(pond.x, pond.z, P.court) > FOOT + 2, 'the dodgeball court');
  for (const k of plan.knolls) assert.ok(at(k.x, k.z) > FOOT, 'a knoll');
});

test('the dock is walkable, the water is not, and the ground never drops away (no rescue cloud)', () => {
  const R = 0.42; // player radius
  const hits = (x, z) => decor.colliders.some((c) => (c.kind === 'circle' ? Math.hypot(x - c.x, z - c.z) < c.r + R : rectDistance(x, z, { x: c.x, z: c.z, w: c.w, d: c.d, facing: c.rot }) < R));
  // the dock: a step up from the shore, clear all the way to its end
  assert.ok(Math.abs(G.groundAt(pond.dock.x, pond.dock.z) - pond.dock.y) < 1e-9);
  assert.ok(pond.dock.y - pond.y < 0.35 && pond.dock.y > pond.water);
  for (let s = 0; s <= 1; s += 0.1) {
    const x = pond.foot.x + (pond.end.x - pond.foot.x) * s;
    const z = pond.foot.z + (pond.end.z - pond.foot.z) * s;
    assert.ok(!hits(x, z), 'the way along the dock, ' + s.toFixed(1));
  }
  // round the water: stones and rails all the way, and solid ground under it all
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    for (const r of [pond.r * 0.3, pond.r * 0.8]) {
      const x = pond.x + Math.sin(a) * r;
      const z = pond.z + Math.cos(a) * r;
      assert.ok(Number.isFinite(G.groundAt(x, z)), 'ground under the water');
    }
    // walking in from 9 m out along this bearing stops at the rim (unless it is the dock's way in)
    let x = pond.x + Math.sin(a) * 9;
    let z = pond.z + Math.cos(a) * 9;
    let stopped = false;
    for (let r = 9; r > pond.r - 0.2; r -= 0.05) {
      x = pond.x + Math.sin(a) * r;
      z = pond.z + Math.cos(a) * r;
      if (hits(x, z)) {
        stopped = true;
        break;
      }
    }
    const onDockLine = Math.abs(Math.sin(a - pond.facing)) * pond.r < POND.dockW / 2 + 0.1 && Math.cos(a - pond.facing) > 0;
    if (!onDockLine) assert.ok(stopped, 'the rim stops her at bearing ' + a.toFixed(2));
  }
  assert.ok(pondColliders(pond).every((c) => c.tag === 'pond'));
  // the travel spot and the spot lookup: on the shore at the dock's foot
  const s = spotFor(plan, decor, { place: 'pond' });
  assert.ok(s && !hits(s.x, s.z) && Number.isFinite(s.y));
});

test("a friend's 'ducks' fx: junk, far-away points and unknown snacks are dropped, near points pulled into the water", () => {
  const p = { x: pond.x, z: pond.z, r: pond.r };
  for (const bad of [null, 1, 'ducks', [], {}, { kind: 'booth' }, { kind: 'ducks' }, { kind: 'ducks', snack: 'cake', x: p.x, z: p.z },
    { kind: 'ducks', snack: 'bread', x: NaN, z: 0 }, { kind: 'ducks', snack: 'bread', x: '41', z: -1 }, { kind: 'ducks', snack: 'bread', x: Infinity, z: 0 },
    { kind: 'ducks', snack: 'Bread', x: p.x, z: p.z }, { kind: 'ducks', snack: ['bread'], x: p.x, z: p.z }, { kind: 'ducks', snack: 'bread', x: 1e9, z: 1e9 }]) {
    assert.equal(cleanDuckFx(bad, p), null, JSON.stringify(bad));
  }
  assert.equal(cleanDuckFx({ kind: 'ducks', snack: 'corn', x: p.x + 40, z: p.z }, p), null, 'far away');
  assert.equal(cleanDuckFx({ kind: 'ducks', snack: 'corn', x: 0, z: 0 }, p), null, 'from the plaza? no');
  const near = cleanDuckFx({ kind: 'ducks', snack: 'peas', x: p.x + p.r + 3, z: p.z, extra: '<b>hi</b>' }, p);
  assert.deepEqual(Object.keys(near).sort(), ['snack', 'x', 'z']);
  assert.equal(near.snack, 'peas');
  assert.ok(Math.hypot(near.x - p.x, near.z - p.z) <= p.r - 0.6, 'pulled inside the water');
  const mid = cleanDuckFx({ kind: 'ducks', snack: 'bread', x: p.x + 1, z: p.z - 1 }, p);
  assert.deepEqual([mid.x, mid.z], [p.x + 1, p.z - 1]);
  assert.equal(cleanDuckFx({ kind: 'ducks', snack: 'bread', x: 1, z: 1 }, null), null);
  const c = clampToPond(p, p.x + 100, p.z, 0.5);
  assert.ok(Math.abs(Math.hypot(c.x - p.x, c.z - p.z) - (p.r - 0.5)) < 1e-9);
});

test('spam from one friend is rate-limited; other friends still get through', () => {
  const gate = createFxGate({ gap: 0.45, burst: 4, per: 5, max: 3 });
  let t = 0;
  let ok = 0;
  for (let i = 0; i < 100; i++) {
    if (gate.allow('spammer', t)) ok++;
    t += 0.05; // 20 a second for 5 seconds
  }
  assert.ok(ok >= 4 && ok <= 9, 'a burst, then a trickle: ' + ok);
  assert.equal(gate.allow('friend', t), true);
  assert.equal(gate.allow('friend', t + 0.1), false, 'a double tap is one toss');
  assert.equal(gate.allow('friend', t + 0.6), true);
  // a quiet friend's bucket fills up again
  assert.equal(gate.allow('spammer', t + 10), true);
  for (const bad of [null, '', 7, {}]) assert.equal(gate.allow(bad, t), false);
  assert.equal(gate.allow('x', NaN), false);
  for (let i = 0; i < 10; i++) gate.allow('who' + i, t);
  assert.ok(gate.size <= 3, 'it never remembers too many senders');
});

test('four ducklings follow their mama in a wobbly line, a string apart, and never pile up', () => {
  const SP = 0.5;
  const mama = { x: 0, z: 0, h: 0 };
  const kids = [1, 2, 3, 4].map((i) => ({ x: -0.3 * i, z: -0.2 * i, h: 0 }));
  const dt = 1 / 30;
  let t = 0;
  for (let step = 0; step < 30 * 40; step++) {
    t += dt;
    // mama swims a slow circle, radius 2.5 m
    mama.x = Math.sin(t * 0.12) * 2.5;
    mama.z = Math.cos(t * 0.12) * 2.5;
    kids.forEach((k, i) => followStep(k, i ? kids[i - 1] : mama, SP, dt, 0.8));
    if (step > 30 * 5) {
      for (let i = 0; i < kids.length; i++) {
        const lead = i ? kids[i - 1] : mama;
        const d = Math.hypot(lead.x - kids[i].x, lead.z - kids[i].z);
        assert.ok(d <= SP + 0.06, 'duckling ' + i + ' keeps up: ' + d.toFixed(3));
        assert.ok(d >= SP * 0.5, 'duckling ' + i + ' never bumps the one ahead: ' + d.toFixed(3));
      }
    }
  }
  // they trail behind her along her path, each one facing the duck ahead
  const back = Math.hypot(kids[3].x - mama.x, kids[3].z - mama.z);
  assert.ok(back > 1.2 && back <= 4 * SP + 0.2, 'the line stretches out behind her: ' + back.toFixed(2));
  const k0 = kids[0];
  const toMama = Math.atan2(mama.x - k0.x, mama.z - k0.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(toMama - k0.h), Math.cos(toMama - k0.h))) < 0.05);
  // a slack string: nothing moves
  const f = { x: 0, z: 0, h: 1 };
  assert.equal(followStep(f, { x: 0.2, z: 0 }, SP, dt), 0);
  assert.equal(followStep(f, { x: 0, z: 0 }, SP, dt), 0);
  assert.equal(followStep(f, { x: 5, z: 0 }, SP, 0), 0);
  assert.deepEqual([f.x, f.z], [0, 0]);
});

test('snacks: bread first (their favourite), then peas and corn; the fact and names follow the house rules', () => {
  assert.deepEqual([...SNACK_IDS], ['bread', 'peas', 'corn']);
  assert.equal(DUCK_SNACKS[0].fave, true);
  assert.deepEqual(copyProblems(DUCK_FACT, 'fact', { max: 40 }), []);
  for (const s of DUCK_SNACKS) assert.deepEqual(copyProblems(s.label, s.id, { max: 8 }), []);
  assert.equal(pondNameOk("  Zuzu's   Duck Pond "), "Zuzu's Duck Pond");
  assert.equal(pondNameOk('x'.repeat(25)), null);
  assert.equal(pondNameOk(42), null);
});

test("the gift link's pondName: letters, spaces, ' and -, up to 24, through the word filter", () => {
  const name = (v) => validateGift({ v: 1, pondName: v });
  assert.equal(name("Zuzu's Duck Pond").gift.pondName, "Zuzu's Duck Pond");
  assert.equal(name('Pip and Bo-Bo Pond').gift.pondName, 'Pip and Bo-Bo Pond');
  assert.equal(name('  Zork’s   Quack  Spot ').gift.pondName, "Zork's Quack Spot", 'curly apostrophes and spaces tidied');
  assert.equal(name('Zuzu​ Pond').gift.pondName, 'Zuzu Pond', 'invisible characters go');
  assert.equal(name('Biscuit Bay Duck Pond Yay').gift.pondName, undefined, '25 characters is one too many');
  assert.equal(name('Abcdefghijklmnopqrstuvwx').gift.pondName, 'Abcdefghijklmnopqrstuvwx', '24 is fine');
  for (const bad of ['', '   ', 42, null, ['Pond'], "'Pond", '-Pond', 'Pond 2', 'Pond.', 'Pond!', 'Duck <b>Pond</b>', 'www.pond.com', 'Poop Pond']) {
    const r = name(bad);
    assert.equal(r.gift.pondName, undefined, JSON.stringify(bad));
    assert.ok(r.dropped.some((d) => d.path === 'pondName'), JSON.stringify(bad) + ' is listed as left out');
  }
  // it survives the link, and old links without it are unchanged
  const gift = validateGift({ v: 1, from: 'Uncle Wobble', pondName: "Zuzu's Duck Pond" }).gift;
  assert.deepEqual(decodeGift(encodeGift(gift)), gift);
  assert.deepEqual(validateGift({ v: 1, from: 'Uncle Wobble' }).gift, { v: 1, from: 'Uncle Wobble' });
});

test("'Feed the ducks' joins the to-do list; a list already won stays won, and the bow stays hers", () => {
  assert.ok(TODO_IDS.includes('ducks'));
  const old = ['toss', 'land', 'stage', 'game', 'photo', 'stick', 'look', 'cheer'];
  // saved before the pond: all eight done and the gold bow won
  const before = cleanTodo({ done: old, seen: 1, won: 1 });
  assert.equal(before.won, true, 'still won');
  assert.ok(!withTodoLock({}, before)[TODO_REWARD.slot], 'the gold bow stays unlocked');
  const r = tickTodo(before, 'ducks');
  assert.equal(r.added, true);
  assert.equal(r.all, true);
  assert.equal(r.state.won, true);
  // a new player needs all nine
  let s = cleanTodo(null);
  for (const id of old) s = tickTodo(s, id).state;
  assert.equal(s.won, false);
  assert.ok(withTodoLock({}, s)[TODO_REWARD.slot][TODO_REWARD.id], 'locked until the ducks are fed too');
  assert.ok(/all 9/i.test(withTodoLock({}, s)[TODO_REWARD.slot][TODO_REWARD.id].hint));
  const done = tickTodo(s, 'ducks');
  assert.equal(done.all, true);
  assert.ok(!withTodoLock({}, done.state)[TODO_REWARD.slot]);
  // a hand-edited "won" without the work is still not won
  assert.equal(cleanTodo({ done: ['toss'], won: 1 }).won, false);
});
