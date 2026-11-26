// The photo wall's photos (js/world/photowall.js): real family photos of her, added on this device and
// kept on this device. The repo and the site are public, so a photo never goes into either unlocked (a
// family's pack from the gift link is locked: js/core/photo-pack.js), nor out over the network: nothing here (or in any photo wall module) imports js/net/ or calls fetch,
// XMLHttpRequest, sendBeacon or WebSocket (test/photowall-privacy.test.mjs checks). In a room every
// device shows its own photos, or empty frames; not even a count or a "has photos" flag goes out.
//
// A photo is decoded, made at most 1600 px on its long edge and saved again as a JPEG through a canvas,
// which also drops its EXIF data (GPS included), plus a 640 px copy for the wall and the thumbnails.
// Both are kept as an ArrayBuffer with its type (not a Blob: older Safari lost Blobs in IndexedDB) in
// IndexedDB, database 'c9-photos'. Without IndexedDB (a private window, blocked storage) they live in
// memory until the page closes, and store.persistent says so.
//
// Pure (node --test runs these):
//   PHOTO_LIMITS               { max: 12, fileBytes: 40 MB, long: 1600, small: 640, caption: 32, ... }
//   cleanCaption(raw) -> string                 control and invisible characters out, spaces tidied, 32 at most
//   joinNames(names) -> 'Me, Zuzu & Pip'        the caption the name chips build
//   nameChips({ gift, petName }) -> [{ id, label }]   one-tap names: from the gift link on this device
//                                               (her name, her friends, her pets), else Me, Mom, Dad...
//   fitLongEdge(w, h, max) -> { w, h }          never bigger than it was
//   coverCrop(sw, sh, dw, dh, ax = 0.5, ay = 0.38) -> { sx, sy, sw, sh }   fill a window, faces kept
//                                               (the crop sits a little above the middle)
//   moveIn(order, id, delta) / starIn(order, id) / reconcile(order, ids, max) -> a new order
//   createPhotoStore({ backend, now }) -> store   on any backend (createMemoryBackend() for tests)
//
// The store (both kinds):
//   store.ready -> Promise    store.persistent (false: memory only)    store.count
//   store.list() -> [{ id, caption, w, h, added }] in wall order: the first is the star photo
//   store.add({ full, small, caption }) -> Promise<{ ok, id } | { ok: false, reason: 'full' | 'storage' }>
//       full / small: { buffer: ArrayBuffer, type: 'image/jpeg', w, h }
//   store.bytes(id, 'small' | 'full') -> Promise<{ buffer, type, w, h } | null>
//   store.remove(id) / store.clear() / store.move(id, delta) / store.makeStar(id) / store.setCaption(id, text)
//   store.meta -> { addedAt, viewedAt, nudgedAt }     store.markViewed() / store.markNudged()
//   store.on('change', fn) / store.off('change', fn)  (fn(list) after every change)
//
// Browser only:
//   openPhotoStore({ name = 'c9-photos', timeoutMs }) -> Promise<store>   IndexedDB, else memory
//   processPhoto(file) -> Promise<{ ok: true, full, small } | { ok: false, reason: 'big' | 'decode' | 'empty' }>
//   blobOf(bytes) -> Blob                         for an <img> (the viewer) or createImageBitmap
//   askToPersist() -> Promise<boolean>            navigator.storage.persist(), best effort

import { emitter } from './util.js';

export const PHOTO_DB = 'c9-photos';
export const PHOTO_LIMITS = Object.freeze({
  max: 12, // photos on the wall: the star and eleven more
  fileBytes: 40 * 1024 * 1024, // bigger files are skipped (a 48 MP RAW is not a camera roll photo)
  long: 1600, // the long edge of the copy kept for the viewer
  small: 640, // the long edge of the copy painted on the wall and in the thumbnails
  caption: 32,
  quality: 0.86,
  smallQuality: 0.82,
});

// ------------------------------------------------------------------------------------------ words

const isControl = (cp) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
// Characters that draw nothing or turn text around (zero-width spaces, direction overrides, fillers,
// tags). The zero-width joiner and the emoji variation selector stay: emoji families need them.
function isInvisible(cp) {
  return cp === 0xad || cp === 0x34f || cp === 0x61c || cp === 0x115f || cp === 0x1160 || cp === 0x180e
    || cp === 0x200b || cp === 0x200c || cp === 0x200e || cp === 0x200f || (cp >= 0x2028 && cp <= 0x202e)
    || (cp >= 0x2060 && cp <= 0x206f) || cp === 0x2800 || cp === 0x3164 || cp === 0xfeff || cp === 0xffa0
    || (cp >= 0xfff0 && cp <= 0xfffb) || (cp >= 0xe0000 && cp <= 0xe0fff);
}

