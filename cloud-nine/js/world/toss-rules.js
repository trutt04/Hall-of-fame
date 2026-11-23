// Basket toss rules: the launch solve, the flight clock, tricks, combos, scoring, who is basing,
// network fx validation and fallback hype lines. Pure: no three.js, no DOM, so it runs under node --test.
//
//   solveToss({ from, to, friends, calm, classic }) -> sol   the arc from the bases' hands to the landing point
//   heightAt(sol, tau) / vSpeedAt(sol, tau)                    feet height and vertical speed on the flight clock
//   clockRate(sol, tau)                                        how fast the flight clock runs: < 1 around the apex (the hang)
//   inApex(sol, tau)                                           the window where tricks become body positions
//   realAirTime(sol)                                           wall-clock seconds from release to touchdown
//   trickFor(gesture, atApex) -> TRICKS entry | null           gestures: up, down, left, right, circle
//   nextChain(prevId, id, chain) / comboMultiplier(chain)      different tricks in a row make a combo
//   scoreToss({ apexHeight, tricks: [{ id, done }], landing }) -> { height, rows, landingPoints, trickPoints, total }
//   matchSpots(spots, people, opts) -> { taken: [id | null], count }   who stands on which base spot
//   cleanTossFx(data, padIds) -> { kind, pad, ... } | null    a toss event from the network, validated
//   cleanNick(raw) -> string | null                            a friend's nick, safe to show
//   fallbackHype(situation, ctx, rng) -> string                used when js/content/hype.js is missing
//
// The flight clock (tau) is the time the arc is written in. Around the apex it runs slower than the
// wall clock: the flyer hangs in the sky for a moment (not when reduced motion is on). Trick
// durations are wall-clock seconds, so the hang really does give more time for tricks.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

export const TOSS = {
  padRadius: 1.9, // the mat; standing on it (off the base spots) offers the toss
  spotRadius: 0.48, // a base spot counts someone standing within this of its centre
  spotDist: 0.8, // base spots stand this far from the flyer's spot
  spotHeight: 1.2, // ... and within this of the mat's height
  basketY: 0.8, // the flyer's feet in the bases' hands before the throw (above the mat)
  releaseY: 1.55, // ... at the moment the bases let go
  catchY: 1.05, // classic toss: the bases catch the flyer at chest height
  clearance: 2.6, // the apex is this far above the higher of release and landing
  minRise: 4.5, // ... and at least this far above the release
  classicRise: 6.5, // straight up and down when the pad has no cloud to aim at
  friendLift: 1.6, // extra apex height for every real friend basing
  maxFriends: 4, // three bases and a back spot
  fallEase: 0.65, // gravity on the way down is this fraction of the way up: a floaty descent
  hangSlow: 0.4, // flight clock speed at the very top of the arc
  hangHalf: 0.36, // flight-clock seconds on each side of the apex over which the hang eases in and out
  calmExtra: 0.35, // reduced motion: no hang, a slightly longer and gentler arc instead
  minFlight: 1.7,
  maxFlight: 3.0,
  steer: 0.45, // air steering moves the landing point up to this fraction of the cloud's radius
  countBeat: 0.42, // seconds per count of "5, 6, 7, 8!" without a music clock
};

// ------------------------------------------------------------------------------------- the arc

// from: release point (the flyer's feet as the bases let go). to: landing point (feet on the cloud).
// The apex comes from the heights; gravity is then chosen so the whole flight takes a comfortable
// time, and the way down is lighter than the way up (floaty). Horizontal speed covers the distance
// in exactly that time.
export function solveToss({ from, to, friends = 0, calm = false, classic = false } = {}) {
  const f = clamp(Math.floor(num(friends)), 0, TOSS.maxFriends);
  const x0 = num(from && from.x);
  const y0 = num(from && from.y);
  const z0 = num(from && from.z);
  let x1 = num(to && to.x, x0);
  const y1 = num(to && to.y, y0);
  let z1 = num(to && to.z, z0);
  if (classic) {
    x1 = x0;
    z1 = z0;
  }
  const lift = f * TOSS.friendLift;
  const top = Math.max(y0, y1);
  const apex = classic
    ? top + TOSS.classicRise + lift
    : Math.max(top + TOSS.clearance, y0 + TOSS.minRise) + lift;
  const rise = apex - y0;
  const drop = apex - y1;
  const dist = Math.hypot(x1 - x0, z1 - z0);
  let T = clamp(1.2 + 0.05 * (rise + drop) + 0.005 * dist, TOSS.minFlight, TOSS.maxFlight);
  if (calm) T += TOSS.calmExtra;
  const k = TOSS.fallEase;
  const s = Math.sqrt(2 * rise) + Math.sqrt((2 * drop) / k);
  const gUp = (s * s) / (T * T);
  const gDown = gUp * k;
  const tUp = Math.sqrt((2 * rise) / gUp);
  return {
    x0, y0, z0, x1, y1, z1, apex, rise, drop, dist, T, tUp, tDown: T - tUp, gUp, gDown,
    vy: gUp * tUp, vx: (x1 - x0) / T, vz: (z1 - z0) / T, friends: f, calm: !!calm, classic: !!classic,
  };
}

