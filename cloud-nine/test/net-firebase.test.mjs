// The Firebase transport, end to end, against tools/fake-firebase.mjs running the real
// firebase/database.rules.json. Every simulated device has its own sign-in, connection and clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNet } from '../js/net/index.js';
import { createFirebaseTransport } from '../js/net/transport-firebase.js';
import { createFakeFirebase } from '../tools/fake-firebase.mjs';
import { GAME } from '../js/config.js';
import { sleep, waitFor, watchConsole, rulesJson, TEST_CONFIG, FAST, nicksOf, hostNick, record, NO_HELPERS } from './net-kit.mjs';

let con;
let fb;
const nets = [];
test.beforeEach(() => {
  con = watchConsole();
  fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 3, serverOffsetMs: 7000 });
});
test.afterEach(async () => {
  for (const n of nets.splice(0)) n.dispose();
  await fb.settle();
  con.restore();
  assert.deepEqual(con.errors, [], 'no console errors');
});

function device(opts = {}, tuning = FAST) {
  const dev = fb.device(opts);
  // the SDK and the net layer read the same device clock, as in a real page
  const net = createNet({ mode: 'firebase', firebase: { sdk: dev, config: TEST_CONFIG, clock: opts.clock }, tuning, helpers: NO_HELPERS });
  net.dev = dev;
  nets.push(net);
  return net;
}

async function room(names, tuning = FAST) {
  const list = names.map(() => device({}, tuning));
  const code = await list[0].createRoom({ nick: names[0] });
  for (let i = 1; i < list.length; i++) assert.deepEqual(await list[i].joinRoom(code, { nick: names[i] }), { ok: true }, names[i]);
  await waitFor(() => list.every((n) => n.players.size === names.length), { what: 'everyone to see everyone' });
  return { list, code };
}

const noDenied = () => assert.deepEqual(fb.denied, [], 'the rules accepted every write');

test('firebase: devices sign in, share a room and agree on it', async () => {
  const { list, code } = await room(['Ava', 'Bea', 'Cat', 'Dot']);
  const ids = [...list[0].players.keys()];
  for (const n of list) {
    assert.equal(n.mode, 'firebase');
    assert.equal(n.status, 'online');
    assert.equal(n.me.id, n.dev.uid, 'the player id is the sign-in uid');
    assert.deepEqual([...n.players.keys()], ids);
    assert.equal(n.room.code, code);
    assert.equal(hostNick(n), 'Ava');
    assert.ok(Math.abs(n.now() - (Date.now() + 7000)) < 100, 'net.now() is server time');
  }
  const data = fb.data('rooms/' + code);
  assert.deepEqual(Object.keys(data.players).sort(), ids.slice().sort());
  assert.equal(data.meta.hostId, list[0].me.id);
  noDenied();
});

test('firebase: movement converges, and a device with a wrong clock still moves smoothly', async () => {
  const a = device();
  const b = device({ clock: () => Date.now() - 4000 }); // its clock is four seconds slow
  const code = await a.createRoom({ nick: 'Ava' });
  assert.deepEqual(await b.joinRoom(code, { nick: 'Bea' }), { ok: true });
  assert.ok(Math.abs(b.now() - a.now()) < 100, 'both agree on the shared clock');
  const t0 = Date.now();
  const seen = [];
  while (Date.now() - t0 < 900) {
    const x = ((Date.now() - t0) / 1000) * 3;
    b.sendState({ x, y: 0, z: 0, h: Math.PI / 2, anim: 'run' });
    const s = a.stateOf(b.me.id);
    if (s) seen.push([x, s.x]);
    await sleep(16);
  }
  b.sendState({ x: 3, y: 0, z: 0, h: Math.PI / 2, anim: 'idle' });
  const late = seen.filter(([, v]) => v > 0.3);
  assert.ok(late.length > 10, 'the runner shows up on the other screen');
  for (const [x, v] of late) assert.ok(v <= x + 0.2 && v >= x - 1.5, 'drawn a little behind, not stuck or ahead: ' + [x, v]);
  const distinct = new Set(late.map(([, v]) => v.toFixed(2))).size;
  assert.ok(distinct > late.length * 0.6, 'smooth: in-between positions, not 10 Hz steps (' + distinct + '/' + late.length + ')');
  await waitFor(() => a.stateOf(b.me.id) && a.stateOf(b.me.id).x === 3 && a.stateOf(b.me.id).anim === 'idle', { what: 'the stop' });
  noDenied();
});

