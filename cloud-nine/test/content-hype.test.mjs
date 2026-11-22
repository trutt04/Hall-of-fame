import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/core/util.js';
import {
  hype, createHype, resetHype, hypeValues, fillTemplate, HYPE_LINES, SITUATIONS, RARE_SITUATIONS,
  HYPE_MAX, HYPE_SHORT_MAX, SHORT_SITUATIONS, PLACEHOLDERS,
} from '../js/content/hype.js';
import { copyProblems } from './content-copy-rules.mjs';

const CONTRACT = [
  'tossLand', 'trick', 'bigToss', 'found', 'hidden', 'freeze', 'unfreeze', 'dodge', 'hit', 'catch', 'grab',
  'score', 'win', 'lose', 'tie', 'birthday', 'welcome', 'idle', 'routineGood', 'routineZero',
];
const COMMON = SITUATIONS.filter((s) => !RARE_SITUATIONS.includes(s));
const TYPICAL = {
  name: 'Maya', target: 'Ava', seeker: 'Leo', tagger: 'Zoe', friend: 'Mia', trick: 'toeTouch',
  tricks: ['pike', 'toeTouch'], height: 14, score: 870, team: 0, game: 'freezeTag', age: 11, days: 3,
  stick: 'skyHigh', count: 3, total: 12, left: 2, bases: 2, misses: 2,
};
const LONGEST = {
  name: 'Crystal Sparkler', target: 'Glitter Hedgehog', seeker: 'Twinkle Sparkler', tagger: 'Shimmer Sparkler',
  friend: 'Moonlit Hedgehog', trick: 'bowArrow', tricks: 9, height: 22, score: 12345, team: 1, game: 'captureBow',
  age: 11, days: 6, stick: 'rainbowEnd', count: 12, total: 12, left: 9, bases: 9, misses: 9,
};
const capFor = (s) => (SHORT_SITUATIONS.includes(s) ? HYPE_SHORT_MAX : HYPE_MAX);
const fitting = (s, ctx) => HYPE_LINES[s].map((t) => fillTemplate(t, hypeValues(ctx, s))).filter((x) => x && x.length <= capFor(s));

test('hype: every Contract 8 situation exists', () => {
  for (const s of CONTRACT) assert.ok(SITUATIONS.includes(s), `missing situation ${s}`);
  for (const s of RARE_SITUATIONS) assert.ok(SITUATIONS.includes(s), `rare situation ${s} has lines`);
});

test('hype: at least 12 lines per common situation, at least 4 per rare one, no duplicates', () => {
  for (const s of COMMON) assert.ok(HYPE_LINES[s].length >= 12, `${s} has ${HYPE_LINES[s].length} lines`);
  for (const s of RARE_SITUATIONS) assert.ok(HYPE_LINES[s].length >= 4, `${s} has ${HYPE_LINES[s].length} lines`);
  for (const s of SITUATIONS) assert.equal(new Set(HYPE_LINES[s]).size, HYPE_LINES[s].length, `${s} repeats a line`);
});

test('hype: placeholders are known, all used, and every situation works with an empty ctx', () => {
  const used = new Set();
  for (const s of SITUATIONS) {
    for (const t of HYPE_LINES[s]) {
      for (const [, key] of t.matchAll(/\{(\w+)\}/g)) {
        assert.ok(PLACEHOLDERS.includes(key), `${s}: unknown placeholder {${key}} in "${t}"`);
        used.add(key);
      }
      assert.ok(/[.!?]$/.test(t), `${s}: ends without punctuation: "${t}"`);
    }
    const bare = fitting(s, {}).length;
    assert.ok(bare >= 3, `${s}: only ${bare} lines work with an empty ctx`);
  }
  for (const key of PLACEHOLDERS) assert.ok(used.has(key), `placeholder {${key}} is never used`);
});

test('hype: every filled line follows the house rules and fits, even with the longest values', () => {
  const problems = [];
  for (const s of SITUATIONS) {
    for (const ctx of [{}, TYPICAL, LONGEST]) {
      for (const line of fitting(s, ctx)) problems.push(...copyProblems(line, s, { max: capFor(s), praise: true }));
    }
    const typical = fitting(s, TYPICAL).length;
    const longest = fitting(s, LONGEST).length;
    assert.equal(typical, HYPE_LINES[s].length, `${s}: some lines do not fit with typical values`);
    assert.ok(longest >= Math.min(8, HYPE_LINES[s].length), `${s}: only ${longest} lines fit the longest values`);
  }
  assert.deepEqual(problems, []);
});

test('hype: lose and tie lines never say anyone lost', () => {
  for (const s of ['lose', 'tie', 'gotFound', 'hit', 'freeze', 'cradle', 'routineOk']) {
    for (const t of HYPE_LINES[s]) assert.ok(!/\b(lose|lost|loser|losing|fail)/i.test(t), `${s}: "${t}"`);
  }
  assert.ok(HYPE_LINES.lose.filter((t) => /so close/i.test(t)).length >= 5, 'plenty of "So close!"');
});

