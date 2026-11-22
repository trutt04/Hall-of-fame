// The pure side of the game layer (PLAY): everything here is plain data in, plain data out, with no
// three.js and no DOM, so it runs under `node --test` (test/play-logic.test.mjs).
//
//   PLAY_KINDS                       the four games this layer runs (Contract 5 MODES)
//   parseSwitches(search) -> { game, bots, speed, quick, botLevel }   test switches from the page address
//   gameSettings(kind, { quick, botLevel }) -> raw settings for createGame (quick = the shortest rounds)
//   soloBots(kind, switches) -> how many bot friends a solo game gets
//   cleanFx(raw) -> fx | null        one fx from the network, checked field by field (untrusted)
//   cleanBatch(data) -> { g, f: [fx] } | null   an fx batch event from the host
//   shareFx(fx, isBot) -> boolean    which host fx go over the network (a bot's teleport does not)
//   packFx(list, gid, maxLen) -> [{ g, f }]     fx batches, each small enough for one network event
//   createOutbox({ send, gapMs, maxLen, maxQueue })   queues fx and sends batches under the rate limit
//   musicFor(kind, phase, { spectator }) -> track id   'game', 'tense' (seeking), 'victory' (results), 'island'
//   splashFor(ui) -> { key, text, sub, ms } | null         what the centre splash should show
//   forcedAnim(who, { still, react }) -> anim | null       what the local cheerleader must play
//   hypeFor(fx, me, info) -> { situation, ctx } | null     a Contract 8 hype line for this player
//   toastPriority(fx, me, info) -> 0 (skip) | 1 (if quiet) | 2 (always)
//   burstStyle(fx, teamColors) -> { count, colors, size, speed } | null
//   pickAim(me, heading, opponents) -> id | null           who an auto-aimed throw goes to
//   trimBoard(scoreboard, max) -> scoreboard               the leaders and me, for small screens
//   tagStyle(kind, who) -> { color, ink, icon } | null      a role's name tag (team colours, "it", frozen, seeker)
//   holdAnim(anim) -> seconds a bot keeps a one-shot reaction on screen (throw, catch, dodge, tagged)
//   gameClock(base, speed, t0) -> () => ms     the game's clock (faster for tests when solo)
//   leaveCopy({ solo, host }) -> { kicker, title, lines, yes, no }   the leave / end card words
//   COPY                             every other line this layer puts on screen (tone-checked by the tests)

import { PALETTE, TEAMS } from '../config.js';

export const PLAY_KINDS = Object.freeze(['hideSeek', 'freezeTag', 'dodgeball', 'captureBow']);
const PHASES = ['lobby', 'countdown', 'hide', 'play', 'results'];
const WINNERS = [0, 1, 'tie', 'none', 'hiders', 'seekers', 'it', 'runners'];
const ID_RE = /^[A-Za-z0-9_\-:.]{1,64}$/;
const WORD_RE = /^[A-Za-z]{1,20}$/;
const MAX_POS = 500;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

export function cleanPlayId(v) {
  return typeof v === 'string' && ID_RE.test(v) && v !== '__proto__' && v !== 'constructor' && v !== 'prototype' ? v : null;
}

// ------------------------------------------------------------------------------------ test switches

/**
 * ?game=hideSeek&bots=5&speed=4&quick=1&botLevel=easy (solo). Unknown values are ignored:
 * game must be one of the four, bots 0..9, speed 1..10 (game time runs that much faster).
 */
export function parseSwitches(search) {
  let p;
  try {
    p = new URLSearchParams(typeof search === 'string' ? search : '');
  } catch (err) {
    p = new URLSearchParams('');
  }
  const game = p.get('game');
  const bots = p.get('bots');
  const speed = Number(p.get('speed'));
  const level = p.get('botLevel') || p.get('level');
  const nb = bots === null || bots === '' ? null : Math.trunc(Number(bots));
  return {
    game: PLAY_KINDS.includes(game) ? game : null,
    bots: Number.isFinite(nb) && nb >= 0 ? Math.min(9, nb) : null,
    speed: Number.isFinite(speed) && speed >= 1 ? Math.min(10, speed) : 1,
    quick: p.get('quick') === '1' || p.get('quick') === '',
    botLevel: level === 'easy' || level === 'normal' || level === 'hard' ? level : null,
  };
}

