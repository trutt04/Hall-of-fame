// The island's art kit: a batcher that merges static props per area and material, and the drawing
// helpers every part of the island shares (the cheer bow, stars, cotton-candy trees, lamps with
// glowing bows, benches, picket fences, flowers, balloons, cloud puffs).
//
//   const batch = createBatch()
//   batch.geo(key, kind)       -> Geo   kind: 'flat' | 'glow' | 'add' | 'glass'
//   batch.build(parent, own)   one mesh per (key, kind); returns { meshes, triangles }
//
// Draw helpers take a Geo and draw in its current transform. Sizes are meters; a character is
// about 1.45 m tall.

import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade, mix } from './geo.js';
import { flatMat, glowMat, glassMat, makeAddMaterial } from './materials.js';
import { PALETTE } from '../config.js';

const hex = (s) => parseInt(s.slice(1), 16);
export const K = {
  pink: hex(PALETTE.pink), pinkSoft: hex(PALETTE.pinkSoft), pinkPale: hex(PALETTE.pinkPale),
  black: hex(PALETTE.black), ink: hex(PALETTE.ink), white: hex(PALETTE.white), cloud: hex(PALETTE.cloud),
  cloudShadow: hex(PALETTE.cloudShadow), lilac: hex(PALETTE.lilac), lavender: hex(PALETTE.lavender),
  babyBlue: hex(PALETTE.babyBlue), mint: hex(PALETTE.mint), lemon: hex(PALETTE.lemon), peach: hex(PALETTE.peach),
  coral: hex(PALETTE.coral), grass: hex(PALETTE.grass), grassDark: hex(PALETTE.grassDark), gold: hex(PALETTE.gold),
  rPink: hex(PALETTE.rhinestonePink), rPurple: hex(PALETTE.rhinestonePurple), rSilver: hex(PALETTE.rhinestoneSilver),
  teamA: hex(PALETTE.teamA), teamB: hex(PALETTE.teamB), sunset: hex(PALETTE.sunset),
  // extras for the world
  trunk: 0xf7e3ec, trunkStripe: 0xff9ccc, wood: 0xe8c6a6, woodDk: 0xc99c7c, stone: 0xefe2ee, stoneDk: 0xcdb9d6,
  soil: 0xb98d8f, leaf: 0x8fdcaa, leafDk: 0x6cc490, water: 0x9fe3ff, waterDk: 0x6cc7f0,
};
// Pastel canopy sets for cotton-candy trees: [main, light, deep]
export const CANOPY = [
  [0xffb3d9, 0xffd8ec, 0xf28dc0], // pink
  [0xd4b6ff, 0xeadcff, 0xb594ee], // lilac
  [0xa9ecd0, 0xd6f8e8, 0x82d9b6], // mint
  [0xffd0b0, 0xffe6d2, 0xf7b08e], // peach
];
export const FLOWER = [0xff7ab8, 0xffffff, 0xffe066, 0xc49bff, 0x9fd8ff, 0xff9e9e, 0xffb3e0];

// Clouds glow a little from inside, so their facets stay soft instead of reading as rocks.
export const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xfff2fa, emissiveIntensity: 0.32 });
cloudMat.name = 'c9-cloud';
cloudMat.userData = { shared: true };

// Static props are merged per zone of the island: four quadrants round its middle, plus the isle.
export function zoneKey(x, z) {
  if (x > 68) return 'east';
  return (z < -2 ? 'n' : 's') + (x < 0 ? 'w' : 'e');
}