export function cleanCaption(raw, max = PHOTO_LIMITS.caption) {
  if (typeof raw !== 'string') return '';
  let text = raw.length > 400 ? raw.slice(0, 400) : raw;
  try {
    text = text.normalize('NFC');
  } catch (err) { /* keep it as it is */ }
  let s = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (/\s/.test(ch)) s += ' ';
    else if (!isControl(cp) && !isInvisible(cp)) s += ch;
  }
  s = s.replace(/ {2,}/g, ' ').trim();
  const chars = Array.from(s);
  if (chars.length > max) s = chars.slice(0, max).join('');
  // a cut can leave half an emoji family behind: no dangling joiner or selector, no trailing space
  return s.replace(/[\u200d\ufe0f\s]+$/, '').trim();
}

export function joinNames(names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim());
  if (list.length <= 1) return list[0] || '';
  return list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
}

const GENERIC_CHIPS = ['Me', 'Mom', 'Dad', 'Family', 'Friends', 'My pet'];
// One-tap names for captions. With the family's gift link on this device: Me, her own name, her
// friends and her pets' names (in the link's order), then Family and Friends. Without it: Me, Mom,
// Dad, Family, Friends and My pet. The names come from the gift link, already checked there (letters,
// spaces and . ' -, 16 at most, the word filter); they are checked again here and never repeated.
export function nameChips({ gift = null, petName = null } = {}) {
  const out = [];
  const seen = new Set();
  const add = (label) => {
    const clean = cleanCaption(typeof label === 'string' ? label : '', 16);
    if (!clean || !/^[\p{L}][\p{L} .'-]*$/u.test(clean)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: 'n' + out.length, label: clean });
  };
  const g = gift && typeof gift === 'object' ? gift : null;
  if (!g) {
    for (const n of GENERIC_CHIPS) add(n);
    return out;
  }
  add('Me');
  if (typeof g.to === 'string') add(g.to);
  if (Array.isArray(g.friends)) for (const n of g.friends.slice(0, 9)) add(n);
  for (const id of ['husky', 'cloudPuppy']) {
    let n = null;
    try {
      n = typeof petName === 'function' ? petName(id, g) : g.petNames && g.petNames[id];
    } catch (err) {
      n = null;
    }
    if (n) add(n);
  }
  add('Family');
  add('Friends');
  return out;
}

// ------------------------------------------------------------------------------------------ sizes

export function fitLongEdge(w, h, max) {
  const W = Math.max(1, Math.round(Number(w) || 1));
  const H = Math.max(1, Math.round(Number(h) || 1));
  const k = Math.min(1, max / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

// The part of a sw x sh picture that fills a dw x dh window ("cover"), never outside the picture.
// Faces sit in the upper part of most photos, so the crop sits a little above the middle (ay 0.38).
export function coverCrop(sw, sh, dw, dh, ax = 0.5, ay = 0.38) {
  const SW = Math.max(1, Number(sw) || 1);
  const SH = Math.max(1, Number(sh) || 1);
  const k = Math.max(dw / SW, dh / SH);
  const cw = Math.min(SW, dw / k);
  const ch = Math.min(SH, dh / k);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return { sx: (SW - cw) * clamp01(ax), sy: (SH - ch) * clamp01(ay), sw: cw, sh: ch };
}

// ------------------------------------------------------------------------------------------ order

// The wall's order: the first photo is the star (the big one in the middle), the rest fill the frames
// round it. These return a new array.
export function moveIn(order, id, delta) {
  const out = order.slice();
  const i = out.indexOf(id);
  if (i < 0 || !Number.isInteger(delta) || !delta) return out;
  const j = Math.max(0, Math.min(out.length - 1, i + delta));
  out.splice(i, 1);
  out.splice(j, 0, id);
  return out;
}
export function starIn(order, id) {
  return order.includes(id) ? [id, ...order.filter((x) => x !== id)] : order.slice();
}
// Every id in `ids` exactly once: the known order first, then any it missed (oldest first), `max` at most.
export function reconcile(order, ids, max = PHOTO_LIMITS.max) {
  const have = new Set(ids);
  const out = [];
  for (const id of Array.isArray(order) ? order : []) if (typeof id === 'string' && have.has(id) && !out.includes(id)) out.push(id);
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out.slice(0, max);
}

// ------------------------------------------------------------------------------------------ the store

const cleanMeta = (m) => {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return { addedAt: n(m && m.addedAt), viewedAt: n(m && m.viewedAt), nudgedAt: n(m && m.nudgedAt) };
};
const cleanBytes = (b) => (b && b.buffer instanceof ArrayBuffer && b.buffer.byteLength > 0 && typeof b.type === 'string' && /^image\/[a-z0-9.+-]+$/.test(b.type)
  ? { buffer: b.buffer, type: b.type, w: Math.max(1, Math.round(Number(b.w) || 1)), h: Math.max(1, Math.round(Number(b.h) || 1)) } : null);
function cleanRecord(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^p[a-z0-9]{6,24}$/.test(r.id)) return null;
  const n = (v) => Math.max(1, Math.round(Number(v) || 1));
  return { id: r.id, caption: cleanCaption(r.caption), w: n(r.w), h: n(r.h), added: Number(r.added) || 0 };
}

function newId() {
  const c = globalThis.crypto;
  const buf = new Uint8Array(10);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  let s = 'p';
  for (const b of buf) s += (b % 36).toString(36);
  return s;
}

// A backend keeps three things: photo records { id, caption, w, h, added }, their bytes
// { id, full, small } and one state record { order, addedAt, viewedAt, nudgedAt }.
//   load() -> { records, state }     getBytes(id) -> { full, small } | null
//   put({ record, bytes, state })    any of them; one transaction where it can
//   drop(id, state)                  clear()       persistent
export function createMemoryBackend() {
  const records = new Map();
  const bytes = new Map();
  let state = null;
  return {
    persistent: false,
    async load() {
      return { records: [...records.values()].map((r) => ({ ...r })), state: state ? { ...state, order: state.order.slice() } : null };
    },
    async getBytes(id) {
      return bytes.get(id) || null;
    },
    async put({ record, bytes: b, state: s } = {}) {
      if (record) records.set(record.id, { ...record });
      if (record && b) bytes.set(record.id, b);
      if (s) state = { ...s, order: s.order.slice() };
    },
    async drop(id, s) {
      records.delete(id);
      bytes.delete(id);
      if (s) state = { ...s, order: s.order.slice() };
    },
    async clear() {
      records.clear();
      bytes.clear();
      state = null;
    },
  };
}

export function createPhotoStore({ backend = createMemoryBackend(), now = () => Date.now(), max = PHOTO_LIMITS.max } = {}) {
  const events = emitter();
  const recs = new Map(); // id -> record
  let order = [];
  let meta = cleanMeta(null);
  let queue = Promise.resolve(); // writes go one after another, in the order they were asked for

  const list = () => order.map((id) => ({ ...recs.get(id) }));
  const changed = () => events.emit('change', list());
  const write = (fn) => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };

  const ready = (async () => {
    let loaded = null;
    try {
      loaded = await backend.load();
    } catch (err) {
      loaded = null;
    }
    const ids = [];
    for (const raw of (loaded && loaded.records) || []) {
      const r = cleanRecord(raw);
      if (r && !recs.has(r.id)) {
        recs.set(r.id, r);
        ids.push(r.id);
      }
    }
    ids.sort((a, b) => recs.get(a).added - recs.get(b).added);
    order = reconcile(loaded && loaded.state && loaded.state.order, ids, max);
    for (const id of ids) if (!order.includes(id)) recs.delete(id); // over the limit (a hand-made database)
    meta = cleanMeta(loaded && loaded.state);
  })();

  const store = {
    ready,
    get persistent() { return !!backend.persistent; },
    get count() { return order.length; },
    get meta() { return { ...meta }; },
    list,
    has: (id) => recs.has(id),
    async add({ full, small, caption } = {}) {
      await ready;
      const F = cleanBytes(full);
      const S = cleanBytes(small) || F;
      if (!F) return { ok: false, reason: 'decode' };
      return write(async () => {
        if (order.length >= max) return { ok: false, reason: 'full' };
        let id = newId();
        while (recs.has(id)) id = newId();
        const t = now();
        const record = { id, caption: cleanCaption(caption), w: F.w, h: F.h, added: t };
        const nextOrder = [...order, id];
        const nextMeta = { ...meta, addedAt: t };
        try {
          await backend.put({ record, bytes: { full: F, small: S }, state: { ...nextMeta, order: nextOrder } });
        } catch (err) {
          return { ok: false, reason: 'storage' };
        }
        recs.set(id, record);
        order = nextOrder;
        meta = nextMeta;
        changed();
        return { ok: true, id };
      });
    },
    async bytes(id, which = 'small') {
      await ready;
      if (!recs.has(id)) return null;
      let b = null;
      try {
        b = await backend.getBytes(id);
      } catch (err) {
        b = null;
      }
      if (!b) return null;
      return cleanBytes(which === 'full' ? b.full : b.small) || cleanBytes(b.full);
    },
    async remove(id) {
      await ready;
      return write(async () => {
        if (!recs.has(id)) return false;
        const nextOrder = order.filter((x) => x !== id);
        await backend.drop(id, { ...meta, order: nextOrder });
        recs.delete(id);
        order = nextOrder;
        changed();
        return true;
      });
    },
    async clear() {
      await ready;
      return write(async () => {
        await backend.clear();
        recs.clear();
        order = [];
        meta = cleanMeta(null);
        changed();
        return true;
      });
    },
    async move(id, delta) {
      return setOrder(moveIn(order, id, delta));
    },
    async makeStar(id) {
      return setOrder(starIn(order, id));
    },
    async setCaption(id, text) {
      await ready;
      return write(async () => {
        const r = recs.get(id);
        if (!r) return false;
        const next = { ...r, caption: cleanCaption(text) };
        if (next.caption === r.caption) return true;
        await backend.put({ record: next });
        recs.set(id, next);
        changed();
        return true;
      });
    },
    async markViewed() {
      return setMeta({ viewedAt: now() });
    },
    async markNudged() {
      return setMeta({ nudgedAt: meta.addedAt });
    },
    on: events.on.bind(events),
    off: events.off.bind(events),
  };

  async function setOrder(next) {
    await ready;
    return write(async () => {
      if (next.join() === order.join()) return true;
      await backend.put({ state: { ...meta, order: next } });
      order = next.slice();
      changed();
      return true;
    });
  }
  async function setMeta(patch) {
    await ready;
    return write(async () => {
      const next = cleanMeta({ ...meta, ...patch });
      await backend.put({ state: { ...next, order: order.slice() } });
      meta = next;
      return true;
    });
  }
  return store;
}

// ------------------------------------------------------------------------------------------ IndexedDB

const STORES = ['photos', 'bytes', 'state'];

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB request failed'));
  });
}
function idbDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('indexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('indexedDB transaction failed'));
  });
}

