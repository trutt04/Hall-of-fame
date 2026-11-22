// Builds the cheerleader's geometry for one look: a single vertex-colored, rigidly skinned body
// mesh (one draw call) and a small mesh of rhinestone glints.
//
//   buildCharacter(look, quality = 'high') -> {
//     body,          // BufferGeometry: position, color, skinIndex, skinWeight (bones from character-rig.js)
//     glints,        // BufferGeometry | null: camera-facing sparkle quads (see glint attribute below)
//     rest,          // bind-pose positions of the look-dependent bones and anchors
//     tris,          // triangle count of the body
//   }
//
// Everything is drawn in the bind pose (character-rig.js): feet at y = 0, facing +Z, arms down.
// Each vertex follows one bone, except the hair chain and the skirt, which blend two.
// Faces, rhinestones and bow patterns are decals: small flat shapes laid on the surface below them
// (found by casting a ray at the triangles already drawn).
import * as THREE from '../../lib/three.module.min.js';
import { Geo, shade, mix, hash, TAU } from './geo.js';
import { RIG, B } from './character-rig.js';
import { lookOption } from './character-looks.js';

const hx = (s) => (typeof s === 'number' ? s : parseInt(String(s).slice(1), 16));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

const QUALITY = {
  high: { head: 14, hair: 18, hairRings: 5, body: 12, limb: 7, tube: 7, tubeN: 12, loopRings: 3, face: true, more: true },
  low: { head: 10, hair: 12, hairRings: 4, body: 8, limb: 5, tube: 5, tubeN: 8, loopRings: 2, face: false, more: false },
};

const HC = [0, RIG.headY, RIG.headZ]; // skull centre
const HR = RIG.headR;
const HS = 0.94; // the skull is a little shallower than wide

const EYE = 0x231816, EYE_LOW = 0x5b3527, LASH = 0x170e10, WHITE = 0xffffff;
const MOUTH_IN = 0x6e1a33, TONGUE = 0xff7f9e;

// ---- vector bits ---------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---- the skinned Geo -----------------------------------------------------------------------------
function newGeo() {
  const g = new Geo({ skin: true });
  g.b = 0;
  g.wf = null; // optional (x, y, z) -> [i0, i1, w0, w1]
  g.skinFn = (x, y, z, si, sw) => {
    if (g.wf) {
      const w = g.wf(x, y, z);
      si.push(w[0], w[1], 0, 0); sw.push(w[2], w[3], 0, 0);
    } else { si.push(g.b, 0, 0, 0); sw.push(1, 0, 0, 0); }
  };
  g.bone = (i) => { g.b = i; g.wf = null; return g; };
  return g;
}

// A quad (or triangle when two corners meet) wound to face away from `ref`.
function quadOut(g, a, b, c, d, hex, ref) {
  const k = g._col(hex);
  const n = cross(sub(c, a), sub(d, b));
  const m = [(a[0] + b[0] + c[0] + d[0]) / 4 - ref[0], (a[1] + b[1] + c[1] + d[1]) / 4 - ref[1], (a[2] + b[2] + c[2] + d[2]) / 4 - ref[2]];
  if (dot(n, m) >= 0) { g._tri(a, b, c, k); g._tri(a, c, d, k); } else { g._tri(a, c, b, k); g._tri(a, d, c, k); }
}
function triOut(g, a, b, c, hex, ref) {
  const k = g._col(hex);
  const n = cross(sub(b, a), sub(c, a));
  const m = [(a[0] + b[0] + c[0]) / 3 - ref[0], (a[1] + b[1] + c[1]) / 3 - ref[1], (a[2] + b[2] + c[2]) / 3 - ref[2]];
  if (dot(n, m) >= 0) g._tri(a, b, c, k); else g._tri(a, c, b, k);
}

// Rings stacked along Y around the axis (cx, cz): [y, rx, rz?, dz?] (dz pushes a ring forward).
// color: hex, or fn(yMid, az, ring, column) with az 0 at the front, growing toward +X.
// o: { ph, capTop, capBot (true or hex), zig: fn(ring, column) -> radius multiplier }
function lathe2(g, cx, cz, rings, seg, color, o = {}) {
  const ph = o.ph || 0, n = rings.length, P = [];
  for (let i = 0; i < n; i++) {
    const r = rings[i], rz = r[2] === undefined ? r[1] : r[2], dz = r[3] || 0, row = [];
    for (let j = 0; j < seg; j++) {
      const a = ph + (TAU * j) / seg, z = o.zig ? o.zig(i, j) : 1;
      row.push([cx + Math.sin(a) * r[1] * z, r[0], cz + dz + Math.cos(a) * rz * z]);
    }
    P.push(row);
  }
  const colAt = (i, j) => (typeof color === 'function' ? color((rings[i][0] + rings[i + 1][0]) / 2, ph + (TAU * (j + 0.5)) / seg, i, j) : color);
  for (let i = 0; i < n - 1; i++) {
    const ref = [cx, (rings[i][0] + rings[i + 1][0]) / 2, cz + ((rings[i][3] || 0) + (rings[i + 1][3] || 0)) / 2];
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      quadOut(g, P[i][j], P[i][j1], P[i + 1][j1], P[i + 1][j], colAt(i, j), ref);
    }
  }
  if (o.capTop && rings[n - 1][1] > 0) {
    const r = rings[n - 1], c = [cx, r[0], cz + (r[3] || 0)], ref = [cx, r[0] - 1, cz];
    for (let j = 0; j < seg; j++) triOut(g, P[n - 1][j], P[n - 1][(j + 1) % seg], c, o.capTop === true ? colAt(n - 2, j) : o.capTop, ref);
  }
  if (o.capBot && rings[0][1] > 0) {
    const r = rings[0], c = [cx, r[0], cz + (r[3] || 0)], ref = [cx, r[0] + 1, cz];
    for (let j = 0; j < seg; j++) triOut(g, P[0][j], P[0][(j + 1) % seg], c, o.capBot === true ? colAt(0, j) : o.capBot, ref);
  }
  return P;
}

// ---- decals --------------------------------------------------------------------------------------
// Nearest hit of a ray against triangles [t0, t1) of a Geo (its positions are already transformed).
function raycast(g, t0, t1, o, d) {
  const p = g.p;
  let best = Infinity, bn = null;
  for (let t = t0; t < t1; t++) {
    const i = t * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const e1x = p[i + 3] - ax, e1y = p[i + 4] - ay, e1z = p[i + 5] - az;
    const e2x = p[i + 6] - ax, e2y = p[i + 7] - ay, e2z = p[i + 8] - az;
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (tt > 1e-7 && tt < best) { best = tt; bn = [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x]; }
  }
  if (!bn) return null;
  let n = norm(bn);
  if (dot(n, d) > 0) n = scl(n, -1);
  return { p: add(o, scl(d, best)), n };
}
// A tangent frame on a hit: t runs along `side` (her left by default), b up the surface, n out.
function frame(hit, up = [0, 1, 0]) {
  const n = hit.n;
  let t = cross(up, n);
  if (len(t) < 1e-6) t = cross([0, 0, 1], n);
  t = norm(t);
  return { o: hit.p, n, t, b: cross(n, t) };
}
const fp = (f, x, y, lift) => [
  f.o[0] + f.t[0] * x + f.b[0] * y + f.n[0] * lift,
  f.o[1] + f.t[1] * x + f.b[1] * y + f.n[1] * lift,
  f.o[2] + f.t[2] * x + f.b[2] * y + f.n[2] * lift,
];
function area2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a;
}
// Filled polygon (star-shaped around (cx, cy)), counter-clockwise seen from outside.
function decalPoly(g, f, pts, hex, lift = 0.0012, cx = 0, cy = 0) {
  const k = g._col(hex), c = fp(f, cx, cy, lift);
  const ccw = area2(pts) > 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const A = fp(f, a[0], a[1], lift), Bp = fp(f, b[0], b[1], lift);
    if (ccw) g._tri(c, A, Bp, k); else g._tri(c, Bp, A, k);
  }
}
// Four corners, two triangles (counter-clockwise seen from outside).
function decalQuad(g, f, pts, hex, lift = 0.0012) {
  const k = g._col(hex), P = pts.map((p) => fp(f, p[0], p[1], lift));
  if (area2(pts) > 0) { g._tri(P[0], P[1], P[2], k); g._tri(P[0], P[2], P[3], k); } else { g._tri(P[0], P[2], P[1], k); g._tri(P[0], P[3], P[2], k); }
}
// A ribbon of width w along a 2D polyline (smiles, lashes, brows, straps).
function decalStrip(g, f, pts, w, hex, lift = 0.0014, w1 = w) {
  const k = g._col(hex), L = [], R = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const hw = lerp(w, w1, n > 1 ? i / (n - 1) : 0) / 2;
    L.push(fp(f, pts[i][0] - ty * hw, pts[i][1] + tx * hw, lift));
    R.push(fp(f, pts[i][0] + ty * hw, pts[i][1] - tx * hw, lift));
  }
  for (let i = 0; i < n - 1; i++) { g._tri(R[i], R[i + 1], L[i + 1], k); g._tri(R[i], L[i + 1], L[i], k); }
}
const ellipse = (rx, ry, n = 10, ox = 0, oy = 0, rot = 0) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([ox + x * Math.cos(rot) - y * Math.sin(rot), oy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
};
const starPts = (r, ri, n = 5, rot = Math.PI / 2, ox = 0, oy = 0) => {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (Math.PI * i) / n, rr = i % 2 ? ri : r;
    out.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr]);
  }
  return out;
};
const heartPts = (s, ox = 0, oy = 0, n = 14) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (TAU * i) / n;
    const x = 16 * Math.pow(Math.sin(t), 3), y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([ox + (x * s) / 17, oy + ((y + 2) * s) / 17]);
  }
  return out;
};

