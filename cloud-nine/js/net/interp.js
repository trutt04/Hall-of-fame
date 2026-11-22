// Smooth motion for remote players, and the throttle for what we send. Pure: no DOM.
//
//   const buf = createInterpBuffer({ delayMs = GAME.interpDelayMs, maxExtrapMs = 150, snapDist = 8 })
//   buf.push({ t, x, y, z, h, anim })   samples in time order (late or duplicate ones are dropped)
//   buf.sample(now, out?) -> { x, y, z, h, anim } | null
//       Draws the player delayMs in the past, between the two samples around that moment. Past the
//       newest sample it keeps going briefly (only while walking, running, jumping or falling), then
//       holds. Jumps of more than snapDist meters (teleports) are not smeared across the map.
//
//   const tx = createStateSender({ hz = GAME.netHz, send(state, t), keepaliveMs = 5000 })
//   tx.update(state, t)   the latest state; goes out at once when due and changed
//   tx.tick(t)            call about hz times a second: sends what changed, then one "rest" copy
//                         after the player stops, so viewers see two equal samples and hold still
//   tx.reset()            forget what was sent (after a reconnect everything goes again)
//
// Times are milliseconds on the shared clock (net.now()).

import { GAME } from '../config.js';
import { angleDelta } from '../core/util.js';

const MOVING = new Set(['walk', 'run', 'jump', 'fall']);
const TAU = Math.PI * 2;

function wrap(h) {
  let a = h % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function put(o, s) {
  o.x = s.x;
  o.y = s.y;
  o.z = s.z;
  o.h = s.h;
  o.anim = s.anim;
  return o;
}

export function createInterpBuffer({ delayMs = GAME.interpDelayMs, maxExtrapMs = 150, snapDist = 8, size = 32 } = {}) {
  const buf = [];
  const snap2 = snapDist * snapDist;

  function push(s) {
    if (!s || !Number.isFinite(s.t)) return false;
    const last = buf[buf.length - 1];
    if (last && s.t <= last.t) return false;
    buf.push({ t: s.t, x: s.x, y: s.y, z: s.z, h: s.h, anim: s.anim });
    if (buf.length > size) buf.splice(0, buf.length - size);
    return true;
  }

  // Old samples are dropped by age, never fewer than two kept.
  function prune(T) {
    let k = 0;
    while (k < buf.length - 2 && buf[k + 1].t < T - 1000) k++;
    if (k > 0) buf.splice(0, k);
  }

  function sample(now, out) {
    const n = buf.length;
    if (n === 0) return null;
    const o = out || {};
    const T = now - delayMs;
    if (n === 1 || T <= buf[0].t) return put(o, buf[0]);
    const last = buf[n - 1];
    if (T >= last.t) {
      const prev = buf[n - 2];
      const span = last.t - prev.t;
      let dt = Math.min(T - last.t, maxExtrapMs);
      if (!MOVING.has(last.anim) || span <= 0 || span > 1000 || dist2(prev, last) > snap2) dt = 0;
      const k = dt > 0 ? dt / span : 0;
      o.x = last.x + (last.x - prev.x) * k;
      o.y = last.y + (last.y - prev.y) * k;
      o.z = last.z + (last.z - prev.z) * k;
      o.h = last.h;
      o.anim = last.anim;
      prune(T);
      return o;
    }
    let j = n - 1;
    while (j > 1 && buf[j - 1].t > T) j--;
    const a = buf[j - 1];
    const b = buf[j];
    if (dist2(a, b) > snap2) {
      put(o, a);
    } else {
      const k = (T - a.t) / (b.t - a.t);
      o.x = a.x + (b.x - a.x) * k;
      o.y = a.y + (b.y - a.y) * k;
      o.z = a.z + (b.z - a.z) * k;
      o.h = wrap(a.h + angleDelta(a.h, b.h) * k);
      o.anim = k < 0.5 ? a.anim : b.anim;
    }
    prune(T);
    return o;
  }

  return {
    push,
    sample,
    latest: () => (buf.length ? { ...buf[buf.length - 1] } : null),
    clear: () => {
      buf.length = 0;
    },
    get size() {
      return buf.length;
    },
  };
}

export function createStateSender({ hz = GAME.netHz, send, keepaliveMs = 5000, posEps = 0.01, angEps = 0.01 }) {
  const period = 1000 / hz;
  let pending = null;
  let last = null;
  let lastAt = -Infinity;
  let rested = true;

  function changed(a, b) {
    return (
      Math.abs(a.x - b.x) > posEps ||
      Math.abs(a.y - b.y) > posEps ||
      Math.abs(a.z - b.z) > posEps ||
      Math.abs(angleDelta(a.h, b.h)) > angEps ||
      a.anim !== b.anim
    );
  }

  function go(t) {
    last = pending;
    lastAt = t;
    send(pending, t);
  }

  return {
    update(state, t) {
      pending = state;
      if (t - lastAt >= period && (!last || changed(pending, last))) {
        go(t);
        rested = false;
      }
    },
    tick(t) {
      if (!pending || t - lastAt < period - 2) return;
      if (!last || changed(pending, last)) {
        go(t);
        rested = false;
      } else if (!rested) {
        go(t);
        rested = true;
      } else if (t - lastAt >= keepaliveMs) {
        go(t);
      }
    },
    reset() {
      last = null;
      lastAt = -Infinity;
      rested = true;
    },
    get pending() {
      return pending;
    },
  };
}
