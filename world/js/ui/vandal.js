// The flow side of vandalism: who may settle a score with whom (model.vandalism) and what has
// been thrown this week (world.vandal, saved on this device for now). Either piece may be missing,
// so every read here is guarded and answers null or '' instead of throwing.
//
//   rightOf(ctx, teamId)             { targetId, week, margin, ... } | null    whose home this team may visit
//   damageOf(ctx, teamId)            { egg, tp, tag, by } | null               only when something was thrown this week
//   ammoLeft(ctx, attackerId)        { egg, tp, tag } | null                   what is left of the weekly allowance
//   countText({ egg, tp, tag })      '7 eggs, 2 rolls, 1 tag'
//   startLine(ctx, teamId)           the arrival line for a team with a right, or ''
//   cardLine(ctx, teamId, viewerId)  the model's line for a target's home card, or ''
//   postcardLine(ctx, teamId)        'Freshly egged by <attacker>' for a damaged home, or ''
//   canEnter(ctx)                    world.vandal.enter() exists
//   enterVandal(ctx, teamId)         closes cards and panels, then starts the mode (or just goes there)
//
// Team ids may arrive as numbers or as object keys, so ids are compared with same().

import { modelOf, travelToHome } from './seam.js';

const KINDS = ['egg', 'tp', 'tag'];
const WORDS = { egg: ['egg', 'eggs'], tp: ['roll', 'rolls'], tag: ['tag', 'tags'] };
const POSTCARD = { egg: 'Freshly egged by {name}', tp: 'Toilet papered by {name}', tag: 'Tagged by {name}' };
export const SETTLE_LABEL = 'Settle the score';

const count = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const known = (v) => v !== null && v !== undefined && v !== '';
export const same = (a, b) => known(a) && known(b) && Number(a) === Number(b);

export function vandalOf(ctx) {
  const m = modelOf(ctx);
  const v = m && m.vandalism;
  return v && typeof v === 'object' ? v : null;
}

function worldVandal(ctx) {
  const w = ctx && ctx.world && ctx.world.vandal;
  return w && typeof w === 'object' ? w : null;
}

function validRight(r) {
  return r && typeof r === 'object' && known(r.targetId) ? r : null;
}

/** The world knows best (it may know the week is over); the model is the fallback. */
export function rightOf(ctx, teamId) {
  if (!known(teamId)) return null;
  const w = worldVandal(ctx);
  if (w && typeof w.right === 'function') {
    try {
      return validRight(w.right(teamId));
    } catch (err) { /* fall back to the model */ }
  }
  const v = vandalOf(ctx);
  return validRight(v && v.rights ? v.rights[teamId] : null);
}

export function damageOf(ctx, teamId) {
  const w = worldVandal(ctx);
  if (!known(teamId) || !w || typeof w.summary !== 'function') return null;
  let s = null;
  try {
    s = w.summary(teamId);
  } catch (err) {
    return null;
  }
  if (!s || typeof s !== 'object') return null;
  const out = { egg: count(s.egg), tp: count(s.tp), tag: count(s.tag), by: known(s.by) ? s.by : null };
  if (!out.egg && !out.tp && !out.tag) return null;
  if (out.by === null) {
    const v = vandalOf(ctx);
    out.by = v && v.victims && known(v.victims[teamId]) ? v.victims[teamId] : null;
  }
  return out;
}

export function ammoLeft(ctx, attackerId) {
  const r = rightOf(ctx, attackerId);
  if (!r) return null;
  // the world counts exactly what the chips count (misses and all); the rest is a fallback
  const w = worldVandal(ctx);
  if (w && typeof w.left === 'function') {
    try {
      const l = w.left(attackerId);
      if (l && typeof l === 'object') return { egg: count(l.egg), tp: count(l.tp), tag: count(l.tag) };
    } catch (err) { /* fall back to what is drawn */ }
  }
  const v = vandalOf(ctx);
  const allow = (v && v.allowance) || { egg: 12, tp: 4, tag: 1 };
  const d = damageOf(ctx, r.targetId);
  const used = d && (d.by === null || same(d.by, attackerId)) ? d : null;
  const left = {};
  for (const k of KINDS) left[k] = Math.max(0, count(allow[k]) - (used ? used[k] : 0));
  return left;
}

export function hasAmmo(left) {
  return !!left && KINDS.some((k) => left[k] > 0);
}

export function countText(c) {
  if (!c) return '';
  return KINDS.filter((k) => count(c[k]) > 0).map((k) => count(c[k]) + ' ' + WORDS[k][count(c[k]) === 1 ? 0 : 1]).join(', ');
}

export function settleLabel(ctx) {
  const v = vandalOf(ctx);
  const label = v && v.lines ? v.lines.label : '';
  return typeof label === 'string' && label.trim() ? label.trim() : SETTLE_LABEL;
}

function teamOf(ctx, id) {
  const m = modelOf(ctx);
  return m && m.teams && known(id) ? m.teams[id] || null : null;
}

/** A team's name as text, for copy built here. */
export function nameOf(ctx, id) {
  const t = teamOf(ctx, id);
  return t ? String(t.name || 'Team ' + t.id).trim() : '';
}

export function startLine(ctx, teamId) {
  const r = rightOf(ctx, teamId);
  if (!r) return '';
  const v = vandalOf(ctx);
  const line = v && v.lines && v.lines.start ? v.lines.start[teamId] : '';
  if (typeof line === 'string' && line.trim()) return line.trim();
  const target = nameOf(ctx, r.targetId);
  return target ? 'You beat ' + target + ' last week. Their house is fair game this week.' : '';
}

export function cardLine(ctx, teamId, viewerId) {
  const v = vandalOf(ctx);
  if (!v || !v.victims || !known(v.victims[teamId]) || !v.lines || !v.lines.card) return '';
  const c = v.lines.card;
  const text = same(teamId, viewerId) ? c.mine : c.theirs ? c.theirs[teamId] : '';
  return typeof text === 'string' ? text.trim() : '';
}

export function postcardLine(ctx, teamId) {
  const d = damageOf(ctx, teamId);
  if (!d) return '';
  // the biggest pile names the card; a tie goes to whatever shows the most
  let kind = null;
  for (const k of ['tag', 'tp', 'egg']) if (d[k] > 0 && (!kind || d[k] > d[kind])) kind = k;
  const v = vandalOf(ctx);
  const lines = v && v.lines && v.lines.postcard ? v.lines.postcard : {};
  const template = typeof lines[kind] === 'string' && lines[kind].includes('{name}') ? lines[kind] : POSTCARD[kind];
  return template.replace(/\{name\}/g, nameOf(ctx, d.by) || 'a sore winner');
}

export function canEnter(ctx) {
  const w = worldVandal(ctx);
  return !!(w && typeof w.enter === 'function');
}

/** Closes whatever is open first: the mode ends as soon as a card or panel opens. */
export async function enterVandal(ctx, teamId) {
  try {
    ctx.hud.closeAll();
  } catch (err) { /* nothing open */ }
  const w = worldVandal(ctx);
  if (w && typeof w.enter === 'function') {
    try {
      await w.enter();
      return true;
    } catch (err) {
      console.error('[lw] the vandal mode did not start, going there instead', err);
    }
  }
  const r = rightOf(ctx, teamId);
  return r ? travelToHome(ctx, r.targetId) : false;
}