// ------------------------------------------------------------------------------------- batcher
export function createBatch() {
  const buckets = new Map();
  return {
    geo(key, kind = 'flat') {
      const id = key + '|' + kind;
      let b = buckets.get(id);
      if (!b) {
        b = { key, kind, g: new Geo({ alpha: kind !== 'flat' && kind !== 'glow' && kind !== 'cloud' }) };
        buckets.set(id, b);
      }
      return b.g;
    },
    build(parent, own, mats = {}) {
      const meshes = [];
      let triangles = 0;
      const addMatShared = mats.add || null;
      for (const b of buckets.values()) {
        if (!b.g.tris) continue;
        let mat = flatMat;
        if (b.kind === 'glow') mat = mats.glow || glowMat;
        else if (b.kind === 'glass') mat = mats.glass || glassMat;
        else if (b.kind === 'cloud') mat = mats.cloud || cloudMat;
        else if (b.kind === 'add') mat = addMatShared || makeAddMaterial(0xffffff, 1);
        else if (b.kind !== 'flat' && mats[b.kind]) mat = mats[b.kind];
        if (b.kind === 'add' && !addMatShared) own.push(mat);
        const geo = b.g.build();
        own.push(geo);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = b.key + ':' + b.kind;
        mesh.matrixAutoUpdate = false;
        if (b.kind !== 'flat' && b.kind !== 'glow' && b.kind !== 'cloud') mesh.renderOrder = 3;
        parent.add(mesh);
        meshes.push(mesh);
        triangles += b.g.tris;
      }
      return { meshes, triangles };
    },
  };
}

// ------------------------------------------------------------------------------------- shapes
// Flat star facing +Z with `points` tips, centred at (x, y, z). Thickness > 0 makes it a slab.
export function star(g, x, y, z, ro, ri, col, o = {}) {
  const n = o.points || 5;
  const th = o.thick || 0;
  const back = o.back === undefined ? col : o.back;
  const side = o.side === undefined ? shade(col, 0.8) : o.side;
  g.at(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0);
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? ri : ro;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const zf = th / 2;
  for (let i = 0; i < n * 2; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % (n * 2)];
    g.tri([0, 0, zf], [p[0], p[1], zf], [q[0], q[1], zf], col);
    if (th > 0 || o.double) g.tri([0, 0, -zf], [q[0], q[1], -zf], [p[0], p[1], -zf], back);
    if (th > 0) g.quad([p[0], p[1], -zf], [q[0], q[1], -zf], [q[0], q[1], zf], [p[0], p[1], zf], side);
  }
  return g.restore();
}

// Heart facing +Z, centred at (x, y, z), size s across.
export function heart(g, x, y, z, s, col, o = {}) {
  g.at(x, y, z, o.ry || 0, 0, o.rz || 0);
  const pts = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([(hx / 34) * s, (hy / 34) * s + s * 0.08]);
  }
  const th = o.thick || 0;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    g.tri([0, 0, th / 2], [q[0], q[1], th / 2], [p[0], p[1], th / 2], col);
    if (th > 0) {
      g.tri([0, 0, -th / 2], [p[0], p[1], -th / 2], [q[0], q[1], -th / 2], o.back === undefined ? col : o.back);
      g.quad([p[0], p[1], -th / 2], [p[0], p[1], th / 2], [q[0], q[1], th / 2], [q[0], q[1], -th / 2], shade(col, 0.8));
    }
  }
  // the winding above runs clockwise; flip handled by drawing (0, q, p)
  return g.restore();
}

