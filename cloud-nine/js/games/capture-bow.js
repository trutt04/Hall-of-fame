// Capture the Bow on the bow field (places.bowField): Team Pink vs Team Purple.
//
// A giant bow sits at each base. Walk up to the other team's bow to grab it ({ type: 'grab',
// team }) and carry it back to your own base to score ({ type: 'score' }; the host also scores
// it by itself the moment a carrier steps into their base). Each team's half is the side of the
// field nearer its base. Tagged in the other team's half ({ type: 'tag', target }) = sent back to
// your own base, no jail, with a 3 s sparkle shield. A tagged carrier drops the bow where they
// were tagged; it floats home after `returnSeconds`, or straight away if its own team touches it
// (grab your own dropped bow). Grabbing the bow gives a 2 s sparkle shield (grab and go!).
// First to `toWin` (3) captures, or most after 3 minutes.

import { PALETTE, TEAMS } from '../config.js';
import {
  BOT_SETTING, LAG, balanceTeams, clamp, clampArea, cleanId, cleanPoint, dist, escapeDir, inArea, isNum, isObj,
  navigate, num, r2, rectArea, setLen, toWorld,
} from './common.js';

export const GRAB_R = 2; // meters: reach to grab a bow
export const TAG_R = 1.5; // meters: a tag
const SAFE_MS = 3000;
const GRAB_SHIELD_MS = 2000;
const CARRY_SPEED = 1; // carrying a giant bow doesn't slow you down
const BOW_STATES = ['home', 'carried', 'dropped'];

function teamIds(g, t) {
  return g.st.order.filter((id) => g.P(id).team === t);
}

function nm(g, id, me, cap) {
  if (me && id === me) return cap ? 'You' : 'you';
  return g.name(id);
}

/** Signed distance along the base-to-base axis: < 0 is team 0's half, > 0 is team 1's. */
function axisPos(g, p) {
  const [b0, b1] = g.arena.bases;
  const ux = b1.x - b0.x;
  const uz = b1.z - b0.z;
  const L = Math.hypot(ux, uz) || 1;
  return ((p.x - (b0.x + b1.x) / 2) * ux + (p.z - (b0.z + b1.z) / 2) * uz) / L;
}

export function sideOf(g, p) {
  return axisPos(g, p) < 0 ? 0 : 1;
}

/** How far into team t's half a point is (negative: on the other side). */
function depthIn(g, t, p) {
  const s = axisPos(g, p);
  return t === 0 ? -s : s;
}

function carrying(g, id) {
  return g.st.bows.find((b) => b.s === 'carried' && b.by === id) || null;
}

function bowSpot(g, bow) {
  if (bow.s === 'carried') return g.pos(bow.by);
  if (bow.s === 'dropped') return { x: bow.x, z: bow.z };
  const b = g.arena.bases[bow.team];
  return { x: b.x, z: b.z };
}

function sendBowHome(g, bow) {
  const b = g.arena.bases[bow.team];
  bow.s = 'home';
  bow.x = r2(b.x);
  bow.z = r2(b.z);
  bow.by = null;
  bow.at = 0;
}

function score(g, id, now) {
  const st = g.st;
  const p = g.P(id);
  const bow = carrying(g, id);
  if (!p || !bow) return false;
  st.scores[p.team] += 1;
  p.caps = num(p.caps) + 1;
  sendBowHome(g, bow);
  st.lastScore = { team: p.team, by: id, at: now };
  const base = g.arena.bases[p.team];
  g.fx({ type: 'score', ids: [id], team: p.team, x: r2(base.x), z: r2(base.z), sfx: 'score', burst: true, hype: 'score' });
  if (st.scores[p.team] >= st.settings.toWin) g.finish({ winner: p.team, ids: teamIds(g, p.team) }, now);
  return true;
}

