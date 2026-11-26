// The private gift link (js/core/gift.js): the codec, the validator, and what the game takes from
// a gift (notes, birthday, bot friends, pet names, the unwrap card). Pure, under node --test.
// Every name here is made up. Real family names never go in the repo: they ride in the link.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GIFT_KEY, GIFT_LIMITS, PET_IDS, encodeGift, decodeGift, validateGift, giftLink, giftBirthday, pickNotes,
  botNickFor, botNicks, petName, readGiftFromUrl, getGift, clearGift, unwrapDue, markUnwrapped, useGiftStorage,
} from '../js/core/gift.js';
import { BIRTHDAY } from '../js/config.js';
import { birthdayInfo } from '../js/content/birthday.js';
import { familyNotes } from '../js/content/notes.js';
import { cleanNick, randomNick } from '../js/content/names.js';
import { blockedEntries } from '../js/content/blocklist.js';
import { createNet } from '../js/net/index.js';

const C9 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GIFT = Object.freeze({
  v: 1,
  to: 'Zuzu',
  from: 'Uncle Wobble',
  birthday: { month: 12, day: 3, year: 2015 },
  notes: [
    { from: 'Grandpa Zork', text: 'Happy birthday, superstar flyer! We love you to the moon and back 🌙💖' },
    { from: 'Mom and Dad', text: "You're our #1 flyer. Keep shining! ✨ 👨‍👩‍👧" },
  ],
  friends: ['Pip', 'Grandpa Zork', 'Mary-Kate', 'Grandma Fizzle', 'Bo', 'Tig', 'Lumi'],
  petNames: { cloudPuppy: 'Biscuit', husky: 'Snowball' },
});
const valid = (raw) => validateGift(raw).gift;
const reasons = (raw) => validateGift(raw).dropped.map((d) => d.path + ': ' + d.reason);
const noteOf = (text, from = 'Grandpa Zork') => validateGift({ v: 1, notes: [{ from, text }] });
const keptText = (text) => {
  const r = noteOf(text);
  return r.gift && r.gift.notes ? r.gift.notes[0].text : null;
};

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}
function fakePage(href) {
  const hist = {
    state: { page: 1 },
    calls: [],
    replaceState(state, title, url) {
      this.calls.push({ state, title, url });
    },
  };
  const at = href.indexOf('#');
  return { loc: { href, hash: at < 0 ? '' : href.slice(at) }, hist };
}

// ---------------------------------------------------------------------------------------- codec

test('gift: encode and decode round trip a whole gift, accents and emoji included', () => {
  const clean = valid(GIFT);
  assert.deepEqual(clean, JSON.parse(JSON.stringify(GIFT)), 'a good gift passes the validator unchanged');
  const code = encodeGift(clean);
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'base64url: safe in a URL fragment, no padding');
  assert.deepEqual(decodeGift(code), clean);
  const accents = valid({ v: 1, to: 'Zoë', from: 'Tía José', friends: ['Renée', 'Ño'] });
  assert.deepEqual(decodeGift(encodeGift(accents)), { v: 1, to: 'Zoë', from: 'Tía José', friends: ['Renée', 'Ño'] });
  const link = giftLink(clean, 'https://example.test/cloud-nine/#old');
  assert.ok(link.startsWith('https://example.test/cloud-nine/#gift='), link.slice(0, 60));
  assert.deepEqual(decodeGift(link.split('#gift=')[1]), clean);
});

test('gift: decodeGift returns null for junk, never throws', () => {
  const bad = [
    undefined, null, 42, {}, [], '', '!!!', 'a', 'abcde', '====', 'ab+/cd', 'eyJ2IjoxfQ==', ' eyJ2IjoxfQ',
    Buffer.from('not json').toString('base64url'),
    Buffer.from([0xff, 0xfe, 0x7b, 0x7d]).toString('base64url'), // not UTF-8
    Buffer.from('[1,2,3]').toString('base64url'),
    Buffer.from('{"v":2}').toString('base64url'),
    Buffer.from('{"v":"1"}').toString('base64url'),
    'A'.repeat(20000),
  ];
  for (const s of bad) assert.equal(decodeGift(s), null, 'junk: ' + String(s).slice(0, 30));
  assert.deepEqual(decodeGift(Buffer.from('{"v":1}').toString('base64url')), { v: 1 }, 'a bare gift is fine');
});

// ---------------------------------------------------------------------------------------- validator

