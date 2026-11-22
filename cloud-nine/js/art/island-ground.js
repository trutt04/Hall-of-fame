// The ground of Cloud Nine: the island's lawns, its curled grass rim, the striped rock mountain
// hanging underneath, the painted paving (paths, the plaza starburst, the court, the field, the
// lawn), the bow boutique isle, and the little rocks floating round about.
//
//   const ground = buildGround(plan, { quality })
//   ground.group, ground.triangles, ground.update(dt, t), ground.dispose()
//
// The top surface is cut from the same height grid groundAt() uses, with the same diagonal split,
// so feet sit exactly on the grass. The rim is traced with marching squares, which gives a smooth
// edge at grid resolution; the lip and the mountain hang off those rim segments, so nothing cracks.

import * as THREE from '../../lib/three.module.min.js';
import { lin, Geo, hash, shade } from './geo.js';
import { flatMat, blobMat } from './materials.js';
import { rng, motion } from './util.js';
import { valueNoise2, smoothstep, clamp, TAU } from '../core/util.js';
import { toWorld, toLocal } from './island-layout.js';
import { K } from './island-kit.js';

// ------------------------------------------------------------------------------------- soup
// Triangles with per-face linear colours, wound to face up (tri) or away from a point (out).
class Soup {
  constructor() {
    this.p = [];
    this.c = [];
  }
  raw(a, b, c, col) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.c.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
  }
  up(a, b, c, col) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny < 0) this.raw(a, c, b, col);
    else this.raw(a, b, c, col);
  }
  // faces away from (fx, fz) horizontally (for walls hanging off the rim)
  out(a, b, c, col, fx, fz) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - fx;
    const mz = (a[2] + b[2] + c[2]) / 3 - fz;
    if (nx * mx + nz * mz < 0) this.raw(a, c, b, col);
    else this.raw(a, b, c, col);
  }
  get tris() { return this.p.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const L = (h) => lin(h);
const mixc = (a, b, t, out = [0, 0, 0]) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

const GRASS = L(K.grass);
const GRASS_DK = L(K.grassDark);
const GRASS_MINT = L(0xa6ecc8);
const GRASS_SUN = L(0xcdf0a2);
const GRASS_LUSH = L(0x8fd99a);
const STRATA = [0xe9b6c6, 0xd4bdf0, 0xf4c9b4, 0xbfa7e4, 0xe7aac4, 0xa993d6, 0xc7b4ee, 0x9c88cc].map(L);
const SOIL = L(0xd9a596);
const SOIL_DK = L(0xc28e8a);

// ------------------------------------------------------------------------------------- surface
// Marching squares over a height grid. Triangles go to `soup`, rim segments to `rim`.
function surface(grid, colorAt, soup, rim) {
  const { X0, Z0, NX, NZ, cell, H, M } = grid;
  const W = NX + 1;
  const P = (i, j) => [X0 + i * cell, H[j * W + i], Z0 + j * cell];
  const col = [0, 0, 0];
  const tri = (a, b, c) => {
    colorAt((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3, (a[1] + b[1] + c[1]) / 3, col);
    soup.up(a, b, c, col);
  };
  // rim points are keyed by grid edge so neighbouring cells share them exactly
  const edgePt = new Map();
  const cross = (i0, j0, i1, j1) => {
    const k0 = j0 * W + i0;
    const k1 = j1 * W + i1;
    const key = k0 < k1 ? k0 * 4 + (k1 - k0 === 1 ? 0 : 1) : k1 * 4 + (k0 - k1 === 1 ? 0 : 1);
    let p = edgePt.get(key);
    if (!p) {
      const m0 = M[k0];
      const m1 = M[k1];
      const t = m0 / (m0 - m1);
      const a = P(i0, j0);
      const b = P(i1, j1);
      p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      edgePt.set(key, p);
    }
    return p;
  };
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const ins = c.map(([a, b]) => M[b * W + a] >= 0);
      const n = ins[0] + ins[1] + ins[2] + ins[3];
      if (n === 0) continue;
      if (n === 4) {
        const a = P(i, j);
        const b = P(i + 1, j);
        const cc = P(i, j + 1);
        const d = P(i + 1, j + 1);
        if (((i + j) & 1) === 0) {
          tri(a, cc, d);
          tri(a, d, b);
        } else {
          tri(a, cc, b);
          tri(b, cc, d);
        }
        continue;
      }
      const poly = [];
      const xs = [];
      for (let k = 0; k < 4; k++) {
        const k1 = (k + 1) & 3;
        if (ins[k]) poly.push(P(c[k][0], c[k][1]));
        if (ins[k] !== ins[k1]) {
          const p = cross(c[k][0], c[k][1], c[k1][0], c[k1][1]);
          poly.push(p);
          xs.push(p);
        }
      }
      for (let k = 1; k < poly.length - 1; k++) tri(poly[0], poly[k], poly[k + 1]);
      if (xs.length === 2) rim.push([xs[0], xs[1]]);
      else if (xs.length === 4) rim.push([xs[0], xs[1]], [xs[2], xs[3]]);
    }
  }
}

