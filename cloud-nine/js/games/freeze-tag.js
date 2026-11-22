// Freeze tag in the tag zone (places.tagZone).
//
// One "it" (two with 7 or more players), rotating each round. "It" tags a runner (claim
// { type: 'tag', target }) and they freeze in a cheer pose. A free runner unfreezes a friend by
// standing next to them for a second: the host watches for that itself, and a device may also
// claim { type: 'unfreeze', target } once the host has seen it start. Nobody stays frozen forever:
// after `meltSeconds` a warm cloud thaws you out ('auto': quicker when each "it" chases only a
// few runners, longer when lots of friends are around to rescue you). "It" runs a little quicker
// the more runners it chases (2% each, up to 12%; who().speed). "It" wins the moment every
// runner is frozen; otherwise the free runners win when time runs out (90 s). Just-unfrozen
// runners sparkle and can't be re-frozen for 2.5 s. If the last "it" leaves, a runner takes over
// and everyone thaws. Points: +1 per freeze, +1 per rescue, +1 for being free at the end.

import { PALETTE } from '../config.js';
import {
  BOT_SETTING, LAG, boundsArea, clamp, clampArea, cleanId, dist, escapeDir, isObj, navigate, num, own,
  pickRotation, r2, toWorld, wander,
} from './common.js';

export const TAG_R = 1.5; // meters: a tag
export const RESCUE_R = 1.8; // meters: close enough to unfreeze a friend
export const RESCUE_MS = 1000; // standing there this long unfreezes them
const SAFE_MS = 2500;
// "it" gets a little quicker the more runners each "it" has to chase (2% per runner, up to 12%),
// so being it is fun in a big group and fair in a small one. who().speed tells the app.

function runners(g) {
  return g.st.order.filter((id) => g.P(id).role === 'runner');
}

function its(g) {
  return g.st.order.filter((id) => g.P(id).role === 'it');
}

function freeRunners(g) {
  return runners(g).filter((id) => !g.P(id).frozen);
}

function nm(g, id, me, cap) {
  if (me && id === me) return cap ? 'You' : 'you';
  return g.name(id);
}

function checkAllFrozen(g, now) {
  if (g.st.phase !== 'play') return;
  const r = runners(g);
  if (r.length > 0 && r.every((id) => g.P(id).frozen)) g.finish({ winner: 'it', ids: its(g) }, now);
}

function unfreeze(g, id, by, now) {
  const p = g.P(id);
  p.frozen = false;
  p.frozenAt = 0;
  p.thawBy = null;
  p.thawSince = 0;
  p.safeUntil = now + SAFE_MS;
  const at = g.pos(id);
  if (by && g.P(by)) {
    g.P(by).rescues = num(g.P(by).rescues) + 1;
    g.st.scores[by] = num(g.st.scores[by]) + 1;
    g.fx({ type: 'unfreeze', ids: [by, id], x: at ? r2(at.x) : null, z: at ? r2(at.z) : null, sfx: 'unfreeze', burst: true, hype: 'unfreeze' });
  } else {
    g.fx({ type: 'melt', id, x: at ? r2(at.x) : null, z: at ? r2(at.z) : null, sfx: 'unfreeze', burst: true });
  }
}

export function itSpeed(g) {
  const perIt = runners(g).length / Math.max(1, its(g).length);
  return 1 + 0.02 * clamp(perIt, 1, 6);
}

/** How long until a warm cloud thaws a frozen runner (0 = never). */
export function meltMs(g) {
  const s = g.st.settings.meltSeconds;
  if (s !== 'auto') return num(s) * 1000;
  const perIt = runners(g).length / Math.max(1, its(g).length);
  return clamp(6 * perIt - 7, 5, 36) * 1000;
}

