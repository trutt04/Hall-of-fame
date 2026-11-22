// APP: js/ui/standins.js. The offline stand-in has the Contract 4 shape: solo rooms with bots
// work with no network, and its 'local' mode lets two instances share a room over BroadcastChannel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandinNet, createSilentAudio, cleanState, randomCode, STANDIN_CONTENT } from '../js/ui/standins.js';
import { isValidCode } from '../js/ui/codepad.js';
import { GAME } from '../js/config.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('offline: a solo room with me as host, bots are players', async () => {
  const net = createStandinNet({ mode: 'offline' });
  assert.equal(net.status, 'offline');
  assert.equal(net.room, null);
  assert.equal(net.isHost, false);
  const joins = [];
  net.on('join', (e) => joins.push(e.id));
  const code = await net.createRoom({ nick: 'Bailey', look: { bow: 'pink' } });
  assert.ok(isValidCode(code));
  assert.equal(net.room.code, code);
  assert.equal(net.isHost, true);
  assert.equal(net.players.size, 1);
  assert.equal(net.players.get(net.me.id).nick, 'Bailey');
  const bot = net.addBot({ nick: 'Sparkle Comet', look: null });
  assert.ok(bot);
  assert.equal(net.players.get(bot).bot, true);
  assert.deepEqual(joins, [bot]);
  net.sendStateFor(bot, { x: 3, y: 0, z: -2, h: 1, anim: 'walk' });
  const s = net.stateOf(bot, net.now() + 1000);
  assert.deepEqual(s, { x: 3, y: 0, z: -2, h: 1, anim: 'walk' });
  assert.equal(net.stateOf('nobody'), null);
  const leaves = [];
  net.on('leave', (e) => leaves.push(e.id));
  net.removeBot(bot);
  assert.deepEqual(leaves, [bot]);
  // offline cannot join anyone else's room
  assert.deepEqual(await net.joinRoom('KJ7P', { nick: 'X' }), { ok: false, reason: 'offline' });
  assert.deepEqual(await net.joinRoom('nope', { nick: 'X' }), { ok: false, reason: 'bad-code' });
});

test('offline: events and game state reach me too', async () => {
  const net = createStandinNet({ mode: 'offline' });
  await net.createRoom({ nick: 'Star' });
  const got = [];
  net.on('event', (e) => got.push(e));
  assert.equal(net.send('emote', { id: 'hi' }), true);
  assert.equal(net.send('chat', { text: 'free text is not a thing' }), false);
  assert.deepEqual(got, [{ from: net.me.id, type: 'emote', data: { id: 'hi' } }]);
  let game = null;
  net.on('game', (g) => { game = g; });
  net.setGame({ kind: 'hideSeek', phase: 'lobby' });
  assert.deepEqual(game, { kind: 'hideSeek', phase: 'lobby' });
  assert.deepEqual(net.game, { kind: 'hideSeek', phase: 'lobby' });
  net.leaveRoom();
  assert.equal(net.room, null);
  assert.equal(net.game, null);
});

test('my own state is throttled, cleaned and readable back', async () => {
  const net = createStandinNet({ mode: 'offline' });
  await net.createRoom({ nick: 'Star' });
  net.sendState({ x: 1.234, y: 0, z: 2, h: 0.5, anim: 'run' });
  assert.deepEqual(net.stateOf(net.me.id, net.now() + 500), { x: 1.23, y: 0, z: 2, h: 0.5, anim: 'run' });
  net.sendState({ x: NaN, y: 0, z: 0, h: 0 });
  assert.equal(net.stateOf(net.me.id, net.now() + 500).x, 1.23);
});

test('cleanState rejects junk and clamps the rest', () => {
  assert.equal(cleanState(null), null);
  assert.equal(cleanState({ x: 'a', y: 0, z: 0, h: 0 }), null);
  assert.deepEqual(cleanState({ x: 1e9, y: -1e9, z: 0, h: 0, anim: '<b>' }), { x: 2000, y: -2000, z: 0, h: 0, anim: 'idle' });
});

