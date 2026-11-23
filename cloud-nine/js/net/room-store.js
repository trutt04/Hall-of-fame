// The one authoritative copy of every room, for the transports that have no server: the leader
// tab of the local transport and solo (offline) play. Its permission checks mirror
// firebase/database.rules.json, so the local transport behaves like the real thing. Pure: no DOM.
//
//   const store = createRoomStore({ now, staleMs, hostTimeoutMs, maxEvents })
//   store.exec(by, op) -> { ok, err?, value?, changes }   by = the asking player id (null = system)
//   store.apply(changes)                                   replicas apply the leader's changes
//   store.snapshot() / store.load(snapshot)                to hand the whole thing to a new leader
//   store.room(code) -> { meta, players: Map, state: Map, game, allow: Set } | null   read only
//   store.canRead(by, code) -> boolean    false for someone not on the list of a locked room
//   store.tabs() -> Set of every live device id (players and bot owners), for liveness watching
//
// ops: { op: 'probe' | 'create', code }, { op: 'putPlayer', code, id, entry }, { op: 'patchPlayer',
// code, id, patch }, { op: 'dropPlayer' | 'dropState', code, id }, { op: 'putState', code, id, s },
// { op: 'event', code, ev: { type, data } }, { op: 'setGame', code, json }, { op: 'meta', code,
// patch: { hostId } }, { op: 'claim', code }, { op: 'trim', code, before }, { op: 'gone', id },
// { op: 'lock', code, locked, allow: [ids] } (host only: who may be in the room while it is locked).
// changes: { c: code, k: 'room' | 'meta' | 'player' | 'state' | 'event' | 'trim' | 'game' | 'allow', id?, v?, before? }
// While a room is locked, only the ids on its allow list may join it or read it (the probe of anyone
// else says { meta, locked: true }), and the host may send home a player who is not on the list.

import { isRoomCode } from './codes.js';
import { isId, isWireNick, cleanTime, EVENT_TYPES, HOST_ONLY_EVENTS, LIMITS, ANIM_RE, isPlainObject } from './validate.js';

export const STALE_MS = 12 * 60 * 60 * 1000;
export const HOST_TIMEOUT_MS = 15000;

const fail = (err) => ({ ok: false, err, changes: [] });

function cleanWireState(s) {
  if (!isPlainObject(s)) return null;
  const num = (v, lim) => typeof v === 'number' && Number.isFinite(v) && v >= -lim && v <= lim;
  if (!num(s.x, LIMITS.pos) || !num(s.y, LIMITS.pos) || !num(s.z, LIMITS.pos) || !num(s.h, LIMITS.heading)) return null;
  if (typeof s.a !== 'string' || !ANIM_RE.test(s.a) || cleanTime(s.t) === null) return null;
  return { x: s.x, y: s.y, z: s.z, h: s.h, a: s.a, t: s.t };
}