const QUICK = {
  hideSeek: { hideSeconds: 20, seekSeconds: 60, hintSeconds: 20 },
  freezeTag: { playSeconds: 60 },
  dodgeball: { playSeconds: 60 },
  captureBow: { playSeconds: 120, toWin: 2 },
};

export function gameSettings(kind, o = {}) {
  const out = o.quick && QUICK[kind] ? Object.assign({}, QUICK[kind]) : {};
  if (o.botLevel) out.botLevel = o.botLevel;
  return out;
}

/** Bot friends for a solo game: ?bots=N, else enough for a lively game of six. */
export function soloBots(kind, sw = {}) {
  if (isNum(sw.bots)) return clamp(Math.trunc(sw.bots), PLAY_KINDS.includes(kind) ? 1 : 0, 9);
  return 5;
}

// ------------------------------------------------------------------------------------ fx over the network

function cleanNum(v, lim = MAX_POS) {
  return isNum(v) ? r2(clamp(v, -lim, lim)) : undefined;
}

/** One fx from the host's batch. Everything is checked; unknown fields are dropped. */
export function cleanFx(raw) {
  if (!isObj(raw) || typeof raw.type !== 'string' || !WORD_RE.test(raw.type)) return null;
  const f = { type: raw.type };
  if (typeof raw.sfx === 'string' && WORD_RE.test(raw.sfx)) f.sfx = raw.sfx;
  if (typeof raw.hype === 'string' && WORD_RE.test(raw.hype)) f.hype = raw.hype;
  for (const k of ['x', 'z']) {
    const v = cleanNum(raw[k]);
    if (v !== undefined) f[k] = v;
  }
  const facing = cleanNum(raw.facing, 100);
  if (facing !== undefined) f.facing = facing;
  if (raw.burst === true) f.burst = true;
  if (raw.out === true) f.out = true;
  const id = cleanPlayId(raw.id);
  if (id) f.id = id;
  const ballId = cleanPlayId(raw.ballId);
  if (ballId) f.ballId = ballId;
  if (Array.isArray(raw.ids)) f.ids = raw.ids.slice(0, 12).map(cleanPlayId).filter(Boolean);
  if (isNum(raw.n) && raw.n >= 5 && raw.n <= 8) f.n = Math.trunc(raw.n);
  if (PHASES.includes(raw.phase)) f.phase = raw.phase;
  if (WINNERS.includes(raw.winner)) f.winner = raw.winner;
  if (raw.team === 0 || raw.team === 1) f.team = raw.team;
  if (raw.why === 'catch' || raw.why === 'cheer') f.why = raw.why;
  if (Array.isArray(raw.spots)) {
    f.spots = [];
    for (const s of raw.spots.slice(0, 10)) {
      const x = isObj(s) ? cleanNum(s.x) : undefined;
      const z = isObj(s) ? cleanNum(s.z) : undefined;
      if (x !== undefined && z !== undefined) f.spots.push({ x, z });
    }
  }
  if (f.type === 'teleport' && (!f.id || f.x === undefined || f.z === undefined)) return null;
  return f;
}

/** An fx batch event: { g: gameId, f: [fx] }. */
export function cleanBatch(data) {
  if (!isObj(data) || typeof data.g !== 'string' || !/^[a-z0-9]{1,12}$/.test(data.g) || !Array.isArray(data.f)) return null;
  const f = [];
  for (const raw of data.f.slice(0, 64)) {
    const c = cleanFx(raw);
    if (c) f.push(c);
  }
  return { g: data.g, f };
}