function promoteIt(g, now) {
  // The last "it" left: a runner takes over and everybody thaws, a fair fresh start.
  const st = g.st;
  if (st.phase !== 'play' && st.phase !== 'countdown') return;
  if (its(g).length > 0 || runners(g).length < 2) return; // too few left: the machine ends the round
  const free = freeRunners(g);
  const [id] = pickRotation(free.length ? free : runners(g), st.players, 1, g.rng);
  for (const r of runners(g)) {
    const p = g.P(r);
    if (p.frozen) {
      p.frozen = false;
      p.frozenAt = 0;
      p.safeUntil = now + SAFE_MS;
    }
    p.thawBy = null;
    p.thawSince = 0;
  }
  const p = g.P(id);
  p.role = 'it';
  p.turns = num(p.turns) + 1;
  g.fx({ type: 'newIt', id, sfx: 'chime' });
}

export const freezeTag = {
  kind: 'freezeTag',
  title: 'Freeze tag',
  place: 'tagZone',
  minPlayers: 2,
  hasHide: false,
  teams: false,
  settings: [
    { id: 'playSeconds', label: 'Round time', options: [60, 90, 120, 150], default: 90 },
    { id: 'its', label: 'Taggers', options: ['auto', 1, 2, 3], labels: { auto: 'Auto' }, default: 'auto' },
    { id: 'meltSeconds', label: 'Auto thaw', options: ['auto', 0, 10, 15, 20, 30], labels: { auto: 'Auto', 0: 'Off' }, default: 'auto' },
    BOT_SETTING,
  ],

  arena(raw) {
    const a = isObj(raw) && isObj(raw.tagZone) ? raw.tagZone : isObj(raw) ? raw : {};
    return { area: boundsArea(a.bounds) };
  },

  init(g) {
    g.st.scores = {};
  },

  newPlayer(g) {
    const late = g.st.phase === 'play';
    return { role: 'runner', turns: 0, frozen: false, frozenAt: 0, safeUntil: late ? g.now + SAFE_MS : 0, thawBy: null, thawSince: 0, freezes: 0, rescues: 0 };
  },

  joined(g, id) {
    if (!own(g.st.scores, id)) g.st.scores[id] = 0;
  },

  left(g, id, now) {
    delete g.st.scores[id];
    for (const other of g.st.order) {
      const p = g.P(other);
      if (p.thawBy === id) {
        p.thawBy = null;
        p.thawSince = 0;
      }
    }
    promoteIt(g, now);
    checkAllFrozen(g, now);
  },

  setup(g) {
    const st = g.st;
    const n = st.order.length;
    const want = st.settings.its === 'auto' ? (n >= 7 ? 2 : 1) : st.settings.its;
    const chosen = pickRotation(st.order, st.players, clamp(want, 1, n - 1), g.rng);
    for (const id of st.order) {
      const p = g.P(id);
      p.role = chosen.includes(id) ? 'it' : 'runner';
      if (p.role === 'it') p.turns = num(p.turns) + 1;
      p.frozen = false;
      p.frozenAt = 0;
      p.safeUntil = 0;
      p.thawBy = null;
      p.thawSince = 0;
      p.freezes = 0;
      p.rescues = 0;
    }
  },

  phaseMs(g) {
    return g.sec('playSeconds');
  },

  tick(g, now) {
    const st = g.st;
    if (st.phase !== 'play') return;
    const melt = meltMs(g);
    const free = freeRunners(g);
    for (const id of runners(g)) {
      const p = g.P(id);
      if (!p.frozen) continue;
      if (melt > 0 && now - p.frozenAt >= melt) {
        unfreeze(g, id, null, now);
        g.bump();
        continue;
      }
      const at = g.pos(id);
      let best = null;
      let bestD = RESCUE_R;
      if (at) {
        for (const r of free) {
          const q = g.pos(r);
          if (!q) continue;
          const d = dist(at, q);
          if (d <= bestD || (r === p.thawBy && d <= RESCUE_R + 0.3)) {
            bestD = d;
            best = r;
            if (r === p.thawBy) break;
          }
        }
      }
      if (!best) {
        if (p.thawBy) {
          p.thawBy = null;
          p.thawSince = 0;
          g.bump();
        }
      } else if (p.thawBy !== best) {
        p.thawBy = best;
        p.thawSince = now;
        g.bump();
      } else if (now - p.thawSince >= RESCUE_MS) {
        unfreeze(g, id, best, now);
        g.bump();
      }
    }
  },

  claim(g, from, c, now) {
    const st = g.st;
    if (st.phase !== 'play') return false;
    const me = g.P(from);
    const target = cleanId(c.target);
    const t = target ? g.P(target) : null;
    if (!t || target === from || t.role !== 'runner') return false;
    const a = g.pos(from);
    const b = g.pos(target);
    if (!a || !b) return false;
    const d = dist(a, b);
    if (c.type === 'tag') {
      if (me.role !== 'it' || t.frozen || now < t.safeUntil || d > TAG_R + LAG) return false;
      t.frozen = true;
      t.frozenAt = now;
      t.thawBy = null;
      t.thawSince = 0;
      me.freezes = num(me.freezes) + 1;
      st.scores[from] = num(st.scores[from]) + 1;
      g.fx({ type: 'freeze', ids: [from, target], x: r2(b.x), z: r2(b.z), sfx: 'freeze', burst: true, hype: 'freeze' });
      checkAllFrozen(g, now);
      return true;
    }
    if (c.type === 'unfreeze') {
      if (me.role !== 'runner' || me.frozen || !t.frozen || d > RESCUE_R + LAG) return false;
      if (t.thawBy !== from || now - t.thawSince < RESCUE_MS * 0.5) return false;
      unfreeze(g, target, from, now);
      return true;
    }
    return false;
  },

  timeUp(g) {
    const free = freeRunners(g);
    if (free.length) return { winner: 'runners', ids: free };
    return { winner: 'it', ids: its(g) };
  },

  award(g, res) {
    if (res.winner !== 'runners') return;
    for (const id of res.ids) g.st.scores[id] = num(g.st.scores[id]) + 1;
  },

  reset(g) {
    for (const id of g.st.order) {
      const p = g.P(id);
      p.role = 'runner';
      p.frozen = false;
      p.frozenAt = 0;
      p.thawBy = null;
      p.thawSince = 0;
      p.safeUntil = 0;
    }
  },

  spawn(g, id) {
    const A = g.arena.area;
    const p = g.P(id);
    if (p.role === 'it') {
      const list = its(g);
      const k = Math.max(0, list.indexOf(id));
      const off = list.length > 1 ? (k - (list.length - 1) / 2) * 2 : 0;
      const q = toWorld(A.f, off, 0);
      return { x: q.x, z: q.z, facing: 0 };
    }
    const list = g.st.order.filter((x) => g.P(x).role !== 'it');
    const k = Math.max(0, list.indexOf(id));
    const ang = ((k + 0.5) / Math.max(1, list.length)) * Math.PI * 2;
    const w = toWorld(A.f, Math.sin(ang) * A.hw * 0.55, Math.cos(ang) * A.hd * 0.55);
    const q = clampArea(A, w.x, w.z, 1);
    return { x: q.x, z: q.z, facing: Math.atan2(q.x - A.f.x, q.z - A.f.z) };
  },

  confine(g, id, x, z) {
    return clampArea(g.arena.area, x, z, 0.3);
  },

  bot(g, id, pos, dt, m) {
    if (g.st.phase !== 'play') return null;
    const p = g.P(id);
    if (p.role === 'it') return itBot(g, id, pos, dt, m);
    if (p.frozen) return { anim: 'frozen' };
    return runnerBot(g, id, pos, dt, m);
  },

  who(g, id, p, w) {
    const now = g.clock();
    w.role = p.role === 'runner' && p.frozen ? 'frozen' : p.role;
    if (p.role === 'it') {
      w.color = PALETTE.coral;
      w.glow = true;
      w.speed = itSpeed(g);
    } else if (p.frozen) {
      w.color = PALETTE.babyBlue;
      w.glow = true;
      if (g.st.phase === 'play') {
        w.anim = 'frozen';
        w.canMove = false;
      }
    } else if (now < p.safeUntil) {
      w.color = PALETTE.mint;
      w.glow = true;
    }
  },

  ui(g, me, now, u) {
    const st = g.st;
    const p = me ? g.P(me) : null;
    const r = runners(g);
    const frozen = r.filter((id) => g.P(id).frozen).length;
    if (p && st.phase !== 'lobby') {
      if (p.role === 'it') u.roleBadge = { text: "You're it!", color: PALETTE.coral, icon: 'snowflake' };
      else if (p.frozen) u.roleBadge = { text: 'Frozen!', color: PALETTE.babyBlue, icon: 'snowflake' };
      else u.roleBadge = { text: 'Runner', color: PALETTE.mint, icon: 'run' };
    }
    const since = now - st.phaseStarted;
    if (st.phase === 'countdown') {
      u.line = p && p.role === 'it' ? "You're it! Get ready to freeze everyone!" : "Get ready to run! Don't get frozen!";
    } else if (st.phase === 'play') {
      if (!p) u.line = `${frozen} of ${r.length} frozen`;
      else if (p.role === 'it') u.line = `Freeze everyone! ${frozen} of ${r.length} frozen.`;
      else if (p.frozen) {
        const melt = meltMs(g);
        const thaw = melt > 0 ? ` Thawing in ${Math.max(0, Math.ceil((p.frozenAt + melt - now) / 1000))}.` : '';
        u.line = p.thawBy ? 'A friend is unfreezing you!' : `Frozen! Wait for a friend to unfreeze you.${thaw}`;
      } else u.line = frozen > 0 ? `Run! Stand next to a frozen friend to unfreeze them. ${frozen} frozen.` : "Run! Don't let it catch you!";
      if (p && p.frozen && now - p.frozenAt < 2000) u.big = { text: 'Frozen!', sub: 'Strike a pose!' };
      else if (p && !p.frozen && p.role === 'runner' && now < p.safeUntil && since > SAFE_MS) u.big = { text: 'Free!', sub: 'Go go go!' };
      else if (since < 1500) u.big = { text: 'Go!', sub: p && p.role === 'it' ? 'Freeze everyone!' : 'Run!' };
    } else if (st.phase === 'results') {
      const res = st.result || { winner: 'none', ids: [] };
      const mine = me && res.ids.includes(me);
      if (res.winner === 'it') u.big = { text: 'Everyone frozen!', sub: mine ? 'Super tagging!' : 'Brrr! Great running, everybody!' };
      else if (res.winner === 'runners') u.big = { text: 'Runners win!', sub: mine ? 'Nobody could catch you!' : 'So close! Great hustle!' };
      else u.big = { text: 'Round over', sub: 'Not enough players this time' };
      u.line = 'Great game, everybody!';
    }
    const rows = st.order.map((id) => ({ id, label: g.name(id), value: num(st.scores[id]), me: id === me, color: null }));
    rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    u.scoreboard = { title: 'Points', rows };
  },

  auto(g, me, now) {
    const st = g.st;
    const p = g.P(me);
    if (st.phase !== 'play') return null;
    const a = g.pos(me);
    if (!a) return null;
    if (p.role === 'it') {
      let best = null;
      let bestD = TAG_R;
      for (const id of freeRunners(g)) {
        if (now < g.P(id).safeUntil) continue;
        const b = g.pos(id);
        if (!b) continue;
        const d = dist(a, b);
        if (d <= bestD) {
          bestD = d;
          best = id;
        }
      }
      return best ? { type: 'tag', target: best } : null;
    }
    if (p.frozen) return null;
    for (const id of runners(g)) {
      const t = g.P(id);
      if (!t.frozen || t.thawBy !== me || now - t.thawSince < RESCUE_MS) continue;
      const b = g.pos(id);
      if (b && dist(a, b) <= RESCUE_R) return { type: 'unfreeze', target: id };
    }
    return null;
  },

  text(g, fx, me) {
    const [a, b] = Array.isArray(fx.ids) ? fx.ids : [];
    switch (fx.type) {
      case 'freeze':
        if (b === me) return `${nm(g, a, me, true)} froze you! Strike a pose!`;
        return `${nm(g, a, me, true)} froze ${nm(g, b, me)}!`;
      case 'unfreeze':
        if (a === me) return `You unfroze ${nm(g, b, me)}! Hero!`;
        if (b === me) return `${nm(g, a, me, true)} unfroze you!`;
        return `${nm(g, a, me, true)} unfroze ${nm(g, b, me)}!`;
      case 'melt':
        return fx.id === me ? 'A warm cloud thawed you out!' : `${g.name(fx.id)} thawed out!`;
      case 'newIt':
        return fx.id === me ? "You're it now!" : `${g.name(fx.id)} is it now!`;
      case 'phase':
        return fx.phase === 'play' ? 'Go!' : '';
      case 'join':
        return fx.id === me ? '' : `${g.name(fx.id)} joined the game!`;
      default:
        return '';
    }
  },

  cleanPlayer(rp) {
    return {
      role: rp.role === 'it' ? 'it' : 'runner',
      turns: clamp(Math.trunc(num(rp.turns)), 0, 1e6),
      frozen: rp.frozen === true && rp.role !== 'it',
      frozenAt: Math.max(0, num(rp.frozenAt)),
      safeUntil: Math.max(0, num(rp.safeUntil)),
      thawBy: cleanId(rp.thawBy),
      thawSince: Math.max(0, num(rp.thawSince)),
      freezes: clamp(Math.trunc(num(rp.freezes)), 0, 1000),
      rescues: clamp(Math.trunc(num(rp.rescues)), 0, 1000),
    };
  },

  clean(raw, st) {
    st.scores = {};
    for (const id of st.order) {
      st.scores[id] = clamp(Math.trunc(num(isObj(raw.scores) && own(raw.scores, id) ? raw.scores[id] : 0)), 0, 1e6);
      const p = st.players[id];
      if (p.thawBy && !own(st.players, p.thawBy)) p.thawBy = null;
    }
  },

  cleanWinner(v) {
    return v === 'it' || v === 'runners' ? v : 'none';
  },
};

