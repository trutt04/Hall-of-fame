// Small shared helpers for the flow side (picker, arrival, cards, panels, fallback).
// Pure DOM and text. Nothing here touches three.js or the scene.
// Every piece of league text goes through textContent: team names are untrusted.

import { TIERS, PATHS } from '../config.js';
import { ordinal } from '../model/roasts.js';
import { fmtPts, fmtTotal } from '../model/util.js';

export { ordinal, fmtPts, fmtTotal };

// One color per neighborhood, used for stamps, headers and the map.
export const TIER_CSS = { hill: '#f5c542', heights: '#5fb8e8', plaza: '#f3eedd', bubble: '#c9b58a', park: '#ff9a3d', dump: '#9bbf5a' };
export const PLAZA_LINE = 'The Plaza. Standings board, the paper, and a statue of whoever won last year.';
export const HINT_KEY = 'lw.hinted';

export const ROOT_CLASS = 'lwf-root';

/** The one element everything the flow adds to the page lives under. Remove it and the flow's DOM is gone. */
export function flowRoot(hud) {
  let root = hud.el.querySelector(':scope > .' + ROOT_CLASS);
  if (!root) {
    root = document.createElement('div');
    root.className = ROOT_CLASS;
    hud.el.appendChild(root);
  }
  return root;
}

/** "Week 10", or "Preseason" before week 1, or "Final" once the season is over. */
export function weekLabel(meta) {
  if (!meta) return '';
  if (meta.phase === 'preseason') return 'Preseason';
  if (meta.phase === 'complete') return 'Final';
  return 'Week ' + (meta.week || 1);
}

/** What to say about this week for a team with no game on the board. */
export function idleWeekText(meta) {
  if (meta && meta.phase === 'preseason') return 'Season has not started';
  if (meta && meta.phase === 'complete') return 'Season over';
  return 'Bye week';
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function button(className, text, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
  return node;
}

export function hex(c) {
  if (typeof c === 'string') return c;
  return '#' + ((Number(c) || 0) & 0xffffff).toString(16).padStart(6, '0');
}

function rgb(c) {
  const n = typeof c === 'string' ? parseInt(c.replace('#', ''), 16) : Number(c) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(c) {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The team color, lightened just enough to read as text on the navy panels. */
export function readable(c) {
  let [r, g, b] = rgb(c);
  for (let i = 0; i < 12 && luminance((r << 16) | (g << 8) | b) < 0.26; i++) {
    r = Math.round(r + (255 - r) * 0.16);
    g = Math.round(g + (255 - g) * 0.16);
    b = Math.round(b + (255 - b) * 0.16);
  }
  return hex((r << 16) | (g << 8) | b);
}

/** Dark or light ink for text sitting on top of a team color. */
export function inkOn(c) {
  return luminance(c) > 0.3 ? '#0a1022' : '#ffffff';
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function reducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (err) {
    return false;
  }
}

export function coarsePointer() {
  try {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  } catch (err) {
    return false;
  }
}

export function loadJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export function saveJson(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadFlag(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

export function saveFlag(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch (err) { /* private mode: nothing to remember, nothing breaks */ }
}

// ---------------------------------------------------------------- league text

export function rankBig(n) {
  return ordinal(n).toUpperCase();
}

export function tierName(tier) {
  return tier === 'plaza' ? 'The Plaza' : TIERS[tier] ? TIERS[tier].name : '';
}

// Names like "Some_Long_Team_Name" have nowhere to wrap, so an invisible break goes in after
// each underscore, dot, slash or hyphen. The text itself is untouched.
export function teamName(t) {
  const name = t ? (t.name && String(t.name).trim()) || 'Team ' + t.id : '';
  return name.replace(/([_./-])(?=\S)/g, '$1\u200b');
}

export function firstTeam(model) {
  return model && model.order && model.order.length ? model.teams[model.order[0]] : null;
}

export function lastTeam(model) {
  return model && model.order && model.order.length ? model.teams[model.order[model.order.length - 1]] : null;
}

export function streakShort(streak) {
  return streak && streak.type && streak.length ? streak.type + streak.length : '';
}

export function streakLong(streak) {
  if (!streak || !streak.type || !streak.length) return '';
  const n = streak.length;
  if (streak.type === 'W') return n === 1 ? 'Won the last one' : 'Won ' + n + ' in a row';
  if (streak.type === 'L') return n === 1 ? 'Lost the last one' : 'Lost ' + n + ' in a row';
  return n === 1 ? 'Tied the last one' : 'Tied ' + n + ' in a row';
}

export function kickoffText(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch (err) {
    return '';
  }
}

/** LIVE, FINAL, or the kickoff time. */
export function statusWord(status, model) {
  if (status === 'live') return 'LIVE';
  if (status === 'final') return 'FINAL';
  const k = model && model.meta ? kickoffText(model.meta.nextKickoff) : '';
  return k ? 'Kicks off ' + k : 'Not started';
}

/** "vs Opponent" and "88.4 to 101.7 · LIVE" for one team's game this week, or null on a bye. */
export function matchupParts(model, team) {
  if (!model || !team || !team.thisWeek) return null;
  const w = team.thisWeek;
  const opp = model.teams[w.oppId];
  const word = statusWord(w.status, model);
  return {
    opponent: 'vs ' + teamName(opp),
    score: w.status === 'pre' ? word : fmtPts(w.pts) + ' to ' + fmtPts(w.oppPts) + ' · ' + word,
  };
}

/** The Hall of Fame page. The private preview build overrides the path. */
export function hallOfFameUrl() {
  const preview = typeof window !== 'undefined' ? window.__LW_PREVIEW : null;
  return (preview && preview.hallOfFame) || PATHS.hallOfFame;
}

export function sampleTag() {
  return el('span', 'lwf-sample', 'sample');
}
