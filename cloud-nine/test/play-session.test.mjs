// The whole game layer (js/play/index.js + session.js) with the real net and the real rules, no
// three.js and no DOM: props, the overlay and the role tags are stand-ins, the world is a small fake
// with a player that teleports and a HUD that writes down what it was asked to show. Frames are
// pumped by hand (world.tick), in real time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../js/net/index.js';
import { installPlay } from '../js/play/index.js';
import { SAMPLE_PLACES } from '../js/games/sample-arenas.js';
import { sleep, waitFor, localTabs, NO_HELPERS, watchConsole } from './net-kit.mjs';

const props = () => ({ begin() {}, update() {}, end() {}, stats: { balls: 0, bows: 0 } });
const tags = () => ({ set() {}, update() {}, clear() {} });
function overlayStub(world, handlers) {
  const st = { blind: false, bar: {}, handlers, confirms: 0 };
  return {
    setBlind(on) {
      st.blind = !!on;
    },
    setBar(b) {
      st.bar = Object.assign({}, b);
    },
    confirm(copy, yes) {
      st.confirms++;
      yes();
    },
    reset() {
      st.blind = false;
      st.bar = {};
    },
    get blind() {
      return st.blind;
    },
    st,
  };
}

function fakeWorld(net, sessionKind) {
  const frames = [];
  const log = { toasts: [], bigs: [], music: [], sfx: [], ui: 0, prompts: [], ended: 0, onUse: null };
  const player = {
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    speed: 0,
    grounded: true,
    frozen: false,
    controller: null,
    rescuing: false,
    avatar: null,
    anim: 'idle',
    setAnim(name) {
      this.anim = name;
    },
    teleport(x, z, facing) {
      this.position.x = x;
      this.position.z = z;
      if (Number.isFinite(facing)) this.heading = facing;
      return Promise.resolve();
    },
  };
  const world = {
    net,
    player,
    places: SAMPLE_PLACES,
    mode: 'play',
    session: { kind: sessionKind },
    nick: 'Cheerleader',
    groundAt: () => 0,
    colliders: null,
    peers: { get: () => null },
    spawnBurst() {},
    content: { hype: (s) => 'Woo, ' + s + '!' },
    audio: { sfx: (n) => log.sfx.push(n), music: (id) => log.music.push(id) },
    hud: {
      toast: (t) => log.toasts.push(t),
      big: (t) => log.bigs.push(t),
      setGameUI: () => {
        log.ui++;
      },
      prompt: (label, fn) => {
        log.prompts.push(label);
        log.onUse = fn;
        return () => {};
      },
    },
    onUpdate(fn) {
      frames.push(fn);
      return () => {};
    },
    addBots(n) {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const id = net.addBot({ nick: 'Bot Friend ' + 'ABCDEFGHI'[i] });
        if (id) ids.push(id);
      }
      return ids;
    },
    removeBots() {
      for (const [id, p] of [...net.players]) if (p.bot) net.removeBot(id);
    },
    endGame() {
      log.ended++;
      world.activeGame = null;
    },
  };
  // what main.js does when the host taps "Let's go!"
  world.hostStartGame = (kind) => {
    // (main.js puts `at: net.now()` in here; the net refuses numbers that big, so in a room this
    // event never leaves the host. The game layer must not need it: friends join from the state.)
    const data = { kind, id: 'go' + Math.random().toString(36).slice(2, 8), at: net.now() };
    world.activeGame = { kind };
    world.onGameStart(kind, data);
    if (sessionKind === 'room') net.send('game-start', data);
  };
  world.tick = (dt = 1 / 30) => {
    for (const fn of frames) fn(dt, 0);
    // what main.js does after the game layer: my position goes to the room
    const p = player.position;
    net.sendState({ x: p.x, y: p.y, z: p.z, h: player.heading, anim: player.anim });
  };
  return { world, log };
}

async function pump(worlds, until, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    for (const w of worlds) w.tick(1 / 30);
    if (until()) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(15);
  }
}

