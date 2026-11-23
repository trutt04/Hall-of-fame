// The photo wall's store and words (js/core/photos.js, js/ui/photo-manager.js, js/ui/photo-viewer.js,
// js/world/photowall.js): captions, name chips, crops, the wall's order and the star, the twelve-photo
// limit, what a reload keeps, the surprise nudge, and the slideshow's slides. Made-up names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_LIMITS, PHOTO_DB, cleanCaption, joinNames, nameChips, fitLongEdge, coverCrop, moveIn, starIn, reconcile,
  createPhotoStore, createMemoryBackend,
} from '../js/core/photos.js';
import { captionParts, toggleName } from '../js/ui/photo-manager.js';
import { buildSlides, slideTime } from '../js/ui/photo-viewer.js';
import { wallTitle, nudgeState, PROMPTS, NUDGE_LINE } from '../js/world/photowall.js';
import { validateGift, petName } from '../js/core/gift.js';

const jpeg = (n = 64, w = 1600, h = 1200) => ({ buffer: new ArrayBuffer(n), type: 'image/jpeg', w, h });
const photo = (caption = '') => ({ full: jpeg(64), small: jpeg(16, 640, 480), caption });

test('the limits: twelve photos, files up to about 40 MB, 1600 px kept, captions of 32', () => {
  assert.equal(PHOTO_LIMITS.max, 12);
  assert.equal(PHOTO_LIMITS.long, 1600);
  assert.ok(PHOTO_LIMITS.fileBytes >= 39e6 && PHOTO_LIMITS.fileBytes <= 42e6);
  assert.equal(PHOTO_LIMITS.caption, 32);
  assert.equal(PHOTO_DB, 'c9-photos');
});

test('captions: control and invisible characters out, spaces tidied, 32 characters, emoji kept whole', () => {
  assert.equal(cleanCaption('  Me   and\tPip  '), 'Me and Pip');
  assert.equal(cleanCaption('Me\u0000\u0007 & Pip\u200b\u202e'), 'Me & Pip', 'control, zero-width and direction-flipping characters go');
  assert.equal(cleanCaption('Line one\nline two'), 'Line one line two');
  assert.equal(cleanCaption('x'.repeat(40)).length, 32);
  assert.equal(cleanCaption('Pip \u{1F496}'), 'Pip \u{1F496}');
  const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
  assert.equal(cleanCaption('Us ' + family), 'Us ' + family, 'an emoji family stays together');
  const cut = cleanCaption('x'.repeat(28) + ' ' + family);
  assert.ok(Array.from(cut).length <= 32 && !/[\u200d\ufe0f]$/.test(cut), 'a cut never leaves half an emoji joiner');
  for (const bad of [null, undefined, 42, {}, ['Pip']]) assert.equal(cleanCaption(bad), '');
  assert.equal(cleanCaption('<b>Pip</b>'), '<b>Pip</b>', 'kept as plain text: captions are only ever drawn as text, never as markup');
});

test('name chips build captions like "Me, Zuzu & Pip"', () => {
  assert.equal(joinNames(['Me']), 'Me');
  assert.equal(joinNames(['Me', 'Pip']), 'Me & Pip');
  assert.equal(joinNames(['Me', 'Pip', 'Grandpa Zork']), 'Me, Pip & Grandpa Zork');
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['Me', '', null, ' Pip ']), 'Me & Pip');
  // a chip tapped in: on the end; tapped again: out; too long: refused
  assert.deepEqual(toggleName('', 'Me'), { caption: 'Me', ok: true });
  assert.deepEqual(toggleName('Me', 'Pip'), { caption: 'Me & Pip', ok: true });
  assert.deepEqual(toggleName('Me & Pip', 'Biscuit'), { caption: 'Me, Pip & Biscuit', ok: true });
  assert.deepEqual(toggleName('Me, Pip & Biscuit', 'pip'), { caption: 'Me & Biscuit', ok: true });
  assert.deepEqual(toggleName('Beach day', 'Pip'), { caption: 'Beach day & Pip', ok: true }, 'typed words stay');
  const long = 'Grandpa Zork, Grandma Fizzle & Pip';
  assert.equal(toggleName('Grandpa Zork & Grandma Fizzle', 'Pip').ok, false, 'over 32 characters: ' + long.length);
  assert.deepEqual(captionParts(' Me ,Pip  &  Biscuit '), ['Me', 'Pip', 'Biscuit']);
});