/** The host plays every fx itself; only these go to the others (a bot's teleport is the host's business). */
export function shareFx(fx, isBot) {
  if (!isObj(fx) || typeof fx.type !== 'string') return false;
  if (fx.type === 'teleport') return !isBot;
  if (fx.type === 'join' || fx.type === 'leave') return !isBot;
  return true;
}

function jsonLen(v) {
  try {
    return JSON.stringify(v).length;
  } catch (err) {
    return Infinity;
  }
}

/**
 * Fx batches for the network: each { g, f } stays under maxLen characters of JSON (net events
 * are at most 1 KB). An fx too big alone loses its id list (the state has the winners anyway).
 */
export function packFx(list, gid, maxLen = 900) {
  const out = [];
  const head = jsonLen({ g: gid, f: [] });
  let cur = [];
  let len = head;
  for (const fx0 of Array.isArray(list) ? list : []) {
    let fx = fx0;
    let n = jsonLen(fx);
    if (head + n > maxLen && Array.isArray(fx.ids)) {
      fx = Object.assign({}, fx, { ids: fx.ids.slice(0, 2) });
      n = jsonLen(fx);
    }
    if (head + n > maxLen) continue; // still too big: drop it rather than lose the batch
    if (cur.length && len + n + 1 > maxLen) {
      out.push({ g: gid, f: cur });
      cur = [];
      len = head;
    }
    cur.push(fx);
    len += n + (cur.length > 1 ? 1 : 0);
  }
  if (cur.length) out.push({ g: gid, f: cur });
  return out;
}

/**
 * The host's fx outbox. net events are rate limited (a bucket of 20, 8 a second), so fx are
 * gathered and sent as one batch every `gapMs`; a batch the net refuses waits for the next try.
 */
export function createOutbox({ send, gapMs = 150, maxLen = 900, maxQueue = 48 } = {}) {
  let queue = [];
  let lastAt = -Infinity;
  return {
    push(fx) {
      queue.push(fx);
      if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
    },
    flush(now, gid, force = false) {
      if (!queue.length || (!force && now - lastAt < gapMs)) return 0;
      lastAt = now;
      let sent = 0;
      for (const batch of packFx(queue, gid, maxLen)) {
        let ok = false;
        try {
          ok = send(batch) !== false;
        } catch (err) {
          ok = false;
        }
        if (!ok) break;
        sent += batch.f.length;
      }
      // what packFx dropped as too big is gone either way; what wasn't sent waits
      if (sent > 0) queue = queue.slice(sent);
      return sent;
    },
    clear() {
      queue = [];
    },
    get size() {
      return queue.length;
    },
  };
}

// ------------------------------------------------------------------------------------ music, splashes, anims

/** The music for a moment of a game: seeking in hide and seek is tense, results are a victory sting. */
export function musicFor(kind, phase, o = {}) {
  if (o.spectator) return 'island';
  if (phase === 'results') return 'victory';
  if (phase === 'play' && kind === 'hideSeek') return 'tense';
  return 'game';
}

/** The centre splash for a game.ui() result. The seeker's count shows on the blindfold instead. */
export function splashFor(u) {
  if (!isObj(u) || !isObj(u.big) || u.blind) return null;
  const text = typeof u.big.text === 'string' ? u.big.text : '';
  if (!text) return null;
  const sub = typeof u.big.sub === 'string' ? u.big.sub : '';
  const ms = u.phase === 'countdown' ? 640 : u.phase === 'results' ? 3800 : 1500;
  return { key: `${u.round}|${u.phase}|${text}|${sub}`, text, sub, ms };
}

const ONE_SHOT = new Set(['throw', 'catch', 'dodge', 'tagged', 'aww']);

/** Seconds a bot keeps a one-shot reaction on screen (the brain asks for it for one frame only). */
export function holdAnim(anim) {
  if (anim === 'throw') return 0.62;
  if (anim === 'catch') return 0.55;
  if (anim === 'dodge') return 0.5;
  if (anim === 'tagged' || anim === 'aww') return 0.7;
  return 0;
}

export function isOneShot(anim) {
  return ONE_SHOT.has(anim);
}

