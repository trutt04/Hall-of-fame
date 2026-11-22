// Names and the blocklist. These tests never print a blocked word: messages use list indexes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../js/core/util.js';
import { NICK_FIRST, NICK_SECOND, NICK_MAX, NICK_MAX_ANY, randomNick, isGeneratedNick, cleanNick } from '../js/content/names.js';
import { isBlocked, blockedEntries, BLOCKLIST_SIZE } from '../js/content/blocklist.js';

const { anywhere, words } = blockedEntries();

test('names: about 40 by 40 cute words, every pair a valid nickname', () => {
  assert.equal(NICK_FIRST.length, 40);
  assert.equal(NICK_SECOND.length, 40);
  for (const list of [NICK_FIRST, NICK_SECOND]) {
    assert.equal(new Set(list.map((w) => w.toLowerCase())).size, list.length, 'no duplicates');
    for (const w of list) assert.match(w, /^[A-Z][a-z]+$/, w);
  }
  for (const a of NICK_FIRST) {
    for (const b of NICK_SECOND) {
      const nick = `${a} ${b}`;
      assert.ok(nick.length <= NICK_MAX_ANY, `${nick} is too long`);
      assert.equal(cleanNick(nick), nick);
      assert.equal(isGeneratedNick(nick.toLowerCase()), nick);
    }
  }
});

test('names: randomNick is seeded, varied and never doubles a word', () => {
  const draw = (seed) => {
    const rng = mulberry32(seed);
    return Array.from({ length: 300 }, () => randomNick(rng));
  };
  assert.deepEqual(draw(11), draw(11));
  const nicks = draw(12);
  assert.ok(new Set(nicks).size > 200, 'plenty of different names');
  for (const n of nicks) {
    const [a, b] = n.split(' ');
    assert.ok(NICK_FIRST.includes(a) && NICK_SECOND.includes(b), n);
    assert.notEqual(a.slice(0, 4).toLowerCase(), b.slice(0, 4).toLowerCase(), n);
  }
  for (const rng of [() => NaN, () => 1, () => -1, undefined]) assert.ok(isGeneratedNick(randomNick(rng)));
});

test('cleanNick: trims, collapses spaces, capitalizes, allows accents', () => {
  assert.equal(cleanNick('  zippy   zebra '), 'Zippy Zebra');
  assert.equal(cleanNick('zo\u00eb'), 'Zo\u00eb');
  assert.equal(cleanNick('Jose\u0301'), 'Jos\u00e9', 'decomposed accents are composed');
  assert.equal(cleanNick('mcKenna'), 'McKenna');
  assert.equal(cleanNick('BB'), 'BB');
  assert.equal(cleanNick('Twelve Chars'), 'Twelve Chars');
  assert.equal(cleanNick('a\tb'), 'A B', 'any whitespace collapses to one space');
  assert.equal(cleanNick('Hi\nThere'), 'Hi There');
  assert.equal(cleanNick('glitter   UNICORN'), 'Glitter Unicorn', 'generated pairs may be up to 16');
});

test('cleanNick: letters and spaces only, at most 12 characters', () => {
  assert.equal(NICK_MAX, 12);
  for (const bad of ['', '   ', 'Thirteen Char', 'Bailey!', 'B4iley', 'Bailey_Rose', 'Ava-Mae', "D'Andre", 'Ava.', '\u{1F380}Bow',
    'Zero\u200bWidth', '\u0410\u043d\u043d\u0430', 'A\u00d7B', '<b>', 'Ava\u0000', null, undefined, 12, {}, ['Ava'], 'x'.repeat(100)]) {
    assert.equal(cleanNick(bad), null, `refuses ${JSON.stringify(typeof bad === 'string' ? bad : typeof bad)}`);
  }
});