export function heightAt(s, tau) {
  if (tau <= s.tUp) return s.y0 + s.vy * tau - 0.5 * s.gUp * tau * tau;
  const d = tau - s.tUp;
  return s.apex - 0.5 * s.gDown * d * d;
}

export function vSpeedAt(s, tau) {
  return tau <= s.tUp ? s.vy - s.gUp * tau : -s.gDown * (tau - s.tUp);
}

// Horizontal position without steering (previews and tests).
export function groundTrackAt(s, tau, out = {}) {
  const u = clamp(tau / s.T, 0, 1);
  out.x = s.x0 + (s.x1 - s.x0) * u;
  out.z = s.z0 + (s.z1 - s.z0) * u;
  return out;
}

export function clockRate(s, tau) {
  if (s.calm) return 1;
  const u = (tau - s.tUp) / TOSS.hangHalf;
  if (u <= -1 || u >= 1) return 1;
  const bump = 0.5 + 0.5 * Math.cos(Math.PI * u);
  return 1 - (1 - TOSS.hangSlow) * bump;
}

export function inApex(s, tau) {
  return Math.abs(tau - s.tUp) < TOSS.hangHalf;
}

// Wall-clock seconds the flight takes (the hang included).
export function realAirTime(s, step = 1 / 600) {
  let tau = 0;
  let t = 0;
  while (tau < s.T && t < 30) {
    tau += step * clockRate(s, tau);
    t += step;
  }
  return t;
}

// ------------------------------------------------------------------------------------- tricks

// dur is wall-clock seconds; spin is full turns of the whole body, which the toss drives itself
// (the anims show the shape, the toss turns the flyer).
export const TRICKS = {
  toeTouch: { id: 'toeTouch', name: 'Toe Touch', anim: 'toeTouch', dur: 0.5, points: 100, spin: 0, apex: false },
  pike: { id: 'pike', name: 'Pike', anim: 'pike', dur: 0.55, points: 120, spin: 0, apex: false },
  twist: { id: 'twist', name: 'Full Twist', anim: 'twist', dur: 0.65, points: 140, spin: 1, apex: false },
  kickDouble: { id: 'kickDouble', name: 'Kick Double', anim: 'kickDouble', dur: 0.85, points: 200, spin: 2, apex: false },
  liberty: { id: 'liberty', name: 'Liberty', anim: 'liberty', dur: 0.7, points: 160, spin: 0, apex: true },
  heelStretch: { id: 'heelStretch', name: 'Heel Stretch', anim: 'heelStretch', dur: 0.7, points: 170, spin: 0, apex: true },
  scorpion: { id: 'scorpion', name: 'Scorpion', anim: 'scorpion', dur: 0.75, points: 190, spin: 0, apex: true },
  bowArrow: { id: 'bowArrow', name: 'Bow and Arrow', anim: 'bowArrow', dur: 0.75, points: 190, spin: 0, apex: true },
  arabesque: { id: 'arabesque', name: 'Arabesque', anim: 'arabesque', dur: 0.7, points: 170, spin: 0, apex: true },
};

// Swipe (or key) -> trick. Near the apex the same gesture becomes a body position.
export const GESTURES = {
  up: { air: 'toeTouch', apex: 'liberty', key: 'ArrowUp', glyph: '↑' },
  down: { air: 'pike', apex: 'heelStretch', key: 'ArrowDown', glyph: '↓' },
  left: { air: 'kickDouble', apex: 'scorpion', key: 'ArrowLeft', glyph: '←' },
  right: { air: 'kickDouble', apex: 'bowArrow', key: 'ArrowRight', glyph: '→' },
  circle: { air: 'twist', apex: 'arabesque', key: 'Space', glyph: '⟳' },
};

export function trickFor(gesture, atApex = false) {
  const g = GESTURES[gesture];
  if (!g) return null;
  return TRICKS[atApex ? g.apex : g.air] || null;
}

export const COMBO = { step: 0.5, max: 3 };

export function comboMultiplier(chain) {
  return Math.min(COMBO.max, 1 + COMBO.step * Math.max(0, (chain | 0) - 1));
}

// The chain grows by one for each trick that differs from the one before it. A repeat starts over.
export function nextChain(prevId, id, chain) {
  return prevId && prevId !== id ? (chain | 0) + 1 : 1;
}

// ------------------------------------------------------------------------------------- scoring

export const POINTS = { perMeter: 10, stuck: 300, cradle: 100 };

