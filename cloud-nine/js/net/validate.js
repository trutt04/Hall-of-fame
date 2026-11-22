// Checks for everything that crosses the network. Everything from another device is untrusted:
// shapes are checked, numbers clamped, lengths capped and unknown things dropped. League World's
// cleanVandalItem (world/js/core/net.js) is the model. Pure: no DOM, runs under node --test.
//
//   isId(v)                          player, bot and event ids: [A-Za-z0-9_-], 1..64
//   cleanState(raw)                  -> { x, y, z, h, anim, t? } | null   positions clamped to +-500 m,
//                                       heading wrapped to (-PI, PI], unknown anims become 'idle'
//   toWireState(state, t)            -> { x, y, z, h, a, t }   what goes into state/{id} (rounded)
//   shapeNick(raw), isWireNick(s)    local nickname checks; cleanNickWith(raw, cleanNick, { strict })
//                                    adds the content module's cleanNick when it is there
//   fallbackNick(id, randomNick)     the name a player gets when theirs doesn't pass (the same on every device)
//   cleanEmoteData(data, cleanEmote) -> data with a checked emote id, or INVALID
//   shapeLook(raw), cleanLookWith(raw, cleanLook), encodeLook(look), decodeLook(json, cleanLook)
//   encodeData(value, limits) -> json | null      decodeData(json, limits) -> value | INVALID
//   cleanMeta(raw), cleanPlayerEntry(id, raw, helpers), cleanEventRecord(raw), cleanGameRecord(raw)
//   createLimiter({ capacity, perSecond, now })   token buckets per sender: allow(key) -> boolean
//
// Wire shapes (Firebase paths under rooms/{code}/, the same in the local transport):
//   meta            { hostId, createdAt, beat, v: 1 }       createdAt and beat are server times (ms)
//   players/{id}    { nick, look /* JSON text */, bot, joinedAt /* server time */, owner? /* bots */ }
//   state/{id}      { x, y, z, h, a /* anim */, t /* sender's shared clock */ }
//   events/{key}    { from, type, data /* JSON text <= 1 KB */, t /* server time */ }
//   game            { by, json /* JSON text <= 16000 */, t }

