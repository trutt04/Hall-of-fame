// The cheerleader's animations as pure pose math (no three.js, no DOM), so they run under node.
//
//   ANIM_NAMES                 every animation name (Contract 3), in groups
//   ANIM_GROUPS                { move, react, game, arm, trick, position } -> names (dev pages, menus)
//   ANIM_INFO                  name -> { kind, loop, duration, face, trick, release?, hipY?, seatY? }
//   ANIM_IK                    name -> { armL?, armR?, legL?, legR? }: hand / foot targets the runtime solves
//   CH, NCH, ANGLE_CH          pose channels (a pose is a Float32Array(NCH))
//   evalAnim(name, out, time, s)   writes the pose at `time` seconds into the clip
//   locomotion(out, t, s)      idle / walk / run blended by s.move (0 idle .. 1 moving) and s.run (0 walk .. 1 run)
//   isDone(name, time, loop)   one-shots (and loops played with loop: false) finish, then hold their last pose
//   trickSpin(name, u, ground) how far a twist / kick double should have turned her (the caller turns her)
//
// s is the runtime state: { t (seconds, for breathing), seed, phase (stride), ground (tricks hop on
// their own when true), move, run, m (motion scale: 1, or ~0.15 with reduced motion) }.
//
// Channels. Root: hips offset (m) and pitch (+ leans forward), yaw (+ turns to her left), roll
// (+ leans to her right), spin (reserved: tricks leave whole-body turns to the caller, see trickSpin). Spine and
// head: X bends forward / nods down, Y turns left, Z leans right. Limbs are swing vectors: x lifts
// the limb out to the side, z lifts it forward (negative: back); their length is the elevation, so
// (PI/2, 0) is a T and (PI, 0) is straight up. t is external rotation, e / k bend the elbow / knee,
// f points the toes. ik* fade the runtime's hand and foot targets in and out.
import { RIG } from './character-rig.js';

export const CH = Object.freeze({
  rootX: 0, rootY: 1, rootZ: 2, pitch: 3, yaw: 4, roll: 5, spin: 6,
  waistX: 7, waistY: 8, waistZ: 9, chestX: 10, chestY: 11, chestZ: 12, headX: 13, headY: 14, headZ: 15,
  aLx: 16, aLz: 17, aLt: 18, eL: 19, aRx: 20, aRz: 21, aRt: 22, eR: 23,
  lLx: 24, lLz: 25, lLt: 26, kL: 27, fL: 28, lRx: 29, lRz: 30, lRt: 31, kR: 32, fR: 33,
  ikL: 34, ikR: 35, ikLL: 36, ikLR: 37,
});
export const NCH = 38;
export const ANGLE_CH = Object.freeze([CH.pitch, CH.yaw, CH.roll, CH.spin]); // blended along the short way round

