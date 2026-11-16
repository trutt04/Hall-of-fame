// Reusable "draw into a Geo" parts shared by homes, props and set pieces.
// Every function draws at the Geo's current transform and adds no draw calls of its own.
import { TAU, shade, mix } from './geo.js';
import { halo } from './util.js';

// Common colors (sRGB hex).
export const C = {
  gold: 0xf5c542, goldHi: 0xffe58a, goldLo: 0xd49a25, goldDeep: 0xa87216,
  white: 0xf7f4ea, cream: 0xf1ead8, chalk: 0xf3eedd, stone: 0xb9bfc6, stoneDk: 0x8a93a0, stoneWarm: 0xcfc6b2,
  navy: 0x18213f, navyLt: 0x3d4a7a, iron: 0x2b2e38, black: 0x1c1d22,
  wood: 0x8a5a36, woodDk: 0x6b4226, woodLt: 0xb98552, cardboard: 0xbf9460, cardboardDk: 0x9c7446,
  glassA: 0x6f97b8, glassB: 0x9cc2dc, glassDk: 0x3b5268,
  leaf: 0x4f9a4a, leafLt: 0x72bd58, leafDk: 0x35733c, hedge: 0x3f8a45, pine: 0x2f6b4a, pineLt: 0x3f8257,
  red: 0xd7263d, velvet: 0xa81c33, tire: 0x26272c, rust: 0x9a4b2a, rustDk: 0x733620,
  metal: 0xa3abb3, metalDk: 0x6c757d, metalLt: 0xcfd6dc, concrete: 0xb5b2a8, concreteDk: 0x8f8c82,
  tape: 0x9aa0a6, caution: 0xf2c200, cone: 0xff6a1f, flamingo: 0xff7aa8, flamingoDk: 0xf05a8e,
  brick: 0xa5533c, brickDk: 0x8a4230, dirt: 0x6b5a3e, tarp: 0x2f6fbf, tarpDk: 0x24579a,
  bag: 0x23262b, bagAlt: 0x3a4a3a, bagWhite: 0xd8d8d2, amber: 0xffb020, warm: 0xffe2a8,
  skin: 0xf7d2a4, pants: 0x7d8590, shoe: 0x2c2f38, hair: 0x4a3524,
  water: 0x58b8e8, waterLt: 0xa8e0f8,
};

// A chunky tied garbage bag sitting on y = 0. About 0.9 m tall at s = 1.
export function drawBag(g, x, y, z, s, hex, rnd, tie = 0xd7263d, seg = 5) {
  const j = g.jit; g.jit = 0.1;
  g.at(x, y, z, rnd() * TAU, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3);
  g.scale(s * (0.9 + rnd() * 0.3), s * (0.8 + rnd() * 0.3), s * (0.9 + rnd() * 0.3));
  g.lathe(0, 0, 0, [[0.3, 0], [0.52, 0.26], [0.38, 0.62], [0.09, 0.8, tie], [0.2, 0.97]], hex, { seg, capTop: shade(hex, 0.7) });
  g.restore(); g.jit = j;
}

// Tire lying flat on y = 0 (use rx/rz in `o` to stand it up). r outer radius, w width.
export function drawTire(g, x, y, z, r = 0.36, w = 0.24, o = {}) {
  const ri = r * 0.55, seg = o.seg || 8, col = o.color || C.tire;
  g.at(x, y, z, o.ry, o.rx, o.rz);
  g.band(r, 0, r, w, seg, 0, col);
  g.band(r, w, ri, w, seg, 0, shade(col, 1.25));
  g.band(ri, w, ri, 0, seg, 0, shade(col, 0.7));
  if (o.both) g.band(ri, 0, r, 0, seg, 0, shade(col, 1.25));
  if (o.hub) { g.fan(ri, w * 0.6, seg, 0, o.hub); if (o.both) g.fan(ri, w * 0.4, seg, 0, o.hub, true); }
  g.restore();
}

export function drawTrafficCone(g, x, y, z, s = 1, o = {}) {
  g.at(x, y, z, o.ry, o.rx, o.rz); g.scale(s);
  g.box(0, 0, 0, 0.4, 0.04, 0.4, C.cone);
  g.lathe(0, 0.04, 0, [[0.15, 0], [0.115, 0.17, C.white], [0.09, 0.29, C.cone], [0.04, 0.52]], C.cone, { seg: 6 });
  g.restore();
}