test('the chips come from the gift link on this device, else Me, Mom, Dad, Family, Friends, My pet', () => {
  assert.deepEqual(nameChips({}).map((c) => c.label), ['Me', 'Mom', 'Dad', 'Family', 'Friends', 'My pet']);
  assert.deepEqual(nameChips({ gift: null }).map((c) => c.label), ['Me', 'Mom', 'Dad', 'Family', 'Friends', 'My pet']);
  const gift = validateGift({ v: 1, to: 'Zuzu', friends: ['Pip', 'Grandpa Zork', 'zuzu', 'Zippy-Doo'], petNames: { husky: 'Biscuit', cloudPuppy: 'Puff' } }).gift;
  const labels = nameChips({ gift, petName }).map((c) => c.label);
  assert.deepEqual(labels, ['Me', 'Zuzu', 'Pip', 'Grandpa Zork', 'Zippy-Doo', 'Biscuit', 'Puff', 'Family', 'Friends'], 'her name, her friends and her pets, once each');
  const ids = nameChips({ gift, petName }).map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  // anything odd in a hand-made gift is left out
  const odd = nameChips({ gift: { v: 1, to: '<b>', friends: ['Pip', 42, '', 'Zork!'] } }).map((c) => c.label);
  assert.deepEqual(odd, ['Me', 'Pip', 'Family', 'Friends']);
});

