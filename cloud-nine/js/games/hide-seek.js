// Hide and seek in the hide garden (places.hideGarden).
//
// One seeker (two with 7 or more players), rotating each round: whoever has sought the least goes
// next. Countdown, then a hide phase (30 s: the seeker counts with eyes covered, hiders run to a
// hide spot), then about 2 minutes of seeking. Getting within 2 m of a hider finds them (claim
// { type: 'found', target }); found hiders join the seeking team, so nobody sits around. Every
// 30 seconds a sparkle hint puffs over the hiders still hidden. Hiders still hidden at the end win;
// if everyone is found first, the seekers win. Points: +1 per find, +2 for staying hidden.
//
// Every mode is an object with the same hooks, called by machine.js:
//   kind, title, place, minPlayers, hasHide, teams, settings (schema), arena(raw) -> { area, ... }
//   init(g), newPlayer(g, id, now), joined?(g, id, now), leaving?(g, id, now), left?(g, id, now)
//   setup(g, now) (roles and teams for a new round), enter?(g, phase, now), phaseMs(g, phase)
//   tick(g, now), claim(g, from, claim, now) -> boolean, timeUp(g, now) -> result, award?(g, result, now),
//   awards?(g, result) -> [{ id, score(id), many? }] (the end-of-round awards, see awards.js),
//   reset?(g, now), spawn(g, id), confine(g, id, x, z), bot(g, id, pos, dt, mem),
//   ui(g, me, now, u), who(g, id, player, w, pos), auto?(g, me, now), press?(g, me, now, aim),
//   text(g, fx, me), cleanPlayer(raw, st), clean(raw, st, g), cleanWinner(v), extra?(g, game)

import { PALETTE } from '../config.js';
import {
  BOT_SETTING, LAG, boundsArea, clamp, clampArea, cleanId, cleanPoint, dist, fmtClock, inArea, isNum, isObj,
  listNames, navigate, num, own, pickRotation, r2, rectArea, toWorld,
} from './common.js';

export const FIND_R = 2; // meters: this close to a hider finds them
const KINDS = ['hedge', 'bush', 'slide', 'tent', 'rack', 'cloud', 'barrel', 'curtain'];
// how easy a hider is to spot when a seeker looks right at the spot (a tent hides you better than a bush)
const SHOWS = { hedge: 0.8, bush: 1, slide: 0.9, tent: 0.6, rack: 0.85, cloud: 0.7, barrel: 0.9, curtain: 0.65 };
const ROLES = ['hider', 'seeker', 'found'];

function spotAt(A, p) {
  for (const s of A.spots) if (Math.hypot(p.x - s.x, p.z - s.z) <= s.r + 0.3) return s;
  return null;
}

function shared(g) {
  if (!g.hs || g.hs.round !== g.st.round) g.hs = { round: g.st.round, taken: new Map(), checked: new Map(), target: new Map() };
  return g.hs;
}

function hiders(g) {
  return g.st.order.filter((id) => g.P(id).role === 'hider');
}

function seekingTeam(g) {
  return g.st.order.filter((id) => g.P(id).role !== 'hider');
}

function nm(g, id, me, cap) {
  if (me && id === me) return cap ? 'You' : 'you';
  return g.name(id);
}

function checkAllFound(g, now) {
  if (g.st.phase !== 'play' || hiders(g).length > 0) return;
  const ids = g.st.order.filter((id) => g.P(id).role === 'seeker' || (g.P(id).role === 'found' && g.P(id).finds > 0));
  g.finish({ winner: 'seekers', ids }, now);
}

function promoteSeeker(g, now) {
  // The seeker left: the hider who has sought the least takes over (and goes to the start).
  const st = g.st;
  if (st.phase !== 'hide' && st.phase !== 'play' && st.phase !== 'countdown') return;
  if (st.order.some((id) => g.P(id).role === 'seeker')) return;
  const pool = st.phase === 'play' ? st.order.filter((id) => g.P(id).role === 'found') : [];
  const from = pool.length ? pool : hiders(g);
  if (from.length < 1) return;
  const [id] = pickRotation(from, st.players, 1, g.rng);
  const p = g.P(id);
  p.role = 'seeker';
  p.turns = num(p.turns) + 1;
  g.fx({ type: 'newSeeker', id, sfx: 'chime' });
  if (st.phase !== 'play') g.teleport(id);
  checkAllFound(g, now);
}