test('validator: junk and wrong types are refused or dropped, quietly and with a reason', () => {
  for (const raw of [null, undefined, 'gift', 7, true, [], [GIFT], { v: 2 }, { v: '1' }, { to: 'Zuzu' }]) {
    const r = validateGift(raw);
    assert.equal(r.gift, null, JSON.stringify(raw));
    assert.equal(r.dropped.length, 1);
  }
  const r = validateGift({
    v: 1, to: 42, from: ['Uncle Wobble'], birthday: '12/3/2015', notes: 'hello', friends: { a: 'Pip' }, petNames: ['Biscuit'], color: 'pink',
  });
  assert.deepEqual(r.gift, { v: 1 }, 'nothing usable, but still a gift');
  assert.deepEqual(r.dropped.map((d) => d.path).sort(), ['birthday', 'color', 'friends', 'from', 'notes', 'petNames', 'to']);
  const notes = validateGift({ v: 1, notes: [1, null, 'hi', [], { text: 'Hi!' }, { from: 'Bo' }, { from: 'Bo', text: 5 }, { from: 'Bo', text: 'Hi!', mood: 'happy' }] });
  assert.deepEqual(notes.gift.notes, [{ from: 'Bo', text: 'Hi!' }], 'only the good note stays, without its extra key');
  assert.deepEqual(notes.dropped.map((d) => d.path), ['notes[0]', 'notes[1]', 'notes[2]', 'notes[3]', 'notes[4]', 'notes[5]', 'notes[6]', 'notes[7].mood']);
  assert.match(notes.dropped[4].reason, /needs a "from" name/);
  // dates must exist; the year is optional and in range
  const day = (b) => valid({ v: 1, birthday: b }).birthday || null;
  assert.deepEqual(day({ month: 2, day: 29, year: 2016 }), { month: 2, day: 29, year: 2016 });
  assert.deepEqual(day({ month: 2, day: 29 }), { month: 2, day: 29 }, 'no year: Feb 29 is a real birthday');
  for (const b of [{ month: 2, day: 29, year: 2015 }, { month: 4, day: 31, year: 2015 }, { month: 2, day: 30 }, { month: 13, day: 1 }, { month: 0, day: 1 },
    { month: '12', day: 3 }, { month: 12.5, day: 3 }, { month: 12, day: 0 }, { month: 12, day: 3, year: 1999 }, { month: 12, day: 3, year: 2031 }, { month: 12, day: 3, year: '2015' }, [12, 3]]) {
    assert.equal(day(b), null, JSON.stringify(b));
  }
  assert.deepEqual(reasons({ v: 1, birthday: { month: 12, day: 3, year: 2015, hour: 9 } }), ['birthday.hour: unknown key']);
  // pets: only the known ids, and a JSON "__proto__" key is just an unknown key
  assert.deepEqual(PET_IDS, ['cloudPuppy', 'husky']);
  const pets = decodeGift(Buffer.from('{"v":1,"petNames":{"cloudPuppy":"Biscuit","dragon":"Rex","__proto__":{"x":1}},"__proto__":{"to":"Zork"}}').toString('base64url'));
  assert.deepEqual(pets, { v: 1, petNames: { cloudPuppy: 'Biscuit' } });
  assert.equal(Object.getPrototypeOf(pets.petNames), Object.prototype);
  assert.equal(valid({ v: 1, petNames: { cloudPuppy: 5 } }).petNames, undefined);
});

test('validator: names are letters, spaces and . \' - up to 16, trimmed and tidied', () => {
  const name = (s) => valid({ v: 1, from: s }).from || null;
  assert.equal(name('  Uncle   Wobble  '), 'Uncle Wobble');
  assert.equal(name('Mary-Kate'), 'Mary-Kate');
  assert.equal(name("O'Zork"), "O'Zork");
  assert.equal(name('O’Zork'), "O'Zork", 'a curly apostrophe becomes a plain one');
  assert.equal(name('Dr. Zork'), 'Dr. Zork');
  assert.equal(name('Tía Zuzu'), 'Tía Zuzu');
  assert.equal(name('Grandma Fizzle'), 'Grandma Fizzle');
  assert.equal(name('Zuzubelle Wobbly'), 'Zuzubelle Wobbly', '16 is fine');
  for (const s of ['Great Grandma Fizz', 'Zuzu2', 'Zuzu!', 'Mom & Dad', '-Zuzu', '.', "'", 'Zuzu 💖', '', '   ', 'Zork_1', 'x'.repeat(300)]) {
    assert.equal(name(s), null, s.slice(0, 20));
  }
  assert.deepEqual(reasons({ v: 1, from: 'Great Grandma Fizz' }), ['from: longer than 16 characters']);
});

