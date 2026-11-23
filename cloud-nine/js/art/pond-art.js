// The duck pond's art (the plan is js/art/island-layout.js makePond): pastel water in soft bands, a
// ring of smooth stones, lily pads with pink flowers, reeds and cattails, a little wooden dock with a
// pink rope rail, a bench, and a sign whose face is a canvas ("Duck Pond", or the gift link's name).
//
//   const art = buildPondArt(pond, { quality, name })
//   art.group                 add to the scene; everything is in world coordinates
//   art.update(dt, t)         the shimmer on the water (nothing allocated)
//   art.setName(name)         re-draws the sign's face
//   art.ripples / art.crumbs / art.hearts   instanced pools for js/world/pond.js:
//       { mesh, max, set(i, x, y, z, scale, fade 0..1 | yaw, hex?), hide(i), commit() }
//   art.water                 the water's mesh (tapping it walks her over to feed the ducks)
//   art.triangles, art.drawCalls, art.dispose()
//
// Draw calls: the static pond (1), the shimmer (1), the sign's face (1), the ripples, crumbs and
// hearts (1 each) = 6. The ducks (js/art/duck.js) add 3.

import * as THREE from '../../lib/three.module.min.js';
import { FONT_STACK } from '../config.js';
import { Geo } from './geo.js';
import { flatMat, makeAddMaterial } from './materials.js';
import { motion } from './util.js';
import { toWorld, POND } from './island-layout.js';

const TAU = Math.PI * 2;
const WATER = [0x74c6e8, 0x8ad6f0, 0xa9e6f5]; // deep, middle, shallow
const STONES = [0xe9e3f2, 0xf4dde8, 0xdbe6f3, 0xf1ebdf, 0xe3dcea];
const WOOD = [0xe2b48b, 0xd6a47c, 0xebc29c];
const ROPE = 0xff8cc6;
const LEAF = [0x8fd18a, 0x7cc47a, 0x9bdb93];