test('local mode: two devices meet in one room, the first is host, state and events flow', async () => {
  const prefix = 'c9.test.' + Math.random() + '.';
  const host = createStandinNet({ mode: 'local', channelName: prefix });
  const guest = createStandinNet({ mode: 'local', channelName: prefix });
  assert.equal(host.kind, 'local');
  const roomCode = await host.createRoom({ nick: 'Bailey' });
  assert.ok(isValidCode(roomCode));
  const res = await guest.joinRoom(roomCode, { nick: 'Sister' });
  assert.deepEqual(res, { ok: true });
  await wait(150);
  assert.equal(host.players.size, 2);
  assert.equal(guest.players.size, 2);
  assert.equal(host.isHost, true);
  assert.equal(guest.isHost, false);
  assert.equal(guest.players.get(host.me.id).nick, 'Bailey');

  const seen = [];
  host.on('event', (e) => seen.push(e));
  guest.send('emote', { id: 'yay' });
  guest.sendState({ x: 5, y: 1, z: -3, h: 2, anim: 'walk' });
  await wait(150);
  assert.deepEqual(seen.map((e) => [e.from, e.type, e.data.id]), [[guest.me.id, 'emote', 'yay']]);
  assert.equal(host.stateOf(guest.me.id, host.now() + 500).x, 5);

  // bots belong to the host and travel with it
  const bot = host.addBot({ nick: 'Glitter Gem' });
  host.sendStateFor(bot, { x: 9, y: 0, z: 9, h: 0, anim: 'idle' });
  await wait(150);
  assert.equal(guest.players.get(bot).bot, true);
  assert.equal(guest.stateOf(bot, guest.now() + 500).x, 9);
  assert.equal(guest.addBot({ nick: 'Nope' }), null, 'only the host adds bots');

  // the host leaves: the guest becomes host and the host's bots go with it
  const hosts = [];
  guest.on('host', (e) => hosts.push(e.id));
  host.leaveRoom();
  await wait(200);
  assert.equal(guest.players.has(host.me.id), false);
  assert.equal(guest.players.has(bot), false);
  assert.equal(guest.isHost, true);
  assert.deepEqual(hosts, [guest.me.id]);
  guest.leaveRoom();
});

test('local mode: an empty code is not found, a bad code is refused', async () => {
  const net = createStandinNet({ mode: 'local', channelName: 'c9.test.' + Math.random() + '.' });
  assert.deepEqual(await net.joinRoom('ZZZZ', { nick: 'Star' }), { ok: false, reason: 'not-found' });
  assert.equal(net.room, null);
  assert.deepEqual(await net.joinRoom('AAAA', { nick: 'Star' }), { ok: false, reason: 'bad-code' });
  // createRoom honors a wanted code (used by the ?room= test switch)
  assert.equal(await net.createRoom({ nick: 'Star', code: 'kj7p' }), 'KJ7P');
  net.leaveRoom();
});

test('silent audio has the Contract 6 shape', () => {
  const remembered = [];
  const audio = createSilentAudio({ store: { sound: null, setSound: (v) => remembered.push(v) } });
  for (const fn of ['unlock', 'setEnabled', 'music', 'sfx', 'setListener', 'dispose']) assert.equal(typeof audio[fn], 'function', fn);
  assert.equal(audio.enabled, true);
  audio.setEnabled(false);
  assert.equal(audio.enabled, false);
  assert.deepEqual(remembered, [false]);
  assert.equal(typeof audio.beat.time(), 'number');
  assert.ok(audio.beat.nextBeatTime() >= audio.beat.time());
  const off = audio.beat.on('beat', () => {});
  assert.equal(typeof off, 'function');
});

test('stand-in content covers what the app asks for', () => {
  const c = STANDIN_CONTENT;
  assert.ok(c.EMOTES.length >= 6);
  for (const e of c.EMOTES) assert.equal(c.cleanEmote(e.id), e);
  assert.equal(c.cleanEmote('nope'), null);
  for (let i = 0; i < 50; i++) {
    const n = c.randomNick();
    assert.equal(c.cleanNick(n), n, n);
  }
  assert.equal(typeof c.hype('cloudCatch'), 'string');
  assert.equal(typeof c.hype('who-knows'), 'string');
  for (const k of ['hideSeek', 'freezeTag', 'dodgeball', 'captureBow', 'hitZero']) assert.ok(c.HOWTO[k].steps.length);
  const b = c.birthdayInfo(new Date(2026, 5, 10), { month: 6, day: 10, year: 2015 });
  assert.equal(b.isBirthday, true);
  assert.equal(b.age, 11);
  const soon = c.birthdayInfo(new Date(2026, 5, 7), { month: 6, day: 10, year: 2015 });
  assert.equal(soon.isBirthday, false);
  assert.equal(soon.daysUntil, 3);
  assert.equal(soon.isBirthdayWeek, true);
  assert.equal(c.birthdayInfo(new Date(), { month: null, day: null }).isBirthday, false);
});

test('random codes are valid', () => {
  for (let i = 0; i < 100; i++) assert.ok(isValidCode(randomCode()));
  assert.equal(randomCode(() => 0), GAME.roomCodeAlphabet[0].repeat(GAME.roomCodeLength));
});
