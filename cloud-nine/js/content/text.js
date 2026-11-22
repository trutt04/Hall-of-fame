// Small text helpers shared by the content modules. Pure: no DOM, no three.js.
//
//   ordinal(n)               -> "1st", "2nd", "11th", "22nd"
//   plural(n, one, many)     -> "1 trick", "3 tricks"
//   capFirst(s)              -> the same string with its first letter in upper case
//   cleanInline(value, max)  -> a short, safe, one-line string from untrusted input ('' when unusable)
//   fmtNumber(n)             -> "1,250" (rounded, with thousands commas)
//   rngOr(rng)               -> rng when it is a function, else Math.random
//   pickIndex(n, rng)        -> an integer in [0, n), safe even when rng misbehaves
//   foldLatin(s)             -> lower case with accents removed: "Zoë" -> "zoe"

export function ordinal(n) {
  const v = Math.abs(Math.trunc(Number(n) || 0));
  const t = v % 100;
  if (t >= 11 && t <= 13) return v + 'th';
  const last = v % 10;
  if (last === 1) return v + 'st';
  if (last === 2) return v + 'nd';
  if (last === 3) return v + 'rd';
  return v + 'th';
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

export function capFirst(s) {
  const str = String(s);
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

// Control characters, braces (so a value can never look like a placeholder), angle brackets and
// backslashes are dropped. Whitespace collapses to single spaces. Clipped by code points.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f{}<>\\\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

export function cleanInline(value, max = 16) {
  let s;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' && Number.isFinite(value)) s = String(value);
  else return '';
  s = s.normalize('NFC').replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  if (chars.length > max) s = chars.slice(0, max).join('').trim();
  return s;
}

export function fmtNumber(n) {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function rngOr(rng) {
  return typeof rng === 'function' ? rng : Math.random;
}

export function pickIndex(n, rng) {
  if (!(n > 0)) return 0;
  let r = Number(rngOr(rng)());
  if (!Number.isFinite(r)) r = 0;
  return Math.min(n - 1, Math.max(0, Math.floor(r * n)));
}

export function foldLatin(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
