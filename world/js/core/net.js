// Presence seam (Contract 6). Phase 1 ships this NO-OP adapter so the rest of the world can already
// talk to "the network" and phase 2 only has to swap the implementation.
//
// Interface every adapter must offer:
//
//   net.connect({ teamId, room? })  -> Promise<boolean>   resolves false when presence is unavailable
//   net.disconnect()
//   net.sendState(state)            state = { teamId, x, z, heading, anim } (what player.getState() returns).
//                                   Call it as often as you like; adapters throttle on their own.
//   net.on('peer', fn)              fn({ teamId, x, z, heading, anim, t })   a friend moved or joined
//   net.on('leave', fn)             fn({ teamId })                           a friend left
//   net.on('status', fn)            fn('offline' | 'connecting' | 'online')
//   net.submitScore(game, score)    -> Promise<boolean>   mini game results (no-op until phase 2)
//   net.connected                   boolean
//   net.peers                       Map<teamId, last state>
//   net.vandalism                   eggs, toilet paper and spray tags (see createLocalVandalism below)
//
// Remote players and resident NPCs are the same avatar objects in one actor registry keyed by team
// id, so when a 'peer' arrives the world swaps the resident for the live friend with no other change.

import { emitter } from './util.js';

// ---- vandalism storage ------------------------------------------------------------------------
// Damage done to the home of a team you beat. This adapter keeps it on this device; a shared
// store (an online database) can replace it later with the same interface and no world changes.
//
//   net.vandalism.shared            false here: only this device sees the damage
//   net.vandalism.setSeason(s)      the world says which season it is (keys are per season and week)
//   net.vandalism.list(week)        -> items[] for that week, oldest first, malformed ones dropped
//   net.vandalism.add(item)         -> Promise<boolean>   false when the item is malformed or not kept
//   net.vandalism.on('change', fn)  fn({ week }) after an add here or in another tab
//
// An item is small and serializable. p, n and pts are in the TARGET HOME'S own frame (+Z toward
// its street), so the damage moves with the house:
//   { id, week, attackerId, targetId, kind: 'egg'|'tp'|'tag', tier, on: 'home'|'tree'|'ground'|'miss',
//     p: [x,y,z], n: [x,y,z], tagId?, pts?: [[x,y,z], ...], at }
// Items come from other people once the store is shared, so everything is checked on the way in
// and on the way out. There is no free text in an item: a tag is a preset id.
const VANDAL_PREFIX = 'lw.vandal.v1.';
const VANDAL_MAX = 200; // per week
const KINDS = ['egg', 'tp', 'tag'];
const ON = ['home', 'tree', 'ground', 'miss'];
const TIERS = ['hill', 'heights', 'bubble', 'park', 'dump'];

function vec(v, lim) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = [];
  for (const x of v) {
    const n = Number(x);
    if (!Number.isFinite(n) || Math.abs(n) > lim) return null;
    out.push(Math.round(n * 1000) / 1000);
  }
  return out;
}

export function cleanVandalItem(it) {
  if (!it || typeof it !== 'object') return null;
  const id = typeof it.id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(it.id) ? it.id : null;
  const week = Number(it.week);
  const attackerId = Number(it.attackerId);
  const targetId = Number(it.targetId);
  if (!id || !Number.isInteger(week) || week < 1 || week > 40) return null;
  if (!Number.isInteger(attackerId) || !Number.isInteger(targetId) || attackerId === targetId) return null;
  if (!KINDS.includes(it.kind) || !TIERS.includes(it.tier)) return null;
  const on = it.on === undefined ? 'home' : it.on;
  if (!ON.includes(on)) return null;
  const p = vec(it.p, 80);
  let n = vec(it.n, 2);
  if (!p) return null;
  const nl = n ? Math.hypot(n[0], n[1], n[2]) : 0;
  n = nl > 0.1 ? n.map((x) => Math.round((x / nl) * 1000) / 1000) : [0, 1, 0];
  const out = { id, week, attackerId, targetId, kind: it.kind, tier: it.tier, on, p, n, at: Number.isFinite(Number(it.at)) ? Number(it.at) : 0 };
  if (it.kind === 'tag') {
    if (typeof it.tagId !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(it.tagId)) return null;
    out.tagId = it.tagId;
  }
  if (it.kind === 'tp') {
    if (!Array.isArray(it.pts) || it.pts.length < 2 || it.pts.length > 32) return null;
    const pts = it.pts.map((q) => vec(q, 80));
    if (pts.some((q) => !q)) return null;
    out.pts = pts;
  }
  return out;
}

function createLocalVandalism() {
  const events = emitter();
  const memory = new Map(); // when this device will not store anything (private window), the session still sees it
  let season = 'x';
  const keyOf = (week) => VANDAL_PREFIX + season + '.' + week;
  function read(week) {
    let raw = null;
    try {
      raw = window.localStorage.getItem(keyOf(week));
    } catch (err) { /* storage blocked */ }
    if (raw === null || raw === undefined) raw = memory.get(keyOf(week)) || null;
    if (!raw) return [];
    let arr = null;
    try {
      arr = JSON.parse(raw);
    } catch (err) {
      return [];
    }
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const it of arr) {
      const c = cleanVandalItem(it);
      if (!c || c.week !== week || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }
  function write(week, arr) {
    const raw = JSON.stringify(arr);
    memory.set(keyOf(week), raw);
    try {
      window.localStorage.setItem(keyOf(week), raw);
      // tidy up: earlier weeks and other seasons are never shown again
      const drop = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(VANDAL_PREFIX)) continue;
        const rest = k.slice(VANDAL_PREFIX.length).split('.');
        if (rest[0] !== String(season) || Number(rest[1]) < week - 1) drop.push(k);
      }
      for (const k of drop) window.localStorage.removeItem(k);
    } catch (err) { /* storage full or blocked: memory keeps it for this visit */ }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e && typeof e.key === 'string' && e.key.startsWith(VANDAL_PREFIX)) events.emit('change', {});
    });
  }
  return {
    shared: false,
    setSeason(s) {
      const next = String(s === undefined || s === null || s === '' ? 'x' : s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || 'x';
      if (next === season) return;
      season = next;
      events.emit('change', {});
    },
    list(week) {
      const w = Number(week);
      if (!Number.isInteger(w) || w < 1) return [];
      return read(w).sort((a, b) => a.at - b.at);
    },
    add(item) {
      const c = cleanVandalItem(item);
      if (!c) return Promise.resolve(false);
      const arr = read(c.week);
      if (!arr.some((x) => x.id === c.id)) {
        arr.push(c);
        if (arr.length > VANDAL_MAX) arr.splice(0, arr.length - VANDAL_MAX);
        write(c.week, arr);
      }
      events.emit('change', { week: c.week });
      return Promise.resolve(true);
    },
    on: events.on.bind(events),
    off: events.off.bind(events),
  };
}

export function createNet() {
  const events = emitter();
  const peers = new Map();
  let last = null;
  let lastScore = null;
  return {
    kind: 'noop',
    connected: false,
    peers,
    connect() {
      events.emit('status', 'offline');
      return Promise.resolve(false);
    },
    disconnect() {},
    sendState(state) {
      last = state;
    },
    // Mini game scores, for a shared leaderboard later: submitScore('kick', { yards, teamId }).
    // Resolves false while there is no backend. Never throws.
    submitScore(game, score) {
      lastScore = { game, score };
      return Promise.resolve(false);
    },
    get lastScore() { return lastScore; },
    on: events.on.bind(events),
    off: events.off.bind(events),
    get lastSent() { return last; },
    vandalism: createLocalVandalism(),
  };
}