// The signature cheer bow, centred on its knot at (x, y, z), facing +Z, `s` meters across.
// o: { color, star (star colour or null), ry, rx, rz, detail: 'hi' | 'lo', tails: bool, knot }
export function bow(g, x, y, z, s, o = {}) {
  const col = o.color === undefined ? K.pink : o.color;
  const dk = shade(col, 0.78);
  const lt = shade(col, 1.18);
  const hi = o.detail !== 'lo' && o.detail !== 'mini';
  g.at(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0);
  g.scale(s);
  if (o.detail === 'mini') {
    for (const sx of [-1, 1]) {
      g.ico(sx * 0.3, 0.03, 0, 0.27, col, { detail: 0, sx: 1.05, sy: 0.85, sz: 0.4, rz: sx * 0.25 });
      if (o.star !== null && o.star !== undefined) star(g, sx * 0.33, 0.05, 0.11, 0.07, 0.03, o.star);
    }
    g.tri2([-0.04, -0.06, 0], [-0.26, -0.42, 0], [-0.1, -0.44, 0], dk);
    g.tri2([0.04, -0.06, 0], [0.1, -0.44, 0], [0.26, -0.42, 0], dk);
    g.box(0, -0.12, 0, 0.18, 0.24, 0.18, o.knot === undefined ? dk : o.knot);
    return g.restore();
  }
  // two lobes: lofted along +-X, wide at the tip, pinched at the knot, tipped up a little
  for (const sx of [-1, 1]) {
    g.save();
    g.rotZ(sx * 0.2);
    g.scale(sx, 1, 1);
    if (hi) {
      g.cloft(0, 0, 0, [
        [0.06, 0.2, 0.18, 0.06, 0, 0],
        [0.2, 0.42, 0.21, 0.08, 0, 0, lt],
        [0.36, 0.56, 0.22, 0.1, 0, 0, col],
        [0.47, 0.54, 0.21, 0.12, 0, 0],
        [0.52, 0.34, 0.16, 0.1, 0, 0],
      ], col, { rz: -Math.PI / 2, capTop: dk, capBot: false });
      // the fold where the loop tucks into the knot
      g.box(0.16, -0.01, 0.1, 0.18, 0.02, 0.012, dk, { rx: Math.PI / 2, bottom: true });
    } else {
      g.cloft(0, 0, 0, [[0.06, 0.2, 0.16, 0.05], [0.3, 0.5, 0.2, 0.09], [0.5, 0.36, 0.16, 0.08]], col, { rz: -Math.PI / 2, capTop: dk });
    }
    g.restore();
    if (o.star !== null && o.star !== undefined) {
      const sc = o.star;
      g.save();
      g.rotZ(sx * 0.2);
      star(g, sx * 0.34, 0.1, 0.112, 0.07, 0.03, sc);
      if (hi) {
        star(g, sx * 0.22, -0.1, 0.108, 0.045, 0.019, sc);
        star(g, sx * 0.44, -0.08, 0.108, 0.05, 0.021, sc);
      }
      g.restore();
    }
  }
  // tails: two ribbons hanging from the knot, V-notched ends
  if (o.tails !== false) {
    for (const sx of [-1, 1]) {
      g.at(sx * 0.03, -0.06, 0.0, 0, 0, sx * 0.42);
      const w = 0.085;
      const L = hi ? 0.44 : 0.36;
      const th = 0.012;
      const A = [-w, 0, th];
      const B = [w, 0, th];
      const C = [w, -L, th];
      const N = [0, -L + 0.08, th];
      const D = [-w, -L, th];
      g.quad(A, D, N, B, col);
      g.tri(B, N, C, col);
      g.quad([w, 0, -th], [0, -L + 0.08, -th], [-w, -L, -th], [-w, 0, -th], dk);
      g.tri([w, -L, -th], [0, -L + 0.08, -th], [w, 0, -th], dk);
      g.quad([w, 0, -th], [w, 0, th], [w, -L, th], [w, -L, -th], dk);
      g.quad([-w, -L, -th], [-w, -L, th], [-w, 0, th], [-w, 0, -th], dk);
      g.restore();
    }
  }
  // the knot wrap
  const kc = o.knot === undefined ? dk : o.knot;
  g.cloft(0, -0.13, 0, [[0, 0.17, 0.2, 0.06], [0.13, 0.2, 0.24, 0.07], [0.26, 0.17, 0.2, 0.06]], kc, {});
  return g.restore();
}

// A rhinestone starburst: an eight-point twinkle in the vertical plane, for the additive mesh.
export function burst(g, x, y, z, s, col, a = 1, o = {}) {
  const sa = g.a;
  g.a = a;
  g.at(x, y, z, o.ry || 0);
  const t = s * 0.16;
  for (let k = 0; k < 2; k++) {
    const L = k ? s * 0.55 : s;
    g.save();
    if (k) g.rotZ(Math.PI / 4);
    g.tri2([-t, 0, 0], [t, 0, 0], [0, L, 0], col).tri2([-t, 0, 0], [0, -L, 0], [t, 0, 0], col);
    g.tri2([0, -t, 0], [L, 0, 0], [0, t, 0], col).tri2([0, -t, 0], [0, t, 0], [-L, 0, 0], col);
    g.restore();
  }
  g.restore();
  g.a = sa;
  return g;
}