// ---- glints --------------------------------------------------------------------------------------
function glintAt(out, p, n, bone, size, color, lift = 0.01) {
  out.push({ p: add(p, scl(n, lift)), bone, size, color: hx(color) });
}
function buildGlintGeometry(list, seed) {
  if (!list.length) return null;
  const n = list.length * 6;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), uv = new Float32Array(n * 2);
  const gl = new Float32Array(n * 4), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  const c = new THREE.Color();
  list.forEach((s, i) => {
    c.setHex(s.color);
    const phase = hash(i * 977 + seed), rate = 0.75 + hash(i * 31 + seed * 7) * 0.7;
    for (let k = 0; k < 6; k++) {
      const v = i * 6 + k;
      pos.set(s.p, v * 3);
      col.set([c.r, c.g, c.b, 1], v * 4);
      uv.set([(corners[k][0] + 1) / 2, (corners[k][1] + 1) / 2], v * 2);
      gl.set([corners[k][0] * s.size, corners[k][1] * s.size, phase, rate], v * 4);
      si[v * 4] = s.bone; sw[v * 4] = 1;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('glint', new THREE.BufferAttribute(gl, 4));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2);
  return geo;
}

// ---- the hair chain ------------------------------------------------------------------------------
// Catmull-Rom through the chain points; s runs 0..(n-1) and lands on the points at whole numbers.
function chainPoint(P, s) {
  const n = P.length, i = clamp(Math.floor(s), 0, n - 2), t = clamp(s - i, 0, 1);
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
function chainTangent(P, s) {
  const a = chainPoint(P, Math.max(0, s - 0.02)), b = chainPoint(P, Math.min(P.length - 1, s + 0.02));
  return norm(sub(b, a));
}
// Weights for a vertex near the chain: project onto the polyline, blend neighbouring bones.
function chainWeights(P) {
  const bones = [B.pony0, B.pony1, B.pony2];
  return (x, y, z) => {
    let bestD = Infinity, bestS = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], ab = sub(P[i + 1], a), ap = [x - a[0], y - a[1], z - a[2]];
      const t = clamp(dot(ap, ab) / dot(ab, ab), 0, 1);
      const q = add(a, scl(ab, t)), d = Math.hypot(x - q[0], y - q[1], z - q[2]);
      if (d < bestD) { bestD = d; bestS = i + t; }
    }
    if (bestS <= 0.5) return [bones[0], bones[0], 1, 0];
    if (bestS >= 2.5) return [bones[2], bones[2], 1, 0];
    const j = bestS < 1.5 ? 1 : 2, t = bestS - (j - 0.5);
    return [bones[j - 1], bones[j], 1 - t, t];
  };
}
// A tube along the chain: radius(s) -> r, sideways scale sx, depth scale sz.
function chainTube(g, P, s0, s1, nRings, seg, radius, color, o = {}) {
  const rings = [];
  for (let i = 0; i <= nRings; i++) {
    const s = lerp(s0, s1, i / nRings), c = chainPoint(P, s), t = chainTangent(P, s);
    let side = sub([1, 0, 0], scl(t, t[0]));
    side = norm(side);
    const depth = cross(side, t), r = radius(s), ring = [];
    for (let j = 0; j < seg; j++) {
      const a = (TAU * j) / seg + (o.twist ? o.twist * s : 0);
      ring.push(add(c, add(scl(side, Math.cos(a) * r * (o.sx || 1)), scl(depth, Math.sin(a) * r * (o.sz || 1)))));
    }
    rings.push({ c, ring, s });
  }
  for (let i = 0; i < nRings; i++) {
    const A = rings[i], Bq = rings[i + 1], ref = scl(add(A.c, Bq.c), 0.5);
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      quadOut(g, A.ring[j], A.ring[j1], Bq.ring[j1], Bq.ring[j], typeof color === 'function' ? color(A.s, j) : color, ref);
    }
  }
  const last = rings[nRings];
  if (radius(s1) > 0.0005) {
    const tip = add(last.c, scl(chainTangent(P, s1), radius(s1) * 1.2));
    for (let j = 0; j < seg; j++) triOut(g, last.ring[j], last.ring[(j + 1) % seg], tip, typeof color === 'function' ? color(s1, j) : color, last.c);
  }
  return rings;
}
function table(t, x) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 0; i < t.length - 1; i++) if (x <= t[i + 1][0]) return lerp(t[i][1], t[i + 1][1], (x - t[i][0]) / (t[i + 1][0] - t[i][0]));
  return t[t.length - 1][1];
}

// ---- hair ----------------------------------------------------------------------------------------
// Hairlines: [azimuth from the front, polar angle from the crown], degrees, mirrored left/right.
const RIM = {
  back: [[0, 60], [30, 63], [55, 70], [80, 77], [100, 83], [118, 103], [140, 121], [180, 129]],
  bob: [[0, 63], [24, 64], [36, 70], [50, 116], [70, 131], [110, 137], [180, 140]],
  long: [[0, 57], [20, 59], [36, 67], [52, 112], [80, 124], [130, 119], [180, 116]],
};
function hairCap(g, q, o) {
  const S = q.hair, K = q.hairRings, rim = RIM[o.rim], col = o.color;
  const rimAt = (az) => table(rim, Math.abs(((az / DEG) % 360 + 540) % 360 - 180)) * DEG; // degrees from the front
  const grid = [];
  const rimJ = [];
  for (let j = 0; j < S; j++) rimJ.push(rimAt((TAU * j) / S) + (hash(j * 13 + 5) - 0.5) * 5 * DEG);
  for (let k = 0; k <= K; k++) {
    const row = [];
    for (let j = 0; j < S; j++) {
      const az = (TAU * j) / S, th = rimJ[j] * Math.pow(k / K, 0.88);
      let r = o.r;
      if (o.flare) r *= 1 + o.flare[2] * sstep(o.flare[0] * DEG, o.flare[1] * DEG, th);
      if (k > 0 && k < K) r *= 1 + 0.035 * (hash(j * 31 + k * 7 + 3) - 0.5);
      row.push([HC[0] + Math.sin(az) * Math.sin(th) * r, HC[1] + Math.cos(th) * r, HC[2] + Math.cos(az) * Math.sin(th) * r * HS]);
    }
    grid.push(row);
  }
  const shineK = Math.max(1, Math.round(K * 0.34));
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S, az = (TAU * (j + 0.5)) / S;
      const front = Math.cos(az) > -0.2;
      const c = k === shineK && front ? shade(col, 1.16) : j % 2 ? col : shade(col, 1.06);
      quadOut(g, grid[k][j], grid[k][j1], grid[k + 1][j1], grid[k + 1][j], c, HC);
    }
  }
  if (o.lip) { // the hair's thickness at the rim, tucked under toward the skull
    const dk = shade(col, 0.72);
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      const a = grid[K][j], b = grid[K][j1];
      const ia = add(HC, scl(sub(a, HC), (HR * 0.93) / len(sub(a, HC))));
      const ib = add(HC, scl(sub(b, HC), (HR * 0.93) / len(sub(b, HC))));
      const az = (TAU * (j + 0.5)) / S, th = (rimJ[j] + rimJ[j1]) / 2 - 0.35;
      const ref = [HC[0] + Math.sin(az) * Math.sin(th) * HR * 0.9, HC[1] + Math.cos(th) * HR * 0.9, HC[2] + Math.cos(az) * Math.sin(th) * HR * 0.9];
      quadOut(g, a, b, ib, ia, dk, ref);
    }
  }
  return grid;
}

// Bind-pose hair chains and bow spots per style.
const PONY_CHAIN = [[0, 1.342, -0.108], [0, 1.38, -0.21], [0, 1.21, -0.262], [0, 0.99, -0.222]];
const LONG_CHAIN = [[0, 1.23, -0.135], [0, 1.07, -0.172], [0, 0.94, -0.163], [0, 0.81, -0.136]];
const BOW_SPOT = {
  highPony: { p: [0, 1.382, -0.126], tilt: 0.52 },
  braidPony: { p: [0, 1.382, -0.126], tilt: 0.52 },
  curlyPony: { p: [0, 1.382, -0.126], tilt: 0.52 },
  spaceBuns: { p: [0, 1.392, -0.07], tilt: 0.9 },
  halfUp: { p: [0, 1.335, -0.16], tilt: 0.5 },
  longDown: { p: [0, 1.3, -0.178], tilt: 0.32 },
  bob: { p: [0, 1.362, -0.132], tilt: 0.6 },
};

