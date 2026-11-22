// Shared helpers for the Cloud Nine game modes (Contract 5).
//
// Safe readers for untrusted input, arena geometry in the Contract 1 shapes (rotated rectangles),
// settings, team balancing, clock text and the bot steering kit. Everything here is pure: no
// three.js, no DOM, no clock and no Math.random. Randomness is always an injected rng.
//
//   frame(x, z, facing), toLocal(f, x, z), toWorld(f, lx, lz)   local axes follow three.js rotation.y
//   rectArea(x, z, w, d, facing), boundsArea({ x0, z0, x1, z1 })  -> area { f, hw, hd }
//   inArea(a, x, z, margin), clampArea(a, x, z, margin), randomIn(a, rng, margin), inwardPush(a, x, z, band)
//   cleanId(v), cleanName(v), cleanPoint(p), cleanSettings(schema, raw), normalizePlayers(raw)
//   balanceTeams(order, players, rng), pickRotation(ids, players, count, rng)
//   toward(...), away(...), navigate(mem, pos, goal, speed, dt, rng), separate(...), BOT_LEVELS

import { clamp } from '../core/util.js';

export { clamp };

// ---------- timing (milliseconds) and shared distances (meters) ----------

export const COUNT_MS = 750; // one count of "5, 6, 7, 8!"
export const COUNTDOWN_MS = COUNT_MS * 4;
export const RESULTS_MS = 8000; // everybody celebrates
export const BREAK_MS = 12000; // the lobby between rounds; then the next round starts by itself
export const LAG = 1.5; // slack when the host checks a distance a device claimed (positions lag)
export const MAX_PLAYERS = 10;

// ---------- safe readers ----------

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function own(obj, key) {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function num(v, fallback = 0) {
  return isNum(v) ? v : fallback;
}

/** Two decimals: keeps the shared state small and the same after a JSON round trip. */
export function r2(v) {
  return Math.round(num(v) * 100) / 100;
}

const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf']);

/** A player or ball id from anywhere (network included): short, plain characters, never a prototype key. */
export function cleanId(v) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string' || v.length < 1 || v.length > 64) return null;
  if (!/^[A-Za-z0-9_\-:.]+$/.test(v) || RESERVED.has(v)) return null;
  return v;
}

/** A nickname for display: letters, digits and spaces, at most 16 characters. */
export function cleanName(v) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 16).join('').trim();
}

