// Multiplayer for Cloud Nine (BLUEPRINT.md, Contract 4): private rooms, seeing each other move, and
// the shared game state. One interface over three transports:
//   'local'    tabs of one browser (BroadcastChannel + Web Locks), for dev and tests
//   'firebase' Realtime Database, so phones and tablets anywhere can play together
//   'offline'  solo: createRoom works, bots work, nobody else can join
//
//   const net = createNet({ mode = 'auto' })   'auto': firebase when js/net/firebase-config.js is filled
//                                              in, else local on localhost, else offline. ?net=local|firebase|offline
//                                              in the page address overrides 'auto' (for testing).
//   net.mode                  'local' | 'firebase' | 'offline'
//   net.status                'offline' | 'connecting' | 'online'
//   net.me                    { id, nick, look }   id is final once createRoom/joinRoom resolves
//   net.createRoom({ nick, look, code? }) -> Promise<code>   a valid, free code asked for is used (for
//                             ?room=CODE links), else a new one. Rejects with err.reason 'offline'
//                             when rooms can't be reached
//   net.joinRoom(code, { nick, look }) -> Promise<{ ok, reason }>   'not-found' (also: nobody is in it) |
//                             'full' | 'locked' | 'offline' | 'bad-code'. A wrong code never takes you out of your room.
//   net.leaveRoom() -> Promise
//   net.room                  null | { code, hostId, createdAt, locked }
//   net.lockRoom(on) -> Promise<boolean>   host only: lock the room to the humans in it now (nobody new
//                             can join or read it; a friend who drops out for a moment comes back), or unlock
//   net.sendHome(id) -> Promise<boolean>   host only: lock the room without that friend and take them out;
//                             their device leaves by itself ('leave' with reason 'removed')
//   net.players               Map<id, { id, nick, look, bot, joinedAt }>, me and the host's bots included,
//                             earliest first. Treat entries as read only.
//   net.isHost                the host runs the games and the bots: the earliest human to join;
//                             re-elected when the host leaves or stops answering for ~15 s
//   net.sendState(state)      my { x, y, z, h, anim }; call it every frame, it throttles to GAME.netHz
//                             and skips what didn't change
//   net.sendStateFor(botId, state)   host only, for its bots
//   net.stateOf(id, now = net.now(), out?) -> { x, y, z, h, anim } | null   others: interpolated
//                             GAME.interpDelayMs in the past; me and my bots: the latest state
//   net.addBot({ nick, look }) -> id | null   host only; bots are players with bot: true. A human
//                             joining a full room takes the newest bot's place.
//   net.removeBot(id) -> boolean
//   net.send(type, data) -> boolean   to everyone, me included. types: 'emote', 'claim', 'fx',
//                             'game-start', 'game-end' (the last two from the host only). data is
//                             small plain JSON (<= 1 KB). Emotes are { id } of a preset emote: both
//                             ways they go through cleanEmote (js/content/emotes.js), and unknown
//                             ones are dropped. Never show a string from data.
//   net.setGame(state) -> boolean   host only: replace the shared game state (plain JSON <= 16000 chars;
//                             any kind, 'roam' included: only shape and size are checked). Every
//                             `nick` in it goes out blank, and each device fills in the checked
//                             name it has for that player id (the key holding the object)
//   net.game                  the last shared game state, or null (treat as read only)
//   net.now()                 shared clock in ms (server time when online)
//   net.on(evt, fn) / net.off(evt, fn)
//       'status' (status)
//       'join' { id }         someone appeared in net.players (me too, first)
//       'leave' { id, reason? }   someone left. { id: net.me.id, reason: 'left' | 'lost' | 'removed' } means
//                             I am out ('removed': the host locked the room without me or sent me home)
//       'room' { locked }     the room was locked or unlocked
//       'host' { id }         the host changed (id null after leaving)
//       'player' { id }       a player's nick or look changed
//       'event' { from, type, data }
//       'game' (state)        net.game changed (the host hears its own changes too)
//   net.updateMe({ nick, look })   change my name or look, in a room too (checked, then sent to everyone)
//   Nicknames from the network go through cleanNick (js/content/names.js); a name that fails it is
//   replaced by randomNick(), seeded by the player's id so every device shows the same one. Looks go
//   through cleanLook (js/art/character.js). Each has a local fallback while its module is missing.
//   Extras: net.stats, net.debug(), net.dispose().

import { GAME, FEATURES } from '../config.js';
import { emitter } from '../core/util.js';
import { makeRoomCode, normalizeCode } from './codes.js';
import * as V from './validate.js';
import { createInterpBuffer, createStateSender } from './interp.js';
import { createLocalTransport, localAvailable } from './transport-local.js';
import { createFirebaseTransport } from './transport-firebase.js';
import { FIREBASE_CONFIG, isConfigured } from './firebase-config.js';

export { normalizeCode, makeRoomCode } from './codes.js';
export { isConfigured } from './firebase-config.js';

const DEFAULT_TUNING = {
  hostBeatMs: 4000, // the host's heartbeat in meta.beat
  hostGoneMs: 17000, // no heartbeat for this long: the host is gone (the rules allow a claim after 15 s)
  claimStepMs: 1500, // each place further down the line waits this much longer before claiming
  dutyMs: 1000, // housekeeping
  trimEveryMs: 15000,
  eventTtlMs: 60000,
  healDelayMs: 400,
  joinWaitMs: 6000,
  leaveTimeoutMs: 3000,
  gameGapMs: Math.round(1000 / GAME.netHz),
  cleanupRetryMs: 10000,
};

