// Kid safety review: hostile network input, fed through every validator and through the paths that
// put things on screen (player list names, emotes, the shared game state and the game's own text).
// Nothing from another device may reach the screen as free text, and nothing may throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/net/validate.js';
import { createNet } from '../js/net/index.js';
import { cleanNick, randomNick } from '../js/content/names.js';
import { cleanEmote, EMOTES } from '../js/content/emotes.js';
import { isBlocked, blockedEntries } from '../js/content/blocklist.js';
import { cleanLook, DEFAULT_LOOK } from '../js/art/character-looks.js';
import { MODES, createGame } from '../js/games/index.js';
import { SAMPLE_PLACES } from '../js/games/sample-arenas.js';
import { watchConsole } from './net-kit.mjs';

const HELPERS = Object.freeze({ cleanNick, randomNick, cleanLook, cleanEmote });
const RUDE = blockedEntries().anywhere[0]; // decoded at run time, never written out here
const HTML = '<img src=x onerror=alert(1)>';
const HUGE = 'A'.repeat(100000);
const deepArr = (n) => '['.repeat(n) + ']'.repeat(n);
function deepObj(n) {
  const root = {};
  let o = root;
  for (let i = 0; i < n; i++) o = o.a = {};
  return root;
}
const PROTO = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":1}');
const JUNK = [undefined, null, true, false, 0, -0, NaN, Infinity, -Infinity, 1e308, -1e308, 2 ** 53, '', ' ', HTML, HUGE, RUDE,
  '‮\u0000\ud800', 'Zoë', [], [1, 2], {}, PROTO, deepObj(300), Object.create(null), () => 1, Symbol('x'), 10n,
  '{"a":1}', deepArr(500), 'NaN', 'Infinity', '1e999', '__proto__', 'constructor', 'toString'];
const BAD_IDS = ['__proto__', 'constructor', 'prototype', HTML, '', 'a'.repeat(65), 'a b', 'a/b', 'a.b', '#x', 12, null];

// A nickname anyone may see: letters and spaces only, short, passes cleanNick as it is, never blocked.
function isShowableNick(n) {
  return typeof n === 'string' && /^[A-Za-z][A-Za-z ]{0,15}$/.test(n) && cleanNick(n) === n && !isBlocked(n);
}
const noPollution = () => {
  assert.equal({}.polluted, undefined, 'Object.prototype untouched');
  assert.equal([].polluted, undefined);
};
// Every string anywhere inside v.
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) strings(v[k], out);
  return out;
}

test('safety: positions survive any junk: dropped, or finite and clamped to the island', () => {
  for (const field of ['x', 'y', 'z', 'h', 'a', 'anim', 't']) {
    for (const j of JUNK) {
      const s = V.cleanState({ x: 1, y: 2, z: 3, h: 0.5, a: 'walk', t: 5, [field]: j });
      if (s === null) continue;
      for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(s[k]) && Math.abs(s[k]) <= 500, `${field}: ${k}=${s[k]}`);
      assert.ok(Number.isFinite(s.h) && s.h > -Math.PI - 1e-9 && s.h <= Math.PI + 1e-9);
      assert.match(s.anim, /^[a-zA-Z]{1,16}$/);
      if (s.t !== undefined) assert.ok(Number.isFinite(s.t) && s.t >= 0);
    }
  }
  for (const j of JUNK) assert.doesNotThrow(() => V.cleanState(j));
  assert.deepEqual(V.cleanState({ x: 1e9, y: -1e9, z: 0, h: 7, a: HTML }), { x: 500, y: -500, z: 0, h: 7 - 2 * Math.PI, anim: 'idle' });
  noPollution();
});

