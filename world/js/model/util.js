// Small pure helpers shared by derive.js, history.js and roasts.js.
// No DOM, no Date.now(), no dependencies. Runs unchanged in Node and the browser.

import { TIER_ORDER } from '../config.js';

// ---------- safe readers ----------

export function arr(v) {
  return Array.isArray(v) ? v : [];
}

export function num(v, fallback = 0) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function int(v, fallback = 0) {
  const n = num(v, NaN);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Text from untrusted data: one line, no control characters, trimmed. */
export function str(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function round2(v) {
  const n = num(v);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- seeded randomness ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of any mix of numbers and strings. */
export function hashSeed(...parts) {
  const s = parts.join('|');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function rngFor(...parts) {
  return mulberry32(hashSeed(...parts));
}

/** Fisher-Yates on a copy. */
export function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// ---------- records and standings ----------

export function recordText(wins, losses, ties) {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export function winPct(wins, losses, ties) {
  const games = wins + losses + ties;
  return games > 0 ? (wins + ties * 0.5) / games : 0;
}

export function compareIds(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** Neighborhood for a rank. Sizes come from the team count and the playoff team count. */
export function tierForRank(rank, teamCount, playoffTeams) {
  if (rank <= 1) return 'hill';
  if (rank >= teamCount) return 'dump';
  const lo = Math.max(2, playoffTeams - 1);
  const hi = Math.min(teamCount - 1, playoffTeams + 2);
  if (rank >= lo && rank <= hi) return 'bubble';
  return rank < lo ? 'heights' : 'park';
}

export function tierIndex(tier) {
  return TIER_ORDER.indexOf(tier);
}

// ---------- formatting ----------

export function ordinal(n) {
  const v = int(n, NaN);
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const mod10 = abs % 10;
  if (mod10 === 1) return `${v}st`;
  if (mod10 === 2) return `${v}nd`;
  if (mod10 === 3) return `${v}rd`;
  return `${v}th`;
}

/** A single score or margin: one decimal, two when it is under a point. */
export function fmtPts(v) {
  const n = num(v);
  const abs = Math.abs(n);
  if (abs > 0 && abs < 1) {
    const two = n.toFixed(2);
    return two.endsWith('0') ? n.toFixed(1) : two;
  }
  return n.toFixed(1);
}

/** A season total: whole number with thousands separators (no locale dependence). */
export function fmtTotal(v) {
  const n = Math.round(num(v));
  const digits = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return n < 0 ? `-${out}` : out;
}

export function plural(n, word, pluralWord) {
  return `${n} ${n === 1 ? word : pluralWord || `${word}s`}`;
}

/** Games in the standings: "1 game", "2.5 games", "half a game". */
export function fmtGames(g) {
  const n = Math.round(num(g) * 2) / 2;
  if (n === 0.5) return 'half a game';
  if (n === 1) return '1 game';
  return `${n} games`;
}

/** "a 7.2" or "an 8.8", "a 9-5" or "an 11-3": the right article for a number read aloud. */
export function withArticle(value) {
  const s = String(value);
  const whole = parseInt(s, 10);
  const an = s.charAt(0) === '8' || whole === 11 || whole === 18;
  return `${an ? 'an' : 'a'} ${s}`;
}

export function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const ELLIPSIS = String.fromCharCode(0x2026);

function graphemes(s) {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(seg.segment(s), (x) => x.segment);
    }
  } catch (e) {
    // fall through to code points
  }
  return Array.from(s);
}

/** Shorten untrusted text to `max` UTF-16 units without splitting an emoji. */
export function clip(text, max) {
  const s = String(text);
  if (s.length <= max) return s;
  let out = '';
  for (const g of graphemes(s)) {
    if (out.length + g.length > max - 1) break;
    out += g;
  }
  return `${out.trimEnd()}${ELLIPSIS}`;
}

/**
 * How we refer to each team in copy: the owner's first name when there is one and nobody else
 * in the league shares it, otherwise the team name.
 */
export function teamLabels(teams) {
  const counts = {};
  for (const t of teams) {
    const key = str(t.owner).toLowerCase();
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const labels = {};
  for (const t of teams) {
    const owner = str(t.owner);
    labels[t.id] = owner && counts[owner.toLowerCase()] === 1 ? owner : str(t.name) || `Team ${t.id}`;
  }
  return labels;
}