// The lip and the hanging mountain: bands hung off every rim segment, each band pulled in toward
// the centre and down. Vertices depend only on the rim point, so neighbours share them.
function mountain(rim, cx, cz, soup, o) {
  const bands = o.bands;
  const ring = (p, k) => {
    const dx = p[0] - cx;
    const dz = p[2] - cz;
    const r = Math.hypot(dx, dz) || 1;
    const b = Math.atan2(dx, -dz);
    const B = bands[k];
    const wob = 1 + (B.wobble || 0) * (valueNoise2(b * (B.freq || 6) + k * 3.7, k * 1.3 + o.seed) - 0.5) * 2;
    const rr = B.f !== undefined ? r * B.f * wob : (r + B.dr) * (B.dr < 0 ? wob : 1);
    const yy = B.y !== undefined ? B.y + (B.yj || 0) * (valueNoise2(b * 5 + k, o.seed + k * 7.1) - 0.5) * 2 : p[1] + B.dy;
    return [cx + (dx / r) * rr, yy, cz + (dz / r) * rr];
  };
  const cache = new Map();
  const get = (p, k) => {
    let arr = cache.get(p);
    if (!arr) {
      arr = [];
      cache.set(p, arr);
    }
    if (!arr[k]) arr[k] = k === 0 ? p : ring(p, k);
    return arr[k];
  };
  const tip = [cx, o.tipY, cz];
  const colr = [0, 0, 0];
  for (const [a, b] of rim) {
    const mb = Math.atan2((a[0] + b[0]) / 2 - cx, -((a[2] + b[2]) / 2 - cz));
    for (let k = 0; k < bands.length - 1; k++) {
      const A0 = get(a, k);
      const B0 = get(b, k);
      const A1 = get(a, k + 1);
      const B1 = get(b, k + 1);
      o.color(k, mb, colr);
      const j = 0.94 + 0.12 * hash(Math.round(mb * 1000) * 31 + k);
      const cc = mul(colr, j);
      soup.out(A0, B0, B1, cc, cx, cz);
      soup.out(A0, B1, A1, cc, cx, cz);
    }
    const A = get(a, bands.length - 1);
    const B = get(b, bands.length - 1);
    o.color(bands.length - 1, mb, colr);
    soup.out(A, B, tip, colr, cx, cz);
  }
}

// ------------------------------------------------------------------------------------- ribbons
// A strip along a polyline on the ground. offsets: lateral stops; color(s, i) per band and step.
function ribbon(soup, pts, yAt, o) {
  const n = pts.length;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    rows.push(o.offsets.map((off) => {
      const x = pts[i][0] - dz * off;
      const z = pts[i][1] + dx * off;
      return [x, yAt(x, z) + o.lift, z];
    }));
  }
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < o.offsets.length - 1; s++) {
      const c = o.color(s, i);
      soup.up(rows[i][s], rows[i][s + 1], rows[i + 1][s + 1], c);
      soup.up(rows[i][s], rows[i + 1][s + 1], rows[i + 1][s], c);
    }
  }
}

function resample(pts, step) {
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.round(len / step));
    for (let s = 1; s <= k; s++) out.push([a[0] + ((b[0] - a[0]) * s) / k, a[1] + ((b[1] - a[1]) * s) / k]);
  }
  return out;
}

// Rings of wedges round (cx, cz) between r0 and r1. color(i) per wedge.
function ring(soup, cx, cz, r0, r1, seg, yAt, lift, color, rot = 0) {
  for (let i = 0; i < seg; i++) {
    const a0 = rot + (i / seg) * TAU;
    const a1 = rot + ((i + 1) / seg) * TAU;
    const P = (r, a) => {
      const x = cx + Math.sin(a) * r;
      const z = cz - Math.cos(a) * r;
      return [x, yAt(x, z) + lift, z];
    };
    const c = typeof color === 'function' ? color(i) : color;
    if (r0 <= 0.001) soup.up([cx, yAt(cx, cz) + lift, cz], P(r1, a0), P(r1, a1), c);
    else {
      soup.up(P(r0, a0), P(r1, a0), P(r1, a1), c);
      soup.up(P(r0, a0), P(r1, a1), P(r0, a1), c);
    }
  }
}

