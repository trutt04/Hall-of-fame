// The family's photo pack (js/core/photo-pack.js): photos locked with a key that only the private gift
// link holds. Locked and opened again, a wrong key or a changed byte opens nothing, captions come out
// clean, and the only request is a plain GET of packs/<id>.c9p from the game's own site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sealPack, openPack, fetchPack, newPackId, newPackKey, PACK_LIMITS } from '../js/core/photo-pack.js';
import { validateGift } from '../js/core/gift.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const jpeg = (n) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n + 1, n + 2, 0xff, 0xd9]).toString('base64');
const content = { v: 1, star: 1, photos: [{ caption: 'Beach day', type: 'image/jpeg', data: jpeg(1) }, { caption: 'Flyer!', type: 'image/jpeg', data: jpeg(2) }] };

test('pack: locked, then opened with its key', async () => {
  const key = newPackKey();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.match(newPackId(), /^[a-f0-9]{16}$/);
  assert.notEqual(newPackKey(), key, 'a new key each time');
  const bytes = await sealPack(content, key);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x43, 0x39, 0x50, 0x31], 'C9P1');
  assert.ok(!Buffer.from(bytes).toString('latin1').includes('Beach day'), 'the captions are locked too');
  const out = await openPack(bytes, key);
  assert.equal(out.ok, true);
  assert.equal(out.star, 1);
  assert.deepEqual(out.photos.map((p) => p.caption), ['Beach day', 'Flyer!']);
  assert.deepEqual([...out.photos[1].bytes], [...Buffer.from(jpeg(2), 'base64')]);
  assert.equal(out.photos[0].type, 'image/jpeg');
});

test('pack: a wrong key, a changed byte or another file opens nothing', async () => {
  const key = newPackKey();
  const bytes = await sealPack(content, key);
  assert.deepEqual(await openPack(bytes, newPackKey()), { ok: false, reason: 'wrong key' });
  const bent = bytes.slice();
  bent[40] ^= 1;
  assert.equal((await openPack(bent, key)).ok, false, 'tampered');
  assert.equal((await openPack(new Uint8Array(64), key)).reason, 'not a pack');
  assert.equal((await openPack(bytes, 'short')).reason, 'no key');
  assert.equal((await openPack(null, key)).ok, false);
});

test('pack: captions come out clean, odd entries are skipped, at most 12 photos', async () => {
  const key = newPackKey();
  const many = { v: 1, star: 99, photos: [{ caption: '<b>Hi</b>\u0007 there   friends and family forever and ever', type: 'image/jpeg', data: jpeg(3) }, { caption: 'x', type: 'text/html', data: jpeg(4) }, null] };
  for (let i = 0; i < 14; i++) many.photos.push({ caption: 'P' + i, type: 'image/png', data: jpeg(i) });
  const out = await openPack(await sealPack(many, key), key);
  assert.equal(out.ok, true);
  assert.equal(out.photos.length, PACK_LIMITS.photos - 2, 'twelve entries read, two of them unusable');
  assert.equal(out.photos[0].caption, 'bHi/b there friends and family f');
  assert.ok(out.photos[0].caption.length <= PACK_LIMITS.caption);
  assert.equal(out.star, 0, 'a star past the end is the first photo');
});

test('pack: the only request is a plain GET of packs/<id>.c9p, without cookies', async () => {
  const key = newPackKey();
  const id = newPackId();
  const bytes = await sealPack(content, key);
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push({ url, init });
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  const out = await fetchPack({ id, key }, { fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, './packs/' + id + '.c9p');
  assert.equal(asked[0].init.method, undefined, 'GET');
  assert.equal(asked[0].init.body, undefined);
  assert.equal(asked[0].init.credentials, 'omit');
  assert.ok(!asked[0].url.includes(key), 'the key never goes out');
  assert.equal((await fetchPack({ id: '../secret', key }, { fetchImpl })).reason, 'no pack', 'only a pack id');
  assert.equal((await fetchPack({ id, key }, { fetchImpl: async () => ({ ok: false }) })).reason, 'missing');
  assert.equal((await fetchPack({ id, key }, { fetchImpl: async () => { throw new Error('offline'); } })).reason, 'offline');
});

test('pack: the module only reads; it never imports the net or sends anything', () => {
  const src = readFileSync(join(root, 'js/core/photo-pack.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((src.match(/fetchImpl\(/g) || []).length, 1, 'one request');
  assert.doesNotMatch(src, /from '\.\.\/net|import\(|XMLHttpRequest|sendBeacon|WebSocket|method\s*:|body\s*:/);
  assert.doesNotMatch(src, /localStorage|indexedDB/, 'the photos are kept by js/core/photos.js, not here');
});

test('gift: "photos" carries a pack id and key, checked strictly', () => {
  const key = newPackKey();
  const ok = validateGift({ v: 1, to: 'Zuzu', photos: { id: '0123456789abcdef', key } });
  assert.deepEqual(ok.gift.photos, { id: '0123456789abcdef', key });
  assert.deepEqual(ok.dropped, []);
  for (const bad of [{ id: '0123456789ABCDEF', key }, { id: '0123456789abcdef', key: key.slice(1) }, { id: '0123456789abcdef', key, url: 'x' }, 'pack', null]) {
    const r = validateGift({ v: 1, to: 'Zuzu', photos: bad });
    assert.equal(r.gift.photos, undefined, JSON.stringify(bad));
    assert.equal(r.dropped.length, 1);
  }
});
