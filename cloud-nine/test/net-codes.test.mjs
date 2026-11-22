import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoomCode, normalizeCode, isRoomCode, CODE_ALPHABET, CODE_LENGTH } from '../js/net/codes.js';
import { GAME } from '../js/config.js';
import { mulberry32 } from '../js/core/util.js';

test('codes: the alphabet and length come from GAME, and there are no vowels', () => {
  assert.equal(CODE_ALPHABET, GAME.roomCodeAlphabet);
  assert.equal(CODE_LENGTH, GAME.roomCodeLength);
  assert.ok(!/[AEIOUY]/.test(CODE_ALPHABET), 'no vowels, so a code never spells a word');
  assert.ok(!/[01O5]/.test(CODE_ALPHABET), 'no look-alikes');
});

test('codes: every code is valid, and every character turns up', () => {
  const seen = new Set();
  const codes = new Set();
  for (let i = 0; i < 4000; i++) {
    const c = makeRoomCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.ok(isRoomCode(c), c);
    for (const ch of c) seen.add(ch);
    codes.add(c);
  }
  assert.equal(seen.size, CODE_ALPHABET.length, 'all characters are used');
  assert.ok(codes.size > 3900, 'codes rarely repeat');
});

test('codes: a seeded rng gives the same codes, and a broken one still gives valid codes', () => {
  const a = makeRoomCode(mulberry32(7));
  const b = makeRoomCode(mulberry32(7));
  assert.equal(a, b);
  assert.ok(isRoomCode(makeRoomCode(() => 0.999999)));
  assert.ok(isRoomCode(makeRoomCode(() => NaN)));
  assert.ok(isRoomCode(makeRoomCode(() => 5)));
  assert.ok(isRoomCode(makeRoomCode(() => -1)));
});

test('codes: what a kid types is tidied up, and junk is refused', () => {
  const code = makeRoomCode(mulberry32(3));
  assert.equal(normalizeCode(code.toLowerCase()), code);
  assert.equal(normalizeCode(' ' + code.slice(0, 2) + ' ' + code.slice(2) + ' '), code);
  assert.equal(normalizeCode(code.slice(0, 2) + '-' + code.slice(2)), code);
  for (const bad of ['', 'ABCD', 'K7Q', 'K7QZZ', 'K7Q0', 'K7Q1', 'KAQZ', 'K7Q!', 'K7QZ\u0000', 'x'.repeat(100), null, undefined, 42, {}, ['K7QZ']]) {
    assert.equal(normalizeCode(bad), null, String(bad));
  }
  assert.equal(isRoomCode('k7qz'), false, 'isRoomCode is exact');
});
