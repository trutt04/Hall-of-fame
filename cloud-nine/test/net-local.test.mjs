// The local transport with several simulated tabs (BroadcastChannel + fake Web Locks) in one process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME } from '../js/config.js';
import { sleep, waitFor, watchConsole, localTabs, record, nicksOf, hostNick } from './net-kit.mjs';

let con;
let lab;
test.beforeEach(() => {
  con = watchConsole();
  lab = localTabs();
});
test.afterEach(async () => {
  lab.closeAll();
  await sleep(20);
  con.restore();
  assert.deepEqual(con.errors, [], 'no console errors');
});

async function room(names) {
  const nets = names.map(() => lab.open());
  const code = await nets[0].createRoom({ nick: names[0] });
  for (let i = 1; i < nets.length; i++) {
    const r = await nets[i].joinRoom(code, { nick: names[i] });
    assert.deepEqual(r, { ok: true }, names[i] + ' joins');
  }
  await waitFor(() => nets.every((n) => n.players.size === names.length), { what: 'everyone to see everyone' });
  return { nets, code };
}

test('local: four tabs share one room and agree on who is in it and who hosts', async () => {
  const { nets, code } = await room(['Ava', 'Bea', 'Cat', 'Dot']);
  const ids = [...nets[0].players.keys()];
  assert.deepEqual(nicksOf(nets[0]), ['Ava', 'Bea', 'Cat', 'Dot'], 'earliest first');
  for (const n of nets) {
    assert.deepEqual([...n.players.keys()], ids, 'the same order everywhere');
    assert.equal(n.room.code, code);
    assert.equal(n.room.hostId, nets[0].me.id);
    assert.equal(n.status, 'online');
    assert.equal(n.mode, 'local');
    assert.ok(n.players.has(n.me.id));
  }
  assert.deepEqual(nets.map((n) => n.isHost), [true, false, false, false]);
});

test('local: everyone sees everyone move, and still players settle where they stopped', async () => {
  const { nets } = await room(['Ava', 'Bea', 'Cat', 'Dot']);
  const end = nets.map((_, i) => ({ x: -6 + i * 4, y: 0, z: 3 - i * 2, h: i * 0.5, anim: 'idle' }));
  for (let f = 0; f < 20; f++) {
    nets.forEach((n, i) => n.sendState({ x: end[i].x * (f / 20), y: 0, z: end[i].z * (f / 20), h: end[i].h, anim: 'walk' }));
    await sleep(16);
  }
  nets.forEach((n, i) => n.sendState(end[i]));
  await sleep(500);
  for (const viewer of nets) {
    nets.forEach((n, i) => {
      const s = viewer.stateOf(n.me.id);
      assert.ok(s, 'a state for ' + i);
      assert.ok(Math.abs(s.x - end[i].x) < 0.011 && Math.abs(s.z - end[i].z) < 0.011, JSON.stringify([s, end[i]]));
      assert.equal(s.anim, 'idle');
    });
  }
  assert.ok(nets[1].stats.sentStates < 40, 'throttled: ' + nets[1].stats.sentStates + ' updates for ~20 frames plus a stop');
});

test('local: events reach everyone in the same order', async () => {
  const { nets } = await room(['Ava', 'Bea', 'Cat', 'Dot']);
  const logs = nets.map((n) => {
    const l = [];
    n.on('event', (e) => l.push(e.from + ':' + e.data.n));
    return l;
  });
  for (let k = 0; k < 5; k++) {
    for (const [i, n] of nets.entries()) {
      n.send('fx', { n: k * 10 + i });
      if ((k + i) % 3 === 0) await sleep(1);
    }
  }
  await waitFor(() => logs.every((l) => l.length === 20), { what: 'all 20 events everywhere' });
  for (const l of logs) assert.deepEqual(l, logs[0]);
});

test('local: a late joiner gets the current game but not old events', async () => {
  const { nets, code } = await room(['Ava', 'Bea']);
  nets[0].send('emote', { id: 'woo' });
  nets[0].setGame({ kind: 'freezeTag', phase: 'play', round: 2 });
  await sleep(250);
  const late = lab.open();
  const got = [];
  late.on('event', (e) => got.push(e));
  assert.deepEqual(await late.joinRoom(code, { nick: 'Cat' }), { ok: true });
  await waitFor(() => late.game && late.game.round === 2, { what: 'the game state' });
  nets[1].send('emote', { id: 'clap' });
  await waitFor(() => got.length === 1, { what: 'the new emote' });
  await sleep(100);
  assert.deepEqual(got.map((e) => e.data.id), ['clap'], 'nothing from before the join');
});

