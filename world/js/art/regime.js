// The Supreme Commissioner: generic "glorious leader" pageantry in bronze, red and gold.
// A grand monument, a bust for street corners and a pole loudspeaker. Each is ONE draw call:
// merged geometry, vertex colours, the shared flat-shaded material, no textures.
//
//   createLeaderStatue({ scale })  -> { group, height, radius, footprint, colliders, anchors: { plaque, top }, plaqueSize, dispose() }
//   createLeaderBust({ weathered, scale }) -> same shape
//   createLoudspeaker({ scale })   -> { group, height, radius, colliders, anchors: { top, horns }, dispose() }
import * as THREE from '../../lib/three.module.min.js';
import { Geo, shade } from './geo.js';
import { flatMat } from './materials.js';
import { rng, makeProp, addMesh, V3 } from './util.js';
import { C } from './parts.js';

// One olive-gold bronze. Hair and beard are a darker bronze, the sunglasses near-black with gold rims.
const K = {
  F: 0xbaa758, Fh: 0xd6c476, Fl: 0x8c7b3e, coat: 0x9d8c49, coatHi: 0xb5a358, coatDk: 0x74652f,
  hair: 0x55461f, fade: 0x86743a, lens: 0x14151a, rim: C.goldHi, lip: 0xe2d08a,
  rock: 0x8f7f47, rockDk: 0x776937, rockLt: 0xa39458, red: 0xc4122e, redDk: 0x8f0d22, stone: 0xb9b3a2, stoneDk: 0x97917f,
};

// The head, in monument units (2.4 tall), neck base on y = 0, facing +Z.
// Flat top with a tight fade, full cheeks, goatee joined to a chinstrap, rectangular gold-rimmed shades.
function drawLeaderHead(g) {
  const { F, Fh, hair, fade } = K;
  g.cloft(0, 0, 0, [[0, 1.25, 1.2, 0.35], [0.3, 1.8, 1.6, 0.5], [0.85, 2.12, 1.86, 0.6], [1.5, 1.96, 1.8, 0.56], [1.95, 1.86, 1.76, 0.55]], F, { capTop: false });
  // fade on the sides and back (set back so the face stays clear), then the flat top
  g.cloft(0, 0, 0, [[1.12, 2.13, 1.84, 0.58, 0, -0.15], [1.97, 1.93, 1.78, 0.55, 0, -0.15]], fade, { capTop: false });
  g.cloft(0, 0, 0, [[1.93, 1.93, 1.83, 0.5, 0, -0.03], [2.4, 1.89, 1.79, 0.4, 0, -0.03]], hair, { capTop: shade(hair, 1.15) });
  for (const sx of [-1, 1]) {
    g.box(sx * 1.07, 0.72, -0.05, 0.16, 0.44, 0.3, Fh);
    // chinstrap from the ear, along the jaw, to the goatee
    g.tube([[sx * 1.03, 0.8, 0.1], [sx * 0.96, 0.42, 0.44], [sx * 0.42, 0.3, 0.85]], 0.095, hair, { seg: 3 });
    g.box(sx * 0.4, 0.5, 0.9, 0.11, 0.2, 0.08, hair, { noTop: true });
    // temple arm of the glasses
    g.quad2([sx * 0.96, 1.32, 1.0], [sx * 1.09, 1.27, 0.0], [sx * 1.09, 1.36, 0.0], [sx * 0.96, 1.42, 1.0], K.rim);
    // lens
    g.quad([sx * 0.5 - 0.39, 1.15, 1.05], [sx * 0.5 + 0.39, 1.15, 1.05], [sx * 0.5 + 0.39, 1.51, 1.05], [sx * 0.5 - 0.39, 1.51, 1.05], K.lens);
  }
  g.box(0, 1.1, 0.985, 1.92, 0.46, 0.12, K.rim, { bottom: true });                 // gold frame
  g.box(0, 0.8, 1.0, 0.36, 0.42, 0.26, Fh, { tx: 0.6, tz: 0.5, sz: -0.06 });       // nose
  g.box(0, 0.66, 0.94, 0.9, 0.11, 0.09, hair);                                     // moustache
  g.box(0, 0.26, 0.87, 0.82, 0.28, 0.14, hair);                                    // goatee
  // a slight smile
  g.quad([-0.27, 0.595, 0.905], [0, 0.545, 0.905], [0, 0.61, 0.905], [-0.27, 0.66, 0.905], K.lip);
  g.quad([0, 0.545, 0.905], [0.27, 0.595, 0.905], [0.27, 0.66, 0.905], [0, 0.61, 0.905], K.lip);
}