// A rectangle in a place's frame, tessellated so it hugs the ground.
function rectPaint(soup, place, x0, z0, x1, z1, yAt, lift, color, step = 2) {
  const nx = Math.max(1, Math.ceil(Math.abs(x1 - x0) / step));
  const nz = Math.max(1, Math.ceil(Math.abs(z1 - z0) / step));
  const W = (lx, lz) => {
    const [x, z] = toWorld(place, lx, lz);
    return [x, yAt(x, z) + lift, z];
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ax = x0 + ((x1 - x0) * i) / nx;
      const bx = x0 + ((x1 - x0) * (i + 1)) / nx;
      const az = z0 + ((z1 - z0) * j) / nz;
      const bz = z0 + ((z1 - z0) * (j + 1)) / nz;
      const c = typeof color === 'function' ? color(i, j) : color;
      soup.up(W(ax, az), W(bx, az), W(bx, bz), c);
      soup.up(W(ax, az), W(bx, bz), W(ax, bz), c);
    }
  }
}

// ------------------------------------------------------------------------------------- build
export function buildGround(plan, { quality = 'high' } = {}) {
  const low = quality === 'low';
  const group = new THREE.Group();
  group.name = 'ground';
  const own = [];
  const G = plan.ground;
  // decals and shadows hug the ground; past the rim they follow the grid's extrapolation instead
  const yAt = (x, z) => (G.insideIsle(x, z) ? G.isleHeight(x, z) : G.gridHeight(x, z));
  const yIsland = (x, z) => G.gridHeight(x, z);
  let triangles = 0;
  const addSoup = (soup, name, mat = flatMat, o = {}) => {
    if (!soup.tris) return null;
    const geo = soup.geometry();
    own.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    if (o.renderOrder) mesh.renderOrder = o.renderOrder;
    group.add(mesh);
    triangles += soup.tris;
    return mesh;
  };

  // ---------------------------------------------------------------- lawns
  const gardenB = plan.garden;
  let marginOf = (x, z) => plan.main.margin(x, z);
  const grassAt = (x, z, y, out) => {
    const n1 = valueNoise2(x * 0.045 + 3.1, z * 0.045 + 8.7);
    const n2 = valueNoise2(x * 0.16 + 1.3, z * 0.16 + 5.9);
    mixc(GRASS, GRASS_DK, smoothstep(0.35, 0.8, n1) * 0.55, out);
    mixc(out, GRASS_MINT, smoothstep(0.55, 0.92, n2) * 0.4, out);
    mixc(out, GRASS_SUN, smoothstep(0.6, 2.2, y) * 0.45, out);
    if (x > gardenB.x0 - 1 && x < gardenB.x1 + 1 && z > gardenB.z0 - 1 && z < gardenB.z1 + 1) mixc(out, GRASS_LUSH, 0.45, out);
    const m = marginOf(x, z);
    if (m < 2.2) mixc(out, GRASS_SUN, 0.25 * (1 - Math.max(0, m) / 2.2), out);
    const k = 0.95 + 0.1 * hash(Math.round(x * 13.1) * 7919 + Math.round(z * 17.3));
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
    return out;
  };
  const rim = [];
  {
    // split the lawns into four quadrant meshes so the camera can cull what is behind it
    const quads = [new Soup(), new Soup(), new Soup(), new Soup()];
    const router = {
      up(a, b, c, col) {
        const mx = (a[0] + b[0] + c[0]) / 3 - plan.center.x;
        const mz = (a[2] + b[2] + c[2]) / 3 - plan.center.z;
        quads[(mx > 0 ? 1 : 0) + (mz > 0 ? 2 : 0)].up(a, b, c, col);
      },
    };
    surface(G.grid, grassAt, router, rim);
    quads.forEach((s, i) => addSoup(s, 'lawn' + i));
  }

  // ---------------------------------------------------------------- the rim lip and the mountain below
  {
    const soup = new Soup();
    const c = plan.center;
    mountain(rim, c.x, c.z, soup, {
      seed: 11,
      tipY: -58,
      bands: [
        {},
        { dr: 0.42, dy: -0.32 },
        { dr: 0.12, dy: -1.05 },
        { dr: -0.9, dy: -2.6, wobble: 0.01 },
        { f: 0.9, y: -8, wobble: 0.05, yj: 1.4, freq: 9 },
        { f: 0.74, y: -16, wobble: 0.08, yj: 2.2, freq: 7 },
        { f: 0.54, y: -26, wobble: 0.1, yj: 2.6, freq: 5 },
        { f: 0.32, y: -37, wobble: 0.13, yj: 3, freq: 5 },
        { f: 0.12, y: -48, wobble: 0.18, yj: 2.5, freq: 3 },
      ],
      color(k, b, out) {
        if (k === 0) return mixc(GRASS_DK, GRASS_SUN, 0.25, out);
        if (k === 1) return mixc(GRASS_DK, SOIL, 0.35, out);
        if (k === 2) return mixc(SOIL, SOIL_DK, 0.3, out);
        // horizontal bands, each a slightly different pastel all the way round
        const s = STRATA[(k * 3) % STRATA.length];
        return mixc(s, STRATA[(k * 3 + 1) % STRATA.length], 0.2 + 0.2 * Math.sin(b * 2 + k), out);
      },
    });
    const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xf3dcf2, emissiveIntensity: 0.22 });
    rockMat.name = 'c9-rock';
    own.push(rockMat);
    addSoup(soup, 'mountain', rockMat);
    // stalactites hanging under the island and crystal clusters glinting out of its sides
    const bits = new Geo();
    const br = rng(404);
    const m = plan.main;
    const under = (b, f) => {
      // a point on the underside at bearing b, fraction f of the way in, and its height
      const r = m.radiusAt(b) * f;
      const y = -2.6 - (1 - f) * 48 * 1.05;
      return [c.x + Math.sin(b) * r, y, c.z - Math.cos(b) * r];
    };
    const nSt = low ? 8 : 16;
    for (let i = 0; i < nSt; i++) {
      const b = (i / nSt) * TAU + br() * 0.3;
      const f = 0.42 + br() * 0.4;
      const [x, y, z] = under(b, f);
      const h = 5 + br() * 9;
      const r0 = 1.6 + br() * 1.6;
      bits.jit = 0.06;
      bits.lathe(x, y - h, z, [[0.05, 0, STRATA_HEX[(i + 3) % 8]], [r0 * 0.45, h * 0.4, STRATA_HEX[(i + 5) % 8]], [r0 * 0.85, h * 0.8, STRATA_HEX[i % 8]], [r0, h + 2]], STRATA_HEX[i % 8], { seg: 6, capTop: false });
      bits.jit = 0;
    }
    const gems = [0xff7ad1, 0xa96bff, 0x9fe8ff, 0xffb3e6, 0xffe08a];
    const nCr = low ? 8 : 18;
    for (let i = 0; i < nCr; i++) {
      const b = (i / nCr) * TAU + br() * 0.25;
      const f = 0.72 + br() * 0.22;
      const [x, y, z] = under(b, f);
      const out = Math.atan2(x - c.x, z - c.z);
      const col = gems[i % gems.length];
      for (let k = 0; k < 3; k++) {
        const len = 1.6 + br() * 2.2;
        const rr = 0.32 + br() * 0.28;
        bits.at(x, y + k * 0.4, z, out + (k - 1) * 0.5, 1.25 + br() * 0.4, 0);
        bits.cyl(0, 0, 0, rr, len, col, { seg: 5, top: false });
        bits.cone(0, len, 0, rr, rr * 2.2, shade(col, 1.2), { seg: 5 });
        bits.restore();
      }
    }
    triangles += bits.tris;
    const bg = bits.build();
    own.push(bg);
    const bm = new THREE.Mesh(bg, rockMat);
    bm.name = 'underBits';
    bm.matrixAutoUpdate = false;
    group.add(bm);
  }

  // ---------------------------------------------------------------- paving and paint (decals)
  const decalMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3 });
  decalMat.name = 'c9-decal';
  own.push(decalMat);
  const decal = new Soup();
  {
    const soup = decal;
    const PAVE_A = L(0xffe3ef);
    const PAVE_B = L(0xffd2e6);
    const PAVE_C = L(0xf3e6ff);
    const EDGE = L(0xffffff);
    // paths: white kerbs, two-tone pastel pavers
    for (const path of plan.paths) {
      const pts = resample(path.pts, 1.6);
      const h = path.w / 2;
      const lilac = path.id === 'toToss' || path.id === 'gardenToToss' || path.id === 'isleWalk';
      ribbon(soup, pts, yAt, {
        lift: 0.035,
        offsets: [-h, -h + 0.3, 0, h - 0.3, h],
        color: (s, i) => (s === 0 || s === 3 ? EDGE : (i + s) % 2 ? (lilac ? PAVE_C : PAVE_A) : PAVE_B),
      });
    }
    // the plaza: a rhinestone starburst in the paving
    const R = plan.plazaC.r;
    const px = plan.plazaC.x;
    const pz = plan.plazaC.z;
    const SEG = 64;
    const base = L(0xffe6f1);
    const base2 = L(0xfff3f8);
    ring(soup, px, pz, 2.6, R - 1.6, SEG, yAt, 0.03, (i) => (i % 2 ? base : base2));
    ring(soup, px, pz, R - 1.6, R - 1.1, SEG, yAt, 0.03, L(K.rSilver));
    ring(soup, px, pz, R - 1.1, R - 0.35, SEG, yAt, 0.03, (i) => (i % 4 < 2 ? L(0xffc4df) : L(0xe7d6ff)));
    ring(soup, px, pz, R - 0.35, R, SEG, yAt, 0.03, EDGE);
    // the rays: 16 kites, long hot pink and short lilac
    const RAY_A = L(0xff7ab8);
    const RAY_B = L(0xc6a4ff);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + TAU / 32;
      const long = i % 2 === 0;
      const r0 = 3.3;
      const r1 = long ? R - 2.2 : R * 0.6;
      const hw = long ? 0.11 : 0.12;
      const P = (r, aa) => [px + Math.sin(aa) * r, 0.045, pz - Math.cos(aa) * r];
      const mid = r0 + (r1 - r0) * 0.28;
      soup.up(P(r0, a), P(mid, a - hw), P(mid, a + hw), long ? RAY_A : RAY_B);
      soup.up(P(mid, a - hw), P(r1, a), P(mid, a + hw), long ? RAY_A : RAY_B);
    }
    // rhinestone dots round the burst
    const dots = [L(K.rPink), L(K.rPurple), L(K.rSilver)];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const r = i % 2 ? R - 2.6 : R - 3.3;
      const cxp = px + Math.sin(a) * r;
      const czp = pz - Math.cos(a) * r;
      const s = 0.22;
      soup.up([cxp - s, 0.05, czp], [cxp, 0.05, czp - s], [cxp + s, 0.05, czp], dots[i % 3]);
      soup.up([cxp - s, 0.05, czp], [cxp + s, 0.05, czp], [cxp, 0.05, czp + s], dots[i % 3]);
    }
    // the gym forecourt: lilac and white rings round the fountain
    const f = plan.fountain;
    ring(soup, f.x, f.z, f.r - 0.2, f.court - 0.4, 48, yAt, 0.03, (i) => (i % 2 ? PAVE_C : L(0xfbf5ff)));
    ring(soup, f.x, f.z, f.court - 0.4, f.court, 48, yAt, 0.03, EDGE);
    // stage surround and the pads' circles on the toss headland
    rectPaint(soup, plan.stage, -14.5, -10.2, 14.5, 11.5, yAt, 0.025, (i, j) => ((i + j) % 2 ? PAVE_C : L(0xf7efff)), 2.4);
    for (const p of plan.places.tossPads) ring(soup, p.x, p.z, 0, 4.2, 20, yAt, 0.03, (i) => (i % 2 ? PAVE_A : L(0xfff6fb)));
    for (const s of plan.slides) ring(soup, s.x1, s.z1, 0, 2.6, 16, yAt, 0.03, (i) => (i % 2 ? PAVE_C : L(0xfdf9ff)));
    ring(soup, plan.bridge.x0, plan.bridge.z0, 0, 3.4, 18, yAt, 0.03, (i) => (i % 2 ? PAVE_A : PAVE_C));
    // the photo booth's little pad
    ring(soup, plan.photoBooth.x, plan.photoBooth.z, 0, 2.6, 16, yAt, 0.03, (i) => (i % 2 ? PAVE_B : base2));
  }

  // ---------------------------------------------------------------- the dodgeball court
  {
    const soup = decal;
    const c = plan.court;
    const hw = c.w / 2;
    const hd = c.d / 2;
    const PINK = L(0xff8fc8);
    const PINK2 = L(0xff9fd0);
    const PURP = L(0xa98cff);
    const PURP2 = L(0xb39aff);
    const LINE = L(0xffffff);
    const SURR = L(0xf6eaff);
    rectPaint(soup, c, -hw - 1.6, -hd - 1.6, hw + 1.6, hd + 1.6, yAt, 0.02, SURR, 3);
    rectPaint(soup, c, -hw, -hd, hw, 0, yAt, 0.04, (i, j) => ((i + j) % 2 ? PINK : PINK2), 1.5);
    rectPaint(soup, c, -hw, 0, hw, hd, yAt, 0.04, (i, j) => ((i + j) % 2 ? PURP : PURP2), 1.5);
    const line = (x0, z0, x1, z1) => rectPaint(soup, c, x0, z0, x1, z1, yAt, 0.055, LINE, 4);
    const t = 0.13;
    line(-hw, -hd, hw, -hd + t); line(-hw, hd - t, hw, hd); line(-hw, -hd, -hw + t, hd); line(hw - t, -hd, hw, hd);
    line(-hw, -0.12, hw, 0.12);
    line(-hw, -hd / 2 - t / 2, hw, -hd / 2 + t / 2); line(-hw, hd / 2 - t / 2, hw, hd / 2 + t / 2);
    // centre circle
    const [cx, cz] = toWorld(c, 0, 0);
    ring(soup, cx, cz, 1.5, 1.66, 24, yAt, 0.056, LINE);
  }

  // ---------------------------------------------------------------- the Capture the Bow field and the freeze tag lawn
  {
    const soup = decal;
    const f = plan.bowField;
    const hw = f.w / 2;
    const hd = f.d / 2;
    const S1 = L(0x9fe39c);
    const S2 = L(0x8fd88f);
    const LINE = L(0xffffff);
    rectPaint(soup, f, -hw, -hd, hw, hd, yAt, 0.02, (i, j) => (j % 2 ? S1 : S2), 2.5);
    const line = (x0, z0, x1, z1) => rectPaint(soup, f, x0, z0, x1, z1, yAt, 0.045, LINE, 4);
    const t = 0.16;
    line(-hw, -hd, hw, -hd + t); line(-hw, hd - t, hw, hd); line(-hw, -hd, -hw + t, hd); line(hw - t, -hd, hw, hd);
    line(-hw, -0.1, hw, 0.1);
    // team ends and base circles
    const TP = L(0xffc2e0);
    const TV = L(0xd9c9ff);
    rectPaint(soup, f, -hw + t, -hd + t, hw - t, -hd + 8, yAt, 0.03, TP, 2.5);
    rectPaint(soup, f, -hw + t, hd - 8, hw - t, hd - t, yAt, 0.03, TV, 2.5);
    for (const b of plan.places.bowField.bases) {
      ring(soup, b.x, b.z, 0, b.r - 0.25, 24, yAt, 0.05, b.team ? L(0xb6a0ff) : L(0xff9fcf));
      ring(soup, b.x, b.z, b.r - 0.25, b.r, 24, yAt, 0.055, LINE);
    }
    // the lawn: a mown checkerboard with a chalk border
    const tg = plan.tag;
    const lawn = { x: (tg.x0 + tg.x1) / 2, z: (tg.z0 + tg.z1) / 2, facing: 0 };
    const lw = (tg.x1 - tg.x0) / 2;
    const ld = (tg.z1 - tg.z0) / 2;
    const C1 = L(0xa6e8a4);
    const C2 = L(0x95dc98);
    rectPaint(soup, lawn, -lw, -ld, lw, ld, yAt, 0.02, (i, j) => ((i + j) % 2 ? C1 : C2), 2.6);
    const lline = (x0, z0, x1, z1) => rectPaint(soup, lawn, x0, z0, x1, z1, yAt, 0.045, LINE, 4);
    lline(-lw, -ld, lw, -ld + t); lline(-lw, ld - t, lw, ld); lline(-lw, -ld, -lw + t, ld); lline(lw - t, -ld, lw, ld);
    // stepping stones from the garden gates
    const gp = plan.gardenPlan;
    const STONE = L(0xf2ecf6);
    for (const [sx, sz, ex, ez] of [[gp.gate.x + 1, gp.gate.z, gp.gate.x - 12, gp.gate.z + 1], [gp.north.x, gp.north.z - 1, gp.north.x - 1, gp.north.z + 8]]) {
      const n = Math.round(Math.hypot(ex - sx, ez - sz) / 1.3);
      for (let i = 0; i <= n; i++) {
        const x = sx + ((ex - sx) * i) / n + (i % 2 ? 0.3 : -0.3);
        const z = sz + ((ez - sz) * i) / n;
        ring(soup, x, z, 0, 0.42, 7, yAt, 0.03, STONE, i);
      }
    }
  }

  // ---------------------------------------------------------------- the isle
  {
    const iso = plan.isleOutline;
    const isle = plan.isle;
    const cell = 1.5;
    const X0 = Math.floor((isle.x - iso.maxR - 3) / cell) * cell;
    const Z0 = Math.floor((isle.z - iso.maxR - 3) / cell) * cell;
    const NX = Math.ceil((iso.maxR * 2 + 6) / cell);
    const NZ = NX;
    const H = new Float32Array((NX + 1) * (NZ + 1));
    const M = new Float32Array((NX + 1) * (NZ + 1));
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const x = X0 + i * cell;
        const z = Z0 + j * cell;
        H[j * (NX + 1) + i] = G.isleHeight(x, z);
        M[j * (NX + 1) + i] = iso.margin(x, z);
      }
    }
    const soup = new Soup();
    const irim = [];
    marginOf = (x, z) => iso.margin(x, z);
    surface({ X0, Z0, NX, NZ, cell, H, M }, grassAt, soup, irim);
    // the shop's lawn is a little garden: paint a soft path ring round it
    mountain(irim, isle.x, isle.z, soup, {
      seed: 5,
      tipY: -17,
      bands: [{}, { dr: 0.35, dy: -0.28 }, { dr: 0.1, dy: -0.9 }, { dr: -0.7, dy: -2.2, wobble: 0.02 }, { f: 0.8, y: -5, wobble: 0.08, yj: 0.8 }, { f: 0.55, y: -9, wobble: 0.1, yj: 1 }, { f: 0.28, y: -13, wobble: 0.14, yj: 1 }],
      color(k, b, out) {
        if (k === 0) return mixc(GRASS_DK, GRASS_SUN, 0.25, out);
        if (k === 1) return mixc(GRASS_DK, SOIL, 0.35, out);
        if (k === 2) return SOIL.slice ? mixc(SOIL, SOIL_DK, 0.3, out) : out;
        return mixc(STRATA[(k + 3) % STRATA.length], SOIL_DK, 0.06 * k, out);
      },
    });
    addSoup(soup, 'isle');
  }

  // isle paths are painted after the isle exists, so all paint goes out in one mesh here
  addSoup(decal, 'paint', decalMat, { renderOrder: 1 });

  // ---------------------------------------------------------------- soft blob shadows under solid things
  const shadows = new Geo({ alpha: true });
  const blob = (x, z, rx, rz = rx, a = 0.28, ry = 0) => {
    const seg = 8;
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const P = (k, f) => {
      const ang = (k / seg) * TAU;
      const lx = Math.cos(ang) * rx * f;
      const lz = Math.sin(ang) * rz * f;
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      return [wx, yAt(wx, wz) + 0.05, wz];
    };
    const C = [x, yAt(x, z) + 0.05, z];
    for (let k = 0; k < seg; k++) {
      const a0 = P(k, 0.55);
      const a1 = P(k + 1, 0.55);
      const b0 = P(k, 1);
      const b1 = P(k + 1, 1);
      shadows.triG(C, a1, a0, 0x2a1840, 0x2a1840, 0x2a1840, a, a * 0.8, a * 0.8);
      shadows.triG(a0, a1, b1, 0x2a1840, 0x2a1840, 0x2a1840, a * 0.8, a * 0.8, 0);
      shadows.triG(a0, b1, b0, 0x2a1840, 0x2a1840, 0x2a1840, a * 0.8, 0, 0);
    }
  };

  // ---------------------------------------------------------------- floating rocks round the island
  const floaters = [];
  {
    const r = rng(77);
    const protos = [];
    for (let v = 0; v < 3; v++) {
      const g = new Geo();
      const R = 1;
      // a craggy upside-down cone with a grassy cap
      g.jit = 0.05;
      g.lathe(0, -2.6 * R, 0, [[0.05, 0, STRATA_HEX[(v + 2) % 8]], [0.6, 0.8, STRATA_HEX[(v + 4) % 8]], [1.05, 1.7, STRATA_HEX[v % 8]], [1.25, 2.35, 0xd9a596], [1.3, 2.55]], 0xe9b6c6, { seg: 7, capTop: K.grass });
      g.jit = 0;
      g.ico(0.2, 0.05, 0.1, 0.55, K.grass, { detail: 0, jitter: 0.2, rnd: r, sy: 0.3, flat: 0.1 });
      if (v === 0) {
        // a tiny cotton-candy tree
        g.lathe(0.1, 0.0, 0, [[0.08, 0, K.trunk], [0.06, 0.6, K.trunkStripe], [0.05, 0.9]], K.trunk, { seg: 4 });
        g.ico(0.1, 1.25, 0, 0.5, 0xffb3d9, { detail: 0, jitter: 0.12, rnd: r });
        g.ico(0.35, 1.05, 0.15, 0.3, 0xffd8ec, { detail: 0, jitter: 0.12, rnd: r });
      } else if (v === 1) {
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1;
          g.at(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, a, 0.25 * Math.cos(a), 0.25 * Math.sin(a));
          g.cyl(0, 0, 0, 0.1, 0.5, i % 2 ? K.rPurple : K.rPink, { seg: 5, top: false });
          g.cone(0, 0.5, 0, 0.1, 0.22, 0xffd6f4, { seg: 5 });
          g.restore();
        }
      } else {
        g.ico(-0.2, 0.3, -0.2, 0.36, 0xa9ecd0, { detail: 0, jitter: 0.15, rnd: r });
        g.ico(0.3, 0.22, 0.25, 0.25, 0xffd0b0, { detail: 0, jitter: 0.15, rnd: r });
      }
      protos.push(g);
    }
    const spots = [
      [-88, -14, -10, 3.4, 0], [-70, 52, -18, 2.6, 2], [-30, 86, -6, 2.2, 1], [30, 84, -22, 3.0, 0], [78, 48, -12, 2.4, 1],
      [68, -66, -26, 3.2, 2], [24, -88, -8, 2.0, 1], [-46, -86, -30, 2.8, 0], [112, 8, -16, 1.8, 2], [118, -52, -6, 1.6, 0],
      [-96, 30, -34, 2.2, 1], [-20, -104, -18, 1.8, 2],
    ];
    const use = low ? spots.filter((s, i) => i % 2 === 0) : spots;
    const lists = [[], [], []];
    for (const s of use) lists[s[4]].push(s);
    for (let v = 0; v < 3; v++) {
      if (!lists[v].length) continue;
      const geo = protos[v].build();
      own.push(geo);
      const mesh = new THREE.InstancedMesh(geo, flatMat, lists[v].length);
      mesh.name = 'floaters' + v;
      mesh.frustumCulled = false;
      group.add(mesh);
      triangles += protos[v].tris * lists[v].length;
      lists[v].forEach((s, i) => floaters.push({ mesh, i, x: s[0], y: s[2], z: s[1], s: s[3], ry: hash(i * 13 + v) * TAU, ph: hash(i * 7 + v * 3) * TAU }));
    }
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  function placeFloaters(t) {
    const m = motion();
    for (const f of floaters) {
      e.set(Math.sin(t * 0.3 + f.ph) * 0.04 * m, f.ry + t * 0.03 * m, Math.cos(t * 0.27 + f.ph) * 0.04 * m);
      q.setFromEuler(e);
      v3.set(f.x, f.y + Math.sin(t * 0.45 + f.ph) * 0.8 * m, f.z);
      s3.setScalar(f.s);
      m4.compose(v3, q, s3);
      f.mesh.setMatrixAt(f.i, m4);
    }
    for (const mesh of new Set(floaters.map((f) => f.mesh))) mesh.instanceMatrix.needsUpdate = true;
  }
  placeFloaters(0);

  return {
    group,
    blob,
    finishShadows() {
      if (!shadows.tris) return;
      const geo = shadows.build();
      own.push(geo);
      const mesh = new THREE.Mesh(geo, blobMat);
      mesh.name = 'shadows';
      mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      triangles += shadows.tris;
    },
    get triangles() { return triangles; },
    rimSegments: rim,
    update(dt, t) {
      placeFloaters(t);
    },
    dispose() {
      for (const o of own) o.dispose();
      own.length = 0;
      if (group.parent) group.parent.remove(group);
    },
    yIsland,
  };
}

const STRATA_HEX = [0xe9b6c6, 0xd4bdf0, 0xf4c9b4, 0xbfa7e4, 0xe7aac4, 0xa993d6, 0xc7b4ee, 0x9c88cc];
void clamp;
void toLocal;