test('local: when the host leaves, the earliest human takes over and the bots go', async () => {
  const { nets } = await room(['Ava', 'Bea', 'Cat']);
  const [a, b, c] = nets;
  const bot1 = a.addBot({ nick: 'Robo One' });
  const bot2 = a.addBot({ nick: 'Robo Two' });
  await waitFor(() => c.players.has(bot1) && c.players.has(bot2), { what: 'the bots' });
  const log = record(c);
  await a.leaveRoom();
  await waitFor(() => b.isHost && c.room.hostId === b.me.id, { what: 'Bea to host' });
  await waitFor(() => !c.players.has(bot1) && !c.players.has(bot2) && !c.players.has(a.me.id), { what: 'Ava and her bots to go' });
  assert.deepEqual(nicksOf(c), ['Bea', 'Cat']);
  assert.ok(log.some((e) => e.k === 'host' && e.x.id === b.me.id));
  assert.equal(a.room, null);
  const nb = b.addBot({ nick: 'New Bot' });
  assert.ok(nb, 'the new host can add bots');
  await waitFor(() => c.players.has(nb), { what: 'the new bot' });
});

test('local: a host tab that closes without a word is replaced', async () => {
  const { nets } = await room(['Ava', 'Bea', 'Cat']);
  const [a, b, c] = nets;
  const bot = a.addBot({ nick: 'Robo' });
  a.setGame({ kind: 'dodgeball', phase: 'play', round: 1 });
  await waitFor(() => c.players.has(bot) && c.game, { what: 'bot and game' });
  lab.crash(a);
  await waitFor(() => hostNick(b) === 'Bea' && hostNick(c) === 'Bea', { timeout: 5000, what: 'a new host' });
  await waitFor(() => !c.players.has(bot) && !c.players.has(a.me.id), { what: 'the old host and the bot to go' });
  assert.ok(b.isHost);
  assert.deepEqual(c.game, { kind: 'dodgeball', phase: 'play', round: 1 }, 'the game state is still there');
  assert.ok(b.setGame({ kind: 'dodgeball', phase: 'results', round: 1 }));
  await waitFor(() => c.game.phase === 'results', { what: 'the new host to carry on' });
});

test('local: the room survives the tab that kept the books closing', async () => {
  const keeper = lab.open();
  await keeper.createRoom({ nick: 'Keeper' }); // the first tab to connect leads
  await keeper.leaveRoom();
  assert.ok(keeper.debug().leader);
  const m = lab.open();
  const n = lab.open();
  const code = await m.createRoom({ nick: 'Mia' });
  assert.deepEqual(await keeper.joinRoom(code, { nick: 'Keeper' }), { ok: true });
  assert.deepEqual(await n.joinRoom(code, { nick: 'Nia' }), { ok: true });
  await waitFor(() => m.players.size === 3, { what: 'three in the room' });
  lab.crash(keeper);
  await waitFor(() => m.players.size === 2 && n.players.size === 2, { timeout: 5000, what: 'the keeper to leave' });
  assert.ok(m.debug().leader || n.debug().leader, 'another tab took over the books');
  assert.ok(m.isHost, 'the host did not change');
  n.sendState({ x: 4, y: 0, z: 4, h: 0, anim: 'idle' });
  m.send('emote', { id: 'woo' });
  const got = [];
  n.on('event', (e) => got.push(e.data.id));
  await waitFor(() => got.includes('woo'), { what: 'events after the switch' });
  await waitFor(() => m.stateOf(n.me.id) && m.stateOf(n.me.id).x === 4, { what: 'states after the switch' });
  const late = lab.open();
  assert.deepEqual(await late.joinRoom(code, { nick: 'Lou' }), { ok: true }, 'joining still works');
});

test('local: a full room says so, and a human joining takes a bot\'s place', async () => {
  const host = lab.open();
  const code = await host.createRoom({ nick: 'Ava' });
  const bots = [];
  for (let i = 0; i < 8; i++) bots.push(host.addBot({ nick: 'Bot' }));
  assert.ok(bots.every(Boolean));
  assert.equal(host.players.size, 9);
  const humans = [host];
  for (let i = 1; i < GAME.maxPlayers; i++) {
    const n = lab.open();
    assert.deepEqual(await n.joinRoom(code, { nick: 'Kid' }), { ok: true });
    humans.push(n);
    await waitFor(() => host.players.size <= GAME.maxPlayers && [...host.players.values()].filter((p) => !p.bot).length === humans.length, { what: 'the room to fit' });
    assert.ok(host.players.size <= GAME.maxPlayers);
  }
  await waitFor(() => humans.every((n) => n.players.size === GAME.maxPlayers), { what: 'ten everywhere' });
  assert.ok([...host.players.values()].every((p) => !p.bot), 'ten humans, no bots left');
  const extra = lab.open();
  assert.deepEqual(await extra.joinRoom(code, { nick: 'Eleven' }), { ok: false, reason: 'full' });
  assert.equal(host.addBot({ nick: 'Bot' }), null, 'no room for bots either');
});