export const hideSeek = {
  kind: 'hideSeek',
  title: 'Hide and seek',
  place: 'hideGarden',
  minPlayers: 2,
  hasHide: true,
  teams: false,
  settings: [
    { id: 'hideSeconds', label: 'Hiding time', options: [20, 30, 45], default: 30 },
    { id: 'seekSeconds', label: 'Seeking time', options: [60, 90, 120, 150, 180], default: 120 },
    { id: 'hintSeconds', label: 'Sparkle hints', options: [0, 20, 30, 45], labels: { 0: 'Off' }, default: 30 },
    { id: 'seekers', label: 'Seekers', options: ['auto', 1, 2], labels: { auto: 'Auto' }, default: 'auto' },
    BOT_SETTING,
  ],

  arena(raw) {
    const a = isObj(raw) && isObj(raw.hideGarden) ? raw.hideGarden : isObj(raw) ? raw : {};
    let area = boundsArea(a.bounds);
    const sp = cleanPoint(a.seekerStart);
    const start = sp ? { x: sp.x, z: sp.z, facing: num(a.seekerStart.facing) } : { x: area.f.x, z: area.f.z, facing: 0 };
    if (!inArea(area, start.x, start.z, 1)) {
      // the seeker starts at the garden gate: stretch the play area to include it
      const x0 = Math.min(area.f.x - area.hw, start.x - 1.5);
      const x1 = Math.max(area.f.x + area.hw, start.x + 1.5);
      const z0 = Math.min(area.f.z - area.hd, start.z - 1.5);
      const z1 = Math.max(area.f.z + area.hd, start.z + 1.5);
      area = rectArea((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0);
    }
    const spots = [];
    const list = Array.isArray(a.hideSpots) ? a.hideSpots : [];
    for (const s of list) {
      const p = cleanPoint(s);
      if (!p || !inArea(area, p.x, p.z, -2)) continue;
      const q = clampArea(area, p.x, p.z, 0.3);
      spots.push({
        i: spots.length,
        id: cleanId(s.id) || `spot${spots.length}`,
        x: q.x,
        z: q.z,
        kind: KINDS.includes(s.kind) ? s.kind : 'bush',
        r: clamp(num(s.r, 1.2), 0.6, 3),
      });
      if (spots.length >= 64) break;
    }
    if (spots.length < 4) {
      // not enough hide spots: scatter some bushes so the game still works
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const p = toWorld(area.f, Math.cos(ang) * area.hw * 0.7, Math.sin(ang) * area.hd * 0.7);
        spots.push({ i: spots.length, id: `auto${k}`, x: p.x, z: p.z, kind: 'bush', r: 1.2 });
      }
    }
    return { area, start, spots };
  },

  init(g) {
    g.st.scores = {};
    g.st.hint = null;
    g.st.nextHint = 0;
  },

  newPlayer(g) {
    return { role: g.st.phase === 'play' ? 'found' : 'hider', turns: 0, finds: 0, foundBy: null, foundAt: 0 };
  },

  joined(g, id) {
    if (!own(g.st.scores, id)) g.st.scores[id] = 0;
  },

  left(g, id, now) {
    delete g.st.scores[id];
    if (g.hs) g.hs.target.delete(id);
    promoteSeeker(g, now);
    checkAllFound(g, now);
  },

  setup(g) {
    const st = g.st;
    const n = st.order.length;
    const want = st.settings.seekers === 'auto' ? (n >= 7 ? 2 : 1) : st.settings.seekers;
    const seekers = pickRotation(st.order, st.players, clamp(want, 1, n - 1), g.rng);
    for (const id of st.order) {
      const p = g.P(id);
      p.role = seekers.includes(id) ? 'seeker' : 'hider';
      if (p.role === 'seeker') p.turns = num(p.turns) + 1;
      p.finds = 0;
      p.foundBy = null;
      p.foundAt = 0;
    }
    st.hint = null;
    st.nextHint = 0;
  },

  enter(g, phase, now) {
    if (phase === 'play') {
      const s = g.st.settings.hintSeconds;
      g.st.nextHint = s > 0 ? now + s * 1000 : 0;
    }
  },

  phaseMs(g, phase) {
    return phase === 'hide' ? g.sec('hideSeconds') : g.sec('seekSeconds');
  },

  tick(g, now) {
    const st = g.st;
    if (st.phase !== 'play') return;
    if (st.nextHint && now >= st.nextHint) {
      const spots = [];
      for (const id of hiders(g)) {
        const p = g.pos(id);
        if (p) spots.push({ x: r2(p.x), z: r2(p.z) });
      }
      st.hint = { at: now, spots };
      st.nextHint = now + g.sec('hintSeconds');
      g.bump();
      if (spots.length) g.fx({ type: 'hint', spots, sfx: 'sparkle' });
    }
    checkAllFound(g, now);
  },

  claim(g, from, c, now) {
    const st = g.st;
    if (c.type !== 'found' || st.phase !== 'play') return false;
    const me = g.P(from);
    if (me.role !== 'seeker' && me.role !== 'found') return false;
    const target = cleanId(c.target);
    const t = target ? g.P(target) : null;
    if (!t || target === from || t.role !== 'hider') return false;
    const a = g.pos(from);
    const b = g.pos(target);
    if (!a || !b || dist(a, b) > FIND_R + LAG) return false;
    t.role = 'found';
    t.foundBy = from;
    t.foundAt = now;
    me.finds = num(me.finds) + 1;
    st.scores[from] = num(st.scores[from]) + 1;
    g.fx({ type: 'found', ids: [from, target], x: r2(b.x), z: r2(b.z), sfx: 'found', burst: true, hype: 'found' });
    checkAllFound(g, now);
    return true;
  },

  timeUp(g) {
    const left = hiders(g);
    if (left.length) return { winner: 'hiders', ids: left };
    return { winner: 'seekers', ids: g.st.order.filter((id) => g.P(id).role === 'seeker') };
  },

  award(g, res) {
    if (res.winner !== 'hiders') return;
    for (const id of res.ids) g.st.scores[id] = num(g.st.scores[id]) + 2;
  },

  awards(g) {
    const P = (id) => g.P(id);
    return [
      { id: 'eagle', score: (id) => (P(id).role === 'hider' ? 0 : num(P(id).finds)) },
      { id: 'sneaky', many: true, score: (id) => (P(id).role === 'hider' ? 1 : 0) },
      { id: 'helper', score: (id) => (P(id).role === 'found' ? num(P(id).finds) : 0) },
      { id: 'almost', score: (id) => (P(id).role === 'found' ? num(P(id).foundAt) : 0) }, // found last
    ];
  },

  reset(g) {
    for (const id of g.st.order) {
      const p = g.P(id);
      p.role = 'hider';
      p.finds = 0;
      p.foundBy = null;
      p.foundAt = 0;
    }
    g.st.hint = null;
    g.st.nextHint = 0;
  },

  spawn(g, id) {
    const A = g.arena;
    const p = g.P(id);
    const f = A.start.facing;
    if (p.role === 'seeker') {
      const seekers = g.st.order.filter((x) => g.P(x).role === 'seeker');
      const k = seekers.indexOf(id);
      const off = seekers.length > 1 ? (k === 0 ? -0.8 : 0.8) : 0;
      const q = clampArea(A.area, A.start.x + Math.cos(f) * off, A.start.z - Math.sin(f) * off, 0.3);
      return { x: q.x, z: q.z, facing: f };
    }
    // everybody else in a loose ring around the seeker, facing out, ready to run
    const others = g.st.order.filter((x) => g.P(x).role !== 'seeker');
    const k = Math.max(0, others.indexOf(id));
    const ang = f + Math.PI + ((k + 0.5) / Math.max(1, others.length)) * Math.PI * 2;
    const rad = 2.6 + (k % 2) * 0.9;
    const q = clampArea(A.area, A.start.x + Math.sin(ang) * rad, A.start.z + Math.cos(ang) * rad, 0.5);
    return { x: q.x, z: q.z, facing: Math.atan2(q.x - A.start.x, q.z - A.start.z) };
  },

  confine(g, id, x, z) {
    return clampArea(g.arena.area, x, z, 0.3);
  },

  bot(g, id, pos, dt, m) {
    const st = g.st;
    const p = g.P(id);
    if (st.phase !== 'hide' && st.phase !== 'play') return null;
    if (p.role === 'hider') return hiderBot(g, id, pos, dt, m);
    if (st.phase === 'hide') return { anim: p.role === 'seeker' ? 'seek' : null };
    return seekerBot(g, id, pos, dt, m);
  },

  who(g, id, p, w, pos) {
    const st = g.st;
    w.role = p.role;
    if (p.role === 'seeker') {
      w.color = PALETTE.gold;
      w.glow = true;
      if (st.phase === 'hide') {
        w.canMove = false;
        w.anim = 'seek';
      }
    } else if (p.role === 'found') {
      w.color = PALETTE.mint;
      w.glow = st.phase === 'play';
      if (st.phase === 'hide') w.canMove = false; // only happens to someone who joined mid-round
    } else if ((st.phase === 'hide' || st.phase === 'play') && pos) {
      const s = spotAt(g.arena, pos);
      if (s) {
        w.pose = 'hide';
        w.hidden = true;
      }
    }
  },

  ui(g, me, now, u) {
    const st = g.st;
    const p = me ? g.P(me) : null;
    const left = hiders(g).length;
    // a hider tucked into a hide spot hears so (where I stand: the HUD's own view of me)
    const myPos = p && p.role === 'hider' && (st.phase === 'hide' || st.phase === 'play') ? g.pos(me) : null;
    const tucked = !!(myPos && spotAt(g.arena, myPos));
    if (p && st.phase !== 'lobby') {
      if (p.role === 'seeker') u.roleBadge = { text: 'Seeker', color: PALETTE.gold, icon: 'eyes' };
      else if (p.role === 'found') u.roleBadge = { text: 'Seeker team', color: PALETTE.mint, icon: 'sparkle' };
      else u.roleBadge = { text: tucked ? 'Hidden!' : 'Hider', color: PALETTE.lilac, icon: 'leaf' };
    }
    const since = now - st.phaseStarted;
    if (st.phase === 'countdown') {
      u.line = p && p.role === 'seeker' ? "You're the seeker! Get ready to count." : 'Get ready to hide!';
    } else if (st.phase === 'hide') {
      if (p && p.role === 'seeker') {
        u.line = 'Eyes closed! Counting... no peeking!';
        u.blind = true;
        u.big = { text: String(u.timer ?? ''), sub: 'No peeking!' };
      } else {
        u.line = tucked ? "Great spot! You're hidden. Stay still and shh..." : 'Hide! Tuck into a hedge, tent or barrel before the count ends.';
        if (since < 1500) u.big = { text: 'Hide!', sub: 'Quick, find a sneaky spot!' };
      }
    } else if (st.phase === 'play') {
      const hintIn = st.nextHint ? Math.max(0, Math.ceil((st.nextHint - now) / 1000)) : null;
      const hint = hintIn !== null ? ` Sparkles in ${fmtClock(hintIn)}.` : '';
      if (!p || p.role !== 'hider') u.line = `Find the hiders! ${left} still hiding.${hint}`;
      else if (tucked) u.line = `Shh! You're hidden. ${left} still hiding.${hint}`;
      else u.line = `Find a hiding spot, quick! ${left} still hiding.${hint}`;
      if (since < 1500) u.big = { text: 'Ready or not!', sub: 'Here we come!' };
      if (p && p.role === 'found' && p.foundAt && now - p.foundAt < 2500) u.big = { text: 'Found you!', sub: 'Now help seek!' };
    } else if (st.phase === 'results') {
      const r = st.result || { winner: 'none', ids: [] };
      const mine = me && r.ids.includes(me);
      if (r.winner === 'hiders') {
        const names = r.ids.map((id) => g.name(id));
        u.big = { text: 'Hiders win!', sub: mine ? 'You stayed hidden. Super sneaky!' : `Still hidden: ${listNames(names.slice(0, 3))}` };
      } else if (r.winner === 'seekers') {
        u.big = { text: 'Everyone found!', sub: mine ? 'Amazing seeking!' : 'Great hiding, everybody!' };
      } else u.big = { text: 'Round over', sub: 'Not enough players this time' };
      u.line = 'Great game, everybody!';
    }
    const rows = st.order.map((id) => ({ id, label: g.name(id), value: num(st.scores[id]), me: id === me, color: null }));
    rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    u.scoreboard = { title: 'Points', rows };
  },

  auto(g, me, now) {
    const st = g.st;
    const p = g.P(me);
    if (st.phase !== 'play' || p.role === 'hider') return null;
    const a = g.pos(me);
    if (!a) return null;
    let best = null;
    let bestD = FIND_R;
    for (const id of hiders(g)) {
      const b = g.pos(id);
      if (!b) continue;
      const d = dist(a, b);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best ? { type: 'found', target: best } : null;
  },

  text(g, fx, me) {
    switch (fx.type) {
      case 'found': {
        const [a, b] = Array.isArray(fx.ids) ? fx.ids : [];
        if (b === me) return `${nm(g, a, me, true)} found you! Now you're seeking too.`;
        return `${nm(g, a, me, true)} found ${nm(g, b, me)}!`;
      }
      case 'hint':
        return 'Sparkle hint! Look for the sparkles!';
      case 'newSeeker':
        return fx.id === me ? "You're the new seeker!" : `${g.name(fx.id)} is the new seeker!`;
      case 'phase':
        if (fx.phase === 'hide') return 'Hide!';
        if (fx.phase === 'play') return 'Ready or not, here we come!';
        return '';
      case 'join':
        return fx.id === me ? '' : `${g.name(fx.id)} joined the game!`;
      default:
        return '';
    }
  },

  cleanPlayer(rp) {
    return {
      role: ROLES.includes(rp.role) ? rp.role : 'hider',
      turns: clamp(Math.trunc(num(rp.turns)), 0, 1e6),
      finds: clamp(Math.trunc(num(rp.finds)), 0, 100),
      foundBy: cleanId(rp.foundBy),
      foundAt: Math.max(0, num(rp.foundAt)),
    };
  },

  clean(raw, st) {
    st.scores = {};
    for (const id of st.order) st.scores[id] = clamp(Math.trunc(num(isObj(raw.scores) && own(raw.scores, id) ? raw.scores[id] : 0)), 0, 1e6);
    st.nextHint = Math.max(0, num(raw.nextHint));
    st.hint = null;
    if (isObj(raw.hint) && isNum(raw.hint.at) && Array.isArray(raw.hint.spots)) {
      const spots = raw.hint.spots.map(cleanPoint).filter(Boolean).slice(0, 10).map((q) => ({ x: r2(q.x), z: r2(q.z) }));
      st.hint = { at: raw.hint.at, spots };
    }
  },

  cleanWinner(v) {
    return v === 'hiders' || v === 'seekers' ? v : 'none';
  },
};

// ---------- bots ----------

function chooseSpot(g, id, pos, threat) {
  const A = g.arena;
  const L = g.level();
  const hs = shared(g);
  const st = g.st;
  const m = g.memFor(id);
  if (!m.fav) m.fav = KINDS[Math.floor(g.rng() * KINDS.length)];
  const left = st.phase === 'hide' ? Math.max(4, (st.phaseEnds - g.now) / 1000) : 6;
  const reach = L.speed * left * 0.85;
  const span = Math.max(8, Math.hypot(A.area.hw, A.area.hd) * 2);
  let best = null;
  let bestScore = -Infinity;
  const others = [];
  for (const [i, who] of hs.taken) if (who !== id && A.spots[i]) others.push(A.spots[i]);
  for (const s of A.spots) {
    const owner = hs.taken.get(s.i);
    let score = (2.2 * dist(s, A.start)) / span + g.rng() * 2.6;
    if (owner && owner !== id) score -= 6;
    for (const o of others) if (o !== s && dist(o, s) < 7) score -= 1.2; // spread out: one find shouldn't give away two
    if (s.kind === m.fav) score += 0.7;
    score += (1 - SHOWS[s.kind]) * 4 * (L.see - 0.5); // clever hiders pick the sneaky spots
    if (dist(s, A.start) < 5) score -= st.settings.botLevel === 'easy' ? 1 : 3; // too obvious
    const d = dist(s, pos);
    if (d > reach) score -= 4;
    score -= d / Math.max(10, reach);
    if (threat && dist(s, threat) < 8) score -= 5;
    if (threat && d < 3) score -= 3; // somewhere else, not right here
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  for (const [k, v] of hs.taken) if (v === id) hs.taken.delete(k);
  if (best) hs.taken.set(best.i, id);
  return best ? best.i : 0;
}

function nearestOf(g, pos, ids) {
  let best = null;
  let bestD = Infinity;
  for (const id of ids) {
    const p = g.pos(id);
    if (!p) continue;
    const d = dist(pos, p);
    if (d < bestD) {
      bestD = d;
      best = { id, p, d };
    }
  }
  return best;
}

function hiderBot(g, id, pos, dt, m) {
  const A = g.arena;
  const L = g.level();
  const st = g.st;
  const hs = shared(g);
  // the spot is remembered across the hide and play phases
  const keep = hs.mine || (hs.mine = new Map());
  if (m.spot == null) m.spot = keep.has(id) ? keep.get(id) : chooseSpot(g, id, pos, null);
  keep.set(id, m.spot);
  if (st.phase === 'play') {
    m.think -= dt;
    if (m.think <= 0) {
      m.think = L.react + g.rng() * 0.4;
      const moves = num(hs.moves && hs.moves.get(id));
      const t = nearestOf(g, pos, seekingTeam(g));
      let go = false;
      // a sparkle just gave me away: sneak somewhere new, but only while nobody is close
      if (st.hint && m.hintSeen !== st.hint.at) {
        m.hintSeen = st.hint.at;
        if (moves < L.moves && (!t || t.d > 12) && g.rng() < L.nerve) go = true;
      }
      if (go) {
        m.spot = chooseSpot(g, id, pos, t ? t.p : null);
        keep.set(id, m.spot);
        if (!hs.moves) hs.moves = new Map();
        hs.moves.set(id, moves + 1);
      }
    }
  }
  const s = A.spots[m.spot] || A.spots[0];
  const d = dist(pos, s);
  if (d < Math.max(0.35, s.r * 0.45)) return { move: { x: 0, z: 0 }, anim: 'hide' };
  return { move: navigate(m, pos, s, L.speed * (st.phase === 'play' ? 1.05 : 1), dt, g.rng, 0.8) };
}

function nextSpot(g, id, pos, now) {
  const A = g.arena;
  const hs = shared(g);
  const taken = new Set();
  for (const [other, i] of hs.target) if (other !== id) taken.add(i);
  let best = null;
  let bestScore = Infinity;
  for (const s of A.spots) {
    const checked = hs.checked.get(s.i);
    let score = dist(pos, s) + g.rng() * 12;
    if (isNum(checked) && now - checked < 40000) score += 40;
    if (taken.has(s.i)) score += 18;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (best) hs.target.set(id, best.i);
  return best;
}

function seekerBot(g, id, pos, dt, m) {
  const A = g.arena;
  const L = g.level();
  const st = g.st;
  const hs = shared(g);
  const now = g.now;
  const me = g.P(id);
  if (me.role === 'found' && now - me.foundAt < 1500) return { move: { x: 0, z: 0 }, anim: 'aww' }; // a sweet shrug
  if (!m.looked) m.looked = new Map();

  // Who can I see? Someone out in the open, easily. Someone tucked into a hide spot only when
  // I look right there, and not always (a hint makes it much likelier). Bots only find people
  // they have noticed, like real seekers.
  let chase = null;
  let chaseD = Infinity;
  for (const h of hiders(g)) {
    const hp = g.pos(h);
    if (!hp) continue;
    const d = dist(pos, hp);
    let seen = false;
    const tucked = spotAt(A, hp);
    if (!tucked) seen = d < 10 * L.see;
    else if (d < 2.8) {
      let look = m.looked.get(h);
      if (!look || now - look.at > 6000) {
        const hinted = !!(m.goal && m.goal.hint && dist(m.goal, hp) < 4);
        const helper = me.role === 'found' ? 0.7 : 1; // found helpers look less carefully
        const chance = (hinted ? 0.6 + 0.2 * L.see : (0.25 + 0.25 * L.see) * helper) * SHOWS[tucked.kind];
        look = { at: now, seen: g.rng() < chance };
        m.looked.set(h, look);
      }
      seen = look.seen;
    }
    if (m.chase === h && d < 7) seen = true;
    if (seen && d < chaseD) {
      chase = h;
      chaseD = d;
    }
  }
  m.chase = chase;
  const action = chase && chaseD <= FIND_R * 0.85 ? { type: 'found', target: chase } : null;
  if (m.pause > 0 && !chase) {
    m.pause -= dt; // a good look behind the bush
    return { move: { x: 0, z: 0 }, action };
  }
  if (!chase) {
    m.think -= dt;
    if (m.think <= 0) {
      m.think = L.react + g.rng() * 0.25;
      if (st.hint && m.hintAt !== st.hint.at && now - st.hint.at < 15000 && st.hint.spots.length) {
        m.hintAt = st.hint.at;
        let pick = null;
        let pickD = 20; // sparkles too far away go unnoticed
        for (const q of st.hint.spots) {
          const d = dist(pos, q) + g.rng() * 6;
          if (d < pickD) {
            pickD = d;
            pick = q;
          }
        }
        if (pick && g.rng() < 0.4 + 0.4 * L.see) {
          const err = 1 + (1 - L.see * 0.6) * 3; // the sparkle is only roughly remembered
          const q = clampArea(A.area, pick.x + (g.rng() * 2 - 1) * err, pick.z + (g.rng() * 2 - 1) * err, 0.5);
          m.goal = { x: q.x, z: q.z, i: -1, hint: true };
        }
      }
      if (!m.goal) {
        const s = nextSpot(g, id, pos, now);
        if (s) {
          // look from just outside the spot, on our side of it
          const d = dist(pos, s) || 1;
          const q = clampArea(A.area, s.x + ((pos.x - s.x) / d) * 2.2, s.z + ((pos.z - s.z) / d) * 2.2, 0.3);
          m.goal = { x: q.x, z: q.z, i: s.i, hint: false };
        }
      }
    }
  }
  const target = chase ? g.pos(chase) : m.goal;
  if (!target) return { move: { x: 0, z: 0 }, action };
  if (!chase && m.goal && m.goal !== m.goalFor) {
    // a fair time to get there; a spot round a corner that takes longer counts as looked at
    m.goalFor = m.goal;
    m.goalBy = now + (dist(pos, m.goal) / Math.max(1, L.speed * 0.5)) * 1000 * 1.6 + 2500;
  }
  if (!chase && (dist(pos, target) < 0.9 || now > num(m.goalBy))) {
    if (m.goal.i >= 0) hs.checked.set(m.goal.i, now);
    m.goal = null;
    m.pause = 0.6 + g.rng() * 0.9;
    m.think = 0;
    return { move: { x: 0, z: 0 }, action };
  }
  // searching is a careful walk (found helpers are a bit slower); spotting someone is a sprint
  const pace = chase ? 1 : me.role === 'found' ? 0.5 : 0.6;
  return { move: navigate(m, pos, target, L.speed * pace, dt, g.rng, 0.4), action };
}
