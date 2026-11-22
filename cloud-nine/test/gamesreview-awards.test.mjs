// Games review: end-of-round awards for everyone, bots that walk round hedges, the auto bench
// time in dodgeball, and a hider who can tell she is hidden. Pure (no three.js, no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, MODE_IDS } from '../js/games/index.js';
import { createSim } from '../js/games/sim.js';
import { AWARDS, pickAwards, cleanAwards, awardRows } from '../js/games/awards.js';
import { navigate } from '../js/games/common.js';
import { comebackMs } from '../js/games/dodgeball.js';
import { SAMPLE_PLACES } from '../js/games/sample-arenas.js';
import { mulberry32 } from '../js/core/util.js';
import { copyProblems } from './content-copy-rules.mjs';

test('awards: every award reads well (house rules, praise, short)', () => {
  const problems = [];
  for (const [id, a] of Object.entries(AWARDS)) {
    problems.push(...copyProblems(a.title, `${id}.title`, { max: 22, praise: true }));
    problems.push(...copyProblems(a.line, `${id}.line`, { max: 44, praise: true }));
    assert.equal(typeof a.icon, 'string', id);
  }
  assert.deepEqual(problems, []);
});

test('awards: everybody gets one at the results, bots included, in every game', () => {
  for (const kind of MODE_IDS) {
    for (const players of [2, 6, 10]) {
      const sim = createSim({ kind, players, humans: 1, seed: players * 7 + kind.length, settings: { playSeconds: 60, seekSeconds: 60, hideSeconds: 20 } });
      for (let i = 0; i < 30 * 200 && sim.game.state.phase !== 'results'; i++) sim.step(1 / 30);
      if (sim.game.state.phase !== 'results') sim.game.host.end(sim.now);
      const st = sim.game.state;
      assert.equal(st.phase, 'results', `${kind} ${players}: reached the results`);
      const a = st.result.awards;
      assert.ok(a, `${kind} ${players}: awards`);
      for (const id of st.order) assert.ok(Object.prototype.hasOwnProperty.call(AWARDS, a[id]), `${kind} ${players}: ${id} has an award`);
      // the HUD view: my award first, everyone listed
      const u = sim.game.ui(st.order[0]);
      assert.ok(u.awards && u.awards.mine && u.awards.mine.me, `${kind}: my award`);
      assert.equal(u.awards.rows.length, st.order.length, `${kind}: everybody listed`);
      // a client copy keeps them (JSON round trip through applyState)
      const client = createGame(kind, { arena: SAMPLE_PLACES, players: [], now: () => sim.now });
      assert.ok(client.applyState(JSON.parse(JSON.stringify(st))));
      assert.deepEqual(client.state.result.awards, a, `${kind}: awards travel`);
    }
  }
});

test('awards: the picker gives top awards to the best, spreads the rest, never skips anyone', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const stats = { a: 3, b: 0, c: 1, d: 0, e: 0 };
  const out = pickAwards(order, [
    { id: 'eagle', score: (id) => stats[id] },
    { id: 'helper', score: (id) => stats[id] },
    { id: 'sneaky', many: true, score: (id) => (id === 'd' || id === 'e' ? 1 : 0) },
  ]);
  assert.equal(out.a, 'eagle');
  assert.equal(out.c, 'helper');
  assert.equal(out.d, 'sneaky');
  assert.equal(out.e, 'sneaky');
  assert.ok(['fullOut', 'spirit', 'hustle', 'hype'].includes(out.b));
  assert.deepEqual(Object.keys(pickAwards(order, null)).sort(), order);
  // a broken candidate never breaks the results
  const safe = pickAwards(order, [{ id: 'eagle', score: () => { throw new Error('x'); } }, { id: 'nope', score: () => 1 }]);
  assert.equal(Object.keys(safe).length, 5);
});

test('awards: untrusted award state is cleaned (known ids, known players, no prototype keys)', () => {
  const players = { a: {}, b: {} };
  const raw = JSON.parse('{"a":"eagle","b":"<b>hi</b>","zz":"sneaky","__proto__":"eagle","constructor":"spirit"}');
  assert.deepEqual(cleanAwards(raw, players), { a: 'eagle' });
  assert.equal(cleanAwards('eagle', players), null);
  assert.equal(cleanAwards({ b: 'toString' }, players), null);
  const rows = awardRows({ a: 'eagle', b: 'spirit' }, ['a', 'b'], (id) => id.toUpperCase(), 'b');
  assert.equal(rows.mine.title, AWARDS.spirit.title);
  assert.deepEqual(rows.rows.map((r) => r.name), ['A', 'B']);
});

test('bots walk round a long hedge when the host can tell them where it is', () => {
  // a wall across the way, 8 m long, between the bot and its goal
  const solid = (x, z) => Math.abs(z) < 0.6 && Math.abs(x) < 4;
  const run = (withSolid) => {
    const mem = withSolid ? { solid } : {};
    const rng = mulberry32(3);
    const pos = { x: 0.3, z: -5 };
    const goal = { x: 0, z: 5 };
    let t = 0;
    for (; t < 30; t += 1 / 30) {
      const v = navigate(mem, pos, goal, 5, 1 / 30, rng);
      const nx = pos.x + v.x / 30;
      const nz = pos.z + v.z / 30;
      if (!solid(nx, nz)) {
        pos.x = nx;
        pos.z = nz;
      } else if (!solid(nx, pos.z)) pos.x = nx; // slide along it, like the colliders do
      if (Math.hypot(pos.x - goal.x, pos.z - goal.z) < 0.5) break;
    }
    return t;
  };
  const smart = run(true);
  assert.ok(smart < 6, `round the hedge in ${smart.toFixed(1)} s`);
});

test('dodgeball: the bench is quicker in a small game (auto), and the setting still wins', () => {
  const g6 = createGame('dodgeball', { arena: SAMPLE_PLACES, players: ['a', 'b', 'c', 'd', 'e', 'f'], now: () => 0 });
  const internal6 = { st: g6.state };
  assert.equal(comebackMs(internal6), 12000);
  const g10 = createGame('dodgeball', { arena: SAMPLE_PLACES, players: 'abcdefghij'.split(''), now: () => 0 });
  assert.equal(comebackMs({ st: g10.state }), 18000);
  const g = createGame('dodgeball', { arena: SAMPLE_PLACES, players: ['a', 'b'], now: () => 0, settings: { comebackSeconds: 20 } });
  assert.equal(comebackMs({ st: g.state }), 20000);
});

test('hide and seek: a hider tucked into a spot is told she is hidden', () => {
  const sim = createSim({ kind: 'hideSeek', players: 4, humans: 1, seed: 4 });
  for (let i = 0; i < 200 && sim.game.state.phase !== 'hide'; i++) sim.step(1 / 30);
  const me = sim.game.state.order.find((id) => sim.game.state.players[id].role === 'hider' && !sim.game.state.players[id].bot);
  if (!me) return; // the rotation made the human the seeker in this seed: nothing to check
  const spot = sim.game.arena.spots[0];
  const body = sim.bodies.get(me);
  body.x = spot.x;
  body.z = spot.z;
  sim.game.autoClaim(me, sim.view, sim.now);
  const u = sim.game.ui(me, sim.now);
  assert.equal(u.roleBadge.text, 'Hidden!');
  assert.match(u.line, /hidden/i);
  body.x = sim.game.arena.start.x;
  body.z = sim.game.arena.start.z;
  assert.equal(sim.game.ui(me, sim.now).roleBadge.text, 'Hider');
});
