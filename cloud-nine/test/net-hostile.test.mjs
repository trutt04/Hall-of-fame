// Malformed and hostile input. A scripted transport hands the test the room's incoming feed, so it
// can pretend to be a broken or mischievous device and check that nothing gets through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../js/net/index.js';
import { sleep, waitFor, watchConsole, NO_HELPERS } from './net-kit.mjs';

const ME = 'me0000000001';
const HOST = 'host00000001';
const PAL = 'pal000000001';

function scripted() {
  const calls = [];
  const links = new Set();
  const t0 = Date.now();
  const kit = { sink: null, calls };
  kit.transport = {
    kind: 'local',
    id: ME,
    now: () => Date.now(),
    onLink(fn) {
      links.add(fn);
    },
    async connect() {
      for (const fn of links) fn(true);
      return { id: ME };
    },
    async probe() {
      return {
        meta: { hostId: HOST, createdAt: t0, beat: Date.now(), v: 1 },
        players: { [HOST]: { nick: 'Hosty', look: '{}', bot: false, joinedAt: t0 + 1 }, [PAL]: { nick: 'Pal', look: '{}', bot: false, joinedAt: t0 + 2 } },
      };
    },
    async create() {
      return 'ok';
    },
    async enter(code, entry, sink) {
      kit.sink = sink;
      sink.meta({ hostId: HOST, createdAt: t0, beat: Date.now(), v: 1 });
      sink.player(HOST, { nick: 'Hosty', look: '{}', bot: false, joinedAt: t0 + 1 });
      sink.player(PAL, { nick: 'Pal', look: '{"bow":"pink"}', bot: false, joinedAt: t0 + 2 });
      sink.player(ME, { ...entry, joinedAt: t0 + 3 });
    },
    async exit() {},
    putPlayer: async (...a) => calls.push(['putPlayer', ...a]),
    patchPlayer: async (...a) => calls.push(['patchPlayer', ...a]),
    dropPlayer: async (...a) => calls.push(['dropPlayer', ...a]),
    putState: async (...a) => calls.push(['putState', ...a]),
    dropState: async (...a) => calls.push(['dropState', ...a]),
    pushEvent: async (...a) => calls.push(['pushEvent', ...a]),
    setGame: async (...a) => calls.push(['setGame', ...a]),
    setMeta: async (...a) => calls.push(['setMeta', ...a]),
    claimHost: async () => {
      calls.push(['claimHost']);
      return false;
    },
    trimEvents: async () => {},
    dispose() {},
  };
  return kit;
}

let con;
let kit;
let net;
test.beforeEach(async () => {
  con = watchConsole();
  kit = scripted();
  net = createNet({ transport: kit.transport, tuning: { dutyMs: 50 }, helpers: NO_HELPERS });
  assert.deepEqual(await net.joinRoom('K7QZ', { nick: 'Me' }), { ok: true });
});
test.afterEach(() => {
  net.dispose();
  con.restore();
  assert.deepEqual(con.errors, [], 'no console errors');
});

test('hostile: the starting room is what we expect', () => {
  assert.deepEqual([...net.players.keys()], [HOST, PAL, ME]);
  assert.equal(net.room.hostId, HOST);
  assert.equal(net.isHost, false);
});

test('hostile: broken player entries never show up, and odd names and looks are replaced', () => {
  const s = kit.sink;
  s.player('weird1', { nick: 'Weird<script>', look: '{"bow":{"$gt":""},"hair":"brown"}', bot: false, joinedAt: Date.now() });
  const w = net.players.get('weird1');
  assert.equal(w.nick, 'Cloud Friend', 'a name that is not plain letters is replaced');
  assert.deepEqual(w.look, { hair: 'brown' }, 'look slots are checked one by one');
  for (const [id, v] of [
    ['bad id!', { nick: 'X', look: '{}', bot: false, joinedAt: 1 }],
    ['__proto__', { nick: 'X', look: '{}', bot: false, joinedAt: Date.now() }],
    ['nojoin', { nick: 'X', look: '{}', bot: false }],
    ['strbot', { nick: 'X', look: '{}', bot: 'yes', joinedAt: Date.now() }],
    ['arr', [1, 2, 3]],
    ['num', 42],
    ['x'.repeat(65), { nick: 'X', look: '{}', bot: false, joinedAt: Date.now() }],
  ]) {
    s.player(id, v);
    assert.equal(net.players.has(id), false, id);
  }
  assert.equal({}.nick, undefined, 'nothing leaked into Object.prototype');
  // a bot that does not belong to the host is not shown
  s.player('pal000000001-b1', { nick: 'Sneaky', look: '{}', bot: true, owner: PAL, joinedAt: Date.now() });
  assert.equal(net.players.has('pal000000001-b1'), false);
  s.player('host00000001-b1', { nick: 'Hosts Bot', look: '{}', bot: true, owner: HOST, joinedAt: Date.now() });
  assert.equal(net.players.get('host00000001-b1').bot, true);
  // an entry from before the room was made (a previous room with the same code) is ignored
  s.player('ancient', { nick: 'Old', look: '{}', bot: false, joinedAt: 5 });
  assert.equal(net.players.has('ancient'), false);
});