// A puffy cloud made of faceted blobs, base at (x, y, z), about 2 * s across.
export function puff(g, x, y, z, s, rnd, o = {}) {
  const col = o.color === undefined ? K.cloud : o.color;
  const under = o.under === undefined ? K.cloudShadow : o.under;
  const lumps = o.lumps || 5;
  const detail = o.detail === undefined ? 1 : o.detail;
  const flat = o.flat === undefined ? 0.45 : o.flat;
  const from = g.tris;
  g.ico(x, y + s * 0.42, z, s * 0.62, col, { detail, jitter: 0.08, rnd, sy: 0.78, flat });
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * TAU + rnd() * 0.8;
    const d = s * (0.5 + rnd() * 0.25);
    const r = s * (0.32 + rnd() * 0.2);
    g.ico(x + Math.cos(a) * d, y + r * 0.62 + rnd() * s * 0.15, z + Math.sin(a) * d * (o.squash || 0.8), r, i % 2 ? col : shade(col, 0.985), { detail: detail > 0 && r > s * 0.4 ? 1 : 0, jitter: 0.1, rnd, sy: 0.8, flat });
  }
  if (o.shade !== false) {
    // undersides catch the pink bounce from the clouds below
    const n = g.alpha ? 4 : 3;
    const uc = [((under >> 16) & 255) / 255, ((under >> 8) & 255) / 255, (under & 255) / 255].map((v) => Math.pow(v, 2.2));
    for (let i = from * 3; i < g.p.length / 3; i++) {
      const t = Math.min(1, Math.max(0, (g.p[i * 3 + 1] - y) / (s * 0.55)));
      const k = 1 - t;
      g.c[i * n] = g.c[i * n] * (1 - k * 0.55) + uc[0] * k * 0.55;
      g.c[i * n + 1] = g.c[i * n + 1] * (1 - k * 0.55) + uc[1] * k * 0.55;
      g.c[i * n + 2] = g.c[i * n + 2] * (1 - k * 0.55) + uc[2] * k * 0.55;
    }
  }
  return g;
}

// ------------------------------------------------------------------------------------- props
// Cotton-candy tree, base at (x, y, z). v picks the canopy colour, s scales it (about 5 m tall).
export function cottonTree(g, x, y, z, s, v, rnd, o = {}) {
  const [main, light, deep] = CANOPY[((v % CANOPY.length) + CANOPY.length) % CANOPY.length];
  const lo = o.low;
  g.at(x, y, z, o.ry || 0);
  g.scale(s);
  const from = g.tris;
  // a slim candy-striped trunk with a little lean
  const lean = (rnd() - 0.5) * 0.25;
  g.save();
  g.rotZ(lean * 0.5);
  g.lathe(0, 0, 0, [
    [0.24, 0, K.trunk], [0.19, 0.5, K.trunkStripe], [0.17, 1.0, K.trunk], [0.15, 1.5, K.trunkStripe], [0.1, 2.6],
  ], K.trunk, { seg: 5, capTop: false });
  g.restore();
  const top = 2.6;
  const tx = -Math.sin(lean * 0.5) * top;
  // canopy: one big puff and a crown of smaller ones, highlights on top
  g.ico(tx, top + 0.9, 0, 1.35, main, { detail: lo ? 0 : 1, jitter: 0.1, rnd, sy: 0.85 });
  const n = lo ? 3 : 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd() * 0.6;
    const d = 0.85 + rnd() * 0.35;
    const r = 0.62 + rnd() * 0.3;
    const yy = top + 0.55 + rnd() * 0.9;
    g.ico(tx + Math.cos(a) * d, yy, Math.sin(a) * d, r, yy > top + 1.0 ? light : i % 2 ? main : deep, { detail: 0, jitter: 0.12, rnd });
  }
  g.ico(tx + 0.1, top + 1.95, 0.05, 0.72, light, { detail: 0, jitter: 0.1, rnd });
  // soft vertical shading so the canopy reads round
  shadeRange(g, from, top - 0.2, top + 2.4, 0.78);
  return g.restore();
}