test('safety: player entries: odd ids are dropped; names and looks always come out clean', () => {
  const good = { nick: 'Ava', look: '{"bow":"pink"}', bot: false, joinedAt: 1000 };
  for (const id of BAD_IDS) assert.equal(V.cleanPlayerEntry(id, good, HELPERS), null, `id ${String(id).slice(0, 20)}`);
  let shown = 0;
  for (const field of ['nick', 'look', 'bot', 'joinedAt', 'owner']) {
    for (const j of JUNK) {
      const e = V.cleanPlayerEntry('pal000000001', { ...good, [field]: j }, HELPERS);
      if (e === null) continue;
      shown++;
      assert.ok(isShowableNick(e.nick), `${field}: a junk value gave a name that is not showable`); // never print names: they may be rude
      assert.deepEqual(cleanLook(e.look), e.look, `${field}: look is a clean preset look`);
      assert.equal(e.bot, false);
    }
  }
  assert.ok(shown > 20, 'most junk names are replaced, not the player dropped');
  // Names that must never show: markup, the blocklist, too long, digits, look-alike letters.
  for (const nick of [HTML, RUDE, RUDE.toUpperCase(), `Super ${RUDE}`, 'x'.repeat(13), 'Abc 123', 'Avaа', 'Hi<b>', '   ', 'A-b']) {
    const e = V.cleanPlayerEntry('pal000000001', { ...good, nick }, HELPERS);
    assert.ok(e && isShowableNick(e.nick) && e.nick !== nick, `replaced: ${nick.length} chars`);
    assert.equal(e.nick, V.cleanPlayerEntry('pal000000001', { ...good, nick: HTML }, HELPERS).nick, 'the same made-up name for that id');
  }
  // Looks: anything that is not a preset id falls back slot by slot.
  for (const look of ['{"bow":"' + HTML + '"}', '{"__proto__":{"bow":"x"},"hair":"constructor"}', JSON.stringify(deepObj(40)), '[1]', 'nope', '{"bow":"pink",' + '"x":1,'.repeat(100) + '"y":2}']) {
    const e = V.cleanPlayerEntry('pal000000001', { ...good, look }, HELPERS);
    assert.deepEqual(cleanLook(e.look), e.look);
    assert.ok(!strings(e.look).some((s) => /[<>]/.test(s)));
  }
  assert.deepEqual(V.cleanPlayerEntry('pal000000001', { ...good, look: '{"hair":"constructor"}' }, HELPERS).look.hair, DEFAULT_LOOK.hair);
  noPollution();
});

test('safety: events and game records: small plain JSON only, no prototype keys, no deep nesting', () => {
  const ev = (over) => ({ from: 'pal000000001', type: 'claim', data: '{"type":"tag","target":"x"}', t: 1, ...over });
  for (const j of JUNK) {
    for (const field of ['from', 'type', 'data', 't']) {
      const r = V.cleanEventRecord(ev({ [field]: j }));
      if (r) assert.ok(V.isId(r.from) && V.EVENT_TYPES.includes(r.type) && Number.isFinite(r.t));
    }
    assert.doesNotThrow(() => V.cleanGameRecord({ by: 'host00000001', json: j, t: 1 }));
  }
  for (const data of ['{"__proto__":{"polluted":true}}', '{"constructor":1}', deepArr(512), JSON.stringify(deepObj(7)), '"' + 'x'.repeat(81) + '"',
    '{"a":' + '1,'.repeat(10) + '1}', '[' + '1,'.repeat(70) + '1]', '{"n":1e400}', 'NaN', "{'a':1}"]) {
    assert.equal(V.cleanEventRecord(ev({ data })), null, data.slice(0, 40));
  }
  for (const json of ['{"__proto__":{"polluted":true}}', '{"a":{"prototype":1}}', deepArr(8000), JSON.stringify(deepObj(9)), '[1]', '"str"', '1', 'true']) {
    assert.equal(V.cleanGameRecord({ by: 'host00000001', json, t: 1 }), null, json.slice(0, 40));
  }
  for (const hostId of BAD_IDS) assert.equal(V.cleanMeta({ hostId, createdAt: 1, beat: 1, v: 1 }), null);
  noPollution();
});

test('safety: emotes are preset ids only, and nothing else rides along with them', () => {
  for (const data of [HTML, { id: HTML }, { id: 'hi', text: HTML }, { id: 'nope' }, { text: 'free text' }, { id: '__proto__' }, { id: 'constructor' },
    { id: 'toString' }, ['hi'], 7, null, { id: ['hi'] }, { id: 'hi'.repeat(20) }]) {
    const out = V.cleanEmoteData(data, cleanEmote);
    if (out === V.INVALID) continue;
    assert.deepEqual(out, { id: 'hi' }, JSON.stringify(data));
  }
  assert.deepEqual(V.cleanEmoteData({ id: 'hi', text: HTML, icon: HTML }, cleanEmote), { id: 'hi' });
  assert.deepEqual(V.cleanEmoteData({ id: 'hi', text: HTML }, null), { id: 'hi' }, 'even without the content module');
  for (const e of EMOTES) assert.deepEqual(V.cleanEmoteData({ id: e.id }, cleanEmote), { id: e.id });
});