test('hostile: positions are clamped, junk is dropped, floods are cut off', async () => {
  const s = kit.sink;
  const t = Date.now();
  s.state(PAL, { x: 9999, y: -9999, z: 1, h: 99, a: 'walk', t });
  await sleep(200);
  const st = net.stateOf(PAL);
  assert.equal(st.x, 500);
  assert.equal(st.y, -500);
  assert.ok(st.h > -Math.PI && st.h <= Math.PI);
  const before = net.stats.dropped.bad;
  for (const v of [{ x: NaN, y: 0, z: 0, h: 0, a: 'idle', t }, { x: '1', y: 0, z: 0 }, 'x', [1, 2], { y: 0 }]) s.state(PAL, v);
  assert.equal(net.stats.dropped.bad, before + 5);
  s.state('nobody00001', { x: 1, y: 0, z: 1, h: 0, a: 'idle', t });
  assert.equal(net.stateOf('nobody00001'), null, 'states of people who are not here are not shown');
  for (let i = 0; i < 500; i++) s.state(PAL, { x: i / 100, y: 0, z: 0, h: 0, a: 'run', t: t + 1 + i });
  assert.ok(net.stats.dropped.rate > 400, 'a flood is cut off: ' + net.stats.dropped.rate);
  s.state(PAL, { x: 1, y: 0, z: 1, h: 0, a: 'idle', t: t - 1e9 });
  assert.ok(net.stateOf(PAL), 'a sender whose clock jumps still shows up');
});

test('hostile: events must come from someone here, with a known type and small data', async () => {
  const s = kit.sink;
  const got = [];
  net.on('event', (e) => got.push(e));
  const ev = (from, type, data) => ({ from, type, data: JSON.stringify(data), t: Date.now() });
  s.event('k1', ev(PAL, 'emote', { id: 'woo' }));
  s.event('k1', ev(PAL, 'emote', { id: 'woo' })); // the same key twice
  s.event('k2', ev('stranger0001', 'emote', { id: 'woo' }));
  s.event('k3', ev(PAL, 'chat', { text: 'hi' }));
  s.event('k4', ev(PAL, 'emote', { text: 'x'.repeat(300) }));
  s.event('k5', { from: PAL, type: 'emote', data: 'x'.repeat(5000), t: 1 });
  s.event('k6', ev(PAL, 'game-start', { kind: 'tag' }));
  s.event('k7', ev(HOST, 'game-start', { kind: 'tag' }));
  s.event('k8', ev(PAL, 'claim', { __proto__: { polluted: true }, type: 'tag' }));
  s.event('k9', { from: PAL, type: 'claim', data: '{"__proto__":{"polluted":true}}', t: 1 });
  s.event('x'.repeat(100), ev(PAL, 'emote', { id: 'woo' }));
  s.event(42, ev(PAL, 'emote', { id: 'woo' }));
  s.event('k10', null);
  assert.deepEqual(
    got.map((e) => e.from + ':' + e.type),
    [PAL + ':emote', HOST + ':game-start', PAL + ':claim'],
  );
  assert.equal({}.polluted, undefined);
  assert.ok(net.stats.dropped.unknown >= 1 && net.stats.dropped.host >= 1 && net.stats.dropped.bad >= 4);
  for (let i = 0; i < 200; i++) s.event('f' + i, ev(PAL, 'fx', { n: i }));
  assert.ok(got.length < 50, 'an event flood is cut off: ' + got.length);
  assert.ok(net.stats.dropped.rate > 150);
});