function fillEmptyTeam(g) {
  for (const t of [0, 1]) {
    if (teamIds(g, t).length > 0) continue;
    const other = teamIds(g, 1 - t);
    if (other.length < 2) return;
    const bots = other.filter((id) => g.P(id).bot);
    const mover = bots.length ? bots[bots.length - 1] : other[other.length - 1];
    const bow = carrying(g, mover);
    if (bow) sendBowHome(g, bow);
    g.P(mover).team = t;
    if (g.st.phase !== 'lobby' && g.st.phase !== 'results') g.teleport(mover);
    g.fx({ type: 'switch', id: mover, team: t, sfx: 'chime' });
  }
}

export const captureBow = {
  kind: 'captureBow',
  title: 'Capture the Bow',
  place: 'bowField',
  minPlayers: 2,
  hasHide: false,
  teams: true,
  settings: [
    { id: 'playSeconds', label: 'Round time', options: [120, 180, 240], default: 180 },
    { id: 'toWin', label: 'Bows to win', options: [1, 2, 3, 5], default: 3 },
    { id: 'returnSeconds', label: 'Bow floats home', options: [3, 5, 8], default: 5 },
    BOT_SETTING,
  ],

  arena(raw) {
    const f = isObj(raw) && isObj(raw.bowField) ? raw.bowField : isObj(raw) ? raw : {};
    const c = cleanPoint(f) || { x: 0, z: 0 };
    const area = rectArea(c.x, c.z, num(f.w, 26), num(f.d, 44), num(f.facing));
    const list = Array.isArray(f.bases) ? f.bases : [];
    const bases = [0, 1].map((t) => {
      const raw0 = list.find((b) => isObj(b) && b.team === t);
      const p = cleanPoint(raw0);
      const r = clamp(num(raw0 && raw0.r, 3), 1.5, 6);
      if (p && inArea(area, p.x, p.z, -1)) {
        const q = clampArea(area, p.x, p.z, 0.5);
        return { team: t, x: q.x, z: q.z, r };
      }
      const w = toWorld(area.f, 0, (t === 0 ? -1 : 1) * Math.max(1, area.hd - 4));
      return { team: t, x: w.x, z: w.z, r };
    });
    if (dist(bases[0], bases[1]) < 8) {
      for (const t of [0, 1]) {
        const w = toWorld(area.f, 0, (t === 0 ? -1 : 1) * Math.max(1, area.hd - 4));
        bases[t].x = w.x;
        bases[t].z = w.z;
      }
    }
    return { area, bases };
  },

  init(g) {
    g.st.scores = [0, 0];
    g.st.wins = [0, 0];
    g.st.lastScore = null;
    g.st.bows = [0, 1].map((t) => {
      const b = g.arena.bases[t];
      return { team: t, s: 'home', x: r2(b.x), z: r2(b.z), by: null, at: 0 };
    });
  },

  newPlayer(g) {
    const size = [0, 1].map((t) => teamIds(g, t).length);
    const team = size[0] === size[1] ? (g.rng() < 0.5 ? 0 : 1) : size[0] < size[1] ? 0 : 1;
    return { team, safeUntil: 0, taggedAt: 0, grabs: 0, caps: 0, tags: 0, saves: 0 };
  },

  leaving(g, id) {
    const bow = carrying(g, id);
    if (bow) {
      sendBowHome(g, bow);
      g.fx({ type: 'bowHome', team: bow.team, sfx: 'chime' });
    }
  },

  left(g) {
    fillEmptyTeam(g);
  },

  setup(g) {
    const st = g.st;
    const teams = balanceTeams(st.order, st.players, g.rng);
    for (const id of st.order) {
      const p = g.P(id);
      p.team = teams[id];
      p.safeUntil = 0;
      p.taggedAt = 0;
      p.grabs = 0;
      p.caps = 0;
      p.tags = 0;
      p.saves = 0;
    }
    st.scores = [0, 0];
    st.lastScore = null;
    for (const bow of st.bows) sendBowHome(g, bow);
  },

  phaseMs(g) {
    return g.sec('playSeconds');
  },

  tick(g, now) {
    const st = g.st;
    if (st.phase !== 'play') return;
    for (const bow of st.bows) {
      if (bow.s === 'carried') {
        const p = g.P(bow.by);
        if (!p) {
          sendBowHome(g, bow);
          g.bump();
          continue;
        }
        const q = g.pos(bow.by);
        const base = g.arena.bases[p.team];
        if (q && dist(q, base) <= base.r && score(g, bow.by, now)) {
          g.bump();
          if (st.phase !== 'play') return;
        }
      } else if (bow.s === 'dropped' && now >= bow.at) {
        sendBowHome(g, bow);
        g.fx({ type: 'bowHome', team: bow.team, sfx: 'chime' });
        g.bump();
      }
    }
  },

  claim(g, from, c, now) {
    const st = g.st;
    if (st.phase !== 'play') return false;
    const me = g.P(from);
    const at = g.pos(from);
    if (!at) return false;
    switch (c.type) {
      case 'grab': {
        if (c.team !== 0 && c.team !== 1) return false;
        const bow = st.bows[c.team];
        if (bow.team === me.team) {
          if (bow.s !== 'dropped' || dist(at, bow) > GRAB_R + LAG) return false;
          sendBowHome(g, bow);
          me.saves = num(me.saves) + 1;
          g.fx({ type: 'save', ids: [from], team: bow.team, x: r2(at.x), z: r2(at.z), sfx: 'chime', burst: true });
          return true;
        }
        if (bow.s === 'carried' || carrying(g, from)) return false;
        if (dist(at, bowSpot(g, bow)) > GRAB_R + LAG) return false;
        bow.s = 'carried';
        bow.by = from;
        bow.at = 0;
        me.grabs = num(me.grabs) + 1;
        me.safeUntil = Math.max(num(me.safeUntil), now + GRAB_SHIELD_MS); // grab and go!
        g.fx({ type: 'bowGrab', ids: [from], team: bow.team, x: r2(at.x), z: r2(at.z), sfx: 'bowGrab', burst: true, hype: 'grab' });
        return true;
      }
      case 'tag': {
        const target = cleanId(c.target);
        const t = target ? g.P(target) : null;
        if (!t || target === from || t.team === me.team || now < t.safeUntil) return false;
        const q = g.pos(target);
        if (!q || dist(at, q) > TAG_R + LAG) return false;
        if (depthIn(g, me.team, q) < -1) return false; // only in your own half
        const bow = carrying(g, target);
        if (bow) {
          const spot = clampArea(g.arena.area, q.x, q.z, 1);
          bow.s = 'dropped';
          bow.by = null;
          bow.x = r2(spot.x);
          bow.z = r2(spot.z);
          bow.at = now + st.settings.returnSeconds * 1000;
          g.fx({ type: 'bowDrop', team: bow.team, x: bow.x, z: bow.z, sfx: 'pop' });
        }
        t.safeUntil = now + SAFE_MS;
        t.taggedAt = now;
        me.tags = num(me.tags) + 1;
        g.fx({ type: 'tagged', ids: [from, target], x: r2(q.x), z: r2(q.z), sfx: 'pop', burst: true });
        g.teleport(target);
        return true;
      }
      case 'score': {
        const bow = carrying(g, from);
        const base = g.arena.bases[me.team];
        if (!bow || dist(at, base) > base.r + LAG) return false;
        return score(g, from, now);
      }
      default:
        return false;
    }
  },

  timeUp(g) {
    const [a, b] = g.st.scores;
    if (a === b) return { winner: 'tie', ids: g.st.order.slice() };
    const w = a > b ? 0 : 1;
    return { winner: w, ids: teamIds(g, w) };
  },

  award(g, res) {
    if (res.winner === 0 || res.winner === 1) g.st.wins[res.winner] += 1;
  },

  awards(g) {
    const P = (id) => g.P(id);
    return [
      { id: 'bowBoss', score: (id) => num(P(id).caps) },
      { id: 'guard', score: (id) => num(P(id).tags) },
      { id: 'bowSaver', score: (id) => num(P(id).saves) },
      { id: 'grabber', score: (id) => num(P(id).grabs) },
    ];
  },

  reset(g) {
    for (const bow of g.st.bows) sendBowHome(g, bow);
    g.st.lastScore = null;
    for (const id of g.st.order) g.P(id).safeUntil = 0;
  },

  spawn(g, id) {
    const p = g.P(id);
    const base = g.arena.bases[p.team];
    const mates = teamIds(g, p.team);
    const k = Math.max(0, mates.indexOf(id));
    const toMid = Math.atan2(g.arena.area.f.x - base.x, g.arena.area.f.z - base.z);
    const ang = toMid + (k - (mates.length - 1) / 2) * 0.6;
    const rad = base.r + 1.5;
    const q = clampArea(g.arena.area, base.x + Math.sin(ang) * rad, base.z + Math.cos(ang) * rad, 0.6);
    return { x: q.x, z: q.z, facing: toMid };
  },

  confine(g, id, x, z) {
    return clampArea(g.arena.area, x, z, 0.4);
  },

  bot(g, id, pos, dt, m) {
    if (g.st.phase !== 'play') return null;
    return bowBot(g, id, pos, dt, m);
  },

  who(g, id, p, w) {
    const now = g.clock();
    w.team = p.team;
    w.color = TEAMS[p.team].color;
    w.role = 'player';
    const bow = carrying(g, id);
    if (bow) {
      w.role = 'carrier';
      w.carrying = `bow${bow.team}`;
      w.glow = true;
      w.speed = CARRY_SPEED;
    } else if (now < p.safeUntil) {
      w.glow = true;
      w.color = PALETTE.mint;
    }
  },

  ui(g, me, now, u) {
    const st = g.st;
    const p = me ? g.P(me) : null;
    if (p && st.phase !== 'lobby') u.roleBadge = { text: TEAMS[p.team].name, color: TEAMS[p.team].color, icon: 'bow' };
    const since = now - st.phaseStarted;
    if (st.phase === 'countdown') u.line = `You're on ${p ? TEAMS[p.team].name : 'a team'}! Grab their bow and bring it home!`;
    else if (st.phase === 'play') {
      const mineBow = p ? st.bows[p.team] : null;
      const theirs = p ? st.bows[1 - p.team] : null;
      if (!p) u.line = 'Grab the other bow and bring it home!';
      else if (carrying(g, me)) u.line = 'You have their bow! Run it home to your base!';
      else if (mineBow.s === 'carried') u.line = 'They have your bow! Tag the carrier in your half!';
      else if (mineBow.s === 'dropped') u.line = 'Your bow fell! Touch it to send it home!';
      else if (theirs.s === 'carried') u.line = 'A teammate has their bow! Help them get home!';
      else u.line = 'Sneak into their half, grab their bow and bring it home! Tag in your own half.';
      const ls = st.lastScore;
      if (ls && now - ls.at < 2500) u.big = { text: 'Bow captured!', sub: ls.by === me ? 'You scored!' : `${TEAMS[ls.team].name} scores!` };
      else if (p && p.taggedAt && now - p.taggedAt < 2000) u.big = { text: 'Tagged!', sub: 'Back to base. Go again!' };
      else if (since < 1500) u.big = { text: 'Go!', sub: 'Grab their bow!' };
    } else if (st.phase === 'results') {
      const res = st.result || { winner: 'none', ids: [] };
      const mine = me && res.ids.includes(me);
      if (res.winner === 0 || res.winner === 1) u.big = { text: `${TEAMS[res.winner].name} wins!`, sub: mine ? 'Bow-tiful teamwork!' : 'So close! Great hustle!' };
      else if (res.winner === 'tie') u.big = { text: "It's a tie!", sub: 'Everybody wins!' };
      else u.big = { text: 'Round over', sub: 'Not enough players this time' };
      u.line = 'Great game, everybody!';
    }
    u.scoreboard = {
      title: `First to ${st.settings.toWin}`,
      rows: [0, 1].map((t) => ({ id: `team${t}`, label: TEAMS[t].name, value: st.scores[t], color: TEAMS[t].color, me: !!p && p.team === t, wins: st.wins[t] })),
    };
  },

  auto(g, me, now) {
    const st = g.st;
    const p = g.P(me);
    if (st.phase !== 'play') return null;
    const at = g.pos(me);
    if (!at) return null;
    const mine = carrying(g, me);
    const base = g.arena.bases[p.team];
    if (mine && dist(at, base) <= base.r) return { type: 'score' };
    const own = st.bows[p.team];
    if (own.s === 'dropped' && dist(at, own) <= GRAB_R) return { type: 'grab', team: p.team };
    const theirs = st.bows[1 - p.team];
    if (!mine && theirs.s !== 'carried' && dist(at, bowSpot(g, theirs)) <= GRAB_R) return { type: 'grab', team: 1 - p.team };
    for (const id of teamIds(g, 1 - p.team)) {
      if (now < g.P(id).safeUntil) continue;
      const q = g.pos(id);
      if (q && dist(at, q) <= TAG_R && depthIn(g, p.team, q) >= 0) return { type: 'tag', target: id };
    }
    return null;
  },

  text(g, fx, me) {
    const [a, b] = Array.isArray(fx.ids) ? fx.ids : [];
    const myTeam = me && g.P(me) ? g.P(me).team : null;
    const team = fx.team === 1 ? 1 : 0;
    switch (fx.type) {
      case 'bowGrab':
        if (a === me) return 'You grabbed their bow! Run it home!';
        if (team === myTeam) return `${nm(g, a, me, true)} grabbed your bow! Tag them!`;
        return `${nm(g, a, me, true)} grabbed ${TEAMS[team].name}'s bow!`;
      case 'bowDrop':
        return team === myTeam ? 'Your bow dropped! Touch it to send it home!' : 'The bow dropped! It floats home soon.';
      case 'bowHome':
        return `${TEAMS[team].name}'s bow floated home.`;
      case 'save':
        return a === me ? 'You saved your bow!' : `${nm(g, a, me, true)} saved the bow!`;
      case 'score':
        if (a === me) return 'You captured the bow! Score!';
        return `${nm(g, a, me, true)} captured the bow! ${TEAMS[team].name} scores!`;
      case 'tagged':
        if (b === me) return `${nm(g, a, me, true)} tagged you! Back to base. Go again!`;
        if (a === me) return `You tagged ${nm(g, b, me)}!`;
        return `${nm(g, a, me, true)} tagged ${nm(g, b, me)}!`;
      case 'switch':
        return fx.id === me ? `You switched to ${TEAMS[team].name} to even things out!` : `${g.name(fx.id)} switched teams to even things out!`;
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
      team: rp.team === 1 ? 1 : 0,
      safeUntil: Math.max(0, num(rp.safeUntil)),
      taggedAt: Math.max(0, num(rp.taggedAt)),
      grabs: clamp(Math.trunc(num(rp.grabs)), 0, 1000),
      caps: clamp(Math.trunc(num(rp.caps)), 0, 1000),
      tags: clamp(Math.trunc(num(rp.tags)), 0, 1000),
      saves: clamp(Math.trunc(num(rp.saves)), 0, 1000),
    };
  },

  clean(raw, st, g) {
    const pair = (v, max) => (Array.isArray(v) ? [0, 1].map((k) => clamp(Math.trunc(num(v[k])), 0, max)) : [0, 0]);
    st.scores = pair(raw.scores, 99);
    st.wins = pair(raw.wins, 1e6);
    st.lastScore = null;
    if (isObj(raw.lastScore) && isNum(raw.lastScore.at)) {
      const by = cleanId(raw.lastScore.by);
      st.lastScore = { team: raw.lastScore.team === 1 ? 1 : 0, by: by && st.players[by] ? by : null, at: raw.lastScore.at };
    }
    st.bows = [0, 1].map((t) => {
      const rb = Array.isArray(raw.bows) && isObj(raw.bows[t]) ? raw.bows[t] : {};
      const base = g.arena.bases[t];
      const bow = { team: t, s: 'home', x: r2(base.x), z: r2(base.z), by: null, at: 0 };
      const s = BOW_STATES.includes(rb.s) ? rb.s : 'home';
      const by = cleanId(rb.by);
      if (s === 'carried' && by && st.players[by] && st.players[by].team !== t) {
        bow.s = 'carried';
        bow.by = by;
      } else if (s === 'dropped' && cleanPoint(rb) && isNum(rb.at)) {
        const q = clampArea(g.arena.area, rb.x, rb.z, 0.5);
        bow.s = 'dropped';
        bow.x = r2(q.x);
        bow.z = r2(q.z);
        bow.at = rb.at;
      }
      return bow;
    });
    if (st.bows[0].s === 'carried' && st.bows[0].by === st.bows[1].by) st.bows[1] = { ...st.bows[1], s: 'home', by: null };
  },

  cleanWinner(v) {
    return v === 0 || v === 1 || v === 'tie' ? v : 'none';
  },
};

