// The family's photo pack: the photos a family sends with her gift link, so her photo wall fills itself
// the first time her link opens on her device (js/world/photowall.js importPhotos).
//
// The repo and the site are public, so a pack sits there locked: AES-256-GCM, with a random 256-bit key
// that exists only in the private gift link (its "photos": { id, key }, js/core/gift.js). Without the
// link the file is noise. The key never leaves the device: the link keeps it in its #fragment, which
// browsers never send to a server, and the only request here is a plain GET of packs/<id>.c9p from the
// game's own site. Nothing is ever uploaded. tools/make-photo-pack.mjs makes packs.
//
// A pack file: 'C9P1' (4 bytes), a 12-byte IV, then the sealed JSON
//   { v: 1, star: index, photos: [{ caption, type: 'image/jpeg', data: base64 }] }   (12 photos at most)
//
//   sealPack(content, keyText, { iv }?) -> Promise<Uint8Array>     the file's bytes (the tool uses it)
//   openPack(bytes, keyText) -> Promise<{ ok: true, star, photos: [{ caption, type, bytes }] } | { ok: false, reason }>
//   fetchPack({ id, key }, { base = './', fetchImpl = fetch }) -> the same, after GET packs/<id>.c9p
//   newPackId() / newPackKey()                                     random, for the tool

const MAGIC = [0x43, 0x39, 0x50, 0x31]; // 'C9P1'
export const PACK_LIMITS = Object.freeze({ photos: 12, fileBytes: 24 * 1024 * 1024, caption: 32 });
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

function b64urlToBytes(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  let bin;
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  } catch (err) {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes, url = false) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const b = btoa(bin);
  return url ? b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b;
}
function b64ToBytes(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function newPackId() {
  return Array.from(randomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function newPackKey() {
  return bytesToB64(randomBytes(32), true);
}

async function aesKey(keyText, use) {
  const raw = b64urlToBytes(keyText);
  if (!raw || raw.length !== 32 || !subtle()) return null;
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, [use]);
}

export async function sealPack(content, keyText, { iv = null } = {}) {
  const key = await aesKey(keyText, 'encrypt');
  if (!key) throw new Error('a pack key is 43 base64url characters (256 bits)');
  const nonce = iv || randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(content));
  const sealed = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const out = new Uint8Array(4 + 12 + sealed.length);
  out.set(MAGIC, 0);
  out.set(nonce, 4);
  out.set(sealed, 16);
  return out;
}

const cleanCaption = (c) => (typeof c === 'string' ? c.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, PACK_LIMITS.caption) : '');

export async function openPack(bytes, keyText) {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length < 32 || b.length > PACK_LIMITS.fileBytes || MAGIC.some((m, i) => b[i] !== m)) return { ok: false, reason: 'not a pack' };
    const key = await aesKey(keyText, 'decrypt');
    if (!key) return { ok: false, reason: 'no key' };
    let plain;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv: b.subarray(4, 16) }, key, b.subarray(16));
    } catch (err) {
      return { ok: false, reason: 'wrong key' };
    }
    const data = JSON.parse(new TextDecoder().decode(plain));
    if (!data || data.v !== 1 || !Array.isArray(data.photos)) return { ok: false, reason: 'not a pack' };
    const photos = [];
    for (const p of data.photos.slice(0, PACK_LIMITS.photos)) {
      if (!p || typeof p.data !== 'string' || !TYPES.includes(p.type)) continue;
      let bytesOut;
      try {
        bytesOut = b64ToBytes(p.data);
      } catch (err) {
        continue;
      }
      photos.push({ caption: cleanCaption(p.caption), type: p.type, bytes: bytesOut });
    }
    const star = Number.isInteger(data.star) && data.star >= 0 && data.star < photos.length ? data.star : 0;
    return photos.length ? { ok: true, star, photos } : { ok: false, reason: 'empty' };
  } catch (err) {
    return { ok: false, reason: 'not a pack' };
  }
}

export async function fetchPack(ref, { base = './', fetchImpl = typeof fetch === 'function' ? fetch : null } = {}) {
  if (!ref || typeof ref.id !== 'string' || !/^[a-f0-9]{16}$/.test(ref.id) || typeof fetchImpl !== 'function') return { ok: false, reason: 'no pack' };
  let res;
  try {
    res = await fetchImpl(base + 'packs/' + ref.id + '.c9p', { cache: 'no-cache', credentials: 'omit' });
  } catch (err) {
    return { ok: false, reason: 'offline' };
  }
  if (!res || !res.ok) return { ok: false, reason: 'missing' };
  return openPack(new Uint8Array(await res.arrayBuffer()), ref.key);
}