test('safety: mapNicks rewrites every nick and skips prototype keys', () => {
  const src = JSON.parse('{"players":{"a1":{"nick":"Ava","x":1},"b2":{"nick":"Bo"}},"list":[{"nick":"Cy"}],"nick":"Top","__proto__":{"nick":"P"}}');
  const seen = [];
  const out = V.mapNicks(src, (n, key) => {
    seen.push([n, key]);
    return 'Z';
  });
  assert.deepEqual(seen, [['Ava', 'a1'], ['Bo', 'b2'], ['Cy', null], ['Top', null]]);
  assert.deepEqual(out, { players: { a1: { nick: 'Z', x: 1 }, b2: { nick: 'Z' } }, list: [{ nick: 'Z' }], nick: 'Z' });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(V.mapNicks(null, () => 'Z'), null);
  assert.equal(V.mapNicks('nick', () => 'Z'), 'nick');
});

// ---- through the net and the games: a mischievous host -------------------------------------------

const ME = 'me0000000001';
const HOST = 'host00000001';
const PAL = 'pal000000001';
const STRANGER = 'zzz000000001';

function scripted(id = ME) {
  const calls = [];
  const links = new Set();
  const t0 = Date.now();
  const kit = { sink: null, calls, t0 };
  kit.transport = {
    kind: 'local',
    id,
    now: () => Date.now(),
    onLink: (fn) => links.add(fn),
    async connect() {
      for (const fn of links) fn(true);
      return { id };
    },
    async probe() {
      return {
        meta: { hostId: HOST, createdAt: t0, beat: Date.now(), v: 1 },
        players: { [HOST]: { nick: 'Hosty', look: '{}', bot: false, joinedAt: t0 + 1 } },
      };
    },
    async create() {
      return 'ok';
    },
    async enter(code, entry, sink) {
      kit.sink = sink;
      sink.meta({ hostId: id === ME ? HOST : id, createdAt: t0, beat: Date.now(), v: 1 });
      sink.player(HOST, { nick: 'Hosty', look: '{}', bot: false, joinedAt: t0 + 1 });
      sink.player(PAL, { nick: HTML.replace(/[^A-Za-z ]/g, ''), look: '{}', bot: false, joinedAt: t0 + 2 });
      sink.player(id, { ...entry, joinedAt: t0 + 3 });
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
    claimHost: async () => false,
    trimEvents: async () => {},
    dispose() {},
  };
  return kit;
}

// The state a host would send for this mode, with the names swapped for whatever it likes.
function hostileState(kind, names) {
  const ids = Object.keys(names);
  const host = createGame(kind, { arena: SAMPLE_PLACES[MODES[kind].place], players: ids.map((id) => ({ id, nick: 'Placeholder', bot: false })), now: Date.now() });
  host.host.start(Date.now());
  const st = JSON.parse(JSON.stringify(host.state));
  for (const id of ids) if (st.players && st.players[id]) st.players[id].nick = names[id];
  return st;
}

test('safety: names inside a hostile game state never reach the screen; the names shown are the checked ones', async () => {
  const con = watchConsole();
  const kit = scripted();
  const net = createNet({ transport: kit.transport, helpers: HELPERS });
  try {
    assert.deepEqual(await net.joinRoom('K7QZ', { nick: 'Me' }), { ok: true });
    const checked = Object.fromEntries([...net.players].map(([id, p]) => [id, p.nick]));
    assert.ok(Object.values(checked).every(isShowableNick), 'the player list shows checked names');
    for (const kind of Object.keys(MODES)) {
      const names = { [HOST]: `Totally ${RUDE}`, [PAL]: HTML, [ME]: 'x'.repeat(150), [STRANGER]: RUDE }; // 150: longer strings drop the whole state
      const st = hostileState(kind, names);
      kit.sink.game({ by: HOST, json: JSON.stringify(st), t: Date.now() });
      const g = net.game;
      assert.ok(g && g.kind === kind, kind);
      for (const [id, p] of Object.entries(g.players)) {
        assert.ok(isShowableNick(p.nick), `${kind}: ${id} shows a name that is not showable (${p.nick.length} chars)`);
        if (checked[id]) assert.equal(p.nick, checked[id], `${kind}: ${id} shows the name everyone sees in the player list`);
      }
      // The same state through the game's own screen text, on this device.
      const mine = createGame(kind, { arena: SAMPLE_PLACES[MODES[kind].place], players: net.players, now: () => Date.now() });
      assert.equal(mine.applyState(g), true, kind);
      const shown = [];
      for (const who of [ME, PAL, HOST, STRANGER]) {
        shown.push(...strings(mine.ui(who)));
        for (const fx of [{ type: 'found', id: STRANGER, by: HOST, ids: [STRANGER] }, { type: 'join', id: STRANGER }, { type: 'it', id: PAL }]) shown.push(mine.fxText(fx, who));
      }
      for (const s of shown) {
        assert.ok(!/[<>]/.test(s), `${kind}: markup on screen`);
        assert.ok(!s.toLowerCase().includes(RUDE), `${kind}: a blocked word on screen`);
        assert.ok(!s.includes('x'.repeat(17)), `${kind}: a long junk name on screen`);
      }
    }
  } finally {
    net.dispose();
    con.restore();
  }
  assert.deepEqual(con.errors, []);
});

test('safety: the host sends the game state with every name blank, so an empty room keeps no names', async () => {
  const con = watchConsole();
  const kit = scripted(HOST);
  const net = createNet({ transport: kit.transport, helpers: HELPERS, tuning: { gameGapMs: 0 } });
  try {
    assert.equal(typeof (await net.createRoom({ nick: 'Hosty' })), 'string');
    assert.equal(net.isHost, true);
    const st = hostileState('freezeTag', { [HOST]: 'Hosty', [PAL]: 'Pal' });
    assert.equal(net.setGame(st), true);
    assert.equal(net.game.players[PAL].nick, 'Pal', 'the host itself still sees the names');
    const t0 = Date.now();
    while (!kit.calls.some((c) => c[0] === 'setGame') && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
    const sent = kit.calls.filter((c) => c[0] === 'setGame').map((c) => c[1]);
    assert.ok(sent.length >= 1, 'sent');
    for (const json of sent) {
      const wire = JSON.parse(json);
      assert.deepEqual(Object.values(wire.players).map((p) => p.nick), ['', ''], 'names are blank on the wire');
      assert.ok(!json.includes('Hosty') && !json.includes('Pal'));
    }
  } finally {
    net.dispose();
    con.restore();
  }
  assert.deepEqual(con.errors, []);
});

test('safety: hostile emotes, unknown senders and fake host events are dropped before anyone sees them', async () => {
  const con = watchConsole();
  const kit = scripted();
  const net = createNet({ transport: kit.transport, helpers: HELPERS });
  try {
    assert.deepEqual(await net.joinRoom('K7QZ', { nick: 'Me' }), { ok: true });
    const got = [];
    net.on('event', (e) => got.push(e));
    const ev = (from, type, data) => ({ from, type, data: JSON.stringify(data), t: Date.now() });
    let n = 0;
    const send = (e) => kit.sink.event('k' + ++n, e);
    send(ev(PAL, 'emote', { id: 'hi', text: HTML }));
    send(ev(PAL, 'emote', { id: HTML }));
    send(ev(PAL, 'emote', RUDE));
    send(ev(STRANGER, 'emote', { id: 'hi' }));
    send(ev(PAL, 'game-start', { kind: 'freezeTag', id: 'x' }));
    send(ev(PAL, 'chat', { text: 'hello' }));
    send({ from: PAL, type: 'emote', data: '{"id":"hi","__proto__":{"polluted":1}}', t: 1 });
    send(ev(HOST, 'game-start', { kind: 'freezeTag', id: 'g1' }));
    assert.deepEqual(got.map((e) => [e.from, e.type, e.data]), [[PAL, 'emote', { id: 'hi' }], [HOST, 'game-start', { kind: 'freezeTag', id: 'g1' }]]);
    noPollution();
  } finally {
    net.dispose();
    con.restore();
  }
  assert.deepEqual(con.errors, []);
});