test('firebase: events arrive in one order for everyone, only from your join on', async () => {
  const { list, code } = await room(['Ava', 'Bea', 'Cat']);
  list[0].send('emote', { id: 'early' });
  await sleep(100);
  const late = device();
  const logs = [...list, late].map((n) => {
    const l = [];
    n.on('event', (e) => l.push(e.data.n === undefined ? e.data.id : e.data.n));
    return l;
  });
  assert.deepEqual(await late.joinRoom(code, { nick: 'Dot' }), { ok: true });
  await waitFor(() => list[0].players.size === 4, { what: 'Dot' });
  const all = [...list, late];
  for (let k = 0; k < 4; k++) for (const [i, n] of all.entries()) n.send('fx', { n: k * 10 + i });
  await waitFor(() => logs.every((l) => l.filter((x) => typeof x === 'number').length === 16), { what: 'sixteen events everywhere' });
  const numbers = logs.map((l) => l.filter((x) => typeof x === 'number'));
  for (const l of numbers) assert.deepEqual(l, numbers[0], 'one order for everyone, senders included');
  assert.ok(!logs[3].includes('early'), 'Dot never sees what was said before she came');
  const keys = Object.keys(fb.data('rooms/' + code + '/events'));
  assert.ok(keys.every((k) => k.length === 20), 'push ids');
  noDenied();
});

test('firebase: the game state reaches everyone, late joiners included', async () => {
  const { list, code } = await room(['Ava', 'Bea']);
  const seen = [];
  list[1].on('game', (g) => seen.push(g && g.round));
  for (let r = 1; r <= 20; r++) list[0].setGame({ kind: 'hideSeek', phase: 'play', round: r });
  await waitFor(() => list[1].game && list[1].game.round === 20, { what: 'the latest game state' });
  assert.ok(seen.length < 10, 'updates are bundled, not sent one by one (' + seen.length + ')');
  const late = device();
  assert.deepEqual(await late.joinRoom(code, { nick: 'Cat' }), { ok: true });
  await waitFor(() => late.game && late.game.round === 20, { what: 'the late joiner to get it' });
  assert.equal(list[1].setGame({ round: 99 }), false, 'only the host sets the game');
  noDenied();
});

test('firebase: when the host drops off, its bots go, the next in line hosts, and it comes back as a guest', async () => {
  const { list } = await room(['Ava', 'Bea', 'Cat']);
  const [a, b, c] = list;
  const bot = a.addBot({ nick: 'Robo' });
  a.sendStateFor(bot, { x: 1, y: 0, z: 1, h: 0, anim: 'walk' });
  a.setGame({ kind: 'freezeTag', phase: 'play', round: 1 });
  await waitFor(() => c.players.has(bot) && c.game, { what: 'bot and game' });
  a.dev.network(false);
  await waitFor(() => !c.players.has(a.me.id) && !c.players.has(bot), { what: 'the server to remove the host and its bot' });
  await waitFor(() => b.isHost && hostNick(c) === 'Bea', { timeout: 4000, what: 'Bea to host' });
  assert.equal(a.status, 'connecting');
  assert.ok(b.setGame({ kind: 'freezeTag', phase: 'results', round: 1 }));
  a.dev.network(true);
  await waitFor(() => a.status === 'online' && c.players.has(a.me.id), { what: 'Ava to come back' });
  await waitFor(() => a.game && a.game.phase === 'results', { what: 'Ava to catch up with the game' });
  assert.equal(a.isHost, false);
  assert.deepEqual(nicksOf(c), ['Bea', 'Cat', 'Ava'], 'she rejoins at the end of the line');
  assert.equal(a.addBot({ nick: 'X' }), null);
  const data = fb.data('rooms/' + b.room.code);
  assert.ok(!Object.keys(data.players).some((k) => k.includes('-b')), 'no bot left behind in the database');
  noDenied();
});

test('firebase: a late disconnect from an old connection is healed', async () => {
  const { list } = await room(['Ava', 'Bea']);
  const [a, b] = list;
  const log = record(a, ['join', 'leave']);
  b.dev.blip({ staleMs: 300 }); // reconnects at once, but the server notices the old connection later
  await waitFor(() => log.some((e) => e.k === 'leave' && e.x.id === b.me.id), { what: 'the stale disconnect to remove Bea' });
  await waitFor(() => a.players.has(b.me.id) && fb.data('rooms/' + a.room.code + '/players/' + b.me.id), { what: 'Bea to put herself back' });
  b.sendState({ x: 2, y: 0, z: 2, h: 0, anim: 'idle' });
  await waitFor(() => a.stateOf(b.me.id) && a.stateOf(b.me.id).x === 2, { what: 'her position again' });
  assert.equal(b.status, 'online');
  noDenied();
});

