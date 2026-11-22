// Small pure math helpers shared by the engine and the world. No three.js, no DOM.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Frame-rate independent exponential approach. lambda is "how fast" in 1/seconds.
export function damp(a, b, lambda, dt) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

// Shortest signed difference b - a, wrapped to (-PI, PI].
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function dampAngle(a, b, lambda, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
}

// Critically damped spring (the classic "smooth damp"). state is { v } and is mutated.
export function smoothDamp(current, target, state, smoothTime, dt) {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

export const ease = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => t * t * (3 - 2 * t),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

// Deterministic PRNG. Returns a function giving floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer lattice hash to [0, 1).
export function hash2(ix, iz) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in [0, 1]. One octave, cheap.
export function valueNoise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Tiny event emitter mixin: returns { on, off, emit }.
export function emitter() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
      return () => this.off(name, fn);
    },
    off(name, fn) {
      const set = map.get(name);
      if (set) set.delete(fn);
    },
    emit(name, a, b, c) {
      const set = map.get(name);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(a, b, c);
        } catch (err) {
          console.error('[lw] listener for "' + name + '" failed', err);
        }
      }
    },
  };
}

export function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

export function safeStorageSet(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
    return true;
  } catch (err) {
    return false;
  }
}