// ---------- bots ----------

function roleOf(g, id) {
  const p = g.P(id);
  const mates = teamIds(g, p.team);
  const bots = mates.filter((x) => g.P(x).bot);
  const k = bots.indexOf(id);
  const humans = mates.length - bots.length;
  // with friends on the team, bots lean toward guarding (the kids get to do the sneaking)
  return (k + (humans > 0 ? 1 : 0)) % 2 === 0 ? 'attack' : 'defend';
}

function nearestMates(g, team, spot, n) {
  return teamIds(g, team)
    .filter((x) => g.P(x).bot && g.pos(x))
    .sort((a, b) => dist(g.pos(a), spot) - dist(g.pos(b), spot))
    .slice(0, n);
}

function segDist(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const k = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + abx * k), p.z - (a.z + abz * k));
}

/** Run toward `goal`, slipping away from anyone close enough to tag us. */
function evade(g, m, pos, goal, threats, sp, dt, L) {
  const close = threats.filter((e) => dist(pos, e.q) < 4);
  if (!close.length) return navigate(m, pos, goal, sp, dt, g.rng, 0.4);
  m.escT = num(m.escT) - dt;
  if (m.escT <= 0 || !m.esc) {
    const want = setLen({ x: goal.x - pos.x, z: goal.z - pos.z }, 1);
    m.esc = escapeDir(pos, close.map((e) => e.q), g.arena.area, want, g.rng, 2.4 - 2 * L.see);
    m.escT = 0.15 + L.react * 0.5;
  }
  return { x: m.esc.x * sp, z: m.esc.z * sp };
}

