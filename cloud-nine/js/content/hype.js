// Hype lines: what the game says when something happens. Sweet, funny, full of cheer. Pure.
//
//   hype(situation, ctx = {}, rng = Math.random) -> string, never empty
//   createHype({ memory = 4 } = {}) -> a hype function with its own memory (and .reset())
//   resetHype()                       forget what the shared hype() said recently
//   HYPE_LINES        { situation: [template, ...] }   SITUATIONS, RARE_SITUATIONS: the names
//   HYPE_MAX = 64, HYPE_SHORT_MAX = 28, SHORT_SITUATIONS   length caps (in-air callouts are short)
//   PLACEHOLDERS      every {placeholder} a template may use
//   hypeValues(ctx, situation) -> the strings that fill the placeholders
//   fillTemplate(template, values) -> the filled line, or null when a placeholder has no value
//
// A line is never the same as any of the last few lines for that situation (memory, per
// situation). Unknown situations use the 'cheer' pool. Templates whose placeholders are not in
// ctx are skipped, as are lines that come out longer than the cap, so every situation works with
// an empty ctx and with the longest names.
//
// Situations. Lines talk to the player whose screen shows them ("you"). ctx fields in brackets;
// any situation may also use name (this player's nickname), so pass it whenever you have it.
//   welcome [name]  idle [name]  cloudCatch [name] (walked off the edge; a cloud brings you home)
//   friendJoin [name]  friendLeave [name]  collect [stick, unlock, count, total]  cheer [name]
//   gameStart [game]  ducks [name] (a big feed at the duck pond)
//   basket toss: tossLand [name, height, tricks, trick, score]  cradle [name, trick] (still
//     mid-trick at touchdown)  trick [trick] (in the air, short)  combo [tricks, trick] (short)
//     bigToss [name, bases (friend count), height]
//   hide and seek: seeker [name] (you count)  hiding [seeker] (go hide!)  hidden [name] (still
//     hidden)  found [target, left] (you found someone)  gotFound [seeker]
//   freeze tag: it [name]  freeze [tagger] (you got frozen)  tag [target]  unfreeze [target]
//     (you saved a friend)  unfrozen [friend] (a friend saved you)
//   dodgeball: dodge  hit (you got hit)  hitThem [target]  catch
//   Capture the Bow: grab [team]  bowTaken [target] (they grabbed your bow)  score [team, name]
//   results: win [team, game, name]  lose [team (the winners), game]  tie [game]
//   Hit Zero: routineZero [score]  routineGood [score, misses]  routineOk (a rough run: encouragement)
//   rare: birthday [name, age]  birthdayWeek [name, days (until; omit after the day)]
//     (in these two, name is the birthday person: leave it out to use BIRTHDAY.name)
//     firstToss  personalBest [height]
//     allFound [count]  neverFound  collectAll [total]  perfectCombo [tricks]  comeback  lastStanding
//
// ctx values: names are cleaned and clipped to 16 characters; trick ids ('toeTouch') become labels
// ('toe touch'); team 0 or 1 becomes "Team Pink" or "Team Purple"; game ids become titles;
// height, days, tricks, bases and misses come out with their unit ("14 meters", "3 days").
//
// House rules for anyone adding lines (the tests check most of them):
//   - Hype, sweet and funny, never mean. Praise skill, effort, style, teamwork and spirit, never
//     looks, bodies, weight or food. Nobody loses: "So close!", never "you lost". No crashes.
//   - Names are untrusted: insert them, never riff on them, and no possessives on them.
//   - No em or en dashes. Straight apostrophes. At most 64 characters (28 for trick and combo).
//   - Every situation keeps plenty of lines with no placeholders at all.

import { BIRTHDAY, GAME, TEAMS } from '../config.js';
import { stickById } from './collectibles.js';
import { trickLabel } from './glossary.js';
import { gameTitle } from './howto.js';
import { WORLD_LINES } from './hype-lines-world.js';
import { TOSS_LINES } from './hype-lines-toss.js';
import { GAME_LINES } from './hype-lines-games.js';
import { TEAM_LINES } from './hype-lines-teams.js';
import { PARTY_LINES } from './hype-lines-party.js';
import { capFirst, cleanInline, fmtNumber, ordinal, pickIndex, plural } from './text.js';