/**
 * What the local cheerleader has to play, from game.who(): `anim` wins (frozen pose, counting,
 * bench cheer, countdown clap, results celebration), then `pose` while standing still (the
 * hiding crouch). A short reaction of her own (a throw) is left alone. null = walk and idle as usual.
 */
export function forcedAnim(w, { still = true, react = false } = {}) {
  if (!isObj(w) || react) return null;
  if (typeof w.anim === 'string' && w.anim) return w.anim;
  if (still && typeof w.pose === 'string' && w.pose) return w.pose;
  return null;
}

// ------------------------------------------------------------------------------------ words

const TEAM_GAMES = new Set(['dodgeball', 'captureBow']);

/**
 * A hype line (Contract 8) for this player, from an fx: lines talk to the player whose screen
 * shows them, so the same fx is "found" for the seeker and "gotFound" for the hider.
 * info: { kind, name(id), teamOf(id), seekerName }
 */
export function hypeFor(fx, me, info = {}) {
  if (!isObj(fx) || !me) return null;
  const name = typeof info.name === 'function' ? info.name : () => '';
  const teamOf = typeof info.teamOf === 'function' ? info.teamOf : () => null;
  const [a, b] = Array.isArray(fx.ids) ? fx.ids : [];
  const game = info.kind || '';
  switch (fx.type) {
    case 'found':
      if (a === me) return { situation: 'found', ctx: { target: name(b) } };
      if (b === me) return { situation: 'gotFound', ctx: { seeker: name(a) } };
      return null;
    case 'freeze':
      if (b === me) return { situation: 'freeze', ctx: { tagger: name(a) } };
      if (a === me) return { situation: 'tag', ctx: { target: name(b) } };
      return null;
    case 'unfreeze':
      if (a === me) return { situation: 'unfreeze', ctx: { target: name(b) } };
      if (b === me) return { situation: 'unfrozen', ctx: { friend: name(a) } };
      return null;
    case 'hit':
      if (b === me) return { situation: 'hit', ctx: {} };
      if (a === me) return { situation: 'hitThem', ctx: { target: name(b) } };
      return null;
    case 'catch':
      return a === me ? { situation: 'catch', ctx: {} } : null;
    case 'bowGrab':
      if (a === me) return { situation: 'grab', ctx: { team: fx.team } };
      if (fx.team !== undefined && teamOf(me) === fx.team) return { situation: 'bowTaken', ctx: { target: name(a) } };
      return null;
    case 'score':
      if (a === me || (fx.team !== undefined && teamOf(me) === fx.team)) return { situation: 'score', ctx: { team: fx.team, name: name(a) } };
      return null;
    case 'newIt':
      return fx.id === me ? { situation: 'it', ctx: {} } : null;
    case 'newSeeker':
      return fx.id === me ? { situation: 'seeker', ctx: {} } : null;
    case 'win': {
      const ids = Array.isArray(fx.ids) ? fx.ids : [];
      if (fx.winner === 'none' || fx.winner === undefined) return null;
      if (fx.winner === 'tie') return { situation: 'tie', ctx: { game } };
      const team = fx.winner === 0 || fx.winner === 1 ? fx.winner : undefined;
      if (ids.includes(me) || (team !== undefined && teamOf(me) === team)) return { situation: 'win', ctx: team !== undefined ? { team, game } : { game } };
      return { situation: 'lose', ctx: team !== undefined ? { team, game } : { game } };
    }
    case 'phase':
      if (game === 'hideSeek' && fx.phase === 'hide') {
        return info.isSeeker ? { situation: 'seeker', ctx: {} } : { situation: 'hiding', ctx: info.seekerName ? { seeker: info.seekerName } : {} };
      }
      if (game === 'freezeTag' && fx.phase === 'play' && info.isIt) return { situation: 'it', ctx: {} };
      return null;
    default:
      return null;
  }
}

const BIG_NEWS = new Set(['score', 'bowGrab', 'save', 'newSeeker', 'newIt', 'switch', 'hint', 'bowDrop']);
const QUIET = new Set(['phase', 'count', 'teleport', 'join', 'leave', 'bounce', 'pickup', 'throw']);

