// Makes the family's photo pack for Cloud Nine's photo wall (README: "Family photos in the gift link").
//
//   node cloud-nine/tools/make-photo-pack.mjs <pack.json>
//
// pack.json stays on your computer (never commit it, nor the photos):
//   { "star": 0, "photos": [{ "file": "/path/to/photo.jpg", "caption": "Beach day" }, ...] }   (12 at most)
// Use JPEGs about 1600 px on the long edge with no location data (the game shrinks them again anyway).
//
// It locks the photos with a new random key (AES-256-GCM, js/core/photo-pack.js), writes the locked
// file to cloud-nine/packs/<id>.c9p (that file is safe to publish: without the key it is noise), and
// prints the "photos" entry for the gift link's JSON: { "id": ..., "key": ... }. The key is the only way
// in: put it in the gift link (tools/make-gift.mjs) and nowhere else.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { sealPack, openPack, newPackId, newPackKey, PACK_LIMITS } from '../js/core/photo-pack.js';

const say = (...a) => console.error(...a);
const arg = process.argv[2];
if (!arg) {
  say('usage: node cloud-nine/tools/make-photo-pack.mjs <pack.json>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(arg, 'utf8'));
const list = Array.isArray(spec.photos) ? spec.photos : [];
if (!list.length || list.length > PACK_LIMITS.photos) {
  say('a pack holds 1 to ' + PACK_LIMITS.photos + ' photos');
  process.exit(1);
}
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const photos = list.map((p, i) => {
  const type = TYPES[extname(String(p.file)).toLowerCase()];
  if (!type) throw new Error('photo ' + (i + 1) + ': JPEG, PNG or WebP only');
  return { caption: String(p.caption || '').slice(0, PACK_LIMITS.caption), type, data: readFileSync(p.file).toString('base64') };
});
const star = Number.isInteger(spec.star) && spec.star >= 0 && spec.star < photos.length ? spec.star : 0;
const id = newPackId();
const key = newPackKey();
const bytes = await sealPack({ v: 1, star, photos }, key);
const check = await openPack(bytes, key);
if (!check.ok || check.photos.length !== photos.length) throw new Error('the pack did not open again: ' + check.reason);
const dir = join(fileURLToPath(new URL('..', import.meta.url)), 'packs');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, id + '.c9p'), bytes);
say('Locked ' + photos.length + ' photos (' + Math.round(bytes.length / 1024) + ' KB) into cloud-nine/packs/' + id + '.c9p');
say('Put this in the gift JSON as "photos", then make the link with tools/make-gift.mjs. Keep the key private:');
console.log(JSON.stringify({ id, key }));
