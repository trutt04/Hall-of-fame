// Rules of the four Cloud Nine games (Contract 5), one claim at a time, with hand-placed players.
// Run with: node --test "cloud-nine/test/*.test.mjs"

import test from 'node:test';
import assert from 'node:assert/strict';

import { MODES, MODE_IDS, createGame, settingsFor, ballPos } from '../js/games/index.js';
import { SAMPLE_PLACES, ARENA_VARIANTS } from '../js/games/sample-arenas.js';
import { frame, toLocal, toWorld } from '../js/games/common.js';
import { mulberry32 } from '../js/core/util.js';

const T0 = 1000000;

/** A room where the test places everyone by hand. Teleport fx move people, like the app would. */
function room(kind, { n = 4, settings, arena, humans = true } = {}) {
  let now = T0;
  const pos = new Map();
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: `p${i + 1}`, nick: `Kid ${String.fromCharCode(65 + i)}`, bot: !humans });
  const game = createGame(kind, {
    arena: arena === undefined ? SAMPLE_PLACES[MODES[kind].place] : arena,
    players,
    rng: mulberry32(11),
    now: () => now,
    settings,
    strict: true,
  });
  const c = game.arena.area.f;
  for (const p of players) pos.set(p.id, { x: c.x, z: c.z });
  const view = { pos: (id) => pos.get(id) || null, ids: () => [...pos.keys()] };
  const fxLog = [];
  const r = {
    game,
    pos,
    view,
    fxLog,
    get now() {
      return now;
    },
    get st() {
      return game.state;
    },
    at(id, x, z) {
      pos.set(id, { x, z });
    },
    tick(ms = 50) {
      now += ms;
      const fx = game.host.tick(now, view);
      for (const f of fx) {
        if (f.type === 'teleport' && pos.has(f.id)) pos.set(f.id, { x: f.x, z: f.z });
        fxLog.push(f);
      }
      return fx;
    },
    run(ms, step = 50) {
      const out = [];
      for (let t = 0; t < ms; t += step) out.push(...r.tick(step));
      return out;
    },
    claim(id, c) {
      return game.host.claim(id, c, view);
    },
    toPlay() {
      assert.equal(game.host.start(now), true);
      r.run(3050);
      if (game.state.phase === 'hide') r.run(game.state.phaseEnds - now + 50);
      assert.equal(game.state.phase, 'play');
    },
    role(role) {
      return game.state.order.filter((id) => game.state.players[id].role === role);
    },
    team(t) {
      return game.state.order.filter((id) => game.state.players[id].team === t);
    },
  };
  return r;
}

const MEAN = /\b(lose|loser|losers|lost|fail|failed|stupid|dumb|bad|worst|idiot|hate|ugly|fat|cry|dead|die|kill)\b/i;

// ---------------------------------------------------------------------------------------------
// creation, settings, phases
// ---------------------------------------------------------------------------------------------

test('MODES have the same shape and createGame builds every mode', () => {
  assert.deepEqual(MODE_IDS, ['hideSeek', 'freezeTag', 'dodgeball', 'captureBow']);
  for (const kind of MODE_IDS) {
    const m = MODES[kind];
    for (const key of ['kind', 'title', 'place', 'minPlayers', 'settings', 'arena', 'claim', 'bot', 'ui', 'who']) assert.ok(key in m, `${kind}.${key}`);
    assert.equal(m.kind, kind);
    assert.ok(m.settings.some((s) => s.id === 'botLevel'), `${kind} has a bot difficulty setting`);
    const g = createGame(kind, { arena: SAMPLE_PLACES[m.place], players: ['a', 'b'], rng: mulberry32(1), now: T0 });
    for (const key of ['kind', 'phase', 'phaseEnds', 'round', 'scores']) assert.ok(key in g.state, `${kind} state.${key}`);
    assert.equal(g.state.phase, 'lobby');
    assert.equal(g.state.round, 1);
    for (const fn of ['tick', 'claim', 'addPlayer', 'removePlayer']) assert.equal(typeof g.host[fn], 'function');
    for (const fn of ['bot', 'applyState', 'ui']) assert.equal(typeof g[fn], 'function');
    // the whole places object works too, and so does nothing at all
    const g2 = createGame(kind, { arena: SAMPLE_PLACES, players: ['a', 'b'] });
    assert.deepEqual(g2.arena.area, g.arena.area);
    for (const arena of [undefined, null, 42, 'court', [], ...ARENA_VARIANTS[kind]]) {
      const g3 = createGame(kind, { arena, players: ['a', 'b'], rng: mulberry32(2), now: T0 });
      assert.ok(Number.isFinite(g3.arena.area.hw) && g3.arena.area.hw >= 2, `${kind} arena fallback`);
    }
  }
  assert.throws(() => createGame('tag', {}), /Unknown game/);
  assert.throws(() => createGame('__proto__', {}), /Unknown game/);
});

