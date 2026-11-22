// A simple stand-in sky island with every Contract 1 place, used when js/world/island.js (or
// sky.js) is missing or fails, so the app and every other part can be built and tested on it.
// Same interfaces as the real ones:
//
//   buildIsland({ scene, quality, colliders }) -> {
//     groundAt(x, z), platforms, places, update(dt, t, { camera, playerPos }),
//     setBirthday({ isBirthday, age, name }), dispose(), group,
//   }
//   createSky({ scene, quality }) -> { update(dt, t, camera), lights: { hemi, dir, amb }, dispose() }
//
// A round pastel island (radius 62 m, flat top at y = 0) floating over a sea of clouds: the plaza
// and cake in the middle, basket-toss pads to the north aimed at three cloud platforms (8, 14 and
// 22 m) with slides back down, the dodgeball court east, the hide-and-seek garden west, the Capture
// the Bow field south, the gym south-west, the Hit Zero stage south-east. Static scenery is one
// merged mesh on the shared flatMat, plus one unlit and one additive mesh for the lights.

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { Geo, shade, mix } from '../art/geo.js';
import { flatMat, glowMat, addMat } from '../art/materials.js';
import { rng as seeded, makeSparkles, halo, isReducedMotion } from '../art/util.js';
import { clamp, lerp } from '../core/util.js';

const hex = (css) => parseInt(String(css).slice(1), 16);
const C = {};
for (const k of Object.keys(PALETTE)) C[k] = hex(PALETTE[k]);

export const ISLAND_RADIUS = 62;
const R = ISLAND_RADIUS;
const SLIDE_HALF = 1.1;

// ------------------------------------------------------------------------------------ layout

function makeLayout() {
  const platforms = [
    { id: 'cloud1', x: -22, z: -71, y: 8, r: 5 },
    { id: 'cloud2', x: 0, z: -77, y: 14, r: 5 },
    { id: 'cloud3', x: 23, z: -71, y: 22, r: 5.5 },
  ];
  const tossPads = [
    { id: 'pad1', x: -16, z: -47, facing: Math.atan2(-22 + 16, -71 + 47), targetPlatformId: 'cloud1' },
    { id: 'pad2', x: 0, z: -50, facing: Math.PI, targetPlatformId: 'cloud2' },
    { id: 'pad3', x: 16, z: -47, facing: Math.atan2(23 - 16, -71 + 47), targetPlatformId: 'cloud3' },
  ];
  // from the platform edge down to the island (x0, z0 is the top)
  const slides = [
    { id: 'slide1', fromPlatformId: 'cloud1', x0: -26.5, z0: -68.5, x1: -34, z1: -48 },
    { id: 'slide2', fromPlatformId: 'cloud2', x0: -4.6, z0: -75, x1: -9, z1: -50 },
    { id: 'slide3', fromPlatformId: 'cloud3', x0: 28.2, z0: -69, x1: 44, z1: -36 },
  ];
  const hideSpots = [];
  const kinds = ['hedge', 'bush', 'tent', 'barrel', 'cloud', 'rack', 'curtain', 'slide'];
  const cols = [-49, -43, -37, -31, -26];
  const rows = [-14, -6, 2, 10, 17];
  let n = 0;
  for (let i = 0; i < cols.length; i++) {
    for (let j = 0; j < rows.length; j++) {
      if ((i + j) % 2 === 1 && !(i === 4 && j === 2)) continue; // a checkerboard keeps lanes open
      const x = cols[i] + (j % 2 ? 1.2 : -0.6);
      const z = rows[j];
      if (Math.hypot(x, z) > R - 6) continue;
      const kind = kinds[n % kinds.length];
      hideSpots.push({ id: 'spot' + (n + 1), x, z, kind, r: kind === 'tent' || kind === 'cloud' || kind === 'bush' ? 1.5 : 1.3 });
      n++;
    }
  }
  // a few more around the edges of the garden
  for (const [x, z, kind] of [[-52, 4, 'bush'], [-28, -17, 'hedge'], [-24, 19, 'cloud'], [-46, 19, 'barrel'], [-52, -9, 'tent']]) {
    if (Math.hypot(x, z) < R - 5) hideSpots.push({ id: 'spot' + (++n), x, z, kind, r: 1.4 });
  }
  const places = {
    plaza: { x: 0, z: 7, facing: Math.PI },
    gym: { x: -33, z: 35, w: 16, d: 12, facing: Math.PI / 4 },
    stage: { x: 31, z: 29, facing: Math.PI / 4 + Math.PI },
    tossPads,
    slides,
    hideGarden: { bounds: { x0: -54, z0: -20, x1: -22, z1: 22 }, seekerStart: { x: -17, z: 1, facing: -Math.PI / 2 }, hideSpots },
    court: { x: 38, z: -2, w: 14, d: 24, facing: 0 },
    bowField: { x: 0, z: 40, w: 28, d: 22, facing: 0, bases: [{ team: 0, x: 0, z: 31.5, r: 3 }, { team: 1, x: 0, z: 48.5, r: 3 }] },
    tagZone: { bounds: { x0: -20, z0: -24, x1: 22, z1: 22 } },
    photoBooth: { x: -14, z: 16, facing: Math.PI * 0.8 },
  };
  return { platforms, places };
}

// ------------------------------------------------------------------------------------ ground