export function drawCardboardBox(g, x, y, z, w, h, d, o = {}) {
  const col = o.color || C.cardboard;
  g.at(x, y, z, o.ry, o.rx, o.rz);
  g.box(0, 0, 0, w, h, d, col, { top: shade(col, 0.55), side: shade(col, 0.93), bottom: !!o.bottom });
  if (o.tape !== false) {
    g.quad([-w / 2 - 0.004, h * 0.55, 0.05], [-w / 2 - 0.004, h * 0.55, -0.05], [-w / 2 - 0.004, h, -0.05], [-w / 2 - 0.004, h, 0.05], C.tape);
    g.quad([-0.05, h * 0.55, d / 2 + 0.004], [0.05, h * 0.55, d / 2 + 0.004], [0.05, h, d / 2 + 0.004], [-0.05, h, d / 2 + 0.004], C.tape);
  }
  if (o.flaps) {
    const f = d * 0.48;
    g.quad2([-w / 2, h, d / 2], [w / 2, h, d / 2], [w / 2, h + f * 0.55, d / 2 + f * 0.8], [-w / 2, h + f * 0.55, d / 2 + f * 0.8], shade(col, 1.08), shade(col, 0.85));
    g.quad2([w / 2, h, -d / 2], [-w / 2, h, -d / 2], [-w / 2, h + f * 0.8, -d / 2 - f * 0.5], [w / 2, h + f * 0.8, -d / 2 - f * 0.5], shade(col, 1.08), shade(col, 0.85));
  }
  g.restore();
}

// Mailbox on a post. The door faces +Z, the little flag is the team color.
// style: 'gold' | 'nice' | 'plain' | 'dented' | 'can'
export function drawMailbox(g, x, y, z, color, style = 'plain', o = {}) {
  g.at(x, y, z, o.ry, 0, style === 'dented' ? 0.14 : style === 'can' ? -0.2 : 0);
  let post = C.wood, box = C.metal, ph = 1.0;
  if (style === 'gold') {
    g.box(0, 0, 0, 0.5, 0.16, 0.5, C.stone);
    g.box(0, 0.16, 0, 0.36, 0.9, 0.36, C.cream);
    g.box(0, 1.06, 0, 0.46, 0.08, 0.46, C.gold);
    ph = 1.14; box = C.gold;
  } else if (style === 'nice') {
    post = C.white; box = 0x4d6b8a;
    g.box(0, 0, 0, 0.13, 1.0, 0.13, post);
    g.box(0, 0.78, 0.2, 0.09, 0.09, 0.42, post, { rx: -0.6 });
  } else if (style === 'can') {
    g.box(0, 0, 0, 0.07, 1.0, 0.07, C.woodDk);
    box = 0xb04a32;
  } else {
    post = style === 'dented' ? C.woodDk : C.wood;
    g.box(0, 0, 0, 0.11, 1.0, 0.11, post);
  }
  if (style === 'can') {
    // a coffee can taped to a stick
    g.cyl(0, ph, -0.24, 0.17, 0.46, box, { seg: 7, rx: Math.PI / 2, top: C.black });
    g.box(0, ph - 0.19, -0.02, 0.37, 0.38, 0.09, C.tape);
  } else {
    const w = 0.3, h = 0.3, d = 0.52;
    g.cloft(0, ph, 0, [[0, w, d, 0], [h * 0.55, w, d, 0], [h, w, d, 0.11]], box, { capTop: shade(box, 1.1) });
    g.quad([-w / 2 + 0.03, ph + 0.03, d / 2 + 0.005], [w / 2 - 0.03, ph + 0.03, d / 2 + 0.005], [w / 2 - 0.03, ph + h * 0.72, d / 2 + 0.005], [-w / 2 + 0.03, ph + h * 0.72, d / 2 + 0.005], shade(box, 0.72));
    if (style === 'dented') g.box(0.02, ph + 0.05, -0.1, 0.32, 0.12, 0.2, C.rust, { ry: 0.3 });
  }
  // the flag
  const fx = 0.17;
  g.box(fx, ph + 0.08, 0.05, 0.025, 0.36, 0.035, shade(color, 0.8));
  g.box(fx, ph + 0.3, -0.03, 0.03, 0.14, 0.2, color);
  g.restore();
}

