// A headless room: bots (and optionally keyboard-driven humans) playing a game mode, moved the way
// a host app would move them. Used by the node tests and dev/games-sim.html. Pure: no DOM.
//
//   const sim = createSim({ kind: 'dodgeball', players: 6, seed: 3 })
//   sim.step(dt) -> fx[]        advance dt seconds: bots think and move, claims go to the host, host ticks
//   sim.game, sim.bodies (Map id -> { x, z, h, vx, vz, anim }), sim.view, sim.now, sim.log, sim.stats
//   sim.add() -> id, sim.remove(id), sim.setHuman(id, on), sim.steer(id, { x, z }), sim.press(id, aim?)
//   sim.handover(seed): the host leaves and a fresh game adopts the shared state
//   options: { kind, players, humans (the first n play by keyboard), seed, settings, arena, places, t0, start }
//
//   driveBot(game, id, body, view, dt) -> claim | null
//       one bot, one frame, the way the host app does it: ask the brain, ease toward its velocity,
//       stay in the arena (game.confine), pick an anim. The host passes the claim to host.claim().

import { mulberry32 } from '../core/util.js';
import { createGame, MODES } from './index.js';
import { SAMPLE_PLACES } from './sample-arenas.js';

export const BOT_NICKS = [
  'Sparkle Comet', 'Star Dancer', 'Glitter Bug', 'Pom Pom', 'Twirl Pop',
  'Cloud Hopper', 'Rainbow Flip', 'Moon Jump', 'Sunny Spin', 'Lucky Leap',
  'Bubble Bow', 'Disco Daisy',
];
export const HUMAN_SPEED = 7; // m/s, a running kid

export function driveBot(game, id, body, view, dt) {
  const out = game.bot(id, view, dt);
  const w = game.who(id, body);
  const k = 1 - Math.exp(-10 * dt);
  body.vx += (out.move.x - body.vx) * k;
  body.vz += (out.move.z - body.vz) * k;
  if (!w.canMove) {
    body.vx = 0;
    body.vz = 0;
  }
  const c = game.confine(id, body.x + body.vx * dt, body.z + body.vz * dt);
  body.x = c.x;
  body.z = c.z;
  const sp = Math.hypot(body.vx, body.vz);
  if (sp > 0.4) body.h = Math.atan2(body.vx, body.vz);
  else if (out.face !== null && out.face !== undefined) body.h = out.face;
  body.anim = out.anim || w.anim || (sp < 0.35 ? w.pose || 'idle' : sp < 3.9 ? 'walk' : 'run');
  return out.action;
}

