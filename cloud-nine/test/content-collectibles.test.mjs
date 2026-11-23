import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../js/config.js';
import {
  SPIRIT_STICKS, SPIRIT_STICK_IDS, stickById, cleanFoundSticks, unlocksFor, nextHint,
} from '../js/content/collectibles.js';
import { copyProblems } from './content-copy-rules.mjs';

// Contract 1 places ids, plus 'edge' (ISLAND's pick of a spot on the rim).
const PLACES = new Set(['plaza', 'gym', 'stage', 'tossPads', 'slides', 'hideGarden', 'court', 'bowField', 'tagZone', 'edge']);
// Contract 3 look slots, plus 'pet' (phase 2).
const SLOTS = new Set(['skin', 'hair', 'hairStyle', 'bow', 'bowPattern', 'bowSize', 'top', 'bottom', 'shoes', 'socks', 'sparkle', 'pet']);

test('spirit sticks: 12, each with a name, a hint, a place and an unlock', () => {
  assert.equal(SPIRIT_STICKS.length, 12);
  assert.deepEqual(SPIRIT_STICK_IDS, SPIRIT_STICKS.map((s) => s.id));
  assert.equal(new Set(SPIRIT_STICK_IDS).size, 12);
  assert.equal(new Set(SPIRIT_STICKS.map((s) => s.name)).size, 12);
  assert.equal(new Set(SPIRIT_STICKS.map((s) => s.hint)).size, 12);
  const problems = [];
  for (const s of SPIRIT_STICKS) {
    assert.match(s.id, /^[a-z][a-zA-Z]+$/);
    assert.ok(s.name.endsWith(' Stick'), s.name);
    assert.ok(Object.prototype.hasOwnProperty.call(PALETTE, s.color), `${s.id}: color ${s.color}`);
    assert.ok(PLACES.has(s.where.place), `${s.id}: place ${s.where.place}`);
    if (s.where.place === 'tossPads' || s.where.place === 'slides') assert.ok(Number.isInteger(s.where.index), `${s.id}: index`);
    assert.ok(SLOTS.has(s.unlock.slot), `${s.id}: slot ${s.unlock.slot}`);
    assert.match(s.unlock.id, /^[a-z][a-zA-Z]+$/);
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.where) && Object.isFrozen(s.unlock));
    problems.push(...copyProblems(s.name, `${s.id} name`, { max: 24 }));
    problems.push(...copyProblems(s.hint, `${s.id} hint`, { max: 80 }));
    problems.push(...copyProblems(s.unlock.label, `${s.id} unlock`, { max: 28 }));
    assert.ok(/[.!?]$/.test(s.hint), `${s.id}: hint ends with punctuation`);
  }
  assert.deepEqual(problems, []);
});

test('spirit sticks: one on each toss target cloud, highest last; unlocks cover bows, colors, a hairstyle and a pet', () => {
  const targets = SPIRIT_STICKS.filter((s) => s.where.place === 'tossPads');
  assert.deepEqual(targets.map((s) => [s.where.index, s.where.spot]), [[0, 'target'], [1, 'target'], [2, 'target']]);
  const unlocks = SPIRIT_STICKS.map((s) => s.unlock);
  assert.equal(new Set(unlocks.map((u) => `${u.slot}:${u.id}`)).size, 12, 'every unlock is different');
  assert.ok(unlocks.filter((u) => u.slot === 'bowPattern').length >= 3, 'bow patterns');
  assert.equal(unlocks.filter((u) => u.slot === 'hairStyle').length, 1, 'a hairstyle');
  const pets = unlocks.filter((u) => u.slot === 'pet');
  assert.equal(pets.length, 1);
  assert.equal(pets[0].id, 'cloudPuppy');
  assert.equal(unlocks.filter((u) => u.later).length, 0, 'nothing waits for later: the cloud puppy is built');
});

test('spirit sticks: saved progress is cleaned, and hints point to the next one', () => {
  assert.equal(stickById('skyHigh').name, 'Sky High Stick');
  for (const bad of ['nope', '__proto__', 'constructor', null, 7]) assert.equal(stickById(bad), null);
  assert.deepEqual(cleanFoundSticks(['skyHigh', 'party', 'nope', 'party', 5, null, { id: 'gym' }]), ['party', 'skyHigh']);
  for (const bad of [null, undefined, 'party', { 0: 'party' }, 12]) assert.deepEqual(cleanFoundSticks(bad), []);
  assert.deepEqual(cleanFoundSticks([...SPIRIT_STICK_IDS].reverse()), SPIRIT_STICK_IDS);
  assert.deepEqual(unlocksFor(['party']), [SPIRIT_STICKS[0].unlock]);
  assert.deepEqual(unlocksFor('nope'), []);
  assert.equal(nextHint([]), SPIRIT_STICKS[0].hint);
  assert.equal(nextHint(['party']), SPIRIT_STICKS[1].hint);
  assert.equal(nextHint(SPIRIT_STICK_IDS), null);
  assert.equal(nextHint('garbage'), SPIRIT_STICKS[0].hint);
});