test('players come as ids, objects or a Map; junk ids are dropped; at most 10', () => {
  const map = new Map([['u1', { id: 'u1', nick: 'Star  Girl!!', bot: false }], ['b1', { id: 'b1', nick: 'Bot', bot: true }]]);
  const g = createGame('freezeTag', { arena: SAMPLE_PLACES.tagZone, players: map });
  assert.deepEqual(g.state.order, ['u1', 'b1']);
  assert.equal(g.state.players.u1.nick, 'Star Girl');
  assert.equal(g.state.players.b1.bot, true);
  const junk = ['ok1', '', null, 7, '__proto__', 'constructor', 'a b', 'x'.repeat(65), { id: 'ok2' }, { id: '<script>' }, 'ok1'];
  const g2 = createGame('freezeTag', { players: junk });
  assert.deepEqual(g2.state.order, ['ok1', '7', 'ok2']);
  const many = Array.from({ length: 14 }, (_, i) => `k${i}`);
  const g3 = createGame('dodgeball', { players: many });
  assert.equal(g3.state.order.length, 10);
  assert.equal(g3.host.addPlayer('extra'), false, 'room is full');
});

test('settings snap to the allowed options and fall back to defaults', () => {
  const s = settingsFor('hideSeek', { hideSeconds: 33, seekSeconds: 'lots', hintSeconds: 0, seekers: 2, botLevel: 'impossible' });
  assert.equal(s.hideSeconds, 30);
  assert.equal(s.seekSeconds, 120);
  assert.equal(s.hintSeconds, 0);
  assert.equal(s.seekers, 2);
  assert.equal(s.botLevel, 'normal');
  assert.deepEqual(settingsFor('nope', {}), {});
  const g = createGame('dodgeball', { players: ['a', 'b'], settings: { playSeconds: 1e9, ballSpeed: -5, __proto__: { x: 1 } } });
  assert.equal(g.state.settings.playSeconds, 180);
  assert.equal(g.state.settings.ballSpeed, 10);
});

test('phases: lobby waits, countdown says 5 6 7 8, play, 8 s of results, then the next round starts by itself', () => {
  for (const kind of MODE_IDS) {
    const r = room(kind, { n: 4 });
    const g = r.game;
    r.run(30000);
    assert.equal(g.state.phase, 'lobby', `${kind}: the first lobby waits for the host`);
    assert.equal(g.ui('p1').line, 'Waiting for the host to start');
    assert.equal(g.host.start(r.now), true);
    assert.equal(g.state.phase, 'countdown');
    const bigs = [];
    const counts = [];
    for (let t = 0; t < 3000; t += 50) {
      const b = g.ui('p1').big;
      if (b && bigs[bigs.length - 1] !== b.text) bigs.push(b.text);
      for (const f of r.tick(50)) if (f.type === 'count') counts.push(f.n);
    }
    assert.deepEqual(bigs, ['5', '6', '7', '8!']);
    assert.deepEqual(counts, [5, 6, 7, 8]);
    assert.equal(g.state.phase, MODES[kind].hasHide ? 'hide' : 'play');
    if (g.state.phase === 'hide') r.run(30000);
    assert.equal(g.state.phase, 'play');
    assert.equal(g.host.end(r.now), true);
    assert.equal(g.state.phase, 'results');
    assert.equal(g.state.phaseEnds - r.now, 8000);
    r.run(8000);
    assert.equal(g.state.phase, 'lobby');
    assert.equal(g.state.round, 2);
    assert.ok(g.state.phaseEnds > r.now, 'later lobbies count down to the next round');
    r.run(12000);
    assert.equal(g.state.phase, 'countdown', `${kind}: round 2 started by itself`);
  }
});

test('start needs enough players; a lone player gets a friendly hint; botsNeeded fills sensibly', () => {
  const r = room('dodgeball', { n: 1 });
  assert.equal(r.game.host.start(r.now), false);
  assert.match(r.game.ui('p1').line, /add a bot/);
  assert.equal(r.game.host.botsNeeded(), 3);
  assert.equal(r.game.host.botsNeeded(6), 5);
  assert.equal(r.game.host.addPlayer('bot1', { nick: 'Robo', bot: true }), true);
  assert.equal(r.game.host.addPlayer('bot1', { nick: 'Robo' }), false, 'no duplicates');
  assert.equal(r.game.host.start(r.now), true);
  const r5 = room('captureBow', { n: 5 });
  assert.equal(r5.game.host.botsNeeded(), 1, 'even teams');
});

// ---------------------------------------------------------------------------------------------
// hide and seek
// ---------------------------------------------------------------------------------------------

test('hide and seek: one seeker, two with 7 or more; the seeker counts blind during the hide phase', () => {
  for (const [n, want] of [[2, 1], [6, 1], [7, 2], [10, 2]]) {
    const r = room('hideSeek', { n });
    r.game.host.start(r.now);
    assert.equal(r.role('seeker').length, want, `${n} players`);
  }
  const r = room('hideSeek', { n: 5 });
  r.game.host.start(r.now);
  r.run(3050);
  assert.equal(r.st.phase, 'hide');
  const [seeker] = r.role('seeker');
  const hider = r.role('hider')[0];
  assert.equal(r.game.ui(seeker).blind, true);
  assert.equal(r.game.who(seeker).canMove, false);
  assert.equal(r.game.who(seeker).anim, 'seek');
  assert.equal(r.game.ui(hider).blind, false);
  assert.equal(r.game.who(hider).canMove, true);
  // no finding while the seeker counts
  r.at(seeker, 30, -30);
  r.at(hider, 30.5, -30);
  assert.equal(r.claim(seeker, { type: 'found', target: hider }), false);
});