function tendrils(g, q, col) {
  for (const sx of [1, -1]) {
    const pts = [[sx * 0.138, 1.235, 0.074], [sx * 0.155, 1.185, 0.08], [sx * 0.145, 1.14, 0.086], [sx * 0.158, 1.102, 0.078], [sx * 0.15, 1.08, 0.072]];
    g.tube(q.more ? pts : [pts[0], pts[2], pts[4]], 0.009, col, { seg: q.more ? 4 : 3, r1: 0.003 });
  }
}

function buildHair(g, look, q, rest) {
  const style = look.hairStyle;
  const col = hx(lookOption('hair', look.hair).color);
  g.bone(B.head);
  const jit = g.jit;
  g.jit = 0.05;
  const pony = style === 'highPony' || style === 'braidPony' || style === 'curlyPony';
  if (pony || style === 'spaceBuns') {
    hairCap(g, q, { rim: 'back', r: HR + 0.016, color: col, lip: true });
    tendrils(g, q, col);
  } else if (style === 'bob') {
    hairCap(g, q, { rim: 'bob', r: HR + 0.02, color: col, flare: [92, 138, 0.2], lip: true });
  } else {
    hairCap(g, q, { rim: 'long', r: HR + 0.018, color: col, flare: [100, 128, 0.06], lip: true });
  }

  if (pony) {
    const P = PONY_CHAIN;
    rest.chain = P;
    g.wf = chainWeights(P);
    g.sphere(P[0][0], P[0][1], P[0][2], 0.038, col, { seg: q.tube + 1, rings: 4 });
    if (style === 'highPony') {
      const R = [[0, 0.034], [0.35, 0.052], [1.1, 0.058], [1.8, 0.051], [2.4, 0.038], [2.8, 0.021], [3, 0.004]];
      chainTube(g, P, 0.05, 3, q.tubeN, q.tube, (s) => table(R, s), (s, j) => (j % 3 === 0 ? shade(col, 1.08) : col), { sz: 0.86 });
    } else if (style === 'braidPony') {
      const n = q.more ? 10 : 7;
      for (let i = 0; i < n; i++) {
        const s = 0.22 + (i * 2.58) / (n - 1), c = chainPoint(P, s), t = chainTangent(P, s);
        const side = norm(sub([1, 0, 0], scl(t, t[0]))), depth = cross(side, t);
        const r = table([[0, 0.05], [1.2, 0.053], [2.2, 0.041], [2.8, 0.028]], s);
        const sgn = i % 2 ? 1 : -1;
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...side), new THREE.Vector3(...t), new THREE.Vector3(...depth));
        m.premultiply(new THREE.Matrix4().makeTranslation(...add(c, scl(side, sgn * r * 0.36))));
        m.multiply(new THREE.Matrix4().makeRotationZ(sgn * 0.62));
        g.save(); g.m.multiply(m); g._upd();
        g.ico(0, 0, 0, r, i % 2 ? shade(col, 1.08) : shade(col, 0.8), { sx: 0.9, sy: 0.78, sz: 0.88 });
        g.restore();
      }
      chainTube(g, P, 2.72, 3, 2, q.tube - 1, (s) => lerp(0.016, 0.004, (s - 2.72) / 0.28), shade(col, 1.06));
      const bowCol = hx(lookOption('bow', look.bow).color);
      chainTube(g, P, 2.66, 2.74, 1, q.tube - 1, () => 0.02, bowCol);
    } else {
      const n = q.more ? 10 : 7;
      for (let i = 0; i < n; i++) {
        const s = 0.2 + (i * 2.7) / (n - 1), c = chainPoint(P, s), t = chainTangent(P, s);
        const side = norm(sub([1, 0, 0], scl(t, t[0]))), depth = cross(side, t);
        const r = table([[0, 0.045], [1, 0.054], [2, 0.046], [2.9, 0.026]], s), a = i * 2.3;
        const off = add(scl(side, Math.cos(a) * r * 0.45), scl(depth, Math.sin(a) * r * 0.35));
        const p = add(c, off);
        g.ico(p[0], p[1], p[2], r, i % 3 === 1 ? shade(col, 1.1) : i % 3 === 2 ? shade(col, 0.9) : col, { jitter: 0.12, rnd: mulberry(i + 11) });
      }
    }
    g.wf = null;
  } else if (style === 'spaceBuns') {
    for (const sx of [1, -1]) {
      const c = [sx * 0.108, 1.342, -0.028], R = 0.068;
      const seg = q.tube + 1;
      g.at(c[0], c[1], c[2], 0, 0, -sx * 0.4);
      for (let i = 0; i < 5; i++) {
        const y0 = -R + i * R * 0.4, y1 = y0 + R * 0.4;
        const r0 = Math.sqrt(Math.max(0, R * R - y0 * y0)), r1 = Math.sqrt(Math.max(0, R * R - y1 * y1));
        g.band(r0, y0, r1, y1, seg, i * 0.5, i % 2 ? shade(col, 1.12) : col);
      }
      g.restore();
      // a scrunchie in the bow color around each bun
      const bc = hx(lookOption('bow', look.bow).color);
      g.at(c[0] * 0.86, c[1] - 0.045, c[2], 0, 0, -sx * 0.4);
      g.band(0.05, 0, 0.055, 0.013, seg, 0, bc);
      g.band(0.055, 0.013, 0.05, 0.026, seg, 0, shade(bc, 0.85));
      g.restore();
    }
    // a centre part from the hairline to the crown
    const dark = shade(col, 0.6);
    for (let i = 0; i < 5; i++) {
      const th0 = 0.12 + i * 0.17, th1 = th0 + 0.17, r = HR + 0.0185;
      const a0 = [HC[0], HC[1] + Math.cos(th0) * r, HC[2] + Math.sin(th0) * r * HS], a1 = [HC[0], HC[1] + Math.cos(th1) * r, HC[2] + Math.sin(th1) * r * HS];
      g.quad([-0.0032, a1[1], a1[2]], [0.0032, a1[1], a1[2]], [0.0032, a0[1], a0[2]], [-0.0032, a0[1], a0[2]], dark);
    }
  } else if (style === 'bob') {
    // nothing else: the cap is the bob
  } else {
    // long hair down the back, swinging on the chain
    const P = LONG_CHAIN;
    rest.chain = P;
    g.wf = chainWeights(P);
    const U = q.more ? 6 : 4, V = q.more ? 7 : 5, ends = [];
    const rowsOut = [], rowsIn = [];
    for (let i = 0; i <= V; i++) {
      const v = i / V, outRow = [], inRow = [];
      for (let j = 0; j <= U; j++) {
        const u = (j / U) * 2 - 1;
        const vv = i === V ? 1 - (j % 2 ? 0.09 : 0) : v * (1 - (j % 2 ? 0.09 : 0));
        const s = 0.02 + vv * 2.96, c = chainPoint(P, s), t = chainTangent(P, s);
        const side = [1, 0, 0], back = norm(cross(side, t)); // points away from her back
        const w = lerp(0.28, 0.2, vv), th = lerp(0.034, 0.016, vv), bulge = 0.03 * (1 - u * u);
        const base = add(c, add(scl(side, (u * w) / 2), scl(back, bulge - 0.012)));
        outRow.push(add(base, scl(back, th / 2)));
        inRow.push(add(base, scl(back, -th / 2)));
        if (i === V) ends.push(j);
      }
      rowsOut.push(outRow); rowsIn.push(inRow);
    }
    for (let i = 0; i < V; i++) {
      const mid = chainPoint(P, 0.02 + ((i + 0.5) / V) * 2.96);
      for (let j = 0; j < U; j++) {
        const c = (i + j) % 3 === 0 ? shade(col, 1.07) : col;
        const ref = add(mid, [0, 0, 0.2]);
        quadOut(g, rowsOut[i][j], rowsOut[i][j + 1], rowsOut[i + 1][j + 1], rowsOut[i + 1][j], c, ref);
        quadOut(g, rowsIn[i][j], rowsIn[i][j + 1], rowsIn[i + 1][j + 1], rowsIn[i + 1][j], shade(col, 0.75), add(mid, [0, 0, -0.4]));
      }
      for (const j of [0, U]) {
        const ref = add(mid, [j ? -1 : 1, 0, 0]);
        quadOut(g, rowsOut[i][j], rowsOut[i + 1][j], rowsIn[i + 1][j], rowsIn[i][j], shade(col, 0.88), ref);
      }
    }
    for (let j = 0; j < U; j++) {
      const mid = chainPoint(P, 2.98);
      quadOut(g, rowsOut[V][j], rowsOut[V][j + 1], rowsIn[V][j + 1], rowsIn[V][j], shade(col, 0.82), add(mid, [0, 0.4, 0]));
    }
    g.wf = null;
    g.bone(B.head);
    if (style === 'halfUp') {
      g.sphere(0, 1.305, -0.152, 0.036, col, { seg: q.tube + 1, rings: 4 });
      g.tube([[0, 1.3, -0.172], [0, 1.26, -0.202], [0, 1.21, -0.207]], 0.022, col, { seg: q.tube - 1, r1: 0.006 });
    }
  }
  g.jit = jit;
  rest.bow = BOW_SPOT[style] || BOW_SPOT.highPony;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the bow -------------------------------------------------------------------------------------
