// A canvas-drawn cheerleader and the cheer-motion icons built from her. Shapes only: no images.
//
//   POSES                                  { ready, sway, highV, lowV, tMotion, touchdown, daggers, punch, clasp, toeTouch, pike,
//                                            kickDouble, twist, liberty, heelStretch, scorpion, bowArrow, arabesque, cheer }
//   ARM_MOTIONS                            the poses that are all about the arms (their icons frame the upper body)
//   skeleton(pose) / poseSkeleton(name)    -> joint points (figure units, hips at 0,0, y down)
//   blendSkeleton(a, b, t, out?)           -> joints part way between two poses
//   drawFigure(ctx, x, y, size, joints, opts)   feet at (x, y), `size` pixels from the feet to the top of the bow
//        opts: { look: { skin, hair, bow, top, shorts, shoes, pom, pom2 }, poms, t (seconds), detail: 'full' | 'icon' }
//   drawBow(ctx, x, y, w, color, { tails, stars, outline, rot })   the signature cheer bow
//   drawPom(ctx, x, y, r, color, color2, t, outline)   a pom-pom
//   starPath(ctx, x, y, r, points, inner)   a star outline to fill
//   drawMotionIcon(ctx, cx, cy, r, motion, { color, ring, fill, t })   a round badge with the figure in that pose
//   iconCanvas(motion, px, color, dpr, fill)   -> a cached canvas of drawMotionIcon
//
// The default look follows Bailey's outfit (Contract 3 DEFAULT_LOOK): dark brown high ponytail,
// a big hot-pink bow with small black stars, a black rhinestone crop top, hot-pink shorts,
// black cheer shoes and sparkly black socks.

import { PALETTE } from '../config.js';

export const DEFAULT_FIGURE_LOOK = {
  skin: '#f0c5a0',
  hair: '#4a2a1e',
  bow: PALETTE.pink,
  top: PALETTE.black,
  shorts: PALETTE.pink,
  shoes: PALETTE.black,
  pom: PALETTE.pink,
  pom2: PALETTE.rhinestoneSilver,
};

const INK = PALETTE.ink;
const RAD = Math.PI / 180;

// Figure units: hips at (0, 0), y down.
const SH = { x: 0.17, y: -0.55 }; // shoulder
const HIP = 0.1;
const UA = 0.29; // upper arm
const FA = 0.27; // forearm
const TH = 0.39; // thigh
const SN = 0.39; // shin
const NECK = -0.6;
const HEAD_Y = -0.9;
const HEAD_R = 0.29;
const FEET = TH + SN + 0.05; // standing: the soles
const TOP = -(Math.abs(HEAD_Y) + HEAD_R + 0.14); // top of the bow
const FIG_H = FEET - TOP;