function openDb(idb, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('indexedDB took too long')), timeoutMs);
    let req;
    try {
      req = idb.open(name, 1);
    } catch (err) {
      done(reject, err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('bytes')) db.createObjectStore('bytes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      // another tab of a newer Cloud Nine wants the database: let it
      db.onversionchange = () => db.close();
      done(resolve, db);
    };
    req.onerror = () => done(reject, req.error || new Error('indexedDB would not open'));
    req.onblocked = () => done(reject, new Error('indexedDB is blocked'));
  });
}

function idbBackend(db) {
  const tx = (mode) => db.transaction(STORES, mode);
  const copy = (b) => (b && b.buffer instanceof ArrayBuffer ? { buffer: b.buffer, type: b.type, w: b.w, h: b.h } : null);
  return {
    persistent: true,
    async load() {
      const t = tx('readonly');
      const [records, state] = await Promise.all([idbRequest(t.objectStore('photos').getAll()), idbRequest(t.objectStore('state').get('wall'))]);
      return { records, state: state || null };
    },
    async getBytes(id) {
      const rec = await idbRequest(tx('readonly').objectStore('bytes').get(id));
      return rec ? { full: copy(rec.full), small: copy(rec.small) } : null;
    },
    async put({ record, bytes, state } = {}) {
      const t = tx('readwrite');
      if (record) t.objectStore('photos').put({ ...record });
      if (record && bytes) t.objectStore('bytes').put({ id: record.id, full: copy(bytes.full), small: copy(bytes.small) });
      if (state) t.objectStore('state').put({ key: 'wall', ...state });
      await idbDone(t);
    },
    async drop(id, state) {
      const t = tx('readwrite');
      t.objectStore('photos').delete(id);
      t.objectStore('bytes').delete(id);
      if (state) t.objectStore('state').put({ key: 'wall', ...state });
      await idbDone(t);
    },
    async clear() {
      const t = tx('readwrite');
      for (const s of STORES) t.objectStore(s).clear();
      await idbDone(t);
    },
  };
}

