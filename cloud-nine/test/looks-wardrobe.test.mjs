// Looks for everyone 9 to 15: the new slots and options through cleanLook (hostile network input and
// looks saved before hats existed), randomLook reaching every option, the worst-case look still well
// under NET's 600-character limit, the pet name lookup, and the new pieces built within budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_OPTIONS, LOOK_SLOTS, DEFAULT_LOOK, cleanLook, randomLook, lookOption, lookKey, petLabel, setPetLabels } from '../js/art/character-looks.js';
import { encodeLook, decodeLook } from '../js/net/validate.js';
import { buildCharacter } from '../js/art/character-build.js';
import { B } from '../js/art/character-rig.js';
import { optionIcon, tabIcon } from '../js/art/character-icons.js';

const NEW = {
  hairStyle: ['crop', 'curls', 'swoop', 'buzz'],
  hat: ['bow', 'none', 'cap', 'capBack', 'beanie'],
  top: ['jersey-pink', 'jersey-black', 'jersey-blue', 'varsity-black', 'varsity-navy', 'varsity-red'],
  bottom: ['joggers-grey', 'joggers-black', 'joggers-navy', 'bball-black', 'bball-blue'],
  shoes: ['hightop-black', 'hightop-white', 'hightop-red'],
  bow: ['navy', 'red'],
  pet: ['husky'],
};
// A look saved before this change: 12 slots, no hat.
const OLD = { skin: 'tone6', hair: 'lilac', hairStyle: 'spaceBuns', bow: 'rainbow', bowPattern: 'hearts', bowSize: 'ridiculous', top: 'hoodie-pink', bottom: 'skirt-purple', shoes: 'sneakers-pink', socks: 'rainbow', sparkle: 'max', pet: 'cloudPuppy' };

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('the new options exist, with styles the builder knows and preset colours only', () => {
  assert.deepEqual([...LOOK_SLOTS], ['hairStyle', 'hair', 'hat', 'bow', 'bowPattern', 'bowSize', 'top', 'bottom', 'shoes', 'socks', 'sparkle', 'skin', 'pet']);
  for (const [slot, ids] of Object.entries(NEW)) {
    for (const id of ids) assert.ok(LOOK_OPTIONS[slot].some((o) => o.id === id), slot + '.' + id);
  }
  assert.deepEqual(LOOK_OPTIONS.hat.map((o) => o.id), ['bow', 'none', 'cap', 'capBack', 'beanie']);
  assert.equal(DEFAULT_LOOK.hat, 'bow', 'her default keeps the big bow');
  for (const o of LOOK_OPTIONS.top) {
    if (o.style === 'jersey') assert.ok(Number.isInteger(o.number) && o.number >= 0 && o.number <= 99, o.id);
    if (o.style === 'varsity') assert.match(o.sleeve, /^#[0-9a-f]{6}$/i, o.id);
  }
  assert.ok(Object.isFrozen(LOOK_OPTIONS.hat) && Object.isFrozen(LOOK_OPTIONS.hat[0]));
});

test('cleanLook: old saved looks keep everything and wear their bow; the new slots fill in', () => {
  const out = cleanLook(OLD);
  assert.deepEqual(out, { ...OLD, hat: 'bow' });
  assert.equal(cleanLook({}).hat, 'bow');
  // every new option survives, alone and all together
  for (const [slot, ids] of Object.entries(NEW)) for (const id of ids) assert.equal(cleanLook({ [slot]: id })[slot], id, slot + '.' + id);
  const teen = { hairStyle: 'crop', hat: 'capBack', bow: 'navy', top: 'varsity-navy', bottom: 'joggers-grey', shoes: 'hightop-white', pet: 'husky' };
  assert.deepEqual(cleanLook(teen), { ...DEFAULT_LOOK, ...teen });
  assert.notEqual(lookKey(teen), lookKey({ ...teen, hat: 'cap' }), 'the hat is part of the key');
});

test('cleanLook rejects junk in the new slots, and a bad hat never spoils the rest', () => {
  const junk = ['Cap', 'cap ', ' cap', 'cap\u0000', 'hat', 'helmet', 'crown', '__proto__', 'constructor', 'toString', '', 'cap'.repeat(20), 'beanie'.repeat(100000),
    0, 1, NaN, true, null, undefined, {}, ['cap'], { id: 'cap' }, () => 'cap', Symbol('cap'), 3n];
  for (const hat of junk) {
    const out = cleanLook({ hairStyle: 'curls', hat, top: 'jersey-blue' });
    assert.equal(out.hat, 'bow', String(typeof hat) + ' ' + String(hat).slice(0, 12));
    assert.equal(out.hairStyle, 'curls');
    assert.equal(out.top, 'jersey-blue');
  }
  for (const [slot, bad] of [['hairStyle', 'mohawk'], ['top', 'jersey-gold'], ['bottom', 'joggers'], ['shoes', 'hightop'], ['bow', 'none'], ['pet', 'Husky']]) {
    assert.equal(cleanLook({ [slot]: bad })[slot], DEFAULT_LOOK[slot], slot + ' ' + bad);
  }
  assert.equal(cleanLook(Object.create({ hat: 'cap' })).hat, 'bow', 'inherited, not the sender\'s');
  const tricky = { hair: 'blue' };
  Object.defineProperty(tricky, 'hat', { enumerable: true, get() { throw new Error('boom'); } });
  assert.equal(cleanLook(tricky).hat, 'bow');
  assert.equal(cleanLook(tricky).hair, 'blue');
});

test('randomLook reaches every option of every slot (never a pet), and is always clean', () => {
  const seen = Object.fromEntries(LOOK_SLOTS.map((s) => [s, new Set()]));
  const r = seeded(2024);
  for (let i = 0; i < 6000; i++) {
    const l = randomLook(r);
    assert.deepEqual(cleanLook(l), l);
    for (const s of LOOK_SLOTS) seen[s].add(l[s]);
  }
  for (const s of LOOK_SLOTS) {
    if (s === 'pet') assert.deepEqual([...seen.pet], ['none'], 'bots never get a pet');
    else assert.equal(seen[s].size, LOOK_OPTIONS[s].length, s + ' misses ' + LOOK_OPTIONS[s].filter((o) => !seen[s].has(o.id)).map((o) => o.id));
  }
});

test('the worst-case look JSON stays well under 600 characters and survives the network', () => {
  const longest = {};
  for (const s of LOOK_SLOTS) longest[s] = LOOK_OPTIONS[s].reduce((a, o) => (o.id.length > a.length ? o.id : a), '');
  const look = cleanLook(longest);
  assert.deepEqual(look, longest);
  const json = JSON.stringify(look);
  assert.ok(json.length < 600, json.length + ' characters');
  assert.ok(json.length < 400, 'plenty of room left: ' + json.length);
  assert.deepEqual(decodeLook(encodeLook(look), cleanLook), look);
  // a friend's device with this code reads an old device's look, and the other way round
  assert.deepEqual(decodeLook(encodeLook(OLD), cleanLook), { ...OLD, hat: 'bow' });
  assert.equal(decodeLook(encodeLook({ ...look, hat: 'tiara' }), cleanLook).hat, 'bow');
});

test('petLabel is the one pet name lookup, and setPetLabels overrides it safely', () => {
  try {
    assert.equal(petLabel('husky'), 'Mini husky');
    assert.equal(petLabel('cloudPuppy'), 'Cloud puppy');
    assert.equal(petLabel('none'), 'No pet');
    for (const bad of ['dragon', '', null, undefined, 7, {}, '__proto__']) assert.equal(petLabel(bad), 'No pet');
    assert.deepEqual(setPetLabels({ husky: '  Snow   Paws ' }), { husky: 'Snow Paws' });
    assert.equal(petLabel('husky'), 'Snow Paws');
    assert.equal(lookOption('pet', 'husky').label, 'Mini husky', 'the preset list never changes');
    // junk is ignored: markup, too long, not text, "No pet", unknown pets, inherited keys
    setPetLabels({ husky: '<b>Rex</b>', cloudPuppy: 'x'.repeat(30), none: 'Nobody', wolf: 'Grey', __proto__: { husky: 'Evil' } });
    assert.equal(petLabel('husky'), 'Snow Paws');
    assert.equal(petLabel('cloudPuppy'), 'Cloud puppy');
    assert.equal(petLabel('none'), 'No pet');
    setPetLabels({ husky: 42 });
    assert.equal(petLabel('husky'), 'Snow Paws');
    for (const bad of [null, undefined, 'husky', 7, []]) setPetLabels(bad);
    assert.equal(petLabel('husky'), 'Snow Paws');
    assert.deepEqual(setPetLabels({ cloudPuppy: "Puff O'Cloud" }), { husky: 'Snow Paws', cloudPuppy: "Puff O'Cloud" });
    // null (or '') puts the preset label back
    setPetLabels({ husky: null, cloudPuppy: '' });
    assert.equal(petLabel('husky'), 'Mini husky');
    assert.equal(petLabel('cloudPuppy'), 'Cloud puppy');
  } finally {
    setPetLabels({ husky: null, cloudPuppy: null });
  }
});

test('every new piece builds at both qualities, one body geometry within the triangle budget', () => {
  const heavy = [
    { hairStyle: 'curls', hat: 'beanie', top: 'varsity-navy', bottom: 'bball-black', shoes: 'hightop-red' },
    { hairStyle: 'crop', hat: 'cap', top: 'jersey-blue', bottom: 'joggers-grey', shoes: 'hightop-white' },
    { hairStyle: 'curls', hat: 'bow', bow: 'rainbow', bowPattern: 'hearts', top: 'jersey-pink', bottom: 'skirt-pink', shoes: 'hightop-black', sparkle: 'max' },
    { hairStyle: 'swoop', hat: 'capBack', bow: 'rainbow', top: 'varsity-red', bottom: 'leggings-galaxy', shoes: 'hightop-red', sparkle: 'gold' },
    { hairStyle: 'braidPony', hat: 'cap', bow: 'silver', top: 'jersey-black', bottom: 'bball-blue', shoes: 'glitter' },
    { hairStyle: 'spaceBuns', hat: 'beanie', bow: 'gold', top: 'crop-black', bottom: 'joggers-navy' },
  ];
  for (const raw of heavy) {
    const look = cleanLook(raw);
    // the skirt and a rainbow bow with hearts were already the heaviest pieces: ~3.5k with them
    const mixed = look.bottom === 'skirt-pink';
    for (const q of ['high', 'low']) {
      const b = buildCharacter(look, q);
      const pos = b.body.attributes.position.array;
      for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), 'finite');
      assert.ok(b.tris <= (q === 'high' ? (mixed ? 3600 : 3500) : mixed ? 2100 : 1900), JSON.stringify(raw) + ' ' + q + ': ' + b.tris);
    }
  }
  // every option on its own, at both qualities
  for (const [slot, ids] of Object.entries(NEW)) {
    for (const id of ids) for (const q of ['high', 'low']) assert.ok(buildCharacter(cleanLook({ [slot]: id }), q).tris > 1000, slot + '.' + id);
  }
});