export function createRoomStore({ now = () => Date.now(), staleMs = STALE_MS, hostTimeoutMs = HOST_TIMEOUT_MS, maxEvents = 200 } = {}) {
  let rooms = new Map();
  let evSeq = 0;

  const blank = () => ({ meta: null, players: new Map(), state: new Map(), events: [], game: null, allow: new Set() });
  const isStale = (r, t) => !r || !r.meta || r.meta.beat < t - staleMs;
  const isHost = (r, by) => !!(r && r.meta && by && r.meta.hostId === by);
  const isLocked = (r) => !!(r && r.meta && r.meta.locked === true);
  const mayBeIn = (r, by) => !isLocked(r) || r.allow.has(by);
  const nextEventId = () => 'e' + (++evSeq).toString(36).padStart(9, '0');

  function exec(by, op) {
    if (!op || typeof op !== 'object') return fail('bad');
    if (op.op === 'gone') return gone(op.id);
    if (!isId(by) || !isRoomCode(op.code)) return fail('bad');
    const t = now();
    const code = op.code;
    const r = rooms.get(code) || null;
    switch (op.op) {
      case 'probe':
        if (r && r.meta && !mayBeIn(r, by)) return { ok: true, value: { meta: r.meta, locked: true }, changes: [] };
        return { ok: true, value: r && r.meta ? publicRoom(r) : null, changes: [] };
      case 'create': {
        // free when new, 12 hours quiet, or empty (nobody left in it): the same as the rules
        if (r && !isStale(r, t) && r.players.size > 0) return fail('taken');
        const meta = { hostId: by, createdAt: t, beat: t, v: 1 };
        const fresh = blank();
        fresh.meta = meta;
        rooms.set(code, fresh);
        return { ok: true, value: 'ok', changes: [{ c: code, k: 'room' }, { c: code, k: 'meta', v: meta }] };
      }
    }
    if (!r || !r.meta) return fail('not-found');
    switch (op.op) {
      case 'putPlayer': {
        const id = op.id;
        const e = op.entry;
        if (!isId(id) || !isPlainObject(e) || isStale(r, t)) return fail(isStale(r, t) ? 'not-found' : 'bad');
        if (id === by) {
          if (e.bot !== false || e.owner !== undefined || !mayBeIn(r, by)) return fail('denied');
        } else if (!(isHost(r, by) && e.bot === true && e.owner === by && id.startsWith(by + '-b'))) {
          return fail('denied');
        }
        if (!isWireNick(e.nick) || typeof e.look !== 'string' || e.look.length > LIMITS.lookJson) return fail('bad');
        const old = r.players.get(id);
        const v = { nick: e.nick, look: e.look, bot: e.bot, joinedAt: old ? old.joinedAt : t };
        if (e.bot) v.owner = e.owner;
        r.players.set(id, v);
        return { ok: true, changes: [{ c: code, k: 'player', id, v }] };
      }
      case 'patchPlayer': {
        const old = r.players.get(op.id);
        const p = op.patch;
        if (!old || !isPlainObject(p)) return fail('bad');
        if (!(op.id === by || old.owner === by) || (op.id === by && !mayBeIn(r, by))) return fail('denied');
        if (p.nick !== undefined && !isWireNick(p.nick)) return fail('bad');
        if (p.look !== undefined && (typeof p.look !== 'string' || p.look.length > LIMITS.lookJson)) return fail('bad');
        const v = { ...old };
        if (p.nick !== undefined) v.nick = p.nick;
        if (p.look !== undefined) v.look = p.look;
        r.players.set(op.id, v);
        return { ok: true, changes: [{ c: code, k: 'player', id: op.id, v }] };
      }
      case 'dropPlayer': {
        const old = r.players.get(op.id);
        if (!old) return { ok: true, changes: [] };
        const ok = op.id === by || old.owner === by || (isHost(r, by) && (old.bot || old.joinedAt < r.meta.createdAt || !mayBeIn(r, op.id)));
        if (!ok) return fail('denied');
        r.players.delete(op.id);
        return { ok: true, changes: [{ c: code, k: 'player', id: op.id, v: null }] };
      }
      case 'putState': {
        const p = r.players.get(op.id);
        if (!p || !(op.id === by || p.owner === by)) return fail('denied');
        const v = cleanWireState(op.s);
        if (!v) return fail('bad');
        r.state.set(op.id, v);
        return { ok: true, changes: [{ c: code, k: 'state', id: op.id, v }] };
      }
      case 'dropState': {
        if (!r.state.has(op.id)) return { ok: true, changes: [] };
        const p = r.players.get(op.id);
        const ok = op.id === by || (p && p.owner === by) || (isHost(r, by) && !p);
        if (!ok) return fail('denied');
        r.state.delete(op.id);
        return { ok: true, changes: [{ c: code, k: 'state', id: op.id, v: null }] };
      }
      case 'event': {
        const ev = op.ev;
        const me = r.players.get(by);
        if (!me || me.bot || !isPlainObject(ev)) return fail('denied');
        if (!EVENT_TYPES.includes(ev.type) || typeof ev.data !== 'string' || ev.data.length > LIMITS.eventJson) return fail('bad');
        if (HOST_ONLY_EVENTS.includes(ev.type) && !isHost(r, by)) return fail('denied');
        const id = nextEventId();
        const v = { from: by, type: ev.type, data: ev.data, t };
        r.events.push({ id, v });
        if (r.events.length > maxEvents) r.events.splice(0, r.events.length - maxEvents);
        return { ok: true, changes: [{ c: code, k: 'event', id, v }] };
      }
      case 'setGame': {
        if (!isHost(r, by)) return fail('denied');
        if (op.json !== null && (typeof op.json !== 'string' || op.json.length > LIMITS.gameJson)) return fail('bad');
        const v = op.json === null ? null : { by, json: op.json, t };
        r.game = v;
        return { ok: true, changes: [{ c: code, k: 'game', v }] };
      }
      case 'meta': {
        const p = isPlainObject(op.patch) ? op.patch : {};
        if (!isHost(r, by) || isStale(r, t)) return fail('denied');
        if (p.hostId !== undefined && !isId(p.hostId)) return fail('bad');
        const v = { ...r.meta, hostId: p.hostId === undefined ? r.meta.hostId : p.hostId, beat: t };
        r.meta = v;
        return { ok: true, changes: [{ c: code, k: 'meta', v }] };
      }
      case 'claim': {
        if (isStale(r, t)) return fail('not-found');
        const me = r.players.get(by);
        if (!me || me.bot) return fail('denied');
        if (r.meta.hostId === by) return { ok: true, value: true, changes: [] };
        const h = r.players.get(r.meta.hostId);
        const gone = !h || h.bot || r.meta.beat < t - hostTimeoutMs;
        if (!gone) return fail('denied');
        const v = { ...r.meta, hostId: by, beat: t };
        r.meta = v;
        return { ok: true, value: true, changes: [{ c: code, k: 'meta', v }] };
      }
      case 'lock': {
        if (!isHost(r, by) || isStale(r, t)) return fail('denied');
        const ids = Array.isArray(op.allow) ? op.allow.filter(isId).slice(0, 64) : [];
        const locked = op.locked === true;
        r.allow = new Set(locked ? ids : []);
        const v = { ...r.meta, locked, beat: t };
        r.meta = v;
        // the list first, so nobody on it ever sees the room locked without being on the list
        return { ok: true, changes: [{ c: code, k: 'allow', v: [...r.allow] }, { c: code, k: 'meta', v }] };
      }
      case 'trim': {
        if (!isHost(r, by)) return fail('denied');
        const before = Number(op.before);
        if (!Number.isFinite(before)) return fail('bad');
        const n = r.events.length;
        r.events = r.events.filter((e) => e.v.t >= before);
        return { ok: true, changes: r.events.length === n ? [] : [{ c: code, k: 'trim', before }] };
      }
      default:
        return fail('bad');
    }
  }

  // A device went away (its tab closed): its player entry, its bots and their states go too.
  function gone(id) {
    if (!isId(id)) return fail('bad');
    const changes = [];
    for (const [code, r] of rooms) {
      for (const [pid, p] of [...r.players]) {
        if (pid !== id && p.owner !== id) continue;
        r.players.delete(pid);
        changes.push({ c: code, k: 'player', id: pid, v: null });
        if (r.state.delete(pid)) changes.push({ c: code, k: 'state', id: pid, v: null });
      }
    }
    return { ok: true, changes };
  }

  function apply(changes) {
    if (!Array.isArray(changes)) return;
    for (const ch of changes) {
      if (!ch || !isRoomCode(ch.c)) continue;
      let r = rooms.get(ch.c);
      if (ch.k === 'room') {
        rooms.set(ch.c, blank());
        continue;
      }
      if (!r) {
        r = blank();
        rooms.set(ch.c, r);
      }
      switch (ch.k) {
        case 'meta':
          r.meta = ch.v;
          break;
        case 'player':
          if (ch.v) r.players.set(ch.id, ch.v);
          else r.players.delete(ch.id);
          break;
        case 'state':
          if (ch.v) r.state.set(ch.id, ch.v);
          else r.state.delete(ch.id);
          break;
        case 'event':
          r.events.push({ id: ch.id, v: ch.v });
          if (r.events.length > maxEvents) r.events.splice(0, r.events.length - maxEvents);
          if (typeof ch.id === 'string') evSeq = Math.max(evSeq, parseInt(ch.id.slice(1), 36) || 0);
          break;
        case 'trim':
          r.events = r.events.filter((e) => e.v.t >= ch.before);
          break;
        case 'game':
          r.game = ch.v || null;
          break;
        case 'allow':
          r.allow = new Set(Array.isArray(ch.v) ? ch.v.filter(isId) : []);
          break;
      }
    }
  }

  function publicRoom(r) {
    return { meta: r.meta, players: Object.fromEntries(r.players), game: r.game };
  }

  function snapshot() {
    const out = [];
    for (const [code, r] of rooms) {
      out.push([code, { meta: r.meta, players: [...r.players], state: [...r.state], events: r.events.slice(), game: r.game, allow: [...r.allow] }]);
    }
    return { v: 1, evSeq, rooms: out };
  }

  function load(snap) {
    if (!snap || snap.v !== 1 || !Array.isArray(snap.rooms)) return false;
    const next = new Map();
    for (const item of snap.rooms) {
      if (!Array.isArray(item) || !isRoomCode(item[0]) || !item[1] || typeof item[1] !== 'object') continue;
      const s = item[1];
      const r = blank();
      r.meta = isPlainObject(s.meta) ? s.meta : null;
      if (Array.isArray(s.players)) for (const [id, v] of s.players) if (isId(id) && isPlainObject(v)) r.players.set(id, v);
      if (Array.isArray(s.state)) for (const [id, v] of s.state) if (isId(id) && isPlainObject(v)) r.state.set(id, v);
      if (Array.isArray(s.events)) r.events = s.events.filter((e) => e && typeof e.id === 'string' && isPlainObject(e.v)).slice(-maxEvents);
      r.game = isPlainObject(s.game) ? s.game : null;
      if (Array.isArray(s.allow)) r.allow = new Set(s.allow.filter(isId));
      next.set(item[0], r);
    }
    rooms = next;
    evSeq = Math.max(evSeq, Number(snap.evSeq) || 0);
    return true;
  }

  function tabs() {
    const out = new Set();
    for (const r of rooms.values()) {
      for (const [pid, p] of r.players) out.add(p.bot ? p.owner : pid);
    }
    return out;
  }

  return {
    exec,
    apply,
    snapshot,
    load,
    tabs,
    room: (code) => rooms.get(code) || null,
    canRead: (by, code) => mayBeIn(rooms.get(code) || null, by),
    get size() {
      return rooms.size;
    },
  };
}
