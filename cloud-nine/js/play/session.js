// One game on this device (PLAY): the host's loop, or a client's mirror of the host's game, plus
// everything this device draws and plays for it. Rules and bot brains are the GAMES part
// (js/games/, Contract 5); this file runs them in the world.
//
//   const s = createSession(world, { kind, host, solo, startId, switches, props, overlay, tags, state })
//       state: a client's first copy of the host's shared state (or later, through adopt)
//   s.update(dt, t)          every frame (world.onUpdate)
//   s.adopt(state) -> bool   clients: the host's shared state (net 'game')
//   s.remoteFx(batch)        clients: a cleaned fx batch from the host (net 'fx')
//   s.claim(from, data)      host: a claim from another device (net 'claim')
//   s.join(id) / s.left(id)  host: someone came into the room / went away
//   s.becomeHost() / s.becomeClient()     the room's host changed
//   s.leaveGame() / s.joinGame()          this player steps out of the game (and back in)
//   s.startNow()             host: the next round now ("Play again!")
//   s.finishRound()          host: this round's results now (tests and dev)
//   s.pause() / s.resume()   solo: the tab went to the background and came back (game time waits)
//   s.now()                  the game's clock (ms since the epoch: what every time in the state uses)
//   s.end({ remote, keepBots }) finish: the host tells everyone (unless remote), bots go home
//   s.kind, s.gid, s.isHost, s.inGame, s.game, s.ended, s.info() (tests)
//   epochOf(state, netNow) -> ms      the host's epoch from a shared state (exported for clients)
//
// Host, every frame: positions -> every bot through driveBot (then out of solid things and onto
// the ground) -> my own claims -> game.host.tick -> fx played here and batched to the others ->
// net.setGame when seq changed (10 Hz). Everyone: who() for poses, glows and name tags, the
// props, the HUD (10 Hz), the music.
//
// The game's clock is the shared clock minus an epoch the host picks when the game begins, so every
// time in the shared state is a small number (milliseconds since that epoch): the net refused
// numbers over 1e9 when this was written, and small numbers keep the state compact anyway. The
// epoch itself travels next to the state as a string ({ ...state, epoch }).

import { createGame, ballPos } from '../games/index.js';
import { driveBot } from '../games/sim.js';
import { toLocal, toWorld } from '../games/common.js';
import { PALETTE, TEAMS } from '../config.js';
import { angleDelta } from '../core/util.js';
import {
  musicFor, splashFor, forcedAnim, hypeFor, toastPriority, burstStyle, pickAim, holdAnim, isOneShot,
  gameClock, gameSettings, soloBots, shareFx, createOutbox, isTeamGame, trimBoard, tagStyle, COPY,
} from './logic.js';

const BOT_R = 0.4; // a bot's body against hedges and walls
const START_DELAY_MS = 1300; // "Dodgeball! Get ready!" stays up for a moment before the count
const SHARE_MS = 100; // the shared game state, at most 10 times a second
const UI_MS = 100;
const ROLE_MS = 120;
const HEAL_DIST = 6; // further than this from where the game wants me: fly me there
const COUNT_PITCH = [1, 1.06, 1.12, 1.26];
const SIDELINE = 1.4; // m outside the arena: where a friend who isn't playing watches from
const NUDGE_SPEED = 9; // m/s: a little quicker than running, so the field stays clear
const SPLASH_GAP_MS = 1700; // a toast about me waits for my own splash ("Found you!", "Bonk!") to go
const WIN_TOAST_MS = 4200; // the win or "so close" line comes once the big results splash has gone
const AWARDS_AFTER_MS = 4000; // the awards card follows the results splash (3.8 s) once it has gone
const DODGE_NEAR = 1.5; // m: a ball passing this close (but missing) is a dodge
const ACTIVE = new Set(['countdown', 'hide', 'play']);
const TOAST_ICON = { hideSeek: 'eyes', freezeTag: 'snow', dodgeball: 'ball', captureBow: 'bow' };
const LOCO = new Set(['idle', 'walk', 'run']);
const POSITIONAL = new Set(['bounce', 'throw', 'tap', 'pop', 'catch', 'hit', 'freeze', 'unfreeze', 'found', 'bowGrab']);
const RAINBOW = [PALETTE.rhinestonePink, PALETTE.rhinestonePurple, PALETTE.rhinestoneSilver, PALETTE.gold, PALETTE.mint, PALETTE.babyBlue];

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The host's epoch from a shared state (a string of milliseconds). A state without one (or a
// silly one) gets an epoch that puts its phase start a moment ago.
export function epochOf(state, netNow) {
  const e = state && typeof state.epoch === 'string' && /^\d{1,15}$/.test(state.epoch) ? Number(state.epoch) : NaN;
  if (Number.isFinite(e) && Math.abs(netNow - e) < 9e8) return e;
  const started = state && Number.isFinite(state.phaseStarted) ? state.phaseStarted : 0;
  return Math.floor(netNow) - started - 500;
}

