import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createNet } from '../js/net/index.js';
import { GAME } from '../js/config.js';
import { isRoomCode } from '../js/net/codes.js';
import { sleep, waitFor, watchConsole, record, nicksOf, NO_HELPERS, C9 } from './net-kit.mjs';

let con;
test.beforeEach(() => {
  con = watchConsole();
});
test.afterEach(() => {
  con.restore();
  assert.deepEqual(con.errors, [], 'no console errors');
});

test('offline: solo play makes a room with no network, and nobody can join', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    assert.equal(net.mode, 'offline');
    assert.equal(net.status, 'offline');
    assert.equal(net.room, null);
    const log = record(net);
    const code = await net.createRoom({ nick: 'Bailey', look: { bow: 'pink' } });
    assert.ok(isRoomCode(code));
    assert.equal(net.room.code, code);
    assert.equal(net.room.hostId, net.me.id);
    assert.ok(net.isHost);
    assert.equal(net.status, 'offline', 'still offline: nothing went over a network');
    assert.deepEqual(nicksOf(net), ['Bailey']);
    assert.deepEqual(net.me.look, { bow: 'pink' });
    assert.deepEqual(await net.joinRoom(code), { ok: false, reason: 'offline' });
    assert.deepEqual(await net.joinRoom('nope'), { ok: false, reason: 'bad-code' });
    assert.equal(net.room.code, code, 'a failed join leaves you where you were');
    assert.deepEqual(
      log.filter((e) => e.k === 'join' || e.k === 'host').map((e) => e.k + ':' + e.x.id),
      ['join:' + net.me.id, 'host:' + net.me.id],
    );
  } finally {
    net.dispose();
  }
});

test('offline: bots are players with bot: true that the host moves', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const b = net.addBot({ nick: 'Robo Star', look: { bow: 'purple' } });
    assert.ok(b && b.startsWith(net.me.id + '-b'));
    const p = net.players.get(b);
    assert.equal(p.bot, true);
    assert.equal(p.nick, 'Robo Star');
    assert.ok(net.sendStateFor(b, { x: 3, y: 0, z: 4, h: 1, anim: 'run' }));
    assert.deepEqual(net.stateOf(b), { x: 3, y: 0, z: 4, h: 1, anim: 'run' });
    assert.equal(net.sendStateFor('someone-else', { x: 0, y: 0, z: 0 }), false);
    await waitFor(() => net.debug().raw.players.includes(b), { what: 'the bot in the room' });
    // fill the room: bots count toward GAME.maxPlayers
    const more = [];
    for (let i = 0; i < 20; i++) {
      const id = net.addBot({ nick: 'Bot' });
      if (id) more.push(id);
    }
    assert.equal(net.players.size, GAME.maxPlayers);
    assert.equal(more.length, GAME.maxPlayers - 2);
    assert.equal(net.removeBot(b), true);
    assert.equal(net.removeBot(b), false);
    assert.equal(net.players.has(b), false);
    assert.equal(net.stateOf(b), null);
    assert.equal(net.players.size, GAME.maxPlayers - 1);
  } finally {
    net.dispose();
  }
});

test('offline: events come back to the sender, in order; unknown types and junk are refused', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const got = [];
    net.on('event', (e) => got.push(e));
    assert.equal(net.send('emote', { id: 'woo' }), true);
    assert.equal(net.send('fx', { name: 'sparkle', x: 1, z: 2 }), true);
    assert.equal(net.send('claim', { type: 'tag', target: 'x' }), true);
    assert.equal(net.send('game-start', { kind: 'freezeTag' }), true, 'the host may start a game');
    assert.equal(net.send('chat', { text: 'hi' }), false, 'no chat, ever');
    assert.equal(net.send('emote', { text: 'x'.repeat(200) }), false, 'no free text');
    assert.equal(net.send('emote', 'x'.repeat(2000)), false);
    await waitFor(() => got.length === 4, { what: 'four events' });
    assert.deepEqual(
      got.map((e) => e.type),
      ['emote', 'fx', 'claim', 'game-start'],
    );
    assert.equal(got[0].from, net.me.id);
    assert.deepEqual(got[0].data, { id: 'woo' });
    assert.ok(con.warnings.some((w) => w.includes('unknown event type')));
  } finally {
    net.dispose();
  }
});

test('offline: a kid mashing a button is slowed down, not crashed', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    let ok = 0;
    for (let i = 0; i < 100; i++) if (net.send('emote', { id: 'woo' })) ok++;
    assert.ok(ok >= 15 && ok <= 25, ok + ' of 100 went out');
    await sleep(600);
    assert.equal(net.send('emote', { id: 'woo' }), true, 'and a moment later it works again');
  } finally {
    net.dispose();
  }
});