export function createSim(opts = {}) {
  const kind = opts.kind || 'dodgeball';
  const mode = MODES[kind];
  const places = opts.places || SAMPLE_PLACES;
  const arena = opts.arena !== undefined ? opts.arena : places[mode.place];
  const rng = mulberry32(opts.seed ?? 1);
  const moveRng = mulberry32((opts.seed ?? 1) * 7919 + 17); // scatter positions, not game decisions
  let now = opts.t0 ?? 1000000;
  let nextId = 1;
  const count = Math.max(0, Math.min(10, opts.players ?? 6));
  const humanCount = Math.max(0, Math.min(count, opts.humans ?? 0)); // the first few are people
  const plist = [];
  for (let i = 0; i < count; i++) {
    const id = `p${nextId++}`;
    plist.push({ id, nick: i < humanCount ? 'You' : BOT_NICKS[i % BOT_NICKS.length], bot: i >= humanCount });
  }
  let game = createGame(kind, { arena, players: plist, rng, now: () => now, settings: opts.settings, strict: opts.strict });
  const bodies = new Map();
  const humans = new Map(); // id -> { x, z } steering input in [-1, 1]
  const log = [];
  const stats = { claims: 0, accepted: 0, rejected: 0, byType: {} };
  const centre = game.arena.area.f;

  function place(id) {
    const ang = moveRng() * Math.PI * 2;
    const r = 2 + moveRng() * 4;
    const c = game.confine(id, centre.x + Math.sin(ang) * r, centre.z + Math.cos(ang) * r);
    bodies.set(id, { x: c.x, z: c.z, h: 0, vx: 0, vz: 0, anim: 'idle' });
  }
  for (const p of plist) place(p.id);
  for (const p of plist) if (!p.bot) humans.set(p.id, { x: 0, z: 0 });

  const view = {
    pos: (id) => bodies.get(id) || null,
    ids: () => [...bodies.keys()],
  };

  function send(id, claim) {
    if (!claim) return false;
    stats.claims++;
    const ok = game.host.claim(id, claim, view);
    if (ok) stats.accepted++;
    else stats.rejected++;
    const key = `${claim.type}:${ok ? 'ok' : 'no'}`;
    stats.byType[key] = (stats.byType[key] || 0) + 1;
    return ok;
  }

  function moveHuman(id, body, dt) {
    const input = humans.get(id) || { x: 0, z: 0 };
    const w = game.who(id, body);
    const len = Math.min(1, Math.hypot(input.x, input.z));
    const sp = w.canMove ? HUMAN_SPEED * w.speed * len : 0;
    const d = Math.hypot(input.x, input.z) || 1;
    const k = 1 - Math.exp(-12 * dt);
    body.vx += ((input.x / d) * sp - body.vx) * k;
    body.vz += ((input.z / d) * sp - body.vz) * k;
    if (!w.canMove) {
      body.vx = 0;
      body.vz = 0;
    }
    const c = game.confine(id, body.x + body.vx * dt, body.z + body.vz * dt);
    body.x = c.x;
    body.z = c.z;
    const s = Math.hypot(body.vx, body.vz);
    if (s > 0.4) body.h = Math.atan2(body.vx, body.vz);
    body.anim = w.anim || (s < 0.35 ? w.pose || 'idle' : s < 3.9 ? 'walk' : 'run');
  }

  function step(dt) {
    now += Math.max(1, Math.round(dt * 1000));
    const claims = [];
    for (const [id, body] of bodies) {
      if (!game.state.players[id]) continue;
      if (humans.has(id)) {
        moveHuman(id, body, dt);
        const c = game.autoClaim(id, view, now);
        if (c) claims.push([id, c]);
      } else {
        const c = driveBot(game, id, body, view, dt);
        if (c) claims.push([id, c]);
      }
    }
    for (const [id, c] of claims) send(id, c);
    const fx = game.host.tick(now, view);
    for (const f of fx) {
      if (f.type === 'teleport') {
        const b = bodies.get(f.id);
        if (b) {
          b.x = f.x;
          b.z = f.z;
          b.h = f.facing;
          b.vx = 0;
          b.vz = 0;
        }
      }
      log.push({ t: now, ...f });
    }
    if (log.length > 4000) log.splice(0, log.length - 3000);
    return fx;
  }

  if (opts.start !== false) game.host.start(now);

  return {
    get game() {
      return game;
    },
    bodies,
    view,
    log,
    stats,
    get now() {
      return now;
    },
    step,
    add(nick) {
      if (game.state.order.length >= 10) return null;
      const id = `p${nextId++}`;
      if (!game.host.addPlayer(id, { nick: nick || BOT_NICKS[(nextId - 2) % BOT_NICKS.length], bot: true })) return null;
      place(id);
      return id;
    },
    remove(id) {
      bodies.delete(id);
      humans.delete(id);
      return game.host.removePlayer(id);
    },
    setHuman(id, on) {
      if (on) humans.set(id, { x: 0, z: 0 });
      else humans.delete(id);
    },
    steer(id, input) {
      if (humans.has(id)) humans.set(id, { x: Number(input.x) || 0, z: Number(input.z) || 0 });
    },
    press(id, aim) {
      const c = game.press(id, view, now, aim);
      return c ? send(id, c) : false;
    },
    send,
    /** The host left: a new host adopts the shared state (as JSON) and carries on. */
    handover(seed = 1) {
      const next = createGame(kind, { arena, rng: mulberry32(seed), now: () => now, strict: opts.strict });
      if (!next.applyState(JSON.parse(JSON.stringify(game.state)))) return false;
      game = next;
      return true;
    },
  };
}