test('sizes: the long edge at most 1600, never upscaled; crops fill the frame with faces kept', () => {
  assert.deepEqual(fitLongEdge(4032, 3024, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(fitLongEdge(3024, 4032, 1600), { w: 1200, h: 1600 });
  assert.deepEqual(fitLongEdge(800, 600, 1600), { w: 800, h: 600 });
  assert.deepEqual(fitLongEdge(0, NaN, 1600), { w: 1, h: 1 });
  // a tall photo in a square window: the crop sits above the middle (faces are near the top)
  const tall = coverCrop(1200, 1600, 332, 332);
  assert.equal(tall.sw, 1200);
  assert.equal(tall.sh, 1200);
  assert.ok(tall.sy > 0 && tall.sy < (1600 - 1200) / 2, 'above the middle: ' + tall.sy);
  // a wide one: centred across
  const wide = coverCrop(1600, 900, 332, 332);
  assert.deepEqual([wide.sx, wide.sy, wide.sw, wide.sh], [350, 0, 900, 900]);
  // always inside the picture, always the window's shape
  for (const [sw, sh, dw, dh] of [[640, 480, 332, 332], [480, 640, 684, 684], [100, 3000, 332, 332], [3000, 100, 744, 884]]) {
    const c = coverCrop(sw, sh, dw, dh);
    assert.ok(c.sx >= 0 && c.sy >= 0 && c.sx + c.sw <= sw + 1e-9 && c.sy + c.sh <= sh + 1e-9);
    assert.ok(Math.abs(c.sw / c.sh - dw / dh) < 1e-9);
  }
});

test('the wall order: the first is the star; Earlier, Later and "Make it the star"', () => {
  const o = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveIn(o, 'c', -1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveIn(o, 'a', -1), ['a', 'b', 'c', 'd']);
  assert.deepEqual(moveIn(o, 'd', 1), ['a', 'b', 'c', 'd']);
  assert.deepEqual(moveIn(o, 'x', 1), o);
  assert.deepEqual(starIn(o, 'c'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(o, ['a', 'b', 'c', 'd'], 'never changed in place');
  assert.deepEqual(reconcile(['c', 'zz', 'a', 'c'], ['a', 'b', 'c']), ['c', 'a', 'b'], 'unknown ids out, missing ones on the end, no repeats');
  assert.equal(reconcile([], 'abcdefghijklmnop'.split('')).length, 12);
});

test('the store: twelve at most, the order, the star, captions, removing, and every change told', async () => {
  const store = createPhotoStore({ backend: createMemoryBackend(), now: (() => { let t = 1000; return () => (t += 10); })() });
  await store.ready;
  assert.equal(store.persistent, false, 'the memory backend says it keeps nothing');
  const seen = [];
  store.on('change', (list) => seen.push(list.length));
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const r = await store.add(photo('photo ' + i));
    assert.ok(r.ok && /^p[a-z0-9]+$/.test(r.id), 'added ' + i);
    ids.push(r.id);
  }
  assert.deepEqual(await store.add(photo()), { ok: false, reason: 'full' }, 'the thirteenth is refused');
  assert.equal(store.count, 12);
  assert.deepEqual(store.list().map((p) => p.id), ids);
  assert.equal(seen.length, 12);
  assert.deepEqual(await store.add({ full: { buffer: 'nope', type: 'image/jpeg' } }), { ok: false, reason: 'decode' });
  assert.deepEqual(await store.add({ full: { buffer: new ArrayBuffer(4), type: 'text/html' } }), { ok: false, reason: 'decode' });
  await store.makeStar(ids[5]);
  assert.equal(store.list()[0].id, ids[5]);
  await store.move(ids[5], 2);
  assert.equal(store.list()[2].id, ids[5]);
  await store.setCaption(ids[0], '  Me\u0000 & Pip and a very very long caption here ');
  const cap = store.list().find((p) => p.id === ids[0]).caption;
  assert.ok(cap.startsWith('Me & Pip') && Array.from(cap).length <= 32, cap);
  const b = await store.bytes(ids[1], 'small');
  assert.ok(b.buffer instanceof ArrayBuffer && b.type === 'image/jpeg' && b.w === 640);
  assert.equal((await store.bytes(ids[1], 'full')).w, 1600);
  assert.equal(await store.bytes('pnothere00', 'full'), null);
  assert.equal(await store.remove(ids[3]), true);
  assert.equal(await store.remove(ids[3]), false);
  assert.equal(store.count, 11);
  assert.ok((await store.add(photo())).ok, 'room for one more');
  await store.clear();
  assert.equal(store.count, 0);
  assert.deepEqual(store.meta, { addedAt: 0, viewedAt: 0, nudgedAt: 0 });
});

test('a reload keeps the photos, their captions, the order and when she last looked', async () => {
  const backend = createMemoryBackend();
  let t = 5000;
  const now = () => (t += 100);
  const first = createPhotoStore({ backend, now });
  const a = (await first.add(photo('Me & Pip'))).id;
  const b = (await first.add(photo('Beach day'))).id;
  await first.makeStar(b);
  await first.markViewed();
  const c = (await first.add(photo())).id;
  // a new visit: a fresh store on the same storage
  const second = createPhotoStore({ backend, now });
  await second.ready;
  assert.deepEqual(second.list().map((p) => [p.id, p.caption]), [[b, 'Beach day'], [a, 'Me & Pip'], [c, '']]);
  const m = second.meta;
  assert.ok(m.addedAt > m.viewedAt && m.viewedAt > 0, 'one photo came after her last look');
  // a store that can't write says so, and keeps nothing it couldn't save
  const broken = createPhotoStore({ backend: Object.assign(createMemoryBackend(), { put: async () => { throw new Error('quota'); } }) });
  assert.deepEqual(await broken.add(photo()), { ok: false, reason: 'storage' });
  assert.equal(broken.count, 0);
  // and one whose storage won't even load starts empty
  const unreadable = createPhotoStore({ backend: Object.assign(createMemoryBackend(), { load: async () => { throw new Error('no'); } }) });
  await unreadable.ready;
  assert.equal(unreadable.count, 0);
});

test('the surprise: photos from an earlier visit she has not looked at make the beacon glow, and one toast', () => {
  const start = 10000;
  assert.deepEqual(nudgeState({ addedAt: 9000, viewedAt: 0, nudgedAt: 0 }, 2, start), { glow: true, toast: true });
  assert.deepEqual(nudgeState({ addedAt: 9000, viewedAt: 0, nudgedAt: 9000 }, 2, start), { glow: true, toast: false }, 'the toast only once');
  assert.deepEqual(nudgeState({ addedAt: 9000, viewedAt: 9500, nudgedAt: 0 }, 2, start), { glow: false, toast: false }, 'she has looked since');
  assert.deepEqual(nudgeState({ addedAt: 12000, viewedAt: 0, nudgedAt: 0 }, 2, start), { glow: false, toast: false }, 'added this visit: no surprise');
  assert.deepEqual(nudgeState({ addedAt: 9000, viewedAt: 0, nudgedAt: 0 }, 0, start), { glow: false, toast: false }, 'nothing left on the wall');
  assert.deepEqual(nudgeState(null, 3, start), { glow: false, toast: false });
  assert.equal(NUDGE_LINE, 'Your photo wall has new photos!');
});

test('the banner, the prompt and the slideshow', () => {
  assert.equal(wallTitle('Zuzu'), "Zuzu's Favorite People");
  assert.equal(wallTitle('  Zippy Doo '), "Zippy Doo's Favorite People");
  assert.equal(wallTitle(null), 'Favorite People');
  assert.equal(wallTitle(''), 'Favorite People');
  assert.deepEqual(PROMPTS, { empty: 'Add photos', full: 'Look at the photos' });
  const photos = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, caption: id.toUpperCase(), w: 1600, h: 1200 }));
  const notes = [{ from: 'Grandma Fizzle', text: 'So proud of you!' }, { from: 'Mom', text: 'Fly high!' }, { from: 'Pip', text: '   ' }];
  // looking by hand: the photos only
  assert.deepEqual(buildSlides(photos, { notes }).map((s) => s.kind), ['photo', 'photo', 'photo', 'photo', 'photo']);
  // the slideshow: a note after every second photo, the rest at the end, a birthday card last on her birthday
  const show = buildSlides(photos, { notes, birthday: { isBirthday: true, name: 'Zuzu' }, slideshow: true });
  assert.deepEqual(show.map((s) => s.kind), ['photo', 'photo', 'note', 'photo', 'photo', 'note', 'photo', 'birthday']);
  assert.equal(show[2].from, 'Grandma Fizzle');
  assert.equal(show[7].name, 'Zuzu');
  assert.deepEqual(buildSlides(photos.slice(0, 1), { notes, slideshow: true }).map((s) => s.kind), ['photo', 'note', 'note'], 'leftover notes after the photos');
  assert.ok(buildSlides(photos, { notes, birthday: { isBirthday: false }, slideshow: true }).every((s) => s.kind !== 'birthday'));
  // long notes stay up long enough to read
  assert.ok(slideTime({ kind: 'note', text: 'x'.repeat(200) }) > slideTime({ kind: 'note', text: 'Hi!' }));
  assert.ok(slideTime({ kind: 'photo' }) >= 4 && slideTime({ kind: 'photo' }, true) >= slideTime({ kind: 'photo' }));
});
