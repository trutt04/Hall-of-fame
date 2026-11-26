// firebase/database.rules.json, checked line by line with tools/rules-engine.mjs, and the local
// transport's server (room-store.js), which must allow and refuse the same things.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileRules } from '../tools/rules-engine.mjs';
import { createRoomStore } from '../js/net/room-store.js';
import { isConfigured, FIREBASE_CONFIG } from '../js/net/firebase-config.js';
import { rulesJson, C9, TEST_CONFIG } from './net-kit.mjs';

const NOW = 1_800_000_000_000;
const HOUR = 3600 * 1000;
const A = { uid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
const B = { uid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
const C = { uid: 'cccccccccccccccccccccccccccc' };
const R = 'rooms/K7QZ';
const rules = compileRules(rulesJson());

const player = (over = {}) => ({ nick: 'Ava', look: '{"bow":"pink"}', bot: false, joinedAt: NOW, ...over });
const meta = (host, over = {}) => ({ hostId: host.uid, createdAt: NOW, beat: NOW, v: 1, ...over });
const state = (over = {}) => ({ x: 1, y: 0, z: 2, h: 0.5, a: 'walk', t: NOW, ...over });
const event = (from, over = {}) => ({ from: from.uid, type: 'emote', data: '{"id":"woo"}', t: NOW, ...over });

// A room with A hosting, B playing, a bot of A's and some state.
function baseRoot() {
  return {
    rooms: {
      K7QZ: {
        meta: meta(A, { createdAt: NOW - 1000, beat: NOW - 1000 }),
        players: { [A.uid]: player({ joinedAt: NOW - 900 }), [B.uid]: player({ nick: 'Bea', joinedAt: NOW - 800 }), [A.uid + '-b1']: player({ nick: 'Robo', bot: true, owner: A.uid, joinedAt: NOW - 700 }) },
        state: { [A.uid]: state(), [B.uid]: state(), [A.uid + '-b1']: state() },
        events: { '-Naaaaaaaaaaaaaaaaaa': event(B) },
        game: { by: A.uid, json: '{}', t: NOW - 500 },
      },
    },
  };
}

function write(auth, p, value, root = baseRoot(), now = NOW) {
  return rules.canWrite(p, value, { auth, root, now }).ok;
}
function update(auth, p, values, root = baseRoot(), now = NOW) {
  return rules.canUpdate(p, values, { auth, root, now }).ok;
}

test('rules: the file is plain JSON that parses cleanly, with only the paths of the blueprint', () => {
  const json = rulesJson();
  assert.deepEqual(rules.lint(), []);
  assert.equal(json.rules['.read'], false);
  assert.equal(json.rules['.write'], false);
  assert.deepEqual(Object.keys(json.rules), ['.read', '.write', 'rooms']);
  const room = json.rules.rooms.$code;
  assert.deepEqual(Object.keys(room).filter((k) => !k.startsWith('.')), ['meta', 'allow', 'players', 'state', 'events', 'game', '$other']);
  assert.equal(room['.read'], undefined, 'each part of a room says who may read it');
  assert.equal(room.$other['.validate'], false, 'nothing else can be stored in a room');
  const text = fs.readFileSync(path.join(C9, 'firebase', 'database.rules.json'), 'utf8');
  assert.ok(!/ \? /.test(text), 'no ternaries (kept to the simplest expression syntax)');
  assert.ok(!/\{\d/.test(text), 'no {n} quantifiers in regexes');
});

test('rules: rooms can be read by code but never listed', () => {
  const root = baseRoot();
  assert.equal(rules.canRead('rooms', { auth: A, root, now: NOW }).ok, false, 'no room list');
  assert.equal(rules.canRead('', { auth: A, root, now: NOW }).ok, false);
  for (const part of ['meta', 'players', 'state', 'events', 'game']) {
    assert.equal(rules.canRead(R + '/' + part, { auth: C, root, now: NOW }).ok, true, part + ': anyone signed in who knows the code');
    assert.equal(rules.canRead(R + '/' + part, { auth: null, root, now: NOW }).ok, false, part + ': not without signing in');
    assert.equal(rules.canRead('rooms/k7qz/' + part, { auth: A, root, now: NOW }).ok, false, part + ': only real room codes');
  }
  assert.equal(rules.canRead(R, { auth: A, root, now: NOW }).ok, false, 'a room is read part by part');
  assert.equal(rules.canRead('somewhere/else', { auth: A, root, now: NOW }).ok, false);
  assert.equal(write(A, 'somewhere/else', 1), false);
});

test('rules: making a room', () => {
  const empty = null;
  assert.equal(write(A, R + '/meta', meta(A), empty), true);
  assert.equal(write(A, R + '/meta', meta(B), empty), false, 'only as its host');
  assert.equal(write(null, R + '/meta', meta(A), empty), false, 'only when signed in');
  assert.equal(write(A, 'rooms/ABCD/meta', meta(A), empty), false, 'codes have no vowels');
  assert.equal(write(A, 'rooms/K7QZZ/meta', meta(A), empty), false, 'codes have four characters');
  assert.equal(write(A, R + '/meta', meta(A, { createdAt: NOW - 5 * 60000 }), empty), false, 'createdAt is now');
  assert.equal(write(A, R + '/meta', meta(A, { v: 2 }), empty), false);
  assert.equal(write(A, R + '/meta', meta(A, { extra: 1 }), empty), false);
  assert.equal(write(A, R + '/meta', { hostId: A.uid, createdAt: NOW, v: 1 }, empty), false, 'all fields');
  assert.equal(write(C, R + '/meta', meta(C)), false, 'a code in use is taken');
  const stale = baseRoot();
  stale.rooms.K7QZ.meta.beat = NOW - 13 * HOUR;
  assert.equal(write(C, R + '/meta', meta(C), stale), true, 'after 12 quiet hours the code is free again');
  assert.equal(write(A, R + '/meta', null), false, 'a room is never deleted');
});

test('rules: the host, and only the host, changes meta; others may take over when the host is gone', () => {
  assert.equal(update(A, R + '/meta', { beat: NOW }), true, 'heartbeat');
  assert.equal(update(A, R + '/meta', { hostId: B.uid, beat: NOW }), true, 'hand over');
  assert.equal(update(B, R + '/meta', { beat: NOW }), false);
  assert.equal(update(A, R + '/meta', { createdAt: NOW }), false, 'createdAt never changes');
  assert.equal(update(A, R + '/meta', { hostId: 'not valid!', beat: NOW }), false);
  assert.equal(update(B, R + '/meta', { hostId: B.uid, beat: NOW }), false, 'no takeover while the host is here and answering');
  const gone = baseRoot();
  delete gone.rooms.K7QZ.players[A.uid];
  assert.equal(update(B, R + '/meta', { hostId: B.uid, beat: NOW }, gone), true, 'the host left: the next one claims');
  assert.equal(update(C, R + '/meta', { hostId: C.uid, beat: NOW }, gone), false, 'only someone in the room');
  assert.equal(update(B, R + '/meta', { hostId: C.uid, beat: NOW }, gone), false, 'a claim is for yourself');
  const frozen = baseRoot();
  frozen.rooms.K7QZ.meta.beat = NOW - 16000;
  assert.equal(update(B, R + '/meta', { hostId: B.uid, beat: NOW }, frozen), true, 'no heartbeat for 15 s: the next one claims');
  frozen.rooms.K7QZ.meta.beat = NOW - 10000;
  assert.equal(update(B, R + '/meta', { hostId: B.uid, beat: NOW }, frozen), false, 'but not after 10 s');
});

test('rules: players write only their own entry, with a short clean name', () => {
  const at = R + '/players/';
  assert.equal(write(C, at + C.uid, player()), true, 'join');
  assert.equal(write(C, at + B.uid, player()), false, 'not as someone else');
  assert.equal(write(C, at + C.uid, player({ nick: 'Bad<b>' })), false);
  assert.equal(write(C, at + C.uid, player({ nick: 'x'.repeat(25) })), false);
  assert.equal(write(C, at + C.uid, player({ nick: '' })), false);
  assert.equal(write(C, at + C.uid, player({ look: 'x'.repeat(601) })), false);
  assert.equal(write(C, at + C.uid, player({ look: { bow: 'pink' } })), false, 'a look is text');
  assert.equal(write(C, at + C.uid, player({ joinedAt: 5 })), false, 'joinedAt is the server time');
  assert.equal(write(C, at + C.uid, player({ bot: true, owner: C.uid })), false, 'you are not a bot');
  assert.equal(write(C, at + C.uid, player({ owner: A.uid })), false);
  assert.equal(write(C, at + C.uid, player({ chat: 'hi' })), false, 'no extra fields, no free text');
  assert.equal(write(C, 'rooms/QQQQ/players/' + C.uid, player()), false, 'only rooms that exist');
  const stale = baseRoot();
  stale.rooms.K7QZ.meta.beat = NOW - 13 * HOUR;
  assert.equal(write(C, at + C.uid, player(), stale), false, 'not into a stale room');
  assert.equal(update(B, at + B.uid, { nick: 'Bea Two', look: '{}' }), true, 'change your name and look');
  assert.equal(update(B, at + B.uid, { joinedAt: NOW + 5 }), false, 'but not when you joined');
  assert.equal(write(B, at + B.uid, null), true, 'leave');
  assert.equal(write(B, at + A.uid, null), false, 'not someone else');
});

test('rules: only the host makes bots, named after itself, and anyone may clear what is theirs', () => {
  const at = R + '/players/';
  const bot = (owner, over = {}) => player({ nick: 'Robo', bot: true, owner: owner.uid, ...over });
  assert.equal(write(A, at + A.uid + '-b2', bot(A)), true);
  assert.equal(write(B, at + B.uid + '-b1', bot(B)), false, 'not by a guest');
  assert.equal(write(A, at + 'bot1', bot(A)), false, 'bot ids start with the host id');
  assert.equal(write(A, at + A.uid + '-b2', bot(B)), false, 'owned by the host');
  assert.equal(write(A, at + B.uid + '-b2', bot(A)), false);
  assert.equal(write(A, at + A.uid + '-b1', null), true);
  assert.equal(write(B, at + A.uid + '-b1', null), false, 'a guest cannot remove the host\'s bot');
  // a bot left behind by an old host is cleared by the new one
  const handed = baseRoot();
  handed.rooms.K7QZ.meta.hostId = B.uid;
  assert.equal(write(B, at + A.uid + '-b1', null, handed), true);
  assert.equal(write(B, at + A.uid, null, handed), false, 'but not a real player');
  // and an entry from an earlier room with the same code
  const old = baseRoot();
  old.rooms.K7QZ.players[C.uid] = player({ joinedAt: NOW - 20 * HOUR });
  assert.equal(write(A, at + C.uid, null, old), true);
  assert.equal(write(B, at + C.uid, null, old), false);
  assert.equal(write(B, at + 'nobody', null), true, 'removing nothing is harmless (onDisconnect set before the entry)');
});

test('rules: positions belong to their player, within the island', () => {
  const at = R + '/state/';
  assert.equal(write(B, at + B.uid, state()), true);
  assert.equal(write(B, at + A.uid, state()), false);
  assert.equal(write(C, at + C.uid, state()), false, 'only once you are in the room');
  assert.equal(write(A, at + A.uid + '-b1', state()), true, 'the host moves its bots');
  assert.equal(write(B, at + A.uid + '-b1', state()), false);
  for (const bad of [{ x: 501 }, { y: -501 }, { z: 'far' }, { h: 11 }, { a: 'walk1' }, { a: 'x'.repeat(17) }, { a: '' }, { t: -1 }, { extra: 1 }]) {
    assert.equal(write(B, at + B.uid, state(bad)), false, JSON.stringify(bad));
  }
  assert.equal(write(B, at + B.uid, { x: 1, y: 0, z: 2, h: 0, a: 'idle' }), false, 'all fields');
  assert.equal(write(B, at + B.uid, null), true);
  const orphan = baseRoot();
  delete orphan.rooms.K7QZ.players[B.uid];
  assert.equal(write(A, at + B.uid, null, orphan), true, 'the host clears state nobody owns');
  assert.equal(write(C, at + B.uid, null, orphan), false);
});

test('rules: events are preset types, small, from yourself, and only the host starts games', () => {
  const at = R + '/events/';
  const key = '-Nbbbbbbbbbbbbbbbbbb';
  assert.equal(write(B, at + key, event(B)), true);
  for (const type of ['emote', 'claim', 'fx']) assert.equal(write(B, at + key, event(B, { type })), true, type);
  assert.equal(write(B, at + key, event(A)), false, 'not in someone else\'s name');
  assert.equal(write(C, at + key, event(C)), false, 'not from outside the room');
  assert.equal(write(B, at + key, event(B, { type: 'chat' })), false, 'no chat');
  assert.equal(write(B, at + key, event(B, { data: 'x'.repeat(1025) })), false, 'small payloads');
  assert.equal(write(B, at + key, event(B, { data: { id: 'woo' } })), false, 'data is text');
  assert.equal(write(B, at + key, event(B, { t: NOW - 3 * 60000 })), false, 'the time is the server\'s');
  assert.equal(write(B, at + key, event(B, { extra: 1 })), false);
  assert.equal(write(B, at + key, event(B, { type: 'game-start' })), false, 'only the host starts games');
  assert.equal(write(A, at + key, event(A, { type: 'game-start' })), true);
  assert.equal(write(A, at + key, event(A, { type: 'game-end' })), true);
  assert.equal(write(B, at + '-Naaaaaaaaaaaaaaaaaa', event(B, { data: '{}' })), false, 'events are never rewritten');
  assert.equal(write(B, at + '-Naaaaaaaaaaaaaaaaaa', null), false, 'or removed by guests');
  assert.equal(update(A, R + '/events', { '-Naaaaaaaaaaaaaaaaaa': null, '-Nzzzzzzzzzzzzzzzzzz': null }), true, 'the host trims old ones');
  assert.equal(write(A, at + 'x'.repeat(41), event(A)), false);
});

test('rules: only the host writes the game state', () => {
  const at = R + '/game';
  assert.equal(write(A, at, { by: A.uid, json: '{"phase":"play"}', t: NOW }), true);
  assert.equal(write(B, at, { by: B.uid, json: '{}', t: NOW }), false);
  assert.equal(write(A, at, { by: B.uid, json: '{}', t: NOW }), false, 'signed by the writer');
  assert.equal(write(A, at, { by: A.uid, json: 'x'.repeat(16001), t: NOW }), false);
  assert.equal(write(A, at, { by: A.uid, json: { phase: 'play' }, t: NOW }), false);
  assert.equal(write(A, at, { by: A.uid, json: '{}', t: NOW, extra: 1 }), false);
  assert.equal(write(A, at, null), true);
  assert.equal(write(A, R + '/chat', { text: 'hi' }), false, 'no other paths in a room');
});

test('rules: the local server allows and refuses the same things', () => {
  let t = NOW;
  const store = createRoomStore({ now: () => t });
  const code = 'K7QZ';
  const ok = (by, op) => store.exec(by, { code, ...op }).ok;
  assert.equal(ok('pa', { op: 'create' }), true);
  assert.equal(ok('pa', { op: 'putPlayer', id: 'pa', entry: { nick: 'Ava', look: '{}', bot: false } }), true);
  assert.equal(ok('pb', { op: 'create' }), false, 'a code in use is taken');
  assert.equal(ok('pb', { op: 'putPlayer', id: 'pb', entry: { nick: 'Bea', look: '{}', bot: false } }), true);
  assert.equal(ok('pb', { op: 'putPlayer', id: 'pa', entry: { nick: 'Bea', look: '{}', bot: false } }), false, 'not as someone else');
  assert.equal(ok('pb', { op: 'putPlayer', id: 'pb', entry: { nick: 'Bad<b>', look: '{}', bot: false } }), false);
  assert.equal(ok('pb', { op: 'putPlayer', id: 'pb-b1', entry: { nick: 'Robo', look: '{}', bot: true, owner: 'pb' } }), false, 'guests make no bots');
  assert.equal(ok('pa', { op: 'putPlayer', id: 'pa-b1', entry: { nick: 'Robo', look: '{}', bot: true, owner: 'pa' } }), true);
  assert.equal(ok('pa', { op: 'putPlayer', id: 'bot1', entry: { nick: 'Robo', look: '{}', bot: true, owner: 'pa' } }), false);
  assert.equal(ok('pb', { op: 'putState', id: 'pa', s: state() }), false);
  assert.equal(ok('pb', { op: 'putState', id: 'pb', s: state({ x: 900 }) }), false);
  assert.equal(ok('pa', { op: 'putState', id: 'pa-b1', s: state() }), true);
  assert.equal(ok('pb', { op: 'event', ev: { type: 'emote', data: '{}' } }), true);
  assert.equal(ok('pb', { op: 'event', ev: { type: 'chat', data: '{}' } }), false);
  assert.equal(ok('pb', { op: 'event', ev: { type: 'game-start', data: '{}' } }), false);
  assert.equal(ok('pa', { op: 'event', ev: { type: 'game-start', data: '{}' } }), true);
  assert.equal(ok('pc', { op: 'event', ev: { type: 'emote', data: '{}' } }), false, 'only from inside the room');
  assert.equal(ok('pb', { op: 'setGame', json: '{}' }), false);
  assert.equal(ok('pa', { op: 'setGame', json: '{}' }), true);
  assert.equal(ok('pb', { op: 'claim' }), false, 'no takeover while the host answers');
  assert.equal(ok('pb', { op: 'meta', patch: { hostId: 'pb' } }), false);
  t += 16000;
  assert.equal(ok('pb', { op: 'claim' }), true, 'after 15 quiet seconds');
  assert.equal(store.room(code).meta.hostId, 'pb');
  assert.equal(ok('pb', { op: 'dropPlayer', id: 'pa-b1' }), true, 'the new host clears the old bots');
  t += 13 * HOUR;
  assert.equal(ok('pc', { op: 'create' }), true, 'a stale code is free again');
});

test('config: placeholders mean "not set up yet"', () => {
  assert.equal(isConfigured(), true, 'the committed file has the family project filled in');
  assert.equal(isConfigured(FIREBASE_CONFIG), true);
  assert.equal(isConfigured({ ...FIREBASE_CONFIG, apiKey: 'PASTE-API-KEY-HERE' }), false, 'a placeholder turns rooms off');
  assert.equal(isConfigured(TEST_CONFIG), true);
  assert.equal(isConfigured({ ...TEST_CONFIG, databaseURL: 'https://cloud-nine-test-default-rtdb.europe-west1.firebasedatabase.app' }), true);
  assert.equal(isConfigured({ ...TEST_CONFIG, databaseURL: undefined }), false, 'the database address is needed');
  assert.equal(isConfigured({ ...TEST_CONFIG, databaseURL: 'http://insecure.firebaseio.com' }), false);
  assert.equal(isConfigured({ ...TEST_CONFIG, apiKey: 'YOUR_API_KEY' }), false);
  assert.equal(isConfigured(null), false);
});

test('rules: a room nobody is in can be made again at once (for ?room=CODE links)', () => {
  const empty = baseRoot();
  delete empty.rooms.K7QZ.players;
  assert.equal(write(C, R + '/meta', meta(C), empty), true);
  assert.equal(write(C, R + '/meta', meta(C)), false, 'not while anyone is in it');
  const store = createRoomStore({ now: () => NOW });
  assert.equal(store.exec('pa', { op: 'create', code: 'K7QZ' }).ok, true);
  assert.equal(store.exec('pa', { op: 'putPlayer', code: 'K7QZ', id: 'pa', entry: { nick: 'Ava', look: '{}', bot: false } }).ok, true);
  assert.equal(store.exec('pb', { op: 'create', code: 'K7QZ' }).ok, false, 'busy');
  assert.equal(store.exec('pa', { op: 'dropPlayer', code: 'K7QZ', id: 'pa' }).ok, true);
  assert.equal(store.exec('pb', { op: 'create', code: 'K7QZ' }).ok, true, 'empty: free again');
});

test('rules: the host may remove its room once nobody is in it, and nobody else may (the online check tidies up)', () => {
  const empty = baseRoot();
  delete empty.rooms.K7QZ.players;
  assert.equal(write(A, R + '/meta', null, empty), true, 'its host, once the room is empty');
  assert.equal(write(B, R + '/meta', null, empty), false, 'not anyone else');
  assert.equal(write(null, R + '/meta', null, empty), false, 'not without signing in');
  assert.equal(write(A, R + '/meta', null), false, 'not while anyone is in it');
  assert.equal(write(A, R, null, empty), false, 'part by part, never the whole room at once');
  assert.equal(update(A, R + '/meta', { hostId: null, beat: NOW }, empty), false, 'never half a meta');
  assert.equal(write(A, 'rooms/NNNN/meta', null, empty), false, 'nothing there to remove');
  // in one go with the last entries in it (how the check's disconnect job removes the test room)
  const alone = baseRoot();
  delete alone.rooms.K7QZ.players[B.uid];
  const last = { meta: null, ['players/' + A.uid]: null, ['state/' + A.uid]: null, ['players/' + A.uid + '-b1']: null, ['state/' + A.uid + '-b1']: null };
  assert.equal(update(A, R, last, alone), true, 'the host, its bots and the room together');
  assert.equal(update(A, R, last), false, 'not while a friend is still in it');
  assert.equal(update(A, R, { ...last, ['players/' + B.uid]: null }), false, 'and never by taking the friend out too');
  assert.equal(update(B, R, { meta: null, ['players/' + B.uid]: null }), false, 'a guest never removes the room');
});