export function createSession(world, opts) {
  const { net, player, hud, peers } = world;
  const audio = world.audio;
  const colliders = world.colliders || null;
  const props = opts.props;
  const overlay = opts.overlay;
  const tags = opts.tags;
  const kind = opts.kind;
  const solo = !!opts.solo;
  const sw = opts.switches || {};
  const appSession = world.session;
  let isHost = !!opts.host;
  let shared = !solo; // a room: other devices need the state and the fx
  const speed = solo && isHost && sw.speed > 1 ? sw.speed : 1;
  let epoch = isHost ? Math.floor(net.now()) - 5000 : epochOf(opts.state, net.now());
  const clock = gameClock(() => net.now() - epoch, speed);
  const meId = () => (net.me && net.me.id) || 'me';

  let game = null;
  let gid = null;
  let ended = false;
  let startAt = 0; // host: when to start round 1
  let lastSeq = -1;
  let lastShareAt = -Infinity;
  let uiAt = 0;
  let roleAt = 0;
  let lastSplash = '';
  let lastMusic = null;
  let musicAt = 0;
  let lastPhaseKey = '';
  let lastToastAt = -Infinity;
  let forced = null; // the anim this layer made my cheerleader play
  let reactUntil = 0; // my own one-shot (throw, catch) is on screen until then
  let teleporting = false;
  let teleportSafety = 0;
  let healAt = 0;
  let promptLabel = null;
  let promptId = null;
  let clearPrompt = null;
  let teleportTo = null; // where a teleport in progress is taking me
  let phaseKey = '';
  let phaseAt = 0; // when this device saw the phase change
  let frozenSet = false;
  let lastX = player.position.x;
  let lastZ = player.position.z;
  let myW = null;
  let celebrated = '';
  let blindLine = ''; // the seeker's hype line, on the blindfold
  let peek = null; // easing the camera round to the open side of a hiding spot
  let pausedAt = 0; // solo: game time stands still while the tab is hidden
  let wasHidden = false;
  let pendingFx = []; // clients: fx that arrived before the state did
  let phaseSeenAt = 0; // when the HUD saw this phase begin (the awards card waits for the splash)
  let nudged = false; // a friend watching was walked to the sideline (told once per game)
  const dodged = new Set(); // ball throws I already dodged (dodgeball)
  const optedOut = new Set(); // host: players who stepped out of this game
  const bodies = new Map(); // host: bot id -> body
  const cache = new Map(); // id -> { x, z } this frame
  const timeline = []; // [{ at, fn }] little scheduled moments (hint puffs, fireworks)
  const lit = new Map(); // character -> highlight key
  const touched = new Set(); // peer ids whose name tag this layer changed (role tag, or hidden)
  const seenChars = new Set(); // scratch sets for the roles pass (reused, no garbage)
  const tagNow = new Set();
  const probe = { x: 0, z: 0 };
  const outbox = createOutbox({ send: (batch) => net.send('fx', batch) });

  const view = {
    pos: (id) => cache.get(id) || null,
    ids: () => (game ? game.state.order : []),
    // hedges, walls, tents and open sky: bots walk round them instead of bumping along them
    solid: (x, z) => (colliders ? colliders.hits(x, z, BOT_R + 0.05) : false) || !Number.isFinite(groundAt(x, z)),
  };

  // ---------------------------------------------------------------- small helpers
  const groundAt = (x, z) => {
    const y = world.groundAt(x, z);
    return Number.isFinite(y) ? y : -Infinity;
  };
  const groundOr = (x, z, d = 0) => {
    const y = groundAt(x, z);
    return Number.isFinite(y) ? y : d;
  };
  const sfx = (name, o) => {
    try {
      audio.sfx(name, o);
    } catch (err) { /* sound is a bonus */ }
  };
  const burst = (x, y, z, o) => {
    try {
      world.spawnBurst(x, y, z, o);
    } catch (err) { /* sparkles are a bonus */ }
  };
  const toast = (text, ms) => {
    if (!text) return;
    try {
      hud.toast(text, { icon: TOAST_ICON[kind] || 'sparkle', ms: ms || 2800 });
    } catch (err) { /* fine */ }
  };
  const hypeLine = (situation, ctx) => {
    try {
      const c = Object.assign({ name: world.nick }, ctx || {});
      return world.content && typeof world.content.hype === 'function' ? world.content.hype(situation, c) : '';
    } catch (err) {
      return '';
    }
  };
  const at = (ms, fn) => {
    if (timeline.length < 64) timeline.push({ at: nowMs() + ms, fn });
  };
  const P = (id) => (game && game.state.players && Object.prototype.hasOwnProperty.call(game.state.players, id) ? game.state.players[id] : null);
  const nameOf = (id) => {
    const p = P(id);
    return p && p.nick ? p.nick : 'A friend';
  };
  const teamOf = (id) => {
    const p = P(id);
    return p && (p.team === 0 || p.team === 1) ? p.team : null;
  };
  const isBot = (id) => {
    const p = P(id);
    if (p) return !!p.bot;
    const q = net.players.get(id);
    return !!(q && q.bot);
  };
  function charOf(id) {
    if (id === meId()) return player.avatar || null;
    const e = peers && peers.get ? peers.get(id) : null;
    return e && e.group && e.group.visible ? e.character : null;
  }
  const posOf = (id) => cache.get(id) || null;

  // ---------------------------------------------------------------- positions this frame
  function refresh(netNow) {
    const me = meId();
    for (const id of game.state.order) {
      if (id === me) {
        let c = cache.get(id);
        if (!c || c === bodies.get(id)) cache.set(id, (c = { x: 0, z: 0 }));
        c.x = player.position.x;
        c.z = player.position.z;
      } else if (isHost && bodies.has(id)) {
        cache.set(id, bodies.get(id));
      } else {
        let s = null;
        try {
          s = net.stateOf(id, netNow);
        } catch (err) {
          s = null;
        }
        if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) {
          let c = cache.get(id);
          if (!c || bodies.get(id) === c) cache.set(id, (c = { x: 0, z: 0 }));
          c.x = s.x;
          c.z = s.z;
        } else cache.delete(id);
      }
    }
    if (cache.size > game.state.order.length + 4) {
      for (const id of [...cache.keys()]) if (!P(id)) cache.delete(id);
    }
  }

  // ---------------------------------------------------------------- the host's bots
  function bodyFor(id) {
    let b = bodies.get(id);
    if (b) return b;
    const s = game.spawnFor(id);
    const f = game.arena.area.f;
    const x = s ? s.x : f.x;
    const z = s ? s.z : f.z;
    b = { x, z, y: groundOr(x, z), h: s ? s.facing || 0 : 0, vx: 0, vz: 0, anim: 'idle', hold: null, holdUntil: 0, out: { x, y: 0, z, h: 0, anim: 'idle' } };
    bodies.set(id, b);
    return b;
  }

  function driveBots(dt) {
    const dtG = Math.min(0.1, dt) * speed;
    const wall = nowMs();
    for (const id of game.state.order) {
      const p = P(id);
      if (!p || !p.bot || !net.players.has(id)) continue;
      const b = bodyFor(id);
      const px = b.x;
      const pz = b.z;
      let claim = null;
      try {
        claim = driveBot(game, id, b, view, dtG);
      } catch (err) {
        claim = null;
      }
      // around hedges, tents and walls (the brains don't see them; they sidestep when stuck)
      probe.x = b.x;
      probe.z = b.z;
      if (colliders) colliders.resolve(probe, BOT_R);
      const c = game.confine(id, probe.x, probe.z);
      const gy = groundAt(c.x, c.z);
      if (Number.isFinite(gy)) {
        b.x = c.x;
        b.z = c.z;
        b.y = gy;
      } else {
        b.x = px; // never a step into open sky
        b.z = pz;
      }
      // the brain asks for a throw or a catch for one frame: keep it on screen long enough to see
      if (isOneShot(b.anim) && b.hold !== b.anim) {
        b.hold = b.anim;
        b.holdUntil = wall + holdAnim(b.anim) * 1000;
      }
      let shown = b.anim;
      if (b.hold && wall < b.holdUntil && (LOCO.has(b.anim) || b.anim === b.hold)) shown = b.hold;
      else if (wall >= b.holdUntil) b.hold = null;
      if (claim) game.host.claim(id, claim, view);
      b.out.x = b.x;
      b.out.y = b.y;
      b.out.z = b.z;
      b.out.h = b.h;
      b.out.anim = shown;
      net.sendStateFor(id, b.out);
      // draw it where it is now (the net's copy for my own bots is a frame old)
      const e = peers && peers.get ? peers.get(id) : null;
      if (e && e.group && e.group.visible) e.group.position.set(b.x, b.y, b.z);
    }
  }

  // ---------------------------------------------------------------- me
  function sendClaim(c) {
    if (!c || !game) return;
    if (isHost) game.host.claim(meId(), c, view);
    else net.send('claim', c);
  }

  function setForced(want) {
    if (want === forced) return;
    if (want) {
      player.setAnim(want, { seconds: 600, loop: game && game.state.phase === 'results' ? true : undefined });
    } else if (forced && player.anim === forced) {
      player.setAnim('idle', { seconds: 0.01 }); // back to walking and idling as usual
    }
    forced = want;
  }

  function react(anim, seconds) {
    reactUntil = nowMs() + seconds * 1000;
    forced = null;
    try {
      player.setAnim(anim, { seconds, loop: false });
    } catch (err) { /* fine */ }
  }

  function teleportMe(x, z, facing) {
    const pp = player.position;
    // already there, or already on the way there (a heal and the host's teleport can cross)
    if (teleporting && teleportTo && Math.hypot(teleportTo.x - x, teleportTo.z - z) < 1) return;
    if (!teleporting && Math.hypot(pp.x - x, pp.z - z) < 0.6) return;
    teleportTo = { x, z };
    if (world.toss && world.toss.active && typeof world.toss.cancel === 'function') {
      try {
        world.toss.cancel();
      } catch (err) { /* it lets go anyway */ }
    }
    teleporting = true;
    teleportSafety = nowMs() + 1500;
    let p = null;
    try {
      p = player.teleport(x, z, Number.isFinite(facing) ? facing : player.heading);
    } catch (err) {
      p = null;
    }
    const done = () => {
      teleporting = false;
      teleportTo = null;
      lastX = player.position.x;
      lastZ = player.position.z;
    };
    if (p && typeof p.then === 'function') p.then(done, done);
    else done();
  }

  function releaseMe() {
    if (frozenSet && world.mode === 'play') player.frozen = false;
    frozenSet = false;
    setForced(null);
    myW = null;
    setAction(null);
    overlay.setBlind(false);
  }

  // Tucked into a hiding spot, she turns to peek toward the seeker over her cover, and the camera
  // eases round behind her, to the open side (once; dragging the view takes over at once).
  function peekFrame(w, still, dt) {
    const rig = world.rig;
    const hidden = !!(w.hidden && still);
    if (hidden && !wasHidden && rig && game.arena.start) {
      const s = game.arena.start;
      const pp = player.position;
      const face = Math.atan2(s.x - pp.x, s.z - pp.z);
      player.heading = face;
      peek = { target: face + Math.PI, until: nowMs() + 1400, last: rig.yaw };
    }
    wasHidden = hidden;
    if (!peek || !rig) return;
    // the view turned away from where we are going: she is looking around herself
    const moved = angleDelta(peek.last, rig.yaw);
    const away = Math.abs(moved) > 0.03 && Math.sign(moved) !== Math.sign(angleDelta(peek.last, peek.target));
    if (!hidden || nowMs() > peek.until || away) {
      peek = null;
      return;
    }
    rig.yaw += angleDelta(rig.yaw, peek.target) * (1 - Math.exp(-3.5 * Math.min(0.1, dt)));
    peek.last = rig.yaw;
  }

  function localFrame(now, dt = 0) {
    const me = meId();
    const p = P(me);
    if (!p) {
      releaseMe();
      sideline(dt);
      return;
    }
    const pp = player.position;
    const w = game.who(me, pp);
    myW = w;
    if (kind === 'dodgeball') dodgeFrame(now);
    const st = game.state;
    if (teleporting && nowMs() > teleportSafety) teleporting = false;
    const pk = st.round + '|' + st.phase;
    if (pk !== phaseKey) {
      phaseKey = pk;
      phaseAt = nowMs();
    }
    // stand still while the rules say so (counting, frozen, the bench, the countdown, results)
    if (world.mode === 'play' && !player.controller) {
      const want = !w.canMove;
      if (player.frozen !== want) player.frozen = want;
      frozenSet = want;
    }
    const preStart = st.phase === 'lobby' && st.round === 1;
    if (!preStart && !teleporting && !player.controller && !player.rescuing) {
      // "it" in freeze tag runs a little quicker: stretch this frame's step
      if (w.speed > 1.001 && w.canMove && player.grounded) {
        const dx = pp.x - lastX;
        const dz = pp.z - lastZ;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4 && d < 1) {
          probe.x = pp.x + dx * (w.speed - 1);
          probe.z = pp.z + dz * (w.speed - 1);
          if (colliders) colliders.resolve(probe, 0.42);
          if (Number.isFinite(groundAt(probe.x, probe.z))) {
            pp.x = probe.x;
            pp.z = probe.z;
          }
        }
      }
      // in bounds: the arena, my half of the court, the bench
      const k = game.confine(me, pp.x, pp.z);
      const off = Math.hypot(k.x - pp.x, k.z - pp.z);
      if (off > HEAL_DIST) {
        // far from the game (a teleport that never arrived, a late join): fly there, after a
        // moment for the host's own teleport to land first
        if (nowMs() > healAt && nowMs() - phaseAt > 900) {
          healAt = nowMs() + 2500;
          const s = game.spawnFor(me);
          if (s) teleportMe(s.x, s.z, benchFacing(s));
        }
      } else if (off > 1e-4 && Number.isFinite(groundAt(k.x, k.z))) {
        pp.x = k.x;
        pp.z = k.z;
      }
    }
    lastX = pp.x;
    lastZ = pp.z;
    // poses: frozen, counting, the bench cheer, the hiding crouch, the celebration
    const still = player.speed < 0.4;
    setForced(forcedAnim(w, { still, react: nowMs() < reactUntil }));
    if (kind === 'hideSeek') peekFrame(w, still, dt);
    // touch claims: found, tag, unfreeze, pickup, hit or catch, grab, score
    const claim = game.autoClaim(me, view, now);
    if (claim) sendClaim(claim);
  }

  // A friend who isn't in this game (stepped out, or the round is full) watches from the sideline:
  // walking onto the field she is eased back off it, so nobody trips over a spectator.
  function sideline(dt) {
    if (world.mode !== 'play' || !ACTIVE.has(game.state.phase) || teleporting || player.controller || player.rescuing) return;
    const a = game.arena.area;
    const pp = player.position;
    const l = toLocal(a.f, pp.x, pp.z);
    const ex = a.hw + SIDELINE - Math.abs(l.x);
    const ez = a.hd + SIDELINE - Math.abs(l.z);
    if (ex <= 0 || ez <= 0) return;
    const step = NUDGE_SPEED * Math.min(0.25, Math.max(0.016, dt || 0));
    // out across the nearer edge (or the other one when that side is open sky)
    const tries = ex < ez ? [0, 1] : [1, 0];
    for (const axis of tries) {
      const lx = axis === 0 ? l.x + Math.sign(l.x || 1) * Math.min(ex, step) : l.x;
      const lz = axis === 1 ? l.z + Math.sign(l.z || 1) * Math.min(ez, step) : l.z;
      const q = toWorld(a.f, lx, lz);
      if (!Number.isFinite(groundAt(q.x, q.z))) continue;
      pp.x = q.x;
      pp.z = q.z;
      if (!nudged) {
        nudged = true;
        toast(COPY.watching);
      }
      return;
    }
  }

  // Dodgeball: a ball from the other team whizzing past (close, but missing) makes her dodge.
  function dodgeFrame(now) {
    const st = game.state;
    const mine = P(meId());
    if (st.phase !== 'play' || !mine || mine.out || !Array.isArray(st.balls) || nowMs() < reactUntil) return;
    const pp = player.position;
    for (const b of st.balls) {
      const fl = b.fl;
      if (b.s !== 'air' || !fl || fl.done || fl.team === mine.team) continue;
      const key = b.id + ':' + fl.t0;
      if (dodged.has(key)) continue;
      let min = Infinity;
      for (let k = 0; k <= 4; k++) {
        const q = ballPos(b, now + k * 60);
        if (q && q.y < 2.2) min = Math.min(min, Math.hypot(q.x - pp.x, q.z - pp.z));
      }
      if (min > 0.75 && min < DODGE_NEAR) {
        if (dodged.size > 32) dodged.clear();
        dodged.add(key);
        react('dodge', 0.5);
        if (nowMs() - lastToastAt > 2500) {
          const line = hypeLine('dodge', {});
          if (line) {
            toast(line);
            lastToastAt = nowMs();
          }
        }
        return;
      }
    }
  }

  function onAction() {
    if (!game || ended) return;
    const me = meId();
    const now = clock();
    const st = game.state;
    let aim = null;
    const mine = P(me);
    if (kind === 'dodgeball' && mine && promptId === 'throw') {
      const opp = [];
      for (const id of st.order) {
        const q = P(id);
        if (!q || q.team === mine.team || q.out) continue;
        const pos = cache.get(id);
        if (pos) opp.push({ id, x: pos.x, z: pos.z });
      }
      const target = pickAim(player.position, player.heading, opp);
      if (target) aim = { target };
    }
    const c = game.press(me, view, now, aim);
    if (promptId === 'throw') {
      if (c) {
        react('throw', 0.62);
        if (c.dir) player.heading = Math.atan2(c.dir.x, c.dir.z);
      }
    } else react('catch', 0.5);
    if (c) sendClaim(c);
  }

  function setAction(a) {
    const label = a && a.label ? a.label : null;
    promptId = a && a.id ? a.id : null;
    if (label === promptLabel) return;
    promptLabel = label;
    if (clearPrompt) {
      clearPrompt();
      clearPrompt = null;
    }
    if (label) clearPrompt = hud.prompt(label, onAction, { icon: 'ball' });
  }

  // ---------------------------------------------------------------- fx
  // The dodgeball bench is outside the sideline, right in front of the court's scoreboard sign:
  // looking straight at the court would put the camera behind the sign. Look across, diagonally.
  function benchFacing(f) {
    const a = game.arena.area;
    const l = toLocal(a.f, f.x, f.z);
    if (kind !== 'dodgeball' || Math.abs(l.x) <= a.hw) return f.facing;
    const q = toWorld(a.f, 0, (l.z < 0 ? 1 : -1) * a.hd * 0.5);
    return Math.atan2(q.x - f.x, q.z - f.z);
  }

  function teleportFx(f) {
    if (f.id === meId()) teleportMe(f.x, f.z, benchFacing(f));
    else if (isHost) {
      const b = bodies.get(f.id);
      if (b) {
        b.x = f.x;
        b.z = f.z;
        b.y = groundOr(f.x, f.z, b.y);
        if (Number.isFinite(f.facing)) b.h = f.facing;
        b.vx = 0;
        b.vz = 0;
      }
    }
  }

  function hintPuffs(spots) {
    for (const s of spots || []) {
      const y = groundOr(s.x, s.z) + 1.1;
      const puff = (count) => burst(s.x, y, s.z, { count, colors: [PALETTE.gold, PALETTE.rhinestonePink, PALETTE.white, PALETTE.lemon], size: 0.6, speed: 3.2 });
      puff(34);
      at(380, () => puff(22));
      at(760, () => puff(16));
    }
  }

  function celebrate(f) {
    const key = `${game.state.round}`;
    if (celebrated === key) return;
    celebrated = key;
    const winner = f ? f.winner : game.state.result ? game.state.result.winner : 'none';
    const ids = f && Array.isArray(f.ids) ? f.ids : game.state.result ? game.state.result.ids : [];
    const team = winner === 0 || winner === 1 ? winner : null;
    const colors = team !== null ? [TEAMS[team].color, PALETTE.gold, PALETTE.white, PALETTE.rhinestoneSilver] : RAINBOW;
    for (const id of ids.slice(0, 10)) {
      const p = posOf(id);
      if (p) burst(p.x, groundOr(p.x, p.z) + 1.6, p.z, { count: 36, colors, size: 0.6, speed: 6 });
    }
    // fireworks over the arena, and the crowd goes wild
    const a = game.arena.area;
    const fy = groundOr(a.f.x, a.f.z);
    at(150, () => sfx('cheer', { volume: 0.8 }));
    for (let k = 0; k < 6; k++) {
      at(450 + k * 520, () => {
        const rx = (Math.random() * 2 - 1) * Math.min(8, a.hw);
        const rz = (Math.random() * 2 - 1) * Math.min(8, a.hd);
        burst(a.f.x + rx, fy + 4.5 + Math.random() * 2, a.f.z + rz, { count: 48, colors: k % 2 ? colors : RAINBOW, size: 0.75, speed: 7.5 });
        sfx('firework', { volume: 0.6 });
      });
    }
    at(1400, () => sfx('crowd', { volume: 0.55 }));
  }

  const info = () => {
    const me = meId();
    const mp = P(me);
    let seekerName = '';
    if (kind === 'hideSeek') {
      for (const id of game.state.order) if (P(id).role === 'seeker' && id !== me) seekerName = nameOf(id);
    }
    return { kind, name: nameOf, teamOf, isSeeker: !!(mp && mp.role === 'seeker'), isIt: !!(mp && mp.role === 'it'), seekerName };
  };

  function playFx(f) {
    const me = meId();
    if (f.type === 'teleport') {
      teleportFx(f);
      return;
    }
    if (f.type === 'count') {
      sfx('count', { pitch: COUNT_PITCH[Math.max(0, Math.min(3, (f.n || 5) - 5))] });
      return;
    }
    if (f.type === 'hint') hintPuffs(f.spots);
    if (f.type === 'win') celebrate(f);
    if (f.sfx) {
      const near = POSITIONAL.has(f.sfx) && Number.isFinite(f.x) && Number.isFinite(f.z);
      sfx(f.sfx, near ? { x: f.x, z: f.z } : { volume: f.type === 'phase' ? 0.8 : 1 });
    }
    if (f.burst && Number.isFinite(f.x) && Number.isFinite(f.z)) {
      const style = burstStyle(f, [TEAMS[0].color, TEAMS[1].color]) || { count: 26 };
      burst(f.x, groundOr(f.x, f.z) + 1.1, f.z, style);
    }
    // words: a hype line when it is about me, the plain news when it is about others
    const inf = info();
    if (f.type === 'phase') {
      const h = P(me) ? hypeFor(f, me, inf) : null;
      // the seeker reads hers on the blindfold; everyone else gets a toast, once the
      // "Hide!" / "Go!" splash has had the screen to itself
      if (h && h.situation === 'seeker' && f.phase === 'hide') blindLine = hypeLine(h.situation, h.ctx);
      else if (h) {
        const line = hypeLine(h.situation, h.ctx);
        at(SPLASH_GAP_MS, () => toast(line));
      }
      return;
    }
    const prio = P(me) || f.type === 'win' ? toastPriority(f, me, inf) : 0;
    if (!prio) return;
    const t = nowMs();
    if (prio === 1 && t - lastToastAt < 2500) return;
    // hypeFor only answers for news that is mine (or my team's): the rest is plain news
    const h = P(me) ? hypeFor(f, me, inf) : null;
    let text = h ? hypeLine(h.situation, h.ctx) : '';
    if (!text) text = game.fxText(f, me);
    if (text) {
      // news about me that also gets a big splash ("Found you!", "Frozen!", "Bonk!", "Tagged!")
      // waits for it; the win line waits for the results splash
      const victim = Array.isArray(f.ids) && f.ids[1] === me && (f.type === 'found' || f.type === 'freeze' || f.type === 'hit' || f.type === 'tagged');
      const wait = f.type === 'win' ? WIN_TOAST_MS : victim ? SPLASH_GAP_MS : 0;
      if (wait) at(wait, () => toast(text));
      else toast(text);
      lastToastAt = t + wait;
    }
  }

  function handleHostFx(list) {
    for (const f of list) {
      if (shared && shareFx(f, isBot(f.id))) outbox.push(f);
      playFx(f);
    }
  }

  // ---------------------------------------------------------------- who looks like what
  function highlight(ch, on, color) {
    if (!ch || typeof ch.setHighlight !== 'function') return;
    const key = on ? String(color || '#ffffff') : 'off';
    if (lit.get(ch) === key) return;
    lit.set(ch, key);
    try {
      ch.setHighlight(!!on, on ? color || '#ffffff' : undefined);
    } catch (err) { /* a glow is a bonus */ }
  }

  function rolesFrame() {
    const me = meId();
    const team = isTeamGame(kind);
    const seen = seenChars;
    const now = tagNow;
    seen.clear();
    now.clear();
    for (const id of game.state.order) {
      const ch = charOf(id);
      const w = id === me ? myW || game.who(id, player.position) : game.who(id, posOf(id));
      if (ch) {
        highlight(ch, !!(w.glow || (team && w.team !== null)), w.color);
        seen.add(ch);
      }
      if (id !== me) {
        // a name tag in the role's colours; a hidden hider's tag hides
        const e = peers && peers.get ? peers.get(id) : null;
        if (e) {
          const style = tagStyle(kind, w);
          if (style) {
            style.hidden = !!w.hidden;
            tags.set(id, e, style, nameOf(id));
          } else {
            tags.set(id, e, null);
            if (e.label) e.label.visible = !w.hidden;
          }
          now.add(id);
        }
      }
      // frozen friends shimmer a little; a friend standing by to thaw them makes it sparkle up
      if (kind === 'freezeTag' && w.role === 'frozen' && game.state.phase === 'play') {
        const thawing = !!P(id).thawBy;
        if (Math.random() < (thawing ? 0.9 : 0.25)) {
          const p = posOf(id);
          if (p) {
            const colors = thawing ? [PALETTE.mint, PALETTE.white, PALETTE.gold] : [PALETTE.babyBlue, PALETTE.white];
            burst(p.x, groundOr(p.x, p.z) + 0.6 + Math.random() * 1.0, p.z, { count: thawing ? 4 : 2, size: 0.34, speed: thawing ? 2 : 1.2, colors });
          }
        }
      }
    }
    for (const ch of lit.keys()) {
      if (!seen.has(ch)) {
        highlight(ch, false);
        lit.delete(ch); // deleting the current key while iterating a Map is safe
      }
    }
    for (const id of touched) if (!now.has(id)) restoreTag(id);
    touched.clear();
    for (const id of now) touched.add(id);
  }

  function restoreTag(id) {
    const e = peers && peers.get ? peers.get(id) : null;
    tags.set(id, e, null);
    if (e && e.label) e.label.visible = true;
  }

  function clearLooks() {
    for (const ch of [...lit.keys()]) highlight(ch, false);
    lit.clear();
    for (const id of touched) restoreTag(id);
    touched.clear();
    tags.clear();
  }

  // ---------------------------------------------------------------- the HUD and the music
  function splashColor(u) {
    if (u.phase === 'results') {
      const r = game.state.result;
      if (r && (r.winner === 0 || r.winner === 1)) return TEAMS[r.winner].color;
      return PALETTE.gold;
    }
    if (u.phase === 'countdown') return PALETTE.pink;
    return u.roleBadge && u.roleBadge.color ? u.roleBadge.color : null;
  }

  function hudFrame(now) {
    const me = meId();
    const st = game.state;
    const inGame = !!P(me);
    let u;
    if (inGame) {
      u = game.ui(me, now);
      if (st.phase === 'lobby' && st.round === 1) u.line = COPY.getReady;
    } else {
      u = game.ui(null, now);
      u.roleBadge = null;
      u.big = null;
      u.action = null;
      u.blind = false;
      u.line = st.phase === 'lobby' ? COPY.squadReady : COPY.squadPlaying;
    }
    // phones: the leaders and me, so the panel leaves room for the game
    const wide = typeof window !== 'undefined' && window.innerWidth >= 560;
    u.scoreboard = trimBoard(u.scoreboard, wide ? 6 : 3);
    try {
      hud.setGameUI(u);
    } catch (err) { /* the HUD shows what it can */ }
    const sp = splashFor(u);
    if (sp && sp.key !== lastSplash) {
      try {
        hud.big(sp.text, sp.sub, { ms: sp.ms, color: splashColor(u) });
      } catch (err) { /* fine */ }
    }
    lastSplash = sp ? sp.key : '';
    overlay.setBlind(!!u.blind, u.timer, blindLine);
    // everybody's award: after the results splash, and through the break until the next countdown
    if (`${st.round}|${st.phase}` !== lastPhaseKey) phaseSeenAt = nowMs();
    const showAwards = !!u.awards && ((st.phase === 'results' && nowMs() - phaseSeenAt > AWARDS_AFTER_MS) || (st.phase === 'lobby' && st.round > 1));
    if (typeof overlay.setAwards === 'function') overlay.setAwards(showAwards ? u.awards : null); // (test stand-ins may not draw it)
    setAction(u.action);
    const again = inGame && isHost && st.phase === 'lobby' && st.round > 1;
    overlay.setBar({
      leave: !inGame ? null : isHost && !solo ? COPY.endGame : again ? COPY.leave : COPY.leaveGame,
      again,
      join: !inGame && !ended,
    });
    // music: the game beat, tense while seeking, a victory sting for the results. The app starts
    // the island track on the first tap and on the sound button, so a looping track is asked for
    // again when something else took over (the sting is asked for once: it ends by itself).
    const track = musicFor(kind, st.phase, { spectator: !inGame });
    const t = nowMs();
    let playing;
    try {
      playing = audio.real ? audio.real.current : undefined;
    } catch (err) {
      playing = undefined;
    }
    const drifted = track !== 'victory' && playing !== undefined && playing !== track && t - musicAt > 1500;
    if (track !== lastMusic || drifted) {
      lastMusic = track;
      musicAt = t;
      try {
        audio.music(track);
      } catch (err) { /* fine */ }
    }
    // phase moments
    const pk = `${st.round}|${st.phase}`;
    if (pk !== lastPhaseKey) {
      lastPhaseKey = pk;
      phaseSeenAt = t;
      if (st.phase === 'results') celebrate(null);
      // a friend still reading the app's how-to card at "Go!" would be stuck (a card holds the
      // controls): put it away so she can run. Never the leave card: that one is her choice.
      if (!isHost && inGame && (st.phase === 'play' || st.phase === 'hide') && hud.cardOpen && !overlay.confirming) {
        try {
          hud.closeCard();
        } catch (err) { /* fine */ }
      }
    }
  }

  // ---------------------------------------------------------------- the frame
  function update(dt) {
    if (ended || !game) return;
    const t = nowMs();
    const now = clock();
    const netNow = net.now();
    refresh(netNow);
    if (isHost) {
      const st = game.state;
      if (st.phase === 'lobby' && st.round === 1 && !st.phaseEnds && startAt && t >= startAt) {
        if (!game.host.start(now)) startAt = t + 1000;
        else startAt = 0;
      }
      driveBots(dt);
    }
    try {
      localFrame(now, dt);
    } catch (err) {
      if (!update.warned) console.warn('[c9 play] local player update failed', err);
      update.warned = true;
    }
    if (isHost) {
      handleHostFx(game.host.tick(now, view));
      if (shared) {
        outbox.flush(t, gid);
        if (game.state.seq !== lastSeq && t - lastShareAt >= SHARE_MS) share(t);
      }
    }
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (t >= timeline[i].at) {
        const fn = timeline[i].fn;
        timeline.splice(i, 1);
        try {
          fn();
        } catch (err) { /* a sparkle missed */ }
      }
    }
    props.update(dt, t / 1000, { game, now, charOf, posOf });
    tags.update();
    if (t - roleAt >= ROLE_MS) {
      roleAt = t;
      rolesFrame();
    }
    if (t - uiAt >= UI_MS) {
      uiAt = t;
      hudFrame(now);
    }
  }

  function share(t) {
    lastSeq = game.state.seq;
    lastShareAt = t;
    try {
      net.setGame(Object.assign({ epoch: String(epoch) }, game.state));
    } catch (err) { /* next time */ }
  }

  // ---------------------------------------------------------------- starting
  function hostCreate() {
    if (solo) {
      const want = soloBots(kind, sw);
      const have = [...net.players.values()].filter((p) => p.bot).length;
      if (want > have) world.addBots(want - have);
      else if (want < have) {
        let extra = have - want;
        for (const [id, p] of [...net.players]) {
          if (extra <= 0) break;
          if (p.bot) {
            net.removeBot(id);
            extra--;
          }
        }
      }
    }
    const list = [];
    for (const [id, p] of net.players) list.push({ id, nick: p.nick, bot: !!p.bot });
    game = createGame(kind, { arena: world.places, players: list, rng: Math.random, now: clock, settings: gameSettings(kind, sw) });
    if (!solo) {
      // a room: top up with bot friends so the teams are even and there are at least four
      const need = game.host.botsNeeded();
      if (need > 0) {
        for (const id of world.addBots(need) || []) {
          const p = net.players.get(id);
          game.host.addPlayer(id, { nick: p ? p.nick : '', bot: true });
        }
      }
    }
    gid = game.state.gid;
    startAt = nowMs() + START_DELAY_MS;
    if (shared) share(nowMs());
  }

  function clientCreate(state) {
    game = createGame(kind, { arena: world.places, players: [], rng: Math.random, now: clock });
    if (!game.applyState(state)) {
      game = null;
      return false;
    }
    gid = game.state.gid;
    return true;
  }

  function begin() {
    props.begin(kind, game);
    // a friend's device: the game arrives with the shared state, so say hello to it here
    if (!isHost && !world.activeGame) {
      world.activeGame = { kind, startedAt: Date.now(), id: opts.startId || null };
      if (game.state.phase === 'lobby' || game.state.phase === 'countdown') {
        try {
          hud.big(game.title, 'Get ready!', { ms: 1800 });
        } catch (err) { /* fine */ }
        sfx('whistle', { volume: 0.7 });
      }
    }
    if (world.toss && world.toss.active && typeof world.toss.cancel === 'function') {
      try {
        world.toss.cancel();
      } catch (err) { /* fine */ }
    }
    if (world.mode === 'lobby' && typeof world.enterWorld === 'function') world.enterWorld();
    const replay = pendingFx;
    pendingFx = [];
    for (const b of replay) if (b.g === gid) for (const f of b.f) playFx(f);
  }

  if (isHost) hostCreate();
  else if (opts.state) clientCreate(opts.state);
  if (game) begin();

  // ---------------------------------------------------------------- the API
  const api = {
    kind,
    startId: opts.startId || null,
    get gid() {
      return gid;
    },
    get game() {
      return game;
    },
    get isHost() {
      return isHost;
    },
    get solo() {
      return solo;
    },
    get ended() {
      return ended;
    },
    get appSession() {
      return appSession;
    },
    get inGame() {
      return !!(game && P(meId()));
    },
    get waiting() {
      return !game;
    },
    update(dt) {
      if (ended) return;
      try {
        update(dt);
      } catch (err) {
        if (!api.failed) console.error('[c9 play] the game frame failed', err);
        api.failed = true;
      }
    },
    /** Clients: the host's state. A new game id means a new game: the caller starts over. */
    adopt(state) {
      if (ended || isHost) return false;
      if (!game) {
        epoch = epochOf(state, net.now());
        if (!clientCreate(state)) return false;
        begin();
        return true;
      }
      if (state && state.gid && state.gid !== gid) return false;
      return game.applyState(state);
    },
    remoteFx(batch) {
      if (ended || isHost || !batch) return;
      if (!game) {
        if (pendingFx.length < 8) pendingFx.push(batch);
        return;
      }
      if (batch.g !== gid) return;
      for (const f of batch.f) playFx(f);
    },
    claim(from, data) {
      if (ended || !isHost || !game || !data || typeof data !== 'object') return false;
      if (data.type === 'leave') {
        optedOut.add(from);
        return game.host.removePlayer(from);
      }
      if (data.type === 'join') {
        optedOut.delete(from);
        const p = net.players.get(from);
        if (!p || p.bot) return false;
        if (game.state.order.length >= 10) {
          // make room: the newest bot heads home
          const bot = [...game.state.order].reverse().find((id) => isBot(id));
          if (bot) {
            game.host.removePlayer(bot);
            bodies.delete(bot);
            net.removeBot(bot);
          }
        }
        return game.host.addPlayer(from, { nick: p.nick, bot: false });
      }
      return game.host.claim(from, data, view);
    },
    join(id) {
      if (ended || !isHost || !game || optedOut.has(id)) return;
      const p = net.players.get(id);
      if (p) game.host.addPlayer(id, { nick: p.nick, bot: !!p.bot });
    },
    left(id) {
      bodies.delete(id);
      cache.delete(id);
      touched.delete(id);
      tags.set(id, null, null);
      if (!ended && isHost && game) game.host.removePlayer(id);
    },
    becomeHost() {
      if (ended || isHost || !game) return;
      isHost = true;
      shared = true;
      // the old host's bots went home with it: anyone the room doesn't know leaves the game
      for (const id of [...game.state.order]) if (!net.players.has(id)) game.host.removePlayer(id);
      lastSeq = -1;
      if (game.state.phase === 'lobby' && game.state.round === 1 && !game.state.phaseEnds) startAt = nowMs() + 500;
    },
    becomeClient() {
      if (ended || !isHost) return;
      isHost = false;
      bodies.clear();
      outbox.clear();
    },
    leaveGame() {
      if (ended || !game) return;
      const me = meId();
      releaseMe();
      if (isHost) game.host.removePlayer(me);
      else net.send('claim', { type: 'leave' });
    },
    joinGame() {
      if (ended || !game) return;
      if (isHost) {
        const p = net.players.get(meId());
        game.host.addPlayer(meId(), { nick: p ? p.nick : world.nick, bot: false });
      } else net.send('claim', { type: 'join' });
    },
    startNow() {
      if (ended || !isHost || !game) return false;
      return game.host.start(clock());
    },
    finishRound() {
      if (ended || !isHost || !game) return false;
      return game.host.end(clock());
    },
    // Solo only (nobody else shares this clock): moving the epoch on by the time away means the
    // round picks up exactly where she left it.
    pause() {
      if (solo && !pausedAt) pausedAt = net.now();
    },
    resume() {
      if (!solo || !pausedAt) return;
      epoch += Math.max(0, net.now() - pausedAt);
      pausedAt = 0;
    },
    now: () => clock(),
    /** Finish: the host tells the room and sends the bots home. remote: the host already ended it. */
    end({ remote = false, keepBots = false } = {}) {
      if (ended) return;
      ended = true;
      if (isHost && shared && !remote && net.room) {
        try {
          if (game && gid) outbox.flush(nowMs(), gid, true);
          net.send('game-end', { kind, id: api.startId || gid || '' });
          net.setGame({ kind: 'roam', phase: 'roam' });
        } catch (err) { /* the room may be gone */ }
      }
      if (isHost && !keepBots && net.room) {
        try {
          world.removeBots();
        } catch (err) { /* fine */ }
      }
      releaseMe();
      clearLooks();
      props.end();
      overlay.reset();
      timeline.length = 0;
      try {
        hud.setGameUI(null);
      } catch (err) { /* fine */ }
      if (lastMusic) {
        try {
          // the island loop first: the birthday song is a one-shot that goes back to the last
          // looping track asked for, which would otherwise be the game music
          audio.music('island');
          if (world.birthday && world.birthday.isBirthday) audio.music('birthday');
        } catch (err) { /* fine */ }
      }
    },
    info() {
      const me = meId();
      return {
        kind,
        gid,
        isHost,
        solo,
        inGame: api.inGame,
        phase: game ? game.state.phase : null,
        round: game ? game.state.round : 0,
        seq: game ? game.state.seq : 0,
        players: game ? game.state.order.length : 0,
        bots: bodies.size,
        me: game ? P(me) : null,
        who: myW ? { role: myW.role, team: myW.team, anim: myW.anim, canMove: myW.canMove, carrying: myW.carrying, hidden: myW.hidden } : null,
        props: props.stats,
        frozen: player.frozen,
        anim: player.anim,
        prompt: promptLabel,
        blind: overlay.blind,
        outbox: outbox.size,
      };
    },
  };
  return api;
}
