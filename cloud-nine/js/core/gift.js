// Personal touches kept out of the repo (README: "Personal touches"). The repo is public, so the
// family's names never go in it: they ride in a private "gift link", index.html#gift=<payload>.
// The part after # (the fragment) is never sent to any server. The first time a device opens the
// link, this module checks the payload, keeps it on that device and takes the fragment out of the
// address bar. Only devices that opened the link have the touches; clearing the browser's data
// removes them (open the link again).
//
// The payload is base64url-encoded UTF-8 JSON, 8 KB at most. Schema v1 (unknown keys are dropped;
// every string is trimmed and has control and invisible characters stripped):
//   v          1
//   to         the birthday kid's name (optional: BIRTHDAY.name in js/config.js otherwise)
//   from       who it is from ("Uncle Wobble")
//   birthday   { month 1-12, day 1-31, year 2000-2030 (optional: no year, no candle count) }, a real date
//   notes      up to 12 of { from: a name, text: up to 280 characters, emoji fine, no < or >, no links }
//   friends    up to 9 names: her bot friends when she plays alone, in order
//   petNames   { cloudPuppy: name, husky: name }: only the pet ids in PET_IDS
// A name is letters, spaces and . ' - (a letter first), up to 16. Every name and note goes through
// the game's word filter (js/content/blocklist.js): a blocked one is dropped.
//
// Pure (node --test runs these):
//   GIFT_KEY = 'c9.gift.v1'           where this device keeps it (its own key: STORAGE_KEYS lives in
//                                     js/config.js, which this part doesn't edit)
//   GIFT_LIMITS, PET_IDS
//   encodeGift(obj) -> string         base64url of the JSON (no checks: validate first)
//   decodeGift(str) -> gift | null    decoded and validated; null for anything unusable
//   validateGift(raw) -> { gift, dropped: [{ path, reason, value }] }   gift null when unusable
//   giftLink(gift, base) -> string    base + '#gift=' + encodeGift(gift)
//   giftBirthday(gift, base = BIRTHDAY) -> { name, month, day, year }: the gift's over config's
//   pickNotes(gift, fallback) -> [{ from, text }]   the gift's notes, else fallback() (js/content/notes.js)
//   botNickFor(name) -> string | null the bot-label form of a name, 12 letters at most
//                                     ("Mary-Kate" -> "Mary Kate", "Grandma Fizzle" -> "Fizzle")
//   botNicks(n, { gift, solo, taken, myNick, cleanNick, randomNick }) -> n names for new bots:
//                                     alone, the gift's friends in order, then random; in a room, random
//   petName(id, gift = getGift()) -> string | null
//
// This device (localStorage behind try/catch; an in-memory copy keeps this visit going without it):
//   readGiftFromUrl(loc = location, hist = history) -> gift | null   bad payloads are ignored quietly;
//                                     the fragment leaves the address bar either way
//   getGift() -> gift | null          the saved gift, checked again
//   clearGift()
//   unwrapDue() -> boolean            a gift is here and its unwrap card hasn't shown yet
//   markUnwrapped()                   the card showed. Opening the same link again keeps it seen; a
//                                     changed gift unwraps again
//   useGiftStorage(storage)           tests: a fake localStorage (null: none; undefined: the real one)
//
// Browser only:
//   confetti({ count, ms, calm }) -> Promise   confetti over everything on a canvas that never takes a tap

import { BIRTHDAY, PALETTE } from '../config.js';
import { isBlocked } from '../content/blocklist.js';

export const GIFT_KEY = 'c9.gift.v1';
export const GIFT_LIMITS = Object.freeze({ bytes: 8192, name: 16, note: 280, notes: 12, friends: 9, botNick: 12, year: [2000, 2030] });
export const PET_IDS = Object.freeze(['cloudPuppy', 'husky']);
const MAX_ENCODED = Math.ceil(GIFT_LIMITS.bytes / 3) * 4;
const KEYS = ['v', 'to', 'from', 'birthday', 'notes', 'friends', 'petNames'];

// ---------------------------------------------------------------------------------- characters