test('validator: HTML never gets through, in names or in notes', () => {
  for (const s of ['<b>Zuzu</b>', 'Zuzu<img src=x>', '<script>']) assert.equal(valid({ v: 1, to: s }).to, undefined, s);
  for (const t of ['<script>alert(1)</script>', 'Hi <b>Zuzu</b>!', 'I <3 you', '2 > 1', 'Hi ＜script＞', '﹤b﹥']) {
    const r = noteOf(t);
    assert.equal(r.gift.notes, undefined, t);
    assert.match(r.dropped[0].reason, /< or >/);
  }
});

test('validator: emoji stay whole, family and flag sequences included', () => {
  for (const t of ['Happy birthday! 🎂🎉', 'Love you ❤️', 'Fly high 👍🏽', '👨‍👩‍👧 forever', 'So proud ❤️‍🔥', 'Pride 🏳️‍🌈', 'Go 🇺🇸 go', 'You are 1️⃣ of a kind', '★ ☀ ♥ ✨ ⭐', 'Yay! :) ^_^ ~xoxo~']) {
    assert.equal(keptText(t), t, t);
  }
  assert.equal(keptText('Wow ∞ love'), null, 'a math symbol is not an emoji');
  assert.equal(keptText('Hi 🅱🅰🅳'), null, 'no spelling words with enclosed letters');
  assert.equal(keptText('Hi 𝐙𝐮𝐳𝐮'), null, 'no math letters');
  assert.equal(valid({ v: 1, to: 'Zuzu 🎀' }).to, undefined, 'no emoji in names');
});

test('validator: control and invisible characters are stripped, never shown', () => {
  assert.equal(valid({ v: 1, to: 'Zu\u0000zu\u0007' }).to, 'Zuzu');
  assert.equal(valid({ v: 1, to: '‮Zu​zu﻿' }).to, 'Zuzu');
  assert.equal(valid({ v: 1, to: 'Zu‍zu️' }).to, 'Zuzu');
  assert.equal(keptText('Hi\nthere\tfriend\u0000!\r\n'), 'Hi there friend!');
  assert.equal(keptText('Fly​ ‮high⁦!­'), 'Fly high!');
  assert.equal(keptText('Zu‍zu'), 'Zuzu', 'a joiner between letters goes');
  assert.equal(keptText('Zuzu️!'), 'Zuzu!', 'a variation selector after a letter goes');
  assert.equal(keptText('Hi \u{e0067}\u{e0062}there'), 'Hi there', 'tag characters go');
  assert.equal(keptText('​​​'), null, 'nothing visible left: dropped');
});

test('validator: links, emails and phone numbers stay out of notes; dates and #1 are fine', () => {
  for (const t of ['See www.example.test', 'Go to https://example.test', 'zuzu.com rocks', 'Call 555-123-4567', 'Call (555) 123 4567']) {
    assert.equal(keptText(t), null, t);
  }
  for (const t of ['You are our #1 flyer!', 'Since 12/03/2015, our star.', '100000 hugs', 'Eleven years... me too!']) assert.equal(keptText(t), t, t);
  assert.equal(keptText('zuzu@example.test'), null, 'no @ at all');
});