// Shirt collar, tie and lapels on the chest (monument units). vy = y of the bottom of the V.
function drawCollarAndTie(g, vy, zb) {
  const { Fh, Fl, F } = K, zt = 1.07, lap = shade(F, 1.1);
  g.cloft(0, 0, 0, [[5.8, 1.75, 1.5, 0.45], [6.5, 1.5, 1.36, 0.4]], Fh, { capTop: false });
  g.tri([0, vy, zb], [0.62, 5.86, zt], [-0.62, 5.86, zt], Fh);
  g.quad([0, vy, zb], [0.42, vy - 0.13, zb], [1.06, 5.86, zt], [0.62, 5.86, zt], lap);
  g.quad([0, vy, zb], [-0.62, 5.86, zt], [-1.06, 5.86, zt], [-0.42, vy - 0.13, zb], lap);
  g.box(0, 5.52, 1.1, 0.36, 0.32, 0.1, Fl);
  const ty = Math.max(vy + 0.2, 5.0);
  g.quad([-0.2, ty, zb + 0.04], [0.2, ty, zb + 0.04], [0.13, 5.56, zt + 0.07], [-0.13, 5.56, zt + 0.07], Fl);
  g.tri([0, ty - 0.23, zb + 0.04], [0.2, ty, zb + 0.04], [-0.2, ty, zb + 0.04], Fl);
}