// Round, pine, topiary or dead tree with its base on y = 0. Returns nothing.
export function drawTree(g, kind, x, y, z, s, rnd) {
  const j = g.jit;
  g.at(x, y, z, rnd() * TAU); g.scale(s);
  if (kind === 'pine') {
    g.cyl(0, 0, 0, 0.2, 1.0, C.woodDk, { seg: 5, rt: 0.14, top: false });
    g.jit = 0.07;
    const tiers = [[1.5, 0.7, 1.7, C.pine], [1.15, 1.7, 1.5, mix(C.pine, C.pineLt, 0.5)], [0.8, 2.6, 1.4, C.pineLt]];
    for (const [r, yy, h, col] of tiers) {
      g.at(0, yy, 0, rnd() * TAU);
      g.band(r, 0, 0, h, 7, 0, col);
      g.fan(r, 0, 7, 0, shade(col, 0.6), true);
      g.restore();
    }
  } else if (kind === 'topiary') {
    g.box(0, 0, 0, 0.8, 0.5, 0.8, C.cream, { tx: 1.18, tz: 1.18, top: C.dirt });
    g.box(0, 0.36, 0, 0.98, 0.08, 0.98, C.gold);
    g.cyl(0, 0.5, 0, 0.07, 2.4, C.woodDk, { seg: 4, top: false });
    g.jit = 0.06;
    g.sphere(0, 1.25, 0, 0.62, C.hedge, { seg: 7, rings: 4 });
    g.sphere(0, 2.15, 0, 0.46, mix(C.hedge, C.leaf, 0.5), { seg: 7, rings: 4 });
    g.sphere(0, 2.85, 0, 0.32, C.leaf, { seg: 6, rings: 3 });
  } else if (kind === 'dead') {
    const bark = 0x6a5a4c, barkDk = 0x55473b;
    g.jit = 0.06;
    g.tube([[0, 0, 0], [0.06, 1.2, 0.03], [-0.1, 2.3, -0.04], [0.05, 3.3, 0.06]], 0.24, bark, { seg: 5, r1: 0.07 });
    const br = [[1.3, 0.9, 0.5, 1.5], [1.9, -1.0, 0.6, 1.3], [2.4, 0.5, -0.9, 1.1], [2.8, -0.6, -0.5, 0.9], [1.6, -0.3, -1.0, 1.0]];
    for (const [h, dx, dz, len] of br) {
      const k = 0.8 + rnd() * 0.4;
      g.tube([[0, h, 0], [dx * 0.5 * k, h + len * 0.35, dz * 0.5 * k], [dx * k, h + len * 0.9, dz * k], [dx * k * 1.25, h + len * 1.35, dz * k * 1.1]], 0.09, barkDk, { seg: 3, r1: 0.02 });
    }
  } else {
    g.cyl(0, 0, 0, 0.24, 1.9, C.woodDk, { seg: 6, rt: 0.15, top: false });
    g.jit = 0.07;
    const base = rnd() < 0.5 ? C.leaf : mix(C.leaf, C.leafLt, 0.4);
    g.ico(0, 3.0, 0, 1.55, base, { detail: 1, jitter: 0.12, rnd, sy: 0.92 });
    g.ico(0.95, 2.35, 0.35, 0.9, shade(base, 0.88), { jitter: 0.12, rnd });
    g.ico(-0.85, 2.5, -0.5, 0.8, shade(base, 1.08), { jitter: 0.12, rnd });
  }
  g.restore(); g.jit = j;
}

export function drawBush(g, x, y, z, s, rnd, col = C.hedge) {
  const j = g.jit; g.jit = 0.07;
  g.at(x, y, z, rnd() * TAU); g.scale(s);
  g.ico(0, 0.42, 0, 0.62, col, { jitter: 0.14, rnd, sy: 0.85, flat: 0.6 });
  g.ico(0.48, 0.3, 0.12, 0.42, shade(col, 0.9), { jitter: 0.14, rnd, flat: 0.65 });
  g.ico(-0.42, 0.28, -0.18, 0.38, shade(col, 1.1), { jitter: 0.14, rnd, flat: 0.65 });
  g.restore(); g.jit = j;
}