test('hide and seek: found within 2 m; found hiders seek too; all found = seekers win', () => {
  const r = room('hideSeek', { n: 4 });
  r.toPlay();
  const [seeker] = r.role('seeker');
  const [h1, h2, h3] = r.role('hider');
  r.at(seeker, 30, -30);
  r.at(h1, 31.5, -30);
  r.at(h2, 45, -40);
  r.at(h3, 50, -20);
  assert.equal(r.claim(h2, { type: 'found', target: h1 }), false, 'hiders cannot find');
  assert.equal(r.claim(seeker, { type: 'found', target: h2 }), false, 'too far');
  assert.equal(r.claim(seeker, { type: 'found', target: seeker }), false, 'not yourself');
  assert.equal(r.claim(seeker, { type: 'found', target: 'nobody' }), false);
  assert.equal(r.claim(seeker, { type: 'found' }), false);
  assert.equal(r.claim(seeker, { type: 'found', target: h1 }), true);
  assert.equal(r.claim(seeker, { type: 'found', target: h1 }), false, 'already found');
  assert.equal(r.st.players[h1].role, 'found');
  assert.equal(r.st.scores[seeker], 1);
  // the found hider is on the seeking team now
  r.at(h1, 44, -40);
  assert.equal(r.claim(h1, { type: 'found', target: h2 }), true);
  assert.equal(r.st.scores[h1], 1);
  assert.match(r.game.fxText(r.tick().concat(r.fxLog).find((f) => f.type === 'found'), seeker), /^You found/);
  r.at(seeker, 49, -20);
  assert.equal(r.claim(seeker, { type: 'found', target: h3 }), true);
  assert.equal(r.st.phase, 'results');
  assert.equal(r.st.result.winner, 'seekers');
  assert.ok(r.st.result.ids.includes(seeker) && r.st.result.ids.includes(h1));
  assert.ok(r.game.who(seeker).winner);
});

test('hide and seek: sparkle hints every 30 s; hiders still hidden at the end win and score', () => {
  const r = room('hideSeek', { n: 3 });
  r.toPlay();
  const [seeker] = r.role('seeker');
  const hiders = r.role('hider');
  r.at(seeker, 30, -20);
  r.at(hiders[0], 46, -25); // in bush2
  r.at(hiders[1], 53, -32); // in tent1
  assert.equal(r.game.who(hiders[0], r.pos.get(hiders[0])).hidden, true);
  assert.equal(r.game.who(hiders[0], r.pos.get(hiders[0])).pose, 'hide');
  const fx = r.run(30100);
  const hints = fx.filter((f) => f.type === 'hint');
  assert.equal(hints.length, 1);
  assert.equal(hints[0].spots.length, 2);
  assert.deepEqual(r.st.hint.spots[0], { x: 46, z: -25 });
  r.run(r.st.phaseEnds - r.now + 50);
  assert.equal(r.st.phase, 'results');
  assert.equal(r.st.result.winner, 'hiders');
  assert.deepEqual([...r.st.result.ids].sort(), [...hiders].sort());
  for (const h of hiders) assert.equal(r.st.scores[h], 2);
  assert.equal(r.game.ui(hiders[0]).big.text, 'Hiders win!');
  assert.doesNotMatch(r.game.ui(seeker).big.sub, MEAN);
});

test('hide and seek: the seeker rotates every round, so everyone gets a turn', () => {
  const r = room('hideSeek', { n: 4 });
  const seen = [];
  r.game.host.start(r.now);
  for (let round = 0; round < 4; round++) {
    seen.push(...r.role('seeker'));
    r.run(3050 + 30000);
    r.game.host.end(r.now);
    r.run(8000 + 12000 + 100);
    assert.equal(r.st.phase, 'countdown');
  }
  assert.deepEqual([...seen].sort(), ['p1', 'p2', 'p3', 'p4']);
});

test('hide and seek: the seeker leaving mid-round hands the job over; the round goes on', () => {
  const r = room('hideSeek', { n: 4 });
  r.toPlay();
  const [seeker] = r.role('seeker');
  assert.equal(r.game.host.removePlayer(seeker), true);
  assert.equal(r.st.phase, 'play');
  assert.equal(r.role('seeker').length, 1);
  assert.equal(r.game.host.removePlayer(seeker), false, 'already gone');
  // a late joiner during play joins the seeking team
  assert.equal(r.game.host.addPlayer('late', { nick: 'Late Kid' }), true);
  assert.equal(r.st.players.late.role, 'found');
});

// ---------------------------------------------------------------------------------------------
// freeze tag
// ---------------------------------------------------------------------------------------------

test('freeze tag: one "it" up to 6 players, two from 7', () => {
  for (const [n, want] of [[2, 1], [6, 1], [7, 2], [10, 2]]) {
    const r = room('freezeTag', { n });
    r.game.host.start(r.now);
    assert.equal(r.role('it').length, want, `${n} players`);
  }
});

