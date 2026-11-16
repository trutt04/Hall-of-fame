// The ground of League World: an analytic hillside sampled into a height grid, one merged
// vertex-colored ground mesh (plus a coarse outskirts mesh and a ring of far hills), pavement
// decals (Boulevard, plaza, fountain circle, cul-de-sac, lane, driveways), yard pads per lot,
// the landfill fence and a little instanced filler.
//
//   const terrain = createTerrain(layout, { quality })
//   terrain.heightAt(x, z)        walkable height (ground + bumps), fast
//   terrain.groundAt(x, z)        ground only
//   terrain.zoneAt(x, z, out?)    { hill, heights, plaza, bubble, park, dump } summing to 1
//   terrain.addGroundBump(fn, { x, z, r, tag })   fn(x, z) -> meters above the ground (>= 0)

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { clamp, lerp, smoothstep, valueNoise2, mulberry32, TAU } from '../core/util.js';
import { rectDistance, ROAD_WIDTH } from './layout.js';

const CELL = 3; // core grid cell, meters
const COARSE = 24; // outskirts cell, a multiple of CELL
const PAD_FLAT = 3; // every lot is flat this far beyond its rectangle
const PAD_BLEND = 4.5;

const LIFT = { pad: 0.035, path: 0.05, road: 0.07, paving: 0.09 };

const C = (hex) => new THREE.Color(hex);

const GROUND = {
  grass: {
    hill: C(PALETTE.hill.grass), heights: C(PALETTE.heights.grass), plaza: C(PALETTE.plaza.grass),
    bubble: C(PALETTE.bubble.grass), park: C(PALETTE.park.grass), dump: C(PALETTE.dump.grass),
  },
  cliff: {
    hill: C(0xc4ae86), heights: C(0xb9a47f), plaza: C(0xa3936f),
    bubble: C(0xa39472), park: C(0x7d6c50), dump: C(0x4c463a),
  },
  dirt: C(PALETTE.park.path),
  mud: C(PALETTE.dump.path),
  sludge: C(0x66763a),
  verge: C(0xb7b074),
  forest: C(0x3d7a4b),
  farHill: C(0x5d8a78),
  farHill2: C(0x86a7a8),
};

// A triangle soup with per-face colors, turned into one non-indexed (so flat-shaded) geometry.
class Soup {
  constructor() {
    this.p = [];
    this.c = [];
  }