test('firebase: nothing piles up while offline, and the latest state goes out on return', async () => {
  const { list } = await room(['Ava', 'Bea']);
  const [a, b] = list;
  b.dev.network(false);
  await waitFor(() => b.status === 'connecting', { what: 'Bea to notice' });
  for (let i = 0; i < 60; i++) {
    b.sendState({ x: i / 10, y: 0, z: 0, h: 0, anim: 'walk' });
    b.send('emote', { id: 'woo' });
    await sleep(5);
  }
  b.sendState({ x: 7, y: 0, z: 7, h: 0, anim: 'idle' });
  await sleep(300);
  assert.ok(b.dev.pendingWrites <= 1, 'no queue of stale writes: ' + b.dev.pendingWrites);
  b.dev.network(true);
  await waitFor(() => a.players.has(b.me.id) && a.stateOf(b.me.id) && a.stateOf(b.me.id).x === 7, { what: 'the latest state' });
  noDenied();
});

test('firebase: a host that stops answering is replaced after the 15 second rule', async () => {
  const host = device({}, { ...FAST, hostBeatMs: 1e9 }); // beats once, then goes quiet (a frozen tablet)
  const b = device();
  const code = await host.createRoom({ nick: 'Ava' });
  assert.deepEqual(await b.joinRoom(code, { nick: 'Bea' }), { ok: true });
  await sleep(1500);
  assert.equal(hostNick(b), 'Ava', 'the rules do not let anyone take over before 15 seconds');
  assert.ok(fb.denied.length > 0 && fb.denied.every((d) => d.path.includes('/meta/')), 'early claims were refused');
  assert.ok(fb.denied.length <= 3, 'and not retried in a tight loop: ' + fb.denied.length);
  fb.serverOffsetMs += 20000; // 20 seconds pass on the server
  await waitFor(() => b.isHost, { timeout: 4000, what: 'Bea to take over' });
  await waitFor(() => !host.isHost && host.room.hostId === b.me.id, { what: 'Ava to see it' });
});

test('firebase: the host tidies up old events', async () => {
  const { list, code } = await room(['Ava', 'Bea'], { ...FAST, trimEveryMs: 150, eventTtlMs: 400 });
  for (let i = 0; i < 6; i++) list[1].send('emote', { id: 'old' });
  await waitFor(() => Object.keys(fb.data('rooms/' + code + '/events') || {}).length === 6, { what: 'six events stored' });
  await sleep(700);
  list[1].send('emote', { id: 'new' });
  await waitFor(() => {
    const ev = fb.data('rooms/' + code + '/events') || {};
    return Object.keys(ev).length === 1;
  }, { what: 'the old ones to be trimmed' });
  noDenied();
});

test('firebase: leaving cleans up everything that was mine', async () => {
  const { list, code } = await room(['Ava', 'Bea']);
  const [a, b] = list;
  const bot = a.addBot({ nick: 'Robo' });
  a.sendStateFor(bot, { x: 1, y: 0, z: 1, h: 0, anim: 'walk' });
  a.sendState({ x: 2, y: 0, z: 2, h: 0, anim: 'idle' });
  await waitFor(() => fb.data('rooms/' + code + '/state/' + bot), { what: 'the bot state stored' });
  await a.leaveRoom();
  await fb.settle();
  const data = fb.data('rooms/' + code);
  assert.deepEqual(Object.keys(data.players), [b.me.id]);
  assert.deepEqual(Object.keys(data.state || {}).filter((k) => k !== b.me.id), []);
  assert.equal(data.meta.hostId, b.me.id, 'the host handed over on the way out');
  await waitFor(() => b.isHost, { what: 'Bea to know' });
  noDenied();
});

test('firebase: a full room says so', async () => {
  const { list, code } = await room(Array.from({ length: GAME.maxPlayers }, (_, i) => 'Kid ' + i));
  const extra = device();
  assert.deepEqual(await extra.joinRoom(code, { nick: 'Eleven' }), { ok: false, reason: 'full' });
  assert.equal(list[0].players.size, GAME.maxPlayers);
  noDenied();
});

test('firebase: missing, stale and mistyped rooms', async () => {
  const a = device();
  assert.deepEqual(await a.joinRoom('ZZZZ', { nick: 'Ava' }), { ok: false, reason: 'not-found' });
  assert.deepEqual(await a.joinRoom('hi!', { nick: 'Ava' }), { ok: false, reason: 'bad-code' });
  const old = Date.now() + fb.serverOffsetMs - 13 * 3600 * 1000;
  fb.write('rooms/QQQQ/meta', { hostId: 'someone', createdAt: old, beat: old, v: 1 });
  assert.deepEqual(await a.joinRoom('QQQQ', { nick: 'Ava' }), { ok: false, reason: 'not-found' }, 'a room nobody touched for 12 hours is gone');
});