test('freeze tag: tag freezes in a pose; standing next to a friend for a second unfreezes them', () => {
  const r = room('freezeTag', { n: 4 });
  r.toPlay();
  const [it] = r.role('it');
  const [a, b, c] = r.role('runner');
  r.at(it, 0, 50);
  r.at(a, 1, 50);
  r.at(b, 10, 65);
  r.at(c, -10, 65);
  assert.equal(r.claim(b, { type: 'tag', target: a }), false, 'runners do not tag');
  assert.equal(r.claim(it, { type: 'tag', target: b }), false, 'too far');
  assert.equal(r.claim(it, { type: 'tag', target: a }), true);
  assert.equal(r.claim(it, { type: 'tag', target: a }), false, 'already frozen');
  assert.equal(r.st.players[a].frozen, true);
  assert.equal(r.game.who(a).anim, 'frozen');
  assert.equal(r.game.who(a).canMove, false);
  assert.equal(r.game.ui(a).big.text, 'Frozen!');
  assert.equal(r.st.scores[it], 1);
  // a claim before the host has seen anyone near is refused
  assert.equal(r.claim(b, { type: 'unfreeze', target: a }), false);
  r.at(it, -12, 45);
  r.at(b, 1.5, 51);
  r.run(500);
  assert.equal(r.st.players[a].thawBy, b);
  assert.equal(r.claim(c, { type: 'unfreeze', target: a }), false, 'c is not the one standing there');
  r.run(600);
  assert.equal(r.st.players[a].frozen, false, 'unfrozen after a second');
  assert.equal(r.st.scores[b], 1);
  // just-unfrozen runners sparkle for a moment: no instant re-freeze
  r.at(it, 1.5, 50);
  assert.equal(r.claim(it, { type: 'tag', target: a }), false);
  r.run(2600);
  r.at(it, 1.5, 50);
  r.at(a, 1, 50);
  assert.equal(r.claim(it, { type: 'tag', target: a }), true);
});

test('freeze tag: a warm cloud thaws you after meltSeconds; everyone frozen = it wins', () => {
  const r = room('freezeTag', { n: 3, settings: { meltSeconds: 15 } });
  r.toPlay();
  const [it] = r.role('it');
  const [a, b] = r.role('runner');
  r.at(it, 0, 50);
  r.at(a, 1, 50);
  r.at(b, 12, 68);
  assert.equal(r.claim(it, { type: 'tag', target: a }), true);
  const fx = r.run(15100);
  assert.ok(fx.some((f) => f.type === 'melt' && f.id === a));
  assert.equal(r.st.players[a].frozen, false);
  r.run(3000);
  r.at(it, 0, 50);
  r.at(a, 1, 50);
  assert.equal(r.claim(it, { type: 'tag', target: a }), true);
  r.at(it, 11, 68);
  assert.equal(r.claim(it, { type: 'tag', target: b }), true);
  assert.equal(r.st.phase, 'results');
  assert.equal(r.st.result.winner, 'it');
  assert.deepEqual(r.st.result.ids, [it]);
});

test('freeze tag: when time runs out the free runners win', () => {
  const r = room('freezeTag', { n: 4, settings: { meltSeconds: 0 } });
  r.toPlay();
  const [it] = r.role('it');
  const [a, b, c] = r.role('runner');
  r.at(it, 0, 50);
  r.at(a, 1, 50);
  r.at(b, 14, 68);
  r.at(c, -12, 68);
  r.claim(it, { type: 'tag', target: a });
  r.at(it, -13, 45);
  r.run(90000);
  assert.equal(r.st.phase, 'results');
  assert.equal(r.st.result.winner, 'runners');
  assert.deepEqual([...r.st.result.ids].sort(), [b, c].sort());
});

// ---------------------------------------------------------------------------------------------
// dodgeball
// ---------------------------------------------------------------------------------------------

const COURT = frame(SAMPLE_PLACES.court.x, SAMPLE_PLACES.court.z, SAMPLE_PLACES.court.facing);
const onCourt = (lx, lz) => toWorld(COURT, lx, lz);

test('dodgeball: balanced teams (people spread out), balls on the midline', () => {
  const r = room('dodgeball', { n: 6 });
  r.game.host.start(r.now);
  assert.equal(r.team(0).length, 3);
  assert.equal(r.team(1).length, 3);
  for (const b of r.st.balls) assert.ok(Math.abs(toLocal(COURT, b.x, b.z).z) < 1e-6 + 0.01);
  assert.equal(r.st.balls.length, 3);
  // 3 people + 3 bots: people split 2/1 or 1/2, never 3/0
  const mixed = createGame('dodgeball', {
    players: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'b1', bot: true }, { id: 'b2', bot: true }, { id: 'b3', bot: true }],
    rng: mulberry32(5),
    arena: SAMPLE_PLACES.court,
  });
  mixed.host.start(T0);
  const humansOn0 = ['h1', 'h2', 'h3'].filter((id) => mixed.state.players[id].team === 0).length;
  assert.ok(humansOn0 === 1 || humansOn0 === 2);
});

