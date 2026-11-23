// Whole games played by bots only, for every mode, over many seeds and room sizes, checking the
// invariants on every step: phases always move on (never stuck), rounds end on time, scores add
// up, the shared state stays small and clean, joining and leaving mid-game is safe, junk claims
// are refused, a new host can take over mid-round, and the same seed plays the same game.
// Run with: node --test "cloud-nine/test/*.test.mjs"

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSim } from '../js/games/sim.js';
import { MODES, MODE_IDS } from '../js/games/index.js';
import { ARENA_VARIANTS } from '../js/games/sample-arenas.js';
import { toLocal } from '../js/games/common.js';
import { mulberry32 } from '../js/core/util.js';

const NEXT = {
  lobby: ['countdown'],
  countdown: ['hide', 'play', 'results'],
  hide: ['play', 'results'],
  play: ['results'],
  results: ['lobby'],
};
const SEEDS = Number(process.env.GAMES_SEEDS || 10);

function allFinite(v, path = 'state') {
  if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path} is ${v}`);
  else if (Array.isArray(v)) v.forEach((x, i) => allFinite(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) allFinite(v[k], `${path}.${k}`);
}

/** Counts what happened from the fx stream, to check the scores against. */
function tally(kind) {
  return { kind, finds: 0, freezes: 0, rescues: 0, ko: [0, 0], caps: [0, 0], bonus: {} };
}

function count(t, sim, fx) {
  const st = sim.game.state;
  for (const f of fx) {
    if (f.type === 'found') t.finds++;
    else if (f.type === 'freeze') t.freezes++;
    else if (f.type === 'unfreeze') t.rescues++;
    else if (f.type === 'hit') t.ko[1 - st.players[f.ids[1]].team]++;
    else if (f.type === 'catch' && f.out) t.ko[st.players[f.ids[0]].team]++;
    else if (f.type === 'score') t.caps[f.team]++;
    else if (f.type === 'phase' && f.phase === 'countdown') {
      t.ko = [0, 0];
      t.caps = [0, 0];
    }
  }
}

function checkState(sim, t, label) {
  const g = sim.game;
  const st = g.state;
  const json = JSON.stringify(st);
  assert.ok(json.length < 4096, `${label}: state is ${json.length} bytes`);
  allFinite(JSON.parse(json));
  assert.deepEqual(Object.keys(st.players).sort(), [...st.order].sort(), `${label}: players match order`);
  assert.ok(st.order.length <= 10);
  const active = st.phase === 'countdown' || st.phase === 'hide' || st.phase === 'play';
  const ids = st.order;
  if (st.kind === 'hideSeek') {
    for (const id of ids) assert.ok(['hider', 'seeker', 'found'].includes(st.players[id].role));
    if (active && ids.length >= 2) assert.ok(ids.some((id) => st.players[id].role === 'seeker'), `${label}: a seeker`);
  } else if (st.kind === 'freezeTag') {
    for (const id of ids) {
      const p = st.players[id];
      assert.ok(!(p.role === 'it' && p.frozen), `${label}: "it" is never frozen`);
    }
    if (st.phase === 'play' && ids.length >= 2) assert.ok(ids.some((id) => st.players[id].role === 'it'), `${label}: someone is it`);
  } else if (st.kind === 'dodgeball') {
    const left = [0, 1].map((k) => ids.filter((id) => st.players[id].team === k && !st.players[id].out).length);
    assert.deepEqual(st.left, left, `${label}: players-left count`);
    const holders = new Set();
    for (const b of st.balls) {
      assert.ok(['ground', 'held', 'air'].includes(b.s));
      if (b.s === 'held') {
        assert.ok(st.players[b.by] && !st.players[b.by].out, `${label}: a ball held by someone in`);
        assert.ok(!holders.has(b.by), `${label}: one ball per player`);
        holders.add(b.by);
      }
      if (b.s === 'air') assert.ok(b.fl && b.fl.landT >= b.fl.t0);
    }
    if (st.phase === 'play') {
      assert.deepEqual(st.scores, t.ko, `${label}: knockouts add up`);
      const A = g.arena.area;
      for (const id of ids) {
        const p = st.players[id];
        const body = sim.bodies.get(id);
        if (p.out || !body) continue;
        const lz = toLocal(A.f, body.x, body.z).z;
        assert.ok(p.team === 0 ? lz <= 0.01 : lz >= -0.01, `${label}: ${id} stayed on their half`);
      }
    }
  } else if (st.kind === 'captureBow') {
    const carriers = new Set();
    for (const b of st.bows) {
      if (b.s === 'carried') {
        assert.ok(st.players[b.by] && st.players[b.by].team !== b.team, `${label}: carried by the other team`);
        assert.ok(!carriers.has(b.by));
        carriers.add(b.by);
      }
    }
    assert.ok(st.scores[0] <= st.settings.toWin && st.scores[1] <= st.settings.toWin);
    if (st.phase === 'play' || st.phase === 'results') assert.deepEqual(st.scores, t.caps, `${label}: captures add up`);
  }
  if (st.kind === 'hideSeek' || st.kind === 'freezeTag') {
    assert.deepEqual(Object.keys(st.scores).sort(), [...ids].sort());
  }
}

/**
 * Plays one round to its end and the next round's start, checking every step. `events(sim, step)`
 * may poke the room (joins, leaves, junk) along the way.
 */
function playRound(sim, { label, dt = 0.1, events } = {}) {
  const g0 = sim.game;
  const mode = MODES[g0.state.kind];
  const stepMs = Math.round(dt * 1000);
  const t = tally(g0.state.kind);
  let prev = g0.state.phase;
  let prevRound = g0.state.round;
  const firstRound = g0.state.round;
  const seen = [prev];
  const start = sim.now;
  const s = g0.state.settings;
  const limit = (3 + (mode.hasHide ? s.hideSeconds : 0) + (s.seekSeconds || s.playSeconds) + 8 + 13) * 1000;
  let steps = 0;
  while (sim.now - start < limit + 5000) {
    const before = sim.game.state.phaseEnds;
    const fx = sim.step(dt);
    steps++;
    count(t, sim, fx);
    const st = sim.game.state;
    if (st.phase !== prev || st.round !== prevRound) {
      assert.ok(NEXT[prev].includes(st.phase), `${label}: ${prev} -> ${st.phase}`);
      seen.push(st.phase);
      prev = st.phase;
      prevRound = st.round;
    } else if (before && sim.now > before + stepMs) {
      assert.fail(`${label}: stuck in ${st.phase} past its deadline`);
    }
    checkState(sim, t, `${label} t=${((sim.now - start) / 1000).toFixed(1)}`);
    if (events) events(sim, steps);
    if (st.phase === 'countdown' && st.round > firstRound) break;
  }
  const st = sim.game.state;
  assert.ok(seen.includes('results'), `${label}: reached results (${seen.join('>')})`);
  assert.equal(st.round, firstRound + 1, `${label}: the next round started`);
  return { seen, t, ms: sim.now - start, round: st.round };
}

for (const kind of MODE_IDS) {
  test(`${kind}: bot-only games always finish on time, scores add up, the next round starts`, () => {
    for (const n of [2, 3, 6, 10]) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const level = ['easy', 'normal', 'hard'][seed % 3];
        const sim = createSim({ kind, players: n, seed, strict: true, settings: { botLevel: level } });
        const { seen, round } = playRound(sim, { label: `${kind} n=${n} seed=${seed}` });
        const want = MODES[kind].hasHide ? ['lobby', 'countdown', 'hide', 'play', 'results', 'lobby', 'countdown'] : ['lobby', 'countdown', 'play', 'results', 'lobby', 'countdown'];
        // the sim starts the game at once, so the first lobby is already behind us
        assert.deepEqual(seen, want.slice(1), `${kind} n=${n} seed=${seed}`);
        assert.equal(round, 2);
      }
    }
  });

  test(`${kind}: smooth frames (30 fps) and odd arenas play fine too`, () => {
    for (const [k, arena] of ARENA_VARIANTS[kind].entries()) {
      for (let seed = 1; seed <= 3; seed++) {
        const sim = createSim({ kind, arena, players: 6, seed: seed * 31 + k, strict: true });
        playRound(sim, { label: `${kind} arena#${k} seed=${seed}`, dt: k === 0 ? 1 / 30 : 0.1 });
      }
    }
  });

  test(`${kind}: joining and leaving mid-game is safe, even for the seeker, "it", or whoever holds the ball or bow`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = mulberry32(seed * 977);
      const sim = createSim({ kind, players: 6, seed: seed + 100, strict: true });
      playRound(sim, {
        label: `${kind} churn seed=${seed}`,
        events(s) {
          if (r() > 0.02) return;
          const st = s.game.state;
          if (r() < 0.5 && st.order.length > 1) {
            // prefer someone important
            const key = st.order.filter((id) => {
              const p = st.players[id];
              return p.role === 'seeker' || p.role === 'it' || (st.balls && st.balls.some((b) => b.by === id)) || (st.bows && st.bows.some((b) => b.by === id));
            });
            const pool = key.length && r() < 0.6 ? key : st.order;
            s.remove(pool[Math.floor(r() * pool.length)]);
          } else s.add();
        },
      });
    }
  });

  test(`${kind}: down to one player ends the round kindly; new friends restart it`, () => {
    const sim = createSim({ kind, players: 4, seed: 5, strict: true });
    for (let i = 0; i < 40; i++) sim.step(0.1);
    for (const id of [...sim.game.state.order].slice(1)) sim.remove(id);
    sim.step(0.1);
    assert.equal(sim.game.state.phase, 'results');
    assert.equal(sim.game.state.result.winner, 'none');
    for (let i = 0; i < 100; i++) sim.step(0.1);
    assert.equal(sim.game.state.phase, 'lobby');
    assert.equal(sim.game.state.phaseEnds, 0, 'waits for players');
    sim.add();
    assert.ok(sim.game.state.phaseEnds > 0, 'a new friend restarts the countdown to the next round');
    for (let i = 0; i < 130; i++) sim.step(0.1);
    assert.equal(sim.game.state.phase === 'countdown' || sim.game.state.phase === 'hide' || sim.game.state.phase === 'play', true);
  });

  test(`${kind}: junk claims mid-game are refused and change nothing`, () => {
    const junk = [null, 7, 'x', [], {}, { type: 'found', target: '__proto__' }, { type: 'tag', target: 42.5 }, { type: 'grab', team: 'pink' },
      { type: 'throw', ballId: 'b0', from: { x: 'a', z: 0 }, dir: { x: 1, z: 0 } }, { type: 'hit', ballId: 'b0', target: 'someone-else' },
      { type: 'unfreeze', target: null }, { type: 'pickup', ballId: { id: 'b0' } }, { type: 'score', team: 0 }, { type: 'nope' }];
    for (let seed = 1; seed <= 4; seed++) {
      const r = mulberry32(seed);
      const sim = createSim({ kind, players: 6, seed: seed + 300, strict: true });
      playRound(sim, {
        label: `${kind} junk seed=${seed}`,
        events(s) {
          const st = s.game.state;
          const c = junk[Math.floor(r() * junk.length)];
          const from = r() < 0.2 ? 'stranger' : st.order[Math.floor(r() * st.order.length)];
          if (st.kind === 'captureBow' && c && c.type === 'score' && st.bows.some((b) => b.by === from)) return; // a real carrier may score
          const before = JSON.stringify(st);
          assert.equal(s.game.host.claim(from, c, s.view), false, JSON.stringify(c));
          assert.equal(JSON.stringify(s.game.state), before);
        },
      });
    }
  });

  test(`${kind}: a new host can take over mid-round from the shared state`, () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = mulberry32(seed * 7);
      const sim = createSim({ kind, players: 6, seed: seed + 500, strict: true });
      let handed = 0;
      playRound(sim, {
        label: `${kind} handover seed=${seed}`,
        events(s) {
          if (handed < 3 && r() < 0.01) {
            assert.equal(s.handover(seed * 13 + handed), true);
            handed++;
          }
        },
      });
    }
  });

  test(`${kind}: the same seed plays exactly the same game`, () => {
    const run = () => {
      const sim = createSim({ kind, players: 6, seed: 42 });
      for (let i = 0; i < 600; i++) sim.step(0.1);
      return JSON.stringify([sim.game.state, sim.log.map((f) => [f.t, f.type, f.id, f.ids])]);
    };
    assert.equal(run(), run());
  });
}