test('validator: sizes are capped (8 KB, 12 notes, 280 characters, 9 friends)', () => {
  assert.equal(GIFT_LIMITS.bytes, 8192);
  const long = 'x'.repeat(GIFT_LIMITS.note);
  assert.equal(keptText(long), long);
  assert.match(noteOf(long + 'x').dropped[0].reason, /longer than 280 characters \(281\)/);
  assert.equal(keptText('💖'.repeat(280)), '💖'.repeat(280), '280 emoji count as 280');
  const notes = Array.from({ length: 14 }, (v, i) => ({ from: 'Bo', text: 'Note ' + i }));
  const r = validateGift({ v: 1, notes });
  assert.equal(r.gift.notes.length, 12);
  assert.deepEqual(r.dropped.map((d) => d.path), ['notes[12]', 'notes[13]']);
  const friends = ['Pip', 'Bo', 'Tig', 'Lumi', 'Fizz', 'Zork', 'Wob', 'Dot', 'Kit', 'Moss', 'pip'];
  const f = validateGift({ v: 1, friends });
  assert.deepEqual(f.gift.friends, friends.slice(0, 9));
  assert.deepEqual(f.dropped.map((d) => d.path + ': ' + d.reason), ['friends[9]: more than 9 friends', 'friends[10]: listed twice']);
  // the whole payload: 8 KB at most, as JSON and as a link
  const big = { v: 1, notes: Array.from({ length: 12 }, () => ({ from: 'Bo', text: '💖'.repeat(200) })) };
  assert.equal(valid(big), null, 'over 8 KB');
  assert.match(validateGift(big).dropped[0].reason, /bigger than 8 KB/);
  assert.equal(decodeGift(encodeGift(big)), null);
  assert.equal(valid({ v: 1, to: 'Zuzu', pad: 'x'.repeat(100000) }), null);
  const t0 = Date.now();
  assert.equal(valid({ v: 1, notes: [{ from: 'Bo', text: 'x'.repeat(1e6) }] }), null);
  assert.ok(Date.now() - t0 < 1000, 'huge input is refused quickly');
});