// ---- the grand monument, about 9 m tall --------------------------------------------------------
export function createLeaderStatue({ scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'leaderStatue';
  const own = [], g = new Geo(), r = rng(1948), { F, Fh, Fl, coat, coatHi, coatDk } = K;
  g.scale(scale);

  // low red plinth with a gold edge and a nameplate
  g.box(0, 0, 0, 7.5, 0.14, 5.1, K.redDk);
  g.cloft(0, 0, 0, [[0.14, 7.2, 4.8, 0.25], [0.9, 7.2, 4.8, 0.25]], K.red, { capTop: shade(K.red, 1.12) });
  g.cloft(0, 0, 0, [[0.8, 7.25, 4.85, 0.25], [0.905, 7.25, 4.85, 0.25]], C.gold, { capTop: false });
  g.box(0, 0.24, 2.42, 2.1, 0.46, 0.06, C.goldLo, { bottom: true });
  g.quad([-0.97, 0.3, 2.455], [0.97, 0.3, 2.455], [0.97, 0.64, 2.455], [-0.97, 0.64, 2.455], C.goldHi);

  // rough rock the figure rises out of, with a ledge for the briefcase
  const PY = 0.9;
  g.jit = 0.08;
  g.ico(0, PY, -0.15, 1, K.rock, { detail: 1, sx: 3.0, sy: 1.75, sz: 2.0, jitter: 0.1, rnd: r, flat: 0 });
  g.ico(-1.9, PY, 1.0, 1, K.rockLt, { sx: 1.35, sy: 0.95, sz: 1.1, jitter: 0.16, rnd: r, flat: 0 });
  g.ico(0.5, PY, 1.4, 1, K.rock, { sx: 1.5, sy: 0.8, sz: 0.85, jitter: 0.16, rnd: r, flat: 0 });
  g.ico(-1.6, PY, -1.35, 1, K.rockDk, { sx: 1.5, sy: 1.1, sz: 0.95, jitter: 0.16, rnd: r, flat: 0 });
  g.ico(1.8, PY, -1.3, 1, K.rockDk, { sx: 1.4, sy: 1.0, sz: 0.95, jitter: 0.16, rnd: r, flat: 0 });
  g.cloft(2.55, PY, 0.5, [[0, 2.1, 2.1, 0.6], [0.55, 1.95, 1.9, 0.55], [0.82, 1.7, 1.5, 0.5]], K.rockLt, { capTop: shade(K.rockLt, 1.08) });

  g.jit = 0.05;
  // the overcoat: back and sides, open at the front
  g.cloft(0, 0, 0, [[1.9, 4.5, 2.6, 0.7, 0, -0.5], [3.3, 4.4, 2.55, 0.7, 0, -0.42], [4.7, 4.25, 2.4, 0.7, 0, -0.38], [5.9, 4.3, 2.2, 0.65, 0, -0.35], [6.3, 2.5, 1.7, 0.5, 0, -0.3]], coat, { capTop: true });
  // the suit: stocky, belly first
  g.cloft(0, 0, 0, [[2.0, 3.0, 2.1, 0.55], [3.3, 3.4, 2.4, 0.65], [4.7, 3.4, 2.3, 0.65], [5.85, 3.6, 2.1, 0.6], [6.4, 1.5, 1.3, 0.4]], F, { capTop: false });
  g.jit = 0;
  drawCollarAndTie(g, 4.75, 1.17);
  g.quad([-0.03, 2.4, 1.15], [0.03, 2.4, 1.15], [0.03, 3.3, 1.215], [-0.03, 3.3, 1.215], Fl);
  g.quad([-0.03, 3.3, 1.215], [0.03, 3.3, 1.215], [0.03, 4.6, 1.19], [-0.03, 4.6, 1.19], Fl);
  for (const by of [3.35, 3.95]) g.quad([0.1, by, 1.22], [0.26, by, 1.22], [0.26, by + 0.16, 1.22], [0.1, by + 0.16, 1.22], Fh);
  g.jit = 0.05;
  // coat fronts: the figure's left one hangs to the rock, the right one is pushed back by the hand on the hip
  g.box(1.62, 2.0, 1.14, 1.0, 3.95, 0.36, coat, { tx: 0.7, sx: -0.16, side: coatHi });
  g.box(-1.62, 4.2, 1.12, 1.0, 1.75, 0.36, coat, { tx: 0.7, sx: 0.16, side: coatHi, bottom: true });
  g.quad([1.36, 3.0, 1.33], [1.98, 3.0, 1.33], [1.96, 3.16, 1.33], [1.38, 3.16, 1.33], coatDk);   // pocket flap
  // the wide collar, popped, and its roll behind the neck
  for (const sx of [-1, 1]) g.box(sx * 1.25, 5.0, 1.2, 1.25, 1.55, 0.24, coatHi, { rz: sx * 0.3, rx: -0.12, tx: 0.55, bottom: true });
  g.box(0, 5.85, -1.05, 2.7, 0.8, 0.5, coatHi, { tx: 0.8 });
  // arms: right hand tucked at the hip under the coat, left hand on the briefcase
  g.tube([[-2.0, 5.7, -0.15], [-2.95, 4.5, -0.45], [-2.05, 3.7, 0.45]], 0.6, coat, { seg: 5, r1: 0.5, caps: true });
  g.tube([[2.0, 5.7, -0.15], [2.5, 4.5, 0.1], [2.7, 3.4, 0.5]], 0.6, coat, { seg: 5, r1: 0.46, caps: true });
  g.sphere(2.72, 3.05, 0.52, 0.4, Fh, { seg: 5, rings: 3, sy: 0.9 });
  // the boxy briefcase on its ledge
  g.box(2.72, 1.72, 0.52, 1.5, 1.02, 0.62, F, { top: Fh, side: shade(F, 0.92) });
  g.quad([1.97, 2.42, 0.835], [3.47, 2.42, 0.835], [3.47, 2.48, 0.835], [1.97, 2.48, 0.835], Fl);
  for (const cx of [2.32, 3.12]) g.quad([cx - 0.08, 2.36, 0.84], [cx + 0.08, 2.36, 0.84], [cx + 0.08, 2.54, 0.84], [cx - 0.08, 2.54, 0.84], Fh);
  g.tube([[2.38, 2.74, 0.52], [2.45, 2.96, 0.52], [2.99, 2.96, 0.52], [3.06, 2.74, 0.52]], 0.05, Fl, { seg: 3 });
  // the coat tail, blown out to the side by a wind that only blows for great men
  const row = (u, k) => {
    const top = 4.5 - 0.6 * u + 0.45 * Math.sin(u * Math.PI), bot = 2.3 + 1.25 * u - 0.3 * Math.sin(u * Math.PI);
    const y = k === 0 ? top : k === 2 ? bot : (top + bot) / 2 + 0.1;
    const z = k === 0 ? 0.45 - 0.9 * u + 0.2 * Math.sin(u * 5) : k === 2 ? 0.55 - 0.6 * u - 0.15 * Math.sin(u * 5) : 0.8 - 0.8 * u + 0.3 * Math.sin(u * 6.5);
    return [-1.95 - 3.6 * u, y, z];
  };
  g.jit = 0;
  for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) {
    const a = row(i / 5, k + 1), b = row((i + 1) / 5, k + 1), c = row((i + 1) / 5, k), d = row(i / 5, k);
    g.quad2(b, a, d, c, (i + k) % 2 ? coat : coatHi, coatDk);
  }
  // the head, chin up
  g.jit = 0.04;
  g.at(0, 6.36, 0.02, 0, -0.04); g.scale(1.12); drawLeaderHead(g); g.restore();
  g.jit = 0;
  g.shadeY(0.9 * scale, 3.0 * scale, 0.86);
  addMesh(group, g, flatMat, own, 'leaderStatue');
  const s = scale;
  return makeProp(group, own, null, {
    height: 9.05 * s,
    radius: 4.4 * s,                                   // circle that contains the plinth
    footprint: { w: 7.5 * s, d: 5.1 * s },             // the plinth itself, centred on the origin
    colliders: [{ x: -1.6 * s, z: 0, r: 2.6 * s }, { x: 1.6 * s, z: 0, r: 2.6 * s }],
    anchors: { plaque: V3(0, 0.47 * s, 2.47 * s), top: V3(0, 9.05 * s, -0.1 * s), briefcase: V3(2.72 * s, 2.74 * s, 0.52 * s) },
    plaqueSize: { w: 1.9 * s, h: 0.32 * s },
    triangles: g.tris,
  });
}

