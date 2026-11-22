// Room codes: short, private, typed by kids on a phone.
//
//   makeRoomCode(rng?)     -> 'K7QZ'   GAME.roomCodeLength characters from GAME.roomCodeAlphabet
//   normalizeCode(raw)     -> 'K7QZ' | null   uppercases and drops spaces and dashes; null when it can't be a code
//   isRoomCode(s)          -> boolean  (exact form, no clean-up)
//
// The alphabet has no vowels, so a code never spells a word. rng is a function giving floats in
// [0, 1); without one the browser's crypto random numbers are used (Math.random as a last resort).
// Pure: no DOM, runs under node --test.

import { GAME } from '../config.js';

export const CODE_ALPHABET = GAME.roomCodeAlphabet;
export const CODE_LENGTH = GAME.roomCodeLength;

const CODE_RE = new RegExp('^[' + CODE_ALPHABET + ']{' + CODE_LENGTH + '}$');

function cryptoIndex(n) {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint8Array(1);
    const limit = 256 - (256 % n); // rejection sampling keeps every character equally likely
    for (let i = 0; i < 64; i++) {
      c.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }
  return Math.floor(Math.random() * n);
}

export function makeRoomCode(rng) {
  const n = CODE_ALPHABET.length;
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    let k = typeof rng === 'function' ? Math.floor(Number(rng()) * n) : cryptoIndex(n);
    if (!Number.isInteger(k) || k < 0 || k >= n) k = 0;
    out += CODE_ALPHABET[k];
  }
  return out;
}

export function isRoomCode(s) {
  return typeof s === 'string' && CODE_RE.test(s);
}

export function normalizeCode(raw) {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const s = raw.toUpperCase().replace(/[\s-]+/g, '');
  return isRoomCode(s) ? s : null;
}