test('dodgeball: pick up on your side, throw, the ball flies, lands and rests', () => {
  const r = room('dodgeball', { n: 2 });
  r.toPlay();
  const [a] = r.team(0);
  const [b] = r.team(1);
  const ball = r.st.balls[1];
  const near = onCourt(toLocal(COURT, ball.x, ball.z).x, -0.8);
  r.at(a, near.x, near.z);
  r.at(b, onCourt(0, 8).x, onCourt(0, 8).z);
  assert.equal(r.claim(a, { type: 'pickup', ballId: 'b9' }), false, 'no such ball');
  assert.equal(r.claim(a, { type: 'throw', ballId: ball.id, from: near, dir: { x: 0, z: 1 } }), false, 'not holding it');
  assert.equal(r.claim(a, { type: 'pickup', ballId: ball.id }), true);
  assert.equal(r.claim(a, { type: 'pickup', ballId: r.st.balls[0].id }), false, 'one ball at a time');
  assert.equal(r.game.who(a).carrying, 'ball');
  assert.equal(r.game.ui(a).action.id, 'throw');
  // a throw "from" the other side of the court is refused
  const far = onCourt(0, 6);
  assert.equal(r.claim(a, { type: 'throw', ballId: ball.id, from: far, dir: { x: 1, z: 0 } }), false);
  assert.equal(r.claim(a, { type: 'throw', ballId: ball.id, from: near, dir: { x: 0, z: 0 } }), false, 'no direction');
  assert.equal(r.claim(a, { type: 'throw', ballId: ball.id, from: near, dir: { x: NaN, z: 1 } }), false);
  const sideways = toWorld({ ...COURT, x: 0, z: 0 }, 1, 0); // along the midline, away from everyone
  assert.equal(r.claim(a, { type: 'throw', ballId: ball.id, from: near, dir: sideways, power: 1 }), true);
  assert.equal(ball.s, 'air');
  const p0 = ballPos(ball, r.now);
  const p1 = ballPos(ball, r.now + 300);
  assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3, 'it moves at roughly 14 m/s');
  assert.ok(p0.y > 1 && p1.y > 0.3);
  r.run(1600);
  assert.equal(ball.s, 'ground', 'landed');
  assert.ok(Math.abs(toLocal(COURT, ball.x, ball.z).x) <= 7, 'rests inside the court');
});

test('dodgeball: a hit is claimed by the one hit, checked against the ball path; out goes to the bench', () => {
  const r = room('dodgeball', { n: 4 });
  r.toPlay();
  const [a, a2] = r.team(0);
  const [b, b2] = r.team(1);
  const ball = r.st.balls[0];
  const spot = onCourt(toLocal(COURT, ball.x, ball.z).x, -0.6);
  r.at(a, spot.x, spot.z);
  r.at(a2, onCourt(-5, -10).x, onCourt(-5, -10).z);
  const target = onCourt(toLocal(COURT, ball.x, ball.z).x, 6);
  r.at(b, target.x, target.z);
  r.at(b2, onCourt(5, 10).x, onCourt(5, 10).z);
  assert.equal(r.claim(a, { type: 'pickup', ballId: ball.id }), true);
  const dir = { x: target.x - spot.x, z: target.z - spot.z };
  assert.equal(r.claim(a, { type: 'throw', ballId: ball.id, from: spot, dir }), true);
  r.run(200);
  assert.equal(r.claim(a2, { type: 'hit', ballId: ball.id, target: b }), false, 'only the target reports a hit');
  assert.equal(r.claim(b2, { type: 'hit', ballId: ball.id, target: b2 }), false, 'b2 was nowhere near the path');
  r.run(300);
  assert.equal(r.claim(b, { type: 'hit', ballId: ball.id, target: b }), true);
  assert.equal(r.claim(b, { type: 'hit', ballId: ball.id, target: b }), false, 'one hit per throw');
  assert.equal(r.st.players[b].out, true);
  assert.deepEqual(r.st.left, [2, 1]);
  assert.deepEqual(r.st.scores, [1, 0]);
  r.tick();
  assert.ok(r.fxLog.some((f) => f.type === 'teleport' && f.id === b), 'off to the bench');
  const bench = toLocal(COURT, r.pos.get(b).x, r.pos.get(b).z);
  assert.ok(Math.abs(bench.x) > 7, 'the bench is outside the court');
  assert.equal(r.game.who(b).anim, 'cheer', 'mat talk from the bench');
  assert.equal(r.claim(b, { type: 'pickup', ballId: r.st.balls[1].id }), false, 'benched players sit this one out');
  assert.match(r.game.fxText(r.fxLog.find((f) => f.type === 'hit'), b), /bench/);
});

