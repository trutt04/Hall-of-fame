// Dodgeball on the court (places.court): Team Pink vs Team Purple.
//
// Teams are balanced automatically and nobody crosses the midline (team 0 holds local z < 0).
// Big soft balls start on the midline. The host simulates every throw from the claim
// { type: 'throw', ballId, from, dir, power }: about 14 m/s with a slight drop, as a ballistic
// path stored in the state (`fl`), so every device can draw it smoothly with ballPos(). A ball
// that hits nobody lands, bounces once and can be picked up ({ type: 'pickup', ballId }) by the
// team on whose side it rests. Being hit sends you to the bench: the target's own device reports
// { type: 'hit', ballId, target } (fair to the one being hit) and the host checks the ball was
// live and passed close, with slack for lag. A catch ({ type: 'catch', ballId }) puts the thrower
// out and brings your earliest-benched teammate back in. Nobody sits out long: after
// `comebackSeconds` on the bench ('auto': 12 s in a small game up to 18 s with ten players, so a
// 3 v 3 isn't over in a flash; can be turned off) your team cheers you back in. A team
// wins when the other is all out at once, or with more players left after `playSeconds`
// (2 minutes); equal is a tie. Benched players cheer their team on (mat talk).

import { PALETTE, TEAMS } from '../config.js';
import {
  BOT_SETTING, LAG, balanceTeams, clamp, cleanId, cleanPoint, dirToWorld, dist, isNum, isObj, navigate,
  num, r2, rectArea, toLocal, toWorld,
} from './common.js';

export const BALL = {
  gravity: 5, // m/s2: big soft balls float a little ("slight drop")
  height: 1.35, // m: released at hand height
  lift: 1.4, // m/s up at release
  radius: 0.3, // m
  hitR: 0.6, // m: a ball this close (sideways) to a body is a hit
  maxY: 2.2, // m: higher than this it sails over heads
  catchR: 1.6, // m: a ball this close can be caught
  pickR: 1.4, // m: walk this close to a resting ball to pick it up
};
const HIT_GRACE_MS = 600; // a hit report may arrive this long after the ball landed (lag)
const CATCH_WINDOW_MS = 550; // the Catch! button counts for this long (forgiving: kids on phones)

// ---------- ball paths (exported for renderers) ----------

export function flightAt(fl, t) {
  const s = Math.max(0, (Math.min(t, fl.landT) - fl.t0) / 1000);
  return {
    x: fl.x0 + fl.vx * s,
    y: Math.max(BALL.radius, fl.y0 + fl.vy * s - 0.5 * BALL.gravity * s * s),
    z: fl.z0 + fl.vz * s,
  };
}

/** Where to draw a ball at time t: { x, y, z } (null while held: draw it in the holder's hand). */
export function ballPos(ball, t) {
  if (!ball) return null;
  if (ball.s === 'air' && ball.fl) return flightAt(ball.fl, t);
  if (ball.s === 'held') return null;
  return { x: ball.x, y: BALL.radius, z: ball.z };
}

function landTime(t0, y0, vy) {
  const G = BALL.gravity;
  const s = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, y0 - BALL.radius))) / G;
  return t0 + Math.round(s * 1000);
}

/** Closest sideways approach of a flight to point p between times tA and tB (ms), heads-height only. */
export function pathMin(fl, tA, tB, p, maxY = BALL.maxY) {
  const a = Math.max(tA, fl.t0);
  const b = Math.min(tB, fl.landT);
  if (b < a) return Infinity;
  const steps = Math.max(1, Math.ceil((b - a) / 20));
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const q = flightAt(fl, a + ((b - a) * i) / steps);
    if (q.y > maxY) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < best) best = d;
  }
  return best;
}

// ---------- helpers ----------

const sign = (team) => (team === 0 ? -1 : 1);

function teamIds(g, t) {
  return g.st.order.filter((id) => g.P(id).team === t);
}

function inIds(g, t) {
  return g.st.order.filter((id) => g.P(id).team === t && !g.P(id).out);
}

function held(g, id) {
  return g.st.balls.find((b) => b.s === 'held' && b.by === id) || null;
}

function ballById(g, v) {
  const id = cleanId(v);
  return id ? g.st.balls.find((b) => b.id === id) || null : null;
}

function nm(g, id, me, cap) {
  if (me && id === me) return cap ? 'You' : 'you';
  return g.name(id);
}

function countLeft(g) {
  g.st.left = [inIds(g, 0).length, inIds(g, 1).length];
}