test('a hat takes the bow off (no bow vertices), and long hair tucks under it', () => {
  const bowVerts = (look) => {
    const b = buildCharacter(cleanLook(look), 'high');
    const si = b.body.attributes.skinIndex.array, sw = b.body.attributes.skinWeight.array;
    let n = 0;
    for (let i = 0; i < si.length; i += 4) if ((si[i] === B.bow && sw[i] > 0) || (si[i + 1] === B.bow && sw[i + 1] > 0)) n++;
    return n;
  };
  assert.ok(bowVerts({ hat: 'bow' }) > 100, 'the bow');
  for (const hat of ['none', 'cap', 'capBack', 'beanie']) assert.equal(bowVerts({ hat }), 0, hat);
  // a high pony under a cap comes out low at the back: its hair chain starts lower
  const up = buildCharacter(cleanLook({ hairStyle: 'highPony', hat: 'bow' }), 'high').rest.chain;
  const low = buildCharacter(cleanLook({ hairStyle: 'highPony', hat: 'cap' }), 'high').rest.chain;
  assert.ok(low[0][1] < up[0][1] - 0.1, 'a low pony');
  // short styles have no hair chain to simulate
  for (const s of ['crop', 'curls', 'swoop', 'buzz']) assert.equal(buildCharacter(cleanLook({ hairStyle: s }), 'low').rest.chain, null, s);
});