// Built in its own space (knot at the origin, face toward +Z, loops along X), then copied onto the
// head. The loops are puffy pillows; patterns are decals on their faces.
const LOOP = [[0.012, -0.014], [0.036, -0.028], [0.066, -0.04], [0.095, -0.046], [0.118, -0.042], [0.132, -0.026], [0.137, -0.002], [0.133, 0.024], [0.12, 0.042], [0.096, 0.05], [0.066, 0.046], [0.036, 0.032], [0.013, 0.015]];
function buildBow(look, q, seed) {
  const opt = lookOption('bow', look.bow), pat = look.bowPattern;
  const bg = new Geo();
  const col = hx(opt.color), dark = hx(opt.dark), acc = hx(opt.accent);
  const rainbow = opt.rainbow ? opt.rainbow.map(hx) : null;
  const glints = [];
  const rnd = mulberry(seed * 13 + 5);
  const loopTris = [];
  const fronts = [];
  for (const sx of [1, -1]) {
    const ang = 0.3;
    const outline = q.more ? LOOP : LOOP.filter((_, i) => i % 3 !== 1);
    let pts = outline.map(([u, v]) => [sx * (u * Math.cos(ang) - v * Math.sin(ang)), u * Math.sin(ang) + v * Math.cos(ang)]);
    if (sx < 0) pts = pts.reverse();
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const scales = rainbow ? [1, 0.82, 0.64, 0.46, 0.28] : q.loopRings === 3 ? [1, 0.72, 0.42] : [1, 0.58];
    const zs = rainbow ? [0.005, 0.009, 0.012, 0.0145, 0.016] : q.loopRings === 3 ? [0.005, 0.0115, 0.0155] : [0.005, 0.014];
    const ring = (k) => pts.map(([x, y]) => [cx + (x - cx) * scales[k], cy + (y - cy) * scales[k], zs[k]]);
    const R = scales.map((_, k) => ring(k)), top = [cx, cy, zs[zs.length - 1] + 0.0015];
    const t0 = bg.tris;
    const n = pts.length, ref = [cx, cy, -0.05];
    for (let k = 0; k < R.length - 1; k++) {
      const c = rainbow ? rainbow[k] : k === 0 ? col : shade(col, 1.04);
      for (let i = 0; i < n; i++) quadOut(bg, R[k][i], R[k][(i + 1) % n], R[k + 1][(i + 1) % n], R[k + 1][i], c, ref);
    }
    const last = R[R.length - 1], cTop = rainbow ? rainbow[5] : shade(col, 1.06);
    for (let i = 0; i < n; i++) triOut(bg, last[i], last[(i + 1) % n], top, cTop, ref);
    loopTris.push([t0, bg.tris]);
    fronts.push({ pts, cx, cy, sx });
    // back face and the ribbon edge
    const back = pts.map(([x, y]) => [x, y, -0.005]), bc = [cx, cy, -0.01];
    for (let i = 0; i < n; i++) triOut(bg, back[i], back[(i + 1) % n], bc, rainbow ? rainbow[i % rainbow.length] : shade(col, 0.86), [cx, cy, 0.05]);
    for (let i = 0; i < n; i++) quadOut(bg, R[0][i], R[0][(i + 1) % n], back[(i + 1) % n], back[i], shade(col, 0.82), [cx, cy, 0]);
  }
  // tails with a swallowtail notch
  const tailPts = [];
  for (const sx of [1, -1]) {
    const C = [[sx * 0.008, -0.01, -0.004], [sx * 0.03, -0.046, -0.008], [sx * 0.053, -0.082, -0.007], [sx * 0.072, -0.115, -0.003]];
    const L = [], Rr = [];
    for (let i = 0; i < C.length; i++) {
      const a = C[Math.max(0, i - 1)], b = C[Math.min(C.length - 1, i + 1)];
      const t = norm(sub(b, a)), side = norm(cross(t, [0, 0, 1])), w = lerp(0.017, 0.02, i / 3);
      L.push(add(C[i], scl(side, w))); Rr.push(add(C[i], scl(side, -w)));
    }
    const notch = add(C[C.length - 1], scl(norm(sub(C[C.length - 2], C[C.length - 1])), 0.014));
    const k = bg._col(col), kb = bg._col(dark);
    for (let i = 0; i < C.length - 1; i++) {
      const quad = [L[i], Rr[i], Rr[i + 1], L[i + 1]];
      const nrm = cross(sub(quad[2], quad[0]), sub(quad[3], quad[1]));
      const f = nrm[2] >= 0 ? quad : [quad[0], quad[3], quad[2], quad[1]];
      bg._tri(f[0], f[1], f[2], k); bg._tri(f[0], f[2], f[3], k);
      bg._tri(f[0], f[2], f[1], kb); bg._tri(f[0], f[3], f[2], kb);
    }
    const e = C.length - 1;
    // the notch: two little triangles from the outer corners to the notch point
    const nTri = (a, b, c) => {
      const nrm = cross(sub(b, a), sub(c, a));
      if (nrm[2] >= 0) { bg._tri(a, b, c, k); bg._tri(a, c, b, kb); } else { bg._tri(a, c, b, k); bg._tri(a, b, c, kb); }
    };
    nTri(L[e - 1], L[e], notch); nTri(Rr[e - 1], notch, Rr[e]); nTri(L[e - 1], notch, Rr[e - 1]);
    tailPts.push({ c: C, sx });
  }
  // the knot
  const knotC = rainbow ? rainbow[0] : shade(col, 0.94);
  bg.cloft(0, -0.022, 0.009, q.more ? [[0, 0.026, 0.028, 0.009], [0.008, 0.034, 0.034, 0.011], [0.036, 0.034, 0.034, 0.011], [0.044, 0.026, 0.028, 0.009]]
    : [[0, 0.032, 0.032, 0.01], [0.044, 0.032, 0.032, 0.01]], knotC, { capTop: true, capBot: true });

  // ---- patterns
  const onLoop = (k, x, y) => {
    const [t0, t1] = loopTris[k];
    const hit = raycast(bg, t0, t1, [x, y, 0.5], [0, 0, -1]);
    return hit ? frame(hit, [0, 1, 0]) : null;
  };
  const spots = [[0.042, 0.004, 1], [0.072, -0.022, 0.92], [0.088, 0.024, 1.05], [0.106, 0.0, 0.82], [0.064, 0.03, 0.72], [0.098, -0.026, 0.7]];
  const loopSpot = (k, u, v) => {
    const sx = fronts[k].sx, ang = 0.3;
    return [sx * (u * Math.cos(ang) - v * Math.sin(ang)), u * Math.sin(ang) + v * Math.cos(ang)];
  };
  const tailSpot = (k) => {
    const c = tailPts[k].c;
    return { o: [c[2][0], c[2][1], c[2][2] + 0.0006], n: [0, 0, 1], t: [1, 0, 0], b: [0, 1, 0] };
  };
  const shape = (f, kind, s, color, lift = 0.0012) => {
    if (kind === 'stars') decalPoly(bg, f, starPts(s * 1.15, s * 0.48), color, lift);
    else if (kind === 'polkaDots') decalPoly(bg, f, ellipse(s * 0.82, s * 0.82, 8), color, lift);
    else if (kind === 'hearts') decalPoly(bg, f, heartPts(s * 1.15), color, lift, 0, 0);
  };
  if (pat === 'stars' || pat === 'polkaDots' || pat === 'hearts') {
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < (q.more ? 5 : 3); i++) {
        const [u, v, sz] = spots[i], [x, y] = loopSpot(k, u, v), f = onLoop(k, x, y);
        if (f) shape(f, pat, 0.0078 * sz, acc);
      }
      if (q.more) shape(tailSpot(k), pat, 0.0068, acc);
    }
  } else if (pat === 'checker') {
    const cell = 0.0165;
    for (let k = 0; k < 2; k++) {
      const pts = fronts[k].pts, inside = (x, y) => {
        let c = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i], b = pts[j];
          if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
        }
        return c;
      };
      for (let ix = -8; ix <= 8; ix++) for (let iy = -4; iy <= 4; iy++) {
        if ((ix + iy) & 1) continue;
        const x = ix * cell + cell / 2, y = iy * cell + cell / 2;
        if (!inside(x * 1.08, y * 1.08) || Math.abs(x) < 0.02) continue;
        const f = onLoop(k, x, y);
        if (f) decalPoly(bg, f, [[-cell / 2, -cell / 2], [cell / 2, -cell / 2], [cell / 2, cell / 2], [-cell / 2, cell / 2]], acc, 0.001);
      }
    }
  } else if (pat === 'rhinestones') {
    // rows of little stones: white, silver and pale pink, a few of them twinkling
    const stones = [0xffffff, 0xe4e6f2, 0xffd0ea];
    const rows = q.more ? [[-0.026, 4], [-0.008, 5], [0.01, 5], [0.028, 4]] : [[-0.016, 3], [0.012, 3]];
    for (let k = 0; k < 2; k++) {
      let i = 0;
      for (const [v, n] of rows) {
        for (let j = 0; j < n; j++) {
          const u = 0.03 + ((j + (v > 0 ? 0.5 : 0)) / n) * 0.09, [x, y] = loopSpot(k, u, v), f = onLoop(k, x, y);
          if (!f) continue;
          const r = 0.0042;
          decalQuad(bg, f, [[0, -r], [r, 0], [0, r], [-r, 0]], stones[i % 3], 0.0011);
          if (i % 5 === 2) glints.push({ p: f.o, n: f.n, size: 0.65, color: 0xffffff, rank: 1 });
          i++;
        }
      }
    }
  } else if (pat === 'rainbow') {
    // a little rainbow on each loop
    const bands = [0xff4f6d, 0xff9f43, 0xffe066, 0x5fdd8b, 0x4fb3ff, 0xa46bff], segs = q.more ? 6 : 4;
    for (let k = 0; k < 2; k++) {
      const [x, y] = loopSpot(k, 0.08, -0.016), f = onLoop(k, x, y);
      if (!f) continue;
      bands.forEach((c, i) => {
        if (!q.more && i % 2) return;
        const r = 0.036 - i * 0.0052, arc = [];
        for (let a = 0; a <= segs; a++) { const t = Math.PI * (a / segs); arc.push([Math.cos(t) * r * fronts[k].sx, Math.sin(t) * r]); }
        decalStrip(bg, f, arc, q.more ? 0.0056 : 0.0098, c, 0.0012 + i * 0.0001);
      });
    }
  }
  if (pat === 'glitter' || opt.glitter) {
    const specks = pat === 'glitter' ? (q.more ? 26 : 14) : q.more ? 14 : 8;
    const tints = [0xffffff, shade(col, 1.35), shade(col, 0.7), opt.glitter ? 0xffffff : acc];
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < specks; i++) {
        const u = 0.03 + rnd() * 0.085, v = (rnd() - 0.5) * 0.07, [x, y] = loopSpot(k, u, v), f = onLoop(k, x, y);
        if (!f) continue;
        const s = 0.0028 + rnd() * 0.0028, a = rnd() * TAU;
        decalPoly(bg, f, [[Math.cos(a) * s, Math.sin(a) * s], [Math.cos(a + 2.1) * s, Math.sin(a + 2.1) * s], [Math.cos(a + 4.2) * s, Math.sin(a + 4.2) * s]], tints[i % tints.length], 0.0009);
      }
    }
  }
  // a rhinestone on the knot
  decalPoly(bg, { o: [0, 0, 0.0265], n: [0, 0, 1], t: [1, 0, 0], b: [0, 1, 0] }, ellipse(0.0065, 0.0065, 8), opt.id === 'gold' ? 0xffffff : 0xeef0ff, 0.0005);
  glints.push({ p: [0, 0, 0.03], n: [0, 0, 1], size: 1.15, color: 0xffffff, rank: 0 });
  for (let k = 0; k < 2; k++) {
    const [x, y] = loopSpot(k, 0.085, 0.012), f = onLoop(k, x, y);
    if (f) glints.push({ p: f.o, n: f.n, size: 0.95, color: opt.glitter ? 0xffffff : 0xffd6f0, rank: 1 });
    const [x2, y2] = loopSpot(k, 0.05, -0.02), f2 = onLoop(k, x2, y2);
    if (f2) glints.push({ p: f2.o, n: f2.n, size: 0.8, color: 0xffffff, rank: 2 });
  }
  return { bg, glints };
}