// Multiply colours of triangles added since `from` by a ramp f0 (at y0) to 1 (at y1), in world space.
export function shadeRange(g, from, y0, y1, f0) {
  const n = g.alpha ? 4 : 3;
  const e = g.m.elements;
  // y0 and y1 are in the current local frame: convert with the transform's Y
  const Y0 = e[13] + e[5] * y0;
  const Y1 = e[13] + e[5] * y1;
  for (let i = from * 3; i < g.p.length / 3; i++) {
    let t = (g.p[i * 3 + 1] - Y0) / (Y1 - Y0 || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const f = f0 + (1 - f0) * t;
    g.c[i * n] *= f;
    g.c[i * n + 1] *= f;
    g.c[i * n + 2] *= f;
  }
}

// The big tree on the hill: a twisting trunk, three branches, a cloud of mixed canopies, a swing.
export function bigTree(g, x, y, z, s, rnd) {
  g.at(x, y, z);
  g.scale(s);
  const from = g.tris;
  g.lathe(0, 0, 0, [[0.95, 0, K.trunk], [0.7, 0.6, K.trunkStripe], [0.58, 1.4, K.trunk], [0.52, 2.4, K.trunkStripe], [0.46, 3.4, K.trunk], [0.4, 4.6]], K.trunk, { seg: 7, capTop: false });
  const branches = [[-2.6, 6.2, 0.6], [2.4, 6.6, -0.8], [0.4, 7.4, 2.2]];
  for (const [bx, by, bz] of branches) g.tube([[0, 4.2, 0], [bx * 0.5, by - 0.8, bz * 0.5], [bx, by, bz]], 0.26, K.trunk, { seg: 5, r1: 0.12 });
  const blobs = [[0, 8.2, 0, 2.6, 0], [-2.8, 7.1, 0.8, 1.9, 1], [2.7, 7.4, -0.9, 2.0, 2], [0.6, 7.6, 2.5, 1.8, 0], [-0.8, 7.3, -2.4, 1.8, 1], [1.2, 9.6, 0.4, 1.6, 2], [-1.5, 9.2, -0.6, 1.4, 0], [3.4, 8.6, 1.4, 1.2, 1], [-3.3, 8.4, -1.6, 1.2, 2]];
  for (const [bx, by, bz, r, v] of blobs) {
    const [main, light] = CANOPY[v];
    g.ico(bx, by, bz, r, by > 8.8 ? light : main, { detail: 1, jitter: 0.1, rnd, sy: 0.86 });
  }
  shadeRange(g, from, 5.5, 10.5, 0.74);
  // a swing hanging from the long branch
  const sx = -2.0;
  const sz = 0.5;
  for (const dz of [-0.35, 0.35]) g.tube([[sx, 6.0, sz + dz], [sx, 0.75, sz + dz]], 0.025, K.white, { seg: 3 });
  g.box(sx, 0.62, sz, 0.5, 0.08, 0.9, K.pink, { top: K.pinkSoft });
  return g.restore();
}

// Lamp post: white post with pink bands, a lantern, and a glowing bow on top. The post goes in
// `g`, the bulb and bow in `glow` (unlit), the halo in `add` (additive).
export function lamp(g, glow, add, x, y, z, ry = 0, o = {}) {
  const H = o.h || 3.3;
  g.at(x, y, z, ry);
  g.cyl(0, 0, 0, 0.2, 0.18, K.white, { seg: 6 });
  g.cyl(0, 0.18, 0, 0.11, 0.35, K.pinkSoft, { seg: 6, rt: 0.075 });
  g.cyl(0, 0.53, 0, 0.065, H - 0.95, K.white, { seg: 6, rt: 0.055, top: false });
  // lantern: a pink cap over a glowing glass
  g.cyl(0, H - 0.42, 0, 0.16, 0.06, K.pink, { seg: 6 });
  g.cone(0, H + 0.06, 0, 0.24, 0.2, K.pink, { seg: 6, bottom: K.pinkSoft });
  g.restore();
  glow.at(x, y, z, ry);
  glow.cyl(0, H - 0.36, 0, 0.12, 0.4, 0xfff2c4, { seg: 5 });
  bow(glow, 0, H + 0.42, 0, 0.62, { color: o.bow || 0xff4fa7, star: K.black, detail: 'mini' });
  glow.restore();
  if (add) {
    add.at(x, y, z, ry);
    const sa = add.a;
    add.a = 0.2;
    add.ico(0, H - 0.18, 0, 0.36, 0xffd0ea, { detail: 0 });
    add.a = sa;
    add.restore();
  }
}

// Bench, centred at (x, y, z), sitting side toward local +Z.
export function bench(g, x, y, z, ry, o = {}) {
  const seat = o.color || K.pinkSoft;
  const leg = o.leg || K.white;
  g.at(x, y, z, ry);
  for (const sx of [-0.72, 0.72]) {
    g.box(sx, 0, 0.08, 0.1, 0.42, 0.42, leg);
    g.box(sx, 0.42, -0.16, 0.1, 0.5, 0.08, leg, { rx: -0.12 });
  }
  for (let i = 0; i < 3; i++) g.box(0, 0.42, -0.08 + i * 0.16, 1.8, 0.06, 0.13, i % 2 ? shade(seat, 1.06) : seat);
  for (let i = 0; i < 2; i++) g.box(0, 0.62 + i * 0.2, -0.2 - i * 0.025, 1.8, 0.13, 0.05, seat, { rx: -0.12 });
  // a little heart on the backrest
  heart(g, 0, 0.76, -0.16, 0.2, K.white);
  return g.restore();
}

// Picket fence from (x0, z0) to (x1, z1) on the ground given by yAt(x, z).
export function fence(g, x0, z0, x1, z1, yAt, o = {}) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.1) return g;
  const ux = (x1 - x0) / len;
  const uz = (z1 - z0) / len;
  const H = o.h || 0.95;
  const W = K.white;
  const tip = o.tip || K.pinkSoft;
  const ry = Math.atan2(ux, uz) + Math.PI / 2;
  const n = Math.max(1, Math.round(len / (o.step || 0.55)));
  const posts = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    g.box(px, yAt(px, pz) - 0.05, pz, 0.12, H + 0.15, 0.12, W, { ry, top: tip });
  }
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    const py = yAt(px, pz) - 0.05;
    g.at(px, py, pz, ry);
    const w = 0.07;
    const h = H - 0.12;
    g.quad2([-w, 0, 0], [w, 0, 0], [w, h, 0], [-w, h, 0], W, shade(W, 0.93));
    g.tri2([-w, h, 0], [w, h, 0], [0, h + 0.13, 0], tip);
    g.restore();
  }
  // two rails, following the ground at each end
  for (const ry0 of [0.28, H - 0.3]) {
    const ya = yAt(x0, z0) + ry0;
    const yb = yAt(x1, z1) + ry0;
    const nx = -uz * 0.035;
    const nz = ux * 0.035;
    g.quad([x0 + nx, ya, z0 + nz], [x1 + nx, yb, z1 + nz], [x1 + nx, yb + 0.07, z1 + nz], [x0 + nx, ya + 0.07, z0 + nz], W);
    g.quad([x1 - nx, yb, z1 - nz], [x0 - nx, ya, z0 - nz], [x0 - nx, ya + 0.07, z0 - nz], [x1 - nx, yb + 0.07, z1 - nz], shade(W, 0.92));
    g.quad([x0 - nx, ya + 0.07, z0 - nz], [x0 + nx, ya + 0.07, z0 + nz], [x1 + nx, yb + 0.07, z1 + nz], [x1 - nx, yb + 0.07, z1 - nz], W);
  }
  return g;
}