// The water's wobbly edge: a radius at angle a (radians round the pond), the same everywhere.
export function waterEdge(pond, a) {
  return pond.r * (1 + 0.035 * Math.sin(2 * a + 0.9) + 0.025 * Math.sin(3 * a + 2.3));
}

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function buildStatic(pond, q) {
  const g = new Geo();
  g.jit = 0.03;
  const rnd = seeded(4242);
  const W = pond.water;
  const Y = pond.y;
  const at = (lx, lz) => toWorld(pond, lx, lz);
  const SEG = 28;
  // the shore: a pale pebble ring the grass meets
  for (let i = 0; i < SEG; i++) {
    const a0 = ((i + 1) / SEG) * TAU; // this way round, the faces look up
    const a1 = (i / SEG) * TAU;
    const r0 = waterEdge(pond, a0);
    const r1 = waterEdge(pond, a1);
    const p = (a, r) => { const [x, z] = at(Math.sin(a) * r, Math.cos(a) * r); return [x, Y + 0.05, z]; };
    g.quad(p(a0, r0 - 0.1), p(a1, r1 - 0.1), p(a1, r1 + 1.05), p(a0, r0 + 1.05), i % 2 ? 0xf3e8da : 0xefe3d6);
  }
  // the water: bands from deep in the middle to shallow at the edge
  const ring = [0, 0.42, 0.74, 1];
  for (let i = 0; i < SEG; i++) {
    const a0 = ((i + 1) / SEG) * TAU;
    const a1 = (i / SEG) * TAU;
    const e0 = waterEdge(pond, a0);
    const e1 = waterEdge(pond, a1);
    const p = (a, r) => { const [x, z] = at(Math.sin(a) * r, Math.cos(a) * r); return [x, W, z]; };
    for (let k = 0; k < 3; k++) {
      const A = p(a0, e0 * ring[k]);
      const B = p(a1, e1 * ring[k]);
      const C = p(a1, e1 * ring[k + 1]);
      const D = p(a0, e0 * ring[k + 1]);
      if (k === 0) g.tri(A, C, D, WATER[0]);
      else g.quad(D, A, B, C, WATER[k]);
    }
  }
  // smooth stones round the edge (not where the dock goes in)
  const half = POND.dockW / 2;
  const nStones = q === 'low' ? 22 : 32;
  for (let i = 0; i < nStones; i++) {
    const a = (i / nStones) * TAU + (rnd() - 0.5) * 0.12;
    const R = waterEdge(pond, a) + 0.22 + rnd() * 0.2;
    const lx = Math.sin(a) * R;
    const lz = Math.cos(a) * R;
    if (lz > 0 && Math.abs(lx) < half + 0.25) continue;
    const [x, z] = at(lx, lz);
    const s = 0.24 + rnd() * 0.2;
    g.ico(x, Y + s * 0.25, z, s, STONES[i % STONES.length], { sy: 0.55, sx: 1 + rnd() * 0.3, ry: rnd() * TAU, jitter: 0.12, rnd, flat: 0.4 });
  }
  // lily pads (pond-local polar spots), some with a pink flower
  const pads = [[2.4, 2.6, 0.42, 1], [2.9, 2.1, 0.36, 0], [3.6, 2.9, 0.3, 0], [4.1, 1.9, 0.4, 1], [1.2, 3.1, 0.34, 0], [5.0, 2.8, 0.38, 0], [0.6, 2.4, 0.3, 1]];
  pads.forEach(([a, r, s, flower], i) => {
    const [x, z] = at(Math.sin(a) * r, Math.cos(a) * r);
    g.at(x, W + 0.015, z, a * 3 + i, 0, 0);
    const n = 9;
    for (let k = 1; k < n; k++) {
      const b0 = (k / n) * TAU;
      const b1 = ((k + 1) / n) * TAU;
      g.tri([0, 0, 0], [Math.sin(b0) * s, 0, Math.cos(b0) * s], [Math.sin(b1) * s, 0, Math.cos(b1) * s], LEAF[i % 3]);
    }
    g.restore();
    if (flower) {
      g.at(x + 0.05, W + 0.02, z - 0.04, i, 0, 0);
      for (let k = 0; k < 5; k++) {
        const b = (k / 5) * TAU;
        const tip = [Math.sin(b) * 0.17, 0.13, Math.cos(b) * 0.17];
        g.tri([Math.sin(b - 0.5) * 0.05, 0.02, Math.cos(b - 0.5) * 0.05], [Math.sin(b + 0.5) * 0.05, 0.02, Math.cos(b + 0.5) * 0.05], tip, k % 2 ? 0xffb3d9 : 0xffc9e4);
        g.tri([Math.sin(b + 0.5) * 0.05, 0.02, Math.cos(b + 0.5) * 0.05], [Math.sin(b - 0.5) * 0.05, 0.02, Math.cos(b - 0.5) * 0.05], tip, 0xff9ccb);
      }
      g.ico(0, 0.07, 0, 0.045, 0xffe066, {});
      g.restore();
    }
  });
  // reeds and cattails in clumps on the far shores
  const clumps = q === 'low' ? [2.0, 3.0, 3.7] : [1.6, 2.3, 3.0, 3.6, 4.3];
  clumps.forEach((a, ci) => {
    const R = waterEdge(pond, a) + 0.15;
    const [cx, cz] = at(Math.sin(a) * R, Math.cos(a) * R);
    for (let k = 0; k < 6; k++) {
      const b = rnd() * TAU;
      const d = rnd() * 0.35;
      const x = cx + Math.sin(b) * d;
      const z = cz + Math.cos(b) * d;
      const h = 0.7 + rnd() * 0.6;
      const lean = (rnd() - 0.5) * 0.5;
      const yaw = rnd() * TAU;
      g.at(x, Y, z, yaw, lean, 0);
      g.tri([-0.04, 0, 0], [0.04, 0, 0], [0.01, h, 0.02], LEAF[(k + ci) % 3]);
      g.tri([0.04, 0, 0], [-0.04, 0, 0], [0.01, h, 0.02], 0x84c77d);
      if (k % 3 === 0) {
        g.cyl(0.01, h * 0.62, 0.015, 0.045, 0.22, 0xa9745a, { seg: 5, rt: 0.04, top: 0x9a6650 });
        g.cyl(0.01, h * 0.62 + 0.22, 0.015, 0.012, 0.12, 0x84c77d, { seg: 3, rt: 0.004, top: false });
      }
      g.restore();
    }
  });
  // the dock: planks across a deck, posts, and a pink rope rail on both sides and across the end
  const d = pond.dock;
  const dy = d.y;
  const dk = (lx, lz) => toWorld(d, lx, lz);
  const nPl = Math.round(d.d / 0.34);
  for (let i = 0; i < nPl; i++) {
    const lz = -d.d / 2 + (i + 0.5) * (d.d / nPl);
    const [x, z] = dk(0, lz);
    g.box(x, dy - 0.07, z, d.w, 0.07, d.d / nPl - 0.04, WOOD[i % 3], { ry: d.facing });
  }
  for (const side of [-1, 1]) {
    const [x, z] = dk(side * (d.w / 2 - 0.06), 0);
    g.box(x, dy - 0.16, z, 0.1, 0.1, d.d, 0xc89670, { ry: d.facing });
  }
  const posts = [];
  for (const side of [-1, 1]) {
    for (const lz of [-d.d / 2 + 0.08, 0, d.d / 2 - 0.12]) {
      const [x, z] = dk(side * (d.w / 2 + 0.02), lz);
      g.cyl(x, Y - 0.15, z, 0.075, dy - Y + 0.15 + 0.42, 0xd2a07a, { seg: 6, top: 0xf2c9a6 });
      posts.push([x, dy + 0.38, z, side, lz]);
    }
  }
  const rope = (p0, p1) => {
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      pts.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - Math.sin(Math.PI * t) * 0.09, p0[2] + (p1[2] - p0[2]) * t]);
    }
    g.tube(pts, 0.025, ROPE, { seg: 4 });
  };
  for (const side of [-1, 1]) {
    const ps = posts.filter((p) => p[3] === side);
    for (let i = 0; i < ps.length - 1; i++) rope(ps[i], ps[i + 1]);
  }
  rope(posts[0], posts[3]); // across the end, over the water
  // the bench on the north shore, looking at the water (and the falls)
  {
    const b = pond.bench;
    const by = Y;
    const bw = (lx, lz) => toWorld(b, lx, lz);
    for (const sx of [-0.7, 0.7]) {
      const [x, z] = bw(sx, 0);
      g.box(x, by, z, 0.12, 0.42, 0.5, 0xb98fd6, { ry: b.facing });
      const [x2, z2] = bw(sx, -0.22);
      g.box(x2, by + 0.42, z2, 0.1, 0.5, 0.08, 0xb98fd6, { ry: b.facing });
    }
    for (let k = 0; k < 3; k++) {
      const [x, z] = bw(0, 0.16 - k * 0.16);
      g.box(x, by + 0.42, z, 1.75, 0.06, 0.14, WOOD[k], { ry: b.facing });
    }
    for (let k = 0; k < 2; k++) {
      const [x, z] = bw(0, -0.24);
      g.box(x, by + 0.6 + k * 0.2, z, 1.75, 0.13, 0.05, WOOD[(k + 1) % 3], { ry: b.facing, rx: -0.12 });
    }
  }
  // the sign: two posts, a cream board with a pink edge, a little heart on top
  {
    const s = pond.sign;
    const sw = (lx, lz) => toWorld(s, lx, lz);
    for (const sx of [-0.72, 0.72]) {
      const [x, z] = sw(sx, -0.04);
      g.cyl(x, Y - 0.1, z, 0.06, 1.95, 0xd2a07a, { seg: 6, top: 0xf2c9a6 });
    }
    const [x, z] = sw(0, -0.06);
    g.box(x, Y + 1.0, z, 1.86, 0.98, 0.1, 0xff9ccb, { ry: s.facing });
    const [hx, hz] = sw(0, -0.05);
    g.at(hx, Y + 2.0, hz, s.facing, 0, 0);
    g.ico(-0.07, 0.04, 0, 0.09, 0xff2e93, { sz: 0.5 });
    g.ico(0.07, 0.04, 0, 0.09, 0xff2e93, { sz: 0.5 });
    g.cone(0, -0.12, 0, 0.12, 0.17, 0xff2e93, { seg: 4, rx: Math.PI, ry: Math.PI / 4 });
    g.restore();
  }
  return g;
}