function chaseMove(g, m, pos, targetId, sp, dt, L, k = 1) {
  const q = g.pos(targetId);
  if (!q) return null;
  const tr = g.track.get(targetId);
  const lead = (dist(pos, q) / sp) * L.lead * k;
  const aim = clampArea(g.arena.area, q.x + (tr ? tr.vx * lead : 0), q.z + (tr ? tr.vz * lead : 0), 0.4);
  return navigate(m, pos, aim, sp, dt, g.rng, 0.2);
}

function attack(g, id, pos, dt, m, threats, sp, L) {
  const A = g.arena;
  const t = g.P(id).team;
  const goal = bowSpot(g, g.st.bows[1 - t]);
  if (!goal) return { x: 0, z: 0 };
  if (m.bail > 0) {
    m.bail -= dt; // too busy in there: back to our half, then try again
    return evade(g, m, pos, A.bases[t], threats, sp, dt, L);
  }
  if (depthIn(g, 1 - t, pos) > -0.5) return evade(g, m, pos, goal, threats, sp, dt, L);
  // in our own half: wait near the middle for a gap, then dash
  const [b0, b1] = A.bases;
  if (!m.stage || m.stageLeft <= 0) {
    const ul = Math.hypot(b1.x - b0.x, b1.z - b0.z) || 1;
    const ux = (b1.x - b0.x) / ul;
    const uz = (b1.z - b0.z) / ul;
    // wait on the flank with the fewest of them around
    const enemyQ = teamIds(g, 1 - t).map((e) => g.pos(e)).filter(Boolean);
    let bestQ = null;
    let bestScore = -Infinity;
    for (let k = 0; k < 5; k++) {
      const back = (t === 0 ? -1 : 1) * (2 + g.rng() * 2);
      const off = (g.rng() * 2 - 1) * A.area.hw * 0.8;
      const q = clampArea(A.area, (b0.x + b1.x) / 2 + ux * back - uz * off, (b0.z + b1.z) / 2 + uz * back + ux * off, 1);
      let room = 12;
      for (const e of enemyQ) room = Math.min(room, dist(q, e));
      const score = room + g.rng() * 3;
      if (score > bestScore) {
        bestScore = score;
        bestQ = q;
      }
    }
    m.stage = bestQ;
    m.stageLeft = 2.5 + g.rng() * 3;
  }
  m.stageLeft -= dt;
  const clear = 5.5 - 3 * L.nerve;
  const open = threats.every((e) => segDist(e.q, pos, goal) > clear);
  // a teammate is already charging in: go with them ("Go go go!")
  const wave = teamIds(g, t).some((x) => x !== id && g.pos(x) && depthIn(g, 1 - t, g.pos(x)) > 2);
  if (wave) m.wait = num(m.wait) + dt * 2;
  if (open || num(m.wait) > 3 + 4 * (1 - L.nerve)) {
    m.wait = 0;
    return navigate(m, pos, goal, sp, dt, g.rng, 0.4);
  }
  if (dist(pos, m.stage) < 1) {
    m.wait = num(m.wait) + dt;
    return { x: 0, z: 0 };
  }
  return navigate(m, pos, m.stage, sp * 0.75, dt, g.rng, 0.6);
}