  // Adds a triangle wound so that it faces up.
  tri(a, b, c, col) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny < 0) {
      const t = b;
      b = c;
      c = t;
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.c.push(col.r, col.g, col.b, col.r, col.g, col.b, col.r, col.g, col.b);
  }

  // Triangle with the winding exactly as given (for walls, fences, far hills).
  triRaw(a, b, c, col) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.c.push(col.r, col.g, col.b, col.r, col.g, col.b, col.r, col.g, col.b);
  }

  quad(a, b, c, d, col) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  get triangles() {
    return this.p.length / 9;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function createTerrain(layout, opts = {}) {
  const quality = opts.quality === 'low' ? 'low' : 'high';
  const bounds = layout.bounds;
  const { fenceZ, plaza, fountain, bulb, dump } = layout.stations;
  const weightsAt = layout.zones.weightsAt;
  const zoneKeys = layout.zones.keys;

  // ------------------------------------------------------------------ analytic height
  const corridors = layout.pads.corridors.map((c) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of c.pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    return Object.assign({}, c, { minX: minX - c.blend, maxX: maxX + c.blend, minZ: minZ - c.blend, maxZ: maxZ + c.blend });
  });
  const discs = layout.pads.discs;
  const rects = layout.pads.rects.map((r) => Object.assign({ rad: Math.hypot(r.w, r.d) / 2 }, r));

  const near = { d: 0, y: 0 };
  function nearestOnCorridor(c, x, z) {
    const pts = c.pts;
    let best = Infinity;
    let by = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0];
      const az = pts[i][1];
      const bx = pts[i + 1][0] - ax;
      const bz = pts[i + 1][1] - az;
      const l2 = bx * bx + bz * bz;
      let t = l2 > 0 ? ((x - ax) * bx + (z - az) * bz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + bx * t);
      const dz = z - (az + bz * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        by = c.ys[i] + (c.ys[i + 1] - c.ys[i]) * t;
      }
    }
    near.d = Math.sqrt(best);
    near.y = by;
    return near;
  }

  // info (optional) receives { road: distance to the nearest street, lot: rect index or -1 }.
  function analytic(x, z, info) {
    let h = layout.baseY(x, z);
    const ax = Math.abs(x);
    const amp = 0.4 + 1.5 * smoothstep(52, 95, ax) + 1.4 * smoothstep(bounds.maxZ - 4, bounds.maxZ + 40, z) + 1.4 * smoothstep(-bounds.minZ - 4, -bounds.minZ + 40, -z);
    h += (valueNoise2(x * 0.045 + 11.3, z * 0.045 + 4.7) - 0.5) * 2 * amp;
    h += (valueNoise2(x * 0.12 + 3.1, z * 0.12 + 9.2) - 0.5) * 0.6 * amp;

    let lot = -1;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const dx = x - r.x;
      const dz = z - r.z;
      const reach = r.rad + PAD_FLAT + PAD_BLEND;
      if (dx * dx + dz * dz > reach * reach) continue;
      const d = rectDistance(x, z, r);
      if (d < PAD_FLAT + PAD_BLEND) h = lerp(h, r.y, 1 - smoothstep(PAD_FLAT, PAD_FLAT + PAD_BLEND, d));
      if (d === 0) lot = i;
    }
    let road = Infinity;
    for (const c of corridors) {
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      const n = nearestOnCorridor(c, x, z);
      if (n.d - c.half < road) road = n.d - c.half;
      if (n.d < c.blend) h = lerp(h, n.y, 1 - smoothstep(c.flat, c.blend, n.d));
    }
    for (const d of discs) {
      const dist = Math.hypot(x - d.x, z - d.z);
      if (dist < d.r + d.blend) h = lerp(h, d.y, 1 - smoothstep(d.r, d.r + d.blend, dist));
      if (dist <= d.r) {
        h = d.y;
        if (dist - d.r + 1 < road) road = dist - d.r + 1;
      }
    }
    if (lot >= 0) h = rects[lot].y;
    if (info) {
      info.road = road;
      info.lot = lot;
    }
    return h;
  }

  // ------------------------------------------------------------------ height grid (core)
  const X0 = -96;
  const X1 = 96;
  const Z0 = -Math.ceil((-bounds.minZ + 14) / COARSE) * COARSE;
  const Z1 = Math.ceil((bounds.maxZ + 14) / COARSE) * COARSE;
  const NX = Math.round((X1 - X0) / CELL);
  const NZ = Math.round((Z1 - Z0) / CELL);
  const H = new Float32Array((NX + 1) * (NZ + 1));
  const ROADD = new Float32Array((NX + 1) * (NZ + 1));
  const LOT = new Int16Array((NX + 1) * (NZ + 1));
  const idx = (i, j) => j * (NX + 1) + i;
  {
    const info = { road: 0, lot: -1 };
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const k = idx(i, j);
        H[k] = analytic(X0 + i * CELL, Z0 + j * CELL, info);
        ROADD[k] = info.road;
        LOT[k] = info.lot;
      }
    }
    // Border vertices sit on straight lines between the coarse outskirts corners, so the two
    // meshes meet without cracks.
    const step = COARSE / CELL;
    const edge = (i0, j0, di, dj, count) => {
      for (let n = 0; n < count; n += step) {
        const a = H[idx(i0 + di * n, j0 + dj * n)];
        const b = H[idx(i0 + di * (n + step), j0 + dj * (n + step))];
        for (let m = 1; m < step; m++) H[idx(i0 + di * (n + m), j0 + dj * (n + m))] = lerp(a, b, m / step);
      }
    };
    edge(0, 0, 1, 0, NX);
    edge(0, NZ, 1, 0, NX);
    edge(0, 0, 0, 1, NZ);
    edge(NX, 0, 0, 1, NZ);
  }

  function gridHeight(x, z) {
    const fx = (x - X0) / CELL;
    const fz = (z - Z0) / CELL;
    if (!(fx >= 0 && fz >= 0 && fx < NX && fz < NZ)) return analytic(x, z);
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const k = j * (NX + 1) + i;
    const h00 = H[k];
    const h10 = H[k + 1];
    const h01 = H[k + NX + 1];
    const h11 = H[k + NX + 2];
    if (((i + j) & 1) === 0) {
      return v >= u ? h00 + (h01 - h00) * v + (h11 - h01) * u : h00 + (h10 - h00) * u + (h11 - h10) * v;
    }
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  function gridSample(arr, x, z) {
    const i = clamp(Math.round((x - X0) / CELL), 0, NX);
    const j = clamp(Math.round((z - Z0) / CELL), 0, NZ);
    return arr[idx(i, j)];
  }

  function groundAt(x, z) {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const dx = x - r.x;
      const dz = z - r.z;
      if (dx * dx + dz * dz < r.rad * r.rad && rectDistance(x, z, r) === 0) return r.y;
    }
    return gridHeight(x, z);
  }

  // ------------------------------------------------------------------ bumps (stage 2 art)
  const bumps = [];
  function addGroundBump(fn, o = {}) {
    const bump = { fn, x: o.x ?? 0, z: o.z ?? 0, r: o.r ?? Infinity, tag: o.tag ?? null };
    bumps.push(bump);
    return bump;
  }
  function removeGroundBump(tagOrBump) {
    for (let i = bumps.length - 1; i >= 0; i--) {
      if (bumps[i] === tagOrBump || (bumps[i].tag !== null && bumps[i].tag === tagOrBump)) bumps.splice(i, 1);
    }
  }
  function heightAt(x, z) {
    let h = groundAt(x, z);
    if (bumps.length) {
      let extra = 0;
      for (let i = 0; i < bumps.length; i++) {
        const b = bumps[i];
        if (b.r !== Infinity) {
          const dx = x - b.x;
          const dz = z - b.z;
          if (dx * dx + dz * dz > b.r * b.r) continue;
        }
        const e = b.fn(x, z);
        if (e > extra) extra = e;
      }
      h += extra;
    }
    return h;
  }

  function zoneAt(x, z, out) {
    return weightsAt(x, z, out || {});
  }
  const _zw = {};
  function dominantZone(x, z) {
    weightsAt(x, z, _zw);
    let best = zoneKeys[0];
    for (const k of zoneKeys) if (_zw[k] > _zw[best]) best = k;
    return best;
  }

  // March a ray down onto the walkable surface. Returns a Vector3 or null.
  function raycastGround(origin, dir, maxDist = 500, target = new THREE.Vector3()) {
    let t = 0;
    let prevT = 0;
    let prevAbove = origin.y - heightAt(origin.x, origin.z);
    if (prevAbove < 0) return null;
    for (let n = 0; n < 220 && t < maxDist; n++) {
      t += clamp(prevAbove * 0.55, 0.4, 14);
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const above = y - heightAt(x, z);
      if (above <= 0) {
        let a = prevT;
        let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          if (origin.y + dir.y * m - heightAt(origin.x + dir.x * m, origin.z + dir.z * m) > 0) a = m;
          else b = m;
        }
        const m = (a + b) / 2;
        return target.set(origin.x + dir.x * m, heightAt(origin.x + dir.x * m, origin.z + dir.z * m), origin.z + dir.z * m);
      }
      if (dir.y >= 0 && above > 60) return null;
      prevT = t;
      prevAbove = above;
    }
    return null;
  }

  // ------------------------------------------------------------------ ground meshes
  const group = new THREE.Group();
  group.name = 'terrain';
  const rng = mulberry32(90210);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const col = new THREE.Color();
  const zw = {};

  function groundColor(cx, cz, ny, rd, out) {
    weightsAt(cx, cz, zw);
    out.setRGB(0, 0, 0);
    let cr = 0;
    let cg = 0;
    let cb = 0;
    for (const k of zoneKeys) {
      const w = zw[k];
      if (w <= 0) continue;
      out.r += GROUND.grass[k].r * w;
      out.g += GROUND.grass[k].g * w;
      out.b += GROUND.grass[k].b * w;
      cr += GROUND.cliff[k].r * w;
      cg += GROUND.cliff[k].g * w;
      cb += GROUND.cliff[k].b * w;
    }
    const macro = valueNoise2(cx * 0.06 + 20, cz * 0.06 + 5);
    out.multiplyScalar(0.88 + 0.24 * macro);
    const dirtN = valueNoise2(cx * 0.11 + 40, cz * 0.11 + 17);
    const dirt = zw.park * smoothstep(0.4, 0.6, dirtN) * 0.85 + zw.bubble * smoothstep(0.66, 0.82, dirtN) * 0.3 + zw.dump * 0.3;
    if (dirt > 0) out.lerp(GROUND.dirt, Math.min(1, dirt));
    if (cz > fenceZ - 1 && Math.abs(cx) < 74) {
      const mud = smoothstep(fenceZ - 1, fenceZ + 5, cz) * (1 - smoothstep(66, 74, Math.abs(cx)));
      out.lerp(GROUND.mud, 0.8 * mud);
      const puddle = valueNoise2(cx * 0.15 + 3, cz * 0.15 + 8);
      if (puddle < 0.34) out.lerp(GROUND.sludge, 0.75 * mud * smoothstep(0.34, 0.24, puddle));
    }
    if (rd < 3.2) out.lerp(GROUND.verge, 0.22 * (1 - smoothstep(1, 3.2, rd)) * (1 - zw.dump));
    const steep = 1 - smoothstep(0.8, 0.93, ny);
    if (steep > 0) {
      col.setRGB(cr, cg, cb);
      out.lerp(col, steep * 0.92);
    }
    const outside = Math.max(smoothstep(74, 110, Math.abs(cx)), smoothstep(bounds.maxZ, bounds.maxZ + 40, cz), smoothstep(-bounds.minZ, -bounds.minZ + 40, -cz));
    if (outside > 0) out.lerp(GROUND.forest, outside * 0.7);
    out.multiplyScalar(0.955 + 0.09 * rng());
    return out;
  }

  let groundTris = 0;
  {
    const soup = new Soup();
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    const face = (p, q, r) => {
      const ux = q[0] - p[0];
      const uy = q[1] - p[1];
      const uz = q[2] - p[2];
      const vx = r[0] - p[0];
      const vy = r[1] - p[1];
      const vz = r[2] - p[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const nyn = Math.abs(ny) / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      const cx = (p[0] + q[0] + r[0]) / 3;
      const cz = (p[2] + q[2] + r[2]) / 3;
      groundColor(cx, cz, nyn, Math.min(gridSample(ROADD, p[0], p[2]), gridSample(ROADD, q[0], q[2]), gridSample(ROADD, r[0], r[2])), col);
      soup.tri(p, q, r, col);
    };
    const P = (out, i, j) => {
      out[0] = X0 + i * CELL;
      out[1] = H[idx(i, j)];
      out[2] = Z0 + j * CELL;
      return out;
    };
    const d = [0, 0, 0];
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        P(a, i, j);
        P(b, i + 1, j);
        P(c, i, j + 1);
        P(d, i + 1, j + 1);
        if (((i + j) & 1) === 0) {
          face(a, c, d);
          face(a, d, b);
        } else {
          face(a, c, b);
          face(b, c, d);
        }
      }
    }
    // Outskirts: coarse cells out to where the far hills stand.
    const OX = 12;
    const OZ0 = Math.round((Z0 - 8 * COARSE) / COARSE);
    const OZ1 = Math.round((Z1 + 8 * COARSE) / COARSE);
    const hOut = (x, z) => (x >= X0 && x <= X1 && z >= Z0 && z <= Z1 ? gridHeight(Math.min(x, X1 - 1e-4), Math.min(z, Z1 - 1e-4)) : analytic(x, z));
    for (let jz = OZ0; jz < OZ1; jz++) {
      for (let ix = -OX; ix < OX; ix++) {
        const x0 = ix * COARSE;
        const z0 = jz * COARSE;
        if (x0 >= X0 && x0 + COARSE <= X1 && z0 >= Z0 && z0 + COARSE <= Z1) continue;
        a[0] = x0; a[2] = z0; a[1] = hOut(x0, z0);
        b[0] = x0 + COARSE; b[2] = z0; b[1] = hOut(x0 + COARSE, z0);
        c[0] = x0; c[2] = z0 + COARSE; c[1] = hOut(x0, z0 + COARSE);
        d[0] = x0 + COARSE; d[2] = z0 + COARSE; d[1] = hOut(x0 + COARSE, z0 + COARSE);
        if (((ix + jz) & 1) === 0) {
          face(a, c, d);
          face(a, d, b);
        } else {
          face(a, c, b);
          face(b, c, d);
        }
      }
    }
    const mesh = new THREE.Mesh(soup.geometry(), groundMat);
    mesh.name = 'ground';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    groundTris += soup.triangles;
  }

  // ------------------------------------------------------------------ far hills (the horizon)
  {
    const soup = new Soup();
    const ring = (count, rx, rz, depth, hMin, hMax, color, seed) => {
      const r2 = mulberry32(seed);
      const pts = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        const jitter = 0.94 + r2() * 0.12;
        const northDip = 1 - 0.3 * smoothstep(0.5, 1, -Math.sin(a)); // keep the sky clear behind the mansion
        pts.push({
          x: Math.cos(a) * rx * jitter, z: Math.sin(a) * rz * jitter,
          bx: Math.cos(a) * (rx + depth), bz: Math.sin(a) * (rz + depth),
          h: (hMin + (hMax - hMin) * r2()) * northDip,
        });
      }
      const c2 = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % count];
        const mid = { x: (p.bx + q.bx) / 2, z: (p.bz + q.bz) / 2, h: Math.max(p.h, q.h) * (1.05 + r2() * 0.25) };
        c2.copy(color).multiplyScalar(0.9 + r2() * 0.2);
        soup.triRaw([p.x, -6, p.z], [q.x, -6, q.z], [mid.x, mid.h, mid.z], c2);
        c2.copy(color).multiplyScalar(0.82 + r2() * 0.2);
        const prev = pts[(i + count - 1) % count];
        const pm = { x: (prev.bx + p.bx) / 2, z: (prev.bz + p.bz) / 2 };
        soup.triRaw([p.x, -6, p.z], [mid.x, mid.h, mid.z], [pm.x, Math.max(prev.h, p.h) * 1.1, pm.z], c2);
      }
    };
    ring(44, 250, 330, 46, 30, 52, GROUND.farHill, 11);
    ring(30, 330, 420, 60, 52, 92, GROUND.farHill2, 23);
    const mesh = new THREE.Mesh(soup.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.name = 'farHills';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    groundTris += soup.triangles;
  }

  // ------------------------------------------------------------------ pavement decals
  const decalMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3 });
  const V = (x, z, lift) => [x, groundAt(x, z) + lift, z];

  function ribbon(soup, pts, o) {
    const n = pts.length;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const half = typeof o.half === 'function' ? o.half(i) : o.half;
      rows.push(o.offsets(half).map((off) => V(p[0] - dz * off, p[1] + dx * off, o.lift)));
    }
    for (let i = 0; i < n - 1; i++) {
      if (o.skip && o.skip((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2)) continue;
      for (let s = 0; s < rows[i].length - 1; s++) {
        soup.quad(rows[i][s], rows[i][s + 1], rows[i + 1][s + 1], rows[i + 1][s], o.color(s, i));
      }
    }
  }

  function band(soup, cx, cz, r0, r1, segs, color, lift, rot = 0) {
    for (let i = 0; i < segs; i++) {
      const a0 = rot + (i / segs) * TAU;
      const a1 = rot + ((i + 1) / segs) * TAU;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const cc = typeof color === 'function' ? color(i) : color;
      if (r0 <= 0.001) soup.tri(V(cx, cz, lift), V(cx + c0 * r1, cz + s0 * r1, lift), V(cx + c1 * r1, cz + s1 * r1, lift), cc);
      else soup.quad(V(cx + c0 * r0, cz + s0 * r0, lift), V(cx + c0 * r1, cz + s0 * r1, lift), V(cx + c1 * r1, cz + s1 * r1, lift), V(cx + c1 * r0, cz + s1 * r0, lift), cc);
    }
  }

  let decalTris = 0;
  {
    const soup = new Soup();
    const roadC = C(PALETTE.road);
    const roadC2 = C(PALETTE.road).multiplyScalar(1.12);
    const lineC = C(PALETTE.roadLine);
    const edgeC = C(0x8f95a3);
    const inDisc = (x, z) => Math.hypot(x - plaza.x, z - plaza.z) < plaza.r - 0.4 || Math.hypot(x - fountain.x, z - fountain.z) < fountain.r - 0.4;
    const hw = ROAD_WIDTH / 2;

    // The Boulevard: dark asphalt, pale edge lines, dashed center line.
    ribbon(soup, layout.road, {
      half: hw, lift: LIFT.road, skip: inDisc,
      offsets: (h) => [-h, -h + 0.3, -0.16, 0.16, h - 0.3, h],
      color: (s, i) => (s === 0 || s === 4 ? edgeC : s === 2 ? (i % 2 === 0 ? lineC : roadC) : (i % 2 ? roadC : roadC2)),
    });
    // Cul-de-sac spur and bulb.
    const spur = layout.places.culdesac.spur;
    const curbB = C(PALETTE.bubble.path);
    ribbon(soup, spur, {
      half: hw, lift: LIFT.road,
      skip: (x, z) => Math.hypot(x - bulb.x, z - bulb.z) < bulb.r - 0.6,
      offsets: (h) => [-h, -h + 0.3, h - 0.3, h],
      color: (s, i) => (s === 1 ? (i % 2 ? roadC : roadC2) : curbB),
    });
    band(soup, bulb.x, bulb.z, 0, bulb.r - 0.5, 20, (i) => (i % 2 ? roadC : roadC2), LIFT.paving);
    band(soup, bulb.x, bulb.z, bulb.r - 0.5, bulb.r, 20, curbB, LIFT.paving);

    // Heights fountain circle.
    const curbH = C(PALETTE.heights.path);
    band(soup, fountain.x, fountain.z, fountain.basinR - 0.2, fountain.basinR + 0.7, 16, curbH, LIFT.paving);
    band(soup, fountain.x, fountain.z, fountain.basinR + 0.7, fountain.r - 0.7, 20, (i) => (i % 2 ? roadC : roadC2), LIFT.paving);
    band(soup, fountain.x, fountain.z, fountain.r - 0.7, fountain.r, 20, curbH, LIFT.paving);

    // Plaza paving: rings of wedges in two stone tones with gold bands.
    const stoneA = C(PALETTE.plaza.path);
    const stoneB = C(PALETTE.plaza.path).multiplyScalar(0.84);
    const stoneC = C(PALETTE.plaza.path).multiplyScalar(0.7);
    const gold = C(0xd9b24a);
    const navy = C(0x27335c);
    const R = plaza.r;
    band(soup, plaza.x, plaza.z, 0, 3.4, 12, navy, LIFT.paving);
    band(soup, plaza.x, plaza.z, 3.4, 4.1, 12, gold, LIFT.paving);
    band(soup, plaza.x, plaza.z, 4.1, R * 0.5, 12, (i) => (i % 2 ? stoneA : stoneB), LIFT.paving);
    band(soup, plaza.x, plaza.z, R * 0.5, R * 0.5 + 0.7, 24, gold, LIFT.paving);
    band(soup, plaza.x, plaza.z, R * 0.5 + 0.7, R - 1.6, 24, (i) => (i % 2 ? stoneB : stoneA), LIFT.paving, TAU / 48);
    band(soup, plaza.x, plaza.z, R - 1.6, R - 0.9, 24, navy, LIFT.paving);
    band(soup, plaza.x, plaza.z, R - 0.9, R, 24, stoneC, LIFT.paving);

    // Park lane: packed dirt, ragged edges.
    const dirtA = C(PALETTE.park.path);
    const dirtB = C(PALETTE.park.path).multiplyScalar(0.88);
    ribbon(soup, layout.places.parkLane, {
      half: (i) => 1.9 + valueNoise2(i * 0.7, 3.3) * 0.9, lift: LIFT.path,
      offsets: (h) => [-h, 0, h],
      color: (s, i) => ((s + i) % 2 ? dirtA : dirtB),
    });

    // Driveways and footpaths from each lot's curb to its street.
    const drive = (lot, half, color) => {
      const [ax, az] = lot.curb;
      const [bx, bz] = lot.street;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.4) return;
      const steps = Math.max(1, Math.ceil(len / 1.2));
      const pts = [];
      for (let i = 0; i <= steps; i++) pts.push([lerp(ax, bx, i / steps), lerp(az, bz, i / steps)]);
      ribbon(soup, pts, { half, lift: LIFT.path, offsets: (h) => [-h, 0, h], color: () => color });
    };
    const pathC = { heights: C(PALETTE.heights.path), bubble: C(PALETTE.bubble.path), park: C(PALETTE.park.path).multiplyScalar(1.1) };
    for (const lot of layout.lots.heights) drive(lot, 1.7, pathC.heights);
    for (const lot of layout.lots.bubble) drive(lot, 1.6, pathC.bubble);
    for (const lot of layout.lots.park) drive(lot, 0.9, pathC.park);
    // The Hill: a pale stone apron where the Boulevard meets the gates.
    const hillLot = layout.lots.hill[0];
    const apron = C(PALETTE.hill.path);
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI;
      const a1 = ((i + 1) / 8) * Math.PI;
      soup.tri(V(hillLot.curb[0], hillLot.curb[1], LIFT.path), V(hillLot.curb[0] + Math.cos(a0) * 8, hillLot.curb[1] + Math.sin(a0) * 5, LIFT.path), V(hillLot.curb[0] + Math.cos(a1) * 8, hillLot.curb[1] + Math.sin(a1) * 5, LIFT.path), apron);
    }
    // Where the Boulevard gives up: a splash of churned mud at the dump.
    const end = layout.road[layout.road.length - 1];
    band(soup, end[0], end[1] + 1.5, 0, 5.5, 9, C(PALETTE.dump.path).multiplyScalar(0.8), LIFT.path, 0.3);

    const mesh = new THREE.Mesh(soup.geometry(), decalMat);
    mesh.name = 'pavement';
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    decalTris = soup.triangles;
  }

  // ------------------------------------------------------------------ yard pads (one per lot)
  const lotPads = (() => {
    const soup = new Soup();
    const lawn = {
      hillA: C(0x79c95f), hillB: C(0x62b450),
      heights: C(0x78c463), bubble: C(0xb3b76c), park: C(0x94794f), dump: C(0x3f392e),
    };
    const rect = (lot, color, x0, x1, z0, z1) => {
      const c = Math.cos(lot.facing);
      const s = Math.sin(lot.facing);
      const W = (lx, lz) => [lot.x + lx * c + lz * s, lot.y + LIFT.pad, lot.z - lx * s + lz * c];
      soup.quad(W(x0, z0), W(x1, z0), W(x1, z1), W(x0, z1), color);
    };
    for (const tier of ['hill', 'heights', 'bubble', 'park']) {
      for (const lot of layout.lots[tier]) {
        if (tier === 'hill') {
          const stripes = 11;
          for (let i = 0; i < stripes; i++) rect(lot, i % 2 ? lawn.hillA : lawn.hillB, -lot.w / 2 + (lot.w / stripes) * i, -lot.w / 2 + (lot.w / stripes) * (i + 1), -lot.d / 2, lot.d / 2);
        } else {
          col.copy(lawn[tier]).multiplyScalar(0.94 + 0.12 * rng());
          rect(lot, col.clone(), -lot.w / 2, lot.w / 2, -lot.d / 2, lot.d / 2);
        }
      }
    }
    const d = layout.lots.dump[0];
    for (let i = 0; i < 14; i++) {
      const a0 = (i / 14) * TAU;
      const a1 = ((i + 1) / 14) * TAU;
      const r0 = d.r * (0.9 + 0.1 * valueNoise2(i * 1.7, 9));
      const r1 = d.r * (0.9 + 0.1 * valueNoise2(((i + 1) % 14) * 1.7, 9));
      col.copy(lawn.dump).multiplyScalar(0.9 + 0.25 * rng());
      soup.tri([d.x, d.y + LIFT.pad, d.z], [d.x + Math.cos(a0) * r0, d.y + LIFT.pad, d.z + Math.sin(a0) * r0], [d.x + Math.cos(a1) * r1, d.y + LIFT.pad, d.z + Math.sin(a1) * r1], col.clone());
    }
    const mesh = new THREE.Mesh(soup.geometry(), decalMat);
    mesh.name = 'lotPads';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    decalTris += soup.triangles;
    return mesh;
  })();

  // ------------------------------------------------------------------ landfill fence
  const fenceColliders = [];
  {
    const soup = new Soup();
    const post = C(0x7c8388);
    const rail = C(0x8b9297);
    const box = (cx, cy, cz, sx, sy, sz, color) => {
      const x0 = cx - sx / 2;
      const x1 = cx + sx / 2;
      const y0 = cy - sy / 2;
      const y1 = cy + sy / 2;
      const z0 = cz - sz / 2;
      const z1 = cz + sz / 2;
      const q = (a, b, c2, d2) => {
        soup.triRaw(a, b, c2, color);
        soup.triRaw(a, c2, d2, color);
      };
      q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
      q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
      q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
      q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
      q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    };
    const linkPos = [];
    const linkUv = [];
    const FENCE_H = 2.1;
    for (const line of layout.places.fence) {
      for (let s = 0; s < line.length - 1; s++) {
        const [ax, az] = line[s];
        const [bx, bz] = line[s + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / 4));
        fenceColliders.push({ cx: (ax + bx) / 2, cz: (az + bz) / 2, w: len, d: 0.5, rotation: -Math.atan2(bz - az, bx - ax) });
        let px = ax;
        let pz = az;
        let py = groundAt(ax, az);
        for (let i = 1; i <= n; i++) {
          const x = lerp(ax, bx, i / n);
          const z = lerp(az, bz, i / n);
          const y = groundAt(x, z);
          box(x, y + FENCE_H / 2 + 0.05, z, 0.14, FENCE_H + 0.1, 0.14, post);
          soup.triRaw([px, py + FENCE_H, pz], [x, y + FENCE_H, z], [x, y + FENCE_H - 0.09, z], rail);
          soup.triRaw([px, py + FENCE_H, pz], [x, y + FENCE_H - 0.09, z], [px, py + FENCE_H - 0.09, pz], rail);
          const u0 = ((i - 1) / n) * len * 0.5;
          const u1 = (i / n) * len * 0.5;
          linkPos.push(px, py, pz, x, y, z, x, y + FENCE_H, z, px, py, pz, x, y + FENCE_H, z, px, py + FENCE_H, pz);
          linkUv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
          px = x;
          pz = z;
          py = y;
        }
        if (s === 0) box(ax, groundAt(ax, az) + FENCE_H / 2 + 0.05, az, 0.14, FENCE_H + 0.1, 0.14, post);
      }
    }
    // Chunky gate posts either side of the Boulevard.
    const gate = layout.places.landfillGate;
    for (const side of [-1, 1]) {
      const gx = gate.x + side * gate.width / 2;
      box(gx, groundAt(gx, gate.z) + 1.6, gate.z, 0.4, 3.2, 0.4, C(0x5f666b));
      fenceColliders.push({ cx: gx, cz: gate.z, w: 0.6, d: 0.6, rotation: 0 });
    }
    const postMesh = new THREE.Mesh(soup.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    postMesh.name = 'fencePosts';
    postMesh.matrixAutoUpdate = false;
    group.add(postMesh);
    decalTris += soup.triangles;

    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 32;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 32, 32);
    g.strokeStyle = 'rgba(200,208,214,1)';
    g.lineWidth = 2.2;
    for (let i = -32; i <= 64; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 32, 32);
      g.moveTo(i + 32, 0);
      g.lineTo(i, 32);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linkPos), 3));
    lg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(linkUv), 2));
    lg.computeVertexNormals();
    const link = new THREE.Mesh(lg, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide, transparent: false }));
    link.name = 'fenceLink';
    link.matrixAutoUpdate = false;
    group.add(link);
    decalTris += linkPos.length / 9;
  }

  // ------------------------------------------------------------------ where things may be scattered
  function isClear(x, z, margin) {
    if (gridSample(ROADD, x, z) < margin + 1) return false;
    for (const r of rects) {
      const dx = x - r.x;
      const dz = z - r.z;
      const reach = r.rad + margin;
      if (dx * dx + dz * dz < reach * reach && rectDistance(x, z, r) < margin) return false;
    }
    for (const d of discs) if (Math.hypot(x - d.x, z - d.z) < d.r + margin) return false;
    for (const line of layout.places.fence) {
      for (let s = 0; s < line.length - 1; s++) {
        const [ax, az] = line[s];
        const [bx, bz] = line[s + 1];
        const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
        const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2, 0, 1);
        if (Math.hypot(x - lerp(ax, bx, t), z - lerp(az, bz, t)) < margin * 0.5 + 0.8) return false;
      }
    }
    return true;
  }

  // Suggested spots for stage 2 art (trees, bushes, trash cans). Deterministic.
  const scatterPoints = [];
  {
    const r2 = mulberry32(4242);
    const density = { hill: 0.5, heights: 0.5, plaza: 0.42, bubble: 0.3, park: 0.3, dump: 0.34 };
    const kinds = {
      hill: [['tree', 0.6], ['bush', 1]],
      heights: [['tree', 0.5], ['bush', 1]],
      plaza: [['tree', 0.7], ['bush', 1]],
      bubble: [['bush', 0.6], ['tree', 1]],
      park: [['trashcan', 0.4], ['tree', 0.75], ['bush', 1]],
      dump: [['trashcan', 0.7], ['bush', 1]],
    };
    const STEP = 9;
    for (let gz = bounds.minZ + 4; gz < bounds.maxZ - 3; gz += STEP) {
      for (let gx = bounds.minX + 4; gx < bounds.maxX - 3; gx += STEP) {
        const x = gx + (r2() - 0.5) * STEP * 0.8;
        const z = gz + (r2() - 0.5) * STEP * 0.8;
        const roll = r2();
        const pick = r2();
        const scale = 0.8 + r2() * 0.5;
        const rot = r2() * TAU;
        const zone = dominantZone(x, z);
        if (roll > density[zone]) continue;
        if (!isClear(x, z, 3.2)) continue;
        // keep the long sightline down the middle of the valley open
        if (Math.abs(x) < 9 && r2() < 0.7) continue;
        let kind = kinds[zone][kinds[zone].length - 1][0];
        for (const [k, p] of kinds[zone]) {
          if (pick <= p) {
            kind = k;
            break;
          }
        }
        scatterPoints.push({ x, z, y: groundAt(x, z), kind, zone, scale, rot, seed: (scatterPoints.length * 7919) >>> 0 });
      }
    }
  }

  // ------------------------------------------------------------------ instanced filler
  let fillerTris = 0;
  {
    const r2 = mulberry32(777);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const tint = new THREE.Color();
    const place = (count, margin, accept) => {
      const out = [];
      let guard = 0;
      while (out.length < count && guard++ < count * 30) {
        const x = lerp(bounds.minX - 12, bounds.maxX + 12, r2());
        const z = lerp(bounds.minZ - 10, bounds.maxZ + 10, r2());
        const zone = dominantZone(x, z);
        if (!accept(zone, x, z, r2())) continue;
        if (!isClear(x, z, margin)) continue;
        out.push({ x, z, y: groundAt(x, z), zone });
      }
      return out;
    };
    const build = (name, geo, mat, list, each) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.name = name;
      list.forEach((p, i) => {
        each(p, i);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      fillerTris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * list.length;
      return mesh;
    };

    // Grass tufts: three crossed blades.
    const tg = new THREE.BufferGeometry();
    const tv = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI + 0.3;
      const cx = Math.cos(a) * 0.16;
      const cz = Math.sin(a) * 0.16;
      tv.push(-cx, 0, -cz, cx, 0, cz, cx * 0.4 + 0.05, 0.42 + i * 0.07, cz * 0.4);
    }
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tv), 3));
    tg.computeVertexNormals();
    // Blades are lit as if they faced up, so both sides read the same.
    const nrm = tg.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const tuftDensity = { hill: 0.9, heights: 0.8, plaza: 0.55, bubble: 0.35, park: 0.7, dump: 0.5 };
    const tuftTint = { hill: 0x5fae4c, heights: 0x5aa64e, plaza: 0x559b4c, bubble: 0xa3a85a, park: 0xa39a4e, dump: 0x6f7340 };
    const tufts = place(quality === 'low' ? 420 : 760, 0.6, (zone, x, z, roll) => roll < tuftDensity[zone]);
    build('tufts', tg, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), tufts, (p) => {
      pos.set(p.x, p.y - 0.02, p.z);
      e.set(0, r2() * TAU, 0);
      q.setFromEuler(e);
      const s = 0.8 + r2() * 0.9;
      scl.set(s, s * (0.8 + r2() * 0.6), s);
      tint.setHex(tuftTint[p.zone]).multiplyScalar(0.85 + r2() * 0.3);
    });

    // Rocks: more of them as the neighborhoods get worse.
    const rg = new THREE.IcosahedronGeometry(0.5, 0);
    const rockDensity = { hill: 0.15, heights: 0.2, plaza: 0.2, bubble: 0.25, park: 0.75, dump: 1 };
    const rockTint = { hill: 0xcdbb98, heights: 0xb9ad98, plaza: 0xa7a394, bubble: 0xa89f88, park: 0x857a66, dump: 0x56544a };
    const rocks = place(quality === 'low' ? 60 : 120, 1.4, (zone, x, z, roll) => roll < rockDensity[zone]);
    build('rocks', rg, new THREE.MeshLambertMaterial({ flatShading: true }), rocks, (p) => {
      const s = 0.35 + r2() * r2() * 1.5;
      pos.set(p.x, p.y + s * 0.12, p.z);
      e.set(r2() * 0.6, r2() * TAU, r2() * 0.6);
      q.setFromEuler(e);
      scl.set(s * (0.8 + r2() * 0.6), s * (0.5 + r2() * 0.4), s * (0.8 + r2() * 0.6));
      tint.setHex(rockTint[p.zone]).multiplyScalar(0.85 + r2() * 0.3);
    });

    // Flowers: only where life is good.
    const fg = new THREE.OctahedronGeometry(0.11, 0);
    const flowerDensity = { hill: 1, heights: 0.75, plaza: 0.4, bubble: 0.06, park: 0, dump: 0 };
    const petals = { hill: [0xf5c542, 0xffffff, 0xffe9a0], heights: [0xff8fab, 0xffffff, 0x9fd0ff], plaza: [0xffffff, 0xf5c542], bubble: [0xefe6d0] };
    const flowers = place(quality === 'low' ? 110 : 230, 0.8, (zone, x, z, roll) => roll < flowerDensity[zone] && Math.abs(x) < 70);
    build('flowers', fg, new THREE.MeshLambertMaterial({ flatShading: true }), flowers, (p) => {
      pos.set(p.x, p.y + 0.16, p.z);
      e.set(0, r2() * TAU, 0);
      q.setFromEuler(e);
      const s = 0.8 + r2() * 0.8;
      scl.set(s, s * 0.7, s);
      const set = petals[p.zone] || petals.plaza;
      tint.setHex(set[Math.floor(r2() * set.length)]);
    });
  }

  return {
    group,
    layout,
    bounds,
    heightAt,
    groundAt,
    analyticAt: analytic,
    zoneAt,
    dominantZone,
    addGroundBump,
    removeGroundBump,
    raycastGround,
    isClear,
    scatterPoints,
    fenceColliders,
    lotPads,
    triangles: { ground: groundTris, decals: decalTris, filler: fillerTris },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      if (group.parent) group.parent.remove(group);
    },
  };
}