test('validator: the word filter drops a blocked name or note (and keeps the rest)', () => {
  // decoded at run time, never written out here; the checks below never print a value either
  const { anywhere, words } = blockedEntries();
  const rude = 'Zu' + anywhere[0];
  const r = validateGift({
    v: 1, to: rude, from: 'Uncle Wobble', friends: ['Pip', rude, 'Bo'], petNames: { cloudPuppy: rude },
    notes: [
      { from: rude, text: 'Hi!' }, { from: 'Bo', text: 'You are so ' + words[0] + ' today' }, { from: 'Bo', text: 'You are so ' + words[0] + '!' },
      { from: 'Bo', text: words[0] + '... ' + words[1] + '?' }, { from: 'Bo', text: 'Happy birthday!' },
    ],
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert.ok(same(r.gift, { v: 1, from: 'Uncle Wobble', notes: [{ from: 'Bo', text: 'Happy birthday!' }], friends: ['Pip', 'Bo'] }), 'only the clean parts are left');
  assert.ok(same(r.dropped.map((d) => d.path), ['to', 'notes[0]', 'notes[1]', 'notes[2]', 'notes[3]', 'friends[1]', 'petNames.cloudPuppy']), 'every blocked part is dropped');
  assert.ok(r.dropped.every((d) => /word filter/.test(d.reason)), 'for the word filter');
});

// ---------------------------------------------------------------------------------------- the game

test('birthday: the gift\'s date turns birthday mode on by itself, with the candles from its year', () => {
  assert.equal(BIRTHDAY.month, null, 'config keeps its date null (the gift carries it)');
  const gift = valid(GIFT);
  const b = giftBirthday(gift);
  assert.deepEqual(b, { name: 'Zuzu', month: 12, day: 3, year: 2015 });
  const day = birthdayInfo(new Date(2026, 11, 3, 12), b);
  assert.equal(day.isBirthday, true);
  assert.equal(day.age, 11, 'eleven candles');
  assert.equal(day.name, 'Zuzu');
  assert.equal(birthdayInfo(new Date(2026, 11, 2, 12), b).isBirthday, false);
  assert.equal(birthdayInfo(new Date(2026, 11, 2, 12), b).daysUntil, 1);
  // no gift, or a gift without a date: config's (null here, so off: ?birthday=1 still forces it in main.js)
  assert.deepEqual(giftBirthday(null), { name: BIRTHDAY.name, month: null, day: null, year: null });
  assert.equal(birthdayInfo(new Date(2026, 11, 3, 12), giftBirthday(null)).enabled, false);
  assert.deepEqual(giftBirthday({ v: 1, from: 'Bo' }, { name: 'Zuzu', month: 5, day: 6, year: 2014 }), { name: 'Zuzu', month: 5, day: 6, year: 2014 });
  assert.deepEqual(giftBirthday({ v: 1, birthday: { month: 5, day: 6 } }, { name: 'Zuzu', month: 1, day: 2, year: 2014 }), { name: 'Zuzu', month: 5, day: 6, year: null }, 'the gift\'s date replaces the whole date');
  assert.equal(birthdayInfo(new Date(2026, 4, 6, 12), giftBirthday({ v: 1, birthday: { month: 5, day: 6 } })).age, null, 'no year, no age');
});

test('notes: the gift\'s notes win; the repo\'s notes.js is the fallback', () => {
  const gift = valid(GIFT);
  const repo = [{ from: 'Grandpa Zork', text: 'A note from the repo.' }];
  assert.deepEqual(pickNotes(gift, () => familyNotes(repo)).map((n) => 'From ' + n.from + ': ' + n.text), [
    'From Grandpa Zork: Happy birthday, superstar flyer! We love you to the moon and back 🌙💖',
    "From Mom and Dad: You're our #1 flyer. Keep shining! ✨ 👨‍👩‍👧",
  ]);
  assert.deepEqual(pickNotes(null, () => familyNotes(repo)).map((n) => n.text), ['A note from the repo.']);
  assert.deepEqual(pickNotes({ v: 1, from: 'Bo' }, () => familyNotes(repo)).map((n) => n.text), ['A note from the repo.'], 'a gift without notes falls back');
  assert.deepEqual(pickNotes(null, () => familyNotes()), [], 'the repo has none');
  assert.deepEqual(pickNotes(null, () => { throw new Error('no notes part'); }), []);
});

test('bots: playing alone they take the gift\'s friends in order, then random names; in a room never', () => {
  const gift = valid(GIFT);
  let k = 0;
  const rnd = () => ['Sparkle Comet', 'Glitter Fox', 'Zippy Owl', 'Rosy Gem'][k++ % 4];
  const solo = botNicks(5, { gift, solo: true, myNick: 'Zuzu', taken: ['Zuzu'], cleanNick, randomNick: rnd });
  assert.deepEqual(solo, ['Pip', 'Grandpa Zork', 'Mary Kate', 'Fizzle', 'Bo']);
  // more bots later: the next friends, then random names
  const more = botNicks(4, { gift, solo: true, myNick: 'Zuzu', taken: ['Zuzu', ...solo], cleanNick, randomNick: rnd });
  assert.deepEqual(more.slice(0, 2), ['Tig', 'Lumi']);
  assert.ok(more.slice(2).every((n) => !gift.friends.includes(n)), more.join(', '));
  // a friend whose name is hers is skipped (case and accents don't matter)
  assert.deepEqual(botNicks(2, { gift, solo: true, myNick: 'pip', cleanNick, randomNick: rnd }), ['Grandpa Zork', 'Mary Kate']);
  assert.deepEqual(botNicks(1, { gift: { v: 1, friends: ['Zoë', 'Bo'] }, solo: true, myNick: 'Zoe', randomNick: rnd }), ['Bo']);
  // in a room: random names only, so a bot is never mistaken for a real cousin who joins
  k = 0;
  assert.deepEqual(botNicks(3, { gift, solo: false, myNick: 'Zuzu', cleanNick, randomNick: rnd }), ['Sparkle Comet', 'Glitter Fox', 'Zippy Owl']);
  // no gift: random names, as before
  assert.equal(botNicks(3, { gift: null, solo: true, randomNick }).length, 3);
  assert.deepEqual(botNicks(0, { gift, solo: true, randomNick: rnd }), []);
});

test('bots: names fit the game\'s 12-letter names, and survive the net\'s own checks', async () => {
  assert.equal(botNickFor('Mary-Kate'), 'Mary Kate');
  assert.equal(botNickFor("O'Zork"), 'OZork');
  assert.equal(botNickFor('Dr. Zork'), 'Dr Zork');
  assert.equal(botNickFor('Grandma Fizzle'), 'Fizzle', 'too long: the last words');
  assert.equal(botNickFor('Uncle Wobble'), 'Uncle Wobble', '12 fits');
  assert.equal(botNickFor('Wobblebottoms'), null, 'one word over 12 cannot be a bot name');
  const gift = valid({ v: 1, friends: ['Wobblebottoms', 'Tía Zuzu', 'Mary-Kate', 'Grandma Fizzle'] });
  const nicks = botNicks(4, { gift, solo: true, cleanNick, randomNick: () => 'Sparkle Comet' });
  assert.deepEqual(nicks, ['Tía Zuzu', 'Mary Kate', 'Fizzle', 'Sparkle Comet']);
  // what main.js does: a solo room on the offline net, then net.addBot with each name
  const net = createNet({ mode: 'offline', helpers: { cleanNick, randomNick } });
  try {
    await net.createRoom({ nick: 'Zuzu', look: {} });
    const ids = nicks.map((nick) => net.addBot({ nick, look: {} }));
    assert.deepEqual(ids.map((id) => net.players.get(id).nick), ['Tia Zuzu', 'Mary Kate', 'Fizzle', 'Sparkle Comet'], 'the net drops accents, nothing else');
  } finally {
    net.leaveRoom();
    if (typeof net.dispose === 'function') net.dispose();
  }
});

test('pets: petName gives the gift\'s name for a known pet, else null', () => {
  const gift = valid(GIFT);
  assert.equal(petName('cloudPuppy', gift), 'Biscuit');
  assert.equal(petName('husky', gift), 'Snowball');
  for (const id of ['dragon', 'toString', '__proto__', 'constructor', '', null, 5]) assert.equal(petName(id, gift), null, String(id));
  assert.equal(petName('cloudPuppy', null), null);
  assert.equal(petName('cloudPuppy', { v: 1 }), null);
  useGiftStorage(null);
  assert.equal(petName('cloudPuppy'), null, 'no gift on this device');
  useGiftStorage(undefined);
});

// ---------------------------------------------------------------------------------------- this device

test('device: the link is read, saved, and its fragment leaves the address bar', () => {
  const storage = fakeStorage();
  useGiftStorage(storage);
  try {
    assert.equal(getGift(), null);
    const code = encodeGift(GIFT);
    const { loc, hist } = fakePage('https://example.test/cloud-nine/index.html?solo=1#gift=' + code);
    assert.deepEqual(readGiftFromUrl(loc, hist), valid(GIFT));
    assert.deepEqual(hist.calls, [{ state: { page: 1 }, title: '', url: 'https://example.test/cloud-nine/index.html?solo=1' }], 'no fragment, the query kept, nothing else');
    assert.deepEqual(getGift(), valid(GIFT), 'saved on this device');
    assert.deepEqual(JSON.parse(storage.map.get(GIFT_KEY)), { gift: valid(GIFT), seen: false });
    assert.equal(GIFT_KEY, 'c9.gift.v1');
    // other fragment parameters around it are fine too
    const p2 = fakePage('https://example.test/cloud-nine/#x=1&gift=' + code);
    assert.deepEqual(readGiftFromUrl(p2.loc, p2.hist), valid(GIFT));
    assert.equal(p2.hist.calls[0].url, 'https://example.test/cloud-nine/');
    // a bad payload is ignored quietly, but still leaves the address bar; the saved gift stays
    for (const bad of ['#gift=', '#gift=!!!', '#gift=' + encodeGift({ v: 9 }), '#gift=' + code.slice(0, -7)]) {
      const p = fakePage('https://example.test/cloud-nine/' + bad);
      assert.equal(readGiftFromUrl(p.loc, p.hist), null, bad.slice(0, 20));
      assert.equal(p.hist.calls.length, 1, 'the fragment went: ' + bad.slice(0, 20));
      assert.equal(p.hist.calls[0].url, 'https://example.test/cloud-nine/');
    }
    assert.deepEqual(getGift(), valid(GIFT));
    // no gift in the address: nothing touched
    for (const href of ['https://example.test/cloud-nine/', 'https://example.test/cloud-nine/#top', 'https://example.test/cloud-nine/?gift=1']) {
      const p = fakePage(href);
      assert.equal(readGiftFromUrl(p.loc, p.hist), null);
      assert.equal(p.hist.calls.length, 0, href);
    }
    // no history API (very old browser): still read, nothing thrown
    const p3 = fakePage('https://example.test/cloud-nine/#gift=' + code);
    assert.deepEqual(readGiftFromUrl(p3.loc, null), valid(GIFT));
    assert.equal(readGiftFromUrl(null, null), null);
    clearGift();
    assert.equal(getGift(), null);
    assert.equal(storage.map.has(GIFT_KEY), false);
  } finally {
    useGiftStorage(undefined);
  }
});

test('device: a saved gift is checked again; broken or tampered copies are ignored', () => {
  const storage = fakeStorage({ [GIFT_KEY]: '{not json' });
  useGiftStorage(storage);
  try {
    assert.equal(getGift(), null);
    storage.setItem(GIFT_KEY, JSON.stringify({ gift: { v: 1, to: '<b>Zuzu</b>', from: 'Uncle Wobble' }, seen: true }));
    assert.deepEqual(getGift(), { v: 1, from: 'Uncle Wobble' }, 'checked again on the way out');
    storage.setItem(GIFT_KEY, JSON.stringify({ gift: { v: 3 } }));
    assert.equal(getGift(), null);
  } finally {
    useGiftStorage(undefined);
  }
});

test('unwrap: the card is due once per gift; opening the same link again keeps it seen', () => {
  const storage = fakeStorage();
  useGiftStorage(storage);
  try {
    assert.equal(unwrapDue(), false, 'no gift, no card');
    const open = (gift) => {
      const p = fakePage('https://example.test/cloud-nine/#gift=' + encodeGift(gift));
      return readGiftFromUrl(p.loc, p.hist);
    };
    open(GIFT);
    assert.equal(unwrapDue(), true, 'first open: the card shows');
    markUnwrapped();
    assert.equal(unwrapDue(), false, 'once');
    assert.equal(JSON.parse(storage.map.get(GIFT_KEY)).seen, true, 'remembered');
    open(GIFT);
    assert.equal(unwrapDue(), false, 'the same link again: no second card');
    open(Object.assign({}, GIFT, { notes: GIFT.notes.concat([{ from: 'Bo', text: 'One more!' }]) }));
    assert.equal(unwrapDue(), true, 'a changed gift unwraps again');
    markUnwrapped();
    clearGift();
    open(GIFT);
    assert.equal(unwrapDue(), true, 'after clearing the browser data, opening the link again shows it again');
  } finally {
    useGiftStorage(undefined);
  }
});

test('unwrap: with storage blocked (a private window), this visit still has the gift, once', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  useGiftStorage(blocked);
  try {
    const p = fakePage('https://example.test/cloud-nine/#gift=' + encodeGift(GIFT));
    assert.deepEqual(readGiftFromUrl(p.loc, p.hist), valid(GIFT));
    assert.equal(p.hist.calls.length, 1);
    assert.deepEqual(getGift(), valid(GIFT));
    assert.equal(unwrapDue(), true);
    markUnwrapped();
    assert.equal(unwrapDue(), false);
    assert.equal(petName('cloudPuppy'), 'Biscuit', 'petName reads this device\'s gift');
  } finally {
    useGiftStorage(undefined);
  }
});

test('privacy: no gift link or gift file is in the game\'s folder', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'lib' && !e.name.startsWith('.')) walk(p);
        continue;
      }
      if (/gift.*\.json$/i.test(e.name)) found.push(path.relative(C9, p) + ' (a gift file: keep it outside the repo)');
      if (!/\.(?:js|mjs|cjs|md|html|json|txt|css)$/.test(e.name)) continue;
      const m = /#gift=[A-Za-z0-9_-]{24,}/.exec(fs.readFileSync(p, 'utf8'));
      if (m) found.push(path.relative(C9, p) + ' has a gift link');
    }
  };
  walk(C9);
  assert.deepEqual(found, [], 'gift links hold real names: share them privately, never commit them');
});