export function makeGroundAt(platforms, slides) {
  const tops = new Map(platforms.map((p) => [p.id, p.y]));
  const segs = slides.map((s) => {
    const y0 = tops.has(s.fromPlatformId) ? tops.get(s.fromPlatformId) : 0;
    const dx = s.x1 - s.x0;
    const dz = s.z1 - s.z0;
    return { x0: s.x0, z0: s.z0, dx, dz, len2: dx * dx + dz * dz, y0, y1: 0 };
  });
  return function groundAt(x, z) {
    let y = -Infinity;
    if (x * x + z * z <= R * R) y = 0;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.r * p.r && p.y > y) y = p.y;
    }
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const t = clamp(((x - s.x0) * s.dx + (z - s.z0) * s.dz) / s.len2, 0, 1);
      const px = s.x0 + s.dx * t;
      const pz = s.z0 + s.dz * t;
      if ((x - px) * (x - px) + (z - pz) * (z - pz) <= SLIDE_HALF * SLIDE_HALF) {
        const sy = lerp(s.y0, s.y1, t) + 0.04;
        if (sy > y) y = sy;
      }
    }
    return y;
  };
}

// ------------------------------------------------------------------------------------ art helpers

function cloudPuff(g, x, y, z, r, rnd, tints = [C.white, C.cloud, C.pinkPale], detail = 1) {
  const n = 4 + Math.floor(rnd() * 3);
  g.ico(x, y, z, r, tints[0], { detail, sy: 0.62, jitter: 0.12, rnd });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd();
    const d = r * (0.55 + rnd() * 0.35);
    g.ico(x + Math.cos(a) * d, y + (rnd() - 0.35) * r * 0.3, z + Math.sin(a) * d, r * (0.5 + rnd() * 0.3), tints[i % tints.length], { detail, sy: 0.7, jitter: 0.1, rnd });
  }
}

function tree(g, x, z, rnd) {
  const canopy = [C.pinkSoft, C.lilac, C.mint, C.peach, C.rhinestonePink, C.babyBlue][Math.floor(rnd() * 6)];
  const h = 1.8 + rnd() * 1.2;
  g.cyl(x, 0, z, 0.24, h, C.white, { seg: 6, rt: 0.17 });
  // candy stripes on the trunk
  for (let k = 0; k < 3; k++) g.cyl(x, 0.3 + k * (h / 3.2), z, 0.245, 0.14, C.pinkSoft, { seg: 6, top: false });
  const r = 1.5 + rnd() * 0.8;
  g.ico(x, h + r * 0.75, z, r, canopy, { detail: 1, jitter: 0.12, rnd, sy: 0.92 });
  g.ico(x + r * 0.45, h + r * 1.15, z - r * 0.2, r * 0.55, shade(canopy, 1.12), { detail: 0, jitter: 0.1, rnd });
}

function flower(g, x, z, rnd) {
  const c = [C.pink, C.lemon, C.rhinestonePurple, C.white, C.coral, C.babyBlue][Math.floor(rnd() * 6)];
  g.cyl(x, 0, z, 0.03, 0.35, C.grassDark, { seg: 3, top: false });
  g.ico(x, 0.4, z, 0.13, c, { detail: 0 });
  g.ico(x, 0.4, z, 0.06, C.lemon, { detail: 0, sy: 1.6 });
}

function ringLine(g, cx, cz, r, w, y, hexc, seg = 36) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (rr, a) => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr];
    g.quad(p(r - w / 2, a0), p(r - w / 2, a1), p(r + w / 2, a1), p(r + w / 2, a0), hexc);
  }
}

// A flat rectangle on the ground in a rotated frame (cx, cz, facing), local x across, local z long.
function groundRect(g, cx, cz, facing, x0, z0, x1, z1, y, hexc) {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  const w = (lx, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
  g.quad(w(x0, z1), w(x1, z1), w(x1, z0), w(x0, z0), hexc);
}

function bigBow(g, x, y, z, s, hexc, ry = 0) {
  g.at(x, y, z, ry);
  g.scale(s);
  const dark = shade(hexc, 0.8);
  for (const sx of [-1, 1]) {
    g.sphere(sx * 0.55, 0.1, 0, 0.5, hexc, { seg: 8, rings: 5, sx: 1.25, sy: 0.85, sz: 0.4, rz: sx * 0.3 });
    g.at(sx * 0.2, -0.1, 0, 0, 0, sx * 0.3);
    g.quad2([-0.16, 0, 0], [0.16, 0, 0], [0.22, -0.9, 0], [-0.22, -0.9, 0], dark);
    g.restore();
    for (const [px, py] of [[0.45, 0.25], [0.75, 0.02], [0.6, 0.45]]) {
      for (const fz of [1, -1]) {
        const zz = 0.215 * fz;
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const a = Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 ? 0.045 : 0.1;
          pts.push([sx * px + Math.cos(a) * rr * fz, py + Math.sin(a) * rr, zz]);
        }
        for (let i = 0; i < 10; i++) g.tri([sx * px, py, zz], pts[i], pts[(i + 1) % 10], C.black);
      }
    }
  }
  g.sphere(0, 0.08, 0, 0.24, dark, { seg: 7, rings: 5 });
  g.restore();
}

// ------------------------------------------------------------------------------------ island