// Shared by every net on the page: the content and character modules' checkers, when they exist.
const helpers = { cleanNick: null, randomNick: null, cleanLook: null, cleanEmote: null };
let helpersPromise = null;
function loadHelpers() {
  if (!helpersPromise) {
    const pick = (load, names) =>
      load().then(
        (m) => {
          for (const n of names) if (typeof m[n] === 'function') helpers[n] = m[n];
        },
        () => {}, // not there (yet): the local checks stand in
      );
    helpersPromise = Promise.all([
      pick(() => import('../art/character.js'), ['cleanLook']),
      pick(() => import('../content/names.js'), ['cleanNick', 'randomNick']),
      pick(() => import('../content/emotes.js'), ['cleanEmote']),
    ]).then(() => helpers);
  }
  return helpersPromise;
}

function urlMode() {
  try {
    const q = new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('net');
    return q === 'local' || q === 'firebase' || q === 'offline' ? q : null;
  } catch (err) {
    return null;
  }
}

function isLocalHost() {
  const h = globalThis.location ? globalThis.location.hostname : '';
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function pickMode(mode, firebase) {
  if (mode === 'local' || mode === 'firebase' || mode === 'offline') return mode;
  const q = urlMode();
  if (q) return q;
  if (FEATURES && FEATURES.online === false) return 'offline';
  if (isConfigured((firebase && firebase.config) || FIREBASE_CONFIG)) return 'firebase';
  if (isLocalHost() && localAvailable()) return 'local';
  return 'offline';
}

const noop = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byJoin = (a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function withTimeout(p, ms) {
  let timer = null;
  return Promise.race([p, new Promise((resolve, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

// A write the rules (or the local room store) said no to, rather than one that got lost.
function isRefusal(err) {
  return /denied|permission/i.test(String((err && (err.code || err.message)) || err || ''));
}

function reasonError(reason, cause) {
  const e = new Error(reason === 'offline' ? 'rooms are not reachable right now' : reason);
  e.reason = reason;
  if (cause) e.cause = cause;
  return e;
}

// helpers (tests): replaces the content and character checkers for this net, e.g. {} for none.
export function createNet({ mode = 'auto', firebase = null, local = null, tuning = null, transport: injected = null, helpers: helperOverride = null } = {}) {
  const T = { ...DEFAULT_TUNING, ...(tuning || {}) };
  const H = helperOverride || helpers;
  const kind = injected ? injected.kind : pickMode(mode, firebase);
  const transport =
    injected ||
    (kind === 'firebase'
      ? createFirebaseTransport({
          config: (firebase && firebase.config) || FIREBASE_CONFIG,
          sdk: firebase && firebase.sdk,
          clock: firebase && firebase.clock,
          tuning: firebase && firebase.tuning,
        })
      : kind === 'local'
        ? createLocalTransport({ ...(local || {}) })
        : createLocalTransport({ solo: true }));

  const events = emitter();
  const now = () => transport.now();
  const me = { id: kind === 'firebase' ? null : transport.id, nick: null, look: null };
  let nickIsFallback = true;
  let myLocal = null; // my latest state
  let myJoinedAt = 0;
  let myPutAt = -Infinity;
  let status = 'offline';
  let linked = false;
  let connectedOnce = false;
  let disposed = false;

  // ---- the room ----------------------------------------------------------------------------------
  let inRoom = false;
  let leaving = false;
  let roomCode = null;
  let room = null;
  let hostId = null;
  const raw = { meta: null, players: new Map() }; // the authority's copy, already checked
  const stateIds = new Set();
  const players = new Map(); // what everyone sees
  const remote = new Map(); // id -> { buf, floor, lastSent }
  const myBots = new Map(); // id -> { entry, putAt, joinedAt }
  const goneBots = new Set(); // bots I removed that the authority has not confirmed yet
  const botLocal = new Map();
  const senders = new Map();
  let botSeq = 0;
  let game = null;
  let gameJson = 'null';
  let pendingGameJson = null;
  let gameSentJson = null;
  let lastGameSent = -Infinity;
  const seen = new Set();
  const seenOrder = [];
  const cleanupTried = new Map();
  let lastBeat = -Infinity;
  let lastTrim = -Infinity;
  let claiming = false; // my claim to host is on its way to the authority
  let claimedMeta = null; // a meta naming me host that arrived before the authority said yes
  let claimFails = 0;
  let claimAfter = -Infinity;
  let healFails = 0;
  let admitted = false; // in the room for real (not still joining)
  let refused = false; // the room shut its door while I was joining: the join says 'locked'
  let lastLocked = null;
  let sendTimer = null;
  let dutyTimer = null;
  let claimTimer = null;
  let healTimer = null;
  let gameTimer = null;

  const inEvent = V.createLimiter({ capacity: 30, perSecond: 15 });
  const inState = V.createLimiter({ capacity: 40, perSecond: 30 });
  const inPlayer = V.createLimiter({ capacity: 10, perSecond: 2 });
  const outEvent = V.createLimiter({ capacity: 20, perSecond: 8 });
  const stats = { sentStates: 0, sentEvents: 0, events: 0, dropped: { bad: 0, rate: 0, unknown: 0, host: 0 } };

  const warned = new Map();
  function warnOnce(key, ...args) {
    const t = Date.now();
    if (t - (warned.get(key) || -Infinity) < 5000) return;
    warned.set(key, t);
    console.warn('[c9 net]', ...args);
  }
  function quiet(p, what = 'write') {
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (!disposed) warnOnce(what, 'a ' + what + ' did not go through:', (err && (err.code || err.message)) || err);
      });
    }
    return p;
  }

  function setStatus(s) {
    if (s === status) return;
    status = s;
    events.emit('status', s);
  }

  transport.onLink((up) => {
    linked = up;
    if (kind === 'offline' || disposed) return;
    if (connectedOnce) setStatus(up ? 'online' : 'connecting');
    if (up && inRoom) sink.resync();
  });

  // One room operation at a time (a double tap on "Join" must not join twice).
  let chain = Promise.resolve();
  function serial(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(noop, noop);
    return run;
  }

  async function ensureConnected() {
    await loadHelpers();
    if (disposed) throw reasonError('offline');
    if (kind === 'offline') {
      await transport.connect();
      me.id = transport.id;
      return;
    }
    if (connectedOnce) return;
    setStatus('connecting');
    try {
      const { id } = await transport.connect();
      me.id = id;
      connectedOnce = true;
      setStatus(linked ? 'online' : 'connecting');
    } catch (err) {
      setStatus('offline');
      warnOnce('connect', 'rooms are not reachable:', (err && err.message) || err);
      throw reasonError('offline', err);
    }
  }

  function setMe(nick, look) {
    if (nick !== undefined || !me.nick) {
      const n = nick === undefined ? null : V.cleanNickWith(nick, H.cleanNick);
      nickIsFallback = !n;
      me.nick = n || V.fallbackNick(me.id || String(Math.random()), H.randomNick);
    }
    if (look !== undefined || !me.look) me.look = V.cleanLookWith(look === undefined ? null : look, H.cleanLook);
  }
  const myEntry = () => ({ nick: me.nick, look: V.encodeLook(me.look), bot: false });
  const isHostNow = () => inRoom && !leaving && hostId !== null && hostId === me.id;
  // While the link is down nothing is written: the SDK would queue every update and replay them all,
  // stale, on reconnect. What matters (my latest state, the game) is sent again when it comes back.
  const writable = () => kind === 'offline' || linked;

  // ---- what arrives from the transport -------------------------------------------------------------
  const sink = {
    meta(m) {
      if (!inRoom) return;
      if (m === null || m === undefined) {
        if (raw.meta) roomLost();
        return;
      }
      const c = V.cleanMeta(m);
      if (!c) {
        stats.dropped.bad++;
        return;
      }
      // Firebase shows my own claim at once, before the server has decided. Until it says yes,
      // a meta naming me host is held back, so I never act as host on a claim that gets refused.
      if (claiming && c.hostId === me.id && (!raw.meta || raw.meta.hostId !== me.id)) {
        claimedMeta = c;
        return;
      }
      if (claiming) claimedMeta = null;
      raw.meta = c;
      recompute();
    },
    player(id, v) {
      if (!inRoom || !V.isId(id)) return;
      if (v === null || v === undefined) {
        goneBots.delete(id);
        if (!raw.players.delete(id)) return;
        if (id === me.id || myBots.has(id)) scheduleHeal();
        recompute();
        return;
      }
      const mine = id === me.id || myBots.has(id);
      if (!mine && raw.players.has(id) && !inPlayer.allow(id)) {
        stats.dropped.rate++;
        return;
      }
      const e = V.cleanPlayerEntry(id, v, H);
      if (!e) {
        stats.dropped.bad++;
        if (raw.players.delete(id)) recompute();
        return;
      }
      raw.players.set(id, e);
      if (id === me.id) {
        myJoinedAt = e.joinedAt;
        healFails = 0;
      }
      recompute();
    },
    state(id, v) {
      if (!inRoom || !V.isId(id)) return;
      if (v === null || v === undefined) {
        stateIds.delete(id);
        remote.delete(id);
        return;
      }
      if (stateIds.size < 64) stateIds.add(id);
      if (id === me.id || myBots.has(id)) return;
      if (!inState.allow(id)) {
        stats.dropped.rate++;
        return;
      }
      const s = V.cleanState(v);
      if (!s) {
        stats.dropped.bad++;
        return;
      }
      takeSample(id, s);
    },
    event(key, v) {
      if (!inRoom || typeof key !== 'string' || key.length > 64 || seen.has(key)) return;
      seen.add(key);
      seenOrder.push(key);
      if (seenOrder.length > 1000) seen.delete(seenOrder.shift());
      const ev = V.cleanEventRecord(v);
      if (!ev) {
        stats.dropped.bad++;
        return;
      }
      if (ev.from !== me.id) {
        const p = raw.players.get(ev.from);
        if (!p || p.bot || !players.has(ev.from)) {
          stats.dropped.unknown++;
          return;
        }
        if (!inEvent.allow(ev.from)) {
          stats.dropped.rate++;
          return;
        }
      }
      if (V.HOST_ONLY_EVENTS.includes(ev.type) && ev.from !== hostId) {
        stats.dropped.host++;
        return;
      }
      if (ev.type === 'emote') {
        const d = V.cleanEmoteData(ev.data, H.cleanEmote);
        if (d === V.INVALID) {
          stats.dropped.bad++;
          return;
        }
        ev.data = d;
      }
      stats.events++;
      events.emit('event', { from: ev.from, type: ev.type, data: ev.data });
    },
    game(v) {
      if (!inRoom) return;
      if (v === null || v === undefined) {
        if (!isHostNow()) setGameJson('null', null);
        return;
      }
      const g = V.cleanGameRecord(v);
      if (!g) {
        stats.dropped.bad++;
        return;
      }
      if (isHostNow() && g.by === me.id) return; // my own write coming back: I already have newer
      const p = raw.players.get(g.by);
      if (g.by !== hostId && !(p && !p.bot)) {
        stats.dropped.host++;
        return;
      }
      setGameJson(g.json, g.state && V.mapNicks(g.state, knownNick));
    },
    // The room locked without me on its list: the transport can't show it to me any more.
    removed() {
      if (!inRoom || leaving) return;
      if (!admitted) {
        refused = true;
        return;
      }
      sentHome();
    },
    // After a reconnect or a new local leader: put back whatever went missing meanwhile.
    resync() {
      if (!inRoom || leaving) return;
      for (const s of senders.values()) s.reset();
      if (isHostNow() && gameJson !== 'null') {
        gameSentJson = null;
        pendingGameJson = gameJson;
        flushGameSoon();
      }
      scheduleHeal();
    },
  };

  function takeSample(id, s) {
    const t = now();
    const sent = s.t === undefined ? t : s.t;
    let r = remote.get(id);
    if (r && sent <= r.lastSent) {
      if (r.lastSent - sent < 500) return; // a repeat or out of order
      r = null; // the sender's clock jumped back: start over
    }
    if (!r) {
      if (remote.size >= 64) return;
      r = { buf: createInterpBuffer({ delayMs: GAME.interpDelayMs }), floor: t - sent, lastSent: -Infinity, lastAt: -Infinity };
      remote.set(id, r);
    }
    // Line the sender's clock up with ours: the smallest delay seen, creeping up slowly so it
    // follows a connection that got slower.
    r.floor = Math.min(r.floor + 2, t - sent);
    let at = sent + r.floor;
    if (at <= r.lastAt) at = r.lastAt + 1;
    r.lastSent = sent;
    r.lastAt = at;
    r.buf.push({ t: at, x: s.x, y: s.y, z: s.z, h: s.h, anim: s.anim });
  }

  // Names inside the game state (V.mapNicks): the host sends them blank, and each device shows the
  // name it already checked for that player id. A name under an id it doesn't know goes through the
  // same nickname checks as everyone's, or becomes that id's made-up name; never free text.
  function knownNick(nick, id) {
    const p = V.isId(id) ? players.get(id) || raw.players.get(id) : null;
    if (p) return p.nick;
    if (!nick) return '';
    return V.cleanNickWith(nick, H.cleanNick, { strict: true }) || V.fallbackNick(id, H.randomNick);
  }
  function wireGame(json) {
    try {
      return JSON.stringify(V.mapNicks(JSON.parse(json), () => ''));
    } catch (err) {
      return json; // never happens: json is always what encodeData or decodeData accepted
    }
  }

  function setGameJson(json, state) {
    if (json === gameJson) return;
    gameJson = json;
    game = state;
    events.emit('game', game);
  }

  // ---- the view everyone sees ----------------------------------------------------------------------
  let recomputing = false;
  let again = false;
  function recompute() {
    if (recomputing) {
      again = true;
      return;
    }
    recomputing = true;
    try {
      do {
        again = false;
        recomputeOnce();
      } while (again && inRoom);
    } finally {
      recomputing = false;
    }
  }

  function publicEntry(e, prev) {
    if (prev && prev.nick === e.nick && prev.bot === e.bot && prev.joinedAt === e.joinedAt && JSON.stringify(prev.look) === JSON.stringify(e.look)) {
      return prev;
    }
    return Object.freeze({ id: e.id, nick: e.nick, look: e.look, bot: e.bot, joinedAt: e.joinedAt });
  }

  function visibleHumans() {
    const meta = raw.meta;
    const oldest = meta ? meta.createdAt - 60000 : 0;
    const humans = [];
    for (const e of raw.players.values()) if (!e.bot && e.joinedAt >= oldest) humans.push(e);
    if (me.id && !raw.players.has(me.id) && inRoom && !leaving) {
      humans.push({ id: me.id, nick: me.nick, look: me.look, bot: false, joinedAt: myJoinedAt || myPutAt, owner: null });
    }
    humans.sort(byJoin);
    return humans.slice(0, GAME.maxPlayers);
  }

  function recomputeOnce() {
    if (!inRoom) return;
    const meta = raw.meta;
    const newHost = meta ? meta.hostId : null;
    const humans = visibleHumans();
    const hostHere = humans.some((h) => h.id === newHost);
    const bots = [];
    if (hostHere) {
      for (const e of raw.players.values()) if (e.bot && e.owner === newHost && !goneBots.has(e.id)) bots.push(e);
      if (newHost === me.id) {
        for (const [id, b] of myBots) {
          if (!raw.players.has(id)) bots.push({ id, nick: b.nick, look: b.look, bot: true, joinedAt: b.joinedAt, owner: me.id });
        }
      }
    }
    bots.sort(byJoin);
    const list = humans.concat(bots.slice(0, Math.max(0, GAME.maxPlayers - humans.length))).sort(byJoin);

    const before = new Map(players);
    players.clear();
    for (const e of list) players.set(e.id, publicEntry(e, before.get(e.id)));
    const left = [];
    const joined = [];
    const changed = [];
    for (const id of before.keys()) if (!players.has(id)) left.push(id);
    for (const [id, e] of players) {
      const was = before.get(id);
      if (!was) joined.push(id);
      else if (was !== e && (was.nick !== e.nick || JSON.stringify(was.look) !== JSON.stringify(e.look))) changed.push(id);
    }
    for (const id of left) remote.delete(id);
    const hostChanged = newHost !== hostId;
    hostId = newHost;
    const locked = !!(meta && meta.locked);
    if (meta && (!room || room.hostId !== hostId || room.createdAt !== meta.createdAt || room.locked !== locked)) {
      room = Object.freeze({ code: roomCode, hostId, createdAt: meta.createdAt, locked });
    }
    if (hostChanged) hostChangedNow();
    for (const id of left) events.emit('leave', { id });
    for (const id of joined) events.emit('join', { id });
    for (const id of changed) events.emit('player', { id });
    if (hostChanged) events.emit('host', { id: hostId });
    if (meta && locked !== lastLocked) {
      lastLocked = locked;
      events.emit('room', { locked });
    }
    if (isHostNow()) fitBots(humans.length);
    else considerClaim();
  }

  function hostChangedNow() {
    clearTimeout(claimTimer);
    claimTimer = null;
    if (hostId === me.id) {
      lastBeat = -Infinity;
      lastTrim = now();
      gameSentJson = null; // whatever I sent in an earlier turn as host may have been replaced since
      claimFails = 0;
      return;
    }
    // Bots belong to the host: when I am not the host any more, mine go.
    for (const id of [...myBots.keys()]) dropBot(id);
    clearTimeout(gameTimer);
    gameTimer = null;
    pendingGameJson = null;
  }

  // A human joining a full room takes the newest bot's place.
  function fitBots(humanCount) {
    const room4bots = Math.max(0, GAME.maxPlayers - humanCount);
    if (myBots.size <= room4bots) return;
    const newest = [...myBots.entries()].sort((a, b) => b[1].joinedAt - a[1].joinedAt);
    for (let i = 0; i < myBots.size - room4bots; i++) dropBot(newest[i][0]);
    again = true;
  }

  // ---- host election -----------------------------------------------------------------------------
  function hostAbsent() {
    const m = raw.meta;
    if (!m || m.hostId === me.id) return false;
    const h = raw.players.get(m.hostId);
    if (!h || h.bot) return true;
    return now() - m.beat > T.hostGoneMs;
  }

  function considerClaim() {
    if (!inRoom || leaving || claimTimer || claiming || now() < claimAfter || !hostAbsent() || !raw.players.has(me.id)) return;
    const m = raw.meta;
    const line = [...raw.players.values()].filter((e) => !e.bot && e.id !== m.hostId && e.joinedAt >= m.createdAt - 60000).sort(byJoin);
    const place = line.findIndex((e) => e.id === me.id);
    if (place < 0) return;
    claimTimer = setTimeout(async () => {
      if (!inRoom || leaving || !hostAbsent()) {
        claimTimer = null;
        return;
      }
      claiming = true;
      let ok = false;
      try {
        ok = (await transport.claimHost()) === true;
      } catch (err) {
        ok = false;
      }
      claiming = false;
      claimTimer = null;
      const m = claimedMeta;
      claimedMeta = null;
      // refused (someone else was quicker, or the host is still there): wait longer each time
      claimFails = ok ? 0 : claimFails + 1;
      claimAfter = ok ? -Infinity : now() + Math.min(10000, 500 * 2 ** claimFails);
      if (ok && m && inRoom) {
        raw.meta = m;
        recompute();
      }
    }, place * T.claimStepMs + 30);
  }

  function nextHost() {
    return visibleHumans().find((e) => e.id !== me.id && raw.players.has(e.id)) || null;
  }

  // ---- keeping things tidy -----------------------------------------------------------------------
  function scheduleHeal(delay = T.healDelayMs) {
    if (healTimer || !inRoom || leaving) return;
    healTimer = setTimeout(() => {
      healTimer = null;
      heal();
    }, delay);
  }

  async function heal() {
    if (!inRoom || leaving || !writable()) return; // the link coming back runs this again
    const t = now();
    if (me.id && !raw.players.has(me.id) && t - myPutAt > 1500) {
      myPutAt = t;
      try {
        await transport.putPlayer(me.id, myEntry());
        const s = senders.get(me.id);
        if (s) s.reset();
      } catch (err) {
        if (isRefusal(err) && raw.meta && raw.meta.locked) {
          sentHome();
          return;
        }
        if (++healFails >= 5) {
          warnOnce('heal', 'could not get back into the room:', (err && (err.code || err.message)) || err);
          roomLost();
          return;
        }
        scheduleHeal(1500);
      }
    }
    if (isHostNow()) {
      for (const [id, b] of myBots) {
        if (raw.players.has(id) || t - b.putAt < 2000) continue;
        b.putAt = t;
        transport.putPlayer(id, b.entry).then(() => {
          const s = senders.get(id);
          if (s) s.reset();
        }, noop);
      }
    }
  }

  function tryCleanup(key, fn) {
    const t = now();
    if (t - (cleanupTried.get(key) || -Infinity) < T.cleanupRetryMs) return;
    cleanupTried.set(key, t);
    if (cleanupTried.size > 200) cleanupTried.delete(cleanupTried.keys().next().value);
    Promise.resolve()
      .then(fn)
      .catch(noop);
  }

  function dutyTick() {
    if (!inRoom || leaving || !raw.meta || !writable()) return;
    const t = now();
    if (me.id && !raw.players.has(me.id)) scheduleHeal();
    if (!isHostNow()) {
      considerClaim();
      return;
    }
    if (t - lastBeat >= T.hostBeatMs) {
      lastBeat = t;
      quiet(transport.setMeta({}), 'heartbeat');
    }
    if (t - lastTrim >= T.trimEveryMs) {
      lastTrim = t;
      quiet(transport.trimEvents(t - T.eventTtlMs), 'tidy-up');
    }
    for (const [id, b] of myBots) if (!raw.players.has(id) && t - b.putAt > 2000) scheduleHeal();
    const oldest = raw.meta.createdAt - 60000;
    for (const e of raw.players.values()) {
      if (e.bot && e.owner !== me.id) {
        // a bot left behind by an earlier host: its entry first, then its state (the rules check the entry)
        tryCleanup('b:' + e.id, async () => {
          await transport.dropPlayer(e.id);
          await transport.dropState(e.id);
        });
      } else if (!e.bot && e.joinedAt < oldest) {
        tryCleanup('p:' + e.id, () => transport.dropPlayer(e.id));
      }
    }
    for (const id of stateIds) if (!raw.players.has(id) && !myBots.has(id)) tryCleanup('s:' + id, () => transport.dropState(id));
  }

  function startTimers() {
    stopTimers();
    sendTimer = setInterval(() => {
      const t = now();
      for (const s of senders.values()) s.tick(t);
    }, Math.round(1000 / GAME.netHz));
    dutyTimer = setInterval(dutyTick, T.dutyMs);
  }

  function stopTimers() {
    clearInterval(sendTimer);
    clearInterval(dutyTimer);
    clearTimeout(claimTimer);
    clearTimeout(healTimer);
    clearTimeout(gameTimer);
    sendTimer = dutyTimer = claimTimer = healTimer = gameTimer = null;
  }

  // ---- sending -------------------------------------------------------------------------------------
  function getSender(id) {
    let s = senders.get(id);
    if (!s) {
      s = createStateSender({
        hz: GAME.netHz,
        send: (st, t) => {
          if (!inRoom || leaving) return;
          if (!writable() || (id === me.id ? !raw.players.has(id) : !(myBots.has(id) && isHostNow()))) {
            s.reset(); // not in the room yet: try again on the next tick
            return;
          }
          stats.sentStates++;
          quiet(transport.putState(id, V.toWireState(st, t)), 'position update');
        },
      });
      senders.set(id, s);
    }
    return s;
  }

  function flushGameSoon() {
    if (gameTimer) return;
    gameTimer = setTimeout(flushGame, Math.max(0, lastGameSent + T.gameGapMs - now()));
  }

  function flushGame() {
    gameTimer = null;
    if (!isHostNow() || pendingGameJson === null || !writable()) return; // resync sends it later
    const json = pendingGameJson;
    pendingGameJson = null;
    if (json === gameSentJson) return;
    gameSentJson = json;
    lastGameSent = now();
    quiet(transport.setGame(json === 'null' ? null : wireGame(json)), 'game update');
  }

  function dropBot(id) {
    myBots.delete(id);
    goneBots.add(id);
    if (goneBots.size > 64) goneBots.delete(goneBots.values().next().value);
    senders.delete(id);
    botLocal.delete(id);
    if (inRoom) {
      quiet(transport.dropState(id));
      quiet(transport.dropPlayer(id));
    }
  }

  // ---- entering and leaving ------------------------------------------------------------------------
  function resetRoom() {
    stopTimers();
    raw.meta = null;
    raw.players.clear();
    stateIds.clear();
    players.clear();
    remote.clear();
    myBots.clear();
    goneBots.clear();
    botLocal.clear();
    senders.clear();
    cleanupTried.clear();
    seen.clear();
    seenOrder.length = 0;
    hostId = null;
    room = null;
    roomCode = null;
    game = null;
    gameJson = 'null';
    pendingGameJson = null;
    gameSentJson = null;
    lastGameSent = -Infinity;
    myJoinedAt = 0;
    healFails = 0;
    claiming = false;
    claimedMeta = null;
    claimFails = 0;
    claimAfter = -Infinity;
    admitted = false;
    refused = false;
    lastLocked = null;
  }

  async function enterRoom(code) {
    resetRoom();
    inRoom = true;
    leaving = false;
    roomCode = code;
    room = Object.freeze({ code, hostId: null, createdAt: 0 });
    myPutAt = now();
    startTimers();
    await transport.enter(code, myEntry(), sink);
    const t0 = Date.now();
    while (inRoom && !(raw.meta && raw.players.has(me.id)) && Date.now() - t0 < T.joinWaitMs) await sleep(15);
    if (!inRoom || !raw.meta) throw new Error('the room did not arrive');
    admitted = true;
    recompute();
    if (myLocal) getSender(me.id).update(myLocal, now());
  }

  function finishLeave(reason) {
    if (!inRoom) return;
    const gone = [...players.keys()].filter((id) => id !== me.id);
    const hadHost = hostId !== null;
    inRoom = false;
    leaving = false;
    resetRoom();
    for (const id of gone) events.emit('leave', { id });
    events.emit('leave', { id: me.id, reason });
    if (hadHost) events.emit('host', { id: null });
  }

  async function leaveNow(reason = 'left') {
    if (!inRoom) return;
    leaving = true;
    stopTimers();
    if (hostId === me.id) {
      const next = nextHost();
      if (next) await withTimeout(transport.setMeta({ hostId: next.id }), 1500).catch(noop);
    }
    await withTimeout(transport.exit([...myBots.keys()]), T.leaveTimeoutMs).catch(noop);
    finishLeave(reason);
  }

  function roomLost() {
    if (!inRoom || leaving) return;
    leaving = true;
    stopTimers();
    transport.exit([...myBots.keys()]).catch(noop);
    finishLeave('lost');
  }

  // The host locked the room without me (or sent me home): out at once, kindly ('removed').
  function sentHome() {
    if (!inRoom || leaving) return;
    leaving = true;
    stopTimers();
    transport.exit([...myBots.keys()]).catch(noop);
    finishLeave('removed');
  }

  // Humans in the room now (me too): the allow list of a lock.
  function humansHere() {
    const ids = [...raw.players.values()].filter((e) => !e.bot).map((e) => e.id);
    if (me.id && !ids.includes(me.id)) ids.push(me.id);
    return ids;
  }

  async function abandon() {
    if (!inRoom) return;
    leaving = true;
    stopTimers();
    await withTimeout(transport.exit([...myBots.keys()]), T.leaveTimeoutMs).catch(noop);
    finishLeave('lost');
  }

  function createRoom({ nick, look, code: wanted } = {}) {
    return serial(async () => {
      if (disposed) throw reasonError('offline');
      await leaveNow();
      setMe(nick, look);
      await ensureConnected();
      const asked = wanted === undefined || wanted === null ? null : normalizeCode(wanted);
      for (let i = 0; i < 12; i++) {
        const code = i === 0 && asked ? asked : makeRoomCode(); // the code asked for if it is free
        let r;
        try {
          r = await transport.create(code);
        } catch (err) {
          throw reasonError('offline', err);
        }
        if (r !== 'ok') continue;
        try {
          await enterRoom(code);
        } catch (err) {
          await abandon();
          throw reasonError('offline', err);
        }
        return code;
      }
      throw reasonError('busy');
    });
  }

  function joinRoom(code, { nick, look } = {}) {
    return serial(async () => {
      const c = normalizeCode(code);
      if (!c) return { ok: false, reason: 'bad-code' };
      if (kind === 'offline' || disposed) return { ok: false, reason: 'offline' };
      if (inRoom && roomCode === c && !leaving) return { ok: true };
      // A mistyped code must not take you out of the room you are in: look first, leave after.
      try {
        await ensureConnected();
      } catch (err) {
        return { ok: false, reason: 'offline' };
      }
      let info;
      try {
        info = await transport.probe(c);
      } catch (err) {
        return { ok: false, reason: 'offline' };
      }
      const meta = info && V.cleanMeta(info.meta);
      if (!meta || meta.beat < now() - 12 * 3600 * 1000) return { ok: false, reason: 'not-found' };
      if (info.locked === true) return { ok: false, reason: 'locked' };
      let humans = 0;
      const ps = info.players && typeof info.players === 'object' ? info.players : {};
      for (const [id, p] of Object.entries(ps)) {
        const e = V.cleanPlayerEntry(id, p, H);
        if (e && !e.bot && e.joinedAt >= meta.createdAt - 60000 && id !== me.id) humans++;
      }
      if (humans === 0) return { ok: false, reason: 'not-found' }; // nobody there: make it afresh instead
      if (humans >= GAME.maxPlayers) return { ok: false, reason: 'full' };
      await leaveNow();
      setMe(nick, look);
      try {
        await enterRoom(c);
      } catch (err) {
        const locked = refused || (isRefusal(err) && !!raw.meta && raw.meta.locked); // it locked between the look and the knock
        await abandon();
        return { ok: false, reason: locked ? 'locked' : 'offline' };
      }
      // Two people may have squeezed in at the same moment: the later one steps back out.
      const all = [...raw.players.values()].filter((e) => !e.bot && e.joinedAt >= raw.meta.createdAt - 60000).sort(byJoin);
      if (all.findIndex((e) => e.id === me.id) >= GAME.maxPlayers) {
        await leaveNow('full');
        return { ok: false, reason: 'full' };
      }
      return { ok: true };
    });
  }

  // ---- page lifecycle --------------------------------------------------------------------------------
  const win = typeof window !== 'undefined' && window && typeof window.addEventListener === 'function' ? window : null;
  const onPageHide = () => {
    if (transport.suspend) transport.suspend();
  };
  const onPageShow = (e) => {
    if (e && e.persisted && transport.resume) {
      transport.resume();
      sink.resync();
    }
  };
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') dutyTick();
  };
  if (win) {
    win.addEventListener('pagehide', onPageHide);
    win.addEventListener('pageshow', onPageShow);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  }

  // ---- the public object -----------------------------------------------------------------------------
  const net = {
    get mode() {
      return kind;
    },
    get status() {
      return status;
    },
    get me() {
      return { id: me.id, nick: me.nick, look: me.look };
    },
    get room() {
      return inRoom ? room : null;
    },
    players,
    get isHost() {
      return isHostNow();
    },
    get game() {
      return game;
    },
    get stats() {
      return stats;
    },

    createRoom,
    joinRoom,
    leaveRoom() {
      return serial(() => leaveNow('left'));
    },

    sendState(state) {
      const s = V.cleanState(state);
      if (!s) return false;
      delete s.t;
      myLocal = s;
      if (inRoom && !leaving && me.id) getSender(me.id).update(s, now());
      return true;
    },

    sendStateFor(botId, state) {
      if (!isHostNow() || !myBots.has(botId)) return false;
      const s = V.cleanState(state);
      if (!s) return false;
      delete s.t;
      botLocal.set(botId, s);
      getSender(botId).update(s, now());
      return true;
    },

    stateOf(id, at, out) {
      if (typeof id !== 'string') return null;
      if (id === me.id || myBots.has(id)) {
        const s = id === me.id ? myLocal : botLocal.get(id);
        if (!s) return null;
        const o = out || {};
        o.x = s.x;
        o.y = s.y;
        o.z = s.z;
        o.h = s.h;
        o.anim = s.anim;
        return o;
      }
      if (!players.has(id)) return null;
      const r = remote.get(id);
      if (!r) return null;
      return r.buf.sample(typeof at === 'number' && Number.isFinite(at) ? at : now(), out);
    },

    addBot({ nick, look } = {}) {
      if (!isHostNow()) return null;
      const humans = [...players.values()].filter((p) => !p.bot).length;
      if (humans + myBots.size >= GAME.maxPlayers) return null;
      let id;
      do {
        id = me.id + '-b' + (++botSeq).toString(36) + Math.floor(Math.random() * 1296).toString(36);
      } while (raw.players.has(id) || myBots.has(id));
      if (!V.isId(id)) return null;
      const b = {
        nick: V.cleanNickWith(nick, H.cleanNick) || V.fallbackNick(id, H.randomNick),
        look: V.cleanLookWith(look === undefined ? null : look, H.cleanLook),
        putAt: now(),
        joinedAt: now(),
      };
      b.entry = { nick: b.nick, look: V.encodeLook(b.look), bot: true, owner: me.id };
      myBots.set(id, b);
      quiet(transport.putPlayer(id, b.entry), 'new bot');
      recompute();
      return id;
    },

    removeBot(id) {
      if (!myBots.has(id)) return false;
      dropBot(id);
      recompute();
      return true;
    },

    send(type, data) {
      if (!inRoom || leaving || !me.id || !writable()) return false;
      if (!V.EVENT_TYPES.includes(type)) {
        warnOnce('type:' + type, 'unknown event type', type);
        return false;
      }
      if (V.HOST_ONLY_EVENTS.includes(type) && !isHostNow()) return false;
      if (type === 'emote') {
        data = V.cleanEmoteData(data, H.cleanEmote);
        if (data === V.INVALID) {
          warnOnce('emote', 'emotes are { id } of a preset emote');
          return false;
        }
      }
      const json = V.encodeData(data, V.EVENT_LIMITS);
      if (json === null) {
        warnOnce('data:' + type, 'event data must be small plain JSON (' + V.LIMITS.eventJson + ' characters at most):', type);
        return false;
      }
      if (!outEvent.allow('me')) return false;
      stats.sentEvents++;
      quiet(transport.pushEvent({ type, data: json }), 'event');
      return true;
    },

    setGame(state) {
      if (!isHostNow()) return false;
      let json = 'null';
      if (state !== null && state !== undefined) {
        if (!V.isPlainObject(state)) {
          warnOnce('game-shape', 'setGame wants a plain object or null');
          return false;
        }
        json = V.encodeData(state, V.GAME_LIMITS);
        if (json === null) {
          warnOnce('game-size', 'the game state must be plain JSON, ' + V.LIMITS.gameJson + ' characters at most');
          return false;
        }
      }
      if (json !== gameJson) {
        gameJson = json;
        const g = json === 'null' ? null : JSON.parse(json);
        game = g;
        queueMicrotask(() => {
          if (game === g && inRoom) events.emit('game', g);
        });
      }
      pendingGameJson = json;
      flushGameSoon();
      return true;
    },

    async lockRoom(on) {
      if (!isHostNow() || !writable() || typeof transport.lock !== 'function') return false;
      try {
        await transport.lock(on === true, humansHere());
        return true;
      } catch (err) {
        warnOnce('lock', 'the room lock did not go through:', (err && (err.code || err.message)) || err);
        return false;
      }
    },

    async sendHome(id) {
      const e = typeof id === 'string' ? raw.players.get(id) : null;
      if (!isHostNow() || !writable() || !e || e.bot || id === me.id || typeof transport.sendHome !== 'function') return false;
      try {
        await transport.sendHome(id, humansHere().filter((x) => x !== id));
        return true;
      } catch (err) {
        warnOnce('home', 'sending a friend home did not go through:', (err && (err.code || err.message)) || err);
        return false;
      }
    },

    updateMe({ nick, look } = {}) {
      setMe(nick, look);
      if (inRoom && !leaving && raw.players.has(me.id)) {
        quiet(transport.patchPlayer(me.id, { nick: me.nick, look: V.encodeLook(me.look) }), 'profile update');
      }
    },

    now,
    on: (evt, fn) => events.on(evt, fn),
    off: (evt, fn) => events.off(evt, fn),

    // For the dev lab and tests: what the transport is doing.
    debug() {
      return {
        mode: kind,
        leader: transport.isLeader === undefined ? null : transport.isLeader,
        raw: { meta: raw.meta, players: [...raw.players.keys()], states: [...stateIds] },
        bots: [...myBots.keys()],
        game: gameJson,
      };
    },

    dispose() {
      if (disposed) return;
      if (inRoom) {
        leaving = true;
        stopTimers();
        Promise.resolve(transport.exit([...myBots.keys()])).catch(noop);
        finishLeave('left');
      }
      disposed = true;
      transport.dispose();
      if (win) {
        win.removeEventListener('pagehide', onPageHide);
        win.removeEventListener('pageshow', onPageShow);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      }
      setStatus('offline');
    },
  };
  loadHelpers().then(() => {
    if (disposed) return;
    if (nickIsFallback) me.nick = null; // a nicer made-up name now that the names module is here
    setMe(undefined, undefined);
  });
  return net;
}