let con;
test.beforeEach(() => {
  con = watchConsole();
});
test.afterEach(() => {
  con.restore();
  assert.deepEqual(con.errors, [], 'no console errors');
});

test('solo: a game with bot friends, from the countdown to the results and back to free roam', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const { world, log } = fakeWorld(net, 'solo');
    const play = installPlay(world, { props: props(), tags: tags(), overlay: overlayStub, search: '?speed=8&quick=1' });
    assert.equal(typeof world.onGameStart, 'function');
    assert.equal(world.onGameStart('hitZero', {}), false, 'not ours');
    world.hostStartGame('dodgeball');
    let info = play.info();
    assert.equal(info.isHost, true);
    assert.equal(info.players, 6, 'Bailey and five bot friends');
    assert.equal([...net.players.values()].filter((p) => p.bot).length, 5);
    assert.ok(await pump([world], () => play.info().phase === 'countdown', 4000), 'the countdown starts by itself');
    assert.ok(log.music.includes('game'), 'game music');
    assert.ok(await pump([world], () => play.info().phase === 'play', 4000), 'then play');
    // the bots play: they fetch balls and throw them (game time runs 8x here)
    assert.ok(await pump([world], () => log.sfx.includes('throw'), 8000), 'a bot throws a ball');
    for (const id of play.state.order) {
      if (!play.state.players[id].bot) continue;
      const s = net.stateOf(id);
      assert.ok(s && Number.isFinite(s.x), 'every bot is moving in the world');
    }
    // the button: Bailey picks up a ball by walking onto it, the button throws it
    const me = net.me.id;
    const ball = play.state.balls.find((b) => b.s === 'ground' && play.session.game.confine(me, b.x, b.z).x === b.x && play.session.game.confine(me, b.x, b.z).z === b.z);
    if (ball) {
      world.player.position.x = ball.x;
      world.player.position.z = ball.z;
      await pump([world], () => play.info().prompt === 'Throw!', 2000);
      if (play.info().prompt === 'Throw!') {
        log.onUse();
        assert.equal(world.player.anim, 'throw', 'she throws');
      }
    }
    assert.ok(play.finishRound(), 'the host can finish the round');
    assert.ok(await pump([world], () => play.info().phase === 'results', 2000), 'results');
    assert.ok(await pump([world], () => log.music.includes('victory'), 1000), 'a victory sting');
    assert.ok(world.player.frozen, 'everyone stands still to celebrate');
    assert.ok(log.toasts.length > 0, 'hype lines and news');
    // Leave game: the card, then free roam
    play.overlay.st.handlers.onLeave();
    assert.equal(play.overlay.st.confirms, 1, 'asked first');
    assert.equal(play.session, null);
    assert.equal(log.ended, 1, 'world.endGame()');
    assert.equal(world.player.frozen, false, 'free to walk');
    assert.equal([...net.players.values()].filter((p) => p.bot).length, 0, 'the bots went home');
    assert.equal(log.music[log.music.length - 1], 'island', 'island music again');
  } finally {
    net.dispose();
  }
});