test('creator icons for every new option: inline SVG, preset colours, no text or links', () => {
  for (const [slot, ids] of Object.entries(NEW)) {
    if (slot === 'pet') continue;
    for (const id of ids) {
      for (const look of [DEFAULT_LOOK, { ...DEFAULT_LOOK, hat: 'beanie', bow: 'rainbow' }, { ...DEFAULT_LOOK, hat: 'none', hair: 'platinum' }]) {
        const s = optionIcon(slot, lookOption(slot, id), look);
        assert.match(s, /^<svg viewBox="0 0 64 64"[^>]*>.*<\/svg>$/s, slot + '.' + id);
        assert.ok(!/href|http|<script|<text|on[a-z]+=|NaN|undefined/i.test(s), slot + '.' + id);
      }
    }
  }
  assert.notEqual(optionIcon('hat', lookOption('hat', 'cap'), DEFAULT_LOOK), optionIcon('hat', lookOption('hat', 'capBack'), DEFAULT_LOOK));
  assert.match(tabIcon('hats'), /^<svg/);
  // the hairstyle tiles show the mini bow only while the bow is worn
  const withBow = optionIcon('hairStyle', lookOption('hairStyle', 'crop'), DEFAULT_LOOK);
  const withCap = optionIcon('hairStyle', lookOption('hairStyle', 'crop'), { ...DEFAULT_LOOK, hat: 'cap' });
  assert.ok(withBow.length > withCap.length);
});