/** A resting spot inside the court, on the given team's side when `team` is set. */
function restSpot(g, x, z, team) {
  const A = g.arena.area;
  const l = toLocal(A.f, x, z);
  let lx = clamp(l.x, -A.hw + 0.6, A.hw - 0.6);
  let lz = clamp(l.z, -A.hd + 0.6, A.hd - 0.6);
  if (team === 0) lz = Math.min(lz, -0.6);
  if (team === 1) lz = Math.max(lz, 0.6);
  const w = toWorld(A.f, lx, lz);
  return { x: r2(w.x), z: r2(w.z) };
}

function dropBall(g, b, x, z, team) {
  const q = restSpot(g, x, z, team);
  b.s = 'ground';
  b.x = q.x;
  b.z = q.z;
  b.by = null;
}

function sendOut(g, id, now) {
  const p = g.P(id);
  if (!p || p.out) return false;
  const b = held(g, id);
  const at = g.pos(id);
  if (b) dropBall(g, b, at ? at.x : g.arena.area.f.x, at ? at.z : g.arena.area.f.z, p.team);
  p.out = true;
  p.outAt = now;
  countLeft(g);
  g.teleport(id);
  return true;
}

function bringBack(g, team, now, who = null, why = 'catch') {
  const benched = teamIds(g, team).filter((id) => g.P(id).out);
  if (!benched.length) return null;
  benched.sort((a, b) => g.P(a).outAt - g.P(b).outAt);
  const id = who && benched.includes(who) ? who : benched[0];
  const p = g.P(id);
  p.out = false;
  p.backAt = now;
  countLeft(g);
  g.teleport(id);
  g.fx({ type: 'back', id, why, sfx: 'chime', hype: why === 'catch' ? 'catch' : null });
  return id;
}

function checkWin(g, now) {
  if (g.st.phase !== 'play') return;
  countLeft(g);
  const [a, b] = g.st.left;
  if (a > 0 && b > 0) return;
  if (a === 0 && b === 0) g.finish({ winner: 'tie', ids: g.st.order.slice() }, now);
  else g.finish({ winner: a > 0 ? 0 : 1, ids: teamIds(g, a > 0 ? 0 : 1) }, now);
}

function placeBalls(g) {
  const st = g.st;
  const A = g.arena.area;
  const n = st.order.length;
  const count = st.settings.balls === 'auto' ? clamp(Math.ceil(n / 2), 3, 6) : st.settings.balls;
  st.balls = [];
  for (let k = 0; k < count; k++) {
    const lx = -A.hw + ((k + 1) * 2 * A.hw) / (count + 1);
    const w = toWorld(A.f, lx, 0);
    st.balls.push({ id: `b${k}`, s: 'ground', x: r2(w.x), z: r2(w.z), by: null, fl: null });
  }
}

/** How long a benched player waits before the team cheers them back in (0 = only by a catch). */
export function comebackMs(g) {
  const s = g.st.settings.comebackSeconds;
  if (s !== 'auto') return num(s) * 1000;
  const perTeam = Math.ceil(g.st.order.length / 2);
  return clamp(3 * perTeam + 3, 10, 18) * 1000;
}

function fillEmptyTeam(g, now) {
  // somebody left and a team is empty: move the newest bot (or newest player) over, so play goes on
  for (const t of [0, 1]) {
    if (teamIds(g, t).length > 0) continue;
    const other = teamIds(g, 1 - t);
    if (other.length < 2) return;
    const bots = other.filter((id) => g.P(id).bot);
    const mover = bots.length ? bots[bots.length - 1] : other[other.length - 1];
    const p = g.P(mover);
    const b = held(g, mover);
    if (b) dropBall(g, b, g.arena.area.f.x, g.arena.area.f.z, 1 - t);
    p.team = t;
    p.out = false;
    countLeft(g);
    if (g.st.phase !== 'lobby' && g.st.phase !== 'results') g.teleport(mover);
    g.fx({ type: 'switch', id: mover, team: t, sfx: 'chime' });
  }
  if (now) checkWin(g, now);
}