export function buildIsland({ scene, quality = 'high', colliders = null } = {}) {
  const group = new THREE.Group();
  group.name = 'fallbackIsland';
  scene.add(group);
  const own = [];
  const rnd = seeded(9);
  const { platforms, places } = makeLayout();
  const groundAt = makeGroundAt(platforms, places.slides);
  const low = quality === 'low';

  const g = new Geo();
  g.jit = 0.035;
  const glow = new Geo();
  const glowA = new Geo({ alpha: true });

  // ---------------------------------------------------------------- the island itself
  // underside: soft pastel strata tapering into a point far below
  g.lathe(0, 0, 0, [
    [0.6, -46, C.lavender], [R * 0.1, -40, C.lavender], [R * 0.3, -31, C.lilac], [R * 0.5, -22, C.rhinestonePurple],
    [R * 0.68, -14, C.lilac], [R * 0.84, -8, C.pinkPale], [R * 0.95, -3.6, C.peach], [R * 0.995, -1.2, C.grassDark], [R, 0],
  ], C.lilac, { seg: low ? 20 : 30, capTop: false });
  // grass top, in rings so the facets can vary
  const seg = low ? 36 : 56;
  const radii = [0, 8, 16, 26, 36, 46, 55, R];
  for (let j = 0; j < radii.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (r, a) => [Math.cos(a) * r, 0, Math.sin(a) * r];
      const col = (i + j) % 3 === 0 ? C.grass : (i * 7 + j) % 5 === 0 ? shade(C.grass, 1.08) : mix(C.grass, C.mint, 0.25);
      if (j === 0) g.tri([0, 0, 0], p(radii[1], a1), p(radii[1], a0), col);
      else g.quad(p(radii[j], a0), p(radii[j], a1), p(radii[j + 1], a1), p(radii[j + 1], a0), col);
    }
  }
  // a frosting-white rim with little scallops, like the edge of a cake
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.ico(Math.cos(a) * (R - 0.3), -0.25, Math.sin(a) * (R - 0.3), 0.9, i % 2 ? C.white : C.pinkPale, { detail: 0, sy: 0.6 });
  }
  // clouds hugging the underside
  for (let i = 0; i < (low ? 10 : 18); i++) {
    const a = (i / (low ? 10 : 18)) * Math.PI * 2 + rnd() * 0.3;
    const rr = R * (0.72 + rnd() * 0.25);
    cloudPuff(g, Math.cos(a) * rr, -8 - rnd() * 14, Math.sin(a) * rr, 4 + rnd() * 3, rnd);
  }

  // ---------------------------------------------------------------- plaza and the cake
  const P = places.plaza;
  for (let j = 0; j < 3; j++) {
    const r0 = [0, 4, 8.5][j];
    const r1 = [4, 8.5, 11][j];
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      const p = (r, a) => [Math.cos(a) * r, 0.03, Math.sin(a) * r];
      const col = j === 2 ? C.pinkSoft : (i + j) % 2 ? C.white : C.pinkPale;
      if (r0 === 0) g.tri([0, 0.03, 0], p(r1, a1), p(r1, a0), col);
      else g.quad(p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0), col);
    }
  }
  const cake = { x: 0, z: -2 };
  g.cyl(cake.x, 0, cake.z, 2.3, 0.18, C.pinkSoft, { seg: 20 });
  g.cyl(cake.x, 0.18, cake.z, 2.0, 1.1, C.white, { seg: 20 });
  g.cyl(cake.x, 1.18, cake.z, 2.08, 0.2, C.pink, { seg: 20 });
  g.cyl(cake.x, 1.38, cake.z, 1.5, 0.9, C.pinkPale, { seg: 18 });
  g.cyl(cake.x, 2.18, cake.z, 1.57, 0.18, C.rhinestonePurple, { seg: 18 });
  g.cyl(cake.x, 2.36, cake.z, 1.0, 0.8, C.white, { seg: 16 });
  g.cyl(cake.x, 3.08, cake.z, 1.06, 0.14, C.pink, { seg: 16 });
  // frosting drips and sprinkles
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    g.ico(cake.x + Math.cos(a) * 2.02, 1.1, cake.z + Math.sin(a) * 2.02, 0.16, C.pink, { detail: 0, sy: 1.6 });
  }
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const tier = i % 3;
    const rr = [1.98, 1.48, 0.98][tier] + 0.02;
    const yy = [0.4, 1.55, 2.5][tier] + rnd() * 0.5;
    g.box(cake.x + Math.cos(a) * rr, yy, cake.z + Math.sin(a) * rr, 0.06, 0.06, 0.16, [C.lemon, C.babyBlue, C.mint, C.rhinestonePurple][i % 4], { ry: -a });
  }
  // the topper: her bow
  bigBow(g, cake.x, 3.75, cake.z, 0.9, C.pink, 0);
  if (colliders) colliders.addCircle(cake.x, cake.z, 2.4, 'island');

  // star lamps around the plaza
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2; // none on the spawn's line of sight
    const x = Math.cos(a) * 12.2;
    const z = Math.sin(a) * 12.2;
    g.cyl(x, 0, z, 0.12, 3.2, C.white, { seg: 6 });
    g.cyl(x, 0, z, 0.26, 0.3, C.pinkSoft, { seg: 6 });
    g.cyl(x, 3.2, z, 0.2, 0.12, C.pink, { seg: 6 });
    glow.ico(x, 3.65, z, 0.34, C.lemon, { detail: 0 });
    halo(glowA, x, 3.65, z, 1.1, C.gold, 0.32, 1);
    if (colliders) colliders.addCircle(x, z, 0.3, 'island');
  }

  // ---------------------------------------------------------------- stepping-stone paths
  const stones = (x0, z0, x1, z1, col = C.white) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(len / 2.2);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      const t = i / Math.max(1, n);
      const x = lerp(x0, x1, t) + (i % 2 ? 0.35 : -0.35);
      const z = lerp(z0, z1, t);
      g.cyl(x, 0, z, 0.85, 0.05, i % 3 === 0 ? C.pinkPale : col, { seg: 7, ry: ang });
    }
  };
  stones(0, -12, 0, -42);
  stones(12, -3, 29, -2);
  stones(-12, 0, -18, 1);
  stones(-9, 9, -26, 27);
  stones(9, 9, 24, 23);
  stones(0, 12, 0, 27);

  // ---------------------------------------------------------------- basket toss: signs by each pad
  places.tossPads.forEach((pad, i) => {
    const sx = pad.x + Math.cos(pad.facing) * 4.4;
    const sz = pad.z - Math.sin(pad.facing) * 4.4;
    g.cyl(sx, 0, sz, 0.1, 2.6, C.white, { seg: 6 });
    g.box(sx, 2.2, sz, 1.7, 1.0, 0.12, C.pink, { ry: pad.facing + Math.PI });
    g.at(sx, 2.36, sz, pad.facing + Math.PI);
    g.text(String(i + 1), 0, 0, 0.075, 0.13, C.white);
    g.text(String(i + 1), 0, 0, -0.075, 0.13, C.white, { ry: Math.PI });
    g.restore();
    if (colliders) colliders.addCircle(sx, sz, 0.25, 'island');
  });
  // a rainbow arch over the way to the toss pads
  for (let k = 0; k < 5; k++) {
    const col = [C.pink, C.peach, C.lemon, C.mint, C.babyBlue][k];
    const r = 6.2 - k * 0.42;
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.9, -33]);
    }
    g.tube(pts, 0.22, col, { seg: 5 });
  }
  if (colliders) {
    colliders.addCircle(-6.2, -33, 0.5, 'island');
    colliders.addCircle(6.2, -33, 0.5, 'island');
  }

  // ---------------------------------------------------------------- cloud platforms and slides
  for (const p of platforms) {
    g.cyl(p.x, p.y - 0.5, p.z, p.r, 0.5, C.white, { seg: 18, top: C.cloud });
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.ico(p.x + Math.cos(a) * p.r, p.y - 0.55, p.z + Math.sin(a) * p.r, 1.15 + (i % 3) * 0.25, i % 3 ? C.white : C.pinkPale, { detail: 1, sy: 0.75, jitter: 0.08, rnd });
    }
    cloudPuff(g, p.x, p.y - 2.2, p.z, p.r * 0.75, rnd, [C.white, C.cloudShadow, C.pinkPale]);
    // a flag with the height on it
    const fx = p.x + p.r * 0.55;
    const fz = p.z - p.r * 0.35;
    g.cyl(fx, p.y, fz, 0.07, 3, C.white, { seg: 5 });
    g.at(fx, p.y + 2.2, fz, Math.PI / 2);
    g.quad2([0, 0, 0], [1.6, 0.35, 0], [1.6, 0.95, 0], [0, 0.8, 0], C.pink);
    g.restore();
  }
  for (const s of places.slides) {
    const p = platforms.find((q) => q.id === s.fromPlatformId);
    const y0 = p ? p.y : 0;
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const n = Math.max(6, Math.ceil(len / 1.6));
    const ang = Math.atan2(s.x1 - s.x0, s.z1 - s.z0);
    const cols = [C.pink, C.lemon, C.mint, C.babyBlue, C.lilac];
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const P0 = [lerp(s.x0, s.x1, t0), lerp(y0, 0, t0), lerp(s.z0, s.z1, t0)];
      const P1 = [lerp(s.x0, s.x1, t1), lerp(y0, 0, t1), lerp(s.z0, s.z1, t1)];
      const ox = Math.cos(ang) * SLIDE_HALF;
      const oz = -Math.sin(ang) * SLIDE_HALF;
      const A = [P0[0] - ox, P0[1], P0[2] - oz];
      const B = [P0[0] + ox, P0[1], P0[2] + oz];
      const Cc = [P1[0] + ox, P1[1], P1[2] + oz];
      const D = [P1[0] - ox, P1[1], P1[2] - oz];
      g.quad(A, D, Cc, B, cols[i % cols.length]);
      g.quad(B, Cc, D, A, shade(cols[i % cols.length], 0.85));
      // rails
      for (const side of [-1, 1]) {
        const rx = ox * side * 1.08;
        const rz = oz * side * 1.08;
        g.quad2([P0[0] + rx, P0[1], P0[2] + rz], [P1[0] + rx, P1[1], P1[2] + rz], [P1[0] + rx, P1[1] + 0.45, P1[2] + rz], [P0[0] + rx, P0[1] + 0.45, P0[2] + rz], C.white);
      }
      // supports where the slide is over the island
      if (i % 3 === 1 && Math.hypot(P0[0], P0[2]) < R - 1 && P0[1] > 0.8) g.cyl(P0[0], 0, P0[2], 0.16, P0[1], C.white, { seg: 5, top: false });
    }
  }

  // ---------------------------------------------------------------- dodgeball court
  {
    const c = places.court;
    groundRect(g, c.x, c.z, c.facing, -c.w / 2 - 0.6, -c.d / 2 - 0.6, c.w / 2 + 0.6, c.d / 2 + 0.6, 0.025, C.white);
    groundRect(g, c.x, c.z, c.facing, -c.w / 2, -c.d / 2, c.w / 2, 0, 0.04, mix(C.pinkPale, C.pinkSoft, 0.35));
    groundRect(g, c.x, c.z, c.facing, -c.w / 2, 0, c.w / 2, c.d / 2, 0.04, mix(C.lilac, C.white, 0.35));
    groundRect(g, c.x, c.z, c.facing, -c.w / 2, -0.12, c.w / 2, 0.12, 0.055, C.white);
    for (const lz of [-c.d / 2 + 3, c.d / 2 - 3]) groundRect(g, c.x, c.z, c.facing, -c.w / 2, lz - 0.08, c.w / 2, lz + 0.08, 0.055, C.white);
    ringLine(g, c.x, c.z, 2, 0.16, 0.055, C.white, 28);
  }

  // ---------------------------------------------------------------- Capture the Bow field
  {
    const f = places.bowField;
    groundRect(g, f.x, f.z, f.facing, -f.w / 2 - 0.2, -f.d / 2 - 0.2, -f.w / 2 + 0.2, f.d / 2 + 0.2, 0.04, C.white);
    groundRect(g, f.x, f.z, f.facing, f.w / 2 - 0.2, -f.d / 2 - 0.2, f.w / 2 + 0.2, f.d / 2 + 0.2, 0.04, C.white);
    groundRect(g, f.x, f.z, f.facing, -f.w / 2, -f.d / 2 - 0.2, f.w / 2, -f.d / 2 + 0.2, 0.04, C.white);
    groundRect(g, f.x, f.z, f.facing, -f.w / 2, f.d / 2 - 0.2, f.w / 2, f.d / 2 + 0.2, 0.04, C.white);
    groundRect(g, f.x, f.z, f.facing, -f.w / 2, -0.15, f.w / 2, 0.15, 0.04, C.white);
    for (const b of f.bases) {
      const col = b.team === 0 ? C.teamA : C.teamB;
      g.cyl(b.x, 0, b.z, b.r, 0.06, shade(col, 1.45), { seg: 20 });
      ringLine(g, b.x, b.z, b.r, 0.25, 0.08, col, 24);
      g.cyl(b.x, 0, b.z, 0.12, 3.4, C.white, { seg: 6 });
      bigBow(g, b.x, 3.6, b.z, 0.75, col, Math.PI / 2);
      if (colliders) colliders.addCircle(b.x, b.z, 0.25, 'island');
    }
  }

  // ---------------------------------------------------------------- hide-and-seek garden
  {
    const hg = places.hideGarden;
    const b = hg.bounds;
    // a low hedge border with gaps (the garden is entered from the plaza side)
    for (let z = b.z0; z < b.z1; z += 4) {
      if (Math.abs(z - 1) < 5) continue;
      if (Math.hypot(b.x1, z + 2) < R - 1) g.box(b.x1, 0, z + 2, 0.8, 0.9, 3.4, C.grassDark, { top: shade(C.grassDark, 1.1) });
    }
    for (const spot of hg.hideSpots) {
      const { x, z, kind } = spot;
      if (kind === 'hedge') {
        g.box(x + 1.2, 0, z, 0.9, 1.7, 3.2, C.grassDark, { top: shade(C.grassDark, 1.12) });
        if (colliders) colliders.addBox(x + 1.2, z, 0.9, 3.2, 0, 'island');
      } else if (kind === 'bush') {
        g.ico(x, 0.75, z, 1.35, mix(C.grassDark, C.mint, 0.3), { detail: 1, jitter: 0.12, rnd, sy: 0.8 });
        for (let k = 0; k < 6; k++) g.ico(x + Math.cos(k) * 1.0, 1.15 + (k % 2) * 0.3, z + Math.sin(k) * 1.0, 0.16, C.pink, { detail: 0 });
      } else if (kind === 'tent') {
        g.cone(x, 0, z, 1.9, 2.6, C.pinkSoft, { seg: 8 });
        for (let k = 0; k < 8; k += 2) {
          const a0 = (k / 8) * Math.PI * 2 + Math.PI / 8;
          const a1 = ((k + 1) / 8) * Math.PI * 2 + Math.PI / 8;
          g.tri([x + Math.cos(a1) * 1.92, 0.01, z + Math.sin(a1) * 1.92], [x + Math.cos(a0) * 1.92, 0.01, z + Math.sin(a0) * 1.92], [x, 2.62, z], C.white);
        }
        g.ico(x, 2.75, z, 0.18, C.lemon, { detail: 0 });
      } else if (kind === 'barrel') {
        g.cyl(x + 1.1, 0, z, 0.75, 1.3, C.peach, { seg: 10, top: C.lemon });
        g.cyl(x + 1.1, 0.25, z, 0.78, 0.12, C.pink, { seg: 10, top: false });
        g.cyl(x + 1.1, 0.95, z, 0.78, 0.12, C.pink, { seg: 10, top: false });
        if (colliders) colliders.addCircle(x + 1.1, z, 0.78, 'island');
      } else if (kind === 'cloud') {
        cloudPuff(g, x, 0.9, z, 1.3, rnd);
      } else if (kind === 'rack') {
        g.cyl(x + 1, 0, z - 1.2, 0.07, 1.6, C.white, { seg: 5 });
        g.cyl(x + 1, 0, z + 1.2, 0.07, 1.6, C.white, { seg: 5 });
        g.box(x + 1, 1.5, z, 0.1, 0.1, 2.6, C.white);
        for (let k = 0; k < 5; k++) g.ico(x + 1, 1.15, z - 1 + k * 0.5, 0.36, k % 2 ? C.pink : C.rhinestonePurple, { detail: 1, jitter: 0.25, rnd });
        if (colliders) colliders.addBox(x + 1, z, 0.5, 2.6, 0, 'island');
      } else if (kind === 'curtain') {
        g.cyl(x + 1, 0, z - 1.1, 0.07, 2.4, C.gold, { seg: 5 });
        g.cyl(x + 1, 0, z + 1.1, 0.07, 2.4, C.gold, { seg: 5 });
        for (let k = 0; k < 6; k++) {
          const zz = z - 1.1 + k * 0.37;
          g.box(x + 1 + (k % 2) * 0.12, 0.05, zz + 0.18, 0.12, 2.2, 0.37, C.rhinestonePurple, { top: C.lilac });
        }
      } else if (kind === 'slide') {
        g.box(x + 1.4, 0, z, 0.6, 1.6, 1.1, C.babyBlue);
        g.at(x + 0.2, 0, z, Math.PI / 2, 0, 0);
        g.quad2([-0.55, 0.05, -1.3], [0.55, 0.05, -1.3], [0.55, 1.6, 0.9], [-0.55, 1.6, 0.9], C.pinkSoft);
        g.restore();
      }
    }
  }

  // ---------------------------------------------------------------- gym: an open pavilion with a bow on top
  {
    const gy = places.gym;
    g.at(gy.x, 0, gy.z, gy.facing);
    g.box(0, 0, 0, gy.w, 0.12, gy.d, C.pinkPale, { top: C.babyBlue });
    g.box(0, 0.12, 0, gy.w - 2, 0.06, gy.d - 2, C.babyBlue, { top: mix(C.babyBlue, C.white, 0.2) });
    const px = gy.w / 2 - 0.5;
    const pz = gy.d / 2 - 0.5;
    for (const [x, z] of [[-px, -pz], [px, -pz], [-px, pz], [px, pz], [0, -pz], [0, pz]]) g.cyl(x, 0, z, 0.32, 5, C.white, { seg: 8 });
    g.box(0, 5, 0, gy.w + 0.8, 0.5, gy.d + 0.8, C.pink);
    g.gable(0, 5.5, 0, gy.w + 0.8, 2.4, gy.d + 0.8, C.white, { ends: C.pinkSoft });
    g.box(0, 0, -pz, gy.w - 1, 3, 0.3, C.lilac); // back wall
    g.text('GYM', 0, 3.4, pz + 0.45, 0.32, C.white);
    g.restore();
    bigBow(g, gy.x, 8.1, gy.z, 1.6, C.pink, gy.facing);
    if (colliders) {
      const c = Math.cos(gy.facing);
      const s = Math.sin(gy.facing);
      const at = (lx, lz) => [gy.x + lx * c + lz * s, gy.z - lx * s + lz * c];
      for (const [x, z] of [[-px, -pz], [px, -pz], [-px, pz], [px, pz], [0, -pz], [0, pz]]) {
        const w = at(x, z);
        colliders.addCircle(w[0], w[1], 0.4, 'island');
      }
      const bw = at(0, -pz);
      colliders.addBox(bw[0], bw[1], gy.w - 1, 0.4, gy.facing, 'island');
    }
  }

  // ---------------------------------------------------------------- Hit Zero stage: mat, bleachers, judges
  {
    const st = places.stage;
    g.at(st.x, 0, st.z, st.facing);
    g.box(0, 0, 0, 13, 0.18, 13, C.pinkSoft, { top: C.babyBlue });
    for (let i = 0; i < 5; i++) g.box(0, 0.18, -6 + i * 3, 12.4, 0.02, 0.06, mix(C.babyBlue, C.white, 0.45));
    // a big star in the middle of the mat
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 1.1 : 2.6;
      pts.push([Math.cos(a) * rr, 0.21, Math.sin(a) * rr]);
    }
    for (let i = 0; i < 10; i++) g.tri([0, 0.21, 0], pts[(i + 1) % 10], pts[i], C.pink);
    // bleachers face the mat from in front of it
    for (let k = 0; k < 3; k++) g.box(0, 0, 9 + k * 1.3, 12, 0.6 + k * 0.6, 1.3, k % 2 ? C.white : C.lilac, { top: k % 2 ? C.pinkPale : C.white });
    // the judges' table at the side
    g.box(8.5, 0, 0, 1.4, 1.0, 4.4, C.white, { top: C.pink });
    for (let k = 0; k < 3; k++) g.box(9.7, 0, -1.4 + k * 1.4, 0.6, 0.6, 0.6, C.rhinestonePurple);
    for (const sx of [-5.2, 5.2]) g.cyl(sx, 0, -7.1, 0.14, 6, C.white, { seg: 6 });
    g.box(0, 3.9, -7.1, 10.8, 2.1, 0.16, C.white);
    g.text('HIT ZERO', 0, 4.2, -7.0, 0.3, C.pink);
    g.restore();
    if (colliders) {
      const c = Math.cos(st.facing);
      const s = Math.sin(st.facing);
      const at = (lx, lz) => [st.x + lx * c + lz * s, st.z - lx * s + lz * c];
      const bl = at(0, 10.3);
      colliders.addBox(bl[0], bl[1], 12, 3.9, st.facing, 'island');
      const jt = at(8.5, 0);
      colliders.addBox(jt[0], jt[1], 1.4, 4.4, st.facing, 'island');
    }
  }

  // ---------------------------------------------------------------- photo booth (phase 2)
  {
    const pb = places.photoBooth;
    g.at(pb.x, 0, pb.z, pb.facing);
    g.box(0, 0, 0, 2.4, 2.8, 1.8, C.lilac, { top: C.pink });
    g.box(0, 2.8, 0, 2.7, 0.3, 2.1, C.pink);
    g.box(0, 0.05, 0.92, 1.4, 2.3, 0.06, C.pinkSoft);
    g.restore();
    if (colliders) colliders.addBox(pb.x, pb.z, 2.4, 1.8, pb.facing, 'island');
  }

  // ---------------------------------------------------------------- trees and flowers, wherever is free
  const keepOut = (x, z, pad) => {
    const inRect = (cx, cz, w, d, m) => Math.abs(x - cx) < w / 2 + m && Math.abs(z - cz) < d / 2 + m;
    if (Math.hypot(x, z) < 15 + pad || Math.hypot(x, z) > R - 3) return true;
    const c = places.court;
    const f = places.bowField;
    const b = places.hideGarden.bounds;
    if (inRect(c.x, c.z, c.w, c.d, 3 + pad) || inRect(f.x, f.z, f.w, f.d, 3 + pad)) return true;
    if (x > b.x0 - 2 && x < b.x1 + 2 && z > b.z0 - 2 && z < b.z1 + 2) return true;
    if (Math.hypot(x - places.gym.x, z - places.gym.z) < 13 + pad) return true;
    if (Math.hypot(x - places.stage.x, z - places.stage.z) < 14 + pad) return true;
    if (Math.hypot(x - places.photoBooth.x, z - places.photoBooth.z) < 3 + pad) return true;
    if (z < -28 && Math.abs(x) < 30) return true; // the toss pads and their run-up
    if (Math.abs(x) < 3 + pad && z < 0) return true; // the north path
    return false;
  };
  const treeSpots = [];
  for (let tries = 0; tries < 600 && treeSpots.length < (low ? 18 : 30); tries++) {
    const a = rnd() * Math.PI * 2;
    const r = 14 + rnd() * (R - 17);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (keepOut(x, z, 1)) continue;
    if (treeSpots.some((t) => Math.hypot(t[0] - x, t[1] - z) < 6)) continue;
    treeSpots.push([x, z]);
  }
  for (const [x, z] of treeSpots) {
    tree(g, x, z, rnd);
    if (colliders) colliders.addCircle(x, z, 0.45, 'island');
  }
  for (let i = 0; i < (low ? 40 : 90); i++) {
    const a = rnd() * Math.PI * 2;
    const r = 12 + rnd() * (R - 14);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (keepOut(x, z, 0)) continue;
    flower(g, x, z, rnd);
  }

  const mesh = g.mesh(flatMat);
  mesh.name = 'islandStatic';
  group.add(mesh);
  own.push(mesh.geometry);
  if (glow.tris) {
    const m = glow.mesh(glowMat);
    m.name = 'islandGlow';
    group.add(m);
    own.push(m.geometry);
  }
  if (glowA.tris) {
    const m = glowA.mesh(addMat);
    m.name = 'islandHalos';
    m.renderOrder = 3;
    group.add(m);
    own.push(m.geometry);
  }

  // twinkles over the cake, the platforms and the island
  const pts = [];
  for (let i = 0; i < 26; i++) pts.push([(rnd() - 0.5) * 7, 4 + rnd() * 4, cake.z + (rnd() - 0.5) * 7, 0.16 + rnd() * 0.16]);
  for (const p of platforms) for (let i = 0; i < 10; i++) pts.push([p.x + (rnd() - 0.5) * p.r * 2.2, p.y + 0.6 + rnd() * 3, p.z + (rnd() - 0.5) * p.r * 2.2, 0.2 + rnd() * 0.2]);
  for (let i = 0; i < (low ? 20 : 50); i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * R;
    pts.push([Math.cos(a) * r, 0.8 + rnd() * 5, Math.sin(a) * r, 0.12 + rnd() * 0.14]);
  }
  const sparkles = makeSparkles(pts, 0xfff0fa, 1.8);
  sparkles.mesh.renderOrder = 4;
  group.add(sparkles.mesh);
  own.push(sparkles.mesh.geometry);

  // ---------------------------------------------------------------- birthday: candles and a banner
  const bday = new THREE.Group();
  bday.name = 'birthday';
  bday.visible = false;
  group.add(bday);
  let bdayOwn = [];
  let flames = null;

  function setBirthday({ isBirthday = false, age = null, name = '' } = {}) {
    for (const o of bdayOwn) o.dispose();
    bdayOwn = [];
    bday.clear();
    flames = null;
    bday.visible = !!isBirthday;
    if (!isBirthday) return;
    const n = clamp(Math.round(Number(age) || 11), 1, 20);
    const cg = new Geo();
    const fg = new Geo();
    const fa = new Geo({ alpha: true });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cake.x + Math.cos(a) * 0.72;
      const z = cake.z + Math.sin(a) * 0.72;
      cg.cyl(x, 3.2, z, 0.06, 0.55, i % 2 ? C.pink : C.babyBlue, { seg: 5 });
      fg.ico(x, 3.86, z, 0.07, C.lemon, { detail: 0, sy: 1.7 });
      halo(fa, x, 3.86, z, 0.28, C.gold, 0.5, 0);
    }
    const label = ('HAPPY BIRTHDAY ' + String(name || '').toUpperCase().replace(/[^A-Z ]/g, '').slice(0, 12)).trim() + '!';
    const bw = Math.max(12, label.length * 0.62);
    cg.cyl(-bw / 2 - 0.2, 0, -13, 0.12, 5.4, C.white, { seg: 6 });
    cg.cyl(bw / 2 + 0.2, 0, -13, 0.12, 5.4, C.white, { seg: 6 });
    cg.box(0, 4.1, -13, bw, 1.25, 0.1, C.pink);
    cg.text(label, 0, 4.25, -12.93, 0.16, C.white);
    cg.text(label, 0, 4.25, -13.07, 0.16, C.white, { ry: Math.PI });
    const cm = cg.mesh(flatMat);
    const fm = fg.mesh(glowMat);
    const am = fa.mesh(addMat);
    am.renderOrder = 3;
    bday.add(cm, fm, am);
    bdayOwn = [cm.geometry, fm.geometry, am.geometry];
    flames = am;
  }

  function update(dt, t) {
    sparkles.update(t);
    if (flames && !isReducedMotion()) flames.scale.y = 1 + Math.sin(t * 17) * 0.04;
  }

  return {
    group,
    groundAt,
    platforms,
    places,
    update,
    setBirthday,
    fallback: true,
    dispose() {
      for (const o of own) o.dispose();
      for (const o of bdayOwn) o.dispose();
      if (colliders) colliders.removeGroup('island');
      group.removeFromParent();
    },
  };
}