// ---- the body ------------------------------------------------------------------------------------
function buildBody(g, look, q, rest, glints, seed) {
  const skin = hx(lookOption('skin', look.skin).color);
  const top = lookOption('top', look.top), bot = lookOption('bottom', look.bottom);
  const shoe = lookOption('shoes', look.shoes), sock = lookOption('socks', look.socks);
  const tc = hx(top.color), tt = hx(top.trim), bc = hx(bot.color), bt = hx(bot.trim);
  const skinDk = shade(skin, 0.9);
  const rnd = mulberry(seed * 7 + 1);
  const L = q.limb, S = q.body;

  // -- pelvis: shorts, skirt briefs or leggings
  g.bone(B.hips);
  const band = bot.style === 'leggings' ? bc : bt;
  lathe2(g, 0, 0.004, [[0.56, 0, 0], [0.568, 0.042, 0.03], [0.59, 0.092, 0.065], [0.63, 0.11, 0.075], [0.68, 0.104, 0.072], [0.715, 0.096, 0.068], [0.747, 0.092, 0.065]], S,
    (y) => (y > 0.722 ? band : bc));

  // -- waist and chest
  const crop = top.style === 'crop';
  g.bone(B.waist);
  const hem = top.style === 'hoodie' ? 0.69 : 0.705;
  const wr = crop ? [[0.712, 0.093, 0.065], [0.75, 0.088, 0.062], [0.79, 0.09, 0.063], [0.825, 0.098, 0.066]]
    : [[hem, top.style === 'hoodie' ? 0.112 : 0.103, top.style === 'hoodie' ? 0.078 : 0.072], [hem + 0.02, 0.1, 0.07], [0.75, 0.094, 0.066], [0.79, 0.096, 0.067], [0.825, 0.102, 0.068]];
  lathe2(g, 0, 0.004, wr, S, (y) => {
    if (crop) return skin;
    if (top.style === 'hoodie' && y < hem + 0.02) return tt;
    if (top.style === 'shell' && y < hem + 0.02) return tt;
    return tc;
  }, { capBot: !crop });
  if (crop) { // a little navel
    const hit = raycast(g, g.tris - S * 3 * 2, g.tris, [0, 0.745, 0.3], [0, 0, -1]);
    if (hit) decalPoly(g, frame(hit), ellipse(0.0035, 0.005, 6), shade(skin, 0.8), 0.0006);
  }
  g.bone(B.chest);
  const t0 = g.tris;
  const chestRings = q.more ? [[0.795, 0.101, 0.069], [0.83, 0.108, 0.071, 0.003], [0.87, 0.114, 0.073, 0.005], [0.905, 0.118, 0.072, 0.003], [0.935, 0.116, 0.068], [0.958, 0.104, 0.06], [0.975, 0.076, 0.05], [0.986, 0.043, 0.037]]
    : [[0.795, 0.101, 0.069], [0.87, 0.114, 0.073, 0.005], [0.927, 0.117, 0.07], [0.962, 0.098, 0.058], [0.986, 0.043, 0.037]];
  lathe2(g, 0, 0.004, chestRings, S, (y, az) => {
    if (crop) {
      const back = Math.cos(az) < -0.3;
      return y < (back ? 0.95 : 0.927) ? tc : skin;
    }
    return tc;
  }, { capBot: crop ? tc : false, capTop: crop ? skin : tc });
  const t1 = g.tris;
  const chestHit = (x, y, back = false) => raycast(g, t0, t1, [x, y, back ? -0.4 : 0.4], [0, 0, back ? 1 : -1]);

  if (crop) {
    // straps over the shoulders
    for (const sx of [1, -1]) {
      for (const back of [false, true]) {
        const h = chestHit(sx * 0.052, 0.94, back);
        if (h) {
          const f = frame(h);
          decalStrip(g, f, [[0, -0.016], [0, 0.0], [sx * (back ? 0.004 : -0.002) * (back ? -1 : 1), 0.022]], 0.017, tc, 0.0014);
        }
      }
    }
    // rhinestone starbursts: pink, purple and silver
    const stones = top.stones.map(hx);
    const front = [[0.034, 0.868, 0.017, 2], [-0.046, 0.896, 0.012, 0], [0.072, 0.836, 0.01, 0], [-0.02, 0.84, 0.0095, 1], [0.074, 0.9, 0.009, 2], [-0.076, 0.856, 0.0085, 2],
      [0.002, 0.906, 0.0068, 1], [-0.056, 0.822, 0.0062, 2], [0.012, 0.823, 0.0065, 0], [-0.088, 0.9, 0.006, 1]];
    const back = [[0.03, 0.87, 0.013, 2], [-0.04, 0.9, 0.009, 0], [-0.05, 0.84, 0.008, 1]];
    const draw = (list, isBack) => {
      list.forEach(([x, y, r, ci], i) => {
        if (!q.more && i > 3) return;
        const h = chestHit(x, y, isBack);
        if (!h) return;
        const f = frame(h), c = stones[ci % stones.length], big = r >= 0.0085;
        decalPoly(g, f, starPts(r, r * (big ? 0.38 : 0.45), big ? 8 : 5, i * 0.4), c, 0.0012);
        if (big) decalQuad(g, f, [[0, -r * 0.34], [r * 0.34, 0], [0, r * 0.34], [-r * 0.34, 0]], 0xffffff, 0.0018);
        if (big) glintAt(glints, f.o, f.n, B.chest, 0.65 + r * 30, c === 0xeae8f2 ? 0xffffff : c);
      });
    };
    draw(front, false);
    if (q.more) {
      draw(back, true);
      // a rhinestone trim along the hem
      for (let i = -4; i <= 4; i++) {
        const h = chestHit(i * 0.02, 0.802);
        if (h) decalQuad(g, frame(h), [[0, -0.0036], [0.0036, 0], [0, 0.0036], [-0.0036, 0]], stones[(i + 9) % stones.length], 0.0012);
      }
    }
  } else if (top.style === 'shell') {
    // V-neck with trim stripes, a chevron and a star on the chest
    const acc = hx(top.accent);
    const h = chestHit(0, 0.93);
    if (h) {
      const f = frame(h);
      decalPoly(g, f, [[-0.036, 0.04], [0.036, 0.04], [0, -0.05]], skin, 0.0012, 0, 0.01);
      decalStrip(g, f, [[-0.04, 0.042], [0, -0.054], [0.04, 0.042]], 0.009, tt, 0.0016);
      decalStrip(g, f, [[-0.047, 0.042], [0, -0.066], [0.047, 0.042]], 0.0045, acc, 0.0016);
    }
    const hc = chestHit(-0.045, 0.85);
    if (hc) decalPoly(g, frame(hc), starPts(0.016, 0.0068), acc, 0.0014);
    const hs = chestHit(0.04, 0.82);
    if (hs) {
      const f = frame(hs);
      decalStrip(g, f, [[-0.02, 0.004], [0, -0.01], [0.02, 0.004]], 0.008, tt, 0.0014);
      decalStrip(g, f, [[-0.02, 0.016], [0, 0.002], [0.02, 0.016]], 0.008, tt, 0.0014);
    }
  } else if (top.style === 'tee') {
    const acc = hx(top.accent);
    const h = chestHit(0, 0.865);
    if (h) {
      const f = frame(h);
      decalPoly(g, f, heartPts(0.03), acc, 0.0012);
      decalPoly(g, f, starPts(0.009, 0.004), 0xffffff, 0.0018, 0, 0.002);
    }
    const hn = chestHit(0, 0.962);
    if (hn) decalStrip(g, frame(hn), [[-0.03, 0.004], [0, -0.003], [0.03, 0.004]], 0.006, tt, 0.0012);
  } else if (top.style === 'hoodie') {
    const acc = hx(top.accent);
    // the hood, bunched on her upper back
    g.sphere(0, 0.935, -0.068, 0.07, shade(tc, 0.95), { seg: q.limb + 1, rings: 4, sx: 1.35, sy: 0.62, sz: 0.62 });
    // kangaroo pocket
    const h = chestHit(0, 0.81);
    if (h) {
      const f = frame(h);
      decalPoly(g, f, [[-0.055, -0.024], [0.055, -0.024], [0.04, 0.022], [-0.04, 0.022]], tt, 0.0012);
    }
    // drawstrings
    for (const sx of [1, -1]) {
      const hs = chestHit(sx * 0.022, 0.93);
      if (hs) decalStrip(g, frame(hs), [[0, 0.03], [sx * 0.002, -0.004], [sx * 0.004, -0.04]], 0.005, acc, 0.0016);
    }
  }

  // -- neck and head
  g.bone(B.head);
  lathe2(g, 0, 0, [[0.94, 0.044], [1.0, 0.042], [1.05, 0.04], [1.09, 0.032]], q.more ? 7 : 5, skin);
  const h0 = g.tris;
  // jaw and chin, then a round cranium (a true sphere, so the hair can sit just above it)
  const hp = [[0, -0.152], [0.054, -0.145], [0.1, -0.117], [0.134, -0.072], [0.156, -0.022]];
  for (const deg of q.more ? [80, 62, 44, 24, 0] : [78, 50, 22, 0]) hp.push([Math.sin(deg * DEG) * HR, Math.cos(deg * DEG) * HR]);
  lathe2(g, HC[0], HC[2], hp.map(([r, y]) => [HC[1] + y, r, r * HS]), q.head, skin, { ph: Math.PI / q.head });
  const h1 = g.tris;
  // a little forward chin and fuller cheeks
  for (let i = h0 * 9; i < h1 * 9; i += 3) {
    const y = g.p[i + 1] - HC[1], z = g.p[i + 2] - HC[2];
    if (y < 0 && z > 0) g.p[i + 2] += 0.014 * (-y / 0.152) * (z / HR);
  }
  // ears
  for (const sx of [1, -1]) g.sphere(sx * 0.158, HC[1] - 0.012, HC[2] - 0.012, 0.03, skin, { seg: q.more ? 5 : 4, rings: q.more ? 3 : 2, sx: 0.42, sz: 0.72 });

  buildFace(g, look, q, rest, h0, h1, skin);

  // -- arms
  const sleeve = top.style === 'tee' ? 'short' : top.style === 'hoodie' ? 'long' : null;
  for (const sx of [1, -1]) {
    const x = sx * RIG.shoulderX;
    g.bone(sx > 0 ? B.armL : B.armR);
    const up = q.more ? [[0.728, 0], [0.737, 0.025], [0.755, 0.031], [0.845, 0.035], [0.86, 0.0355], [0.93, 0.039], [0.962, 0.034], [0.98, 0]]
      : [[0.73, 0], [0.75, 0.03], [0.85, 0.035], [0.935, 0.038], [0.978, 0]];
    const grow = (y) => (sleeve === 'long' ? 0.007 : sleeve === 'short' && y > 0.845 ? 0.009 : 0);
    lathe2(g, x, 0, up.map(([y, r]) => [y, r > 0 ? r + grow(y) : 0]), L, (y) => {
      if (sleeve === 'long') return tc;
      if (sleeve === 'short') return y > 0.86 ? tc : y > 0.845 ? tt : skin;
      if (top.style === 'shell' && y > 0.935) return tc;
      return skin;
    });
    g.bone(sx > 0 ? B.foreL : B.foreR);
    const lo = q.more ? [[0.56, 0], [0.568, 0.022], [0.6, 0.0255], [0.69, 0.029], [0.75, 0.03], [0.766, 0]]
      : [[0.565, 0], [0.6, 0.025], [0.74, 0.03], [0.766, 0]];
    lathe2(g, x, 0, lo.map(([y, r]) => [y, r > 0 ? r + (sleeve === 'long' ? (y < 0.6 ? 0.009 : 0.007) : 0) : 0]), L, (y) => (sleeve === 'long' ? (y < 0.6 ? tt : tc) : skin));
    // fist with a thumb
    lathe2(g, x, 0.006, q.more ? [[0.503, 0, 0], [0.509, 0.018, 0.02], [0.522, 0.024, 0.027], [0.55, 0.024, 0.027], [0.566, 0, 0]]
      : [[0.505, 0, 0], [0.52, 0.024, 0.026], [0.55, 0.024, 0.026], [0.566, 0, 0]], q.more ? 6 : 5, skin);
    if (q.more) g.sphere(x - sx * 0.004, 0.545, 0.031, 0.0105, skinDk, { seg: 4, rings: 2 });
  }

  // -- legs
  for (const sx of [1, -1]) {
    const x = sx * RIG.legX;
    g.bone(sx > 0 ? B.legL : B.legR);
    const thigh = q.more ? [[0.318, 0], [0.33, 0.035], [0.36, 0.043], [0.45, 0.05], [0.53, 0.054], [0.545, 0.055], [0.61, 0.053], [0.645, 0.041], [0.662, 0]]
      : [[0.32, 0], [0.345, 0.04], [0.53, 0.054], [0.545, 0.055], [0.64, 0.045], [0.662, 0]];
    const shorts = bot.style === 'shorts', legg = bot.style === 'leggings';
    const th0 = g.tris;
    lathe2(g, x, 0.004, thigh.map(([y, r]) => [y, r > 0 && shorts && y >= 0.53 && y <= 0.545 ? r + 0.005 : r]), L, (y) => {
      if (legg) return bc;
      if (shorts) return y > 0.545 ? bc : y > 0.53 ? bt : skin;
      return skin;
    });
    const th1 = g.tris;
    // Small star specks scattered around a limb: rays aimed at its axis, against its own triangles.
    const scatter = (t0, t1, n, y0, y1, colors, size, glintBone) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd() * 0.6, y = y0 + rnd() * (y1 - y0);
        const o = [x + Math.sin(a) * 0.3, y, Math.cos(a) * 0.3], d = norm([x - o[0], 0, -o[2]]);
        const h = raycast(g, t0, t1, o, d);
        if (!h) continue;
        const f = frame(h), c = colors[i % colors.length], a2 = rnd() * 0.6;
        decalQuad(g, f, [[Math.sin(a2) * size, -Math.cos(a2) * size], [Math.cos(a2) * size * 0.6, Math.sin(a2) * size * 0.6], [-Math.sin(a2) * size, Math.cos(a2) * size], [-Math.cos(a2) * size * 0.6, -Math.sin(a2) * size * 0.6]], c, 0.0008);
        if (glintBone !== undefined && i < 3) glintAt(glints, f.o, f.n, glintBone, 0.55, c, 0.012);
      }
    };
    if (bot.specks) scatter(th0, th1, q.more ? 8 : 4, 0.38, 0.6, bot.specks.map(hx), 0.005);
    g.bone(sx > 0 ? B.shinL : B.shinR);
    const shin = q.more ? [[0.062, 0], [0.07, 0.026], [0.105, 0.029], [0.125, 0.031], [0.2, 0.038], [0.26, 0.042], [0.33, 0.039], [0.364, 0]]
      : [[0.065, 0], [0.08, 0.028], [0.125, 0.031], [0.25, 0.041], [0.364, 0]];
    const stripes = sock.stripes ? sock.stripes.map(hx) : null;
    const sh0 = g.tris;
    lathe2(g, x, 0.002, shin.map(([y, r]) => [y, r > 0 && y <= 0.125 ? r + 0.002 : r]), L, (y, az, i) => {
      if (y < 0.125) return stripes ? stripes[(i + 3) % stripes.length] : hx(sock.color);
      if (legg && y > 0.11) return bc;
      return skin;
    });
    const sh1 = g.tris;
    // sock sparkle and galaxy leggings specks
    if (sock.specks) scatter(sh0, sh1, q.more ? 7 : 4, 0.085, 0.12, sock.specks.map(hx), 0.0042, sx > 0 ? B.shinL : B.shinR);
    if (bot.specks) scatter(sh0, sh1, q.more ? 9 : 5, 0.14, 0.32, bot.specks.map(hx), 0.0045);
    // shoe
    g.bone(sx > 0 ? B.footL : B.footR);
    buildShoe(g, x, shoe, q, glints, sx > 0 ? B.footL : B.footR, rnd);
  }

  // -- skirt
  if (bot.style === 'skirt') buildSkirt(g, bot, q);
}