const {
  rootX, rootY, rootZ, pitch, roll, waistX, waistY, waistZ, chestX, chestY, chestZ, headX, headY, headZ,
  aLx, aLz, aLt, eL, aRx, aRz, aRt, eR, lLx, lLz, lLt, kL, fL, lRx, lRz, lRt, kR, fR, ikL, ikR, ikLR,
} = CH;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (x) => x * x * (3 - 2 * x);
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const snap = (x) => 1 - (1 - x) * (1 - x) * (1 - x); // fast hit, soft settle
function hash(n) {
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

// ---- building blocks -----------------------------------------------------------------------------
export function stand(p) {
  p.fill(0);
  p[aLx] = 0.13; p[aRx] = 0.13; p[aLz] = 0.03; p[aRz] = 0.03; p[eL] = 0.16; p[eR] = 0.16;
  p[lLx] = 0.015; p[lRx] = 0.015; p[kL] = 0.03; p[kR] = 0.03;
  p[chestX] = -0.035;
}

// Arm presets: [out, forward, twist, elbow].
export const ARMS = Object.freeze({
  down: [0.13, 0.03, 0, 0.16],
  hip: [0.72, -0.18, 0.15, 2.05], // fist on the hip
  highV: [2.42, 0.34, 0, 0.03],
  lowV: [0.62, 0.22, 0, 0.03],
  t: [1.56, 0.16, 0, 0.03],
  touchdown: [2.94, 0.24, 0, 0.03],
  dagger: [0.16, 0.2, -0.35, 2.7],
  clasp: [-0.3, 1.05, 0.3, 1.85],
  wrap: [-0.08, 0.32, -1.25, 1.75], // forearms crossed tight over the chest for twists
  ready: [0.2, 0.72, 1.3, 1.3], // a base: forearms forward, palms up
  whip: [-0.3, 0.42, 0, 0.2], // crossed down in front: the swing before a jump
});

function arm(p, side, a) {
  const o = side === 'L' ? aLx : aRx;
  p[o] = a[0]; p[o + 1] = a[1]; p[o + 2] = a[2]; p[o + 3] = a[3];
}
function arms(p, L, R = L) { arm(p, 'L', L); arm(p, 'R', R); }
function leg(p, side, x, z, t, k, f) {
  const o = side === 'L' ? lLx : lRx;
  p[o] = x; p[o + 1] = z; p[o + 2] = t; p[o + 3] = k; p[o + 4] = f;
}
function feetTogether(p) {
  leg(p, 'L', -0.03, 0, 0, 0.02, 0);
  leg(p, 'R', -0.03, 0, 0, 0.02, 0);
}

// Plant one foot flat on the ground `dz` ahead of the hip with the hips `hipH` above the ground
// (a two-bone solve in the side plane). Uses the pose's pitch, so set pitch first.
function footDown(p, side, hipH, dz = 0) {
  const o = side === 'L' ? lLx : lRx;
  const L1 = RIG.thigh, L2 = RIG.shin;
  const dy = hipH - RIG.ankleY;
  const d = clamp(Math.hypot(dy, dz), 0.05, L1 + L2 - 1e-4);
  const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const thighWorld = Math.atan2(dz, dy) + a;
  p[o + 1] = thighWorld + p[pitch];
  p[o + 3] = knee;
  p[o + 4] = thighWorld - knee;
}
// Both feet down: hips at hipH, feet dz ahead.
function crouch(p, hipH, dz = 0) {
  p[rootY] = hipH - RIG.hipY;
  footDown(p, 'L', hipH, dz - p[rootZ]);
  footDown(p, 'R', hipH, dz - p[rootZ]);
}
// Stand on one straight leg (the other is free), keeping it vertical under a pitched body.
function standOn(p, side) {
  const o = side === 'L' ? lLx : lRx;
  p[o] = -0.02; p[o + 1] = p[pitch]; p[o + 2] = 0; p[o + 3] = 0; p[o + 4] = 0;
  p[rootX] = side === 'L' ? 0.03 : -0.03;
}

function K(...fns) {
  const p = new Float32Array(NCH);
  stand(p);
  for (const f of fns) f(p);
  return p;
}
function lerpPose(out, a, b, k) {
  for (let i = 0; i < NCH; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}
// Keyframes: [[u, pose, ease?], ...], u in 0..1. The ease shapes the segment that ends at the key.
function keys(out, u, list) {
  if (u <= list[0][0]) { out.set(list[0][1]); return; }
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (u <= b[0]) {
      const x = clamp((u - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
      lerpPose(out, a[1], b[1], (b[2] || smooth)(x));
      return;
    }
  }
  out.set(list[list.length - 1][1]);
}
// A jump's flight: hips rise on a parabola between takeoff u0 and touchdown u1.
function hop(p, u, u0, u1, h) {
  if (u > u0 && u < u1) {
    const x = (u - u0) / (u1 - u0);
    p[rootY] += 4 * h * x * (1 - x);
  }
}
const _tmpA = new Float32Array(NCH), _tmpB = new Float32Array(NCH);

// ---- the clips -----------------------------------------------------------------------------------
// def: { kind, loop, dur (one-shots) | cycle (loops), blend, face, trick, air, pose(p, x, s) }
// One-shots get x = u in 0..1; loops get x = seconds.
const CLIPS = Object.create(null);
const IK = Object.create(null);
function def(name, o, ik) {
  CLIPS[name] = Object.assign({ loop: false, dur: 1, cycle: 2, blend: 0.2, face: 'smile' }, o);
  if (ik) IK[name] = ik;
}

// -- idle, with a fidget now and then: hands on hips, a bow check, a bounce or a stretch
function idlePose(p, t, s) {
  stand(p);
  const m = s.m, br = Math.sin(t * 1.8), sd = s.seed || 0;
  p[rootY] = -0.004 + 0.003 * br * m;
  p[chestX] = -0.04 - 0.014 * br * m;
  p[aLx] += 0.015 * br * m; p[aRx] += 0.015 * br * m;
  const w = Math.sin(t * 0.47 + sd);
  p[roll] = 0.02 * w * m; p[waistZ] = -0.03 * w * m;
  p[kL] = 0.03 + 0.09 * Math.max(0, w) * m; p[kR] = 0.03 + 0.09 * Math.max(0, -w) * m;
  p[headY] = 0.34 * Math.sin(t * 0.31 + sd) * Math.sin(t * 0.13 + 1 + sd) * m;
  p[headZ] = 0.06 * Math.sin(t * 0.43 + sd * 2) * m;
  p[headX] = -0.02 + 0.025 * Math.sin(t * 0.7 + sd) * m;
  if (m > 0.5) fidget(p, t + sd * 7.3, s);
}
const FIDGET_EVERY = 8.5;
function fidget(p, t, s) {
  const cyc = Math.floor(t / FIDGET_EVERY), x = t - cyc * FIDGET_EVERY, start = 4.6, len = 2.4;
  if (x < start || x > start + len) return;
  const u = (x - start) / len;
  const e = smooth(clamp(u / 0.17, 0, 1)) * smooth(clamp((1 - u) / 0.2, 0, 1));
  const kind = Math.floor(hash(cyc * 7 + Math.round((s.seed || 0) * 100)) * 4);
  const q = _tmpA;
  q.set(p);
  if (kind === 0) { // hands on hips, a sassy head tilt
    arms(q, ARMS.hip); q[headZ] = 0.13; q[chestX] = -0.08; q[headY] = 0.16;
  } else if (kind === 1) { // check the bow
    arm(q, 'R', [2.05, -0.55, 1.0, 2.05]); q[headZ] = -0.12; q[headX] = 0.06; q[chestZ] = 0.04;
  } else if (kind === 2) { // bounce on the toes
    const b = Math.abs(Math.sin(u * Math.PI * 5));
    q[rootY] += 0.03 * b; q[fL] = 0.3 * b; q[fR] = 0.3 * b; q[kL] = 0.1 * (1 - b); q[kR] = 0.1 * (1 - b);
    arms(q, [0.3, 0.35, 0, 1.25]);
  } else { // a big stretch
    arms(q, [2.85, 0.12, 0, 0.25]); q[chestX] = -0.16; q[headX] = -0.16; q[rootY] += 0.008; q[fL] = 0.12; q[fR] = 0.12;
  }
  lerpPose(p, p, q, e);
}

function walkPose(p, ph, s) {
  stand(p);
  const sn = Math.sin(ph), cs = Math.cos(ph);
  p[lLz] = 0.46 * sn; p[lRz] = -0.46 * sn;
  p[kL] = 0.05 + 0.85 * Math.pow(Math.max(0, cs), 1.6); p[kR] = 0.05 + 0.85 * Math.pow(Math.max(0, -cs), 1.6);
  p[fL] = 0.32 * Math.max(0, -sn) - 0.12 * Math.max(0, sn); p[fR] = 0.32 * Math.max(0, sn) - 0.12 * Math.max(0, -sn);
  p[aLz] = -0.42 * sn; p[aRz] = 0.42 * sn; p[aLx] = 0.15; p[aRx] = 0.15;
  p[eL] = 0.3 + 0.28 * Math.max(0, -sn); p[eR] = 0.3 + 0.28 * Math.max(0, sn);
  p[rootY] = -0.024 + 0.032 * cs * cs;
  p[roll] = 0.035 * sn; p[waistY] = -0.1 * sn; p[chestY] = 0.13 * sn; p[headY] = -0.05 * sn;
  p[chestX] = -0.035; p[headX] = -0.02;
}
function runPose(p, ph, s) {
  stand(p);
  const sn = Math.sin(ph), cs = Math.cos(ph);
  p[pitch] = 0.17;
  p[lLz] = 0.24 + 0.92 * sn; p[lRz] = 0.24 - 0.92 * sn;
  p[kL] = 0.3 + 1.45 * Math.max(0, cs); p[kR] = 0.3 + 1.45 * Math.max(0, -cs);
  p[fL] = 0.32 + 0.3 * Math.max(0, -sn); p[fR] = 0.32 + 0.3 * Math.max(0, sn);
  p[aLz] = 0.18 - 0.95 * sn; p[aRz] = 0.18 + 0.95 * sn; p[aLx] = 0.2; p[aRx] = 0.2;
  p[eL] = 1.55; p[eR] = 1.55; p[aLt] = -0.25; p[aRt] = -0.25;
  p[rootY] = -0.045 + 0.075 * sn * sn;
  p[chestY] = 0.2 * sn; p[waistY] = -0.14 * sn; p[headY] = -0.08 * sn;
  p[chestX] = 0.03; p[headX] = -0.17; p[roll] = 0.02 * sn;
}
const _idle = new Float32Array(NCH), _walk = new Float32Array(NCH), _run = new Float32Array(NCH);
export function locomotion(p, t, s) {
  idlePose(_idle, t, s);
  if (s.move <= 0.001) { p.set(_idle); return p; }
  walkPose(_walk, s.phase, s);
  if (s.run > 0.001) { runPose(_run, s.phase, s); lerpPose(_walk, _walk, _run, clamp(s.run, 0, 1)); }
  return lerpPose(p, _idle, _walk, clamp(s.move, 0, 1));
}
def('idle', { kind: 'move', loop: true, cycle: 8, pose: (p, t, s) => locomotion(p, t, s) });
def('walk', { kind: 'move', loop: true, cycle: 1, pose: (p, t, s) => locomotion(p, t, s) });
def('run', { kind: 'move', loop: true, cycle: 0.6, face: 'grin', pose: (p, t, s) => locomotion(p, t, s) });

// -- jumping and landing (the player moves the body; these only pose it)
const AIR_STRAIGHT = K((p) => { feetTogether(p); p[fL] = 0.85; p[fR] = 0.85; arms(p, ARMS.highV); p[chestX] = -0.08; p[headX] = -0.08; });
const JUMP = [
  [0, K((p) => { crouch(p, 0.57); arms(p, ARMS.lowV); p[chestX] = 0.08; })],
  [0.3, K((p) => { feetTogether(p); p[fL] = 0.7; p[fR] = 0.7; arms(p, ARMS.highV); p[chestX] = -0.1; p[headX] = -0.1; }), easeOut],
  [1, K((p) => { leg(p, 'L', 0.05, 0.38, 0, 0.62, 0.55); leg(p, 'R', 0.05, 0.12, 0, 0.3, 0.6); arms(p, [2.15, 0.45, 0, 0.35]); p[chestX] = -0.06; p[headX] = -0.06; })],
];
def('jump', { kind: 'move', dur: 0.42, blend: 0.07, face: 'grin', air: true, pose: (p, u) => keys(p, u, JUMP) });
def('fall', {
  kind: 'move', loop: true, cycle: 1.5, blend: 0.25, face: 'wow', air: true,
  pose(p, t, s) {
    stand(p);
    const m = s.m, a = Math.sin(t * 4.2) * m, b = Math.sin(t * 3.1 + 1) * m;
    arms(p, [1.95 + 0.25 * a, 0.35, 0, 0.5 + 0.2 * b], [1.95 - 0.25 * a, 0.35, 0, 0.5 - 0.2 * b]);
    leg(p, 'L', 0.12, 0.3 + 0.2 * b, 0, 0.55 + 0.25 * a, 0.45);
    leg(p, 'R', 0.12, 0.15 - 0.2 * b, 0, 0.4 - 0.25 * a, 0.45);
    p[chestX] = -0.12; p[headX] = -0.18; p[pitch] = -0.08;
  },
});
const LAND = [
  [0, K((p) => { p[pitch] = 0.1; crouch(p, 0.54, 0.02); arms(p, [0.95, 0.7, 0, 0.4]); p[chestX] = 0.14; })],
  [0.32, K((p) => { p[pitch] = 0.14; crouch(p, 0.5, 0.02); arms(p, [0.7, 0.62, 0, 0.5]); p[chestX] = 0.2; }), easeOut],
  [1, K(() => {})],
];
def('land', { kind: 'move', dur: 0.45, blend: 0.05, face: 'grin', pose: (p, u) => keys(p, u, LAND) });

// -- reactions
function calm(p, t, s) {
  stand(p);
  const br = Math.sin(t * 1.8) * s.m;
  p[rootY] = -0.004 + 0.003 * br; p[chestX] = -0.05 - 0.012 * br;
}
def('wave', {
  kind: 'react', loop: true, cycle: 1.4, face: 'grin', blend: 0.18,
  pose(p, t, s) {
    calm(p, t, s);
    const w = Math.sin(t * 9) * s.m;
    arms(p, ARMS.hip, [2.45, 0.4, 0.35, 0.5 + 0.38 * w]);
    p[headZ] = -0.13; p[headY] = 0.06; p[roll] = -0.03; p[chestZ] = 0.05;
    p[rootY] += 0.012 * Math.abs(Math.sin(t * 4.5)) * s.m;
  },
});
const CHEER_DOWN = K((p) => { crouch(p, 0.575); arms(p, [2.3, 0.36, 0, 0.18]); p[chestX] = -0.04; });
const CHEER_UP = K((p) => { feetTogether(p); p[rootY] = 0.13; p[fL] = 0.6; p[fR] = 0.6; arms(p, [2.55, 0.3, 0, 0.02]); p[chestX] = -0.12; p[headX] = -0.16; });
def('cheer', {
  kind: 'react', loop: true, cycle: 1.54, face: 'happy', blend: 0.15,
  pose(p, t, s) {
    const j = Math.abs(Math.sin(t * Math.PI * 2.6)) * s.m;
    lerpPose(p, CHEER_DOWN, CHEER_UP, j);
    const pump = Math.sin(t * Math.PI * 5.2) * s.m;
    p[aLx] += 0.1 * pump; p[aRx] -= 0.1 * pump; p[roll] = 0.03 * pump;
  },
});
const CLAP_OPEN = K((p) => { arms(p, [0.38, 0.92, 0.2, 1.4]); p[chestX] = -0.06; });
const CLAP_SHUT = K((p) => { arms(p, [-0.1, 0.98, 0.2, 1.3]); p[ikL] = 1; p[ikR] = 1; p[kL] = 0.12; p[kR] = 0.12; p[rootY] = -0.012; p[chestX] = -0.06; });
def('clap', {
  kind: 'react', loop: true, cycle: 1.25, face: 'happy', blend: 0.15,
  pose(p, t, s) {
    const c = 0.5 + 0.5 * Math.cos(t * TAU * 1.6);
    lerpPose(p, CLAP_SHUT, CLAP_OPEN, s.m < 0.5 ? 0.4 : smooth(c));
    p[headZ] = 0.06 * Math.sin(t * TAU * 0.8) * s.m; p[headX] = -0.04;
  },
}, {
  armL: { bone: 'chest', at: [0.022, 0.12, 0.2], pole: [1, -1, -0.2] },
  armR: { bone: 'chest', at: [-0.022, 0.12, 0.2], pole: [-1, -1, -0.2] },
});
const SIT = K((p) => { p[rootY] = -0.15; leg(p, 'L', 0.05, 1.57, 0, 1.45, 0.3); leg(p, 'R', 0.05, 1.57, 0, 1.45, 0.3); arms(p, [0.32, 0.28, 0, 0.32]); p[chestX] = -0.03; });
def('sit', {
  kind: 'react', loop: true, cycle: 2.4, face: 'smile', blend: 0.3,
  pose(p, t, s) {
    p.set(SIT);
    const m = s.m, k = Math.sin(t * 2.6);
    p[kL] = 1.35 + 0.3 * k * m; p[kR] = 1.35 - 0.3 * k * m;
    p[headY] = 0.3 * Math.sin(t * 0.37 + (s.seed || 0)) * m; p[headZ] = 0.05 * Math.sin(t * 0.9) * m;
    p[chestX] -= 0.012 * Math.sin(t * 1.8) * m;
  },
});
// A cheer dance: an arm motion on every count of an eight-count (120 bpm), bouncing on the beat.
const DANCE = ['highV', 't', 'lowV', 'clasp', 'punchR', 'punchL', 'dagger', 'touchdown'];
function danceArms(p, name) {
  if (name === 'punchR') arms(p, ARMS.hip, ARMS.touchdown);
  else if (name === 'punchL') arms(p, ARMS.touchdown, ARMS.hip);
  else arms(p, ARMS[name]);
}
def('dance', {
  kind: 'react', loop: true, cycle: 4, face: 'grin', blend: 0.15,
  pose(p, t, s) {
    const beat = t * 2, n = Math.floor(beat), f = beat - n, m = s.m;
    stand(p);
    _tmpA.set(p); _tmpB.set(p);
    danceArms(_tmpA, DANCE[(n + 7) % 8]);
    danceArms(_tmpB, DANCE[n % 8]);
    const k = snap(clamp(f / 0.28, 0, 1));
    for (let i = aLx; i <= eR; i++) p[i] = _tmpA[i] + (_tmpB[i] - _tmpA[i]) * k;
    const dip = Math.pow(1 - f, 3) * m, side = n % 2 ? 1 : -1;
    p[rootY] = -0.035 * dip; p[kL] = 0.05 + 0.22 * dip; p[kR] = 0.05 + 0.22 * dip;
    p[rootX] = 0.025 * side * smooth(clamp(f / 0.4, 0, 1)) * m;
    p[roll] = -0.07 * side * m; p[waistZ] = 0.06 * side * m;
    p[headZ] = 0.1 * side * m; p[headX] = -0.04 + 0.06 * dip;
    if (n % 8 === 7) { p[chestY] = 0.2 * smooth(f) * m; p[headY] = 0.15 * m; }
  },
});
const AWW = K((p) => { arms(p, [0.62, 0.5, 1.35, 1.5]); p[chestX] = -0.08; p[headZ] = 0.24; p[headX] = 0.05; p[rootY] = 0.006; p[waistZ] = -0.04; });
const AWW2 = K((p) => { arms(p, [0.42, 0.38, 1.2, 1.25]); p[headZ] = 0.18; p[headX] = 0.1; p[chestX] = -0.03; });
def('aww', { kind: 'react', dur: 1.6, face: 'aww', blend: 0.2, pose: (p, u) => keys(p, u, [[0, K(() => {})], [0.22, AWW, easeOut], [0.65, AWW], [1, AWW2]]) });

// -- games
const TH_WIND = K((p) => {
  arms(p, [0.35, 1.05, 0, 0.45], [1.5, -0.8, 0.9, 1.6]);
  p[chestY] = -0.52; p[waistY] = -0.2; p[pitch] = -0.04; p[headY] = 0.4;
  leg(p, 'L', 0.06, 0.3, 0, 0.12, 0); leg(p, 'R', 0.06, -0.18, 0, 0.18, 0.1);
});
const TH_REL = K((p) => {
  arms(p, [0.4, -0.35, 0, 0.6], [0.6, 1.72, 0.2, 0.22]);
  p[chestY] = 0.45; p[waistY] = 0.15; p[pitch] = 0.12; p[headY] = -0.05;
  leg(p, 'L', 0.06, 0.4, 0, 0.25, 0); leg(p, 'R', 0.06, -0.28, 0, 0.3, 0.4);
});
const TH_FOLLOW = K((p) => {
  arms(p, [0.3, -0.25, 0, 0.5], [-0.32, 0.95, 0.3, 0.6]);
  p[chestY] = 0.55; p[waistY] = 0.2; p[pitch] = 0.18;
  leg(p, 'L', 0.06, 0.42, 0, 0.28, 0); leg(p, 'R', 0.06, -0.3, 0, 0.35, 0.45);
});
def('throw', { kind: 'game', dur: 0.62, blend: 0.1, face: 'grin', release: 0.48, pose: (p, u) => keys(p, u, [[0, K(() => {})], [0.38, TH_WIND, easeOut], [0.5, TH_REL, snap], [0.72, TH_FOLLOW], [1, K(() => {})]]) });
const CA_REACH = K((p) => { arms(p, [0.1, 1.32, 0.9, 0.35]); p[chestX] = 0.1; p[kL] = 0.15; p[kR] = 0.15; p[rootY] = -0.006; });
const CA_HUG = K((p) => { crouch(p, 0.585); arms(p, [-0.12, 0.82, 0.6, 1.65]); p[chestX] = 0.16; p[headX] = 0.08; });
def('catch', { kind: 'game', dur: 0.5, blend: 0.08, face: 'grin', pose: (p, u) => keys(p, u, [[0, K(() => {})], [0.3, CA_REACH, easeOut], [0.65, CA_HUG], [1, CA_HUG]]) });
const DODGE = K((p) => {
  p[rootX] = 0.12; p[roll] = -0.34; crouch(p, 0.56);
  leg(p, 'L', 0.32, p[lLz], 0, p[kL] + 0.15, p[fL]); leg(p, 'R', -0.12, p[lRz], 0, p[kR], p[fR]);
  arms(p, [1.25, 0.5, 0, 0.8], [0.45, 0.6, 0, 1.4]); p[headZ] = -0.2; p[headX] = 0.1;
});
def('dodge', { kind: 'game', dur: 0.55, blend: 0.06, face: 'wow', pose: (p, u) => keys(p, u, [[0, K(() => {})], [0.26, DODGE, snap], [0.55, DODGE], [1, K(() => {})]]) });
const FROZEN = K((p) => {
  p[pitch] = 0.06; p[rootY] = -0.035;
  leg(p, 'L', 0.04, 0.42, 0, 0.18, -0.1); leg(p, 'R', 0.04, -0.34, 0, 0.5, 0.45);
  arms(p, [0.55, 1.1, 0, 0.6], [0.45, -0.7, 0, 0.5]); p[chestY] = 0.18; p[headZ] = 0.1; p[headX] = -0.05;
});
def('frozen', {
  kind: 'game', loop: true, cycle: 1, face: 'wow', blend: 0.08,
  pose(p, t, s) { p.set(FROZEN); const sh = Math.sin(t * 47) * 0.004 * s.m; p[rootX] += sh; p[roll] += sh * 2; },
});
const TAGGED = K((p) => { arms(p, [0.25, 0.55, 0, 2.2]); p[rootY] = 0.045; p[kL] = 0.25; p[kR] = 0.25; p[fL] = 0.4; p[fR] = 0.4; p[chestX] = -0.12; p[headX] = -0.1; p[headZ] = 0.1; });
def('tagged', { kind: 'game', dur: 0.75, blend: 0.05, face: 'wow', pose: (p, u) => keys(p, u, [[0, K(() => {})], [0.18, TAGGED, snap], [0.45, TAGGED], [1, K((q) => { q[headZ] = 0.15; arms(q, [0.25, 0.12, 0, 0.5]); })]]) });
const SEEK = K((p) => { arms(p, [0.3, 1.3, 0.4, 2.3]); p[headX] = 0.2; p[chestX] = 0.06; p[ikL] = 1; p[ikR] = 1; });
def('seek', {
  kind: 'game', loop: true, cycle: 4, face: 'smile', blend: 0.25,
  pose(p, t, s) {
    p.set(SEEK);
    const c = Math.abs(Math.sin(t * Math.PI)) * s.m;
    p[headX] += 0.07 * c; p[rootY] -= 0.006 * c; p[fR] = 0.25 * Math.max(0, Math.sin(t * TAU)) * s.m;
  },
}, {
  armL: { bone: 'head', at: [0.05, 0.2, 0.2], pole: [1, -0.6, 0] },
  armR: { bone: 'head', at: [-0.05, 0.2, 0.2], pole: [-1, -0.6, 0] },
});
const HIDE = K((p) => {
  p[pitch] = 0.42; crouch(p, 0.31, 0.07); p[lLx] = 0.16; p[lRx] = 0.16;
  arms(p, [-0.05, 1.2, 0.2, 1.35]); p[waistX] = 0.2; p[chestX] = 0.15; p[headX] = 0.12;
});
def('hide', {
  kind: 'game', loop: true, cycle: 3, face: 'smile', blend: 0.25,
  pose(p, t, s) { p.set(HIDE); p[chestX] += 0.015 * Math.sin(t * 2.2) * s.m; p[headY] = 0.3 * Math.sin(t * 0.6) * s.m; },
});
const BASE = K((p) => { p[pitch] = 0.12; p[lLx] = 0.22; p[lRx] = 0.22; crouch(p, 0.5); arms(p, ARMS.ready); p[chestX] = -0.12; p[headX] = -0.06; });
def('base', {
  kind: 'game', loop: true, cycle: 2, face: 'grin', blend: 0.2,
  pose(p, t, s) {
    p.set(BASE);
    const b = 0.5 - 0.5 * Math.cos(t * TAU * 0.5);
    p[rootY] -= 0.015 * b * s.m; p[kL] += 0.06 * b * s.m; p[kR] += 0.06 * b * s.m;
  },
});
const CRADLE = K((p) => {
  p[pitch] = -0.62;
  leg(p, 'L', 0.03, 1.58, 0, 0.05, 0.9); leg(p, 'R', 0.03, 1.58, 0, 0.05, 0.9);
  p[waistX] = 0.12; p[chestX] = -0.04; p[headX] = -0.14;
  arms(p, [1.35, 0.6, 0, 0.35]);
});
def('cradle', {
  kind: 'game', loop: true, cycle: 2, face: 'happy', blend: 0.12, hipY: RIG.hipY,
  pose(p, t, s) { p.set(CRADLE); p[rootY] = 0.01 * Math.sin(t * 3) * s.m; p[headZ] = 0.05 * Math.sin(t * 1.3) * s.m; },
});

// -- arm motions: hit sharp, hold strong, a little dip on the hit
function motion(name, L, R, extra, ik) {
  const HOLD = K((p) => { feetTogether(p); arms(p, L, R || L); if (extra) extra(p); });
  def(name, {
    kind: 'arm', loop: true, cycle: 0.5, face: 'grin', blend: 0.09,
    pose(p, t, s) {
      p.set(HOLD);
      const h = t < 0.3 ? Math.sin((t / 0.3) * Math.PI) * s.m : 0;
      p[kL] += 0.12 * h; p[kR] += 0.12 * h; p[rootY] -= 0.01 * h; p[headX] += 0.05 * h;
      p[chestX] -= 0.01 * Math.sin((s.t || 0) * 1.8) * s.m;
    },
  }, ik);
}
motion('highV', ARMS.highV);
motion('lowV', ARMS.lowV);
motion('tMotion', ARMS.t);
motion('touchdown', ARMS.touchdown);
motion('daggers', ARMS.dagger);
motion('punch', ARMS.hip, ARMS.touchdown, (p) => { p[headY] = -0.04; p[chestZ] = 0.03; });
motion('clasp', ARMS.clasp, ARMS.clasp, (p) => { p[ikL] = 1; p[ikR] = 1; p[headX] = -0.04; }, {
  armL: { bone: 'chest', at: [0.018, 0.2, 0.18], pole: [1, -1, 0] },
  armR: { bone: 'chest', at: [-0.018, 0.2, 0.18], pole: [-1, -1, 0] },
});

// -- flyer tricks: from the ground they jump on their own; in the air (a toss) they play in place.
// Twists and kick doubles never turn the whole body: whoever moves her (the toss, through heading)
// spins her, using ANIM_INFO[name].turns and spinAt / airSpinAt (fractions of the clip).
const PREP = K((p) => { arms(p, ARMS.highV); p[chestX] = -0.06; });
const DIP = K((p) => { p[pitch] = 0.08; crouch(p, 0.5, 0.02); arms(p, ARMS.whip); p[chestX] = 0.18; p[headX] = 0.06; });
const LIFT = K((p) => { feetTogether(p); p[fL] = 0.8; p[fR] = 0.8; arms(p, ARMS.highV); p[chestX] = -0.12; p[headX] = -0.1; });
const SNAP_DOWN = K((p) => { feetTogether(p); p[fL] = 0.7; p[fR] = 0.7; p[kL] = 0.12; p[kR] = 0.12; arms(p, [0.32, 0.12, 0, 0.12]); });
const TOUCH = K((p) => { p[pitch] = 0.06; crouch(p, 0.52, 0.02); arms(p, [0.28, 0.3, 0, 0.35]); p[chestX] = 0.14; });
const END = K(() => {});
const WRAP = K((p) => { feetTogether(p); p[fL] = 0.9; p[fR] = 0.9; arms(p, ARMS.wrap); p[chestX] = -0.04; p[headX] = -0.02; });
const OPEN = K((p) => { feetTogether(p); p[fL] = 0.85; p[fR] = 0.85; arms(p, ARMS.highV); p[chestX] = -0.1; p[headX] = -0.08; });

function trick(name, o) {
  def(name, {
    kind: 'trick', trick: true, dur: o.dur, blend: 0.1, face: 'grin',
    turns: o.spin ? o.spin[2] / TAU : 0,
    spinAt: o.spin ? [o.spin[0], o.spin[1]] : null,
    airSpinAt: o.airSpin ? [o.airSpin[0], o.airSpin[1]] : null,
    pose(p, u, s) {
      if (s.ground !== false) {
        keys(p, u, o.ground);
        if (o.hop) hop(p, u, o.hop[0], o.hop[1], o.hop[2]);
      } else keys(p, u, o.air);
    },
  }, o.ik);
}
// How far round a twisting trick should have turned her at u (0..1 of the clip), in radians.
// The caller applies it to her heading; the clip itself never spins the body.
export function trickSpin(name, u, ground = true) {
  const c = CLIPS[name];
  if (!c || !c.turns) return 0;
  const w = ground ? c.spinAt : c.airSpinAt || c.spinAt;
  return c.turns * TAU * smooth(clamp((u - w[0]) / (w[1] - w[0]), 0, 1));
}
// Toe touch: legs straddled out forward and level, knees up, toes pointed, arms in a T.
const TT_HIT = K((p) => {
  p[pitch] = -0.08;
  leg(p, 'L', 1.42, 0.5, 1.3, 0, 0.95); leg(p, 'R', 1.42, 0.5, 1.3, 0, 0.95);
  arms(p, ARMS.t); p[chestX] = -0.22; p[waistX] = -0.04; p[headX] = -0.14;
});
trick('toeTouch', {
  dur: 0.95,
  ground: [[0, PREP], [0.16, DIP], [0.32, LIFT, easeOut], [0.46, TT_HIT, snap], [0.62, TT_HIT], [0.78, SNAP_DOWN], [0.9, TOUCH, easeOut], [1, END]],
  hop: [0.3, 0.88, 0.58],
  air: [[0, AIR_STRAIGHT], [0.26, TT_HIT, snap], [0.62, TT_HIT], [0.86, AIR_STRAIGHT], [1, AIR_STRAIGHT]],
});
// Pike: legs together straight out in front, folded at the hips, hands to the toes.
const PK_HIT = K((p) => {
  p[pitch] = 0.32;
  leg(p, 'L', 0.03, 1.98, 0, 0, 0.95); leg(p, 'R', 0.03, 1.98, 0, 0, 0.95);
  p[waistX] = 0.28; p[chestX] = 0.32; p[headX] = -0.32;
  arms(p, [0.15, 1.9, 0, 0.05]); p[ikL] = 1; p[ikR] = 1;
});
const toes = (side) => ({ bone: side === 'L' ? 'footL' : 'footR', at: [0, -0.012, 0.115], pole: [side === 'L' ? 1 : -1, 1, 0] });
trick('pike', {
  dur: 0.95,
  ground: [[0, PREP], [0.16, DIP], [0.32, LIFT, easeOut], [0.47, PK_HIT, snap], [0.62, PK_HIT], [0.78, SNAP_DOWN], [0.9, TOUCH, easeOut], [1, END]],
  hop: [0.3, 0.88, 0.6],
  air: [[0, AIR_STRAIGHT], [0.27, PK_HIT, snap], [0.62, PK_HIT], [0.86, AIR_STRAIGHT], [1, AIR_STRAIGHT]],
  ik: { armL: toes('L'), armR: toes('R') },
});
// Kick double: a high kick, then two full spins with the arms wrapped tight.
const KD_KICK = K((p) => {
  p[pitch] = -0.1;
  leg(p, 'R', 0.12, 2.85, 0.2, 0, 0.95); leg(p, 'L', -0.02, -0.1, 0, 0, 0.9);
  arms(p, ARMS.t); p[chestX] = -0.12; p[headX] = -0.06;
});
trick('kickDouble', {
  dur: 1.35,
  ground: [[0, PREP], [0.1, DIP], [0.2, LIFT, easeOut], [0.3, KD_KICK, snap], [0.38, KD_KICK], [0.46, WRAP, easeOut], [0.8, WRAP], [0.86, OPEN], [0.93, TOUCH, easeOut], [1, END]],
  hop: [0.19, 0.91, 0.82],
  spin: [0.44, 0.83, 2 * TAU],
  air: [[0, AIR_STRAIGHT], [0.14, KD_KICK, snap], [0.24, KD_KICK], [0.32, WRAP, easeOut], [0.8, WRAP], [0.9, OPEN], [1, AIR_STRAIGHT]],
  airSpin: [0.3, 0.84, 2 * TAU],
});
// Twist: one full twisting turn, body tight.
trick('twist', {
  dur: 0.95,
  ground: [[0, PREP], [0.14, DIP], [0.28, LIFT, easeOut], [0.36, WRAP, easeOut], [0.74, WRAP], [0.82, OPEN], [0.92, TOUCH, easeOut], [1, END]],
  hop: [0.26, 0.9, 0.6],
  spin: [0.33, 0.77, TAU],
  air: [[0, AIR_STRAIGHT], [0.14, WRAP, easeOut], [0.76, WRAP], [0.88, OPEN], [1, AIR_STRAIGHT]],
  airSpin: [0.12, 0.8, TAU],
});

// -- flyer body positions: held on one leg with a little balance sway
function position(name, build, ik) {
  const HOLD = K(build);
  def(name, {
    kind: 'position', loop: true, cycle: 2, face: 'grin', blend: 0.28,
    pose(p, t, s) {
      p.set(HOLD);
      const m = s.m;
      p[roll] += 0.012 * Math.sin(t * 1.3) * m; p[chestZ] += 0.01 * Math.sin(t * 1.1 + 1) * m;
      p[chestX] -= 0.01 * Math.sin((s.t || 0) * 1.8) * m;
    },
  }, ik);
}
// Liberty: up on one straight leg, the other knee bent with its foot at the standing knee, high V.
position('liberty', (p) => {
  standOn(p, 'L');
  leg(p, 'R', 0.3, 1.1, 0.5, 2.1, 0.85); p[ikLR] = 1;
  arms(p, ARMS.highV); p[chestX] = -0.1; p[headX] = -0.08;
}, { legR: { bone: 'shinL', at: [-0.01, 0.025, 0.035], pole: [-0.35, 0, 1] } });
// Heel stretch: the free leg held straight up by the same-side hand, the other arm in a high V.
position('heelStretch', (p) => {
  standOn(p, 'L'); p[roll] = -0.04;
  leg(p, 'R', 0.72, 2.5, 0.35, 0, 0.8);
  arms(p, ARMS.highV, [1.9, 1.3, 0, 0.4]); p[ikR] = 1; p[chestX] = -0.06;
}, { armR: { bone: 'footR', at: [0, 0.012, -0.03], pole: [-1, 0.2, 0.4] } });
// Scorpion: the back leg bent up behind toward the head, pulled with both hands.
position('scorpion', (p) => {
  p[pitch] = 0.22; standOn(p, 'L');
  leg(p, 'R', 0.15, -2.3, -0.3, 1.5, 0.9); p[ikLR] = 1;
  p[waistX] = -0.28; p[chestX] = -0.42; p[headX] = -0.22;
  arms(p, [2.7, -0.6, 0, 1.1]); p[ikL] = 1; p[ikR] = 1;
}, {
  legR: { bone: 'head', at: [-0.035, 0.16, -0.2], pole: [-0.15, -0.6, -1] },
  armL: { bone: 'footR', at: [0.03, -0.005, 0.06], pole: [1, 0.8, 0.2] },
  armR: { bone: 'footR', at: [-0.03, -0.005, 0.06], pole: [-1, 0.8, 0.2] },
});
// Bow and arrow: one leg held up high by the opposite hand over the head, the other arm drawn
// across the chest like pulling a bowstring.
position('bowArrow', (p) => {
  standOn(p, 'L'); p[roll] = -0.1;
  leg(p, 'R', 2.7, -0.25, 0.7, 0, 0.85);
  arms(p, [2.9, 0.1, 0, 0.6], [-0.42, 1.35, 0.2, 1.55]); p[ikL] = 1;
  p[headY] = 0.15; p[chestX] = -0.05; p[chestZ] = -0.05;
}, { armL: { bone: 'footR', at: [0, 0.0, -0.025], pole: [0.4, 1, 0.3] } });
// Arabesque: one leg extended straight back, chest up, arms in a high V.
position('arabesque', (p) => {
  p[pitch] = 0.25; standOn(p, 'L');
  leg(p, 'R', 0.08, -1.35, 0.3, 0, 0.9);
  p[chestX] = -0.3; p[waistX] = -0.05; p[headX] = -0.2;
  arms(p, ARMS.highV);
});

// ---- public --------------------------------------------------------------------------------------
export const ANIM_GROUPS = Object.freeze({
  move: ['idle', 'walk', 'run', 'jump', 'fall', 'land'],
  react: ['wave', 'cheer', 'clap', 'sit', 'dance', 'aww'],
  game: ['throw', 'catch', 'dodge', 'frozen', 'tagged', 'seek', 'hide', 'base', 'cradle'],
  arm: ['highV', 'lowV', 'tMotion', 'touchdown', 'daggers', 'punch', 'clasp'],
  trick: ['toeTouch', 'pike', 'kickDouble', 'twist'],
  position: ['liberty', 'heelStretch', 'scorpion', 'bowArrow', 'arabesque'],
});
export const ANIM_NAMES = Object.freeze(Object.values(ANIM_GROUPS).flat());

export const ANIM_INFO = Object.freeze(Object.fromEntries(ANIM_NAMES.map((n) => {
  const c = CLIPS[n];
  const info = { kind: c.kind, loop: c.loop, duration: c.loop ? c.cycle : c.dur, face: c.face, trick: !!c.trick, air: !!c.air, blend: c.blend };
  if (c.release !== undefined) info.release = c.release;
  if (c.turns) Object.assign(info, { turns: c.turns, spinAt: Object.freeze(c.spinAt), airSpinAt: Object.freeze(c.airSpinAt) });
  if (c.hipY !== undefined) info.hipY = c.hipY;
  if (n === 'sit') info.seatY = 0.42;
  return [n, Object.freeze(info)];
})));

export const ANIM_IK = Object.freeze(IK);

export function hasAnim(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ANIM_INFO, name);
}

// time: seconds since the clip started (already scaled by its speed).
export function evalAnim(name, out, time, s, loop) {
  const c = CLIPS[hasAnim(name) ? name : 'idle'];
  const lp = loop === undefined ? c.loop : loop;
  if (c.loop) c.pose(out, lp ? time : Math.min(time, c.cycle - 1e-4), s);
  else {
    const u = lp ? (time / c.dur) % 1 : Math.min(1, time / c.dur);
    c.pose(out, u, s);
  }
  return out;
}

export function isDone(name, time, loop) {
  const c = CLIPS[hasAnim(name) ? name : 'idle'];
  const lp = loop === undefined ? c.loop : loop;
  if (lp) return false;
  return time >= (c.loop ? c.cycle : c.dur);
}