/**
 * How much a toast for this fx matters to this player: 2 = always (it is about me, or big news),
 * 1 = only when no toast showed a moment ago, 0 = never (the splash or a sound says it already).
 */
export function toastPriority(fx, me, info = {}) {
  if (!isObj(fx) || typeof fx.type !== 'string' || QUIET.has(fx.type)) return 0;
  if (fx.type === 'back') return fx.id === me ? 0 : 1; // my "Back in!" splash says it already
  if (fx.type === 'win') return 2;
  const ids = Array.isArray(fx.ids) ? fx.ids : [];
  if ((me && (ids.includes(me) || fx.id === me)) || BIG_NEWS.has(fx.type)) return 2;
  if (TEAM_GAMES.has(info.kind) && fx.team !== undefined && typeof info.teamOf === 'function' && info.teamOf(me) === fx.team) return 2;
  return 1;
}

const C = {
  pink: '#ff2e93', purple: '#7b5cff', gold: '#ffd36e', white: '#fff8fc', silver: '#eae8f2', mint: '#9be7c4',
  baby: '#9fd8ff', coral: '#ff8a8a', gemPink: '#ff7ad1', gemPurple: '#a96bff', lemon: '#ffe68a',
};

/** Sparkle burst colours and size per fx type (team fx use the team's colour). */
export function burstStyle(fx, teamColors = [C.pink, C.purple]) {
  if (!isObj(fx)) return null;
  const team = fx.team === 0 || fx.team === 1 ? teamColors[fx.team] : null;
  switch (fx.type) {
    case 'found': return { count: 34, colors: [C.gold, C.gemPink, C.white, C.lemon], size: 0.55, speed: 5 };
    case 'freeze': return { count: 30, colors: [C.baby, C.white, C.silver], size: 0.5, speed: 4 };
    case 'unfreeze':
    case 'melt': return { count: 28, colors: [C.mint, C.white, C.baby, C.gold], size: 0.5, speed: 4.5 };
    case 'hit': return { count: 26, colors: [C.coral, C.gemPink, C.white], size: 0.5, speed: 5 };
    case 'catch': return { count: 36, colors: [C.gold, C.mint, C.white, C.gemPurple], size: 0.55, speed: 5.5 };
    case 'tagged': return { count: 22, colors: [C.gemPink, C.white, C.gemPurple], size: 0.45, speed: 4 };
    case 'bowGrab':
    case 'save': return { count: 34, colors: [team || C.pink, C.gold, C.white], size: 0.55, speed: 5 };
    case 'score': return { count: 60, colors: [team || C.pink, C.gold, C.white, C.silver], size: 0.7, speed: 7 };
    case 'win': return { count: 44, colors: [C.gemPink, C.gemPurple, C.silver, C.gold, C.mint], size: 0.65, speed: 6.5 };
    default: return fx.burst ? { count: 26 } : null;
  }
}

/**
 * Auto-aim: the closest opponent, strongly preferring the ones in front of the thrower.
 * opponents: [{ id, x, z }]. heading: radians, 0 faces +Z.
 */