function buildShoe(g, x, shoe, q, glints, bone, rnd) {
  const up = hx(shoe.color), sole = hx(shoe.sole), acc = hx(shoe.accent), lace = hx(shoe.lace);
  const sneaker = shoe.style === 'sneaker';
  const soleH = sneaker ? 0.024 : 0.018;
  const k = sneaker ? 1.06 : 1;
  let st = [[-0.05, 0.022, 0.058], [-0.044, 0.031, 0.085], [-0.02, 0.034, 0.09], [0.025, 0.035, 0.073], [0.07, 0.036, 0.058], [0.108, 0.03, 0.046], [0.132, 0.013, 0.032]];
  if (!q.more) st = [st[0], st[2], st[4], st[5], st[6]];
  st = st.map(([z, hw, top]) => [z * (sneaker ? 1.03 : 1), hw * k, top * k]);
  const ring = ([z, hw, top]) => {
    const c = Math.min(hw * 0.45, 0.012), r = [];
    if (!q.more) return [[x - hw, 0, z], [x + hw, 0, z], [x + hw, top - c, z], [x + hw * 0.6, top, z], [x - hw * 0.6, top, z], [x - hw, top - c, z]];
    r.push([x - hw, 0.004, z], [x - hw + c, 0, z], [x + hw - c, 0, z], [x + hw, 0.004, z]);
    r.push([x + hw, top - c, z], [x + hw - c * 0.9, top, z], [x - hw + c * 0.9, top, z], [x - hw, top - c, z]);
    return r;
  };
  const R = st.map(ring), n = R[0].length;
  const colorAt = (a, b, c, d) => {
    const cy = (a[1] + b[1] + c[1] + d[1]) / 4, cz = (a[2] + b[2] + c[2] + d[2]) / 4, cxx = (a[0] + b[0] + c[0] + d[0]) / 4;
    if (cy < soleH) return sole;
    if (sneaker && cz > 0.085 && cy < 0.045) return acc;
    if (!sneaker && Math.abs(cxx - x) > 0.028 && cy > 0.03 && cy < 0.05 && cz > -0.01 && cz < 0.07) return acc;
    if (sneaker && cz < -0.035 && cy > 0.05) return acc;
    return up;
  };
  for (let i = 0; i < R.length - 1; i++) {
    const ref = [x, 0.04, (st[i][0] + st[i + 1][0]) / 2];
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n, a = R[i][j], b = R[i][j1], c = R[i + 1][j1], d = R[i + 1][j];
      quadOut(g, a, b, c, d, colorAt(a, b, c, d), ref);
    }
  }
  const capC = (r, z, dz) => {
    const c = [x, 0.03, z + dz];
    for (let j = 0; j < n; j++) triOut(g, r[j], r[(j + 1) % n], c, r[j][1] < soleH && r[(j + 1) % n][1] < soleH ? sole : up, [x, 0.03, z - dz * 4]);
  };
  capC(R[0], st[0][0], -0.006);
  capC(R[R.length - 1], st[st.length - 1][0], 0.004);
  // laces
  for (let i = 0; i < (q.more ? 3 : 0); i++) {
    const z = 0.005 + i * 0.022, y = lerp(0.088, 0.066, i / 2) + 0.0015;
    const fl = { o: [x, y, z], n: norm([0, 1, 0.35]), t: [1, 0, 0], b: norm([0, -0.35, 1]) };
    decalStrip(g, fl, [[-0.014, 0], [0.014, 0]], 0.0055, lace, 0.0008);
  }
  if (shoe.glitter) {
    for (let i = 0; i < (q.more ? 10 : 5); i++) {
      const z = -0.03 + rnd() * 0.13, side = rnd() < 0.5 ? 1 : -1, y = 0.03 + rnd() * 0.035;
      const fl = { o: [x + side * 0.0375, y, z], n: [side, 0, 0], t: [0, 0, side], b: [0, 1, 0] };
      decalPoly(g, fl, starPts(0.004, 0.0016, 4, rnd()), i % 2 ? 0xffffff : acc, 0.0008);
    }
  }
  glintAt(glints, [x + 0.03, 0.05, 0.02], [1, 0, 0], bone, 0.5, shoe.glitter ? 0xffffff : 0xfff0fa, 0.004);
}

