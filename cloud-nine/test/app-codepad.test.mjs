// APP: js/ui/codepad.js. The room-code keypad only ever produces valid codes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodeEntry, cleanCode, isValidCode, keyOf, keypadRows } from '../js/ui/codepad.js';
import { GAME } from '../js/config.js';

test('cleanCode normalizes and validates', () => {
  assert.equal(cleanCode('kj7p'), 'KJ7P');
  assert.equal(cleanCode(' K J-7 P '), 'KJ7P');
  assert.equal(cleanCode('KJ7'), null);
  assert.equal(cleanCode('KJ7PQ'), null);
  assert.equal(cleanCode('KA7P'), null, 'vowels are not in the alphabet');
  assert.equal(cleanCode('K07P'), null, 'zero is not in the alphabet');
  assert.equal(cleanCode(null), null);
  assert.equal(isValidCode('KJ7P'), true);
  assert.equal(isValidCode('kj7p'), false, 'a valid code is already clean');
});

test('keyOf only lets alphabet characters through', () => {
  assert.equal(keyOf('k'), 'K');
  assert.equal(keyOf('7'), '7');
  assert.equal(keyOf('A'), null);
  assert.equal(keyOf('1'), null);
  assert.equal(keyOf('KK'), null);
  assert.equal(keyOf(''), null);
});

test('typing a code on the keypad', () => {
  const changes = [];
  const entry = createCodeEntry({ onChange: (v) => changes.push(v) });
  assert.deepEqual(entry.slots(), ['', '', '', '']);
  assert.equal(entry.empty, true);
  assert.equal(entry.press('K'), true);
  assert.equal(entry.press('a'), false, 'vowels are ignored');
  assert.equal(entry.press('j'), true);
  assert.deepEqual(entry.slots(), ['K', 'J', '', '']);
  assert.equal(entry.complete, false);
  entry.press('7');
  entry.press('P');
  assert.equal(entry.complete, true);
  assert.equal(entry.value, 'KJ7P');
  assert.equal(entry.press('Q'), false, 'full codes take no more keys');
  assert.equal(entry.back(), true);
  assert.equal(entry.value, 'KJ7');
  assert.equal(entry.clear(), true);
  assert.equal(entry.clear(), false);
  assert.equal(entry.back(), false);
  assert.deepEqual(changes, ['K', 'KJ', 'KJ7', 'KJ7P', 'KJ7', '']);
});

test('pasting or deep-linking a code', () => {
  const entry = createCodeEntry();
  assert.equal(entry.set('kj7p'), true);
  assert.equal(entry.value, 'KJ7P');
  assert.equal(entry.set('KJ-7P-extra'), true);
  assert.equal(entry.value, 'KJ7P');
  assert.equal(entry.set('KJA7'), false, 'stops at the first character that is not allowed');
  assert.equal(entry.value, 'KJ');
  assert.equal(entry.set(null), false);
  assert.equal(entry.value, '');
});

test('keypadRows lays out every allowed character exactly once', () => {
  for (const cols of [6, 7, 9]) {
    const rows = keypadRows(cols);
    assert.ok(rows.every((r) => r.length <= cols));
    assert.equal(rows.flat().join(''), GAME.roomCodeAlphabet);
  }
  assert.equal(keypadRows(0).length, GAME.roomCodeAlphabet.length);
});

test('every code the alphabet can make is accepted', () => {
  const a = GAME.roomCodeAlphabet;
  for (let i = 0; i < 200; i++) {
    let code = '';
    for (let k = 0; k < GAME.roomCodeLength; k++) code += a[(i * 7 + k * 13) % a.length];
    assert.equal(cleanCode(code.toLowerCase()), code);
  }
});