const LETTER = 'A-Za-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u017f';
const NAME_RE = new RegExp("^[" + LETTER + "][" + LETTER + " .'-]*$");
// what a note may hold besides emoji: letters, digits, spaces and common punctuation
const TEXT_RE = new RegExp("^[" + LETTER + "0-9 .,!?\\u00a1\\u00bf'\"\\u2018\\u2019\\u201c\\u201d():;\\-\\u2013\\u2014\\u2026&/+=%*#~_^$\\u20ac\\u00a3\\u00b0\\u00b7\\u2022]$");
const ANGLES = new Set([0x3c, 0x3e, 0xff1c, 0xff1e, 0xfe64, 0xfe65, 0x2329, 0x232a, 0x3008, 0x3009]);
const NO_GO = /https?:|www\.|[a-z0-9-]\.(?:com|net|org|io|co|app|me|ly|gg|tv|us|uk)\b|\d(?:[\s().-]*\d){6,}/i;

const isControl = (cp) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
// Characters that draw nothing (zero-width spaces, direction overrides, fillers, tags...). Joiners and
// variation selectors are handled where emoji need them.
function isInvisible(cp) {
  return cp === 0xad || cp === 0x34f || cp === 0x61c || cp === 0x115f || cp === 0x1160 || cp === 0x17b4 || cp === 0x17b5
    || (cp >= 0x180b && cp <= 0x180f) || cp === 0x200b || cp === 0x200c || cp === 0x200e || cp === 0x200f
    || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f) || cp === 0x2800 || cp === 0x3164
    || (cp >= 0xfe00 && cp <= 0xfe0d) || cp === 0xffa0 || (cp >= 0xfff0 && cp <= 0xfffb)
    || (cp >= 0x1d173 && cp <= 0x1d17a) || (cp >= 0xe0000 && cp <= 0xe0fff);
}
// Emoji and the symbols that have emoji forms (hearts, stars, arrows...). Not the enclosed letters
// (a way to spell words around the filter), except the 🆒 🆗 family.
function isEmoji(cp) {
  return (cp >= 0x1f000 && cp <= 0x1f0ff) || (cp >= 0x1f191 && cp <= 0x1f19a) || (cp >= 0x1f1e6 && cp <= 0x1faff)
    || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2300 && cp <= 0x23ff) || (cp >= 0x2b00 && cp <= 0x2bff)
    || (cp >= 0x2190 && cp <= 0x21ff) || (cp >= 0x25a0 && cp <= 0x25ff) || cp === 0x2934 || cp === 0x2935
    || cp === 0xa9 || cp === 0xae || cp === 0x203c || cp === 0x2049 || cp === 0x2122 || cp === 0x2139 || cp === 0x24c2
    || cp === 0x3030 || cp === 0x303d || cp === 0x3297 || cp === 0x3299;
}

const cpCount = (s) => Array.from(s).length;
const hex = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function nfc(s) {
  try {
    return s.normalize('NFC');
  } catch (err) {
    return s;
  }
}

// A name: { name } or { reason }.
function nameCheck(raw) {
  if (typeof raw !== 'string') return { reason: 'not text' };
  if (raw.length > 200) return { reason: 'longer than ' + GIFT_LIMITS.name + ' characters' };
  let s = '';
  for (const ch of nfc(raw).replace(/[‘’ʼ]/g, "'")) {
    const cp = ch.codePointAt(0);
    if (/\s/.test(ch)) s += ' ';
    else if (!isControl(cp) && !isInvisible(cp) && cp !== 0x200d && cp !== 0xfe0e && cp !== 0xfe0f) s += ch;
  }
  s = s.replace(/ {2,}/g, ' ').trim();
  if (!s) return { reason: 'empty' };
  if (cpCount(s) > GIFT_LIMITS.name) return { reason: 'longer than ' + GIFT_LIMITS.name + ' characters' };
  if (!NAME_RE.test(s)) return { reason: "only letters, spaces and . ' - (starting with a letter)" };
  if (isBlocked(s)) return { reason: 'the word filter refused it' };
  return { name: s };
}