// Angles in degrees from straight down, positive outward (toward the figure's own side of the
// screen): [upper, lower]. A limb can instead reach for a point: { to: [x, y] | 'footR', bend, stretch }.
const STAND = { legL: [4, 2], legR: [4, 2] };
export const POSES = {
  ready: { armL: [38, -52], armR: [38, -52], ...STAND },
  sway: { armL: [24, -100], armR: [24, -100], ...STAND },
  highV: { armL: [146, 146], armR: [146, 146], ...STAND, face: 'open' },
  lowV: { armL: [32, 32], armR: [32, 32], ...STAND },
  tMotion: { armL: [90, 90], armR: [90, 90], ...STAND, face: 'open' },
  touchdown: { armL: [164, 168], armR: [164, 168], ...STAND, face: 'open' },
  daggers: { armL: [22, 176], armR: [22, 176], ...STAND },
  punch: { armL: [38, -52], armR: [166, 172], legL: [6, 2], legR: [16, -6], tilt: -4, face: 'open' },
  clasp: { armL: [20, -112], armR: [20, -112], ...STAND, face: 'open' },
  toeTouch: { armL: [104, 104], armR: [104, 104], legL: [100, 104], legR: [100, 104], lift: -0.55, face: 'open' },
  pike: { armL: { to: [0.62, -0.02], bend: -1 }, armR: { to: [0.68, 0.02], bend: -1 }, legL: [-84, -86], legR: [90, 92], legLBehind: true, lift: -0.5, tilt: 16 },
  kickDouble: { armL: [92, 92], armR: [92, 92], legL: [2, 0], legR: [168, 172], lift: -0.2, face: 'open' },
  twist: { armL: { to: [0.08, -0.42], bend: 1 }, armR: { to: [-0.08, -0.46], bend: 1 }, legL: [1, 0], legR: [1, 0], lift: -0.45, spin: true },
  liberty: { armL: [146, 146], armR: [146, 146], legL: [1, 0], legR: [74, -58], lift: -0.08, face: 'open' },
  heelStretch: { armL: [140, 140], armR: { to: 'footR', bend: 1 }, legL: [1, 0], legR: [158, 164], lift: -0.08, tilt: -6, face: 'open' },
  scorpion: { armL: { to: [0.4, -1.24], bend: -1 }, armR: { to: [0.5, -1.2], bend: 1 }, legL: [1, 0], legR: { to: [0.48, -1.32], bend: 1, stretch: 1.3 }, legRBehind: true, lift: -0.08, tilt: -6 },
  bowArrow: { armL: [118, 118], armR: { to: 'footR', bend: 1 }, legL: [1, 0], legR: [150, 170], lift: -0.08, tilt: -8 },
  arabesque: { armL: [128, 128], armR: [70, 70], legL: [2, 0], legR: [104, 106], tilt: -12 },
  cheer: { armL: [150, 150], armR: [150, 150], legL: [10, -12], legR: [10, -12], lift: -0.3, face: 'open' },
};

export const ARM_MOTIONS = new Set(['ready', 'sway', 'highV', 'lowV', 'tMotion', 'touchdown', 'daggers', 'punch', 'clasp']);

const dir = (side, deg) => [side * Math.sin(deg * RAD), Math.cos(deg * RAD)];