test('solo: every game starts and plays', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const { world, log } = fakeWorld(net, 'solo');
    const play = installPlay(world, { props: props(), tags: tags(), overlay: overlayStub, search: '?speed=8&bots=4' });
    for (const kind of ['hideSeek', 'freezeTag', 'captureBow']) {
      world.hostStartGame(kind);
      assert.equal(play.info().kind, kind);
      assert.equal(play.info().players, 5, kind + ': four bot friends (?bots=4)');
      const active = kind === 'hideSeek' ? 'hide' : 'play';
      assert.ok(await pump([world], () => play.info().phase === active, 5000), kind + ': under way');
      if (kind === 'hideSeek' && play.info().me.role === 'seeker') assert.ok(await pump([world], () => play.overlay.blind, 1000), 'the seeker counts behind the blindfold');
      await pump([world], () => false, 600);
      assert.ok(play.finishRound(), 'the host can finish the round');
      assert.ok(await pump([world], () => play.info().phase === 'results', 2000), kind + ': results');
      if (kind === 'freezeTag') {
        // the results end by themselves (8 s of game time), then "Play again!" starts round 2
        assert.ok(await pump([world], () => play.info().phase === 'lobby' && play.info().round === 2, 3000), 'a break between rounds');
        assert.ok(await pump([world], () => play.overlay.st.bar.again === true, 1000), 'Play again! is offered');
        play.overlay.st.handlers.onAgain();
        assert.equal(play.info().phase, 'countdown', 'round 2 starts now');
      }
      play.end();
      assert.equal(play.session, null);
    }
    assert.equal(log.ended, 3);
  } finally {
    net.dispose();
  }
});

test('solo: the game waits while the tab is in the background', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const { world } = fakeWorld(net, 'solo');
    const play = installPlay(world, { props: props(), tags: tags(), overlay: overlayStub, search: '?speed=4' });
    world.hostStartGame('freezeTag');
    assert.ok(await pump([world], () => play.info().phase === 'play', 4000), 'playing');
    const t0 = play.now();
    play.session.pause();
    await sleep(500); // 2 s of game time at this speed, if it ran on
    play.session.resume();
    const t1 = play.now();
    assert.ok(t1 - t0 < 400, `the round picks up where she left it (${Math.round(t1 - t0)} ms)`);
    play.end();
  } finally {
    net.dispose();
  }
});

test('free roam: bot friends stroll around between games, and a game takes them over', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const { world } = fakeWorld(net, 'solo');
    const play = installPlay(world, { props: props(), tags: tags(), overlay: overlayStub, search: '' });
    const bots = world.addBots(2);
    world.tick(1 / 30);
    const start = bots.map((id) => ({ ...net.stateOf(id) }));
    assert.ok(start.every((s) => Number.isFinite(s.x)), 'they appear near her');
    const anims = new Set();
    for (let i = 0; i < 360; i++) {
      world.tick(1 / 30); // twelve seconds of strolling
      for (const id of bots) anims.add(net.stateOf(id).anim);
    }
    const moved = bots.map((id, k) => Math.hypot(net.stateOf(id).x - start[k].x, net.stateOf(id).z - start[k].z));
    assert.ok(moved.some((d) => d > 0.2), 'they walk about (' + moved.map((d) => d.toFixed(1)).join(', ') + ' m)');
    assert.ok(moved.every((d) => d < 9), 'and stay close by');
    assert.ok(anims.has('walk') && anims.has('idle'), 'a stroll, then a look around');
    assert.equal(play.roam.size, 2);
    world.hostStartGame('freezeTag');
    world.tick(1 / 30);
    assert.equal(play.roam.size, 0, 'the game drives them now');
    play.end();
  } finally {
    net.dispose();
  }
});