// ---- head and shoulders on a pedestal, about 2.3 m tall ------------------------------------------
export function createLeaderBust({ weathered = false, scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'leaderBust';
  const own = [], g = new Geo(), { F } = K;
  g.scale(scale);
  // square stone pedestal, red band, small gold plate
  g.box(0, 0, 0, 1.04, 0.12, 1.04, K.stoneDk);
  g.box(0, 0.12, 0, 0.82, 1.0, 0.82, K.stone, { side: shade(K.stone, 0.93), noTop: true });
  g.box(0, 0.84, 0, 0.86, 0.16, 0.86, K.red, { noTop: true });
  g.box(0, 1.12, 0, 1.0, 0.1, 1.0, K.stoneDk, { top: K.stone, bottom: true });
  g.box(0, 0.42, 0.41, 0.44, 0.2, 0.025, C.gold, { bottom: true });
  // the bust: monument units scaled down, cut off at the chest
  const s = 0.3, CUT = 5.3, Y0 = 1.22;
  g.at(0, Y0 - CUT * s, 0); g.scale(s);
  g.jit = 0.05;
  g.cloft(0, 0, 0, [[CUT, 3.1, 1.95, 0.6], [5.85, 3.6, 2.1, 0.6], [6.4, 1.5, 1.3, 0.4]], F, { capTop: false });
  g.jit = 0;
  drawCollarAndTie(g, CUT + 0.02, 1.0);
  g.jit = 0.04;
  g.at(0, 6.38, 0.02); drawLeaderHead(g); g.restore();
  g.jit = 0;
  if (weathered) {
    // seagulls have opinions
    const W = 0xe6e8de;
    g.quad([-0.5, 8.79, 0.5], [-0.05, 8.79, 0.62], [0.1, 8.79, -0.2], [-0.42, 8.79, -0.35], W);
    g.quad([0.35, 8.79, -0.1], [0.75, 8.79, 0.05], [0.7, 8.79, -0.6], [0.4, 8.79, -0.55], W);
    g.quad([-1.0, 8.3, 0.25], [-1.0, 8.3, -0.1], [-1.07, 7.75, -0.02], [-1.07, 7.75, 0.2], W);
    g.quad([-1.6, 5.99, 0.5], [-1.0, 6.3, 0.45], [-1.05, 6.28, -0.25], [-1.6, 5.99, -0.1], W);
    g.quad([1.0, 6.3, 0.3], [1.6, 5.99, 0.4], [1.55, 6.01, -0.35], [1.05, 6.28, -0.4], W);
  }
  g.restore();
  g.shadeY(0, 0.8 * scale, 0.88);
  addMesh(group, g, flatMat, own, 'leaderBust');
  const k = scale, top = Y0 + (6.38 + 2.4 - CUT) * s;
  return makeProp(group, own, null, {
    height: top * k,
    radius: 0.74 * k,
    footprint: { w: 1.04 * k, d: 1.04 * k },
    colliders: [{ x: 0, z: 0, r: 0.62 * k }],
    anchors: { plaque: V3(0, 0.52 * k, 0.43 * k), top: V3(0, top * k, 0) },
    plaqueSize: { w: 0.4 * k, h: 0.16 * k },
    weathered: !!weathered,
    triangles: g.tris,
  });
}

// ---- pole loudspeaker: two horns, one message ------------------------------------------------------
export function createLoudspeaker({ scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'loudspeaker';
  const own = [], g = new Geo(), pole = 0x8d949b, horn = 0xb6bdc3, dark = 0x2b2e38;
  g.scale(scale);
  g.cyl(0, 0, 0, 0.2, 0.16, shade(pole, 0.8), { seg: 5 });
  g.cyl(0, 0.16, 0, 0.09, 5.84, pole, { seg: 5, rt: 0.06 });
  g.box(0, 5.5, 0, 0.9, 0.08, 0.08, shade(pole, 0.85), { bottom: true });
  for (const sx of [-1, 1]) {
    // driver, flare, and the dark mouth
    g.at(sx * 0.2, 5.62, 0, 0, 0, -sx * Math.PI / 2 - sx * 0.12);
    g.band(0.1, 0, 0.1, 0.22, 6, 0, shade(horn, 0.8));
    g.band(0.1, 0.22, 0.38, 0.7, 6, 0, horn);
    g.fan(0.1, 0, 6, 0, shade(horn, 0.7), true);
    g.fan(0.333, 0.62, 6, 0, dark);
    g.restore();
  }
  // junction box and its conduit
  g.box(0, 1.5, 0.12, 0.3, 0.42, 0.16, shade(pole, 0.9), { bottom: true });
  g.quad([-0.02, 1.92, 0.095], [0.02, 1.92, 0.095], [0.02, 5.5, 0.07], [-0.02, 5.5, 0.07], dark);
  g.shadeY(0, 1.2 * scale, 0.85);
  addMesh(group, g, flatMat, own, 'loudspeaker');
  const k = scale;
  return makeProp(group, own, null, {
    height: 6.0 * k,
    radius: 0.25 * k,
    colliders: [{ x: 0, z: 0, r: 0.25 * k }],
    anchors: { top: V3(0, 6.0 * k, 0), horns: [V3(-0.9 * k, 5.7 * k, 0), V3(0.9 * k, 5.7 * k, 0)], box: V3(0, 1.7 * k, 0.2 * k) },
    triangles: g.tris,
  });
}
