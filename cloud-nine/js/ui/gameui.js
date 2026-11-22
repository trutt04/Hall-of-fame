// What the game panel and the how-to cards show, as pure data (no DOM, runs under node --test).
// Game modes hand the HUD `game.ui(meId)` (Contract 5) and content hands us how-to cards
// (Contract 8). Neither shape is pinned down to the field, so these accept every reasonable
// spelling, cap every string, and never throw.
//
//   GAME_CHOICES                     the host's picker: [{ id, title, icon, color, blurb, solo, minPlayers, teams }]
//   gameTitle(kind) -> string
//   normalizeGameUI(ui) -> null | { title, line, timer: { text, urgent } | null, big, role: { text, color } | null,
//                                   scoreboard: [{ label, value, color, me }] }
//   formatTimer(value) -> 'm:ss' | string | null       numbers are seconds (or ms when over 600)
//   normalizeHowto(mod, kind) -> { title, steps: [string] } | null   mod is the content module or a card

import { PALETTE, TEAMS } from '../config.js';

export const GAME_CHOICES = [
  { id: 'hideSeek', title: 'Hide and seek', icon: 'eyes', color: PALETTE.mint, blurb: 'Count, hide, seek. The garden is full of spots!', minPlayers: 3, teams: false },
  { id: 'freezeTag', title: 'Freeze tag', icon: 'snow', color: PALETTE.babyBlue, blurb: 'Tag to freeze. Tap a friend to thaw them out.', minPlayers: 4, teams: false },
  { id: 'dodgeball', title: 'Dodgeball', icon: 'ball', color: PALETTE.coral, blurb: 'Team Pink vs Team Purple. Throw, dodge, catch!', minPlayers: 4, teams: true },
  { id: 'captureBow', title: 'Capture the Bow', icon: 'bow', color: PALETTE.pinkSoft, blurb: "Grab their giant bow and bring it home.", minPlayers: 4, teams: true },
  { id: 'hitZero', title: 'Hit Zero', icon: 'music', color: PALETTE.lilac, blurb: 'A rhythm routine. Tap in time, miss nothing!', minPlayers: 1, teams: false },
];

export function gameTitle(kind) {
  const g = GAME_CHOICES.find((c) => c.id === kind);
  return g ? g.title : 'Game';
}

const str = (v, max) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).slice(0, max);
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
};

function colorOf(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < TEAMS.length) return TEAMS[v].color;
  if (typeof v === 'number' && Number.isFinite(v) && v > 255) return '#' + (v & 0xffffff).toString(16).padStart(6, '0');
  if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) return v;
  return null;
}

export function formatTimer(v) {
  if (v === null || v === undefined || v === false) return null;
  if (typeof v === 'string') return str(v, 10) || null;
  if (typeof v === 'object') return formatTimer(v.seconds ?? v.left ?? v.remaining ?? v.value ?? null);
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  let s = n > 600 ? n / 1000 : n;
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function timerSeconds(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 600 ? v / 1000 : v;
  if (v && typeof v === 'object') return timerSeconds(v.seconds ?? v.left ?? v.remaining ?? v.value);
  return null;
}

function rowOf(r) {
  if (Array.isArray(r)) return { label: str(r[0], 20), value: str(r[1], 8), color: colorOf(r[2]), me: !!r[3] };
  if (!r || typeof r !== 'object') return null;
  const label = str(r.label ?? r.name ?? r.nick ?? r.title ?? (typeof r.team === 'number' && TEAMS[r.team] ? TEAMS[r.team].name : r.team), 20);
  const value = str(r.value ?? r.score ?? r.points ?? r.count ?? r.text ?? '', 8);
  const color = colorOf(r.color ?? r.teamColor ?? r.team);
  return { label, value, color, me: !!(r.me ?? r.you ?? r.isMe ?? r.highlight) };
}

export function normalizeGameUI(ui) {
  if (!ui || typeof ui !== 'object') return null;
  const out = { title: str(ui.title, 32), line: str(ui.line ?? ui.subtitle ?? ui.message, 90), timer: null, big: str(ui.big, 32), role: null, scoreboard: [] };
  const tt = formatTimer(ui.timer);
  if (tt) {
    const secs = timerSeconds(ui.timer);
    out.timer = { text: tt, urgent: secs !== null && secs <= 10 && secs > 0 };
  }
  const rb = ui.roleBadge ?? ui.role;
  if (typeof rb === 'string' && rb.trim()) out.role = { text: str(rb, 24), color: null };
  else if (rb && typeof rb === 'object') {
    const text = str(rb.text ?? rb.label ?? rb.name, 24);
    if (text) out.role = { text, color: colorOf(rb.color ?? rb.team) };
  }
  const sb = ui.scoreboard ?? ui.scores;
  let rows = [];
  if (Array.isArray(sb)) rows = sb.map(rowOf).filter((r) => r && (r.label || r.value));
  else if (sb && typeof sb === 'object') {
    if (Array.isArray(sb.rows)) rows = sb.rows.map(rowOf).filter((r) => r && (r.label || r.value));
    else rows = Object.keys(sb).map((k) => rowOf({ label: k, value: sb[k] })).filter(Boolean);
  }
  out.scoreboard = rows.slice(0, 10);
  if (!out.title && !out.line && !out.timer && !out.role && !out.scoreboard.length && !out.big) return null;
  return out;
}

function cardOf(raw, kind) {
  if (!raw) return null;
  if (typeof raw === 'string') return { title: gameTitle(kind), steps: [str(raw, 140)].filter(Boolean) };
  if (Array.isArray(raw)) return { title: gameTitle(kind), steps: raw.map((s) => str(s, 140)).filter(Boolean).slice(0, 6) };
  if (typeof raw !== 'object') return null;
  let steps = raw.steps ?? raw.lines ?? raw.tips ?? raw.how ?? raw.rules ?? raw.body ?? raw.text ?? [];
  if (typeof steps === 'string') steps = [steps];
  if (!Array.isArray(steps)) steps = [];
  const clean = steps.map((s) => str(typeof s === 'object' && s ? s.text ?? s.line : s, 140)).filter(Boolean).slice(0, 6);
  const goal = str(raw.goal ?? raw.summary ?? raw.blurb ?? '', 140);
  if (goal && !clean.includes(goal)) clean.unshift(goal);
  return { title: str(raw.title ?? raw.name, 32) || gameTitle(kind), steps: clean.slice(0, 6) };
}

export function normalizeHowto(mod, kind) {
  if (!mod) return null;
  try {
    // a whole content module: look for its table or its function
    for (const key of ['howTo', 'howto', 'HOWTO', 'HOW_TO', 'HOWTOS', 'default']) {
      const v = mod[key];
      if (typeof v === 'function') {
        const c = cardOf(v(kind), kind);
        if (c && c.steps.length) return c;
      } else if (v && typeof v === 'object' && v[kind]) {
        const c = cardOf(v[kind], kind);
        if (c && c.steps.length) return c;
      }
    }
    if (mod[kind]) {
      const c = cardOf(mod[kind], kind);
      if (c && c.steps.length) return c;
    }
    // a card already
    if (mod.steps || mod.lines || mod.title) {
      const c = cardOf(mod, kind);
      if (c && c.steps.length) return c;
    }
  } catch (err) {
    return null;
  }
  return null;
}