test('room: the host runs it, a friend mirrors it, steps out, hops back in, and the host ends it', async () => {
  const lab = localTabs();
  try {
    const [na, nb] = [lab.open(), lab.open()];
    const code = await na.createRoom({ nick: 'Ava' });
    assert.deepEqual(await nb.joinRoom(code, { nick: 'Bea' }), { ok: true });
    await waitFor(() => na.players.size === 2 && nb.players.size === 2, { what: 'both in the room' });
    const A = fakeWorld(na, 'room');
    const B = fakeWorld(nb, 'room');
    const pa = installPlay(A.world, { props: props(), tags: tags(), overlay: overlayStub, search: '' });
    const pb = installPlay(B.world, { props: props(), tags: tags(), overlay: overlayStub, search: '' });
    A.world.hostStartGame('captureBow');
    assert.equal(pa.info().players, 4, 'two friends and two bots for even teams');
    const both = [A.world, B.world];
    assert.ok(await pump(both, () => pb.info() && pb.info().gid === pa.info().gid, 4000), 'the friend mirrors the same game');
    assert.ok(await pump(both, () => pb.info().phase === 'play', 6000), 'the friend sees play start');
    const sa = pa.state;
    const sb = pb.state;
    assert.deepEqual(sb.order, sa.order, 'the same players');
    assert.deepEqual(sb.order.map((id) => sb.players[id].team), sa.order.map((id) => sa.players[id].team), 'the same teams');
    assert.ok(B.log.sfx.includes('count') || B.log.sfx.includes('whistle') || B.log.sfx.includes('go'), 'fx reach the friend');
    const bid = nb.me.id;
    const spawn = pa.session.game.spawnFor(bid);
    assert.ok(Math.hypot(B.world.player.position.x - spawn.x, B.world.player.position.z - spawn.z) < 1.5, 'the friend was taken to her start spot');
    // Bea grabs their bow: her device claims it, the host says yes
    const team = sa.players[bid].team;
    const base = pa.session.game.arena.bases[1 - team];
    B.world.player.position.x = base.x;
    B.world.player.position.z = base.z;
    assert.ok(await pump(both, () => pa.state.bows[1 - team].s === 'carried' && pa.state.bows[1 - team].by === bid, 3000), 'a claim from a friend is checked and applied by the host');
    // Bea steps out of the game, then back in
    pb.leave();
    assert.ok(await pump(both, () => !pa.state.players[bid], 3000), 'Leave game takes her out (still in the room)');
    assert.ok(await pump(both, () => pb.overlay.st.bar.join === true, 2000), 'and offers Join the game!');
    pb.overlay.st.handlers.onJoin();
    assert.ok(await pump(both, () => !!pa.state.players[bid], 3000), 'Join the game! brings her back');
    // the host ends the game for everyone
    pa.overlay.st.handlers.onLeave();
    assert.ok(await pump(both, () => pb.session === null, 3000), 'the friend is back in free roam');
    assert.equal(pa.session, null);
    assert.ok(B.log.ended >= 1 && A.log.ended === 1, 'world.endGame() on both');
    assert.ok(await pump(both, () => nb.game && nb.game.kind === 'roam', 2000), 'the shared game is roam again');
    assert.equal([...na.players.values()].filter((p) => p.bot).length, 0, 'the bots went home');
  } finally {
    lab.closeAll();
    await sleep(20);
  }
});

test('room: when the host goes, the next host carries the game on', async () => {
  const lab = localTabs();
  try {
    const [na, nb, nc] = [lab.open(), lab.open(), lab.open()];
    const code = await na.createRoom({ nick: 'Ava' });
    await nb.joinRoom(code, { nick: 'Bea' });
    await nc.joinRoom(code, { nick: 'Cat' });
    await waitFor(() => [na, nb, nc].every((n) => n.players.size === 3), { what: 'three in the room' });
    const W = [na, nb, nc].map((n) => fakeWorld(n, 'room'));
    const P = W.map((w) => installPlay(w.world, { props: props(), tags: tags(), overlay: overlayStub, search: '' }));
    W[0].world.hostStartGame('freezeTag');
    const all = () => W.map((w) => w.world);
    assert.ok(await pump(all(), () => P[1].info() && P[2].info() && P[1].info().phase === 'play' && P[2].info().phase === 'play', 7000), 'everyone playing');
    lab.crash(na); // the host's tab vanishes
    const live = () => [W[1].world, W[2].world];
    assert.ok(await pump(live(), () => P[1].info() && P[1].info().isHost, 6000), 'the next in line becomes host and takes the game');
    const ids = P[1].state.order;
    assert.ok(!ids.includes(na.me.id), 'the old host left the game');
    const seq = P[2].state.seq;
    assert.ok(await pump(live(), () => P[2].state && P[2].state.seq > seq, 3000), 'the new host keeps it going for the others');
  } finally {
    lab.closeAll();
    await sleep(20);
  }
});
