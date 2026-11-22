// Looks: the preset options, Bailey's default outfit, cleanLook (hostile input) and randomLook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_OPTIONS, LOOK_SLOTS, DEFAULT_LOOK, cleanLook, randomLook, lookOption, lookKey } from '../js/art/character-looks.js';

const SLOTS = ['skin', 'hair', 'hairStyle', 'bow', 'bowPattern', 'bowSize', 'top', 'bottom', 'shoes', 'socks', 'sparkle', 'pet'];
const isValid = (look) => SLOTS.every((s) => LOOK_OPTIONS[s].some((o) => o.id === look[s]));

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

test('every slot has preset options with unique ids, labels and colors', () => {
  assert.deepEqual([...LOOK_SLOTS].sort(), [...SLOTS].sort());
  for (const slot of SLOTS) {
    const list = LOOK_OPTIONS[slot];
    assert.ok(Array.isArray(list) && list.length >= (slot === 'pet' ? 2 : 3), slot); // a pet or none
    const ids = new Set();
    for (const o of list) {
      assert.equal(typeof o.id, 'string');
      assert.ok(o.id.length > 0 && o.id.length <= 32, o.id);
      assert.ok(!ids.has(o.id), 'duplicate ' + o.id);
      ids.add(o.id);
      assert.equal(typeof o.label, 'string');
      assert.ok(o.label.length > 0 && o.label.length <= 24, o.label);
      for (const k of ['color', 'dark', 'accent', 'trim', 'sole', 'lace']) {
        if (o[k] !== undefined) assert.match(o[k], /^#[0-9a-f]{6}$/i, `${slot}.${o.id}.${k}`);
      }
      for (const k of ['stones', 'specks', 'stripes', 'rainbow']) {
        if (o[k] !== undefined) for (const c of o[k]) assert.match(c, /^#[0-9a-f]{6}$/i);
      }
    }
  }
  assert.equal(LOOK_OPTIONS.skin.length, 8);
  assert.equal(LOOK_OPTIONS.hair.length, 10);
  assert.equal(LOOK_OPTIONS.hairStyle.length, 7);
  assert.equal(LOOK_OPTIONS.bow.length, 9);
  assert.equal(LOOK_OPTIONS.bowPattern.length, 8);
  assert.deepEqual(LOOK_OPTIONS.bowSize.map((o) => o.id), ['big', 'huge', 'ridiculous', 'mega']);
  for (let i = 1; i < LOOK_OPTIONS.bowSize.length; i++) assert.ok(LOOK_OPTIONS.bowSize[i].scale > LOOK_OPTIONS.bowSize[i - 1].scale, 'the bigger the better');
  assert.deepEqual(LOOK_OPTIONS.sparkle.map((o) => o.id), ['none', 'some', 'max', 'gold']);
  for (const id of ['pink', 'lilac', 'blue']) assert.ok(LOOK_OPTIONS.hair.some((o) => o.id === id), 'hair ' + id);
});

test('the ids that spirit-stick unlocks refer to all exist (CONTENT)', () => {
  const unlocks = {
    bowPattern: ['hearts', 'rhinestones', 'rainbow', 'polkaDots'], bow: ['lavender'], bowSize: ['mega'],
    hairStyle: ['spaceBuns'], shoes: ['glitter'], socks: ['rainbow'], top: ['purpleSparkle'], sparkle: ['gold'],
  };
  for (const [slot, ids] of Object.entries(unlocks)) {
    for (const id of ids) {
      assert.ok(LOOK_OPTIONS[slot].some((o) => o.id === id), `${slot}.${id}`);
      assert.equal(cleanLook({ [slot]: id })[slot], id, `${slot}.${id} survives cleanLook`);
    }
  }
});

test('the options and the default are frozen', () => {
  assert.ok(Object.isFrozen(LOOK_OPTIONS) && Object.isFrozen(LOOK_OPTIONS.bow) && Object.isFrozen(LOOK_OPTIONS.bow[0]));
  assert.ok(Object.isFrozen(DEFAULT_LOOK));
  assert.throws(() => { 'use strict'; DEFAULT_LOOK.bow = 'gold'; });
});

test("DEFAULT_LOOK is Bailey's real outfit", () => {
  assert.ok(isValid(DEFAULT_LOOK));
  assert.equal(DEFAULT_LOOK.hairStyle, 'highPony');
  assert.equal(DEFAULT_LOOK.hair, 'darkBrown');
  assert.equal(DEFAULT_LOOK.bow, 'pink');
  assert.equal(DEFAULT_LOOK.bowPattern, 'stars');
  assert.equal(lookOption('bow', DEFAULT_LOOK.bow).accent.toLowerCase(), '#17121c', 'small black stars');
  assert.equal(DEFAULT_LOOK.bowSize, 'big');
  const top = lookOption('top', DEFAULT_LOOK.top);
  assert.equal(top.style, 'crop');
  assert.equal(top.color.toLowerCase(), '#17121c', 'a black crop top');
  assert.equal(top.stones.length, 3, 'rhinestones in pink, purple and silver');
  assert.equal(DEFAULT_LOOK.bottom, 'shorts-pink');
  assert.equal(DEFAULT_LOOK.shoes, 'cheer-black');
  assert.equal(DEFAULT_LOOK.socks, 'sparkle-black');
});

test('cleanLook keeps a valid look and returns a fresh object', () => {
  const look = { skin: 'tone6', hair: 'lilac', hairStyle: 'spaceBuns', bow: 'rainbow', bowPattern: 'hearts', bowSize: 'ridiculous', top: 'hoodie-pink', bottom: 'skirt-purple', shoes: 'sneakers-pink', socks: 'rainbow', sparkle: 'max', pet: 'cloudPuppy' };
  const out = cleanLook(look);
  assert.deepEqual(out, look);
  assert.notEqual(out, look);
  const d = cleanLook(DEFAULT_LOOK);
  assert.deepEqual(d, { ...DEFAULT_LOOK });
  assert.notEqual(d, DEFAULT_LOOK);
  assert.ok(!Object.isFrozen(d));
  assert.deepEqual(Object.keys(out).sort(), [...SLOTS].sort());
});

test('cleanLook turns non-objects into the default look', () => {
  for (const raw of [undefined, null, 0, 42, NaN, '', 'pink', true, [], ['skin'], () => 1, Symbol('x'), 10n]) {
    assert.deepEqual(cleanLook(raw), { ...DEFAULT_LOOK }, String(typeof raw));
  }
});

test('cleanLook falls back slot by slot', () => {
  const out = cleanLook({ skin: 'tone8', hair: 'green', bow: 'gold', top: 42, bottom: null, shoes: { id: 'cheer-white' }, socks: ['white'], sparkle: true, extra: 'x' });
  assert.equal(out.skin, 'tone8');
  assert.equal(out.bow, 'gold');
  assert.equal(out.hair, DEFAULT_LOOK.hair);
  for (const s of ['top', 'bottom', 'shoes', 'socks', 'sparkle', 'hairStyle', 'bowPattern', 'bowSize']) assert.equal(out[s], DEFAULT_LOOK[s], s);
  assert.equal(out.extra, undefined);
});

test('cleanLook rejects huge strings, case tricks and near misses', () => {
  const out = cleanLook({ skin: 'tone1'.repeat(200000), hair: 'Black', hairStyle: ' highPony', bow: 'pink\u0000', bowPattern: 'stars ', bowSize: 'ridiculous'.padEnd(40, '!') });
  assert.deepEqual(out, { ...DEFAULT_LOOK });
});

test('cleanLook is safe against prototype tricks', () => {
  const evil = JSON.parse('{"__proto__": {"skin": "tone8", "polluted": true}, "constructor": {"prototype": {"polluted": true}}, "hair": "__proto__", "bow": "constructor", "top": "toString", "bottom": "hasOwnProperty", "shoes": "valueOf"}');
  const out = cleanLook(evil);
  assert.deepEqual(out, { ...DEFAULT_LOOK });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  // inherited values are not the sender's: they are ignored
  Object.prototype.skin = 'tone8';
  try {
    assert.equal(cleanLook({}).skin, DEFAULT_LOOK.skin);
    assert.equal(cleanLook(Object.create({ bow: 'gold' })).bow, DEFAULT_LOOK.bow);
  } finally {
    delete Object.prototype.skin;
  }
  const bare = Object.create(null);
  bare.bow = 'teal';
  assert.equal(cleanLook(bare).bow, 'teal');
});

test('cleanLook survives throwing getters and hostile proxies', () => {
  const look = { hair: 'blue' };
  Object.defineProperty(look, 'skin', { enumerable: true, get() { throw new Error('boom'); } });
  const out = cleanLook(look);
  assert.equal(out.skin, DEFAULT_LOOK.skin);
  assert.equal(out.hair, 'blue');
  const trap = () => { throw new Error('trap'); };
  const proxy = new Proxy({}, { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
  assert.deepEqual(cleanLook(proxy), { ...DEFAULT_LOOK });
  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.deepEqual(cleanLook(revoked), { ...DEFAULT_LOOK });
  assert.deepEqual(cleanLook(Object.freeze({ bow: 'white' })).bow, 'white');
});

test('randomLook is always valid and deterministic with a seeded rng', () => {
  const r1 = seeded(5), r2 = seeded(5);
  for (let i = 0; i < 300; i++) {
    const a = randomLook(r1), b = randomLook(r2);
    assert.ok(isValid(a));
    assert.deepEqual(a, b);
    assert.deepEqual(cleanLook(a), a);
  }
});

test('randomLook reaches every option', () => {
  const seen = Object.fromEntries(SLOTS.map((s) => [s, new Set()]));
  const r = seeded(11);
  for (let i = 0; i < 4000; i++) {
    const l = randomLook(r);
    for (const s of SLOTS) seen[s].add(l[s]);
  }
  // every option but a pet: pets are won, never random (bots don't get one)
  for (const s of SLOTS) assert.equal(seen[s].size, s === 'pet' ? 1 : LOOK_OPTIONS[s].length, s);
  assert.deepEqual([...seen.pet], ['none']);
});

test('randomLook copes with broken random functions', () => {
  for (const rng of [() => NaN, () => 1, () => -5, () => 7.5, () => { throw new Error('x'); }, 'nope', null, undefined, () => '0.5']) {
    assert.ok(isValid(randomLook(rng)));
  }
});

test('lookOption and lookKey', () => {
  assert.equal(lookOption('bow', 'gold').label, 'Gold');
  assert.equal(lookOption('bow', 'nope').id, DEFAULT_LOOK.bow);
  assert.equal(lookOption('nope', 'gold'), null);
  assert.equal(lookKey(DEFAULT_LOOK), lookKey({ ...DEFAULT_LOOK }));
  assert.notEqual(lookKey(DEFAULT_LOOK), lookKey({ ...DEFAULT_LOOK, bowSize: 'huge' }));
  assert.equal(lookKey(null), lookKey(DEFAULT_LOOK));
});
