// Small shared helpers for the art builders: seeded random, reduced motion, shared FX bits.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU } from './geo.js';
import { blobMat, addMat } from './materials.js';

// ---- reduced motion -------------------------------------------------------------------------
let reduced = false;
export function setReducedMotion(on) { reduced = !!on; }
export function isReducedMotion() { return reduced; }
// Multiply flicker and bobbing amplitudes by this.
export function motion() { return reduced ? 0.12 : 1; }

// ---- seeded random --------------------------------------------------------------------------
export function rng(seed) {
  let s = (seed | 0) + 0x6d2b79f5 | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
export const range = (r, a, b) => a + (b - a) * r();

// Cheap smooth noise in 0..1 for flicker (no allocation).
export function flick(t, seed = 0) {
  return 0.5 + 0.25 * Math.sin(t * 13.7 + seed) + 0.15 * Math.sin(t * 31.3 + seed * 2.1) + 0.1 * Math.sin(t * 57.9 + seed * 0.7);
}
// Stepped random 0..1 that changes `rate` times a second (failing neon, lightning).
export function stepRand(t, rate, seed = 0) {
  let n = Math.floor(t * rate) + seed * 7919;
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

// ---- blob shadow ----------------------------------------------------------------------------
let blobGeo = null;
export function getBlobGeo() {
  if (blobGeo) return blobGeo;
  const g = new Geo({ alpha: true });
  const seg = 14;
  for (let i = 0; i < seg; i++) {
    const a0 = (TAU * i) / seg, a1 = (TAU * (i + 1)) / seg;
    const p0 = [Math.cos(a0), 0, Math.sin(a0)], p1 = [Math.cos(a1), 0, Math.sin(a1)];
    const m0 = [p0[0] * 0.55, 0, p0[2] * 0.55], m1 = [p1[0] * 0.55, 0, p1[2] * 0.55];
    g.triG([0, 0, 0], m1, m0, 0x000000, 0x000000, 0x000000, 0.42, 0.34, 0.34);
    g.triG(m0, m1, p1, 0x000000, 0x000000, 0x000000, 0.34, 0.34, 0);
    g.triG(m0, p1, p0, 0x000000, 0x000000, 0x000000, 0.34, 0, 0);
  }
  blobGeo = g.build();
  blobGeo.userData.shared = true;
  return blobGeo;
}
// A soft dark oval on the ground. Shares one geometry and one material.
export function makeBlob(rx, rz = rx, y = 0.04) {
  const m = new THREE.Mesh(getBlobGeo(), blobMat);
  m.scale.set(rx, 1, rz);
  m.position.y = y;
  m.renderOrder = 1;
  m.name = 'blob';
  return m;
}

// ---- glow shapes (drawn into an alpha Geo used with addMat) -----------------------------------
// Two nested faceted shells: a chunky low-poly halo with no camera-facing tricks.
export function halo(g, x, y, z, r, hex, a = 0.35, detail = 1) {
  const sa = g.a;
  g.a = a; g.ico(x, y, z, r * 0.5, hex, { detail: 0 });
  g.a = a * 0.45; g.ico(x, y, z, r, hex, { detail });
  g.a = sa;
  return g;
}
// A light cone (apex at the origin of the current transform, opening along -Y by default).
export function beam(g, r0, r1, len, hex, a0 = 0.5, a1 = 0, seg = 10) {
  for (let i = 0; i < seg; i++) {
    const b0 = (TAU * i) / seg, b1 = (TAU * (i + 1)) / seg;
    const A = [r0 * Math.cos(b0), 0, r0 * Math.sin(b0)], B = [r0 * Math.cos(b1), 0, r0 * Math.sin(b1)];
    const C = [r1 * Math.cos(b1), len, r1 * Math.sin(b1)], D = [r1 * Math.cos(b0), len, r1 * Math.sin(b0)];
    g.triG(A, B, C, hex, hex, hex, a0, a0, a1);
    g.triG(A, C, D, hex, hex, hex, a0, a1, a1);
  }
  return g;
}
// A four-point star made of two crossed flat diamonds (readable from any side).
export function star(g, x, y, z, s, hex, a = 1) {
  const sa = g.a; g.a = a;
  const t = s * 0.16;
  g.at(x, y, z);
  for (let k = 0; k < 2; k++) {
    g.tri2([-t, 0, 0], [t, 0, 0], [0, s, 0], hex).tri2([-t, 0, 0], [0, -s, 0], [t, 0, 0], hex);
    g.tri2([0, -t, 0], [s, 0, 0], [0, t, 0], hex).tri2([0, -t, 0], [0, t, 0], [-s, 0, 0], hex);
    g.rotY(Math.PI / 2);
  }
  g.restore(); g.a = sa;
  return g;
}

// Twinkling stars: one additive mesh, each star's alpha is animated in place.
// points: [[x, y, z, size], ...]. Returns { mesh, update(t) }.
export function makeSparkles(points, hex = 0xfff6c8, rate = 2.3) {
  const g = new Geo({ alpha: true }), ranges = [];
  for (const p of points) {
    const s = g.p.length / 3;
    star(g, p[0], p[1], p[2], p[3], hex, 1);
    ranges.push(s, g.p.length / 3);
  }
  const geo = g.build(), mesh = new THREE.Mesh(geo, addMat), col = geo.attributes.color;
  col.setUsage(THREE.DynamicDrawUsage);
  mesh.name = 'sparkles';
  return {
    mesh,
    update(t) {
      const m = reduced ? 0.25 : 1;
      for (let i = 0; i < ranges.length; i += 2) {
        const w = Math.max(0, Math.sin(t * rate + i * 1.7));
        const a = reduced ? 0.45 : w * w * w * m;
        for (let v = ranges[i]; v < ranges[i + 1]; v++) col.array[v * 4 + 3] = a;
      }
      col.needsUpdate = true;
    },
  };
}

// A 1 x 1 white texture so `.material.map = yourTexture` works without a shader rebuild.
export function blankTexture(hex = 0xffffff) {
  const t = new THREE.DataTexture(new Uint8Array([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---- instanced particles ---------------------------------------------------------------------
// One InstancedMesh, positions and scales written straight into the matrix buffer.
export function makeParticles(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  const a = mesh.instanceMatrix.array;
  a.fill(0);
  for (let i = 0; i < count; i++) a[i * 16 + 15] = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return {
    mesh,
    count,
    // translation + scale only (no rotation): zero allocation.
    set(i, x, y, z, sx, sy = sx, sz = sx) {
      const o = i * 16;
      a[o] = sx; a[o + 5] = sy; a[o + 10] = sz; a[o + 12] = x; a[o + 13] = y; a[o + 14] = z;
    },
    // translation + yaw + scale.
    setYaw(i, x, y, z, yaw, sx, sy = sx, sz = sx) {
      const o = i * 16, c = Math.cos(yaw), s = Math.sin(yaw);
      a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx;
      a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0;
      a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z;
    },
    commit() { mesh.instanceMatrix.needsUpdate = true; },
  };
}

// ---- textures --------------------------------------------------------------------------------
export function toTexture(src) {
  if (src && src.isTexture) return { tex: src, own: false };
  const tex = new THREE.CanvasTexture(src);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, own: true };
}
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---- prop plumbing ---------------------------------------------------------------------------
// own: geometries / materials / textures this prop created (shared ones are skipped).
export function makeProp(group, own = [], update = null, extra = null) {
  const prop = {
    group,
    dispose() {
      for (const o of own) if (o && o.dispose && !(o.userData && o.userData.shared)) o.dispose();
      own.length = 0;
    },
  };
  if (update) prop.update = update;
  if (extra) Object.assign(prop, extra);
  return prop;
}

// Build a mesh from a Geo and remember its geometry for dispose.
export function addMesh(group, geo, material, own, name) {
  const mesh = geo.mesh(material);
  if (name) mesh.name = name;
  group.add(mesh);
  if (own) own.push(mesh.geometry);
  return mesh;
}

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