// Clipped box hedge from (x0, z0) to (x1, z1).
export function drawHedge(g, x0, z0, x1, z1, h = 0.9, w = 0.7, col = C.hedge) {
  const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
  const j = g.jit; g.jit = 0.06;
  g.cloft((x0 + x1) / 2, 0, (z0 + z1) / 2, [[0, len, w * 0.92, 0.05], [h * 0.8, len, w, 0.08], [h, len - 0.12, w * 0.7, 0.14]], col, { ry, capTop: shade(col, 1.12) });
  g.jit = j;
}

// Pink plastic lawn flamingo. pose 0 = head up, 1 = head down pecking.
export function drawFlamingo(g, x, y, z, s, pose, ry) {
  g.at(x, y, z, ry); g.scale(s);
  const P = C.flamingo, D = C.flamingoDk;
  g.at(0.05, 0, 0); g.band(0.016, 0, 0.016, 0.62, 3, 0, C.metalDk); g.restore();
  g.at(-0.05, 0, 0.03); g.band(0.016, 0, 0.016, 0.62, 3, 0, C.metalDk); g.restore();
  g.sphere(0, 0.76, 0, 0.2, P, { seg: 5, rings: 3, sz: 1.5, sy: 0.85 });
  g.tri2([0.09, 0.74, -0.2], [-0.09, 0.74, -0.2], [0, 0.7, -0.5], D);
  if (pose) {
    g.tube([[0, 0.78, 0.22], [0, 0.95, 0.42], [0, 0.72, 0.6], [0, 0.42, 0.58]], 0.05, P, { seg: 3 });
    g.sphere(0, 0.36, 0.59, 0.085, P, { seg: 4, rings: 2 });
    g.cone(0, 0.3, 0.6, 0.05, 0.16, C.black, { seg: 3, rx: Math.PI * 0.8 });
  } else {
    g.tube([[0, 0.8, 0.22], [0, 1.02, 0.4], [0, 1.25, 0.3], [0, 1.45, 0.36]], 0.05, P, { seg: 3 });
    g.sphere(0, 1.5, 0.4, 0.085, P, { seg: 4, rings: 2 });
    g.cone(0, 1.49, 0.46, 0.05, 0.17, C.black, { seg: 3, rx: Math.PI * 0.62 });
  }
  g.restore();
}

// Folding webbed lawn chair. Seat is ~0.42 high. Front faces +Z.
export function drawLawnChair(g, x, y, z, o = {}) {
  const a = o.color || 0x2e9e4f, b = o.alt || C.white, m = o.frame || C.metalLt;
  g.at(x, y, z, o.ry, o.rx, o.rz);
  for (const sx of [-1, 1]) {
    const px = sx * 0.3;
    g.tube([[px, 0, 0.3], [px, 0.42, -0.2], [px, 1.0, -0.38]], 0.022, m, { seg: 3 });
    g.tube([[px, 0, -0.3], [px, 0.42, 0.27], [px, 0.62, 0.27], [px, 0.62, -0.26]], 0.022, m, { seg: 3 });
  }
  for (let i = 0; i < 4; i++) {
    const z0 = -0.2 + i * 0.118, col = i % 2 ? b : a;
    g.quad2([-0.3, 0.43, z0 + 0.105], [0.3, 0.43, z0 + 0.105], [0.3, 0.43, z0], [-0.3, 0.43, z0], col);
  }
  for (let i = 0; i < 4; i++) {
    const t0 = i / 4, t1 = (i + 0.88) / 4, col = i % 2 ? a : b;
    const y0 = 0.5 + t0 * 0.5, y1 = 0.5 + t1 * 0.5, z0 = -0.225 - t0 * 0.155, z1 = -0.225 - t1 * 0.155;
    g.quad2([-0.3, y0, z0], [0.3, y0, z0], [0.3, y1, z1], [-0.3, y1, z1], col);
  }
  g.restore();
}