test('hostile: the game state comes from the host, as a small object', async () => {
  const s = kit.sink;
  const seen = [];
  net.on('game', (g) => seen.push(g));
  s.game({ by: 'stranger0001', json: '{"phase":"play"}', t: 1 });
  s.game({ by: HOST, json: '[1,2,3]', t: 1 });
  s.game({ by: HOST, json: '{"x":"' + 'y'.repeat(17000) + '"}', t: 1 });
  s.game({ by: HOST, json: '{oops', t: 1 });
  s.game({ by: HOST, json: { phase: 'play' }, t: 1 });
  assert.equal(seen.length, 0);
  s.game({ by: HOST, json: '{"kind":"freezeTag","phase":"play"}', t: 1 });
  assert.deepEqual(net.game, { kind: 'freezeTag', phase: 'play' });
  s.game({ by: HOST, json: '{"kind":"freezeTag","phase":"play"}', t: 2 });
  assert.equal(seen.length, 1, 'no event when nothing changed');
  s.game(null);
  assert.equal(net.game, null);
});

test('hostile: a broken meta is ignored; the room vanishing takes me out cleanly', async () => {
  const s = kit.sink;
  s.meta({ hostId: 'not valid!', createdAt: 1 });
  s.meta('junk');
  assert.equal(net.room.hostId, HOST);
  const left = [];
  net.on('leave', (e) => left.push(e));
  s.meta(null);
  assert.equal(net.room, null);
  assert.deepEqual(left.find((e) => e.id === ME), { id: ME, reason: 'lost' });
  assert.equal(net.players.size, 0);
});

test('hostile: my own entry vanishing (a late disconnect) puts it back', async () => {
  kit.sink.player(ME, null);
  assert.ok(net.players.has(ME), 'I stay in my own list meanwhile');
  await waitFor(() => kit.calls.some((c) => c[0] === 'putPlayer' && c[1] === ME), { what: 'my entry to be put back' });
});

test('hostile: when the host stops answering, the next in line asks to host', async () => {
  const s = kit.sink;
  s.player(HOST, null);
  // Pal joined before me, so Pal asks first; then it is my turn
  await sleep(100);
  assert.ok(!kit.calls.some((c) => c[0] === 'claimHost'), 'not my turn yet');
  s.player(PAL, null);
  await waitFor(() => kit.calls.some((c) => c[0] === 'claimHost'), { what: 'me to claim' });
});

test('hostile: with the content module, only preset emotes pass and a refused name becomes the same made-up one everywhere', async () => {
  const fakeContent = {
    cleanEmote: (id) => ({ cheer: { id: 'cheer', text: 'Go!' }, WOO: { id: 'woo', text: 'Woo!' } })[id] || null,
    cleanNick: (s) => (s.length <= 12 && !/rude/i.test(s) ? s : null),
    randomNick: (rng) => ['Sparkle', 'Glitter', 'Comet', 'Twinkle'][Math.floor(rng() * 4)] + ' ' + ['Flyer', 'Star', 'Bow', 'Kick'][Math.floor(rng() * 4)],
  };
  const k2 = scripted();
  const k3 = scripted();
  const n2 = createNet({ transport: k2.transport, helpers: fakeContent });
  const n3 = createNet({ transport: k3.transport, helpers: fakeContent });
  try {
    assert.deepEqual(await n2.joinRoom('K7QZ', { nick: 'Me' }), { ok: true });
    assert.deepEqual(await n3.joinRoom('K7QZ', { nick: 'Me' }), { ok: true });
    const got = [];
    n2.on('event', (e) => got.push(e.data));
    const ev = (data) => ({ from: PAL, type: 'emote', data: JSON.stringify(data), t: Date.now() });
    k2.sink.event('e1', ev({ id: 'cheer' }));
    k2.sink.event('e2', ev({ id: 'notAnEmote' }));
    k2.sink.event('e3', ev({ id: 'WOO' }));
    k2.sink.event('e4', ev('cheer'));
    k2.sink.event('e5', ev({ text: 'free text' }));
    assert.deepEqual(got, [{ id: 'cheer' }, { id: 'woo' }, 'cheer'], 'presets only, in their own spelling');
    for (const k of [k2, k3]) k.sink.player('rude00000001', { nick: 'Rude Word', look: '{}', bot: false, joinedAt: Date.now() });
    const made = n2.players.get('rude00000001').nick;
    assert.ok(made !== 'Rude Word' && made !== 'Cloud Friend' && / /.test(made), 'a made-up name: ' + made);
    assert.equal(n3.players.get('rude00000001').nick, made, 'the same made-up name on every device');
    assert.equal(n2.send('emote', { id: 'notAnEmote' }), false, 'unknown emotes are not sent');
    assert.equal(n2.send('emote', { id: 'cheer' }), true);
    n2.updateMe({ nick: 'Rude Person' });
    assert.notEqual(n2.me.nick, 'Rude Person');
    assert.ok(n2.me.nick.length > 0);
  } finally {
    n2.dispose();
    n3.dispose();
  }
});
