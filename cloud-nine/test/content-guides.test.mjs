// The glossary and the how-to-play cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOSSARY, TRICKS, MOTIONS, glossaryEntry, trickLabel } from '../js/content/glossary.js';
import { HOWTO, HOWTO_ORDER, howTo, gameTitle } from '../js/content/howto.js';
import { copyProblems } from './content-copy-rules.mjs';

// Every term in the blueprint's glossary.
const BLUEPRINT_TERMS = ['flyer', 'base', 'backSpot', 'basketToss', 'cradle', 'toeTouch', 'pike', 'kickDouble', 'twist',
  'liberty', 'heelStretch', 'scorpion', 'bowArrow', 'arabesque', 'highV', 'lowV', 'tMotion', 'touchdown', 'daggers', 'punch',
  'clasp', 'eightCount', 'hitZero', 'fullOut', 'matTalk'];
// Contract 3 animation names for the flyer tricks and the arm motions.
const TRICK_ANIMS = ['toeTouch', 'pike', 'kickDouble', 'twist', 'liberty', 'heelStretch', 'scorpion', 'bowArrow', 'arabesque'];
const MOTION_ANIMS = ['highV', 'lowV', 'tMotion', 'touchdown', 'daggers', 'punch', 'clasp'];
const KINDS = new Set(['team', 'stunt', 'trick', 'position', 'motion', 'routine', 'gear']);

test('glossary: every blueprint term, explained in one kid-friendly line', () => {
  for (const id of BLUEPRINT_TERMS) assert.ok(glossaryEntry(id), `missing ${id}`);
  assert.equal(new Set(GLOSSARY.map((e) => e.id)).size, GLOSSARY.length, 'unique ids');
  const problems = [];
  for (const e of GLOSSARY) {
    assert.ok(KINDS.has(e.kind), `${e.id}: kind ${e.kind}`);
    problems.push(...copyProblems(e.word, `${e.id} word`, { max: 16 }));
    problems.push(...copyProblems(e.meaning, e.id, { max: 100 }));
    assert.ok(/[.!?]$/.test(e.meaning), `${e.id} ends with punctuation`);
  }
  assert.deepEqual(problems, []);
  assert.match(glossaryEntry('flyer').meaning, /Bailey/);
  assert.equal(glossaryEntry('nope'), null);
  assert.equal(glossaryEntry('__proto__'), null);
});

test('glossary: trick and motion labels match the character animation names', () => {
  assert.deepEqual(Object.keys(TRICKS), TRICK_ANIMS);
  assert.deepEqual(Object.keys(MOTIONS), MOTION_ANIMS);
  for (const id of [...TRICK_ANIMS, ...MOTION_ANIMS]) {
    const label = trickLabel(id);
    assert.ok(label && label.length <= 16 && !/[.!?]/.test(label), `${id}: ${label}`);
    assert.ok(glossaryEntry(id), `${id} is explained in the glossary`);
  }
  assert.equal(trickLabel('toeTouch'), 'toe touch');
  assert.equal(trickLabel('bowArrow'), 'bow and arrow');
  assert.equal(trickLabel('highV'), 'high V');
  for (const bad of ['nope', '__proto__', 'constructor', 'toString', null, 3, {}]) assert.equal(trickLabel(bad), null);
});

test('howto: a card for each game, Hit Zero and the basket toss', () => {
  assert.deepEqual([...HOWTO_ORDER].sort(), Object.keys(HOWTO).sort());
  for (const id of ['hideSeek', 'freezeTag', 'dodgeball', 'captureBow', 'hitZero', 'basketToss']) assert.ok(howTo(id), id);
  const problems = [];
  for (const id of HOWTO_ORDER) {
    const c = HOWTO[id];
    assert.equal(c.id, id);
    assert.equal(c.steps.length, 3, `${id} has 3 steps`);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.steps));
    assert.ok(Array.from(c.icon).length <= 2 && c.icon.codePointAt(0) > 0x2000, `${id} icon`);
    assert.match(c.iconId, /^[a-z]+$/);
    problems.push(...copyProblems(c.title, `${id} title`, { max: 16 }));
    problems.push(...copyProblems(c.blurb, `${id} blurb`, { max: 56, praise: true }));
    problems.push(...copyProblems(c.tip, `${id} tip`, { max: 64, praise: true }));
    c.steps.forEach((s, i) => problems.push(...copyProblems(s, `${id} step ${i + 1}`, { max: 60, praise: true })));
    for (const s of [c.blurb, c.tip, ...c.steps]) assert.ok(/[.!?]$/.test(s), `${id}: "${s}" ends with punctuation`);
  }
  assert.deepEqual(problems, []);
});

test('howto: titles by id, unknown ids are null', () => {
  assert.equal(gameTitle('hideSeek'), 'Hide and Seek');
  assert.equal(gameTitle('freezeTag'), 'Freeze Tag');
  assert.equal(gameTitle('dodgeball'), 'Dodgeball');
  assert.equal(gameTitle('captureBow'), 'Capture the Bow');
  assert.equal(gameTitle('hitZero'), 'Hit Zero');
  assert.equal(gameTitle('basketToss'), 'Basket Toss');
  for (const bad of ['nope', '__proto__', 'hasOwnProperty', null, 1]) {
    assert.equal(howTo(bad), null);
    assert.equal(gameTitle(bad), null);
  }
});