/** { x, z } with finite, sane coordinates, or null. */
export function cleanPoint(p) {
  if (!isObj(p) || !isNum(p.x) || !isNum(p.z)) return null;
  if (Math.abs(p.x) > 1e5 || Math.abs(p.z) > 1e5) return null;
  return { x: p.x, z: p.z };
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ---------- arena geometry ----------
// A frame is a centre and a facing (radians around +Y, three.js rotation.y). Local +Z is the
// arena's "long" axis; at facing 0 local and world axes are the same.

export function frame(x, z, facing) {
  const f = num(facing);
  return { x: num(x), z: num(z), facing: f, c: Math.cos(f), s: Math.sin(f) };
}

export function toLocal(f, x, z) {
  const dx = x - f.x;
  const dz = z - f.z;
  return { x: dx * f.c - dz * f.s, z: dx * f.s + dz * f.c };
}

export function toWorld(f, lx, lz) {
  return { x: f.x + lx * f.c + lz * f.s, z: f.z - lx * f.s + lz * f.c };
}

/** Rotate a local direction into world space (no translation). */
export function dirToWorld(f, lx, lz) {
  return { x: lx * f.c + lz * f.s, z: -lx * f.s + lz * f.c };
}

/** World heading (radians, 0 faces +Z) of a local direction. */
export function headingOf(x, z) {
  return Math.atan2(x, z);
}

/** A rotated rectangle: w across (local x), d long (local z). Sizes are clamped to something playable. */
export function rectArea(x, z, w, d, facing) {
  return { f: frame(x, z, facing), hw: clamp(num(w, 20), 4, 400) / 2, hd: clamp(num(d, 20), 4, 400) / 2 };
}

/** Axis-aligned { x0, z0, x1, z1 } bounds as an area (either corner order). */
export function boundsArea(b, fallback = { x0: -15, z0: -15, x1: 15, z1: 15 }) {
  const ok = isObj(b) && isNum(b.x0) && isNum(b.z0) && isNum(b.x1) && isNum(b.z1);
  const s = ok ? b : fallback;
  const x0 = Math.min(s.x0, s.x1);
  const x1 = Math.max(s.x0, s.x1);
  const z0 = Math.min(s.z0, s.z1);
  const z1 = Math.max(s.z0, s.z1);
  return rectArea((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0);
}

export function inArea(a, x, z, margin = 0) {
  const l = toLocal(a.f, x, z);
  return Math.abs(l.x) <= a.hw - margin && Math.abs(l.z) <= a.hd - margin;
}

export function clampArea(a, x, z, margin = 0) {
  const l = toLocal(a.f, x, z);
  const mx = Math.max(0, a.hw - margin);
  const mz = Math.max(0, a.hd - margin);
  return toWorld(a.f, clamp(l.x, -mx, mx), clamp(l.z, -mz, mz));
}

export function randomIn(a, rng, margin = 0) {
  const mx = Math.max(0, a.hw - margin);
  const mz = Math.max(0, a.hd - margin);
  return toWorld(a.f, (rng() * 2 - 1) * mx, (rng() * 2 - 1) * mz);
}

/** A world vector pointing back inside, 0 in the middle and up to 1 within `band` of an edge. */
export function inwardPush(a, x, z, band = 3) {
  const l = toLocal(a.f, x, z);
  let px = 0;
  let pz = 0;
  const ex = a.hw - Math.abs(l.x);
  const ez = a.hd - Math.abs(l.z);
  if (ex < band) px = -Math.sign(l.x) * (1 - Math.max(0, ex) / band);
  if (ez < band) pz = -Math.sign(l.z) * (1 - Math.max(0, ez) / band);
  return dirToWorld(a.f, px, pz);
}

// ---------- settings ----------
// A schema entry: { id, label, options: [...], default, labels? }. Numbers snap to the nearest option.

export function cleanSettings(schema, raw) {
  const out = {};
  for (const s of schema) {
    const v = own(raw, s.id) ? raw[s.id] : undefined;
    if (s.options.includes(v)) out[s.id] = v;
    else if (isNum(v) && s.options.some(isNum)) {
      let best = s.default;
      let bestD = Infinity;
      for (const o of s.options) {
        if (!isNum(o)) continue;
        const d = Math.abs(o - v);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      out[s.id] = best;
    } else out[s.id] = s.default;
  }
  return out;
}

// Bot skill. Speeds are m/s (a running kid in League World does about 7.8).
export const BOT_LEVELS = {
  easy: { speed: 4.7, react: 0.6, aim: 0.34, see: 0.75, catchP: 0.12, dodgeP: 0.4, lead: 0.15, nerve: 0.15, moves: 0 },
  normal: { speed: 5.7, react: 0.38, aim: 0.2, see: 1, catchP: 0.28, dodgeP: 0.65, lead: 0.55, nerve: 0.4, moves: 0 },
  hard: { speed: 6.6, react: 0.24, aim: 0.11, see: 1.25, catchP: 0.45, dodgeP: 0.85, lead: 0.9, nerve: 0.65, moves: 1 },
};

export const BOT_SETTING = {
  id: 'botLevel',
  label: 'Bot skill',
  options: ['easy', 'normal', 'hard'],
  labels: { easy: 'Easy', normal: 'Normal', hard: 'Tricky' },
  default: 'normal',
};

// ---------- players ----------

/** Accepts ids, { id, nick, bot } objects, a Map (net.players) or an object keyed by id. */
export function normalizePlayers(raw) {
  let list = [];
  if (raw instanceof Map) list = [...raw.values()];
  else if (Array.isArray(raw)) list = raw;
  else if (isObj(raw)) list = Object.keys(raw).map((k) => (isObj(raw[k]) ? { id: k, ...raw[k] } : k));
  const out = [];
  const seen = new Set();
  for (const p of list) {
    const id = cleanId(isObj(p) ? p.id : p);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, nick: isObj(p) ? cleanName(p.nick) : '', bot: isObj(p) && p.bot === true });
    if (out.length >= MAX_PLAYERS) break;
  }
  return out;
}

/**
 * Teams for a round. Keeps fair existing teams; newcomers go to the smaller side (humans spread
 * first); if the sizes still differ by more than one, bots move first, then the latest joiner.
 */
export function balanceTeams(order, players, rng) {
  const team = {};
  const size = [0, 0];
  const humans = [0, 0];
  const add = (id, t) => {
    team[id] = t;
    size[t]++;
    if (!players[id].bot) humans[t]++;
  };
  for (const id of order) {
    const t = players[id].team;
    if (t === 0 || t === 1) add(id, t);
  }
  const fresh = order.filter((id) => team[id] === undefined);
  fresh.sort((a, b) => (players[a].bot ? 1 : 0) - (players[b].bot ? 1 : 0));
  for (const id of fresh) {
    let t;
    if (size[0] !== size[1]) t = size[0] < size[1] ? 0 : 1;
    else if (!players[id].bot && humans[0] !== humans[1]) t = humans[0] < humans[1] ? 0 : 1;
    else t = rng() < 0.5 ? 0 : 1;
    add(id, t);
  }
  let guard = 0;
  while (Math.abs(size[0] - size[1]) > 1 && guard++ < 20) {
    const big = size[0] > size[1] ? 0 : 1;
    const members = order.filter((id) => team[id] === big);
    const bots = members.filter((id) => players[id].bot);
    const mover = bots.length ? bots[bots.length - 1] : members[members.length - 1];
    team[mover] = 1 - big;
    size[big]--;
    size[1 - big]++;
    if (!players[mover].bot) {
      humans[big]--;
      humans[1 - big]++;
    }
  }
  // Humans spread too: swap a human from the side with more humans for a bot on the other side.
  guard = 0;
  while (Math.abs(humans[0] - humans[1]) > 1 && guard++ < 20) {
    const big = humans[0] > humans[1] ? 0 : 1;
    const human = order.filter((id) => team[id] === big && !players[id].bot).pop();
    const bot = order.filter((id) => team[id] === 1 - big && players[id].bot).pop();
    if (!human || !bot) break;
    team[human] = 1 - big;
    team[bot] = big;
    humans[big]--;
    humans[1 - big]++;
  }
  return team;
}

/** The next `count` players for a rotating role (seeker, "it"): fewest turns first, random among ties. */
export function pickRotation(ids, players, count, rng) {
  const keyed = ids.map((id) => ({ id, turns: num(players[id].turns), tie: rng() }));
  keyed.sort((a, b) => a.turns - b.turns || a.tie - b.tie);
  return keyed.slice(0, Math.max(0, count)).map((k) => k.id);
}

// ---------- text ----------

/** Seconds left as "1:05" (or "0:09"). */
export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(num(sec)));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function listNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function plural(n, word, many) {
  return `${n} ${n === 1 ? word : many || `${word}s`}`;
}

