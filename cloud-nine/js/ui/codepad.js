// Room-code entry, pure logic (no DOM): the on-screen keypad in ui/menu.js drives this, so no
// phone keyboard is ever needed. Codes use GAME.roomCodeAlphabet only (no vowels, no 0/O or 1/I
// lookalikes), so they never spell words.
//
//   cleanCode(raw)                 -> 'KJ7P' or null       uppercases, drops spaces and dashes
//   isValidCode(code)              -> boolean
//   keyOf(char)                    -> the alphabet character a typed key means, or null
//   keypadRows(columns)            -> [['B','C',...], ...] the alphabet laid out in rows
//   const entry = createCodeEntry({ alphabet?, length?, onChange? })
//   entry.value / entry.complete / entry.slots()   -> ['K','J','',''] for drawing the boxes
//   entry.press(char) -> boolean   false when the key is not allowed or the code is already full
//   entry.back() / entry.clear() / entry.set(text) -> boolean (true when text was a whole valid code)

import { GAME } from '../config.js';

const ALPHABET = GAME.roomCodeAlphabet;
const LENGTH = GAME.roomCodeLength;

export function keyOf(ch, alphabet = ALPHABET) {
  if (typeof ch !== 'string' || ch.length !== 1) return null;
  const up = ch.toUpperCase();
  return alphabet.includes(up) ? up : null;
}

export function cleanCode(raw, alphabet = ALPHABET, length = LENGTH) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (s.length !== length) return null;
  for (const ch of s) if (!alphabet.includes(ch)) return null;
  return s;
}

export function isValidCode(code, alphabet = ALPHABET, length = LENGTH) {
  return cleanCode(code, alphabet, length) === code;
}

export function keypadRows(columns, alphabet = ALPHABET) {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const rows = [];
  for (let i = 0; i < alphabet.length; i += cols) rows.push(alphabet.slice(i, i + cols).split(''));
  return rows;
}

export function createCodeEntry({ alphabet = ALPHABET, length = LENGTH, onChange = null } = {}) {
  let value = '';
  const changed = () => {
    if (typeof onChange === 'function') onChange(value);
  };
  return {
    get value() { return value; },
    get length() { return length; },
    get complete() { return value.length === length; },
    get empty() { return value.length === 0; },
    slots() {
      const out = [];
      for (let i = 0; i < length; i++) out.push(value[i] || '');
      return out;
    },
    press(ch) {
      const k = keyOf(ch, alphabet);
      if (!k || value.length >= length) return false;
      value += k;
      changed();
      return true;
    },
    back() {
      if (!value) return false;
      value = value.slice(0, -1);
      changed();
      return true;
    },
    clear() {
      if (!value) return false;
      value = '';
      changed();
      return true;
    },
    // Paste or a deep link: keeps whatever valid characters lead the text, up to the code length.
    set(text) {
      let next = '';
      for (const ch of String(text || '').replace(/[\s-]+/g, '')) {
        const k = keyOf(ch, alphabet);
        if (!k) break;
        next += k;
        if (next.length >= length) break;
      }
      value = next;
      changed();
      return value.length === length;
    },
  };
}