test('dodgeball: a catch puts the thrower out and brings a benched teammate back', () => {
  const r = room('dodgeball', { n: 4, settings: { comebackSeconds: 0 } });
  r.toPlay();
  const [a, a2] = r.team(0);
  const [b, b2] = r.team(1);
  const [ball1, ball2] = r.st.balls;
  // first, b2 gets hit so that someone is on the bench
  const s1 = onCourt(toLocal(COURT, ball1.x, ball1.z).x, -0.6);
  r.at(a, s1.x, s1.z);
  r.claim(a, { type: 'pickup', ballId: ball1.id });
  const t2 = onCourt(toLocal(COURT, ball1.x, ball1.z).x, 5);
  r.at(b2, t2.x, t2.z);
  r.at(b, onCourt(5, 3).x, onCourt(5, 3).z);
  r.claim(a, { type: 'throw', ballId: ball1.id, from: s1, dir: { x: t2.x - s1.x, z: t2.z - s1.z } });
  r.run(400);
  assert.equal(r.claim(b2, { type: 'hit', ballId: ball1.id, target: b2 }), true);
  // now a2 throws at b, who catches
  const s2 = onCourt(toLocal(COURT, ball2.x, ball2.z).x, -0.6);
  r.at(a2, s2.x, s2.z);
  r.claim(a2, { type: 'pickup', ballId: ball2.id });
  const tb = onCourt(toLocal(COURT, ball2.x, ball2.z).x, 4);
  r.at(b, tb.x, tb.z);
  r.claim(a2, { type: 'throw', ballId: ball2.id, from: s2, dir: { x: tb.x - s2.x, z: tb.z - s2.z } });
  r.run(100);
  assert.equal(r.claim(a, { type: 'catch', ballId: ball2.id }), false, 'your own team throw');
  r.run(150);
  assert.equal(r.claim(b, { type: 'catch', ballId: ball2.id }), true);
  assert.equal(ball2.s, 'held');
  assert.equal(ball2.by, b);
  assert.equal(r.st.players[a2].out, true, 'the thrower is out');
  assert.equal(r.st.players[b2].out, false, 'the benched teammate is back');
  assert.deepEqual(r.st.left, [1, 2]);
  assert.deepEqual(r.st.scores, [1, 1]);
});

test('dodgeball: nobody crosses the midline; benched players come back after the comeback time; a sweep wins', () => {
  const r = room('dodgeball', { n: 2, settings: { comebackSeconds: 15 } });
  r.toPlay();
  const [a] = r.team(0);
  const [b] = r.team(1);
  const c = r.game.confine(a, onCourt(2, 5).x, onCourt(2, 5).z);
  assert.ok(toLocal(COURT, c.x, c.z).z < 0, 'team 0 stays on its half');
  const c2 = r.game.confine(b, onCourt(-30, -30).x, onCourt(-30, -30).z);
  const l2 = toLocal(COURT, c2.x, c2.z);
  assert.ok(l2.z > 0 && Math.abs(l2.x) <= 7);
  // a 1 v 1: one hit sweeps the other team
  const ball = r.st.balls[0];
  const s = onCourt(toLocal(COURT, ball.x, ball.z).x, -0.6);
  r.at(a, s.x, s.z);
  r.claim(a, { type: 'pickup', ballId: ball.id });
  const t = onCourt(toLocal(COURT, ball.x, ball.z).x, 4);
  r.at(b, t.x, t.z);
  r.claim(a, { type: 'throw', ballId: ball.id, from: s, dir: { x: t.x - s.x, z: t.z - s.z } });
  r.run(300);
  assert.equal(r.claim(b, { type: 'hit', ballId: ball.id, target: b }), true);
  assert.equal(r.st.phase, 'results');
  assert.equal(r.st.result.winner, 0);
  assert.equal(r.game.ui(a).big.text, 'Team Pink wins!');
  assert.equal(r.st.wins[0], 1);
  // comeback: 4 players, one hit, back after 15 s
  const r4 = room('dodgeball', { n: 4, settings: { comebackSeconds: 15 } });
  r4.toPlay();
  const [x] = r4.team(0);
  const [y, y2] = r4.team(1);
  const bl = r4.st.balls[0];
  const sx = onCourt(toLocal(COURT, bl.x, bl.z).x, -0.6);
  r4.at(x, sx.x, sx.z);
  r4.claim(x, { type: 'pickup', ballId: bl.id });
  const ty = onCourt(toLocal(COURT, bl.x, bl.z).x, 4);
  r4.at(y, ty.x, ty.z);
  r4.at(y2, onCourt(6, 11).x, onCourt(6, 11).z);
  r4.claim(x, { type: 'throw', ballId: bl.id, from: sx, dir: { x: ty.x - sx.x, z: ty.z - sx.z } });
  r4.run(300);
  assert.equal(r4.claim(y, { type: 'hit', ballId: bl.id, target: y }), true);
  r4.run(14000);
  assert.equal(r4.st.players[y].out, true);
  r4.run(1200);
  assert.equal(r4.st.players[y].out, false, 'cheered back in');
});

// ---------------------------------------------------------------------------------------------
// Capture the Bow
// ---------------------------------------------------------------------------------------------

test('Capture the Bow: grab, carry home, score; first to 3 wins', () => {
  const r = room('captureBow', { n: 2 });
  r.toPlay();
  const [a] = r.team(0); // base at (21, 34)
  const [b] = r.team(1); // base at (59, 34)
  r.at(b, 58, 20);
  r.at(a, 50, 34);
  assert.equal(r.claim(a, { type: 'grab', team: 1 }), false, 'too far from the bow');
  assert.equal(r.claim(a, { type: 'grab', team: 0 }), false, 'your own bow is at home');
  assert.equal(r.claim(a, { type: 'grab', team: '1' }), false, 'teams are numbers');
  r.at(a, 58, 34);
  assert.equal(r.claim(a, { type: 'grab', team: 1 }), true);
  assert.equal(r.st.bows[1].s, 'carried');
  assert.equal(r.game.who(a).carrying, 'bow1');
  assert.equal(r.claim(a, { type: 'score' }), false, 'not home yet');
  r.at(a, 22, 34);
  r.tick();
  assert.deepEqual(r.st.scores, [1, 0], 'stepping into your base scores');
  assert.equal(r.st.bows[1].s, 'home');
  for (let k = 0; k < 2; k++) {
    r.at(a, 58, 34);
    assert.equal(r.claim(a, { type: 'grab', team: 1 }), true);
    r.at(a, 21.5, 34);
    assert.equal(r.claim(a, { type: 'score' }), true);
  }
  assert.equal(r.st.phase, 'results');
  assert.equal(r.st.result.winner, 0);
});