// ---------- bot steering kit ----------
// Velocities are in m/s, world space. A bot's memory object (`mem`) lives on the host only.

export function toward(px, pz, tx, tz, speed, slowR = 0.6) {
  const dx = tx - px;
  const dz = tz - pz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return { x: 0, z: 0 };
  const s = d < slowR ? (speed * d) / slowR : speed;
  return { x: (dx / d) * s, z: (dz / d) * s };
}

export function away(px, pz, tx, tz, speed) {
  const dx = px - tx;
  const dz = pz - tz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return { x: speed, z: 0 };
  return { x: (dx / d) * speed, z: (dz / d) * speed };
}

export function setLen(v, len) {
  const d = Math.hypot(v.x, v.z);
  if (d < 1e-6) return { x: 0, z: 0 };
  return { x: (v.x / d) * len, z: (v.z / d) * len };
}

export function capLen(v, max) {
  const d = Math.hypot(v.x, v.z);
  return d > max ? { x: (v.x / d) * max, z: (v.z / d) * max } : v;
}

/** Push away from anyone closer than `radius` (so bots don't stack up). */
export function separate(pos, others, radius) {
  let x = 0;
  let z = 0;
  for (const o of others) {
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= radius || d < 1e-4) continue;
    const k = (1 - d / radius) / d;
    x += dx * k;
    z += dz * k;
  }
  return { x, z };
}