// White plastic stacking chair (the trailer park classic).
export function drawPlasticChair(g, x, y, z, o = {}) {
  const c = o.color || 0xe9e6dc, d = shade(c, 0.86);
  g.at(x, y, z, o.ry, o.rx, o.rz);
  for (const [px, pz] of [[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]]) g.box(px, 0, pz, 0.05, 0.42, 0.05, d, { tx: 1.4, tz: 1.4 });
  g.box(0, 0.4, 0, 0.54, 0.05, 0.5, c);
  g.box(0, 0.45, -0.24, 0.54, 0.5, 0.05, c, { rx: -0.18, tx: 0.9 });
  for (const sx of [-1, 1]) g.box(sx * 0.27, 0.45, 0, 0.05, 0.2, 0.44, d);
  g.restore();
}

// Galvanised trash can with a tilted lid.
export function drawTrashCan(g, x, y, z, o = {}) {
  const m = o.color || C.metal;
  g.at(x, y, z, o.ry, o.rx, o.rz);
  g.lathe(0, 0, 0, [[0.27, 0, shade(m, 0.8)], [0.28, 0.08, m], [0.31, 0.4, shade(m, 0.9)], [0.315, 0.46, m], [0.33, 0.8]], m, { seg: 8, capTop: C.black });
  if (o.lid !== false) {
    g.at(0.04, 0.8, 0, 0, 0, o.lidTilt === undefined ? 0.16 : o.lidTilt);
    g.lathe(0, 0, 0, [[0.36, 0], [0.36, 0.05], [0.12, 0.13]], shade(m, 1.12), { seg: 8, capBot: shade(m, 0.6) });
    g.box(0, 0.13, 0, 0.14, 0.05, 0.04, C.metalDk);
    g.restore();
  }
  g.restore();
}

// A plump pigeon about 0.3 long, facing +Z. pose 0 standing, 1 pecking.
export function drawPigeon(g, x, y, z, s, ry, pose = 0, col = 0x8d96a3) {
  g.at(x, y, z, ry); g.scale(s);
  if (pose) g.at(0, 0.1, 0, 0, 0.6); else g.at(0, 0.1, 0);
  g.sphere(0, 0.06, 0, 0.1, col, { seg: 5, rings: 3, sz: 1.45, sy: 0.95 });
  g.sphere(0, 0.17, 0.11, 0.058, shade(col, 0.8), { seg: 5, rings: 3 });
  g.cone(0, 0.165, 0.16, 0.02, 0.05, C.amber, { seg: 3, rx: Math.PI / 2 });
  g.tri2([0, 0.09, -0.12], [0.06, 0.05, -0.1], [0, 0.03, -0.27], shade(col, 0.65)).tri2([0, 0.09, -0.12], [0, 0.03, -0.27], [-0.06, 0.05, -0.1], shade(col, 0.65));
  g.restore();
  g.box(0.03, 0, 0, 0.012, 0.1, 0.012, C.cone, { noTop: true });
  g.box(-0.03, 0, 0, 0.012, 0.1, 0.012, C.cone, { noTop: true });
  g.restore();
}

// Iron fence run from (x0, z0) to (x1, z1) with gold-tipped posts. Returns post positions.
export function drawFence(g, x0, z0, x1, z1, o = {}) {
  const h = o.h || 1.5, col = o.color || C.iron, tip = o.tip || C.gold;
  const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0);
  const posts = Math.max(1, Math.round(len / (o.postEvery || 3.4)));
  g.at(x0, 0, z0, ry);
  g.box(len / 2, 0.22, 0, len, 0.06, 0.06, col);
  g.box(len / 2, h - 0.2, 0, len, 0.06, 0.06, col);
  const n = Math.round(len / (o.barEvery || 0.8));
  for (let i = 1; i < n; i++) {
    if (i % Math.round(n / posts) === 0) continue;
    const bx = (len * i) / n;
    g.at(bx, 0, 0);
    g.band(0.035, 0.05, 0.03, h, 3, i, col);
    g.band(0.03, h, 0, h + 0.14, 3, i, tip);
    g.restore();
  }
  const out = [];
  for (let i = 0; i <= posts; i++) {
    const bx = (len * i) / posts;
    g.box(bx, 0, 0, 0.16, h + 0.12, 0.16, col);
    g.cone(bx, h + 0.12, 0, 0.12, 0.26, tip, { seg: 4 });
    out.push(bx);
  }
  g.restore();
  return out;
}