test('cleanNick: real names and cute words with tricky letters inside are fine', () => {
  for (const ok of ['Cassie', 'Cassidy', 'Grass Hopper', 'Classy', 'Sassy', 'Bass', 'Fatima', 'Skill', 'Killian', 'Bumblebee',
    'Buttercup', 'Scrappy', 'Michelle', 'Hello', 'Raccoon', 'Whatever', 'Analia', 'Titus', 'Essex', 'Closer', 'Therapist',
    'Adam Ninja', 'Peacock', 'Cockatoo', 'Cumulus', 'Fuchsia', 'Boo Boo', 'Dickens', 'Shelly', 'Hannah', 'Ashley', 'Sasha',
    'Matilda', 'Nadia', 'Vanessa', 'Clarissa', 'Pippa', 'Dante', 'Hayden', 'Kinsley', 'Analise', 'Tessa', 'Bailey']) {
    assert.equal(cleanNick(ok), ok, ok);
  }
});

// Spelling tricks a kid might try, each applied to every entry.
const LEET = { o: '0', i: '1', l: '1', e: '3', a: '4', s: '5', t: '7' };
const LOOKALIKE = { a: '\u0430', e: '\u0435', o: '\u043e', c: '\u0441', p: '\u0440' };
const ACCENT = { a: '\u00e1', e: '\u00e9', i: '\u00ed', o: '\u00f3', u: '\u00fa' };
const swap = (w, map) => Array.from(w, (ch) => map[ch] || ch).join('');
const VARIANTS = {
  plain: (w) => w,
  capitalized: (w) => w.charAt(0).toUpperCase() + w.slice(1),
  upper: (w) => w.toUpperCase(),
  spaced: (w) => w.split('').join(' '),
  dotted: (w) => w.split('').join('.'),
  leet: (w) => swap(w, LEET),
  lookalike: (w) => swap(w, LOOKALIKE),
  accents: (w) => swap(w, ACCENT),
  stretched: (w) => Array.from(w, (ch) => ch + ch).join(''),
  inName: (w) => `Super ${w}`,
};

test('blocklist: every entry is caught however it is spelled (indexes only, no words printed)', () => {
  assert.equal(BLOCKLIST_SIZE.anywhere, anywhere.length);
  assert.equal(BLOCKLIST_SIZE.words, words.length);
  assert.ok(anywhere.length >= 40 && words.length >= 60);
  for (const [listName, list] of [['anywhere', anywhere], ['words', words]]) {
    list.forEach((w, i) => {
      for (const [variant, make] of Object.entries(VARIANTS)) {
        const text = make(w);
        assert.ok(isBlocked(text) === true, `${listName} #${i}: ${variant} not caught`);
        if (/^[\p{L} ]+$/u.test(text) && !/[\u0400-\u04ff]/.test(text)) {
          assert.ok(cleanNick(text) === null, `${listName} #${i}: cleanNick let the ${variant} spelling through`);
        }
      }
      assert.ok(isBlocked(w + 's') === true, `${listName} #${i}: plural not caught`);
    });
  }
  anywhere.forEach((w, i) => {
    assert.ok(isBlocked(`zz${w}zz`) === true, `anywhere #${i}: hidden inside a word not caught`);
    assert.ok(isBlocked(`${w.slice(0, 2)} ${w.slice(2)}`) === true, `anywhere #${i}: split by a space not caught`);
  });
});

test('blocklist: sentences are checked word by word, so innocent phrases pass', () => {
  for (const ok of ["She's hit zero!", 'Grandma is so proud of you, flyer!', 'Hello from Essex, sweet pea!', 'Class act!',
    'You are a superstar', 'Fly high, Bailey!', 'Adam never misses a cheer']) {
    assert.equal(isBlocked(ok, { squash: false }), false, ok);
  }
  words.forEach((w, i) => assert.ok(isBlocked(`you are such a ${w} today`, { squash: false }) === true, `words #${i} in a sentence`));
  assert.equal(isBlocked(''), false);
  assert.equal(isBlocked(null), false);
  assert.equal(isBlocked(42), false);
});

test('blocklist: the words never sit in plain text in the source file', () => {
  const src = readFileSync(new URL('../js/content/blocklist.js', import.meta.url), 'utf8').toLowerCase();
  anywhere.forEach((w, i) => {
    if (w.length >= 4) assert.ok(!src.includes(w), `anywhere #${i} appears in plain text`);
  });
});