function rotVec(x, y, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

// two-bone reach: where the elbow (or knee) goes so the hand (or foot) lands on the target
function reach(ax, ay, tx, ty, l1, l2, bend) {
  let dx = tx - ax;
  let dy = ty - ay;
  let d = Math.hypot(dx, dy) || 1e-6;
  const max = l1 + l2 - 1e-4;
  if (d > max) {
    tx = ax + (dx / d) * max;
    ty = ay + (dy / d) * max;
    dx = tx - ax;
    dy = ty - ay;
    d = max;
  }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mx = ax + (dx * a) / d;
  const my = ay + (dy * a) / d;
  return { ex: mx - (bend * h * dy) / d, ey: my + (bend * h * dx) / d, hx: tx, hy: ty };
}

export function skeleton(pose) {
  const p = typeof pose === 'string' ? POSES[pose] || POSES.ready : pose || POSES.ready;
  const lift = p.lift || 0;
  const tilt = (p.tilt || 0) * RAD;
  const j = { lift, tilt: p.tilt || 0, face: p.face || 'smile', spin: !!p.spin, legLBehind: !!p.legLBehind, legRBehind: !!p.legRBehind };
  // legs first: a hand may reach for a foot
  for (const [name, side] of [['L', -1], ['R', 1]]) {
    const spec = p['leg' + name] || [4, 2];
    const hx = side * HIP;
    j['hip' + name] = [hx, 0];
    if (Array.isArray(spec)) {
      const [kx, ky] = dir(side, spec[0]);
      const [fx, fy] = dir(side, spec[1]);
      j['knee' + name] = [hx + kx * TH, ky * TH];
      j['foot' + name] = [hx + kx * TH + fx * SN, ky * TH + fy * SN];
    } else {
      const s = spec.stretch || 1;
      const r = reach(hx, 0, spec.to[0], spec.to[1], TH * s, SN * s, (spec.bend || 1) * side);
      j['knee' + name] = [r.ex, r.ey];
      j['foot' + name] = [r.hx, r.hy];
    }
  }
  // the upper body leans around the hips
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const rot = (x, y) => [x * c - y * s, x * s + y * c];
  j.neck = rot(0, NECK);
  j.head = rot(0, HEAD_Y);
  for (const [name, side] of [['L', -1], ['R', 1]]) {
    const sh = rot(side * SH.x, SH.y);
    j['shoulder' + name] = sh;
    const spec = p['arm' + name] || [38, -52];
    if (Array.isArray(spec)) {
      // arm angles are relative to the torso
      const u = rotVec(...dir(side, spec[0]), tilt);
      const f = rotVec(...dir(side, spec[1]), tilt);
      const e = [sh[0] + u[0] * UA, sh[1] + u[1] * UA];
      j['elbow' + name] = e;
      j['hand' + name] = [e[0] + f[0] * FA, e[1] + f[1] * FA];
    } else {
      const target = typeof spec.to === 'string' ? j[spec.to] : spec.to;
      const r = reach(sh[0], sh[1], target[0], target[1], UA, FA, (spec.bend || 1) * side);
      j['elbow' + name] = [r.ex, r.ey];
      j['hand' + name] = [r.hx, r.hy];
    }
  }
  for (const k of JOINTS) j[k] = [j[k][0], j[k][1] + lift];
  return j;
}

const JOINTS = ['hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR', 'neck', 'head', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR'];

export function blendSkeleton(a, b, t, out = {}) {
  t = Math.max(0, Math.min(1, t));
  for (const k of JOINTS) {
    const p = a[k];
    const q = b[k];
    const o = out[k] || (out[k] = [0, 0]);
    o[0] = p[0] + (q[0] - p[0]) * t;
    o[1] = p[1] + (q[1] - p[1]) * t;
  }
  out.lift = a.lift + (b.lift - a.lift) * t;
  out.tilt = a.tilt + (b.tilt - a.tilt) * t;
  const late = t > 0.5 ? b : a;
  out.face = late.face;
  out.spin = late.spin;
  out.legLBehind = late.legLBehind;
  out.legRBehind = late.legRBehind;
  return out;
}

const skelCache = new Map();
export function poseSkeleton(name) {
  if (!skelCache.has(name)) skelCache.set(name, skeleton(POSES[name] ? name : 'ready'));
  return skelCache.get(name);
}

// ------------------------------------------------------------------ drawing

function limb(ctx, pts, width, color, outline) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (outline) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = width + outline * 2;
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function starPath(ctx, x, y, r, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// a pom-pom: fat strands in two colours, each with an ink edge, around a solid middle
export function drawPom(ctx, x, y, r, c1, c2, t, olu, { strands = 20, thick = 0.3 } = {}) {
  const list = [];
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * Math.PI * 2 + Math.sin(t * 7 + i * 1.3) * 0.07;
    list.push([a, r * (0.8 + 0.2 * Math.sin(i * 3.7 + t * 5))]);
  }
  ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    list.forEach(([a, len], i) => {
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.strokeStyle = pass ? (i % 4 === 1 ? c2 : c1) : INK;
      ctx.lineWidth = r * thick + (pass ? 0 : olu * 2);
      ctx.stroke();
    });
  }
  // a fuller pom gets a second, shorter layer of strands on top
  if (strands > 24) {
    for (let i = 0; i < strands * 0.6; i++) {
      const a = ((i + 0.5) / (strands * 0.6)) * Math.PI * 2;
      const len = r * (0.55 + 0.12 * Math.sin(i * 2.3));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.strokeStyle = i % 3 === 0 ? c2 : c1;
      ctx.lineWidth = r * thick;
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(x, y, r * (strands > 24 ? 0.3 : 0.5), 0, Math.PI * 2);
  ctx.fillStyle = c1;
  ctx.fill();
}

export function drawBow(ctx, x, y, w, color = PALETTE.pink, opts = {}) {
  // the signature cheer bow: two big loops, a knot and two tails, with small black stars
  const h = w * 0.55;
  ctx.save();
  ctx.translate(x, y);
  if (opts.rot) ctx.rotate(opts.rot);
  ctx.lineJoin = 'round';
  const outline = opts.outline ?? Math.max(1, w * 0.045);
  ctx.strokeStyle = INK;
  ctx.lineWidth = outline;
  ctx.fillStyle = color;
  if (opts.tails !== false) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * w * 0.04, h * 0.05);
      ctx.lineTo(s * w * 0.3, h * 0.95);
      ctx.lineTo(s * w * 0.2, h * 0.82);
      ctx.lineTo(s * w * 0.1, h * 1.0);
      ctx.lineTo(-s * w * 0.04, h * 0.12);
      ctx.closePath();
      ctx.fill();
      if (outline) ctx.stroke();
    }
  }
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(s * w * 0.18, -h * 0.95, s * w * 0.62, -h * 0.75, s * w * 0.5, 0);
    ctx.bezierCurveTo(s * w * 0.6, h * 0.55, s * w * 0.2, h * 0.5, 0, 0);
    ctx.closePath();
    ctx.fill();
    if (outline) ctx.stroke();
  }
  if (w > 18) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * w * 0.3, -h * 0.32, w * 0.07, h * 0.14, s * -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (opts.stars !== false && w > 14) {
    ctx.fillStyle = PALETTE.black;
    const sr = Math.max(1.2, w * 0.055);
    const spots = [[-0.36, -0.1], [-0.22, 0.18], [0.27, -0.2], [0.4, 0.12]];
    if (opts.tails !== false) spots.push([0.17, 0.62], [-0.2, 0.7]);
    for (const [sx, sy] of spots) {
      starPath(ctx, sx * w, sy * h, sr);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.11, h * 0.26, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) ctx.stroke();
  ctx.restore();
}