// A single bloom: five petals round a centre, facing up, on a short stem.
export function flower(g, x, y, z, s, col, o = {}) {
  const c = o.center === undefined ? K.lemon : o.center;
  const h = (o.h === undefined ? 0.34 : o.h) * s;
  g.tri2([x - 0.012, y, z], [x + 0.012, y, z], [x, y + h, z], K.leafDk);
  const r = 0.11 * s;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + (o.ph || 0);
    const a0 = a - 0.42;
    const a1 = a + 0.42;
    g.tri([x, y + h, z], [x + Math.cos(a1) * r, y + h + 0.01, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y + h + 0.01, z + Math.sin(a0) * r], col);
  }
  g.tri([x - 0.03 * s, y + h + 0.025, z - 0.02 * s], [x, y + h + 0.025, z + 0.035 * s], [x + 0.03 * s, y + h + 0.025, z - 0.02 * s], c);
  return g;
}

// A round flower bed: a mound of leaves and a scatter of blooms, about 2 * r across.
export function flowerBed(g, x, y, z, r, rnd, o = {}) {
  const pal = o.palette || FLOWER;
  const n = o.count || Math.round(r * r * 5);
  g.cyl(x, y - 0.06, z, r, 0.16, K.soil, { seg: 9, rt: r * 0.94, top: K.leafDk });
  g.ico(x, y + 0.08, z, r * 0.8, K.leaf, { detail: 0, jitter: 0.15, rnd, sy: 0.32, flat: 0.1 });
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const d = Math.sqrt(rnd()) * r * 0.85;
    const px = x + Math.cos(a) * d;
    const pz = z + Math.sin(a) * d;
    const hy = y + 0.08 + 0.18 * (1 - (d / r) * (d / r));
    flower(g, px, hy, pz, 0.9 + rnd() * 0.5, pal[Math.floor(rnd() * pal.length)], { ph: rnd() * TAU, h: 0.2 + rnd() * 0.2 });
  }
  return g;
}