// IndexedDB when this browser lets us keep things, memory otherwise (store.persistent is false then).
export async function openPhotoStore({ name = PHOTO_DB, timeoutMs = 4000, idb } = {}) {
  let backend = null;
  try {
    const factory = idb || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    if (factory) backend = idbBackend(await openDb(factory, name, timeoutMs));
  } catch (err) {
    backend = null;
  }
  const store = createPhotoStore({ backend: backend || createMemoryBackend() });
  await store.ready;
  return store;
}

// The browser's "keep this site's data" switch, best effort: true when it is (or already was) on.
export async function askToPersist() {
  try {
    const sm = typeof navigator !== 'undefined' ? navigator.storage : null;
    if (!sm || typeof sm.persist !== 'function') return false;
    if (typeof sm.persisted === 'function' && (await sm.persisted())) return true;
    return !!(await sm.persist());
  } catch (err) {
    return false;
  }
}

// ------------------------------------------------------------------------------------------ pictures

export function blobOf(bytes) {
  return new Blob([bytes.buffer], { type: bytes.type || 'image/jpeg' });
}

function readBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('could not read the picture'));
    fr.readAsArrayBuffer(blob);
  });
}

// Decodes a picture file with an <img> (it turns phone photos the right way up from their EXIF
// orientation, the same in every browser). Resolves { image, w, h, close() }; rejects when this browser
// can't open it (HEIC on a computer, a broken file).
export function decodeImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let finished = false;
    const close = () => {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
    const ok = () => {
      if (finished) return;
      finished = true;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!(w >= 8 && h >= 8)) {
        close();
        reject(new Error('empty picture'));
        return;
      }
      resolve({ image: img, w, h, close });
    };
    const bad = (err) => {
      if (finished) return;
      finished = true;
      close();
      reject(err instanceof Error ? err : new Error('this browser could not open the picture'));
    };
    img.onload = ok;
    img.onerror = bad;
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') img.decode().then(ok, () => (img.complete && img.naturalWidth ? ok() : bad()));
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function freeCanvas(c) {
  if (!c) return;
  c.width = 0; // gives the pixels back now (Safari keeps a canvas's memory until it is resized)
  c.height = 0;
}
function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not save the picture'))), 'image/jpeg', quality);
  });
}
// Draws src (w x h) at dw x dh on a fresh canvas over white (a see-through PNG goes onto white paper),
// halving first while it is more than twice too big, so a big shrink stays smooth.
function shrink(src, w, h, dw, dh) {
  let cur = src;
  let cw = w;
  let ch = h;
  const temps = [];
  while (cw > dw * 2.2 && ch > dh * 2.2) {
    const nw = Math.max(dw, Math.round(cw / 2));
    const nh = Math.max(dh, Math.round(ch / 2));
    const c = makeCanvas(nw, nh);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    temps.push(c);
    cur = c;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(dw, dh);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dw, dh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, dw, dh);
  for (const c of temps) freeCanvas(c);
  return out;
}