// A stone gate pillar with a gold orb lantern on top (the orb glows: drawn into `glow` if given).
export function drawGatePillar(g, x, z, h = 3.4, glow = null) {
  g.box(x, 0, z, 1.25, 0.3, 1.25, C.stone);
  g.box(x, 0.3, z, 1.0, h - 0.6, 1.0, C.cream, { side: shade(C.cream, 0.93) });
  g.box(x, 0.9, z, 1.04, 0.1, 1.04, C.gold);
  g.box(x, h - 0.3, z, 1.3, 0.14, 1.3, C.gold);
  g.box(x, h - 0.16, z, 1.14, 0.16, 1.14, C.cream, { tx: 0.5, tz: 0.5 });
  g.cyl(x, h, z, 0.12, 0.16, C.gold, { seg: 6 });
  g.sphere(x, h + 0.42, z, 0.3, C.goldHi, { seg: 7, rings: 4 });
  if (glow) halo(glow, x, h + 0.42, z, 0.7, 0xffd98a, 0.3, 1);
}

// One leaf of a gold gate, hinged at x = 0 and extending toward +X by `w`. Bars rise to an arch.
export function drawGateLeaf(g, w, h, flipArch = false) {
  const col = C.gold, dk = C.goldLo;
  g.box(0.05, 0.1, 0, 0.1, h + 0.5, 0.1, dk);
  g.box(w / 2, 0.16, 0, w, 0.1, 0.07, dk);
  g.box(w / 2, h * 0.5, 0, w, 0.07, 0.06, dk);
  const n = 6;
  const top = (t) => h * (0.78 + 0.34 * Math.sin((flipArch ? 1 - t : t) * Math.PI * 0.5));
  for (let i = 1; i <= n; i++) {
    const t = i / n, bx = w * t - 0.04, th = top(t);
    g.at(bx, 0, 0);
    g.band(0.035, 0.16, 0.03, th, 4, Math.PI / 4, col);
    g.band(0.06, th, 0, th + 0.24, 4, Math.PI / 4, C.goldHi);
    g.restore();
  }
  // arched top rail
  const pts = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push([w * t, top(t) - 0.06, 0]); }
  g.tube(pts, 0.04, dk, { seg: 4 });
  // a round medallion in the middle
  g.cyl(w * 0.52, h * 0.5 - 0.02, -0.05, 0.3, 0.1, C.goldHi, { seg: 8, rx: Math.PI / 2, bottom: true });
  g.cyl(w * 0.52, h * 0.5 - 0.02, -0.06, 0.18, 0.12, dk, { seg: 6, rx: Math.PI / 2, bottom: true });
}

// A generic football centered at (x, y, z), long axis along X. Options: stripe (color or false), laces.
export function drawFootball(g, x, y, z, len, col = 0x8a4a2a, o = {}) {
  const r = len * 0.29, h = len / 2, st = o.stripe === false ? col : (o.stripe === undefined ? 0xf7f4ea : o.stripe);
  g.at(x, y, z, o.ry, o.rx, o.rz);
  g.rotZ(-Math.PI / 2);
  g.lathe(0, 0, 0, [[0, -h, col], [r * 0.56, -h * 0.7, st], [r * 0.72, -h * 0.54, col], [r, 0, col], [r * 0.72, h * 0.54, st], [r * 0.56, h * 0.7, col], [0, h]], col, { seg: o.seg || 6, capTop: false });
  if (o.laces !== false) {
    g.box(-r - 0.012 * len, -h * 0.3, 0, 0.03 * len, h * 0.6, 0.045 * len, st, { bottom: true });
    for (let i = -1; i <= 1; i++) g.box(-r - 0.02 * len, i * h * 0.2 - 0.02 * len, 0, 0.03 * len, 0.04 * len, 0.16 * len, st, { bottom: true });
  }
  g.restore();
}
