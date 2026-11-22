import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES, EMOTE_IDS, cleanEmote } from '../js/content/emotes.js';
import { copyProblems } from './content-copy-rules.mjs';

// Contract 3 animation names and Contract 6 sound names.
const ANIMS = new Set(('idle walk run jump fall land wave cheer clap sit dance aww throw catch dodge frozen tagged seek hide base cradle '
  + 'highV lowV tMotion touchdown daggers punch clasp toeTouch pike kickDouble twist liberty heelStretch scorpion bowArrow arabesque').split(' '));
const SFX = new Set(('tap open close toss whoosh sparkle land cradle cheer crowd clap whistle count go bounce throw hit catch pop found '
  + 'freeze unfreeze bowGrab score tada aww firework chime step jump poms').split(' '));

test('emotes: 12 to 16 quick-cheers with unique ids, texts and icons', () => {
  assert.ok(EMOTES.length >= 12 && EMOTES.length <= 16, `${EMOTES.length} emotes`);
  assert.deepEqual(EMOTE_IDS, EMOTES.map((e) => e.id));
  for (const key of ['id', 'text', 'icon', 'iconId']) {
    assert.equal(new Set(EMOTES.map((e) => e[key])).size, EMOTES.length, `${key}s are unique`);
  }
  for (const text of ["Let's go!", 'Over here!', 'Found you!', 'Good game!', 'Full out!', 'Hit zero!']) {
    assert.ok(EMOTES.some((e) => e.text === text), `has "${text}"`);
  }
});

test('emotes: short friendly text, a simple emoji, an icon id, a real animation and sound', () => {
  const problems = [];
  for (const e of EMOTES) {
    assert.match(e.id, /^[a-z][a-zA-Z]+$/, e.id);
    assert.match(e.iconId, /^[a-z]+$/, e.iconId);
    problems.push(...copyProblems(e.text, e.id, { max: 16, praise: true }));
    assert.ok(/[!?]$/.test(e.text), `${e.id} ends with ! or ?`);
    const cps = Array.from(e.icon);
    assert.ok(cps.length >= 1 && cps.length <= 2, `${e.id}: one emoji, at most with a variation selector`);
    assert.ok(cps[0].codePointAt(0) > 0x2000, `${e.id}: icon is an emoji`);
    if (cps[1]) assert.equal(cps[1], '\ufe0f', `${e.id}: only a variation selector may follow`);
    assert.ok(!/[\u200d\u{1f3fb}-\u{1f3ff}]/u.test(e.icon), `${e.id}: no joiners or skin tones`);
    assert.ok(ANIMS.has(e.anim), `${e.id}: anim ${e.anim}`);
    assert.ok(SFX.has(e.sfx), `${e.id}: sfx ${e.sfx}`);
  }
  assert.deepEqual(problems, []);
});

test('emotes: cleanEmote accepts known ids only', () => {
  for (const e of EMOTES) assert.equal(cleanEmote(e.id), e);
  for (const bad of ['', 'nope', 'LETSGO', ' hi', 'hi ', '__proto__', 'constructor', 'toString', 'x'.repeat(5000),
    null, undefined, 3, {}, [], { id: 'hi' }, ['hi']]) {
    assert.equal(cleanEmote(bad), null, `refuses ${typeof bad === 'string' ? JSON.stringify(bad.slice(0, 20)) : typeof bad}`);
  }
});

test('emotes: the list cannot be changed at runtime', () => {
  assert.ok(Object.isFrozen(EMOTES) && EMOTES.every(Object.isFrozen));
  assert.throws(() => {
    'use strict';
    EMOTES[0].text = 'something else';
  });
});