// A soft round bush with a few flowers.
export function bushy(g, x, y, z, s, rnd, o = {}) {
  const col = o.color || K.leaf;
  const from = g.tris;
  g.ico(x, y + 0.45 * s, z, 0.8 * s, col, { detail: 1, jitter: 0.1, rnd, sy: 0.75, flat: 0.5 });
  g.ico(x + 0.55 * s, y + 0.35 * s, z + 0.2 * s, 0.5 * s, shade(col, 1.05), { detail: 0, jitter: 0.12, rnd, sy: 0.8, flat: 0.5 });
  g.ico(x - 0.5 * s, y + 0.32 * s, z - 0.25 * s, 0.48 * s, shade(col, 0.96), { detail: 0, jitter: 0.12, rnd, sy: 0.8, flat: 0.5 });
  shadeRange(g, from, y, y + 1.0 * s, 0.75);
  if (o.flowers !== false) {
    for (let i = 0; i < 6; i++) {
      const a = rnd() * TAU;
      const px = x + Math.cos(a) * 0.62 * s;
      const pz = z + Math.sin(a) * 0.55 * s;
      g.ico(px, y + (0.55 + rnd() * 0.35) * s, pz, 0.07 * s + 0.03, FLOWER[Math.floor(rnd() * FLOWER.length)], { detail: 0 });
    }
  }
  return g;
}

// A round planter with flowers.
export function planter(g, x, y, z, rnd, v = 0) {
  const pot = [K.pinkPale, K.lilac, K.white][((v % 3) + 3) % 3];
  g.lathe(x, y, z, [[0.78, 0, shade(pot, 0.85)], [0.9, 0.12, pot], [1.0, 0.55, pot], [1.05, 0.62, shade(pot, 1.06)], [0.96, 0.66]], pot, { seg: 10, capTop: K.soil });
  flowerBed(g, x, y + 0.6, z, 0.85, rnd, { count: 9 });
  return g;
}

// A pastel rock at the rim.
export function rock(g, x, y, z, s, rnd, v = 0) {
  const col = [0xe8d6ea, 0xf3d9cf, 0xd9d0f0, 0xf0c8d8][((v % 4) + 4) % 4];
  g.ico(x, y + 0.22 * s, z, 0.55 * s, col, { detail: 0, jitter: 0.22, rnd, sy: 0.62, flat: 0.35 });
  return g;
}

// A little crystal cluster (the bright bits go in `g` too; they read as gems under flat shading).
export function crystal(g, x, y, z, s, rnd, v = 0) {
  const col = [K.rPink, K.rPurple, 0x9fe8ff, 0xffb3e6][((v % 4) + 4) % 4];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd();
    const lean = 0.2 + rnd() * 0.3;
    const h = (0.45 + rnd() * 0.5) * s;
    const r = (0.09 + rnd() * 0.06) * s;
    g.at(x + Math.cos(a) * 0.12 * s, y - 0.05, z + Math.sin(a) * 0.12 * s, a, lean * Math.cos(a), lean * Math.sin(a));
    g.cyl(0, 0, 0, r, h, col, { seg: 5, top: false });
    g.cone(0, h, 0, r, r * 2.4, shade(col, 1.15), { seg: 5 });
    g.restore();
  }
  return g;
}

// Block-letter text that reads from both sides: front faces +Z, back faces -Z.
export function text2(g, str, x, y, z, px, col, o = {}) {
  const gap = o.gap || 0.004;
  g.at(x, y, z, o.ry || 0);
  g.text(str, 0, 0, gap, px, col, { align: o.align });
  g.rotY(Math.PI);
  g.text(str, 0, 0, gap, px, col, { align: o.align });
  g.restore();
  return g;
}

export { shade, mix, TAU };
