// What this device remembers between visits, plus a tiny shared-state emitter (as in League World).
// The cheerleader's look, her nickname, sound, graphics quality and progress all live in
// localStorage, always behind try/catch: a private window or blocked storage just means nothing is
// remembered, and an in-memory copy keeps the current visit working. No DOM, no three.js, so it
// runs under node --test with a fake storage.
//
//   const store = createStore({ storage?, search?, cleanLook?, cleanNick? })
//   store.look                     -> a look object, or null when none was saved (validated)
//   store.setLook(look)            -> the saved look (validated) or null; emits 'look'
//   store.nick / store.setNick(n)  the nickname, validated; emits 'nick'
//   store.sound                    true | false | null (null: never chosen)
//   store.setSound(on)             emits 'sound'
//   store.quality                  'auto' | 'low' | 'high'  (?quality= wins over the saved one)
//   store.setQuality(q)            remembered; emits 'quality'
//   store.progress                 a small plain object (copy); toss bests, unlocked things, ...
//   store.patchProgress(partial)   shallow merge, saved; emits 'progress'. Refused when too big
//   store.setCleaners({ cleanLook, cleanNick })   swap in the real validators once they load
//   store.get(key) / set(key, v) / on(key, fn) -> off / off(key, fn) / emit(name, payload)
//   store.params                   URLSearchParams of the page (?solo=1, ?room=, ?debug=1, ...)
//   store.flag(name)               true when ?name=1 (or ?name with no value)

import { STORAGE_KEYS } from '../config.js';
import { emitter } from './util.js';

export const PROGRESS_MAX_BYTES = 32768;
const QUALITIES = ['auto', 'low', 'high'];

// The browser's localStorage, or null (node, blocked, sandboxed iframe).
function defaultStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (err) {
    return null;
  }
}

// Before the content module's cleanNick loads: letters and spaces, tidy spacing. Typed names are
// capped at TYPED_NICK_MAX where they are typed; generated ones ("Sparkle Comet") run a bit longer.
export const TYPED_NICK_MAX = 12;
export const NICK_MAX = 20;
export function basicCleanNick(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || s.length > NICK_MAX || !/^[A-Za-z ]+$/.test(s)) return null;
  return s;
}

// Before the character module's cleanLook loads: a flat object of short preset ids, nothing else.
export function basicCleanLook(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/.test(k)) continue;
    const v = raw[k];
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(v)) continue;
    out[k] = v;
    if (++n >= 16) break;
  }
  return n ? out : null;
}

export function parseSound(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  return null;
}

// A JSON-safe copy of a plain object, or null when it is not one (or is too big to keep).
export function cleanProgress(raw, maxBytes = PROGRESS_MAX_BYTES) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let text;
  try {
    text = JSON.stringify(raw);
  } catch (err) {
    return null;
  }
  if (typeof text !== 'string' || text.length > maxBytes) return null;
  try {
    const copy = JSON.parse(text);
    return copy && typeof copy === 'object' && !Array.isArray(copy) ? copy : null;
  } catch (err) {
    return null;
  }
}

export function createStore(opts = {}) {
  const events = emitter();
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  const memory = new Map(); // what we could not (or did not yet) write to storage
  let cleanLook = typeof opts.cleanLook === 'function' ? opts.cleanLook : basicCleanLook;
  let cleanNick = typeof opts.cleanNick === 'function' ? opts.cleanNick : basicCleanNick;

  let params;
  try {
    const search = opts.search !== undefined ? opts.search : typeof window !== 'undefined' && window.location ? window.location.search : '';
    params = new URLSearchParams(search || '');
  } catch (err) {
    params = new URLSearchParams('');
  }

  function read(key) {
    if (storage) {
      try {
        const v = storage.getItem(key);
        if (v !== null && v !== undefined) return String(v);
      } catch (err) { /* blocked: fall through to memory */ }
    }
    return memory.has(key) ? memory.get(key) : null;
  }
  function write(key, value) {
    if (value === null || value === undefined) memory.delete(key);
    else memory.set(key, String(value));
    if (!storage) return false;
    try {
      if (value === null || value === undefined) storage.removeItem(key);
      else storage.setItem(key, String(value));
      return true;
    } catch (err) {
      return false; // full or blocked: memory keeps it for this visit
    }
  }
  function readJson(key) {
    const raw = read(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }
  function safeClean(fn, value) {
    try {
      return fn(value);
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------- shared state (League World style)
  const state = new Map();
  function get(key) {
    return state.get(key);
  }
  function set(key, value) {
    const prev = state.get(key);
    if (prev === value) return value;
    state.set(key, value);
    events.emit(key, value, prev);
    events.emit('change', key, value);
    return value;
  }

  const store = {
    get,
    set,
    on: events.on.bind(events),
    off: events.off.bind(events),
    emit(name, payload) {
      events.emit(name, payload);
    },
    params,
    flag(name) {
      if (!params.has(name)) return false;
      const v = params.get(name);
      return v === '' || v === '1' || v === 'true' || v === 'yes';
    },
    setCleaners(c = {}) {
      if (typeof c.cleanLook === 'function') cleanLook = c.cleanLook;
      if (typeof c.cleanNick === 'function') cleanNick = c.cleanNick;
    },

    // ---------------------------------------------------------------- look
    get look() {
      const raw = readJson(STORAGE_KEYS.look);
      return raw ? safeClean(cleanLook, raw) : null;
    },
    setLook(look) {
      const clean = look ? safeClean(cleanLook, look) : null;
      if (!clean) return null;
      write(STORAGE_KEYS.look, JSON.stringify(clean));
      events.emit('look', clean);
      return clean;
    },

    // ---------------------------------------------------------------- nickname
    get nick() {
      const raw = read(STORAGE_KEYS.nick);
      return raw ? safeClean(cleanNick, raw) : null;
    },
    setNick(nick) {
      const clean = safeClean(cleanNick, nick);
      if (!clean) return null;
      write(STORAGE_KEYS.nick, clean);
      events.emit('nick', clean);
      return clean;
    },

    // ---------------------------------------------------------------- sound ('1' / '0', as in League World)
    get sound() {
      return parseSound(read(STORAGE_KEYS.sound));
    },
    setSound(on) {
      write(STORAGE_KEYS.sound, on ? '1' : '0');
      events.emit('sound', !!on);
      return !!on;
    },

    // ---------------------------------------------------------------- graphics quality
    get quality() {
      const fromUrl = params.get('quality');
      if (QUALITIES.includes(fromUrl)) return fromUrl;
      const saved = read(STORAGE_KEYS.quality);
      return QUALITIES.includes(saved) ? saved : 'auto';
    },
    setQuality(q) {
      const v = QUALITIES.includes(q) ? q : 'auto';
      write(STORAGE_KEYS.quality, v === 'auto' ? null : v);
      events.emit('quality', v);
      return v;
    },

    // ---------------------------------------------------------------- progress
    get progress() {
      return cleanProgress(readJson(STORAGE_KEYS.progress)) || {};
    },
    patchProgress(partial) {
      const add = cleanProgress(partial);
      if (!add) return null;
      const next = cleanProgress(Object.assign(store.progress, add));
      if (!next) return null; // would grow past the cap: keep what we had
      write(STORAGE_KEYS.progress, JSON.stringify(next));
      events.emit('progress', next);
      return next;
    },

    // For tests and the console: everything this store would write, by key.
    dump() {
      const out = {};
      for (const k of Object.values(STORAGE_KEYS)) {
        const v = read(k);
        if (v !== null) out[k] = v;
      }
      return out;
    },
  };
  return store;
}