test('firebase: a taken code is refused by the rules, a stale one can be reused', async () => {
  const devA = fb.device();
  const devB = fb.device();
  const ta = createFirebaseTransport({ config: TEST_CONFIG, sdk: devA });
  const tb = createFirebaseTransport({ config: TEST_CONFIG, sdk: devB });
  try {
    await ta.connect();
    await tb.connect();
    assert.equal(await ta.create('K7QZ'), 'ok');
    fb.write('rooms/K7QZ/players/' + devA.uid, { nick: 'Ava', look: '{}', bot: false, joinedAt: Date.now() + fb.serverOffsetMs });
    assert.equal(await tb.create('K7QZ'), 'taken', 'someone is in it');
    const old = Date.now() + fb.serverOffsetMs - 13 * 3600 * 1000;
    fb.write('rooms/K7QZ/meta', { hostId: devA.uid, createdAt: old, beat: old, v: 1 });
    assert.equal(await tb.create('K7QZ'), 'ok', 'twelve hours later the code is free again');
    assert.equal(fb.data('rooms/K7QZ/meta').hostId, devB.uid);
  } finally {
    ta.dispose();
    tb.dispose();
  }
});

test('firebase: nobody can list the rooms', async () => {
  const dev = fb.device();
  const t = createFirebaseTransport({ config: TEST_CONFIG, sdk: dev });
  try {
    await t.connect();
    assert.equal(await t.create('K7QZ'), 'ok');
    const app = dev.app.initializeApp(TEST_CONFIG, 'snoop');
    const auth = dev.auth.initializeAuth(app);
    await dev.auth.signInAnonymously(auth);
    const db = dev.database.getDatabase(app);
    await new Promise((resolve) => {
      const off = dev.database.onValue(dev.database.ref(db, '.info/connected'), (s) => {
        if (s.val() === true) {
          off();
          resolve();
        }
      });
    });
    await assert.rejects(dev.database.get(dev.database.ref(db, 'rooms')), /PERMISSION_DENIED/);
    const one = await dev.database.get(dev.database.ref(db, 'rooms/K7QZ/meta'));
    assert.ok(one.exists(), 'a room is readable by someone who knows its code');
  } finally {
    t.dispose();
  }
});

test('firebase: refused writes are handled quietly and the game carries on', async () => {
  const { list } = await room(['Ava', 'Bea']);
  const [a, b] = list;
  const got = [];
  b.on('event', (e) => got.push(e.data.id));
  fb.deny = ({ path }) => path.includes('/events/');
  assert.equal(a.send('emote', { id: 'lost' }), true);
  await sleep(150);
  assert.deepEqual(got, []);
  assert.ok(con.warnings.some((w) => w.includes('PERMISSION_DENIED')), 'a warning, not an error');
  fb.deny = null;
  a.send('emote', { id: 'found' });
  await waitFor(() => got.includes('found'), { what: 'events to flow again' });
});

test('firebase: when sign-in fails, rooms report offline and solo play is untouched', async () => {
  const net = device({ signInFails: true });
  const statuses = [];
  net.on('status', (s) => statuses.push(s));
  assert.deepEqual(await net.joinRoom('K7QZ', { nick: 'Ava' }), { ok: false, reason: 'offline' });
  await assert.rejects(net.createRoom({ nick: 'Ava' }), (err) => err.reason === 'offline');
  assert.equal(net.status, 'offline');
  assert.deepEqual(statuses.slice(0, 2), ['connecting', 'offline']);
  assert.equal(net.sendState({ x: 1, y: 0, z: 1, h: 0, anim: 'idle' }), true);
});

test('firebase: a refused join reports offline instead of hanging', async () => {
  const { code } = await room(['Ava']);
  fb.deny = ({ path }) => path.includes('/players/');
  const b = device();
  assert.deepEqual(await b.joinRoom(code, { nick: 'Bea' }), { ok: false, reason: 'offline' });
  assert.equal(b.room, null);
  fb.deny = null;
});

test('firebase: a ?room=CODE link remakes an empty room with its code, and names change mid-room', async () => {
  const { list, code } = await room(['Ava', 'Bea']);
  const [a, b] = list;
  a.updateMe({ nick: 'Captain Ava', look: { bow: 'gold' } });
  await waitFor(() => b.players.get(a.me.id) && b.players.get(a.me.id).nick === 'Captain Ava', { what: 'the new name' });
  assert.deepEqual(b.players.get(a.me.id).look, { bow: 'gold' });
  const c = device();
  assert.notEqual(await c.createRoom({ nick: 'Cat', code }), code, 'a room people are in keeps its code');
  await a.leaveRoom();
  await b.leaveRoom();
  await fb.settle();
  const d = device();
  assert.deepEqual(await d.joinRoom(code, { nick: 'Dot' }), { ok: false, reason: 'not-found' }, 'nobody is in it');
  assert.equal(await d.createRoom({ nick: 'Dot', code }), code, 'made afresh, the rules allow it');
  assert.equal(fb.data('rooms/' + code + '/meta').hostId, d.me.id);
  assert.deepEqual(await a.joinRoom(code, { nick: 'Ava' }), { ok: true });
  await waitFor(() => d.players.size === 2, { what: 'Ava back in' });
  noDenied();
});
