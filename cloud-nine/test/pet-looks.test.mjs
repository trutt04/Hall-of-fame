// The cloud puppy in the look: the `pet` slot through cleanLook (hostile network input), the
// 600-character network limit, randomLook (never a pet: bots don't get one) and the spirit stick lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_OPTIONS, DEFAULT_LOOK, cleanLook, randomLook } from '../js/art/character-looks.js';
import { encodeLook, decodeLook, cleanLookWith } from '../js/net/validate.js';
import { lockedLooks } from '../js/world/sticks.js';
import { SPIRIT_STICKS, stickById } from '../js/content/collectibles.js';
import { wantsPet } from '../js/world/pets.js';

test('the pet slot: no pet by default, the cloud puppy or the mini husky', () => {
  assert.deepEqual(LOOK_OPTIONS.pet.map((o) => o.id), ['none', 'cloudPuppy', 'husky']);
  assert.deepEqual(LOOK_OPTIONS.pet.map((o) => o.label), ['No pet', 'Cloud puppy', 'Mini husky']);
  assert.equal(DEFAULT_LOOK.pet, 'none');
  assert.equal(cleanLook({}).pet, 'none');
  assert.equal(cleanLook({ pet: 'cloudPuppy' }).pet, 'cloudPuppy');
  assert.equal(cleanLook({ ...DEFAULT_LOOK, pet: 'cloudPuppy' }).bow, DEFAULT_LOOK.bow);
});

test('cleanLook drops junk and unknown pets, and a bad pet never spoils the rest', () => {
  const junk = [
    'dragon', 'kitten', 'unicorn', 'CloudPuppy', 'cloudpuppy', ' cloudPuppy', 'cloudPuppy ', 'cloudPuppy\u0000', 'cloud Puppy',
    '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'x'.repeat(40), 'cloudPuppy'.repeat(100000),
    0, 1, -1, NaN, Infinity, true, false, null, undefined, {}, { id: 'cloudPuppy' }, ['cloudPuppy'], () => 'cloudPuppy', Symbol('pet'), 7n,
  ];
  for (const pet of junk) {
    const out = cleanLook({ bow: 'teal', pet });
    assert.equal(out.pet, 'none', String(typeof pet) + ' ' + String(pet).slice(0, 20));
    assert.equal(out.bow, 'teal', 'the rest of the look survives a bad pet');
  }
  // inherited and throwing pets are not the sender's
  assert.equal(cleanLook(Object.create({ pet: 'cloudPuppy' })).pet, 'none');
  const tricky = { hair: 'blue' };
  Object.defineProperty(tricky, 'pet', { enumerable: true, get() { throw new Error('boom'); } });
  assert.equal(cleanLook(tricky).pet, 'none');
  assert.equal(cleanLook(tricky).hair, 'blue');
  const evil = JSON.parse('{"__proto__": {"pet": "cloudPuppy"}, "pet": "__proto__"}');
  assert.equal(cleanLook(evil).pet, 'none');
  assert.equal({}.pet, undefined);
});

test('a look with a pet stays well under the 600-character network limit, and survives the trip', () => {
  // the longest id in every slot
  const longest = {};
  for (const [slot, list] of Object.entries(LOOK_OPTIONS)) longest[slot] = list.reduce((a, o) => (o.id.length > a.length ? o.id : a), '');
  const look = cleanLook(longest);
  assert.equal(look.pet, 'cloudPuppy');
  const json = JSON.stringify(look);
  assert.ok(json.length < 400, 'look JSON is ' + json.length + ' characters');
  assert.equal(Object.keys(look).length, 13); // 13 slots since the hat
  // through NET's encode/decode with the real cleaner, as a friend's device sees it
  const back = decodeLook(encodeLook(look), cleanLook);
  assert.deepEqual(back, look);
  assert.equal(decodeLook(encodeLook({ ...look, pet: 'wolf' }), cleanLook).pet, 'none');
  assert.equal(cleanLookWith({ pet: 'cloudPuppy', junk: 'x'.repeat(5000) }, cleanLook).pet, 'cloudPuppy');
});

test('randomLook never gives a pet: bots and "Surprise me!" looks have none', () => {
  let s = 1;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) assert.equal(randomLook(rng).pet, 'none');
  for (const r of [() => 0, () => 0.999999, () => NaN, null]) assert.equal(randomLook(r).pet, 'none');
});

test('wantsPet: only the cloud puppy', () => {
  assert.equal(wantsPet({ pet: 'cloudPuppy' }), true);
  for (const l of [{ pet: 'none' }, { pet: 'dragon' }, {}, null, undefined, 'cloudPuppy', { pet: ['cloudPuppy'] }]) assert.equal(wantsPet(l), false);
});

test('the cloud puppy is locked until Rainbow\'s End is found, with that stick\'s hint', () => {
  const stick = stickById('rainbowEnd');
  assert.ok(stick, 'the 12th stick');
  assert.equal(SPIRIT_STICKS[SPIRIT_STICKS.length - 1].id, 'rainbowEnd', 'it is the last one');
  assert.deepEqual({ ...stick.unlock }, { slot: 'pet', id: 'cloudPuppy', label: 'Cloud puppy pet' });
  assert.equal(stick.unlock.later, undefined, 'not "later" any more');
  // nothing found: the pet is locked with the hint
  const none = lockedLooks(SPIRIT_STICKS, []);
  assert.ok(none.pet && none.pet.cloudPuppy, 'locked');
  assert.equal(none.pet.cloudPuppy.stick, 'rainbowEnd');
  assert.equal(none.pet.cloudPuppy.hint, stick.hint);
  assert.equal(none.pet.cloudPuppy.name, stick.name);
  assert.equal(none.pet.none, undefined, '"No pet" is never locked');
  // every other stick found: only the puppy is left
  const others = SPIRIT_STICKS.filter((s) => s.id !== 'rainbowEnd').map((s) => s.id);
  assert.deepEqual(Object.keys(lockedLooks(SPIRIT_STICKS, others)), ['pet']);
  // found: unlocked
  const got = lockedLooks(SPIRIT_STICKS, ['rainbowEnd']);
  assert.equal(got.pet, undefined);
  assert.deepEqual(lockedLooks(SPIRIT_STICKS, SPIRIT_STICKS.map((s) => s.id)), {});
});