function buildSkirt(g, bot, q) {
  const col = hx(bot.color), trim = hx(bot.trim), acc = hx(bot.accent || bot.trim);
  const S = q.more ? 18 : 12;
  const panels = [B.skirtF, B.skirtL, B.skirtB, B.skirtR];
  g.wf = (x, y, z) => {
    let az = Math.atan2(x, z);
    if (az < 0) az += TAU;
    const s = az / (Math.PI / 2), i = Math.floor(s) % 4, f = sstep(0, 1, s - Math.floor(s));
    return [panels[i], panels[(i + 1) % 4], 1 - f, f];
  };
  const rings = [[0.752, 0.097, 0.067], [0.66, 0.128, 0.1], [0.575, 0.158, 0.132], [0.556, 0.161, 0.135]];
  const zig = (i, j) => (i === 0 ? 1 : 1 + (j % 2 ? 0.045 : -0.02) * (i / 2));
  const colorFn = (y, az, i, j) => (i === 2 ? trim : j % 2 ? col : shade(col, 0.86));
  lathe2(g, 0, 0.004, rings, S, colorFn, { zig });
  // the inside, darker, so the skirt reads from below when it flares
  const inner = rings.map(([y, rx, rz]) => [y, rx - 0.003, rz - 0.003]);
  const P = [];
  for (let i = 0; i < inner.length; i++) {
    const row = [];
    for (let j = 0; j < S; j++) {
      const a = (TAU * j) / S, z = zig(i, j);
      row.push([Math.sin(a) * inner[i][1] * z, inner[i][0], 0.004 + Math.cos(a) * inner[i][2] * z]);
    }
    P.push(row);
  }
  const dk = shade(col, 0.55);
  for (let i = 0; i < P.length - 1; i++) {
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S, a = P[i][j], b = P[i][j1], c = P[i + 1][j1], d = P[i + 1][j];
      const mid = [(a[0] + c[0]) / 2 * 3, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2 * 3];
      quadOut(g, a, b, c, d, dk, mid);
    }
  }
  // a waistband and a little accent stripe above the hem
  g.wf = null;
  g.bone(B.hips);
  lathe2(g, 0, 0.004, [[0.738, 0.1, 0.07], [0.756, 0.098, 0.068]], S, acc === trim ? shade(col, 0.8) : trim);
}