import { mulberry32 } from '../core/util.js';

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const ANIM_RE = /^[a-zA-Z]{1,16}$/;
export const EVENT_TYPES = Object.freeze(['emote', 'claim', 'fx', 'game-start', 'game-end']);
export const HOST_ONLY_EVENTS = Object.freeze(['game-start', 'game-end']);
export const LIMITS = Object.freeze({
  pos: 500, // meters from the origin, each axis
  heading: 10, // radians on the wire (we always send (-PI, PI])
  nick: 24, // typed names are 12 at most; generated ones can be a little longer
  lookJson: 600,
  eventJson: 1024,
  gameJson: 16000,
});
export const EVENT_LIMITS = Object.freeze({ maxLen: LIMITS.eventJson, maxStr: 80, maxArr: 64, maxKeys: 32, maxDepth: 6 });
export const GAME_LIMITS = Object.freeze({ maxLen: LIMITS.gameJson, maxStr: 200, maxArr: 256, maxKeys: 128, maxDepth: 8 });
export const FALLBACK_NICK = 'Cloud Friend';
export const INVALID = Symbol('invalid');

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DATA_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WIRE_NICK_RE = /^[A-Za-z0-9 -]+$/;
const LOOK_KEY_RE = /^[a-zA-Z]{1,16}$/;
const LOOK_STR_RE = /^[A-Za-z0-9_#.-]{1,32}$/;
const TAU = Math.PI * 2;

export function isId(v) {
  return typeof v === 'string' && ID_RE.test(v) && !FORBIDDEN_KEYS.has(v);
}

export function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

export function wrapAngle(h) {
  let a = h % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

function clampNum(v, lim) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v < -lim ? -lim : v > lim ? lim : v;
}

// A time in ms since 1970 (server or shared clock). Anything else is null.
export function cleanTime(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e14 ? v : null;
}

// ---- state -------------------------------------------------------------------------------------

// Accepts the API shape { x, y, z, h, anim } and the wire shape { x, y, z, h, a, t }.
export function cleanState(raw) {
  if (!isPlainObject(raw)) return null;
  const x = clampNum(raw.x, LIMITS.pos);
  const y = clampNum(raw.y, LIMITS.pos);
  const z = clampNum(raw.z, LIMITS.pos);
  if (x === null || y === null || z === null) return null;
  const h0 = raw.h === undefined ? 0 : raw.h;
  if (typeof h0 !== 'number' || !Number.isFinite(h0) || Math.abs(h0) > 1e6) return null;
  const a = raw.anim !== undefined ? raw.anim : raw.a;
  const out = { x, y, z, h: wrapAngle(h0), anim: typeof a === 'string' && ANIM_RE.test(a) ? a : 'idle' };
  if (raw.t !== undefined) {
    const t = cleanTime(raw.t);
    if (t !== null) out.t = t;
  }
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function toWireState(s, t) {
  return { x: r2(s.x) || 0, y: r2(s.y) || 0, z: r2(s.z) || 0, h: r3(wrapAngle(s.h)) || 0, a: s.anim, t: Math.round(t) };
}

// ---- nicknames ---------------------------------------------------------------------------------

export function isWireNick(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= LIMITS.nick && WIRE_NICK_RE.test(s) && /[A-Za-z]/.test(s);
}

// Local clean-up: accents dropped (Zoë -> Zoe), anything but letters, digits, spaces and dashes
// removed, spaces collapsed, length capped. null when nothing usable is left.
export function shapeNick(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.slice(0, 64);
  try {
    s = s.normalize('NFKD');
  } catch (err) { /* very old engines */ }
  s = s.replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > LIMITS.nick) s = s.slice(0, LIMITS.nick).trim();
  return isWireNick(s) ? s : null;
}

// strict: the string must already be in wire form (incoming). Otherwise it is shaped (outgoing).
// cleanNick is the content module's checker (string | null); when it throws, the local check stands.
export function cleanNickWith(raw, cleanNick, { strict = false } = {}) {
  const s = strict ? (isWireNick(raw) ? raw : null) : shapeNick(raw);
  if (!s) return null;
  if (typeof cleanNick !== 'function') return s;
  let r;
  try {
    r = cleanNick(s);
  } catch (err) {
    return s;
  }
  if (typeof r !== 'string') return null;
  return shapeNick(r);
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// The content module's random nickname, seeded by the player's id so every device shows the same
// one for that player. FALLBACK_NICK when the module is not there.
export function fallbackNick(id, randomNick) {
  if (typeof randomNick === 'function') {
    try {
      const n = shapeNick(String(randomNick(mulberry32(hashString(String(id || ''))))));
      if (n) return n;
    } catch (err) { /* fall through */ }
  }
  return FALLBACK_NICK;
}

// ---- emotes ------------------------------------------------------------------------------------

const EMOTE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

// Emote data is { id, ... } (or just the id). With the content module's cleanEmote(id) -> emote | null,
// only preset emotes pass and the id comes back in its canonical form; without it, any id-like string.
export function cleanEmoteData(data, cleanEmote) {
  const id = typeof data === 'string' ? data : isPlainObject(data) ? data.id : null;
  if (typeof id !== 'string' || !EMOTE_ID_RE.test(id)) return INVALID;
  if (typeof cleanEmote !== 'function') return data;
  let e;
  try {
    e = cleanEmote(id);
  } catch (err) {
    return INVALID;
  }
  const canon = e && typeof e === 'object' ? e.id : typeof e === 'string' ? e : null;
  if (typeof canon !== 'string' || !EMOTE_ID_RE.test(canon)) return INVALID;
  return typeof data === 'string' ? canon : { ...data, id: canon };
}

// ---- looks -------------------------------------------------------------------------------------

// The local shape check used when the character module is not there: a flat object of preset ids.
export function shapeLook(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (n >= 16) break;
    if (!LOOK_KEY_RE.test(k) || FORBIDDEN_KEYS.has(k)) continue;
    const v = raw[k];
    if (typeof v === 'string' && LOOK_STR_RE.test(v)) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else continue;
    n++;
  }
  return out;
}

export function cleanLookWith(raw, cleanLook) {
  if (typeof cleanLook === 'function') {
    try {
      const r = cleanLook(raw);
      if (isPlainObject(r)) {
        const json = JSON.stringify(r);
        if (json.length <= LIMITS.lookJson) return JSON.parse(json);
        const s = shapeLook(r);
        if (s) return s;
      }
    } catch (err) { /* fall through to the local check */ }
  }
  return shapeLook(raw) || {};
}

export function encodeLook(look) {
  let json = '{}';
  try {
    json = JSON.stringify(isPlainObject(look) ? look : {});
    if (json.length > LIMITS.lookJson) json = JSON.stringify(shapeLook(look) || {});
  } catch (err) {
    json = '{}';
  }
  return json.length <= LIMITS.lookJson ? json : '{}';
}

export function decodeLook(json, cleanLook) {
  let raw = null;
  if (typeof json === 'string' && json.length <= LIMITS.lookJson) {
    try {
      raw = JSON.parse(json);
    } catch (err) {
      raw = null;
    }
  }
  return cleanLookWith(raw, cleanLook);
}

// ---- small JSON payloads (event data, game state) ----------------------------------------------

export function cleanData(v, lim, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= 1e9 ? v : INVALID;
  if (typeof v === 'string') return v.length <= lim.maxStr ? v : INVALID;
  if (depth >= lim.maxDepth) return INVALID;
  if (Array.isArray(v)) {
    if (v.length > lim.maxArr) return INVALID;
    const out = [];
    for (const x of v) {
      const c = cleanData(x, lim, depth + 1);
      if (c === INVALID) return INVALID;
      out.push(c);
    }
    return out;
  }
  if (!isPlainObject(v)) return INVALID;
  const keys = Object.keys(v);
  if (keys.length > lim.maxKeys) return INVALID;
  const out = {};
  for (const k of keys) {
    if (!DATA_KEY_RE.test(k) || FORBIDDEN_KEYS.has(k)) return INVALID;
    const c = cleanData(v[k], lim, depth + 1);
    if (c === INVALID) return INVALID;
    out[k] = c;
  }
  return out;
}

// -> canonical JSON text, or null when the value is not small, plain JSON.
export function encodeData(value, lim) {
  let json;
  try {
    json = JSON.stringify(value === undefined ? null : value);
  } catch (err) {
    return null;
  }
  if (typeof json !== 'string' || json.length > lim.maxLen) return null;
  const c = cleanData(JSON.parse(json), lim);
  return c === INVALID ? null : JSON.stringify(c);
}

export function decodeData(json, lim) {
  if (typeof json !== 'string' || json.length > lim.maxLen) return INVALID;
  let v;
  try {
    v = JSON.parse(json);
  } catch (err) {
    return INVALID;
  }
  return cleanData(v, lim);
}

// ---- records -----------------------------------------------------------------------------------

export function cleanMeta(raw) {
  if (!isPlainObject(raw) || !isId(raw.hostId)) return null;
  const createdAt = cleanTime(raw.createdAt);
  if (createdAt === null) return null;
  const beat = cleanTime(raw.beat);
  return { hostId: raw.hostId, createdAt, beat: beat === null ? createdAt : beat };
}

// helpers: { cleanNick, randomNick, cleanLook } from the content and character modules (any may be missing).
export function cleanPlayerEntry(id, raw, helpers = {}) {
  if (!isId(id) || !isPlainObject(raw)) return null;
  if (raw.bot !== true && raw.bot !== false) return null;
  const joinedAt = cleanTime(raw.joinedAt);
  if (joinedAt === null) return null;
  const bot = raw.bot;
  let owner = null;
  if (bot) {
    if (!isId(raw.owner) || raw.owner === id) return null;
    owner = raw.owner;
  } else if (raw.owner !== undefined && raw.owner !== null) {
    return null;
  }
  const nick = cleanNickWith(raw.nick, helpers.cleanNick, { strict: true }) || fallbackNick(id, helpers.randomNick);
  const look = decodeLook(raw.look, helpers.cleanLook);
  return { id, nick, look, bot, joinedAt, owner };
}

export function cleanEventRecord(raw) {
  if (!isPlainObject(raw) || !isId(raw.from) || !EVENT_TYPES.includes(raw.type)) return null;
  const data = decodeData(raw.data, EVENT_LIMITS);
  if (data === INVALID) return null;
  return { from: raw.from, type: raw.type, data, t: cleanTime(raw.t) || 0 };
}

export function cleanGameRecord(raw) {
  if (!isPlainObject(raw) || !isId(raw.by) || typeof raw.json !== 'string') return null;
  const state = decodeData(raw.json, GAME_LIMITS);
  if (state === INVALID || (state !== null && !isPlainObject(state))) return null;
  return { by: raw.by, json: raw.json, state, t: cleanTime(raw.t) || 0 };
}

// ---- rate limits -------------------------------------------------------------------------------

// Token buckets, one per key (a sender id). Each bucket holds up to `capacity` and refills at
// `perSecond`. The number of buckets is capped so junk ids can't grow memory.
export function createLimiter({ capacity, perSecond, now = () => Date.now(), maxKeys = 256 }) {
  const buckets = new Map();
  return {
    allow(key, cost = 1) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        b = { tokens: capacity, t };
        buckets.set(key, b);
      } else {
        b.tokens = Math.min(capacity, b.tokens + (Math.max(0, t - b.t) / 1000) * perSecond);
        b.t = t;
      }
      if (b.tokens < cost) return false;
      b.tokens -= cost;
      return true;
    },
    forget(key) {
      buckets.delete(key);
    },
    clear() {
      buckets.clear();
    },
  };
}
