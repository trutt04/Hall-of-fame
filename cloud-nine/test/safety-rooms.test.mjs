// Kid safety review: the host can lock a room to the friends in it, and send a friend home.
// The rules (tools/rules-engine.mjs on the real firebase/database.rules.json), the local room store,
// a room across local tabs, and a room on the fake Firebase SDK all agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRules } from '../tools/rules-engine.mjs';
import { createRoomStore } from '../js/net/room-store.js';
import { createNet } from '../js/net/index.js';
import { createFakeFirebase } from '../tools/fake-firebase.mjs';
import { rulesJson, TEST_CONFIG, FAST, NO_HELPERS, waitFor, watchConsole, localTabs } from './net-kit.mjs';

const NOW = 1_800_000_000_000;
const A = { uid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa' }; // the host
const B = { uid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb' }; // a friend in the room
const C = { uid: 'cccccccccccccccccccccccccccc' }; // someone who guessed the code
const R = 'rooms/K7QZ';
const rules = compileRules(rulesJson());

const player = (over = {}) => ({ nick: 'Ava', look: '{"bow":"pink"}', bot: false, joinedAt: NOW, ...over });
function baseRoot({ locked = false, allow = null } = {}) {
  return {
    rooms: {
      K7QZ: {
        meta: { hostId: A.uid, createdAt: NOW - 1000, beat: NOW - 1000, v: 1, ...(locked ? { locked: true } : {}) },
        ...(allow ? { allow } : {}),
        players: { [A.uid]: player({ joinedAt: NOW - 900 }), [B.uid]: player({ nick: 'Bea', joinedAt: NOW - 800 }) },
        state: { [A.uid]: { x: 1, y: 0, z: 2, h: 0, a: 'idle', t: NOW }, [B.uid]: { x: 1, y: 0, z: 2, h: 0, a: 'idle', t: NOW } },
        game: { by: A.uid, json: '{}', t: NOW - 500 },
      },
    },
  };
}
const lockedRoot = () => baseRoot({ locked: true, allow: { [A.uid]: true, [B.uid]: true } });
const write = (auth, p, v, root) => rules.canWrite(p, v, { auth, root, now: NOW }).ok;
const update = (auth, p, v, root) => rules.canUpdate(p, v, { auth, root, now: NOW }).ok;
const read = (auth, p, root) => rules.canRead(p, { auth, root, now: NOW }).ok;
const lockUpdate = (ids, locked = true) => ({ allow: locked ? Object.fromEntries(ids.map((u) => [u.uid, true])) : null, 'meta/locked': locked, 'meta/beat': NOW });

test('rooms: only the host locks a room, to a list of player ids', () => {
  assert.equal(update(A, R, lockUpdate([A, B]), baseRoot()), true, 'the host locks it in one update');
  assert.equal(update(B, R, lockUpdate([A, B]), baseRoot()), false, 'a guest cannot');
  assert.equal(update(C, R, lockUpdate([C]), baseRoot()), false, 'a stranger cannot');
  assert.equal(write(B, R + '/allow/' + B.uid, true, baseRoot()), false, 'nobody but the host writes the list');
  assert.equal(update(A, R + '/meta', { locked: 'yes', beat: NOW }, baseRoot()), false, 'locked is true or false');
  assert.equal(write(A, R + '/allow/' + B.uid, 'yes', baseRoot()), false, 'list entries are true');
  assert.equal(write(A, R + '/allow/not an id', true, baseRoot()), false);
  assert.equal(update(A, R, lockUpdate([], false), lockedRoot()), true, 'the host unlocks it');
  assert.equal(update(B, R, lockUpdate([], false), lockedRoot()), false);
});

test('rooms: a locked room keeps strangers out, and its friends in', () => {
  const root = lockedRoot();
  assert.equal(write(C, R + '/players/' + C.uid, player(), root), false, 'no joining');
  for (const part of ['players', 'state', 'events', 'game']) {
    assert.equal(read(C, R + '/' + part, root), false, part + ': hidden from strangers');
    assert.equal(read(B, R + '/' + part, root), true, part + ': friends on the list still see it');
  }
  assert.equal(read(C, R + '/meta', root), true, 'a stranger can see that it is locked');
  assert.equal(read(C, R + '/allow/' + C.uid, root), true, 'and check the list for themselves');
  assert.equal(read(C, R + '/allow/' + B.uid, root), false, 'but not read anyone else on it');
  assert.equal(read(C, R + '/allow', root), false);
  // a friend who dropped out for a moment (their entry removed on disconnect) comes back
  delete root.rooms.K7QZ.players[B.uid];
  assert.equal(write(B, R + '/players/' + B.uid, player({ nick: 'Bea' }), root), true, 'back in');
  assert.equal(update(B, R + '/players/' + B.uid, { nick: 'Bea Two' }, lockedRoot()), true, 'and can change their name');
  // bots are the host's, so a lock does not touch them
  assert.equal(write(A, R + '/players/' + A.uid + '-b1', player({ nick: 'Robo', bot: true, owner: A.uid }), root), true, 'bots still join');
  // unlocked again: anyone with the code
  const open = baseRoot();
  assert.equal(write(C, R + '/players/' + C.uid, player(), open), true);
  assert.equal(read(C, R + '/players', open), true);
});

test('rooms: the host sends a friend home: off the list first, then out, and they cannot come back', () => {
  const root = lockedRoot();
  assert.equal(write(A, R + '/players/' + B.uid, null, root), false, 'not while they are on the list');
  assert.equal(write(A, R + '/players/' + B.uid, null, baseRoot()), false, 'not in an open room (they would come right back)');
  assert.equal(update(A, R, lockUpdate([A]), root), true, 'the list without them');
  const after = baseRoot({ locked: true, allow: { [A.uid]: true } });
  assert.equal(write(A, R + '/players/' + B.uid, null, after), true, 'then their entry');
  assert.equal(write(B, R + '/players/' + A.uid, null, after), false, 'a guest never removes anyone');
  delete after.rooms.K7QZ.players[B.uid];
  assert.equal(write(A, R + '/state/' + B.uid, null, after), true, 'and what is left of their position');
  assert.equal(write(B, R + '/players/' + B.uid, player({ nick: 'Bea' }), after), false, 'no way back in');
  assert.equal(read(B, R + '/players', after), false, 'nor a look inside');
  const ev = { from: B.uid, type: 'emote', data: '{"id":"hi"}', t: NOW };
  assert.equal(write(B, R + '/events/-Nbbbbbbbbbbbbbbbbbb', ev, after), false, 'nor a quick-cheer');
  assert.equal(write(A, R + '/players/' + A.uid + '-b1', player({ nick: 'Robo', bot: true, owner: A.uid }), after), true, 'bots: unaffected');
});

test('rooms: the local room store allows and refuses the same things', () => {
  let t = NOW;
  const store = createRoomStore({ now: () => t });
  const code = 'K7QZ';
  const run = (by, op) => store.exec(by, { code, ...op });
  const ok = (by, op) => run(by, op).ok;
  const join = (id) => ok(id, { op: 'putPlayer', id, entry: { nick: 'Ava', look: '{}', bot: false } });
  assert.equal(ok('pa', { op: 'create' }), true);
  assert.equal(join('pa'), true);
  assert.equal(join('pb'), true);
  assert.equal(ok('pb', { op: 'lock', locked: true, allow: ['pb'] }), false, 'only the host locks');
  assert.equal(ok('pa', { op: 'lock', locked: true, allow: ['pa', 'pb'] }), true);
  assert.equal(store.room(code).meta.locked, true);
  assert.deepEqual(run('pc', { op: 'probe' }).value, { meta: store.room(code).meta, locked: true }, 'a stranger sees only that it is locked');
  assert.ok(run('pb', { op: 'probe' }).value.players.pb, 'a friend sees the room');
  assert.equal(join('pc'), false, 'no joining');
  assert.equal(store.canRead('pc', code), false);
  assert.equal(store.canRead('pb', code), true);
  assert.equal(ok('pa', { op: 'putPlayer', id: 'pa-b1', entry: { nick: 'Robo', look: '{}', bot: true, owner: 'pa' } }), true, 'bots: unaffected');
  assert.equal(ok('pa', { op: 'dropPlayer', id: 'pb' }), false, 'not while they are on the list');
  assert.equal(store.exec(null, { op: 'gone', id: 'pb' }).ok, true, 'a friend drops out for a moment...');
  assert.equal(store.room(code).players.has('pb'), false);
  assert.equal(join('pb'), true, '...and comes back');
  assert.equal(ok('pa', { op: 'lock', locked: true, allow: ['pa'] }), true, 'sending pb home: off the list');
  assert.equal(ok('pa', { op: 'dropPlayer', id: 'pb' }), true, 'then out');
  assert.equal(ok('pa', { op: 'dropState', id: 'pb' }), true);
  assert.equal(join('pb'), false, 'and not back');
  assert.equal(store.canRead('pb', code), false);
  // a snapshot (a new leader tab) keeps the list
  const copy = createRoomStore({ now: () => t });
  copy.load(store.snapshot());
  assert.equal(copy.canRead('pb', code), false);
  assert.equal(copy.canRead('pa', code), true);
  assert.equal(ok('pa', { op: 'lock', locked: false, allow: [] }), true, 'unlocked');
  assert.equal(join('pc'), true, 'anyone with the code again');
  assert.equal(ok('pb', { op: 'dropPlayer', id: 'pc' }), false, 'a guest never removes anyone');
});

test('rooms: across local tabs: lock, a stranger is told it is locked, a friend is sent home kindly', async () => {
  const con = watchConsole();
  const tabs = localTabs();
  try {
    const [host, pal, stranger] = [tabs.open(), tabs.open(), tabs.open()];
    const code = await host.createRoom({ nick: 'Ava' });
    assert.deepEqual(await pal.joinRoom(code, { nick: 'Bea' }), { ok: true });
    await waitFor(() => host.players.size === 2 && pal.players.size === 2, { what: 'both in' });
    const seen = [];
    pal.on('room', (e) => seen.push(e.locked));
    assert.equal(await pal.lockRoom(true), false, 'only the host locks');
    assert.equal(await host.lockRoom(true), true);
    await waitFor(() => pal.room && pal.room.locked, { what: 'the lock to reach the friend' });
    assert.deepEqual(seen, [true]);
    assert.deepEqual(await stranger.joinRoom(code, { nick: 'Cat' }), { ok: false, reason: 'locked' });
    assert.equal(stranger.room, null);
    assert.ok(host.addBot({ nick: 'Robo' }), 'bots still join a locked room');
    await waitFor(() => host.players.size === 3, { what: 'the bot' });
    const out = [];
    pal.on('leave', (e) => out.push(e));
    const palId = pal.me.id;
    assert.equal(await pal.sendHome(host.me.id), false, 'a guest never sends anyone home');
    assert.equal(await host.sendHome(host.me.id), false, 'nor the host itself');
    assert.equal(await host.sendHome(palId), true);
    await waitFor(() => out.some((e) => e.id === palId), { what: 'the friend to head home' });
    assert.equal(out.find((e) => e.id === palId).reason, 'removed');
    assert.equal(pal.room, null);
    await waitFor(() => !host.players.has(palId), { what: 'the host to see them go' });
    assert.deepEqual(await pal.joinRoom(code, { nick: 'Bea' }), { ok: false, reason: 'locked' }, 'and they cannot come back');
    assert.equal(await host.lockRoom(false), true);
    await waitFor(() => host.room && !host.room.locked, { what: 'unlocked' });
    assert.deepEqual(await stranger.joinRoom(code, { nick: 'Cat' }), { ok: true }, 'open again');
  } finally {
    tabs.closeAll();
    con.restore();
  }
  assert.deepEqual(con.errors, []);
});

test('rooms: on Firebase: a locked room hides from strangers; a friend who drops out comes back; sent home means out', async () => {
  const con = watchConsole();
  const fb = createFakeFirebase({ rules: rulesJson(), latencyMs: 3 });
  const nets = [];
  const device = () => {
    const dev = fb.device();
    const net = createNet({ mode: 'firebase', firebase: { sdk: dev, config: TEST_CONFIG }, tuning: FAST, helpers: NO_HELPERS });
    net.dev = dev;
    nets.push(net);
    return net;
  };
  try {
    const [host, pal, stranger] = [device(), device(), device()];
    const code = await host.createRoom({ nick: 'Ava' });
    assert.deepEqual(await pal.joinRoom(code, { nick: 'Bea' }), { ok: true });
    await waitFor(() => host.players.size === 2 && pal.players.size === 2, { what: 'both in' });
    assert.equal(await host.lockRoom(true), true);
    await waitFor(() => pal.room && pal.room.locked, { what: 'the lock' });
    assert.deepEqual(fb.data('rooms/' + code + '/allow'), { [host.me.id]: true, [pal.me.id]: true });
    assert.deepEqual(await stranger.joinRoom(code, { nick: 'Cat' }), { ok: false, reason: 'locked' });
    assert.equal(stranger.room, null);
    // the friend's connection drops (the server removes their entry), then comes back
    pal.dev.network(false);
    await waitFor(() => !host.players.has(pal.me.id), { what: 'the drop' });
    pal.dev.network(true);
    await waitFor(() => host.players.has(pal.me.id) && pal.room, { what: 'the friend back in', timeout: 6000 });
    const out = [];
    pal.on('leave', (e) => out.push(e));
    const palId = pal.me.id;
    assert.equal(await host.sendHome(palId), true);
    await waitFor(() => out.some((e) => e.id === palId), { what: 'the friend to head home', timeout: 6000 });
    assert.equal(out.find((e) => e.id === palId).reason, 'removed');
    assert.equal(fb.data('rooms/' + code + '/players/' + palId), null);
    assert.deepEqual(await pal.joinRoom(code, { nick: 'Bea' }), { ok: false, reason: 'locked' });
    assert.equal(await host.lockRoom(false), true);
    await waitFor(() => host.room && !host.room.locked, { what: 'unlocked' });
    assert.equal(fb.data('rooms/' + code + '/allow'), null, 'unlocking clears the list');
    assert.deepEqual(await stranger.joinRoom(code, { nick: 'Cat' }), { ok: true });
  } finally {
    for (const n of nets) n.dispose();
    await fb.settle();
    con.restore();
  }
  assert.deepEqual(con.errors, []);
});