// ---------- bots ----------

function itBot(g, id, pos, dt, m) {
  const L = g.level();
  const now = g.now;
  const targets = freeRunners(g).filter((r) => now >= g.P(r).safeUntil);
  let action = null;
  for (const r of targets) {
    const q = g.pos(r);
    if (q && dist(pos, q) <= TAG_R * 0.9) {
      action = { type: 'tag', target: r };
      break;
    }
  }
  if (m.target && g.P(m.target) && g.P(m.target).frozen) {
    // got them! a quick cheer before the next chase, which gives everyone a moment to scatter
    m.target = null;
    m.cheer = 1.2 + g.rng() * 0.8;
  }
  if (m.cheer > 0) {
    m.cheer -= dt;
    return { move: { x: 0, z: 0 }, action: null, anim: 'cheer' };
  }
  if (m.rest > 0) {
    m.rest -= dt; // catching a breath, like a real kid
    return { move: wander(m, pos, g.arena.area, L.speed * 0.5, dt, g.rng), action };
  }
  m.think -= dt;
  if (m.think <= 0) {
    m.think = L.react + g.rng() * 0.3;
    const chasedByOthers = new Set();
    for (const other of its(g)) {
      if (other === id) continue;
      const om = g.mem.get(other);
      if (om && om.target) chasedByOthers.add(om.target);
    }
    let best = null;
    let bestScore = Infinity;
    for (const r of targets) {
      const q = g.pos(r);
      if (!q) continue;
      let score = dist(pos, q) + (chasedByOthers.has(r) ? 5 : 0) + g.rng() * 2;
      // someone standing still to unfreeze a friend is a tempting target
      if (runners(g).some((f) => g.P(f).frozen && g.P(f).thawBy === r)) score -= 4 * L.see;
      if (r === m.target) score *= 0.75;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (m.target !== best) m.chaseT = 0;
    m.target = best;
    m.chaseT = num(m.chaseT) + L.react;
    if (m.chaseT > 9 && g.rng() < 0.25 * (1 - L.see * 0.5)) {
      m.rest = 1 + g.rng(); // gave up on that one for now
      m.chaseT = 0;
    }
  }
  const q = m.target ? g.pos(m.target) : null;
  if (!q) return { move: wander(m, pos, g.arena.area, L.speed * 0.7, dt, g.rng), action };
  const speed = L.speed * itSpeed(g);
  // like a real kid, "it" commits to where it's heading for a moment before re-reading the
  // runner, so a good juke works
  m.aimT = num(m.aimT) - dt;
  const close = dist(pos, q) < 3; // up close: go straight for them, no guessing ahead
  if (close || m.aimT <= 0 || !m.aim || m.aimFor !== m.target) {
    const tr = g.track.get(m.target);
    const lead = tr && !close ? Math.min(1.2, dist(pos, q) / speed) * L.lead : 0;
    m.aim = clampArea(g.arena.area, q.x + (tr ? tr.vx * lead : 0), q.z + (tr ? tr.vz * lead : 0), 0.3);
    m.aimFor = m.target;
    m.aimT = L.react * (0.35 + g.rng() * 0.4);
  }
  const ahead = dist(pos, m.aim) < 0.8 ? q : m.aim;
  return { move: navigate(m, pos, ahead, speed, dt, g.rng, 0.2), action };
}

function runnerBot(g, id, pos, dt, m) {
  const L = g.level();
  const A = g.arena.area;
  const now = g.now;
  let action = null;
  const taggers = [];
  for (const t of its(g)) {
    const q = g.pos(t);
    if (q) taggers.push({ id: t, q, d: dist(pos, q) });
  }
  taggers.sort((a, b) => a.d - b.d);
  const near = taggers[0];
  const fleeR = 4 + 4 * L.see;
  m.think -= dt;
  if (m.think <= 0) {
    m.think = L.react + g.rng() * 0.3;
    m.flee = !!(near && near.d < fleeR);
    // a frozen friend to rescue: the closest one that isn't being guarded
    let best = null;
    let bestD = 30;
    for (const r of runners(g)) {
      const t = g.P(r);
      if (!t.frozen) continue;
      const q = g.pos(r);
      if (!q) continue;
      const guard = taggers.some((x) => dist(x.q, q) < 5 - L.nerve * 2);
      const d = dist(pos, q);
      if (!guard && d < bestD) {
        bestD = d;
        best = r;
      }
    }
    m.rescue = best;
  }
  if (near && near.d < 4) m.flee = true; // close calls get noticed at once
  if (m.flee && near) {
    m.escT = num(m.escT) - dt;
    if (m.escT <= 0 || !m.esc) {
      const threats = taggers.filter((t) => t.d < fleeR * 1.5).map((t) => t.q);
      m.esc = escapeDir(pos, threats, A, m.esc, g.rng, 2.6 - 2 * L.see);
      m.escT = near.d < 4 ? 0.12 + L.react * 0.25 : 0.2 + L.react * 0.6;
    }
    return { move: { x: m.esc.x * L.speed, z: m.esc.z * L.speed }, action };
  }
  if (m.rescue) {
    const q = g.pos(m.rescue);
    const t = g.P(m.rescue);
    if (q && t && t.frozen) {
      if (t.thawBy === id && now - t.thawSince >= RESCUE_MS && dist(pos, q) <= RESCUE_R) action = { type: 'unfreeze', target: m.rescue };
      if (dist(pos, q) < 1.1) return { move: { x: 0, z: 0 }, action, anim: 'clap' };
      return { move: navigate(m, pos, q, L.speed, dt, g.rng, 0.6), action };
    }
    m.rescue = null;
  }
  return { move: wander(m, pos, A, L.speed * 0.55, dt, g.rng), action };
}