export function pickAim(me, heading, opponents) {
  if (!isObj(me) || !Array.isArray(opponents)) return null;
  let best = null;
  let bestScore = Infinity;
  for (const o of opponents) {
    if (!isObj(o) || !isNum(o.x) || !isNum(o.z)) continue;
    const dx = o.x - me.x;
    const dz = o.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) continue;
    let ang = Math.atan2(dx, dz) - (isNum(heading) ? heading : 0);
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const score = d * (1 + Math.abs(ang) * 1.4);
    if (score < bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  return best;
}

/**
 * A short scoreboard for small screens: the leaders, and always this player. rows come sorted
 * (best first) from game.ui(); team scoreboards (two rows) are left alone. Returns a new object.
 */
export function trimBoard(board, max = 3) {
  if (!isObj(board) || !Array.isArray(board.rows) || board.rows.length <= max) return board;
  const rows = board.rows.slice(0, Math.max(1, max));
  if (!rows.some((r) => r && r.me)) {
    const mine = board.rows.find((r) => r && r.me);
    if (mine) rows[rows.length - 1] = mine;
  }
  return Object.assign({}, board, { rows });
}

const TEAM_TAGS = [
  { color: TEAMS[0].color, ink: PALETTE.white, icon: 'heart' }, // Team Pink: the heart on the court's scoreboard
  { color: TEAMS[1].color, ink: PALETTE.white, icon: 'star' }, // Team Purple: the star
];

/**
 * The name tag for a role, from game.who(): team colours in the team games (a bow icon on the
 * carrier, lilac on the bench), coral with a star for "it", baby blue with a snowflake when frozen,
 * gold with an eye for the seeker, mint with a sparkle for found helpers. null: the normal tag.
 */
export function tagStyle(kind, w) {
  if (!isObj(w)) return null;
  if (kind === 'dodgeball' || kind === 'captureBow') {
    if (w.team !== 0 && w.team !== 1) return null;
    const base = TEAM_TAGS[w.team];
    if (w.role === 'out') return { color: PALETTE.lilac, ink: PALETTE.ink, icon: base.icon };
    if (w.carrying === 'bow0' || w.carrying === 'bow1') return { color: base.color, ink: base.ink, icon: 'bow' };
    return { color: base.color, ink: base.ink, icon: base.icon };
  }
  if (kind === 'freezeTag') {
    if (w.role === 'it') return { color: PALETTE.coral, ink: PALETTE.ink, icon: 'star' };
    if (w.role === 'frozen') return { color: PALETTE.babyBlue, ink: PALETTE.ink, icon: 'snow' };
    return null;
  }
  if (kind === 'hideSeek') {
    if (w.role === 'seeker') return { color: PALETTE.gold, ink: PALETTE.ink, icon: 'eye' };
    if (w.role === 'found') return { color: PALETTE.mint, ink: PALETTE.ink, icon: 'sparkle' };
  }
  return null;
}

/** The game's clock: the shared clock, or (solo tests) one that runs `speed` times faster from t0. */
export function gameClock(base, speed = 1, t0 = null) {
  if (!(speed > 1)) return base;
  const start = isNum(t0) ? t0 : base();
  return () => start + (base() - start) * speed;
}

export function isTeamGame(kind) {
  return TEAM_GAMES.has(kind);
}

/** Every other line this layer shows. Hype and sweet, never mean (the tests check the house rules). */
export const COPY = Object.freeze({
  getReady: 'Get ready! Here we go...',
  squadReady: 'Your squad is getting ready!',
  squadPlaying: 'Your squad is playing! Want to join in?',
  noPeeking: 'No peeking!',
  eyesClosed: 'Eyes closed. Everyone is hiding!',
  again: 'Play again!',
  join: 'Join the game!',
  leaveGame: 'Leave game',
  leave: 'Leave',
  endGame: 'End game',
  yourAward: 'Your award',
  squadAwards: 'Squad awards',
  watching: 'Cheering from the sideline!',
});

/** The words on the leave / end card. Nobody leaves in shame: it is always "see you on the island". */
export function leaveCopy({ solo = false, host = false } = {}) {
  if (!solo && host) {
    return {
      kicker: 'End the game?',
      title: 'End it for everyone?',
      lines: ['Everybody goes back to exploring the island. You can pick another game any time!'],
      yes: 'End game',
      no: 'Keep playing',
    };
  }
  if (solo) {
    return {
      kicker: 'Leave the game?',
      title: 'Back to the island?',
      lines: ['Your bot friends will wave bye. You can play again any time!'],
      yes: 'Leave game',
      no: 'Keep playing',
    };
  }
  return {
    kicker: 'Leave the game?',
    title: 'Take a break?',
    lines: ['Your squad keeps playing. Tap Join to hop back in!'],
    yes: 'Leave game',
    no: 'Keep playing',
  };
}