test('Capture the Bow: tags only count in your own half; a tagged carrier drops the bow, which floats home', () => {
  const r = room('captureBow', { n: 4, settings: { returnSeconds: 5 } });
  r.toPlay();
  const [a, a2] = r.team(0);
  const [b, b2] = r.team(1);
  r.at(a2, 25, 30);
  r.at(b2, 55, 30);
  r.at(a, 58, 34);
  assert.equal(r.claim(a, { type: 'grab', team: 1 }), true);
  r.at(a, 50, 34);
  r.at(b, 51, 34);
  assert.equal(r.claim(b, { type: 'tag', target: a }), false, 'grab and go: a short sparkle shield');
  r.run(2100);
  r.at(a, 50, 34);
  r.at(b, 51, 34);
  assert.equal(r.claim(a, { type: 'tag', target: b }), false, 'b is in their own half: safe from a');
  assert.equal(r.claim(b, { type: 'tag', target: a }), true);
  assert.equal(r.st.bows[1].s, 'dropped');
  assert.deepEqual([r.st.bows[1].x, r.st.bows[1].z], [50, 34]);
  assert.ok(r.fxLog.some((f) => f.type === 'teleport' && f.id === a), 'sent back to base');
  // the carrier's team can grab it again; it floats home after 5 s
  r.run(5100);
  assert.equal(r.st.bows[1].s, 'home');
  // own team touching a dropped bow sends it home at once
  r.at(a, 58, 34);
  r.run(3100);
  r.at(a, 58, 34);
  assert.equal(r.claim(a, { type: 'grab', team: 1 }), true);
  r.run(2100);
  r.at(a, 45, 30);
  r.at(b, 45.5, 30);
  assert.equal(r.claim(b, { type: 'tag', target: a }), true);
  r.at(b2, 45, 31);
  assert.equal(r.claim(b2, { type: 'grab', team: 1 }), true, 'saved');
  assert.equal(r.st.bows[1].s, 'home');
});

// ---------------------------------------------------------------------------------------------
// claims from the network: malformed, impossible, hostile
// ---------------------------------------------------------------------------------------------

const JUNK_CLAIMS = [
  null, undefined, 0, 1, 'found', [], [1, 2], true, {}, { type: null }, { type: 5 }, { type: 'x'.repeat(40) },
  { type: 'found', target: null }, { type: 'found', target: '__proto__' }, { type: 'found', target: { id: 'p2' } },
  { type: 'tag', target: ['p2'] }, { type: 'unfreeze', target: 'constructor' }, { type: 'pickup' },
  { type: 'pickup', ballId: '__proto__' }, { type: 'throw', ballId: 'b0' }, { type: 'throw', ballId: 'b0', from: 'here', dir: 'there' },
  { type: 'throw', ballId: 'b0', from: { x: 1e300, z: 0 }, dir: { x: 1, z: 0 } }, { type: 'hit', ballId: 'b0' },
  { type: 'hit', ballId: 'b0', target: 'p1' }, { type: 'catch', ballId: Infinity }, { type: 'grab' }, { type: 'grab', team: 2 },
  { type: 'grab', team: -1 }, { type: 'grab', team: NaN }, { type: 'score', extra: 'x' }, { type: 'start' }, { type: 'win' },
  { type: 'teleport', id: 'p1', x: 0, z: 0 }, { type: 'toString' }, { type: '__proto__' }, { type: 'constructor' },
];

test('malformed or impossible claims are rejected and never throw', () => {
  for (const kind of MODE_IDS) {
    const r = room(kind, { n: 4 });
    for (const phase of ['lobby', 'play']) {
      if (phase === 'play') r.toPlay();
      const before = JSON.stringify(r.st);
      for (const c of JUNK_CLAIMS) {
        for (const from of ['p1', 'p2', 'ghost', '__proto__', null, 7]) {
          assert.equal(r.claim(from, c), false, `${kind} ${phase} ${JSON.stringify(c)} from ${from}`);
        }
      }
      assert.equal(JSON.stringify(r.st), before, `${kind}: junk changed nothing`);
    }
  }
});

test('views that throw or lie do not break the host', () => {
  for (const kind of MODE_IDS) {
    const r = room(kind, { n: 4 });
    r.toPlay();
    const bad = [null, {}, { pos: () => { throw new Error('boom'); } }, { pos: () => ({ x: NaN, z: 1 }) }, { pos: () => ({ x: 1e9, z: 0 }) }, { pos: () => 'here' }];
    for (const v of bad) {
      assert.doesNotThrow(() => r.game.host.tick(r.now + 50, v));
      assert.equal(r.game.host.claim('p1', { type: 'tag', target: 'p2' }, v), false);
      assert.doesNotThrow(() => r.game.bot('p1', v, 0.05));
    }
  }
});