test('local: a mistyped code keeps you where you are; a missing room is not-found', async () => {
  const { nets, code } = await room(['Ava', 'Bea']);
  assert.deepEqual(await nets[1].joinRoom('ZZZZ'), { ok: false, reason: 'not-found' });
  assert.deepEqual(await nets[1].joinRoom('hello'), { ok: false, reason: 'bad-code' });
  assert.equal(nets[1].room.code, code);
  assert.equal(nets[0].players.size, 2);
  assert.deepEqual(await nets[1].joinRoom(code.toLowerCase()), { ok: true }, 'joining your own room again is fine');
});

test('local: junk on the channel is ignored, and a made-up tab is shown the door', async () => {
  const { nets, code } = await room(['Ava', 'Bea']);
  const ch = new BroadcastChannel(lab.channelName);
  try {
    const junk = [
      null,
      7,
      'hello',
      [],
      { v: 2, k: 'd' },
      { v: 1, k: 'd' },
      { v: 1, k: 'd', from: 'x y', seq: 1 },
      { v: 1, k: 'req', from: 'Lmadeup00001', rid: 5, op: null },
      { v: 1, k: 'req', from: 'Lmadeup00001', rid: 'r1', op: { op: 'putState', code, id: nets[1].me.id, s: { x: 1, y: 0, z: 0, h: 0, a: 'idle', t: 1 } } },
      { v: 1, k: 'snap', from: 'Lmadeup00001', to: '*', seq: 1, data: 'junk' },
      { v: 1, k: 'res', from: 'Lmadeup00001', to: nets[1].me.id, rid: 'nope', res: { ok: true } },
      // a change that does not come from the leader
      { v: 1, k: 'd', from: 'Lmadeup00001', seq: 9999, changes: [{ c: code, k: 'player', id: 'evil', v: { nick: 'Evil', look: '{}', bot: false, joinedAt: 1 } }] },
    ];
    for (const m of junk) ch.postMessage(m);
    // a join from a tab that does not exist: the leader finds no live tab behind it and removes it
    ch.postMessage({ v: 1, k: 'req', from: 'Lmadeup00002', rid: 'r2', op: { op: 'putPlayer', code, id: 'Lmadeup00002', entry: { nick: 'Ghost', look: '{}', bot: false } } });
    await sleep(200);
    await waitFor(() => !nets[0].players.has('Lmadeup00002') && !nets[1].players.has('Lmadeup00002'), { what: 'the ghost to go' });
    assert.ok(!nets[1].players.has('evil'));
    assert.equal(nets[0].players.size, 2);
    const got = [];
    nets[1].on('event', (e) => got.push(e));
    nets[0].send('emote', { id: 'woo' });
    await waitFor(() => got.length === 1, { what: 'normal traffic to still flow' });
  } finally {
    ch.close();
  }
});

test('local: an empty room is not-found and can be made again with its code; a busy code is not taken', async () => {
  const a = lab.open();
  const b = lab.open();
  const code = await a.createRoom({ nick: 'Ava' });
  assert.deepEqual(await b.joinRoom(code, { nick: 'Bea' }), { ok: true });
  const c = lab.open();
  const other = await c.createRoom({ nick: 'Cat', code });
  assert.notEqual(other, code, 'a room people are in keeps its code');
  await a.leaveRoom();
  await b.leaveRoom();
  const d = lab.open();
  assert.deepEqual(await d.joinRoom(code, { nick: 'Dot' }), { ok: false, reason: 'not-found' }, 'nobody is in it');
  assert.equal(await d.createRoom({ nick: 'Dot', code }), code, 'a ?room=CODE link makes it afresh');
  assert.ok(d.isHost);
  assert.deepEqual(await a.joinRoom(code, { nick: 'Ava' }), { ok: true });
  await waitFor(() => d.players.size === 2, { what: 'Ava back in' });
});

test('local: a new name or look mid-room reaches everyone', async () => {
  const { nets } = await room(['Ava', 'Bea']);
  const [a, b] = nets;
  const seen = [];
  b.on('player', (e) => seen.push(e.id));
  a.updateMe({ nick: 'Captain Ava', look: { bow: 'gold' } });
  await waitFor(() => b.players.get(a.me.id).nick === 'Captain Ava', { what: 'the new name' });
  assert.deepEqual(b.players.get(a.me.id).look, { bow: 'gold' });
  assert.ok(seen.includes(a.me.id), 'a player event');
  a.updateMe({ nick: '💖💖' });
  await waitFor(() => b.players.get(a.me.id).nick === 'Cloud Friend', { what: 'a name with nothing usable to be replaced' });
});