// ------------------------------------------------------------------------------------ sky

export function createSky({ scene, quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'fallbackSky';
  scene.add(group);
  const own = [];
  const low = quality === 'low';
  const rnd = seeded(31);

  const hemi = new THREE.HemisphereLight(0xfff4fb, hex('#c9b6e8'), 1.25);
  const dir = new THREE.DirectionalLight(0xfff1e2, 2.0);
  dir.position.set(-60, 90, 40);
  const amb = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(hemi, dir, dir.target, amb);

  scene.fog = new THREE.FogExp2(hex(PALETTE.skyHorizon), 0.0036);
  scene.background = null;

  const sunDir = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
  const uniforms = {
    top: { value: new THREE.Color(PALETTE.skyTop) },
    horizon: { value: scene.fog.color },
    below: { value: new THREE.Color('#e3d2f7') },
    sunDir: { value: sunDir },
    sunColor: { value: new THREE.Color('#ffe0c2') },
  };
  const domeGeo = new THREE.SphereGeometry(600, 24, 14);
  const domeMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform vec3 sunColor;',
      'varying vec3 vDir;',
      'void main(){',
      '  vec3 d = normalize(vDir);',
      '  float h = d.y;',
      '  vec3 col = h > 0.0 ? mix(horizon, top, 1.0 - pow(1.0 - h, 2.4)) : mix(horizon, below, min(1.0, -h * 3.0));',
      '  float s = max(dot(d, sunDir), 0.0);',
      '  col += sunColor * (pow(s, 64.0) * 0.6 + pow(s, 6.0) * 0.18);',
      '  gl_FragColor = vec4(col, 1.0);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  own.push(domeGeo, domeMat);

  // the sea of clouds far below, and big clouds drifting around at island height
  const sea = new Geo();
  sea.jit = 0.03;
  const seaN = low ? 40 : 70;
  for (let i = 0; i < seaN; i++) {
    const a = (i / seaN) * Math.PI * 2 + rnd() * 0.2;
    const r = 70 + rnd() * 260;
    // far away and fogged: the cheap twenty-sided puffs read just as fluffy
    cloudPuff(sea, Math.cos(a) * r, -62 - rnd() * 10, Math.sin(a) * r, 14 + rnd() * 16, rnd, [C.white, C.cloud, C.cloudShadow], r > 150 ? 0 : 1);
  }
  const seaMesh = sea.mesh(flatMat);
  seaMesh.name = 'cloudSea';
  group.add(seaMesh);
  own.push(seaMesh.geometry);

  const drift = new Geo();
  drift.jit = 0.03;
  for (let i = 0; i < (low ? 7 : 12); i++) {
    const a = (i / (low ? 7 : 12)) * Math.PI * 2 + rnd() * 0.4;
    const r = 110 + rnd() * 120;
    cloudPuff(drift, Math.cos(a) * r, -10 + rnd() * 50, Math.sin(a) * r, 7 + rnd() * 8, rnd);
  }
  const driftMesh = drift.mesh(flatMat);
  driftMesh.name = 'driftClouds';
  group.add(driftMesh);
  own.push(driftMesh.geometry);

  return {
    lights: { hemi, dir, amb },
    update(dt, t, camera) {
      if (camera) dome.position.copy(camera.position);
      if (!isReducedMotion()) driftMesh.rotation.y += dt * 0.004;
    },
    dispose() {
      for (const o of own) o.dispose();
      scene.remove(hemi, dir, dir.target, amb);
      group.removeFromParent();
    },
  };
}
