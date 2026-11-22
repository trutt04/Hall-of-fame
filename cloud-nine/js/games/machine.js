// The game machine shared by the four modes: phases and timers, players joining and leaving,
// claims, fx, bots, the HUD summary and the clean-up of states that arrive over the network.
// Each mode plugs its rules in through hooks (see the header of hide-seek.js for the list).
// Pure: no three.js, no DOM. Time only comes in through `now` and randomness through `rng`.
//
// Phases: lobby -> countdown ("5, 6, 7, 8!") -> [hide] -> play -> results (8 s) -> lobby (next round).
// The first lobby waits for host.start(); later lobbies start the next round by themselves after
// BREAK_MS, so a game never stalls even when nobody touches anything.

import { mulberry32 } from '../core/util.js';
import {
  BOT_LEVELS, BREAK_MS, COUNTDOWN_MS, COUNT_MS, MAX_PLAYERS, RESULTS_MS,
  capLen, clamp, cleanId, cleanName, cleanSettings, fmtClock, isNum, isObj, normalizePlayers, num, own, r2,
} from './common.js';

const PHASES = ['lobby', 'countdown', 'hide', 'play', 'results'];
const ACTIVE = new Set(['countdown', 'hide', 'play']);
const COUNTS = ['5', '6', '7', '8!'];
// Everybody celebrates in results; winners get the big moves.
const WIN_MOVES = ['toeTouch', 'cheer', 'kickDouble', 'dance', 'liberty'];
const CLAP_MOVES = ['clap', 'cheer', 'wave', 'highV'];

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeGame(mode, opts) {
  const o = isObj(opts) ? opts : {};
  const rng = typeof o.rng === 'function' ? o.rng : mulberry32(1);
  const clockFn = typeof o.now === 'function' ? o.now : null;
  const readClock = () => {
    if (!clockFn) return NaN;
    try {
      return Number(clockFn());
    } catch (err) {
      return NaN;
    }
  };
  const t0 = isNum(o.now) ? o.now : num(readClock(), 0);
  const strict = o.strict === true; // tests: let exceptions through instead of rejecting quietly

  const g = {
    mode,
    rng,
    arena: mode.arena(o.arena),
    st: null,
    mem: new Map(), // bot brains (host only, never shared)
    track: new Map(), // id -> { x, z, vx, vz }: everyone's recent velocity, for bots that lead their aim
    fxq: [],
    now: t0,
    beat: -1,
    view: null,
    auto: new Map(), // autoClaim rate limit, per claim key
    local: {}, // this device's own little memory for autoClaim / press
  };

  const GID = 'abcdefghijkmnpqrstuvwxyz23456789';
  let gid = '';
  for (let i = 0; i < 8; i++) gid += GID[Math.floor(rng() * GID.length)];
  g.st = {
    kind: mode.kind,
    v: 1,
    gid, // this game session; with seq, lets applyState ignore stale echoes
    seq: 0,
    phase: 'lobby',
    phaseStarted: t0,
    phaseEnds: 0,
    round: 1,
    settings: cleanSettings(mode.settings, o.settings),
    order: [],
    players: {},
    result: null,
  };

  // ---------- helpers the modes use ----------
  g.P = (id) => (own(g.st.players, id) ? g.st.players[id] : null);
  g.ids = () => g.st.order;
  g.bump = () => {
    g.st.seq = (g.st.seq + 1) % 1000000000;
  };
  g.fx = (e) => {
    g.fxq.push(e);
  };
  g.level = () => BOT_LEVELS[g.st.settings.botLevel] || BOT_LEVELS.normal;
  g.sec = (key) => num(g.st.settings[key], 60) * 1000;
  g.pos = (id) => {
    const v = g.view;
    if (!v || typeof v.pos !== 'function') return null;
    let p = null;
    try {
      p = v.pos(id);
    } catch (err) {
      return null;
    }
    if (!p || !isNum(p.x) || !isNum(p.z) || Math.abs(p.x) > 1e5 || Math.abs(p.z) > 1e5) return null;
    return p;
  };
  g.name = (id, me) => {
    if (me && id === me) return 'You';
    const p = g.P(id);
    return p && p.nick ? p.nick : 'A player';
  };
  g.clock = () => {
    const c = readClock();
    return isNum(c) ? c : g.now;
  };
  g.teleport = (id) => {
    const s = mode.spawn(g, id);
    if (s) g.fx({ type: 'teleport', id, x: r2(s.x), z: r2(s.z), facing: r2(s.facing) });
  };
  g.finish = (result, now) => finish(result, now);
  g.memFor = (id) => {
    const key = `${g.st.round}:${g.st.phase}`;
    let m = g.mem.get(id);
    if (!m || m.key !== key) {
      m = { key, t: 0, think: 0 };
      g.mem.set(id, m);
    }
    return m;
  };

  mode.init(g);

  // ---------- phase machine ----------
  function setPhase(phase, ms, now) {
    g.st.phase = phase;
    g.st.phaseStarted = now;
    g.st.phaseEnds = ms > 0 ? now + ms : 0;
    g.beat = -1;
    g.bump();
    const sfx = phase === 'countdown' ? 'whistle' : phase === 'hide' || phase === 'play' ? 'go' : null;
    g.fx({ type: 'phase', phase, sfx });
    if (mode.enter) mode.enter(g, phase, now);
  }

  function start(now) {
    if (g.st.phase !== 'lobby') return false;
    if (g.st.order.length < mode.minPlayers) {
      if (g.st.phaseEnds) {
        g.st.phaseEnds = 0;
        g.bump();
      }
      return false;
    }
    g.st.result = null;
    mode.setup(g, now);
    setPhase('countdown', COUNTDOWN_MS, now);
    for (const id of g.st.order) g.teleport(id);
    return true;
  }

  function finish(result, now) {
    if (!ACTIVE.has(g.st.phase)) return;
    const res = isObj(result) ? result : { winner: 'none', ids: [] };
    res.ids = (Array.isArray(res.ids) ? res.ids : []).filter((id) => g.P(id));
    g.st.result = res;
    if (mode.award) mode.award(g, res, now);
    setPhase('results', RESULTS_MS, now);
    g.fx({ type: 'win', winner: res.winner, ids: res.ids.slice(), sfx: res.winner === 'none' ? 'chime' : 'tada', burst: res.ids.length > 0 });
  }

  function nextRound(now) {
    g.st.round += 1;
    if (mode.reset) mode.reset(g, now);
    setPhase('lobby', g.st.order.length >= mode.minPlayers ? BREAK_MS : 0, now);
  }

  function phaseMs(phase) {
    return Math.max(1000, mode.phaseMs(g, phase));
  }

  function track(dtMs) {
    if (!g.view) return;
    const dt = dtMs / 1000;
    for (const id of g.st.order) {
      const p = g.pos(id);
      if (!p) continue;
      const t = g.track.get(id);
      if (!t) {
        g.track.set(id, { x: p.x, z: p.z, vx: 0, vz: 0 });
        continue;
      }
      if (dt > 0) {
        let vx = (p.x - t.x) / dt;
        let vz = (p.z - t.z) / dt;
        if (Math.hypot(vx, vz) > 25) {
          vx = 0; // a teleport, not a sprint
          vz = 0;
        }
        const k = clamp(dt * 8, 0, 1);
        t.vx += (vx - t.vx) * k;
        t.vz += (vz - t.vz) * k;
      }
      t.x = p.x;
      t.z = p.z;
    }
  }

  function guard(fn, fallback) {
    if (strict) return fn();
    try {
      return fn();
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[c9 games]', err);
      return fallback;
    }
  }

  function tick(nowIn, view) {
    const now = isNum(nowIn) ? Math.max(nowIn, g.now) : g.now;
    const dtMs = now - g.now;
    g.now = now;
    if (view) g.view = view;
    track(dtMs);
    const st = g.st;
    switch (st.phase) {
      case 'lobby':
        if (st.phaseEnds && now >= st.phaseEnds) start(now);
        break;
      case 'countdown': {
        const beat = Math.floor((now - st.phaseStarted) / COUNT_MS);
        if (beat > g.beat && beat < 4) {
          g.beat = beat;
          g.fx({ type: 'count', n: 5 + beat, sfx: 'count' });
        }
        if (now >= st.phaseEnds) setPhase(mode.hasHide ? 'hide' : 'play', phaseMs(mode.hasHide ? 'hide' : 'play'), now);
        break;
      }
      case 'hide':
        mode.tick(g, now);
        if (st.phase === 'hide' && now >= st.phaseEnds) setPhase('play', phaseMs('play'), now);
        break;
      case 'play':
        mode.tick(g, now);
        if (st.phase === 'play' && now >= st.phaseEnds) finish(mode.timeUp(g, now), now);
        break;
      case 'results':
        if (now >= st.phaseEnds) nextRound(now);
        break;
      default:
        break;
    }
    if (ACTIVE.has(st.phase) && st.order.length < mode.minPlayers) finish({ winner: 'none', ids: [] }, now);
    const out = g.fxq;
    g.fxq = [];
    return out;
  }

  function addPlayer(idIn, info) {
    const id = cleanId(idIn);
    if (!id) return false;
    const inf = isObj(info) ? info : {};
    const p = g.P(id);
    if (p) {
      const nick = cleanName(inf.nick);
      if (nick && nick !== p.nick) {
        p.nick = nick;
        g.bump();
      }
      return false;
    }
    if (g.st.order.length >= MAX_PLAYERS) return false;
    const now = g.now;
    g.st.players[id] = { nick: cleanName(inf.nick), bot: inf.bot === true, ...mode.newPlayer(g, id, now) };
    g.st.order.push(id);
    if (mode.joined) mode.joined(g, id, now);
    if (ACTIVE.has(g.st.phase)) g.teleport(id);
    g.fx({ type: 'join', id });
    g.bump();
    if (g.st.phase === 'lobby' && !g.st.phaseEnds && g.st.round > 1 && g.st.order.length >= mode.minPlayers) {
      g.st.phaseEnds = now + BREAK_MS; // a later round was waiting for players: get going again
    }
    return true;
  }

  function removePlayer(idIn) {
    const id = cleanId(idIn);
    if (!id || !g.P(id)) return false;
    const now = g.now;
    if (mode.leaving) mode.leaving(g, id, now);
    delete g.st.players[id];
    g.st.order = g.st.order.filter((x) => x !== id);
    g.mem.delete(id);
    g.track.delete(id);
    // too few left to play: end the round kindly before any mode decides a winner by default
    if (ACTIVE.has(g.st.phase) && g.st.order.length < mode.minPlayers) finish({ winner: 'none', ids: [] }, now);
    if (mode.left) mode.left(g, id, now);
    g.fx({ type: 'leave', id });
    g.bump();
    if (g.st.phase === 'lobby' && g.st.order.length < mode.minPlayers && g.st.phaseEnds) g.st.phaseEnds = 0;
    return true;
  }

  function claim(fromIn, c, view) {
    const from = cleanId(fromIn);
    if (!from || !g.P(from) || !isObj(c) || typeof c.type !== 'string' || c.type.length > 16) return false;
    if (view) g.view = view;
    const ok = guard(() => mode.claim(g, from, c, g.now) === true, false);
    if (ok) g.bump();
    return ok;
  }

  function bot(idIn, view, dtIn) {
    const out = { move: { x: 0, z: 0 }, action: null, anim: null, face: null };
    const id = cleanId(idIn);
    const p = id ? g.P(id) : null;
    if (!p) return out;
    if (view) g.view = view;
    if (!p.bot) {
      p.bot = true; // only the host runs bots, and only for bots
      g.bump();
    }
    const dt = clamp(num(dtIn, 0), 0, 0.25);
    const pos = g.pos(id);
    if (!pos) return out;
    const w = who(id, pos);
    if (w.anim) out.anim = w.anim;
    if (!w.canMove && g.st.phase !== 'play' && g.st.phase !== 'hide') return out;
    const m = g.memFor(id);
    const r = guard(() => mode.bot(g, id, pos, dt, m), null);
    if (!r) return out;
    if (r.move && isNum(r.move.x) && isNum(r.move.z) && w.canMove) {
      const lim = capLen(r.move, 9);
      out.move = { x: r2(lim.x), z: r2(lim.z) };
    }
    if (isObj(r.action)) out.action = r.action;
    if (typeof r.anim === 'string') out.anim = r.anim;
    if (isNum(r.face)) out.face = r.face;
    return out;
  }

  function applyState(raw) {
    const clean = guard(() => sanitize(raw), null);
    if (!clean) return false;
    if (clean.gid === g.st.gid && clean.seq < g.st.seq) return false; // an older copy of this game: keep ours
    if (clean.phase !== g.st.phase || clean.round !== g.st.round) g.beat = -1;
    g.st = clean;
    for (const id of [...g.mem.keys()]) if (!g.P(id)) g.mem.delete(id);
    return true;
  }

  function sanitize(raw) {
    if (!isObj(raw) || raw.kind !== mode.kind) return null;
    const phase = PHASES.includes(raw.phase) && (raw.phase !== 'hide' || mode.hasHide) ? raw.phase : 'lobby';
    const st = {
      kind: mode.kind,
      v: 1,
      gid: typeof raw.gid === 'string' && /^[a-z0-9]{1,12}$/.test(raw.gid) ? raw.gid : '',
      seq: clamp(Math.trunc(num(raw.seq)), 0, 1e9),
      phase,
      phaseStarted: Math.max(0, num(raw.phaseStarted)),
      phaseEnds: Math.max(0, num(raw.phaseEnds)),
      round: clamp(Math.trunc(num(raw.round, 1)), 1, 1e6),
      settings: cleanSettings(mode.settings, raw.settings),
      order: [],
      players: {},
      result: null,
    };
    const order = Array.isArray(raw.order) ? raw.order : [];
    for (const v of order) {
      const id = cleanId(v);
      if (!id || own(st.players, id) || !own(raw.players, id) || !isObj(raw.players[id])) continue;
      const rp = raw.players[id];
      st.players[id] = { nick: cleanName(rp.nick), bot: rp.bot === true, ...mode.cleanPlayer(rp, st) };
      st.order.push(id);
      if (st.order.length >= MAX_PLAYERS) break;
    }
    if (isObj(raw.result)) {
      const ids = Array.isArray(raw.result.ids) ? raw.result.ids.map(cleanId).filter((id) => id && own(st.players, id)) : [];
      const winner = mode.cleanWinner(raw.result.winner);
      st.result = { winner, ids: [...new Set(ids)] };
    }
    mode.clean(raw, st, g);
    return st;
  }

  // ---------- views for the HUD and the renderer ----------
  function ui(meIn, nowIn) {
    const now = isNum(nowIn) ? nowIn : g.clock();
    const me = cleanId(meIn);
    const st = g.st;
    const u = {
      title: mode.title,
      line: '',
      timer: null,
      timerText: '',
      big: null,
      roleBadge: null,
      scoreboard: null,
      action: null,
      phase: st.phase,
      round: st.round,
      blind: false,
    };
    if (st.phaseEnds) {
      const sec = Math.max(0, Math.ceil((st.phaseEnds - now) / 1000));
      u.timer = sec;
      u.timerText = fmtClock(sec);
    }
    if (st.phase === 'lobby') {
      const need = mode.minPlayers - st.order.length;
      if (need > 0) u.line = `Need ${need} more ${need === 1 ? 'player' : 'players'}: add a bot or invite a friend!`;
      else if (st.phaseEnds) u.line = `Next round starts in ${u.timer}!`;
      else u.line = 'Waiting for the host to start';
    } else if (st.phase === 'countdown') {
      const beat = clamp(Math.floor((now - st.phaseStarted) / COUNT_MS), 0, 3);
      u.big = { text: COUNTS[beat], sub: beat === 0 ? 'Get ready!' : '' };
    }
    guard(() => mode.ui(g, me, now, u), null);
    return u;
  }

  function celebrate(id) {
    const h = hashStr(`${id}|${g.st.round}`);
    const won = g.st.result && g.st.result.ids.includes(id);
    const list = won ? WIN_MOVES : CLAP_MOVES;
    return list[h % list.length];
  }

  function who(idIn, posIn) {
    const id = cleanId(idIn);
    const w = {
      id,
      role: null,
      team: null,
      color: null,
      glow: false,
      anim: null, // play this no matter what (frozen pose, counting, cheering on the bench)
      pose: null, // play this instead of idle when standing still (hiding crouch)
      canMove: true,
      speed: 1, // a multiplier on the normal run speed
      carrying: null, // 'ball' | 'bow0' | 'bow1'
      hidden: false, // hide the name tag (a hider tucked into a hide spot)
      winner: false,
    };
    const p = id ? g.P(id) : null;
    if (!p) return w;
    const pos = posIn && isNum(posIn.x) && isNum(posIn.z) ? posIn : null;
    guard(() => mode.who(g, id, p, w, pos), null);
    if (g.st.phase === 'countdown') {
      w.canMove = false;
      if (!w.anim) w.anim = 'clap';
    } else if (g.st.phase === 'results') {
      w.canMove = false;
      w.winner = !!(g.st.result && g.st.result.ids.includes(id));
      w.anim = celebrate(id);
      w.hidden = false;
    }
    return w;
  }

  function autoClaim(meIn, view, nowIn) {
    const me = cleanId(meIn);
    if (!me || !g.P(me) || !mode.auto) return null;
    if (view) g.view = view;
    const now = isNum(nowIn) ? nowIn : g.clock();
    const c = guard(() => mode.auto(g, me, now), null);
    if (!isObj(c)) return null;
    const key = `${c.type}:${c.target ?? c.ballId ?? c.team ?? ''}`;
    const last = g.auto.get(key);
    if (isNum(last) && now - last < 350) return null; // don't flood the host while it answers
    g.auto.set(key, now);
    return c;
  }

  function press(meIn, view, nowIn, aim) {
    const me = cleanId(meIn);
    if (!me || !g.P(me) || !mode.press) return null;
    if (view) g.view = view;
    const now = isNum(nowIn) ? nowIn : g.clock();
    const c = guard(() => mode.press(g, me, now, isObj(aim) ? aim : null), null);
    return isObj(c) ? c : null;
  }

  function fxText(fx, meIn) {
    if (!isObj(fx) || typeof fx.type !== 'string') return '';
    const me = cleanId(meIn);
    const t = guard(() => mode.text(g, fx, me), '');
    return typeof t === 'string' ? t : '';
  }

  function confine(idIn, x, z) {
    const id = cleanId(idIn);
    const c = g.arena.area.f;
    if (!isNum(x) || !isNum(z)) return { x: c.x, z: c.z };
    const r = guard(() => mode.confine(g, id, x, z), null);
    return r && isNum(r.x) && isNum(r.z) ? r : { x, z };
  }

  function spawnFor(idIn) {
    const id = cleanId(idIn);
    if (!id || !g.P(id)) return null;
    return guard(() => mode.spawn(g, id), null);
  }

  function botsNeeded(target) {
    const n = g.st.order.length;
    const base = mode.teams ? Math.max(4, n + (n % 2)) : Math.max(4, n);
    const want = isNum(target) ? clamp(Math.round(target), 0, MAX_PLAYERS) : Math.min(MAX_PLAYERS, base);
    return Math.max(0, want - n);
  }

  const game = {
    kind: mode.kind,
    title: mode.title,
    arena: g.arena,
    get state() {
      return g.st;
    },
    host: {
      tick: (now, view) => guard(() => tick(now, view), []),
      claim,
      addPlayer: (id, info) => guard(() => addPlayer(id, info), false),
      removePlayer: (id) => guard(() => removePlayer(id), false),
      start(now) {
        if (isNum(now)) g.now = Math.max(g.now, now);
        return guard(() => start(g.now), false);
      },
      end(now) {
        if (isNum(now)) g.now = Math.max(g.now, now);
        if (!ACTIVE.has(g.st.phase)) return false;
        guard(() => finish(g.st.phase === 'play' ? mode.timeUp(g, g.now) : { winner: 'none', ids: [] }, g.now), null);
        return true;
      },
      botsNeeded,
    },
    bot,
    applyState,
    ui,
    who,
    spawnFor,
    confine,
    autoClaim,
    press,
    fxText,
  };
  if (mode.extra) mode.extra(g, game);

  for (const p of normalizePlayers(o.players)) addPlayer(p.id, p);
  g.fxq = []; // nothing to announce before the game is even shown
  return game;
}