function bowBot(g, id, pos, dt, m) {
  const st = g.st;
  const L = g.level();
  const A = g.arena;
  const now = g.now;
  const p = g.P(id);
  const t = p.team;
  const ownBase = A.bases[t];
  const ownBow = st.bows[t];
  const theirBow = st.bows[1 - t];
  const mine = carrying(g, id);
  const enemies = teamIds(g, 1 - t).map((e) => ({ id: e, q: g.pos(e) })).filter((e) => e.q);
  // people who could tag me where they stand: in their own half and not shielded
  const threats = enemies.filter((e) => now >= g.P(e.id).safeUntil && depthIn(g, 1 - t, e.q) > -1);
  let action = null;

  // things a bot always does when it can (bots reach a little less far than people do)
  if (mine && dist(pos, ownBase) <= ownBase.r - 0.2) action = { type: 'score' };
  if (!action && ownBow.s === 'dropped' && dist(pos, ownBow) <= GRAB_R * 0.85) action = { type: 'grab', team: t };
  if (!action && !mine && theirBow.s !== 'carried' && dist(pos, bowSpot(g, theirBow)) <= GRAB_R * 0.85) action = { type: 'grab', team: 1 - t };
  if (!action) {
    for (const e of enemies) {
      if (now >= g.P(e.id).safeUntil && dist(pos, e.q) <= TAG_R * 0.7 && depthIn(g, t, e.q) >= 0) {
        action = { type: 'tag', target: e.id };
        break;
      }
    }
  }

  m.think -= dt;
  if (m.think <= 0) {
    m.think = L.react + g.rng() * 0.3;
    let job = roleOf(g, id);
    if (ownBow.s === 'carried') {
      const q = g.pos(ownBow.by);
      if (q && nearestMates(g, t, q, 1).includes(id)) job = 'chase';
    } else if (ownBow.s === 'dropped' && nearestMates(g, t, ownBow, 1).includes(id)) job = 'save';
    if (theirBow.s === 'dropped' && nearestMates(g, t, theirBow, 1).includes(id)) job = 'attack';
    if (job !== m.job) m.wait = 0;
    m.job = job;
    const nearest = threats.reduce((best, e) => Math.min(best, dist(pos, e.q)), Infinity);
    const goal = bowSpot(g, theirBow);
    if (job === 'attack' && !mine && goal && depthIn(g, 1 - t, pos) > 0 && nearest < 2.2 && dist(pos, goal) > 5 && g.rng() > L.nerve) {
      m.bail = 1 + g.rng();
    }
  }

  const sp = L.speed * (mine ? CARRY_SPEED : 1);
  if (mine) {
    const move = depthIn(g, 1 - t, pos) > -0.5 ? evade(g, m, pos, ownBase, threats, sp, dt, L) : navigate(m, pos, ownBase, sp, dt, g.rng, 0.4);
    return { move, action };
  }
  if (m.job === 'save') return { move: navigate(m, pos, ownBow, sp, dt, g.rng, 0.3), action };
  if (m.job === 'chase' && ownBow.by && !(m.rest > 0)) {
    // after a moment to notice, and until puffed out
    if (m.chasing !== ownBow.by) {
      m.chasing = ownBow.by;
      m.chaseFrom = now;
      m.carryT = 0;
    }
    if (now - m.chaseFrom >= L.react * 1500) {
      m.carryT = num(m.carryT) + dt;
      if (m.carryT > 4 + 2 * L.see) {
        m.rest = 1.2 + g.rng();
        m.carryT = 0;
      }
      const move = chaseMove(g, m, pos, ownBow.by, sp, dt, L);
      if (move) return { move, action };
    }
  }
  if (m.job === 'attack' && theirBow.s !== 'carried') return { move: attack(g, id, pos, dt, m, threats, sp, L), action };

  // defend: guard between our bow and the middle; chase anyone sneaking into our half, after a
  // moment to notice them, and not forever
  let intruder = null;
  let bestD = 14;
  for (const e of enemies) {
    if (depthIn(g, t, e.q) < 0 || now < g.P(e.id).safeUntil) continue;
    const d = dist(pos, e.q);
    if (d < bestD) {
      bestD = d;
      intruder = e;
    }
  }
  if (m.rest > 0) m.rest -= dt;
  if (intruder && !(m.rest > 0)) {
    if (m.seenId !== intruder.id) {
      m.seenId = intruder.id;
      m.seenAt = now;
      m.chaseT = 0;
    }
    if (now - m.seenAt >= L.react * 1500) {
      m.chaseT = num(m.chaseT) + dt;
      if (m.chaseT > 3 + 3 * L.see) {
        m.rest = 1.5 + g.rng(); // puffed out: back to guarding for a moment
        m.chaseT = 0;
      }
      const move = chaseMove(g, m, pos, intruder.id, sp, dt, L, 0.8);
      if (move) return { move, action };
    }
  } else if (!intruder) m.seenId = null;
  if (!m.guard || m.guardLeft <= 0) {
    const mx = A.area.f.x - ownBase.x;
    const mz = A.area.f.z - ownBase.z;
    const k = 0.25 + g.rng() * 0.25;
    const off = (g.rng() * 2 - 1) * Math.min(6, A.area.hw * 0.6);
    const ml = Math.hypot(mx, mz) || 1;
    const q = clampArea(A.area, ownBase.x + mx * k + (-mz / ml) * off, ownBase.z + mz * k + (mx / ml) * off, 1);
    m.guard = q;
    m.guardLeft = 1.5 + g.rng() * 2.5;
  }
  m.guardLeft -= dt;
  return { move: navigate(m, pos, m.guard, sp * 0.6, dt, g.rng, 0.8), action };
}