test('several rounds in a row: the seeker and "it" rotate, the round counter climbs', () => {
  for (const kind of ['hideSeek', 'freezeTag']) {
    const sim = createSim({ kind, players: 5, seed: 8, strict: true });
    const role = kind === 'hideSeek' ? 'seeker' : 'it';
    const had = new Set();
    for (let round = 1; round <= 5; round++) {
      for (const id of sim.game.state.order) if (sim.game.state.players[id].role === role) had.add(id);
      playRound(sim, { label: `${kind} round ${round}` });
    }
    assert.equal(sim.game.state.round, 6);
    assert.equal(had.size, 5, `${kind}: all five had a turn as ${role}`);
  }
});

test('people playing with the bot helpers: autoClaim and press make legal claims', () => {
  // one keyboard player who heads for whatever matters in each mode, pressing the button now and then
  const near = (from, list) => {
    let best = null;
    let bestD = Infinity;
    for (const q of list) {
      if (!q) continue;
      const d = Math.hypot(q.x - from.x, q.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  };
  for (const kind of MODE_IDS) {
    const accepted = {};
    for (let seed = 1; seed <= 4; seed++) {
      const sim = createSim({ kind, players: 4, humans: 1, seed: 20 + seed, strict: true, settings: { botLevel: 'easy' } });
      const me = sim.game.state.order[0];
      for (let i = 0; i < 2400 && sim.game.state.round === 1; i++) {
        const st = sim.game.state;
        const p = st.players[me];
        const body = sim.bodies.get(me);
        const others = (f) => st.order.filter((id) => id !== me && f(st.players[id])).map((id) => sim.bodies.get(id));
        let goal = null;
        if (kind === 'hideSeek') goal = p.role === 'hider' ? null : near(body, others((o) => o.role === 'hider'));
        else if (kind === 'freezeTag') goal = p.role === 'it' ? near(body, others((o) => o.role === 'runner' && !o.frozen)) : near(body, others((o) => o.frozen));
        else if (kind === 'dodgeball') {
          const mine = st.balls.find((b) => b.by === me);
          if (!mine) goal = near(body, st.balls.filter((b) => b.s === 'ground' && toLocal(sim.game.arena.area.f, b.x, b.z).z * (p.team === 0 ? -1 : 1) >= -0.5));
          if (mine && i % 10 === 0) sim.press(me);
        } else if (kind === 'captureBow') {
          const carrying = st.bows.some((b) => b.by === me);
          goal = carrying ? sim.game.arena.bases[p.team] : st.bows[1 - p.team];
        }
        if (goal) sim.steer(me, { x: goal.x - body.x, z: goal.z - body.z });
        else sim.steer(me, { x: 0, z: 0 });
        sim.step(0.05);
      }
      for (const [k, v] of Object.entries(sim.stats.byType)) if (k.endsWith(':ok')) accepted[k] = (accepted[k] || 0) + v;
    }
    const want = { hideSeek: ['found:ok'], freezeTag: ['tag:ok'], dodgeball: ['pickup:ok', 'throw:ok'], captureBow: ['grab:ok'] }[kind];
    for (const k of want) assert.ok(accepted[k] > 0, `${kind}: ${k} (${JSON.stringify(accepted)})`);
  }
});