export const dodgeball = {
  kind: 'dodgeball',
  title: 'Dodgeball',
  place: 'court',
  minPlayers: 2,
  hasHide: false,
  teams: true,
  settings: [
    { id: 'playSeconds', label: 'Round time', options: [60, 90, 120, 150, 180], default: 120 },
    { id: 'balls', label: 'Balls', options: ['auto', 3, 4, 5, 6], labels: { auto: 'Auto' }, default: 'auto' },
    { id: 'ballSpeed', label: 'Ball speed', options: [10, 12, 14, 16], labels: { 10: 'Floaty', 12: 'Gentle', 14: 'Normal', 16: 'Zoomy' }, default: 14 },
    { id: 'comebackSeconds', label: 'Back from the bench', options: ['auto', 0, 10, 15, 20, 30], labels: { auto: 'Auto', 0: 'Only by a catch' }, default: 'auto' },
    BOT_SETTING,
  ],

  arena(raw) {
    const c = isObj(raw) && isObj(raw.court) ? raw.court : isObj(raw) ? raw : {};
    const p = cleanPoint(c) || { x: 0, z: 0 };
    return { area: rectArea(p.x, p.z, num(c.w, 14), num(c.d, 24), num(c.facing)) };
  },

  init(g) {
    g.st.scores = [0, 0];
    g.st.left = [0, 0];
    g.st.wins = [0, 0];
    g.st.balls = [];
  },

  newPlayer(g) {
    const size = [0, 1].map((t) => teamIds(g, t).length);
    const team = size[0] === size[1] ? (g.rng() < 0.5 ? 0 : 1) : size[0] < size[1] ? 0 : 1;
    return { team, out: false, outAt: 0, backAt: 0, ko: 0, catches: 0 };
  },

  joined(g) {
    countLeft(g);
  },

  leaving(g, id) {
    const b = held(g, id);
    if (b) {
      const at = g.pos(id);
      dropBall(g, b, at ? at.x : g.arena.area.f.x, at ? at.z : g.arena.area.f.z, g.P(id).team);
    }
  },

  left(g, id, now) {
    countLeft(g);
    fillEmptyTeam(g, now);
    checkWin(g, now);
  },

  setup(g) {
    const st = g.st;
    const teams = balanceTeams(st.order, st.players, g.rng);
    for (const id of st.order) {
      const p = g.P(id);
      p.team = teams[id];
      p.out = false;
      p.outAt = 0;
      p.backAt = 0;
      p.ko = 0;
      p.catches = 0;
    }
    st.scores = [0, 0];
    placeBalls(g);
    countLeft(g);
  },

  phaseMs(g) {
    return g.sec('playSeconds');
  },

  tick(g, now) {
    const st = g.st;
    if (st.phase !== 'play') return;
    for (const b of st.balls) {
      if (b.s === 'air' && b.fl && now >= b.fl.landT) {
        const fl = b.fl;
        const q = flightAt(fl, fl.landT);
        // one soft bounce forward, then it rests
        const roll = 0.12;
        dropBall(g, b, q.x + fl.vx * roll, q.z + fl.vz * roll, null);
        g.fx({ type: 'bounce', x: b.x, z: b.z, sfx: 'bounce' });
        g.bump();
      } else if (b.s === 'held' && (!g.P(b.by) || g.P(b.by).out)) {
        dropBall(g, b, g.arena.area.f.x, g.arena.area.f.z, null);
        g.bump();
      }
    }
    const comeback = comebackMs(g);
    if (comeback > 0) {
      for (const id of st.order) {
        const p = g.P(id);
        if (p.out && now - p.outAt >= comeback && inIds(g, p.team).length > 0) {
          bringBack(g, p.team, now, id, 'cheer');
          g.bump();
        }
      }
    }
    checkWin(g, now);
  },

  claim(g, from, c, now) {
    const st = g.st;
    if (st.phase !== 'play') return false;
    const me = g.P(from);
    if (me.out) return false;
    const b = ballById(g, c.ballId);
    if (!b) return false;
    const at = g.pos(from);
    if (!at) return false;
    const A = g.arena.area;
    switch (c.type) {
      case 'pickup': {
        if (b.s !== 'ground' || held(g, from)) return false;
        if (dist(at, b) > BALL.pickR + LAG) return false;
        if (toLocal(A.f, b.x, b.z).z * sign(me.team) < -0.75) return false; // the other side's ball
        b.s = 'held';
        b.by = from;
        g.fx({ type: 'pickup', id: from, ballId: b.id, sfx: 'tap' });
        return true;
      }
      case 'throw': {
        if (b.s !== 'held' || b.by !== from) return false;
        const f = cleanPoint(c.from);
        const dir = cleanPoint(c.dir);
        if (!f || !dir || dist(f, at) > 3.5) return false;
        const dl = Math.hypot(dir.x, dir.z);
        if (dl < 1e-3) return false;
        const l = toLocal(A.f, f.x, f.z);
        if (l.z * sign(me.team) < -1) return false; // thrown from across the midline
        const lz = me.team === 0 ? Math.min(l.z, -0.3) : Math.max(l.z, 0.3);
        const start = toWorld(A.f, clamp(l.x, -A.hw - 1, A.hw + 1), clamp(lz, -A.hd - 1, A.hd + 1));
        const power = clamp(num(c.power, 1), 0, 1);
        const speed = st.settings.ballSpeed * (0.65 + 0.35 * power);
        const vx = (dir.x / dl) * speed;
        const vz = (dir.z / dl) * speed;
        b.s = 'air';
        b.by = null;
        b.x = r2(start.x);
        b.z = r2(start.z);
        b.fl = {
          by: from,
          team: me.team,
          t0: now,
          x0: r2(start.x),
          y0: BALL.height,
          z0: r2(start.z),
          vx: r2(vx),
          vy: BALL.lift,
          vz: r2(vz),
          landT: landTime(now, BALL.height, BALL.lift),
          done: false,
        };
        g.fx({ type: 'throw', id: from, ballId: b.id, x: b.x, z: b.z, sfx: 'throw' });
        return true;
      }
      case 'hit': {
        const target = cleanId(c.target);
        if (target !== from) return false; // only your own device says you were hit
        const fl = b.fl;
        if (!fl || fl.done || fl.team === me.team || !g.P(fl.by)) return false;
        if (now < fl.t0 || now > fl.landT + HIT_GRACE_MS || now - fl.t0 > 5000) return false;
        if (pathMin(fl, fl.t0, Math.min(now, fl.landT), at) > BALL.hitR + LAG) return false;
        fl.done = true;
        if (b.s === 'air') dropBall(g, b, at.x, at.z, me.team);
        const thrower = g.P(fl.by);
        thrower.ko = num(thrower.ko) + 1;
        st.scores[fl.team] += 1;
        g.fx({ type: 'hit', ids: [fl.by, from], x: r2(at.x), z: r2(at.z), sfx: 'hit', burst: true, hype: 'hit' });
        sendOut(g, from, now);
        checkWin(g, now);
        return true;
      }
      case 'catch': {
        const fl = b.fl;
        if (b.s !== 'air' || !fl || fl.done || fl.team === me.team || held(g, from)) return false;
        if (pathMin(fl, now - 700, now, at) > BALL.catchR + LAG) return false;
        fl.done = true;
        b.s = 'held';
        b.by = from;
        me.catches = num(me.catches) + 1;
        const thrower = g.P(fl.by);
        let out = false;
        if (thrower && !thrower.out) {
          out = sendOut(g, fl.by, now);
          if (out) {
            me.ko = num(me.ko) + 1;
            st.scores[me.team] += 1;
          }
        }
        g.fx({ type: 'catch', ids: [from, fl.by], out, x: r2(at.x), z: r2(at.z), sfx: 'catch', burst: true, hype: 'catch' });
        bringBack(g, me.team, now);
        checkWin(g, now);
        return true;
      }
      default:
        return false;
    }
  },

  timeUp(g) {
    countLeft(g);
    const [a, b] = g.st.left;
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
      { id: 'catcher', score: (id) => num(P(id).catches) },
      { id: 'thrower', score: (id) => num(P(id).ko) },
      { id: 'dodger', many: true, score: (id) => (P(id).out ? 0 : 1) },
      { id: 'matTalk', score: (id) => (P(id).out ? 1 : 0) },
    ];
  },

  reset(g) {
    for (const id of g.st.order) {
      const p = g.P(id);
      p.out = false;
      p.outAt = 0;
      p.backAt = 0;
    }
    g.st.balls = [];
    countLeft(g);
  },

  spawn(g, id) {
    const A = g.arena.area;
    const p = g.P(id);
    const sg = sign(p.team);
    if (p.out) {
      // the bench: just outside the sideline of your own half
      const benched = teamIds(g, p.team).filter((x) => g.P(x).out);
      benched.sort((a, b) => g.P(a).outAt - g.P(b).outAt);
      const k = Math.max(0, benched.indexOf(id));
      const per = Math.max(1, Math.floor((A.hd - 1.2) / 1.2));
      const row = Math.floor(k / per);
      const lz = sg * (1.4 + (k % per) * 1.2);
      const w = toWorld(A.f, -(A.hw + 1.6 + row * 1.2), lz);
      const face = dirToWorld(A.f, 1, 0);
      return { x: w.x, z: w.z, facing: Math.atan2(face.x, face.z) };
    }
    const mates = teamIds(g, p.team).filter((x) => !g.P(x).out);
    const k = Math.max(0, mates.indexOf(id));
    const n = Math.max(1, mates.length);
    const lx = n === 1 ? 0 : -A.hw * 0.7 + (k * 1.4 * A.hw) / (n - 1);
    const lz = sg * (A.hd * 0.55 + (k % 2) * 1.2);
    const w = toWorld(A.f, lx, lz);
    return { x: w.x, z: w.z, facing: A.f.facing + (p.team === 0 ? 0 : Math.PI) };
  },

  confine(g, id, x, z) {
    const p = id ? g.P(id) : null;
    const A = g.arena.area;
    if (!p) return { x, z };
    if (p.out && (g.st.phase === 'play' || g.st.phase === 'countdown')) {
      const s = dodgeball.spawn(g, id);
      return { x: clamp(x, s.x - 1.2, s.x + 1.2), z: clamp(z, s.z - 1.2, s.z + 1.2) };
    }
    const l = toLocal(A.f, x, z);
    const lx = clamp(l.x, -A.hw + 0.4, A.hw - 0.4);
    const lz = p.team === 0 ? clamp(l.z, -A.hd + 0.4, -0.35) : clamp(l.z, 0.35, A.hd - 0.4);
    return toWorld(A.f, lx, lz);
  },

  bot(g, id, pos, dt, m) {
    if (g.st.phase !== 'play') return null;
    const p = g.P(id);
    if (p.out) return { anim: 'cheer' }; // mat talk from the bench
    return dodgeBot(g, id, pos, dt, m);
  },

  who(g, id, p, w) {
    const now = g.clock();
    w.team = p.team;
    w.color = TEAMS[p.team].color;
    w.role = p.out ? 'out' : 'player';
    if (held(g, id)) w.carrying = 'ball';
    if (p.out && g.st.phase === 'play') {
      w.anim = 'cheer';
      w.canMove = false;
    } else if (g.st.phase === 'play' && p.backAt && now - p.backAt < 1500) w.glow = true;
  },

  ui(g, me, now, u) {
    const st = g.st;
    const p = me ? g.P(me) : null;
    if (p && st.phase !== 'lobby') {
      u.roleBadge = p.out && st.phase === 'play'
        ? { text: 'On the bench', color: PALETTE.lilac, icon: 'bench' }
        : { text: TEAMS[p.team].name, color: TEAMS[p.team].color, icon: 'ball' };
    }
    const since = now - st.phaseStarted;
    if (st.phase === 'countdown') u.line = `You're on ${p ? TEAMS[p.team].name : 'a team'}! Grab a ball from the middle!`;
    else if (st.phase === 'play') {
      if (!p) u.line = 'Dodge, duck, dip, dive and dodge!';
      else if (p.out) {
        const cb = comebackMs(g);
        const left = cb > 0 ? Math.max(0, Math.ceil((p.outAt + cb - now) / 1000)) : 0;
        u.line = cb > 0 ? `On the bench! Cheer your team on. Back in ${left}, or sooner with a catch!` : 'On the bench! Cheer your team on. A catch brings you back!';
      }
      else if (held(g, me)) u.line = 'Throw it at the other team!';
      else u.line = 'Grab a ball, dodge, or catch one to bring a friend back!';
      if (p && p.out && now - p.outAt < 2000) u.big = { text: 'Bonk!', sub: 'To the bench. Cheer them on!' };
      else if (p && !p.out && p.backAt && now - p.backAt < 2000) u.big = { text: 'Back in!', sub: 'Go get them!' };
      else if (since < 1500) u.big = { text: 'Go!', sub: 'Grab a ball!' };
      if (p && !p.out) u.action = held(g, me) ? { id: 'throw', label: 'Throw!' } : { id: 'catch', label: 'Catch!' };
    } else if (st.phase === 'results') {
      const res = st.result || { winner: 'none', ids: [] };
      const mine = me && res.ids.includes(me);
      if (res.winner === 0 || res.winner === 1) u.big = { text: `${TEAMS[res.winner].name} wins!`, sub: mine ? 'Amazing teamwork!' : 'So close! Great dodging!' };
      else if (res.winner === 'tie') u.big = { text: "It's a tie!", sub: 'Everybody wins!' };
      else u.big = { text: 'Round over', sub: 'Not enough players this time' };
      u.line = 'Great game, everybody!';
    }
    u.scoreboard = {
      title: 'Players in',
      rows: [0, 1].map((t) => ({ id: `team${t}`, label: TEAMS[t].name, value: st.left[t], color: TEAMS[t].color, me: !!p && p.team === t, wins: st.wins[t] })),
    };
  },

  auto(g, me, now) {
    const st = g.st;
    const p = g.P(me);
    const L = g.local;
    const last = isNum(L.lastT) && now - L.lastT < 500 ? L.lastT : now - 50;
    L.lastT = now;
    if (st.phase !== 'play' || p.out) return null;
    const at = g.pos(me);
    if (!at) return null;
    const mine = held(g, me);
    for (const b of st.balls) {
      const fl = b.fl;
      if (b.s !== 'air' || !fl || fl.done || fl.team === p.team) continue;
      if (pathMin(fl, last - 10, now, at) > BALL.hitR) continue;
      if (!mine && isNum(L.catchAt) && now - L.catchAt <= CATCH_WINDOW_MS) return { type: 'catch', ballId: b.id };
      return { type: 'hit', ballId: b.id, target: me };
    }
    if (!mine) {
      const A = g.arena.area;
      for (const b of st.balls) {
        if (b.s !== 'ground' || dist(at, b) > BALL.pickR) continue;
        if (toLocal(A.f, b.x, b.z).z * sign(p.team) < -0.75) continue;
        return { type: 'pickup', ballId: b.id };
      }
    }
    return null;
  },

  press(g, me, now, aim) {
    const st = g.st;
    const p = g.P(me);
    if (st.phase !== 'play' || p.out) return null;
    const at = g.pos(me);
    if (!at) return null;
    const b = held(g, me);
    if (b) {
      let dir = aim && cleanPoint({ x: aim.x, z: aim.z });
      if (aim && cleanId(aim.target) && g.P(aim.target)) {
        const q = g.pos(aim.target);
        if (q) dir = { x: q.x - at.x, z: q.z - at.z };
      }
      if (!dir || Math.hypot(dir.x, dir.z) < 0.1) {
        // auto-aim: the closest player still in on the other team
        let best = null;
        let bestD = Infinity;
        for (const id of inIds(g, 1 - p.team)) {
          const q = g.pos(id);
          if (q && dist(at, q) < bestD) {
            bestD = dist(at, q);
            best = q;
          }
        }
        const fwd = dirToWorld(g.arena.area.f, 0, -sign(p.team));
        dir = best ? { x: best.x - at.x, z: best.z - at.z } : fwd;
      }
      const power = aim && isNum(aim.power) ? clamp(aim.power, 0, 1) : 1;
      return { type: 'throw', ballId: b.id, from: { x: r2(at.x), z: r2(at.z) }, dir: { x: r2(dir.x), z: r2(dir.z) }, power };
    }
    g.local.catchAt = now;
    for (const ball of st.balls) {
      const fl = ball.fl;
      if (ball.s !== 'air' || !fl || fl.done || fl.team === p.team) continue;
      if (pathMin(fl, now - 120, now, at) <= BALL.catchR) return { type: 'catch', ballId: ball.id };
    }
    return null;
  },

  text(g, fx, me) {
    const [a, b] = Array.isArray(fx.ids) ? fx.ids : [];
    switch (fx.type) {
      case 'hit':
        if (b === me) return 'Bonk! Cheer from the bench. A catch brings you back!';
        if (a === me) return `You hit ${nm(g, b, me)}!`;
        return `${nm(g, a, me, true)} hit ${nm(g, b, me)}!`;
      case 'catch':
        if (a === me) return fx.out ? `Great catch! ${nm(g, b, me, true)} is out.` : 'Great catch!';
        if (b === me) return `${nm(g, a, me, true)} caught your throw! To the bench!`;
        return `${nm(g, a, me, true)} made a great catch!`;
      case 'back':
        if (fx.why === 'cheer') return fx.id === me ? 'Your team cheered you back in!' : `${g.name(fx.id)} is back in!`;
        return fx.id === me ? "You're back in, thanks to that catch!" : `${g.name(fx.id)} is back in!`;
      case 'switch':
        return fx.id === me ? `You switched to ${TEAMS[fx.team === 1 ? 1 : 0].name} to even things out!` : `${g.name(fx.id)} switched teams to even things out!`;
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
      out: rp.out === true,
      outAt: Math.max(0, num(rp.outAt)),
      backAt: Math.max(0, num(rp.backAt)),
      ko: clamp(Math.trunc(num(rp.ko)), 0, 1000),
      catches: clamp(Math.trunc(num(rp.catches)), 0, 1000),
    };
  },

  clean(raw, st) {
    const pair = (v, max) => (Array.isArray(v) ? [0, 1].map((k) => clamp(Math.trunc(num(v[k])), 0, max)) : [0, 0]);
    st.scores = pair(raw.scores, 1000);
    st.wins = pair(raw.wins, 1e6);
    st.balls = [];
    const balls = Array.isArray(raw.balls) ? raw.balls.slice(0, 8) : [];
    for (const rb of balls) {
      if (!isObj(rb)) continue;
      const id = cleanId(rb.id);
      if (!id || st.balls.some((b) => b.id === id)) continue;
      const p = cleanPoint(rb) || { x: 0, z: 0 };
      const ball = { id, s: 'ground', x: r2(p.x), z: r2(p.z), by: null, fl: cleanFlight(rb.fl, st) };
      if (rb.s === 'held' && cleanId(rb.by) && st.players[rb.by] && !st.players[rb.by].out) {
        ball.s = 'held';
        ball.by = rb.by;
      } else if (rb.s === 'air' && ball.fl) ball.s = 'air';
      st.balls.push(ball);
    }
    st.left = [0, 1].map((t) => st.order.filter((id) => st.players[id].team === t && !st.players[id].out).length);
  },

  cleanWinner(v) {
    return v === 0 || v === 1 || v === 'tie' ? v : 'none';
  },

  extra(g, game) {
    game.ballPos = ballPos;
  },
};