test('hype: no immediate repeats, and no repeat within the last few lines', () => {
  const h = createHype({ memory: 4 });
  const rng = mulberry32(7);
  for (const s of SITUATIONS) {
    const seq = Array.from({ length: 120 }, () => h(s, TYPICAL, rng));
    const window = Math.min(5, fitting(s, TYPICAL).length);
    for (let i = 0; i + window <= seq.length; i++) {
      const slice = seq.slice(i, i + window);
      assert.equal(new Set(slice).size, window, `${s}: repeat within ${window} at ${i}: ${slice.join(' | ')}`);
    }
    assert.ok(new Set(seq).size >= Math.min(10, fitting(s, TYPICAL).length), `${s}: too little variety`);
  }
});

test('hype: even a 2-line pool alternates, and memory is per situation', () => {
  const h = createHype();
  const rng = mulberry32(3);
  let last = '';
  for (let i = 0; i < 50; i++) {
    const s = h('friendLeave', {}, rng); // only a few lines work without a name
    assert.notEqual(s, last);
    last = s;
  }
  const a = h('dodge', {}, () => 0);
  const b = h('catch', {}, () => 0);
  assert.equal(a, HYPE_LINES.dodge[0]);
  assert.equal(b, HYPE_LINES.catch[0], 'a different situation is not blocked by dodge memory');
});

test('hype: the same seed gives the same lines; reset forgets', () => {
  const run = () => {
    const h = createHype();
    const rng = mulberry32(2026);
    return SITUATIONS.map((s) => h(s, TYPICAL, rng));
  };
  assert.deepEqual(run(), run());
  resetHype();
  const first = hype('welcome', {}, () => 0);
  const second = hype('welcome', {}, () => 0);
  assert.notEqual(first, second, 'the shared hype() avoids an immediate repeat');
  resetHype();
  assert.equal(hype('welcome', {}, () => 0), first, 'after reset the same pick is possible again');
});

test('hype: unknown situations and broken arguments still give a cheer', () => {
  for (const s of ['nope', '', null, undefined, 42, {}, '__proto__', 'constructor', 'toString']) {
    const line = hype(s, undefined, () => 0.5);
    assert.ok(HYPE_LINES.cheer.some((t) => fillTemplate(t, hypeValues({})) === line), `${String(s)} -> ${line}`);
  }
  for (const rng of [() => NaN, () => 1, () => -5, 'nope', null]) {
    const line = hype('tossLand', TYPICAL, rng);
    assert.ok(typeof line === 'string' && line.length > 0);
  }
  assert.ok(hype('win', 'not an object').length > 0);
});

test('hype: ctx values are cleaned, clipped and given units', () => {
  const v = hypeValues({
    name: '  <b>{name}</b>\u200b  ', target: 'A'.repeat(40), height: 1, days: 1, misses: 1, bases: 1, tricks: 1,
    team: 1, game: 'captureBow', age: 22, stick: 'skyHigh', score: 1234.4,
  });
  assert.equal(v.name, 'bname/b');
  assert.equal(v.target, 'A'.repeat(16));
  assert.equal(v.height, '1 meter');
  assert.equal(v.days, '1 day');
  assert.equal(v.misses, '1 miss');
  assert.equal(v.bases, '1 friend');
  assert.equal(v.tricks, '1 trick');
  assert.equal(v.team, 'Team Purple');
  assert.equal(v.game, 'Capture the Bow');
  assert.equal(v.ageOrd, '22nd');
  assert.equal(v.stick, 'Sky High Stick');
  assert.equal(v.unlock, 'Space buns hairstyle');
  assert.equal(v.score, '1,234');
  assert.equal(v.world, 'Cloud Nine');
  const w = hypeValues({ tricks: ['pike', 'kickDouble'], height: 22.6, misses: 3, team: 0 });
  assert.equal(w.tricks, '2 tricks');
  assert.equal(w.trick, 'kick double', 'the last trick in the list');
  assert.equal(w.height, '23 meters');
  assert.equal(w.misses, '3 misses');
  assert.equal(w.team, 'Team Pink');
  const bad = hypeValues({ height: NaN, days: 0, age: -1, score: Infinity, team: 7, left: '3', count: true, tricks: [] });
  for (const key of ['height', 'days', 'age', 'ageOrd', 'score', 'team', 'left', 'count', 'tricks', 'trick']) {
    assert.equal(bad[key], undefined, `${key} is skipped`);
  }
  assert.equal(hypeValues({ trick: 'highV' }).trick, 'high V');
  assert.equal(hypeValues({ trick: 'Super Spin' }).trick, 'Super Spin');
});

test('hype: lines with names, tricks and heights read right', () => {
  assert.equal(fillTemplate('{trick}!', hypeValues({ trick: 'toeTouch' })), 'Toe touch!');
  assert.equal(fillTemplate('{height} up and you stuck it!', hypeValues({ height: 14 })), '14 meters up and you stuck it!');
  assert.equal(fillTemplate('Hi, {name}!', hypeValues({})), null);
  assert.equal(fillTemplate("It's {name}'s birthday! Everybody cheer!", hypeValues({}, 'birthday')), "It's Bailey's birthday! Everybody cheer!");
  assert.equal(fillTemplate('Happy {ageOrd} birthday, {name}!', hypeValues({ age: 11 }, 'birthday')), 'Happy 11th birthday, Bailey!');
  const h = createHype();
  for (let i = 0; i < 40; i++) {
    const line = h('found', { target: 'Ava', left: 2 }, Math.random);
    assert.ok(!/[{}]/.test(line), line);
  }
});