// apexHeight: metres from the mat to the top of the arc. tricks: in order; a trick still going at
// touchdown (done: false) scores nothing, and the landing becomes a cradle.
export function scoreToss({ apexHeight = 0, tricks = [], landing = 'stuck' } = {}) {
  const height = Math.round(clamp(num(apexHeight), 0, 500) * POINTS.perMeter);
  const rows = [];
  let chain = 0;
  let prev = null;
  let trickPoints = 0;
  for (const t of Array.isArray(tricks) ? tricks : []) {
    const def = t && TRICKS[t.id];
    if (!def) continue;
    chain = nextChain(prev, def.id, chain);
    prev = def.id;
    const mult = comboMultiplier(chain);
    const done = t.done !== false;
    const points = done ? Math.round(def.points * mult) : 0;
    trickPoints += points;
    rows.push({ id: def.id, name: def.name, mult, points, done });
  }
  const landingPoints = landing === 'stuck' ? POINTS.stuck : POINTS.cradle;
  return { height, rows, trickPoints, landing: landing === 'stuck' ? 'stuck' : 'cradle', landingPoints, total: height + trickPoints + landingPoints };
}

// ------------------------------------------------------------------------------------- basing

// spots: [{ x, y, z }]. people: [{ id, x, y, z }], real friends only (the caller leaves out bots).
// Each spot takes the nearest person standing on it, and each person counts once.
export function matchSpots(spots, people, { radius = TOSS.spotRadius, height = TOSS.spotHeight } = {}) {
  const list = Array.isArray(spots) ? spots : [];
  const taken = list.map(() => null);
  const pairs = [];
  list.forEach((s, i) => {
    for (const p of Array.isArray(people) ? people : []) {
      if (!p || p.id === null || p.id === undefined) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.y)) continue;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d <= radius && Math.abs(p.y - s.y) <= height) pairs.push({ i, id: p.id, d });
    }
  });
  pairs.sort((a, b) => a.d - b.d);
  const used = new Set();
  for (const pr of pairs) {
    if (taken[pr.i] !== null || used.has(pr.id)) continue;
    taken[pr.i] = pr.id;
    used.add(pr.id);
  }
  return { taken, count: used.size };
}

// ------------------------------------------------------------------------------------- network

// Everything from the network is untrusted: known pad ids only, numbers clamped, nothing else kept.
export function cleanTossFx(data, padIds) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const ids = (Array.isArray(padIds) ? padIds : []).map(String);
  const raw = data.pad;
  const pad = (typeof raw === 'string' || typeof raw === 'number') && ids.includes(String(raw)) ? String(raw) : null;
  if (!pad) return null;
  if (data.kind === 'toss') {
    const beat = Number(data.beat);
    return { kind: 'toss', pad, beat: Number.isFinite(beat) ? clamp(beat, 0.25, 0.8) : TOSS.countBeat };
  }
  if (data.kind === 'tossLand') {
    const score = Number(data.score);
    return { kind: 'tossLand', pad, stuck: data.stuck === true, score: Number.isFinite(score) ? clamp(Math.round(score), 0, 99999) : 0 };
  }
  return null;
}

// A nick to show in a toast: letters and spaces only, trimmed and capped. Anything else is dropped.
export function cleanNick(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || s.length > 20 || !/^[\p{L} ]+$/u.test(s)) return null;
  return s;
}

// ------------------------------------------------------------------------------------- words

// Used when js/content/hype.js is missing or says nothing. Cheers for skill, effort, style,
// teamwork and spirit; never about looks; nobody is ever shamed.
export const FALLBACK_HYPE = {
  stuck: [
    'The cloud did not even wobble!',
    'Toes pointed, landing stuck. Iconic!',
    'That landing was so clean!',
    'Flyer of the year, right there!',
    'Your bases are SO proud of you!',
    'Hit zero in the sky!',
    'Sky high and stuck. Legendary!',
  ],
  cradle: [
    'Cloud cradle! Comfiest catch ever.',
    'The cloud caught you. Go again!',
    'Soft landing, big style!',
    'So close to stuck. The next one is yours!',
    'Caught like a pro. That was fun!',
  ],
  classic: [
    'Clean catch! Your bases are SO proud.',
    'Up, up and right back into the cradle!',
    'Caught it clean. That is teamwork!',
    'Hit zero on that basket!',
  ],
  bigToss: ['That was HUGE!', 'Higher than the birds!', 'Major air time!', 'Full out, all the way up!'],
  trick: ['So sharp!', 'Clean!', 'Yes, flyer!', 'Pointed toes!'],
  squad: ['Squad lift! Teamwork makes the dream work.', 'Your squad sent you flying!', 'Best bases in the sky!'],
};

export function fallbackHype(situation, ctx = {}, rng = Math.random) {
  let list = FALLBACK_HYPE[situation];
  if (situation === 'tossLand') list = ctx && ctx.classic ? FALLBACK_HYPE.classic : ctx && ctx.stuck === false ? FALLBACK_HYPE.cradle : FALLBACK_HYPE.stuck;
  if (!list || !list.length) list = FALLBACK_HYPE.stuck;
  const r = typeof rng === 'function' ? rng() : Math.random();
  return list[Math.floor(clamp(num(r), 0, 0.999999) * list.length)];
}