test('offline: the shared game state', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const seen = [];
    net.on('game', (g) => seen.push(g));
    assert.equal(net.game, null);
    assert.equal(net.setGame({ kind: 'hideSeek', phase: 'hide', round: 1, phaseEnds: 123, scores: {} }), true);
    assert.deepEqual(net.game, { kind: 'hideSeek', phase: 'hide', round: 1, phaseEnds: 123, scores: {} });
    net.setGame({ kind: 'hideSeek', phase: 'hide', round: 1, phaseEnds: 123, scores: {} });
    await sleep(50);
    assert.equal(seen.length, 1, 'no event when nothing changed');
    assert.equal(net.setGame([1, 2]), false, 'an object or null');
    assert.equal(net.setGame({ blob: 'x'.repeat(300) }), false, 'small JSON only');
    assert.equal(net.setGame(null), true);
    await sleep(20);
    assert.equal(net.game, null);
    assert.equal(seen.length, 2);
    await sleep(250);
    assert.equal(net.debug().game, 'null', 'what went out matches');
  } finally {
    net.dispose();
  }
});

test('offline: leaving says goodbye to everyone and hands back an empty room', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const b = net.addBot({ nick: 'Robo' });
    const log = record(net);
    await net.leaveRoom();
    assert.equal(net.room, null);
    assert.equal(net.isHost, false);
    assert.equal(net.players.size, 0);
    assert.equal(net.game, null);
    assert.deepEqual(
      log.map((e) => e.k + ':' + (e.x && e.x.id)),
      ['leave:' + b, 'leave:' + net.me.id, 'host:null'],
    );
    assert.equal(log[1].x.reason, 'left');
    assert.equal(net.send('emote', { id: 'woo' }), false);
    assert.equal(net.addBot({}), null);
    assert.equal(net.setGame({ a: 1 }), false);
    await net.leaveRoom(); // twice is fine
    const code2 = await net.createRoom({ nick: 'Bailey' });
    assert.ok(isRoomCode(code2));
  } finally {
    net.dispose();
  }
});

test('offline: nickname and look changes reach the room', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    await net.createRoom({ nick: 'Bailey' });
    const changed = [];
    net.on('player', (e) => changed.push(e.id));
    net.updateMe({ nick: 'Captain Bailey', look: { bow: 'gold' } });
    await waitFor(() => changed.length === 1, { what: 'a player event' });
    assert.equal(net.players.get(net.me.id).nick, 'Captain Bailey');
    assert.deepEqual(net.players.get(net.me.id).look, { bow: 'gold' });
    net.updateMe({ nick: '💖💖' });
    assert.equal(net.me.nick, 'Cloud Friend', 'a name with nothing usable gets a friendly fallback');
  } finally {
    net.dispose();
  }
});

test('offline: my own state is there at once, others need a room', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    assert.equal(net.sendState({ x: 1, y: 2, z: 3, h: 0, anim: 'walk' }), true);
    assert.equal(net.sendState({ x: NaN }), false);
    await net.createRoom({ nick: 'Bailey' });
    assert.deepEqual(net.stateOf(net.me.id), { x: 1, y: 2, z: 3, h: 0, anim: 'walk' });
    assert.equal(net.stateOf('nobody'), null);
    assert.equal(net.stateOf(42), null);
    assert.ok(Math.abs(net.now() - Date.now()) < 50);
  } finally {
    net.dispose();
  }
});

test('offline: a room code asked for is used when it is valid, and any game kind is fine', async () => {
  const net = createNet({ mode: 'offline', helpers: NO_HELPERS });
  try {
    assert.equal(await net.createRoom({ nick: 'Bailey', code: 'k7 qz' }), 'K7QZ', 'the code from a ?room= link');
    const other = await net.createRoom({ nick: 'Bailey', code: 'oops' });
    assert.ok(isRoomCode(other) && other !== 'K7QZ', 'a broken code asked for: a new one');
    const got = [];
    net.on('event', (e) => got.push(e.data.kind));
    assert.ok(net.setGame({ kind: 'roam', phase: 'lobby', round: 0 }), 'the lobby state');
    assert.ok(net.send('game-start', { kind: 'roam' }));
    await waitFor(() => got.includes('roam') && net.game.kind === 'roam', { what: 'the roam kind' });
  } finally {
    net.dispose();
  }
});

const REAL_CONTENT = fs.existsSync(path.join(C9, 'js', 'content', 'emotes.js'));
test('offline: the real content module filters emotes when it is there', { skip: !REAL_CONTENT && 'js/content/emotes.js is not here yet' }, async () => {
  const net = createNet({ mode: 'offline' });
  try {
    await net.createRoom({ nick: 'Bailey' });
    assert.equal(net.send('emote', { id: 'not-an-emote-xyz' }), false);
  } finally {
    net.dispose();
  }
});