function buildFace(g, look, q, rest, h0, h1, skin) {
  const hairCol = hx(lookOption('hair', look.hair).color);
  const light = (((hairCol >> 16) & 255) * 0.3 + ((hairCol >> 8) & 255) * 0.59 + (hairCol & 255) * 0.11) > 150;
  const brow = light ? mix(hairCol, 0x5a3a2a, 0.55) : shade(hairCol, 0.75);
  const lum = ((skin >> 16) & 255) * 0.3 + ((skin >> 8) & 255) * 0.59 + (skin & 255) * 0.11;
  const blush = mix(skin, lum > 150 ? 0xff5c8a : 0xd93e6e, lum > 150 ? 0.36 : 0.3);
  const mouth = mix(skin, 0x4a0f22, 0.78);
  const hit = (x, y) => raycast(g, h0, h1, [HC[0] + x, HC[1] + y, HC[2] + 0.5], [0, 0, -1]);
  const eyeY = -0.012, eyeX = 0.061, ew = 0.019, eh = 0.0272;
  rest.face = {};
  for (const sx of [1, -1]) {
    const h = hit(sx * eyeX, eyeY);
    if (!h) continue;
    const f = frame(h);
    g.bone(sx > 0 ? B.eyeL : B.eyeR);
    rest.face[sx > 0 ? 'eyeL' : 'eyeR'] = f.o;
    decalPoly(g, f, ellipse(ew, eh, q.face ? 14 : 9), EYE, 0.0012);
    if (q.face) decalPoly(g, f, ellipse(ew * 0.74, eh * 0.42, 10, 0, -eh * 0.42), EYE_LOW, 0.0017);
    decalPoly(g, f, ellipse(0.0066, 0.0076, q.face ? 8 : 5, -0.0058, 0.0098), WHITE, 0.0024);
    if (q.face) decalPoly(g, f, ellipse(0.0033, 0.0033, 6, 0.0062, -0.0112), WHITE, 0.0024);
    // upper lash line with a flick at the outer corner
    const lash = [];
    const NL = q.face ? 8 : 4;
    for (let i = 0; i <= NL; i++) {
      const a = Math.PI * (0.97 - (i / NL) * 0.9);
      lash.push([Math.cos(a) * (ew + 0.0016) * (a > Math.PI / 2 ? 1 : 1), Math.sin(a) * (eh + 0.0012) - 0.001]);
    }
    if (sx < 0) lash.forEach((p) => { p[0] = -p[0]; });
    decalStrip(g, f, lash, 0.0042, LASH, 0.0016, 0.0062);
    const ox = sx * (ew + 0.003);
    decalPoly(g, f, [[ox - sx * 0.006, eh * 0.35], [ox + sx * 0.0068, eh * 0.62], [ox - sx * 0.001, eh * 0.1]], LASH, 0.0016, ox - sx * 0.002, eh * 0.36);
    if (q.face) decalPoly(g, f, [[ox - sx * 0.008, eh * 0.62], [ox + sx * 0.003, eh * 0.98], [ox - sx * 0.0045, eh * 0.5]], LASH, 0.0016, ox - sx * 0.0045, eh * 0.7);
  }
  // happy eyes: ^ ^ (hidden until she beams)
  g.bone(B.happy);
  for (const sx of [1, -1]) {
    const h = hit(sx * eyeX, eyeY);
    if (!h) continue;
    const f = frame(h), arc = [];
    const NA = q.face ? 8 : 4;
    for (let i = 0; i <= NA; i++) { const a = Math.PI * (i / NA); arc.push([Math.cos(a) * ew * 1.05, Math.sin(a) * eh * 0.5 - 0.004]); }
    decalStrip(g, f, arc, 0.006, LASH, 0.0018);
  }
  const hm = hit(0, eyeY);
  rest.face.happy = hm ? hm.p : [0, HC[1] + eyeY, HC[2] + HR];
  // brows
  g.bone(B.brows);
  for (const sx of [1, -1]) {
    const h = hit(sx * 0.064, 0.066);
    if (!h) continue;
    const f = frame(h);
    decalStrip(g, f, [[-sx * 0.016, -0.004], [0, 0.002], [sx * 0.016, -0.002]], 0.0058, brow, 0.0016, 0.004);
  }
  const hb = hit(0, 0.066);
  rest.face.brows = hb ? hb.p : [0, HC[1] + 0.066, HC[2] + HR];
  // mouths
  const mh = hit(0, -0.078);
  if (mh) {
    const f = frame(mh);
    rest.face.mouth = f.o;
    g.bone(B.mouthSmile);
    const sm = [];
    const NS = q.face ? 8 : 4;
    for (let i = 0; i <= NS; i++) { const x = -0.0155 + (i / NS) * 0.031; sm.push([x, -0.0095 * (1 - (x / 0.0155) ** 2) + 0.003]); }
    decalStrip(g, f, sm, 0.0052, mouth, 0.0016);
    g.bone(B.mouthGrin);
    const grin = [[-0.0195, 0.006]];
    for (let i = 0; i <= 10; i++) { const a = Math.PI + (Math.PI * i) / 10; grin.push([Math.cos(a) * 0.0195, 0.006 + Math.sin(a) * 0.0185]); }
    decalPoly(g, f, grin, MOUTH_IN, 0.0014, 0, -0.004);
    decalPoly(g, f, ellipse(0.0105, 0.0052, 8, 0, -0.0085), TONGUE, 0.0019);
    if (q.face) decalPoly(g, f, [[-0.014, 0.0055], [0.014, 0.0055], [0.012, 0.0015], [-0.012, 0.0015]], WHITE, 0.0019);
    g.bone(B.mouthO);
    decalPoly(g, f, ellipse(0.0078, 0.0092, 10, 0, -0.004), MOUTH_IN, 0.0014);
    decalPoly(g, f, ellipse(0.0048, 0.003, 8, 0, -0.0095), TONGUE, 0.0019);
  }
  // blush and nose
  g.bone(B.head);
  for (const sx of [1, -1]) {
    const h = hit(sx * 0.094, -0.05);
    if (h) decalPoly(g, frame(h), ellipse(0.0185, 0.0095, q.face ? 10 : 8), blush, 0.0011);
  }
  const nh = hit(0, -0.036);
  if (nh) {
    const f = frame(nh), k = g._col(shade(skin, 0.97));
    const a = fp(f, -0.0055, 0.003, 0), b = fp(f, 0.0055, 0.003, 0), c = fp(f, 0, -0.006, 0.0005), tip = fp(f, 0, -0.002, 0.0055);
    g._tri(a, c, tip, k); g._tri(c, b, tip, g._col(shade(skin, 0.9))); g._tri(b, a, tip, g._col(shade(skin, 1.03)));
  }
}

// ---- entry ---------------------------------------------------------------------------------------
export function buildCharacter(look, quality = 'high') {
  const q = QUALITY[quality] || QUALITY.high;
  const seed = Math.floor(hash(String(JSON.stringify(look)).length * 131 + 7) * 1000);
  const g = newGeo();
  const rest = { chain: null, bow: null, face: null, anchors: {} };
  const glints = [];

  buildBody(g, look, q, rest, glints, seed);
  buildHair(g, look, q, rest);

  // the bow, on its own bone
  const size = lookOption('bowSize', look.bowSize).scale * 1.22;
  const spot = rest.bow;
  const { bg, glints: bowGlints } = buildBow(look, q, seed);
  const pos = [spot.p[0], spot.p[1] + 0.004 * (size - 1), spot.p[2] - 0.02 * (size - 1)];
  const M = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2])
    .multiply(new THREE.Matrix4().makeRotationX(spot.tilt))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
    .multiply(new THREE.Matrix4().makeScale(size, size, size));
  g.bone(B.bow);
  g.save(); g.m.multiply(M); g._upd();
  const nv = bg.p.length / 3;
  for (let i = 0; i < nv; i++) g._push(bg.p[i * 3], bg.p[i * 3 + 1], bg.p[i * 3 + 2], [bg.c[i * 3], bg.c[i * 3 + 1], bg.c[i * 3 + 2]], 1);
  g.restore();
  rest.bowPos = pos;
  rest.bowSize = size;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(M);
  for (const s of bowGlints) {
    v.set(s.p[0], s.p[1], s.p[2]).applyMatrix4(M);
    const n = new THREE.Vector3(s.n[0], s.n[1], s.n[2]).applyMatrix3(nm).normalize();
    glints.push({ p: [v.x + n.x * 0.01 * size, v.y + n.y * 0.01 * size, v.z + n.z * 0.01 * size], bone: B.bow, size: s.size * (0.8 + 0.2 * size), color: s.color, rank: s.rank });
  }

  // sparkle level: how many of the glints twinkle
  const level = lookOption('sparkle', look.sparkle).level;
  let chosen = [];
  if (level > 0) {
    const max = level === 1 ? (quality === 'low' ? 4 : 7) : quality === 'low' ? 10 : 22;
    const ordered = glints.map((s, i) => ({ s, i, k: (s.rank === undefined ? 1 : s.rank) + hash(i * 17 + seed) * 0.9 })).sort((a, b) => a.k - b.k);
    chosen = ordered.slice(0, max).map((o) => o.s);
    if (level === 2) chosen.forEach((s) => { s.size *= 1.25; });
    if (lookOption('sparkle', look.sparkle).gold) chosen.forEach((s, i) => { s.color = i % 3 === 2 ? 0xffffff : 0xffc94a; s.size *= 1.1; });
  }

  // anchors (bind pose)
  rest.anchors = {
    handL: [RIG.shoulderX, RIG.fistY, 0.006],
    handR: [-RIG.shoulderX, RIG.fistY, 0.006],
    head: [0, HC[1] + HR + 0.03, HC[2] - 0.02],
    back: [0, 0.9, -0.085],
  };

  const body = g.build();
  body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2);
  const glintGeo = buildGlintGeometry(chosen.map((s) => ({ p: s.p, bone: s.bone, size: 0.026 * s.size, color: s.color })), seed);
  return { body, glints: glintGeo, rest, tris: g.tris };
}