// the shimmer: thin highlight arcs and a few twinkles on the water (additive)
function buildShimmer(pond) {
  const g = new Geo({ alpha: true });
  const rnd = seeded(77);
  const W = pond.water + 0.012;
  const arcs = 9;
  for (let i = 0; i < arcs; i++) {
    const r = pond.r * (0.25 + 0.7 * rnd());
    const a0 = rnd() * TAU;
    const len = 0.5 + rnd() * 0.7;
    const wdt = 0.05 + rnd() * 0.04;
    const n = 5;
    for (let k = 0; k < n; k++) {
      const b0 = a0 + (len * k) / n;
      const b1 = a0 + (len * (k + 1)) / n;
      const f0 = Math.sin((Math.PI * k) / n);
      const f1 = Math.sin((Math.PI * (k + 1)) / n);
      const P = (b, rr) => [Math.sin(b) * rr, 0, Math.cos(b) * rr];
      g.triG(P(b0, r - wdt), P(b1, r - wdt), P(b1, r + wdt), 0xffffff, 0xffffff, 0xffffff, f0 * 0.5, f1 * 0.5, f1 * 0.5);
      g.triG(P(b0, r - wdt), P(b1, r + wdt), P(b0, r + wdt), 0xffffff, 0xffffff, 0xffffff, f0 * 0.5, f1 * 0.5, f0 * 0.5);
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = rnd() * TAU;
    const r = pond.r * (0.2 + 0.65 * rnd());
    const s = 0.09 + rnd() * 0.06;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    g.triG([x - s, 0.01, z], [x + s, 0.01, z], [x, 0.01, z - s * 2.2], 0xfff6c8, 0xfff6c8, 0xffffff, 0, 0, 0.9);
    g.triG([x + s, 0.01, z], [x - s, 0.01, z], [x, 0.01, z + s * 2.2], 0xfff6c8, 0xfff6c8, 0xffffff, 0, 0, 0.9);
  }
  const geo = g.build();
  const mat = makeAddMaterial(0xffffff, 0.6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pond.x, W, pond.z);
  mesh.renderOrder = 2;
  mesh.name = 'pondShimmer';
  return { mesh, geo, mat, triangles: g.tris };
}

// A pool of instances drawn with one material: scale 0 hides one.
function pool(geo, mat, max, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const a = mesh.instanceMatrix.array;
  a.fill(0);
  const col = new THREE.Color();
  for (let i = 0; i < max; i++) mesh.setColorAt(i, col.set(0x000000));
  mesh.count = 0;
  let top = 0;
  return {
    mesh,
    max,
    // translation, a turn about +Y, uniform scale; the colour (or its fade, for additive ones)
    set(i, x, y, z, scale, yaw, r, gr, b) {
      if (i < 0 || i >= max) return;
      const o = i * 16;
      const c = Math.cos(yaw) * scale;
      const s = Math.sin(yaw) * scale;
      a[o] = c; a[o + 1] = 0; a[o + 2] = -s; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = scale; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = s; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
      const ic = mesh.instanceColor.array;
      ic[i * 3] = r;
      ic[i * 3 + 1] = gr;
      ic[i * 3 + 2] = b;
      if (i + 1 > top) top = i + 1;
    },
    hide(i) {
      if (i < 0 || i >= max) return;
      const o = i * 16;
      for (let k = 0; k < 16; k++) a[o + k] = 0;
    },
    commit(used) {
      top = Math.min(max, Math.max(0, used === undefined ? top : used));
      mesh.count = top;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
  };
}

function ringGeometry() {
  const g = new Geo();
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 1) / n) * TAU;
    const P = (a, r) => [Math.sin(a) * r, 0, Math.cos(a) * r];
    g.quad(P(a0, 0.82), P(a1, 0.82), P(a1, 1), P(a0, 1), 0xffffff);
  }
  return g.build();
}
function crumbGeometry() {
  const g = new Geo();
  g.ico(0, 0, 0, 1, 0xffffff, { sy: 0.7 });
  return g.build();
}
function heartGeometry() {
  const g = new Geo();
  // two lobes and a point, flat, facing +Z (and back)
  const pts = [];
  for (let k = 0; k <= 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    pts.push([16 * Math.pow(Math.sin(t), 3) / 17, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 + 0.15, 0]);
  }
  for (let k = 0; k < 12; k++) g.tri([0, 0.1, 0], pts[k], pts[k + 1], 0xffffff);
  return g.build();
}