test('no date in the gift link: the party runs for her first three days with the gift', async () => {
  const { dayKey, giftPartyOn, GIFT_PARTY_DAYS } = await import('../js/core/gift.js');
  assert.equal(GIFT_PARTY_DAYS, 3);
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
  assert.equal(dayKey(at(2026, 12, 3)), '2026-12-03');
  assert.equal(dayKey(at(2026, 1, 9, 0)), '2026-01-09', 'local midnight is that day');
  assert.equal(giftPartyOn('2026-12-03', at(2026, 12, 3, 0)), true, 'the day it arrives');
  assert.equal(giftPartyOn('2026-12-03', at(2026, 12, 4)), true);
  assert.equal(giftPartyOn('2026-12-03', at(2026, 12, 5, 23)), true, 'the third day, late');
  assert.equal(giftPartyOn('2026-12-03', at(2026, 12, 6, 0)), false, 'over on the fourth');
  assert.equal(giftPartyOn('2026-12-03', at(2026, 12, 2, 23)), false, 'a clock set back is not a party');
  assert.equal(giftPartyOn('2026-12-31', at(2027, 1, 2)), true, 'across the new year');
  assert.equal(giftPartyOn('2026-03-07', at(2026, 3, 9)), true, 'across a clock change');
  for (const bad of [null, '', 'soon', '2026-2-3', '2026-02-31', 20261203]) assert.equal(giftPartyOn(bad, at(2026, 2, 3)), false, String(bad));
  assert.equal(giftPartyOn('2026-12-03', new Date(NaN)), false);
});