// A note's text: { text } or { reason }. Control and invisible characters go; a joiner stays only
// between two emoji, a variation selector only after an emoji or a keycap digit.
function textCheck(raw) {
  if (typeof raw !== 'string') return { reason: 'text: not text' };
  if (raw.length > GIFT_LIMITS.note * 8) return { reason: 'longer than ' + GIFT_LIMITS.note + ' characters' };
  const chars = Array.from(nfc(raw));
  let out = '';
  let prev = ''; // 'emoji' | 'key' (a digit, # or *) | 'keyvs' | 'text' | 'space'
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    if (/\s/.test(ch)) {
      out += ' ';
      prev = 'space';
    } else if (isControl(cp) || isInvisible(cp)) {
      continue;
    } else if (cp === 0x200d) {
      const next = chars[i + 1];
      if (prev === 'emoji' && next && isEmoji(next.codePointAt(0))) {
        out += ch;
        prev = 'zwj';
      }
    } else if (cp === 0xfe0e || cp === 0xfe0f) {
      if (prev === 'emoji' || prev === 'key') {
        out += ch;
        prev = prev === 'key' ? 'keyvs' : 'emoji';
      }
    } else if (cp === 0x20e3) {
      if (prev === 'key' || prev === 'keyvs') {
        out += ch;
        prev = 'emoji';
      }
    } else if (ANGLES.has(cp)) {
      return { reason: 'has < or > (for a heart, use ❤️ instead of <3)' };
    } else if (isEmoji(cp)) {
      out += ch;
      prev = 'emoji';
    } else if (TEXT_RE.test(ch)) {
      out += ch;
      prev = /[0-9#*]/.test(ch) ? 'key' : 'text';
    } else {
      return { reason: "has a character the game doesn't show: " + ch + ' (' + hex(cp) + ')' };
    }
  }
  const text = out.replace(/ {2,}/g, ' ').trim();
  if (!text) return { reason: 'text: empty' };
  const n = cpCount(text);
  if (n > GIFT_LIMITS.note) return { reason: 'longer than ' + GIFT_LIMITS.note + ' characters (' + n + ')' };
  if (NO_GO.test(text)) return { reason: 'looks like a link, an email or a phone number' };
  // twice: as written (the filter reads "!" or "$" in a word as leetspeak letters), and with the
  // punctuation as spaces (so a word just before "!" is still a whole word)
  if (isBlocked(text, { squash: false }) || isBlocked(text.replace(/[!?.,;:'"()‘’“”$&*+=%#~^_/-]/g, ' '), { squash: false })) {
    return { reason: 'the word filter refused it' };
  }
  return { text };
}

function daysIn(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function dateCheck(raw, drop) {
  if (!isPlain(raw)) return { reason: 'not a date like { "month": 12, "day": 3, "year": 2015 }' };
  for (const k of Object.keys(raw)) if (k !== 'month' && k !== 'day' && k !== 'year') drop('birthday.' + k, 'unknown key', raw[k]);
  const { month, day, year } = raw;
  const [y0, y1] = GIFT_LIMITS.year;
  if (!isInt(month) || month < 1 || month > 12) return { reason: 'month: a whole number from 1 to 12' };
  if (!isInt(day) || day < 1 || day > 31) return { reason: 'day: a whole number from 1 to 31' };
  const hasYear = year !== undefined && year !== null;
  if (hasYear && (!isInt(year) || year < y0 || year > y1)) return { reason: 'year: a whole number from ' + y0 + ' to ' + y1 };
  // without a year, 2000 (a leap year) lets Feb 29 through
  if (day > daysIn(hasYear ? year : 2000, month)) return { reason: 'no such day: ' + month + '/' + day + (hasYear ? '/' + year : '') };
  return { date: hasYear ? { month, day, year } : { month, day } };
}

function utf8Length(s) {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

// ---------------------------------------------------------------------------------- the validator

export function validateGift(raw) {
  const dropped = [];
  const drop = (path, reason, value) => dropped.push({ path, reason, value });
  const fail = (reason, value) => ({ gift: null, dropped: [{ path: '', reason, value }] });
  if (!isPlain(raw)) return fail('not a gift: expected an object like { "v": 1, ... }', raw);
  let json;
  try {
    json = JSON.stringify(raw);
  } catch (err) {
    return fail('not plain JSON');
  }
  const size = typeof json === 'string' ? utf8Length(json) : Infinity;
  if (size > GIFT_LIMITS.bytes) return fail('bigger than 8 KB (' + size + ' bytes): shorten the notes');
  if (raw.v !== 1) return fail('"v" must be 1', raw.v);

  const gift = { v: 1 };
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) drop(k, 'unknown key', raw[k]);
  for (const k of ['to', 'from']) {
    if (raw[k] === undefined) continue;
    const r = nameCheck(raw[k]);
    if (r.name) gift[k] = r.name;
    else drop(k, r.reason, raw[k]);
  }
  if (raw.birthday !== undefined) {
    const r = dateCheck(raw.birthday, drop);
    if (r.date) gift.birthday = r.date;
    else drop('birthday', r.reason, raw.birthday);
  }
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes)) drop('notes', 'not a list', raw.notes);
    else {
      const notes = [];
      raw.notes.forEach((n, i) => {
        const path = 'notes[' + i + ']';
        if (!isPlain(n)) return drop(path, 'not a note like { "from": "Grandpa Zork", "text": "..." }', n);
        if (notes.length >= GIFT_LIMITS.notes) return drop(path, 'more than ' + GIFT_LIMITS.notes + ' notes', n);
        for (const k of Object.keys(n)) if (k !== 'from' && k !== 'text') drop(path + '.' + k, 'unknown key', n[k]);
        const f = n.from === undefined ? { reason: 'needs a "from" name' } : nameCheck(n.from);
        if (!f.name) return drop(path, (n.from === undefined ? '' : 'from: ') + f.reason, n);
        const t = textCheck(n.text);
        if (!t.text) return drop(path, t.reason, n);
        notes.push({ from: f.name, text: t.text });
      });
      if (notes.length) gift.notes = notes;
    }
  }
  if (raw.friends !== undefined) {
    if (!Array.isArray(raw.friends)) drop('friends', 'not a list', raw.friends);
    else {
      const friends = [];
      const seen = new Set();
      raw.friends.forEach((f, i) => {
        const path = 'friends[' + i + ']';
        const r = nameCheck(f);
        if (!r.name) return drop(path, r.reason, f);
        if (seen.has(r.name.toLowerCase())) return drop(path, 'listed twice', f);
        if (friends.length >= GIFT_LIMITS.friends) return drop(path, 'more than ' + GIFT_LIMITS.friends + ' friends', f);
        seen.add(r.name.toLowerCase());
        friends.push(r.name);
      });
      if (friends.length) gift.friends = friends;
    }
  }
  if (raw.petNames !== undefined) {
    if (!isPlain(raw.petNames)) drop('petNames', 'not an object like { "cloudPuppy": "Biscuit" }', raw.petNames);
    else {
      const pets = {};
      let any = false;
      for (const id of Object.keys(raw.petNames)) {
        const path = 'petNames.' + id;
        if (!PET_IDS.includes(id)) {
          drop(path, 'unknown pet (the pets are ' + PET_IDS.join(', ') + ')', raw.petNames[id]);
          continue;
        }
        const r = nameCheck(raw.petNames[id]);
        if (!r.name) drop(path, r.reason, raw.petNames[id]);
        else {
          pets[id] = r.name;
          any = true;
        }
      }
      if (any) gift.petNames = pets;
    }
  }
  return { gift, dropped };
}

// ---------------------------------------------------------------------------------- the link

function toBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str) || str.length % 4 === 1) return null;
  let bin;
  try {
    bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  } catch (err) {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeGift(obj) {
  const json = JSON.stringify(obj);
  if (typeof json !== 'string') throw new TypeError('a gift is a plain object');
  return toBase64url(new TextEncoder().encode(json));
}

export function decodeGift(str) {
  if (typeof str !== 'string' || !str || str.length > MAX_ENCODED) return null;
  const bytes = fromBase64url(str);
  if (!bytes || bytes.length > GIFT_LIMITS.bytes) return null;
  let raw;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (err) {
    return null;
  }
  return validateGift(raw).gift;
}

export function giftLink(gift, base) {
  return String(base || '').replace(/#.*$/, '') + '#gift=' + encodeGift(gift);
}

// ---------------------------------------------------------------------------------- using it

export function giftBirthday(gift, base = BIRTHDAY) {
  const b = base && typeof base === 'object' ? base : {};
  const out = { name: b.name || null, month: b.month ?? null, day: b.day ?? null, year: b.year ?? null };
  if (gift && gift.to) out.name = gift.to;
  if (gift && gift.birthday) {
    out.month = gift.birthday.month;
    out.day = gift.birthday.day;
    out.year = gift.birthday.year ?? null;
  }
  return out;
}

export function pickNotes(gift, fallback) {
  if (gift && Array.isArray(gift.notes) && gift.notes.length) return gift.notes.map((n) => ({ from: n.from, text: n.text }));
  try {
    const list = typeof fallback === 'function' ? fallback() : fallback;
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

export function botNickFor(name) {
  if (typeof name !== 'string') return null;
  let words = name.replace(/[.']/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  // game names are 12 letters at most: a longer one keeps its last words ("Grandma Fizzle" -> "Fizzle")
  while (words.length > 1 && cpCount(words.join(' ')) > GIFT_LIMITS.botNick) words = words.slice(1);
  const s = words.join(' ');
  return s && cpCount(s) <= GIFT_LIMITS.botNick ? s : null;
}

// Accents and case don't make a different name ("Zoë" and "zoe" are one person).
const nameKey = (s) => nfc(String(s)).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function botNicks(n, { gift = null, solo = false, taken = [], myNick = '', cleanNick = null, randomNick = null } = {}) {
  const count = Math.max(0, Math.min(20, Math.floor(Number(n) || 0)));
  const out = [];
  const used = new Set([myNick].concat(taken || []).filter((s) => typeof s === 'string' && s).map(nameKey));
  const clean = (s) => {
    if (!s || typeof cleanNick !== 'function') return s;
    try {
      return cleanNick(s);
    } catch (err) {
      return null;
    }
  };
  // alone, her family first; in a room never, so a bot is never mistaken for a cousin who joins
  const friends = solo && gift && Array.isArray(gift.friends) ? gift.friends : [];
  for (const f of friends) {
    if (out.length >= count) break;
    const nick = clean(botNickFor(f));
    if (typeof nick !== 'string' || !nick || used.has(nameKey(nick))) continue;
    used.add(nameKey(nick));
    out.push(nick);
  }
  while (out.length < count) {
    let nick = typeof randomNick === 'function' ? randomNick() : null;
    for (let i = 0; i < 6 && nick && used.has(nameKey(nick)); i++) nick = randomNick();
    if (typeof nick !== 'string' || !nick) break;
    used.add(nameKey(nick));
    out.push(nick);
  }
  return out;
}

export function petName(id, gift = getGift()) {
  if (!gift || !isPlain(gift.petNames) || typeof id !== 'string' || !own(gift.petNames, id)) return null;
  const name = gift.petNames[id];
  return typeof name === 'string' && name ? name : null;
}

// ---------------------------------------------------------------------------------- this device

let storageOverride; // undefined: the browser's localStorage
let memo = null; // { gift, seen }: this visit's copy, for when storage is blocked
let cache = { raw: null, rec: null }; // the last record read, so the checks run once per change

export function useGiftStorage(storage) {
  storageOverride = storage;
  memo = null;
  cache = { raw: null, rec: null };
}

function storage() {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (err) {
    return null;
  }
}

function readRecord() {
  const s = storage();
  let raw = null;
  if (s) {
    try {
      raw = s.getItem(GIFT_KEY);
    } catch (err) {
      raw = null;
    }
  }
  if (typeof raw === 'string' && raw) {
    if (raw === cache.raw) return cache.rec;
    let rec = null;
    try {
      const parsed = JSON.parse(raw);
      const gift = isPlain(parsed) ? validateGift(parsed.gift).gift : null;
      if (gift) rec = { gift, seen: parsed.seen === true };
    } catch (err) {
      rec = null;
    }
    cache = { raw, rec };
    if (rec) return rec;
  }
  return memo;
}

function writeRecord(rec) {
  memo = rec;
  const s = storage();
  if (!s) return false;
  try {
    if (rec) s.setItem(GIFT_KEY, JSON.stringify(rec));
    else s.removeItem(GIFT_KEY);
    return true;
  } catch (err) {
    return false; // full or blocked: memo keeps it for this visit
  }
}

function fragmentPayload(hash) {
  if (typeof hash !== 'string' || hash.length < 2) return null;
  for (const part of hash.replace(/^#/, '').split('&')) if (part.slice(0, 5) === 'gift=') return part.slice(5);
  return null;
}

// The address without its fragment, in place (no new history entry, no reload).
function dropFragment(loc, hist) {
  try {
    if (!hist || typeof hist.replaceState !== 'function') return false;
    const href = String(loc.href);
    const at = href.indexOf('#');
    hist.replaceState(hist.state === undefined ? null : hist.state, '', at < 0 ? href : href.slice(0, at));
    return true;
  } catch (err) {
    return false;
  }
}

export function readGiftFromUrl(loc = typeof location !== 'undefined' ? location : null, hist = typeof history !== 'undefined' ? history : null) {
  let payload = null;
  try {
    payload = loc ? fragmentPayload(loc.hash) : null;
  } catch (err) {
    payload = null;
  }
  if (payload === null) return null;
  dropFragment(loc, hist); // the names don't stay in the address bar, whatever the payload held
  const gift = decodeGift(payload);
  if (!gift) return null;
  const prev = readRecord();
  const same = !!prev && JSON.stringify(prev.gift) === JSON.stringify(gift);
  writeRecord({ gift, seen: same && prev.seen });
  return gift;
}

export function getGift() {
  const rec = readRecord();
  return rec ? rec.gift : null;
}

export function clearGift() {
  writeRecord(null);
  cache = { raw: null, rec: null };
}

export function unwrapDue() {
  const rec = readRecord();
  return !!(rec && rec.gift && !rec.seen);
}

export function markUnwrapped() {
  const rec = readRecord();
  if (rec && !rec.seen) writeRecord({ gift: rec.gift, seen: true });
}

// ---------------------------------------------------------------------------------- confetti

const CONFETTI_COLORS = [PALETTE.pink, PALETTE.rhinestonePurple, PALETTE.gold, PALETTE.babyBlue, PALETTE.mint, PALETTE.pinkSoft, PALETTE.black];

export function confetti({ count = 110, ms = 3200, calm = false } = {}) {
  if (typeof document === 'undefined' || !document.body || typeof requestAnimationFrame !== 'function') return Promise.resolve();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return Promise.resolve();
  const w = window.innerWidth || 390;
  const h = window.innerHeight || 844;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.className = 'c9-confetti';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:66;pointer-events:none';
  document.body.appendChild(canvas);
  const n = calm ? Math.round(count / 4) : count;
  const speed = calm ? 0.5 : 1;
  const bits = [];
  for (let i = 0; i < n; i++) {
    bits.push({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.6,
      vx: (Math.random() - 0.5) * 70 * speed,
      vy: (110 + Math.random() * 170) * speed,
      a: Math.random() * Math.PI * 2,
      va: (Math.random() - 0.5) * 9 * speed,
      s: 7 + Math.random() * 7,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      kind: i % 3, // a ribbon strip, a little star, a dot
    });
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const age = now - t0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = age > ms - 600 ? Math.max(0, (ms - age) / 600) : 1;
      for (const b of bits) {
        b.vy += 30 * dt * speed;
        b.x += (b.vx + Math.sin(now / 400 + b.a) * 26 * speed) * dt;
        b.y += b.vy * dt;
        b.a += b.va * dt;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        ctx.fillStyle = b.color;
        if (b.kind === 0) ctx.fillRect(-b.s / 2, -b.s / 5, b.s, (b.s * 2) / 5);
        else if (b.kind === 1) {
          ctx.beginPath();
          for (let k = 0; k < 10; k++) {
            const r = k % 2 ? b.s * 0.24 : b.s * 0.6;
            const t = -Math.PI / 2 + (k * Math.PI) / 5;
            if (k) ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r);
            else ctx.moveTo(Math.cos(t) * r, Math.sin(t) * r);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, b.s * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (age < ms) requestAnimationFrame(frame);
      else {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}
