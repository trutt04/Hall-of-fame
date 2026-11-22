// Nicknames: a two-word generator and the cleaner every typed or received nickname goes through.
//
//   NICK_FIRST, NICK_SECOND   40 cute words each ("Sparkle", "Comet")
//   NICK_MAX = 12             the longest a typed nickname may be
//   NICK_MAX_ANY = 16         the longest any valid nickname can be (a generated one)
//   randomNick(rng)           -> "Sparkle Comet"
//   isGeneratedNick(s)        -> the canonical generated form ("Sparkle Comet") or null
//   cleanNick(raw)            -> the clean nickname, or null when it can't be used
//
// cleanNick rules: letters (accented Latin letters too, so Zoë and José work) and spaces only.
// Trims, collapses spaces and capitalizes each word's first letter ("bailey  rose" -> "Bailey Rose").
// At most 12 characters, unless it is exactly a generator pair, which may be up to 16 so names like
// "Glitter Unicorn" survive the network. Anything on the blocklist (js/content/blocklist.js, with
// leetspeak and spacing tricks folded) returns null. Use it on every nickname that comes from the
// network too; on null, give that player a fresh randomNick() instead.

import { isBlocked } from './blocklist.js';
import { pickIndex } from './text.js';

export const NICK_MAX = 12;
export const NICK_MAX_ANY = 16;

export const NICK_FIRST = Object.freeze([
  'Sparkle', 'Glitter', 'Twinkle', 'Shimmer', 'Dazzle', 'Sunny', 'Rainbow', 'Cosmic',
  'Starry', 'Peppy', 'Bouncy', 'Fluffy', 'Dreamy', 'Zippy', 'Jazzy', 'Lucky',
  'Happy', 'Giggly', 'Breezy', 'Twirly', 'Swirly', 'Super', 'Mega', 'Turbo',
  'Pixie', 'Misty', 'Bubbly', 'Cloudy', 'Neon', 'Velvet', 'Lilac', 'Rosy',
  'Golden', 'Silver', 'Crystal', 'Moonlit', 'Jolly', 'Brave', 'Mighty', 'Snappy',
]);

export const NICK_SECOND = Object.freeze([
  'Comet', 'Star', 'Bow', 'Pom', 'Flyer', 'Spark', 'Cloud', 'Rocket',
  'Unicorn', 'Bunny', 'Kitten', 'Puppy', 'Panda', 'Koala', 'Otter', 'Fox',
  'Owl', 'Dolphin', 'Firefly', 'Dragon', 'Phoenix', 'Pegasus', 'Breeze', 'Moon',
  'Sunbeam', 'Meteor', 'Galaxy', 'Nova', 'Gem', 'Diamond', 'Sparkler', 'Tumbler',
  'Champ', 'Captain', 'Hero', 'Daisy', 'Blossom', 'Penguin', 'Llama', 'Hedgehog',
]);

const FIRST_BY_KEY = new Map(NICK_FIRST.map((w) => [w.toLowerCase(), w]));
const SECOND_BY_KEY = new Map(NICK_SECOND.map((w) => [w.toLowerCase(), w]));

const root = (w) => w.toLowerCase().slice(0, 4);

export function randomNick(rng) {
  let first = NICK_FIRST[0];
  let second = NICK_SECOND[0];
  for (let tries = 0; tries < 8; tries++) {
    first = NICK_FIRST[pickIndex(NICK_FIRST.length, rng)];
    second = NICK_SECOND[pickIndex(NICK_SECOND.length, rng)];
    if (root(first) !== root(second)) break; // no "Sparkle Sparkler"
  }
  return `${first} ${second}`;
}

export function isGeneratedNick(s) {
  if (typeof s !== 'string' || s.length > 40) return null;
  const parts = s.trim().toLowerCase().split(/\s+/);
  if (parts.length !== 2) return null;
  const a = FIRST_BY_KEY.get(parts[0]);
  const b = SECOND_BY_KEY.get(parts[1]);
  return a && b ? `${a} ${b}` : null;
}

// Plain and accented Latin letters (Latin-1 and Latin Extended-A, without the x and divide signs).
const NICK_CHARS = /^[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u017f ]+$/;

export function cleanNick(raw) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  let s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s || !NICK_CHARS.test(s)) return null;
  const generated = isGeneratedNick(s);
  if (generated) return generated;
  if (Array.from(s).length > NICK_MAX) return null;
  s = s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  if (isBlocked(s)) return null;
  return s;
}