// Draws the figure with its feet (standing) at (x, y), `size` pixels tall.
export function drawFigure(ctx, x, y, size, j, opts = {}) {
  const look = opts.look ? { ...DEFAULT_FIGURE_LOOK, ...opts.look } : DEFAULT_FIGURE_LOOK;
  const t = opts.t || 0;
  const icon = opts.detail === 'icon';
  const k = size / FIG_H; // pixels per unit
  const ol = icon ? Math.max(0.9, k * 0.032) : Math.max(1.2, k * 0.034);
  const olu = ol / k;
  const armW = icon ? 0.1 : 0.088;
  const legW = icon ? 0.12 : 0.112;
  ctx.save();
  ctx.translate(x, y - FEET * k);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const head = j.head;
  const hx = head[0];
  const hy = head[1];
  const R = HEAD_R;

  // ponytail behind everything, from the crown, swinging
  const sway = Math.sin(t * 3.1) * 0.08 + (j.lift < -0.2 ? -0.1 : 0);
  {
    const px = hx + 0.05;
    const py = hy - R * 0.92;
    ctx.beginPath();
    ctx.moveTo(px - 0.07, py + 0.02);
    ctx.bezierCurveTo(px + 0.36 + sway, py - 0.1, px + 0.46 + sway * 2, py + 0.34, px + 0.18 + sway * 2.4, py + 0.6);
    ctx.bezierCurveTo(px + 0.25 + sway, py + 0.28, px + 0.16, py + 0.1, px + 0.07, py + 0.07);
    ctx.closePath();
    ctx.fillStyle = look.hair;
    ctx.fill();
    ctx.lineWidth = olu;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  const drawLeg = (n) => {
    const hip = j['hip' + n];
    const knee = j['knee' + n];
    const foot = j['foot' + n];
    limb(ctx, [hip, knee, foot], legW, look.skin, olu);
    // sparkly black socks over the lower shin
    limb(ctx, [[knee[0] + (foot[0] - knee[0]) * 0.55, knee[1] + (foot[1] - knee[1]) * 0.55], foot], legW * 1.02, look.shoes, 0);
    const side = n === 'L' ? -1 : 1;
    const ang = Math.atan2(foot[1] - knee[1], foot[0] - knee[0]);
    ctx.save();
    ctx.translate(foot[0], foot[1]);
    ctx.rotate(ang - Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(side * 0.03, 0.03, 0.085, 0.06, 0, 0, Math.PI * 2);
    ctx.fillStyle = look.shoes;
    ctx.fill();
    ctx.lineWidth = olu;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (!icon) {
      ctx.beginPath();
      ctx.ellipse(side * 0.03, 0.075, 0.07, 0.018, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.restore();
  };
  if (j.legLBehind) drawLeg('L');
  if (j.legRBehind) drawLeg('R');
  if (!j.legLBehind) drawLeg('L');
  if (!j.legRBehind) drawLeg('R');

  // body, in a frame that leans with the torso
  ctx.save();
  ctx.translate(0, j.lift);
  ctx.rotate((j.tilt || 0) * RAD);
  ctx.lineWidth = olu;
  ctx.strokeStyle = INK;
  // shorts
  ctx.beginPath();
  ctx.moveTo(-0.15, -0.14);
  ctx.lineTo(0.15, -0.14);
  ctx.lineTo(0.19, 0.1);
  ctx.lineTo(0.02, 0.1);
  ctx.lineTo(0, 0.04);
  ctx.lineTo(-0.02, 0.1);
  ctx.lineTo(-0.19, 0.1);
  ctx.closePath();
  ctx.fillStyle = look.shorts;
  ctx.fill();
  ctx.stroke();
  // midriff
  ctx.beginPath();
  ctx.moveTo(-0.14, -0.14);
  ctx.lineTo(-0.13, -0.26);
  ctx.lineTo(0.13, -0.26);
  ctx.lineTo(0.14, -0.14);
  ctx.closePath();
  ctx.fillStyle = look.skin;
  ctx.fill();
  ctx.stroke();
  // crop top
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.56);
  ctx.quadraticCurveTo(0, -0.61, 0.2, -0.56);
  ctx.lineTo(0.15, -0.25);
  ctx.quadraticCurveTo(0, -0.22, -0.15, -0.25);
  ctx.closePath();
  ctx.fillStyle = look.top;
  ctx.fill();
  ctx.stroke();
  // rhinestone starbursts
  if (!icon || size > 40) {
    const gems = [[-0.08, -0.47, PALETTE.rhinestonePink], [0.07, -0.42, PALETTE.rhinestonePurple], [-0.02, -0.33, PALETTE.rhinestoneSilver], [0.1, -0.3, PALETTE.rhinestonePink], [-0.11, -0.36, PALETTE.rhinestoneSilver]];
    gems.forEach(([gx, gy, gc], i) => {
      const tw = icon ? 1 : 0.7 + 0.5 * Math.sin(t * 5 + i * 1.7);
      ctx.fillStyle = gc;
      starPath(ctx, gx, gy, 0.036 * tw, 4, 0.4);
      ctx.fill();
    });
  }
  ctx.restore();

  // arms over the torso
  for (const n of ['L', 'R']) {
    limb(ctx, [j['shoulder' + n], j['elbow' + n], j['hand' + n]], armW, look.skin, olu);
    const hand = j['hand' + n];
    if (opts.poms) {
      drawPom(ctx, hand[0], hand[1], 0.17, look.pom, look.pom2, t + (n === 'L' ? 0 : 1.3), olu);
    } else {
      ctx.beginPath();
      ctx.arc(hand[0], hand[1], armW * 0.64, 0, Math.PI * 2);
      ctx.fillStyle = look.skin;
      ctx.fill();
      ctx.lineWidth = olu;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }

  // head: a rim of hair behind, the face, then side-swept bangs
  ctx.lineWidth = olu;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(j.neck[0], j.neck[1] + 0.04);
  ctx.lineTo(hx, hy);
  ctx.save();
  ctx.lineWidth = 0.11;
  ctx.strokeStyle = look.skin;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(hx, hy - 0.02, R * 1.09, R * 1.07, 0, Math.PI * 0.86, Math.PI * 2.14);
  ctx.closePath();
  ctx.fillStyle = look.hair;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hx, hy, R, 0, Math.PI * 2);
  ctx.fillStyle = look.skin;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx - R * 0.99, hy + R * 0.02);
  ctx.arc(hx, hy, R * 1.0, Math.PI * 1.0, Math.PI * 1.98);
  ctx.quadraticCurveTo(hx + R * 0.78, hy - R * 0.28, hx + R * 0.3, hy - R * 0.42);
  ctx.quadraticCurveTo(hx - R * 0.12, hy - R * 0.2, hx - R * 0.6, hy - R * 0.12);
  ctx.quadraticCurveTo(hx - R * 0.88, hy - R * 0.06, hx - R * 0.99, hy + R * 0.02);
  ctx.closePath();
  ctx.fillStyle = look.hair;
  ctx.fill();
  ctx.stroke();
  if (!icon) {
    // a shine on the hair
    ctx.beginPath();
    ctx.ellipse(hx - R * 0.35, hy - R * 0.72, R * 0.22, R * 0.07, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
  }

  // face
  if (!icon || size > 26) {
    const ex = R * 0.34;
    const ey = hy + R * 0.12;
    ctx.fillStyle = INK;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(hx + s * ex, ey, R * 0.09, R * 0.125, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!icon) {
      ctx.fillStyle = '#ffffff';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(hx + s * ex + R * 0.03, ey - R * 0.045, R * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,110,170,0.42)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(hx + s * R * 0.58, ey + R * 0.27, R * 0.16, R * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.beginPath();
    if (j.face === 'open') {
      ctx.moveTo(hx - R * 0.22, ey + R * 0.3);
      ctx.quadraticCurveTo(hx, ey + R * 0.75, hx + R * 0.22, ey + R * 0.3);
      ctx.closePath();
      ctx.fillStyle = '#c2185b';
      ctx.fill();
      ctx.lineWidth = olu * 0.8;
      ctx.stroke();
    } else {
      ctx.moveTo(hx - R * 0.2, ey + R * 0.32);
      ctx.quadraticCurveTo(hx, ey + R * 0.52, hx + R * 0.2, ey + R * 0.32);
      ctx.lineWidth = Math.max(olu, 0.022);
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }
  // the big bow on top: tails hang behind her ponytail
  drawBow(ctx, hx + 0.03, hy - R * 0.98, 0.5, look.bow, { outline: olu, stars: !icon || size > 34, tails: false });

  if (j.spin && !icon) {
    // twist: swooshes around her
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 0.035;
    for (const [r, y0, a0] of [[0.44, -0.2, t * 6], [0.38, 0.35, t * 6 + 2]]) {
      ctx.beginPath();
      ctx.ellipse(0, y0 + j.lift, r, r * 0.25, 0, a0, a0 + 2.2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ motion icons

function bounds(j, armsOnly) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const k of JOINTS) {
    const p = j[k];
    if (armsOnly && /knee|foot/.test(k)) continue;
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  y0 = Math.min(y0, j.head[1] - HEAD_R - 0.18);
  x0 = Math.min(x0, j.head[0] - HEAD_R - 0.06) - 0.06;
  x1 = Math.max(x1, j.head[0] + HEAD_R + 0.14) + 0.06;
  y1 = armsOnly ? Math.max(y1, 0.12) : y1 + 0.08;
  return { x0, y0, x1, y1 };
}

export function drawMotionIcon(ctx, cx, cy, r, motion, { color = PALETTE.pink, ring = true, t = 0, fill = PALETTE.white } = {}) {
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  const j = poseSkeleton(motion);
  const arms = ARM_MOTIONS.has(motion);
  const b = bounds(j, arms);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const k = (r * (arms ? 1.78 : 1.66)) / Math.max(w, h);
  const size = k * FIG_H;
  const midX = (b.x0 + b.x1) / 2;
  const midY = (b.y0 + b.y1) / 2 + (arms ? 0.12 : 0);
  const x = cx - midX * k;
  const y = cy - midY * k + FEET * k;
  ctx.save();
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
    ctx.clip();
  }
  drawFigure(ctx, x, y, size, j, { detail: 'icon', t });
  ctx.restore();
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

const iconCache = new Map();
export function iconCanvas(motion, px, color, dpr = 1, fill = PALETTE.white) {
  const key = motion + '|' + px + '|' + color + '|' + dpr + '|' + fill;
  let c = iconCache.get(key);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  const s = Math.ceil(px * dpr) + 4;
  c.width = s;
  c.height = s;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  drawMotionIcon(g, s / dpr / 2, s / dpr / 2, px / 2 - 1, motion, { color, fill });
  iconCache.set(key, c);
  if (iconCache.size > 120) iconCache.delete(iconCache.keys().next().value);
  return c;
}