/**
 * Walk toward a goal, noticing when something solid (a hedge, a tent) is in the way: the bot
 * then sidesteps for a moment, like a kid going around a bush. Returns a velocity.
 */
export function navigate(mem, pos, goal, speed, dt, rng, slowR = 0.6) {
  const nav = mem.nav || (mem.nav = { t: 0, x: pos.x, z: pos.z, want: 0, dx: 0, dz: 0, left: 0 });
  if (nav.left > 0) {
    nav.left -= dt;
    nav.x = pos.x;
    nav.z = pos.z;
    nav.t = 0;
    nav.want = 0;
    return { x: nav.dx * speed, z: nav.dz * speed };
  }
  const v = toward(pos.x, pos.z, goal.x, goal.z, speed, slowR);
  const sp = Math.hypot(v.x, v.z);
  nav.t += dt;
  nav.want += sp * dt;
  if (nav.t >= 0.7) {
    const moved = Math.hypot(pos.x - nav.x, pos.z - nav.z);
    if (nav.want > 1.5 && moved < nav.want * 0.25 && sp > 0.5) {
      const side = rng() < 0.5 ? 1 : -1;
      const ux = v.x / sp;
      const uz = v.z / sp;
      const d = setLen({ x: -uz * side - ux * 0.35, z: ux * side - uz * 0.35 }, 1);
      nav.dx = d.x;
      nav.dz = d.z;
      nav.left = 0.45 + rng() * 0.5;
    }
    nav.t = 0;
    nav.want = 0;
    nav.x = pos.x;
    nav.z = pos.z;
  }
  return v;
}

/**
 * The best way to run from `threats` ([{ x, z }]): tries 16 directions, prefers getting away from
 * the closest threats, keeps clear of the edges (no getting pinned in a corner) and keeps going
 * the same way when it can. `noise` makes easier bots less clever. Returns a unit vector.
 */
export function escapeDir(pos, threats, area, prev, rng, noise = 0.5) {
  let best = { x: 0, z: 1 };
  let bestScore = -Infinity;
  const jitter = rng() * 0.39;
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2 + jitter;
    const dx = Math.sin(ang);
    const dz = Math.cos(ang);
    const px = pos.x + dx * 3;
    const pz = pos.z + dz * 3;
    let score = 0;
    for (const t of threats) {
      const d0 = Math.hypot(pos.x - t.x, pos.z - t.z);
      const d1 = Math.hypot(px - t.x, pz - t.z);
      score += ((d1 - d0) / Math.max(1, d0)) * 3;
    }
    // look ahead twice: walls close by and walls a few steps on (corners are traps)
    const l = toLocal(area.f, px, pz);
    const edge = Math.min(area.hw - Math.abs(l.x), area.hd - Math.abs(l.z));
    if (edge < 0) score -= 6 - edge * 2;
    else if (edge < 4) score -= (4 - edge) * 1.4;
    const far = toLocal(area.f, pos.x + dx * 6, pos.z + dz * 6);
    const edge2 = Math.min(area.hw - Math.abs(far.x), area.hd - Math.abs(far.z));
    if (edge2 < 0) score -= 2 - edge2 * 0.5;
    else if (edge2 < 2) score -= (2 - edge2) * 0.8;
    if (prev) score += (dx * prev.x + dz * prev.z) * 0.8;
    score += rng() * noise;
    if (score > bestScore) {
      bestScore = score;
      best = { x: dx, z: dz };
    }
  }
  return best;
}

/** A gentle random drift that changes direction now and then. */
export function wander(mem, pos, area, speed, dt, rng, margin = 2) {
  if (!mem.wander || mem.wander.left <= 0 || dist(pos, mem.wander) < 1) {
    const p = randomIn(area, rng, margin);
    mem.wander = { x: p.x, z: p.z, left: 2 + rng() * 3 };
  }
  mem.wander.left -= dt;
  return navigate(mem, pos, mem.wander, speed, dt, rng);
}