function cleanFlight(f, st) {
  if (!isObj(f)) return null;
  const keys = ['t0', 'x0', 'y0', 'z0', 'vx', 'vy', 'vz', 'landT'];
  if (!keys.every((k) => isNum(f[k]))) return null;
  if (Math.hypot(f.vx, f.vz) > 40 || Math.abs(f.vy) > 20 || f.landT < f.t0 || f.landT - f.t0 > 10000) return null;
  const by = cleanId(f.by);
  return {
    by: by && st.players[by] ? by : null,
    team: f.team === 1 ? 1 : 0,
    t0: f.t0,
    x0: f.x0,
    y0: clamp(f.y0, 0, 5),
    z0: f.z0,
    vx: f.vx,
    vy: f.vy,
    vz: f.vz,
    landT: f.landT,
    done: f.done === true,
  };
}

// ---------- bots ----------

function shared(g) {
  if (!g.db || g.db.round !== g.st.round) g.db = { round: g.st.round, want: new Map() };
  return g.db;
}

function dodgeBot(g, id, pos, dt, m) {
  const st = g.st;
  const L = g.level();
  const A = g.arena.area;
  const p = g.P(id);
  const now = g.now;
  const sg = sign(p.team);
  const mine = held(g, id);
  if (!m.seen) m.seen = new Map();

  // 1. live balls from the other team: a hit, a catch, or a dodge
  for (const b of st.balls) {
    const fl = b.fl;
    if (b.s !== 'air' || !fl || fl.done || fl.team === p.team) continue;
    const key = `${b.id}:${fl.t0}`;
    if (pathMin(fl, now - dt * 1000 - 10, now, pos) <= BALL.hitR) {
      const plan = m.seen.get(key);
      const ready = plan && now >= plan.at;
      if (ready && plan.what === 'catch' && !mine) return { move: { x: 0, z: 0 }, action: { type: 'catch', ballId: b.id }, anim: 'catch' };
      return { move: { x: 0, z: 0 }, action: { type: 'hit', ballId: b.id, target: id }, anim: 'tagged' };
    }
    if (!m.seen.has(key)) {
      // closest approach over the next 0.9 s
      let best = Infinity;
      let bestT = now;
      for (let t = now; t <= Math.min(now + 900, fl.landT); t += 30) {
        const q = flightAt(fl, t);
        if (q.y > BALL.maxY) continue;
        const d = Math.hypot(q.x - pos.x, q.z - pos.z);
        if (d < best) {
          best = d;
          bestT = t;
        }
      }
      if (best < 1.3) {
        const r = g.rng();
        const what = !mine && r < L.catchP ? 'catch' : r < L.catchP + L.dodgeP ? 'dodge' : 'none';
        const plan = { what, at: now + L.react * 1000 * (0.7 + g.rng() * 0.6) };
        if (what === 'dodge') {
          const q = flightAt(fl, bestT);
          const vl = Math.hypot(fl.vx, fl.vz) || 1;
          let px = -fl.vz / vl;
          let pz = fl.vx / vl;
          const sideNow = (pos.x - q.x) * px + (pos.z - q.z) * pz;
          const s = Math.abs(sideNow) > 0.05 ? Math.sign(sideNow) : g.rng() < 0.5 ? 1 : -1;
          // stay inside our half: if that way is out of bounds, go the other way
          const probe = toLocal(A.f, pos.x + px * s * 1.5, pos.z + pz * s * 1.5);
          const flip = Math.abs(probe.x) > A.hw - 0.5 || probe.z * sg < 0.4 || Math.abs(probe.z) > A.hd - 0.5;
          plan.dir = { x: px * s * (flip ? -1 : 1), z: pz * s * (flip ? -1 : 1) };
        }
        m.seen.set(key, plan);
      }
    }
    const plan = m.seen.get(key);
    if (plan && plan.what === 'dodge' && now >= plan.at && now < plan.at + 450) {
      return { move: { x: plan.dir.x * L.speed, z: plan.dir.z * L.speed }, anim: 'dodge' };
    }
    if (plan && plan.what === 'catch' && now >= plan.at && !mine) return { move: { x: 0, z: 0 }, anim: 'catch' };
  }

  // 2. holding a ball: get to a throwing spot, wind up, throw with a little wobble
  if (mine) {
    if (!m.throwAt) {
      m.throwAt = now + (1.2 + g.rng() * 2 + (1 - L.see) * 0.8) * 1000; // line it up, fake once or twice
      const w = toWorld(A.f, (g.rng() * 2 - 1) * (A.hw - 1), sg * (2 + g.rng() * 3.5));
      m.spot = w;
    }
    const opp = inIds(g, 1 - p.team).map((o) => ({ id: o, q: g.pos(o) })).filter((o) => o.q);
    // back off from the midline before throwing (no point-blank bonks in the opening rush),
    // unless it is taking too long to get there
    const back = toLocal(A.f, pos.x, pos.z).z * sg;
    if (now >= m.throwAt && opp.length && (back >= 1.8 || now >= m.throwAt + 2500)) {
      opp.sort((a, b) => dist(pos, a.q) - dist(pos, b.q));
      const t = g.rng() < 0.55 ? opp[0] : opp[Math.floor(g.rng() * opp.length)];
      const tr = g.track.get(t.id);
      const speed = st.settings.ballSpeed * 0.95;
      const lead = (dist(pos, t.q) / speed) * L.lead;
      const ax = t.q.x + (tr ? tr.vx * lead : 0) - pos.x;
      const az = t.q.z + (tr ? tr.vz * lead : 0) - pos.z;
      const err = (g.rng() + g.rng() - 1) * L.aim * 2.2;
      const c = Math.cos(err);
      const s = Math.sin(err);
      m.throwAt = 0;
      return {
        move: { x: 0, z: 0 },
        anim: 'throw',
        face: Math.atan2(ax, az),
        action: {
          type: 'throw',
          ballId: mine.id,
          from: { x: r2(pos.x), z: r2(pos.z) },
          dir: { x: r2(ax * c + az * s), z: r2(-ax * s + az * c) },
          power: 0.8 + g.rng() * 0.2,
        },
      };
    }
    return { move: navigate(m, pos, m.spot, L.speed * 0.8, dt, g.rng, 0.8) };
  }
  m.throwAt = 0;

  // 3. no ball: fetch one on our side, or hang back and shuffle side to side
  const sh = shared(g);
  let best = null;
  let bestScore = Infinity;
  for (const b of st.balls) {
    if (b.s !== 'ground' || toLocal(A.f, b.x, b.z).z * sg < -0.5) continue;
    const other = sh.want.get(b.id);
    const score = dist(pos, b) + (other && other !== id && g.P(other) ? 6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  }
  for (const [k, v] of sh.want) if (v === id) sh.want.delete(k);
  if (best && bestScore < 40) {
    sh.want.set(best.id, id);
    if (dist(pos, best) <= BALL.pickR * 0.8) return { move: { x: 0, z: 0 }, action: { type: 'pickup', ballId: best.id } };
    return { move: navigate(m, pos, best, L.speed, dt, g.rng, 0.3) };
  }
  m.think -= dt;
  if (m.think <= 0 || !m.home) {
    m.think = 0.8 + g.rng() * 1.6;
    const w = toWorld(A.f, (g.rng() * 2 - 1) * (A.hw - 1), sg * (A.hd * (0.45 + g.rng() * 0.45)));
    m.home = w;
  }
  return { move: navigate(m, pos, m.home, L.speed * 0.6, dt, g.rng, 0.8) };
}