// A picture file -> the two JPEG copies the wall keeps. Never throws: { ok: false, reason } instead.
export async function processPhoto(file, limits = PHOTO_LIMITS) {
  if (!file || typeof file.size !== 'number') return { ok: false, reason: 'decode' };
  if (file.size > limits.fileBytes) return { ok: false, reason: 'big' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  let src = null;
  try {
    src = await decodeImage(file);
  } catch (err) {
    return { ok: false, reason: 'decode' };
  }
  let fullCanvas = null;
  let smallCanvas = null;
  try {
    const F = fitLongEdge(src.w, src.h, limits.long);
    fullCanvas = shrink(src.image, src.w, src.h, F.w, F.h);
    src.close();
    src = null;
    const S = fitLongEdge(F.w, F.h, limits.small);
    smallCanvas = shrink(fullCanvas, F.w, F.h, S.w, S.h);
    const [fullBlob, smallBlob] = await Promise.all([toJpeg(fullCanvas, limits.quality), toJpeg(smallCanvas, limits.smallQuality)]);
    const [fullBuf, smallBuf] = await Promise.all([readBuffer(fullBlob), readBuffer(smallBlob)]);
    return {
      ok: true,
      full: { buffer: fullBuf, type: 'image/jpeg', w: F.w, h: F.h },
      small: { buffer: smallBuf, type: 'image/jpeg', w: S.w, h: S.h },
    };
  } catch (err) {
    return { ok: false, reason: 'decode' };
  } finally {
    if (src) src.close();
    freeCanvas(fullCanvas);
    freeCanvas(smallCanvas);
  }
}