export const HYPE_LINES = Object.freeze(
  Object.assign({}, WORLD_LINES, TOSS_LINES, GAME_LINES, TEAM_LINES, PARTY_LINES),
);
export const SITUATIONS = Object.freeze(Object.keys(HYPE_LINES));
export const RARE_SITUATIONS = Object.freeze([
  'birthday', 'birthdayWeek', 'firstToss', 'personalBest', 'allFound', 'neverFound', 'collectAll',
  'perfectCombo', 'comeback', 'lastStanding',
]);
export const HYPE_MAX = 64;
export const HYPE_SHORT_MAX = 28;
export const SHORT_SITUATIONS = Object.freeze(['trick', 'combo']);
export const PLACEHOLDERS = Object.freeze([
  'name', 'target', 'seeker', 'tagger', 'friend', 'trick', 'tricks', 'height', 'score', 'team',
  'game', 'age', 'ageOrd', 'days', 'stick', 'unlock', 'count', 'total', 'left', 'bases', 'misses',
  'world',
]);

const SHORT = new Set(SHORT_SITUATIONS);
const BIRTHDAY_SITUATIONS = new Set(['birthday', 'birthdayWeek']);
const NAME_MAX = 16;
const FALLBACK = 'Go, go, go!';
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const atLeast = (x, min) => (num(x) !== null && Math.round(x) >= min ? Math.round(x) : null);

export function hypeValues(ctx, situation = '') {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const v = { world: GAME.title };
  const put = (key, val) => {
    if (val) v[key] = val;
  };
  const birthdayName = BIRTHDAY_SITUATIONS.has(situation) ? cleanInline(BIRTHDAY.name, NAME_MAX) : '';
  put('name', cleanInline(c.name, NAME_MAX) || birthdayName);
  for (const key of ['target', 'seeker', 'tagger', 'friend']) put(key, cleanInline(c[key], NAME_MAX));

  const list = Array.isArray(c.tricks) ? c.tricks : null;
  const trick = c.trick != null ? c.trick : list && list.length ? list[list.length - 1] : null;
  put('trick', trickLabel(trick) || cleanInline(trick, 20));
  const nTricks = list ? list.length : atLeast(c.tricks, 1);
  if (nTricks >= 1) put('tricks', plural(nTricks, 'trick'));

  const height = atLeast(c.height, 1);
  if (height) put('height', plural(height, 'meter'));
  if (num(c.score) !== null && c.score >= 0) put('score', fmtNumber(c.score));

  if (typeof c.team === 'number') {
    const team = Number.isInteger(c.team) && c.team >= 0 ? TEAMS[c.team] : null;
    if (team) put('team', team.name);
  } else put('team', cleanInline(c.team, NAME_MAX));
  if (typeof c.game === 'string') put('game', gameTitle(c.game) || cleanInline(c.game, 20));

  const age = atLeast(c.age, 1);
  if (age && age <= 120) {
    put('age', String(age));
    put('ageOrd', ordinal(age));
  }
  const days = atLeast(c.days, 1);
  if (days) put('days', plural(days, 'day'));

  const stick = stickById(c.stick);
  put('stick', stick ? stick.name : cleanInline(c.stick, 24));
  put('unlock', cleanInline(c.unlock, 28) || (stick ? stick.unlock.label : ''));

  for (const key of ['count', 'total', 'left']) {
    const n = atLeast(c[key], 1);
    if (n) put(key, String(n));
  }
  const bases = atLeast(c.bases, 1);
  if (bases) put('bases', plural(bases, 'friend'));
  const misses = atLeast(c.misses, 1);
  if (misses) put('misses', plural(misses, 'miss', 'misses'));
  return v;
}

export function fillTemplate(template, values) {
  let missing = false;
  const s = String(template).replace(/\{(\w+)\}/g, (_, key) => {
    if (values && has(values, key) && values[key]) return values[key];
    missing = true;
    return '';
  });
  if (missing) return null;
  return capFirst(s.replace(/\s+/g, ' ').trim());
}

export function createHype({ memory = 4 } = {}) {
  const recent = new Map();
  function hype(situation, ctx, rng) {
    const key = typeof situation === 'string' && has(HYPE_LINES, situation) ? situation : 'cheer';
    const pool = HYPE_LINES[key];
    const values = hypeValues(ctx, key);
    const max = SHORT.has(key) ? HYPE_SHORT_MAX : HYPE_MAX;
    const ok = [];
    for (let i = 0; i < pool.length; i++) {
      const s = fillTemplate(pool[i], values);
      if (s && s.length <= max) ok.push({ i, s });
    }
    if (!ok.length) return FALLBACK;
    const seen = recent.get(key) || [];
    let fresh = ok.filter((o) => !seen.includes(o.i));
    if (!fresh.length) fresh = ok.filter((o) => o.i !== seen[seen.length - 1]);
    if (!fresh.length) fresh = ok;
    const pick = fresh[pickIndex(fresh.length, rng)];
    seen.push(pick.i);
    while (seen.length > Math.max(1, memory)) seen.shift();
    recent.set(key, seen);
    return pick.s;
  }
  hype.reset = () => recent.clear();
  return hype;
}

export const hype = createHype();

export function resetHype() {
  hype.reset();
}