// ---------------------------------------------------------------------------------------------
// shared state: applyState, host hand-over, determinism
// ---------------------------------------------------------------------------------------------

test('applyState: clients adopt the host state; junk is refused or cleaned', () => {
  for (const kind of MODE_IDS) {
    const r = room(kind, { n: 4 });
    r.toPlay();
    r.run(2000);
    const client = createGame(kind, { arena: SAMPLE_PLACES[MODES[kind].place], now: () => r.now });
    assert.equal(client.applyState(JSON.parse(JSON.stringify(r.st))), true);
    assert.deepEqual(client.state, JSON.parse(JSON.stringify(r.st)), `${kind}: identical after a round trip`);
    assert.deepEqual(client.ui('p1'), r.game.ui('p1'));
    for (const junk of [null, 5, 'state', [], { kind: 'other' }, { ...r.st, kind: 'dodgeball2' }]) {
      assert.equal(client.applyState(junk), false);
    }
    const dirty = JSON.parse(JSON.stringify(r.st));
    dirty.phase = 'party';
    dirty.round = -4;
    dirty.order.push('__proto__', 'ghost', 'p1');
    dirty.players.ghost = 'boo';
    dirty.players.p1.nick = '<b>Hacker</b>' + 'x'.repeat(40);
    dirty.extra = { lots: 'of junk' };
    assert.equal(client.applyState(dirty), true);
    assert.equal(client.state.phase, 'lobby');
    assert.equal(client.state.round, 1);
    assert.deepEqual(client.state.order, ['p1', 'p2', 'p3', 'p4']);
    assert.ok(client.state.players.p1.nick.length <= 16 && !/[<>]/.test(client.state.players.p1.nick));
    assert.equal(client.state.extra, undefined);
  }
});

test('applyState ignores a stale echo of the same game, but takes a brand new game', () => {
  const r = room('freezeTag', { n: 4 });
  r.toPlay();
  const old = JSON.parse(JSON.stringify(r.st));
  const [it] = r.role('it');
  const [a] = r.role('runner');
  r.at(it, 0, 50);
  r.at(a, 1, 50);
  assert.equal(r.claim(it, { type: 'tag', target: a }), true);
  const seq = r.st.seq;
  assert.equal(r.game.applyState(old), false, 'the echo of an older setGame does not roll the host back');
  assert.equal(r.st.seq, seq);
  assert.equal(r.st.players[a].frozen, true);
  assert.equal(r.game.applyState(JSON.parse(JSON.stringify(r.st))), true, 'the same state again is fine');
  const fresh = createGame('freezeTag', { players: ['x', 'y'], rng: mulberry32(77), now: T0 });
  assert.notEqual(fresh.state.gid, r.st.gid);
  assert.equal(r.game.applyState(JSON.parse(JSON.stringify(fresh.state))), true, 'a new game session is adopted');
  assert.deepEqual(r.st.order, ['x', 'y']);
});

test('host hand-over: a new host adopts the shared state mid-round and finishes the round', () => {
  for (const kind of MODE_IDS) {
    const r = room(kind, { n: 4, humans: false });
    r.toPlay();
    r.run(1500);
    let now = r.now;
    const next = createGame(kind, { arena: SAMPLE_PLACES[MODES[kind].place], rng: mulberry32(99), now: () => now, strict: true });
    assert.equal(next.applyState(JSON.parse(JSON.stringify(r.st))), true);
    let guard = 0;
    while (next.state.phase !== 'results' && guard++ < 5000) {
      now += 100;
      next.host.tick(now, r.view);
    }
    assert.equal(next.state.phase, 'results', `${kind}: the new host finished the round`);
  }
});

test('ui and fx text: every phase has something kind to say', () => {
  for (const kind of MODE_IDS) {
    const r = room(kind, { n: 4 });
    const texts = [];
    const grab = () => {
      for (const id of [...r.st.order, null]) {
        const u = r.game.ui(id);
        for (const k of ['title', 'line', 'timer', 'big', 'roleBadge', 'scoreboard']) assert.ok(k in u, `${kind} ui.${k}`);
        assert.equal(typeof u.title, 'string');
        assert.equal(typeof u.line, 'string');
        assert.ok(u.timer === null || Number.isInteger(u.timer));
        assert.ok(Array.isArray(u.scoreboard.rows));
        texts.push(u.line, u.big ? u.big.text : '', u.big ? u.big.sub : '', u.roleBadge ? u.roleBadge.text : '');
      }
    };
    grab();
    r.toPlay();
    grab();
    r.game.host.end(r.now);
    grab();
    for (const f of r.fxLog.concat(r.tick())) for (const id of r.st.order) texts.push(r.game.fxText(f, id));
    for (const t of texts) assert.doesNotMatch(String(t), MEAN, `${kind}: "${t}"`);
  }
});

test('the same seed plays the same game', () => {
  const play = (seed) => {
    const g = createGame('dodgeball', { arena: SAMPLE_PLACES.court, players: ['a', 'b', 'c', 'd'], rng: mulberry32(seed), now: T0 });
    g.host.start(T0);
    return JSON.stringify(g.state);
  };
  assert.equal(play(3), play(3));
});
