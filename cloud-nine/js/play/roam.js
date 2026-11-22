// Bot friends in free roam (PLAY): when no game is on, the host walks any bots around gently (a
// few steps, a pause to look around, now and then a wave or a cheer), so a bot friend never stands
// frozen on the island. Games take the bots over (session.js); this only runs between them.
//
//   const roam = createRoamer(world)
//   roam.update(dt)     every frame while no game runs (it checks that this device is the host)
//   roam.reset()        a game took the bots over
//   roam.size           how many bots it is walking (tests)

import { angleDelta } from '../core/util.js';

const WALK = 1.5; // m/s: a stroll, not a run
const RANGE = 6; // meters around the spot where each bot started roaming
const BOT_R = 0.4;
const EMOTES = ['wave', 'cheer', 'clap', 'dance', 'highV'];

export function createRoamer(world) {
  const bodies = new Map(); // bot id -> body
  const probe = { x: 0, z: 0 };

  const ground = (x, z) => {
    const y = world.groundAt(x, z);
    return Number.isFinite(y) ? y : null;
  };
  const free = (x, z) => ground(x, z) !== null && !(world.colliders && world.colliders.hits(x, z, 0.5));

  function isHost() {
    const s = world.session;
    const net = world.net;
    return !!(s && net && net.room && (s.kind === 'solo' || net.isHost));
  }

  function pickGoal(b) {
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * RANGE;
      const x = b.ax + Math.sin(a) * r;
      const z = b.az + Math.cos(a) * r;
      if (free(x, z)) {
        b.gx = x;
        b.gz = z;
        return;
      }
    }
    b.gx = b.ax; // nowhere new: back to where it started
    b.gz = b.az;
  }

  function bodyFor(id) {
    let b = bodies.get(id);
    if (b) return b;
    let x;
    let z;
    let h = 0;
    let s = null;
    try {
      s = world.net.stateOf(id);
    } catch (err) {
      s = null;
    }
    if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) {
      x = s.x;
      z = s.z;
      h = Number.isFinite(s.h) ? s.h : 0;
    } else {
      // a new bot friend shows up near her
      const p = world.player.position;
      x = p.x;
      z = p.z;
      for (let k = 0; k < 8; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2.5 + Math.random() * 3.5;
        if (free(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r)) {
          x = p.x + Math.sin(a) * r;
          z = p.z + Math.cos(a) * r;
          h = a + Math.PI; // facing her
          break;
        }
      }
    }
    const y = ground(x, z);
    b = { x, z, y: y === null ? 0 : y, h, ax: x, az: z, gx: x, gz: z, wait: 0.5 + Math.random() * 2.5, stuck: 0, anim: 'idle', emote: null, emoteT: 0, out: { x, y: 0, z, h, anim: 'idle' } };
    bodies.set(id, b);
    return b;
  }

  function step(b, dt) {
    if (b.emoteT > 0) {
      b.emoteT -= dt;
      b.anim = b.emote;
      return;
    }
    if (b.wait > 0) {
      b.wait -= dt;
      b.anim = 'idle';
      if (b.wait <= 0) {
        if (Math.random() < 0.3) {
          b.emote = EMOTES[Math.floor(Math.random() * EMOTES.length)];
          b.emoteT = 1.6;
          b.wait = 0.4;
        } else pickGoal(b);
      }
      return;
    }
    const dx = b.gx - b.x;
    const dz = b.gz - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) {
      b.wait = 2 + Math.random() * 4;
      b.anim = 'idle';
      return;
    }
    const sp = Math.min(WALK, d * 1.5);
    probe.x = b.x + (dx / d) * sp * dt;
    probe.z = b.z + (dz / d) * sp * dt;
    if (world.colliders) world.colliders.resolve(probe, BOT_R);
    const y = ground(probe.x, probe.z);
    const moved = Math.hypot(probe.x - b.x, probe.z - b.z);
    b.stuck = moved < sp * dt * 0.3 ? b.stuck + dt : 0;
    if (y === null || b.stuck > 0.8) {
      // never a step into open sky; a hedge in the way: stop and think again
      b.gx = b.x;
      b.gz = b.z;
      b.wait = 0.8 + Math.random();
      b.stuck = 0;
      b.anim = 'idle';
      return;
    }
    b.x = probe.x;
    b.z = probe.z;
    b.y = y;
    b.h += angleDelta(b.h, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
    b.anim = 'walk';
  }

  return {
    update(dt) {
      if (!isHost()) {
        if (bodies.size) bodies.clear();
        return;
      }
      const net = world.net;
      const t = Math.min(0.1, Math.max(0, dt || 0));
      for (const [id, p] of net.players) {
        if (!p || !p.bot) continue;
        const b = bodyFor(id);
        step(b, t);
        b.out.x = b.x;
        b.out.y = b.y;
        b.out.z = b.z;
        b.out.h = b.h;
        b.out.anim = b.anim;
        net.sendStateFor(id, b.out);
        const e = world.peers && world.peers.get ? world.peers.get(id) : null;
        if (e && e.group && e.group.visible) e.group.position.set(b.x, b.y, b.z);
      }
      if (bodies.size) for (const id of bodies.keys()) if (!net.players.has(id)) bodies.delete(id);
    },
    reset() {
      bodies.clear();
    },
    get size() {
      return bodies.size;
    },
  };
}