// The sign's face: a canvas, re-drawn for a new name.
function drawSignFace(ctx, W, H, name) {
  ctx.clearRect(0, 0, W, H);
  const r = 34;
  ctx.fillStyle = '#fff7ec';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(W, 0, W, H, r);
  ctx.arcTo(W, H, 0, H, r);
  ctx.arcTo(0, H, 0, 0, r);
  ctx.arcTo(0, 0, W, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ff8cc6';
  ctx.stroke();
  // a little duck in the corner, and hearts
  const duck = (x, y, s) => {
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.ellipse(x, y, 30 * s, 20 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 20 * s, y - 22 * s, 15 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff9f3a';
    ctx.beginPath();
    ctx.moveTo(x + 33 * s, y - 25 * s);
    ctx.lineTo(x + 48 * s, y - 20 * s);
    ctx.lineTo(x + 33 * s, y - 15 * s);
    ctx.fill();
    ctx.fillStyle = '#17121c';
    ctx.beginPath();
    ctx.arc(x + 24 * s, y - 25 * s, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb0d0';
    ctx.beginPath();
    ctx.arc(x + 19 * s, y - 16 * s, 4 * s, 0, Math.PI * 2);
    ctx.fill();
  };
  const heart = (x, y, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
    ctx.fill();
  };
  duck(W - 92, H - 52, 1.25);
  heart(58, 52, 16, '#ff2e93');
  heart(92, 40, 10, '#c9b6ff');
  heart(W - 60, 48, 12, '#ff8cc6');
  // the name, as big as fits
  const text = String(name || 'Duck Pond');
  let size = 84;
  ctx.font = '900 ' + size + 'px ' + FONT_STACK;
  while (size > 30 && ctx.measureText(text).width > W - 120) {
    size -= 3;
    ctx.font = '900 ' + size + 'px ' + FONT_STACK;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, W / 2, H / 2 - 6);
  ctx.fillStyle = '#17121c';
  ctx.fillText(text, W / 2, H / 2 - 6);
  ctx.font = '800 26px ' + FONT_STACK;
  ctx.fillStyle = '#c4126b';
  ctx.fillText('Quack hello!', W / 2 - 20, H - 40);
}

export function buildPondArt(pond, { quality = 'high', name = 'Duck Pond' } = {}) {
  const q = quality === 'low' ? 'low' : 'high';
  const group = new THREE.Group();
  group.name = 'duckPond';
  const own = [];
  // the static pond: one merged mesh
  const stat = buildStatic(pond, q);
  const staticGeo = stat.build();
  own.push(staticGeo);
  const water = new THREE.Mesh(staticGeo, flatMat);
  water.name = 'pond';
  group.add(water);
  // the shimmer
  const sh = buildShimmer(pond);
  own.push(sh.geo, sh.mat);
  group.add(sh.mesh);
  // the sign's face
  let canvas = null;
  let ctx = null;
  let tex = null;
  let face = null;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    ctx = canvas.getContext('2d');
    if (ctx) {
      drawSignFace(ctx, canvas.width, canvas.height, name);
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const geo = new THREE.PlaneGeometry(1.7, 0.85);
      face = new THREE.Mesh(geo, mat);
      const s = pond.sign;
      const [x, z] = toWorld(s, 0, 0.0);
      face.position.set(x, pond.y + 1.49, z);
      face.rotation.y = s.facing;
      face.name = 'pondSign';
      group.add(face);
      own.push(tex, mat, geo);
    }
  }
  // the pools
  const add = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ringGeo = ringGeometry();
  const ripples = pool(ringGeo, add, 14, 'pondRipples');
  ripples.mesh.renderOrder = 3;
  const crumbMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const crumbGeo = crumbGeometry();
  const crumbs = pool(crumbGeo, crumbMat, 36, 'pondCrumbs');
  const heartMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const heartGeo = heartGeometry();
  const hearts = pool(heartGeo, heartMat, 14, 'pondHearts');
  hearts.mesh.renderOrder = 4;
  own.push(add, ringGeo, crumbMat, crumbGeo, heartMat, heartGeo);
  // everything stays round the pond (crumbs fly in from her hand on the shore): one sphere each
  const sphere = new THREE.Sphere(new THREE.Vector3(pond.x, pond.water + 1, pond.z), pond.r + 9);
  for (const p of [ripples, crumbs, hearts]) {
    p.mesh.boundingSphere = sphere;
    group.add(p.mesh);
  }
  const m = motion();
  return {
    group,
    water,
    ripples,
    crumbs,
    hearts,
    get triangles() {
      return stat.tris + sh.triangles + 2 + ripples.mesh.count * 36 + crumbs.mesh.count * 20 + hearts.mesh.count * 24;
    },
    drawCalls: 6,
    update(dt, t) {
      sh.mesh.rotation.y = t * 0.03 * m;
      const k = 1 + Math.sin(t * 0.7) * 0.03 * m;
      sh.mesh.scale.set(k, 1, k);
      sh.mat.opacity = 0.42 + 0.25 * Math.sin(t * 1.3) * m;
    },
    setName(next) {
      if (!ctx || !tex) return;
      drawSignFace(ctx, canvas.width, canvas.height, next);
      tex.needsUpdate = true;
    },
    dispose() {
      for (const o of own) o.dispose();
      own.length = 0;
      if (group.parent) group.parent.remove(group);
    },
  };
}
