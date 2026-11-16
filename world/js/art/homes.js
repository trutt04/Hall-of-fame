// The five homes. Where you live is where you stand.
//
// createHome(tier, { color, seed }) -> Home (see ARCHITECTURE.md, Contract 5) plus:
//   setNight(amount 0..1)   window glow (and how strong the porch light reads)
//   groundHeight(x, z)      meters above the lot plane for walkable raised ground (local coords)
//   lot                     { w, d } or { r } the space the home was designed for
//
// Anchor notes (all local space, y is the ground height at that spot unless noted):
//   door      standing spot right in front of the front door
//   mailbox   base of the mailbox post            lawn      open ground for piles and flamingos
//   curb      middle of the street edge           truck     just beyond the curb, park parallel to the street
//   roof      top of the roof (y is the roof top) sign      a clear spot by the path for a yard sign
//   goalposts clear lawn for the little goalposts resident  where the owner hangs out
//   trophy    spot for the toilet / spotlight     plaque    wall spot beside the door at eye height (faces +Z)
//   decor[6]  two wall spots, the roof edge, a tree or post, the mailbox top, the lawn
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade, mix } from './geo.js';
import { flatMat, makeWindowMaterial, makeAddMaterial } from './materials.js';
import { rng, pick, V3, halo, motion, flick, stepRand } from './util.js';
import {
  C, drawBag, drawTire, drawTrafficCone, drawCardboardBox, drawMailbox, drawTree, drawBush, drawHedge,
  drawPlasticChair, drawFence, drawGatePillar, drawGateLeaf, drawFlamingo,
} from './parts.js';
import { PALETTE } from '../config.js';

const PORCH = { win: 0x4dff8a, lose: 0xff4433, neutral: 0xffdf9e };

// ---- shared pieces -----------------------------------------------------------------------------

// Window on a wall that faces +Z at depth z. (x, y) is the bottom center of the glass.
function win(S, W, x, y, z, w, h, o = {}) {
  const fr = o.frame === undefined ? C.white : o.frame, t = o.ft || 0.09;
  S.box(x, y - t, z + 0.03, w + 2 * t, h + 2 * t, 0.08, fr);
  const zp = z + 0.075, G = o.lit ? W : S, x0 = x - w / 2, x1 = x + w / 2, y1 = y + h;
  G.tri([x0, y, zp], [x1, y, zp], [x0, y1, zp], o.glassA || C.glassA);
  G.tri([x1, y, zp], [x1, y1, zp], [x0, y1, zp], o.glassB || C.glassB);
  if (o.blind) {
    const by = y1 - h * o.blind;
    G.quad([x0, by, zp + 0.006], [x1, by, zp + 0.006], [x1, y1, zp + 0.006], [x0, y1, zp + 0.006], o.blindColor || 0xe6dfcc);
  }
  if (o.curtain) {
    const cw = w * 0.24;
    G.quad([x0, y, zp + 0.006], [x0 + cw, y, zp + 0.006], [x0 + cw * 0.6, y1, zp + 0.006], [x0, y1, zp + 0.006], o.curtain);
    G.quad([x1 - cw, y, zp + 0.006], [x1, y, zp + 0.006], [x1, y1, zp + 0.006], [x1 - cw * 0.6, y1, zp + 0.006], o.curtain);
  }
  const mz = zp + 0.014, mw = 0.05, mul = o.mul === undefined ? '+' : o.mul;
  const vbar = (bx) => S.quad([bx - mw / 2, y, mz], [bx + mw / 2, y, mz], [bx + mw / 2, y1, mz], [bx - mw / 2, y1, mz], fr);
  const hbar = (by) => S.quad([x0, by - mw / 2, mz], [x1, by - mw / 2, mz], [x1, by + mw / 2, mz], [x0, by + mw / 2, mz], fr);
  if (mul === '+' || mul === '|') vbar(x);
  if (mul === '#') { vbar(x - w / 6); vbar(x + w / 6); }
  if (mul === '+' || mul === '-' || mul === '#') hbar(y + h * (o.mulY || 0.5));
  if (o.sill !== false) S.box(x, y - t - 0.07, z + 0.1, w + 2 * t + 0.14, 0.07, 0.2, o.sill || fr);
  if (o.hat) S.box(x, y1 + t, z + 0.07, w + 2 * t + 0.24, 0.12, 0.18, o.hat);
  if (o.shut) {
    const sw = o.shutW || Math.min(0.42, w * 0.36);
    for (const sx of [-1, 1]) {
      const cx = x + sx * (w / 2 + t + sw / 2 + 0.015);
      S.box(cx, y - t * 0.5, z + 0.025, sw, h + t, 0.06, o.shut);
      S.quad([cx - sw * 0.3, y + h * 0.1, z + 0.058], [cx + sw * 0.3, y + h * 0.1, z + 0.058], [cx + sw * 0.3, y + h * 0.9, z + 0.058], [cx - sw * 0.3, y + h * 0.9, z + 0.058], shade(o.shut, 0.82));
    }
  }
}

function flowerBox(S, x, y, z, w, rnd, boxCol) {
  S.box(x, y, z + 0.17, w, 0.2, 0.26, boxCol, { tx: 1.04, tz: 1.12, top: C.dirt });
  const cols = [0xff5d73, 0xffd23f, 0xff8fab, 0xffffff, 0xc48bff];
  const n = Math.max(3, Math.round(w / 0.26));
  for (let i = 0; i < n; i++) {
    const fx = x - w / 2 + ((i + 0.5) * w) / n;
    S.sphere(fx, y + 0.26 + rnd() * 0.06, z + 0.17 + (rnd() - 0.5) * 0.08, 0.1 + rnd() * 0.03, i % 3 === 1 ? C.leafLt : pick(rnd, cols), { seg: 4, rings: 2 });
  }
}

function door(S, x, y, z, w, h, col, o = {}) {
  const fr = o.frame === undefined ? C.white : o.frame, t = o.ft || 0.1;
  S.box(x, y, z + 0.03, w + 2 * t, h + t, 0.1, fr);
  const zp = z + 0.09, dk = shade(col, 0.78), x0 = x - w / 2, x1 = x + w / 2;
  S.quad([x0, y, zp], [x1, y, zp], [x1, y + h, zp], [x0, y + h, zp], col);
  const leaves = o.double ? [[x0, x], [x, x1]] : [[x0, x1]];
  for (const [a, b] of leaves) {
    const m = (b - a) * 0.16;
    for (const [p0, p1] of [[0.08, 0.44], [0.52, 0.9]]) {
      S.quad([a + m, y + h * p0, zp + 0.008], [b - m, y + h * p0, zp + 0.008], [b - m, y + h * p1, zp + 0.008], [a + m, y + h * p1, zp + 0.008], dk);
    }
  }
  const knob = o.knob === undefined ? C.gold : o.knob;
  if (o.double) {
    S.box(x - 0.1, y + h * 0.46, zp + 0.03, 0.07, 0.07, 0.07, knob);
    S.box(x + 0.1, y + h * 0.46, zp + 0.03, 0.07, 0.07, 0.07, knob);
  } else S.box(x1 - 0.15, y + h * 0.46, zp + 0.03, 0.07, 0.07, 0.07, knob);
}

// Wall lantern: fixture into S, the bulb and halo into L (additive, tinted per porch state).
function porchLamp(S, L, x, y, z, s = 1) {
  S.box(x, y + 0.03, z + 0.07, 0.07 * s, 0.05 * s, 0.14 * s, C.iron);
  S.box(x, y, z + 0.14 * s, 0.2 * s, 0.05 * s, 0.2 * s, C.iron, { tx: 0.5, tz: 0.5 });
  S.sphere(x, y - 0.11 * s, z + 0.14 * s, 0.085 * s, 0xfff3d0, { seg: 5, rings: 3 });
  L.a = 1; L.ico(x, y - 0.11 * s, z + 0.14 * s, 0.1 * s, 0xffffff);
  halo(L, x, y - 0.11 * s, z + 0.14 * s, 0.62 * s, 0xffffff, 0.32, 1);
}

// Gable roof with real thickness and overhang. Ridge along local X; wall is w (x) by d (z).
function gableRoof(S, x, y, z, w, d, h, wallCol, roofCol, o = {}) {
  const over = o.over === undefined ? 0.4 : o.over, thick = o.thick || 0.16;
  S.at(x, y, z, o.ry);
  S.gable(0, 0, 0, w, h, d, wallCol);
  const half = d / 2, ang = Math.atan2(h, half), sl = Math.hypot(h, half) + over;
  for (const s of [0, Math.PI]) {
    S.at(0, h + thick * 0.6, 0, s);
    S.rotX(ang);
    S.box(0, -thick, sl / 2 - 0.02, w + 2 * over, thick, sl, roofCol, { bottom: shade(roofCol, 0.55), side: shade(roofCol, 0.8), front: shade(roofCol, 0.8) });
    S.restore();
  }
  S.box(0, h + thick * 0.6 - 0.05, 0, w + 2 * over + 0.06, 0.11, 0.26, shade(roofCol, 0.8));
  S.restore();
}

function hipRoof(S, x, y, z, w, d, h, roofCol, hip, eave = 0.16) {
  S.box(x, y, z, w, eave, d, shade(roofCol, 0.75), { bottom: shade(roofCol, 0.5) });
  S.gable(x, y + eave, z, w, h, d, roofCol, { hip, ends: shade(roofCol, 0.94) });
}

function lineColliders(list, x0, z0, x1, z1, r = 0.5, step = 0.95) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
  for (let i = 0; i <= n; i++) list.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, r });
}

// Turn the three Geos into a Home.
function finish(tier, K, spec) {
  const group = new THREE.Group();
  group.name = 'home-' + tier;
  const own = [];
  const body = K.S.mesh(flatMat); body.name = 'body'; group.add(body); own.push(body.geometry);
  const winMat = makeWindowMaterial(spec.emissive || 0xffc66b); own.push(winMat);
  let wins = null;
  if (K.W.tris) { wins = K.W.mesh(winMat); wins.name = 'windows'; group.add(wins); own.push(wins.geometry); }
  const lampMat = makeAddMaterial(PORCH.neutral, 1); own.push(lampMat);
  const lamp = K.L.mesh(lampMat); lamp.name = 'porchLight'; lamp.visible = false; group.add(lamp); own.push(lamp.geometry);
  let night = 0, state = 'off';
  const home = {
    group, tier,
    footprint: spec.footprint,
    colliders: spec.colliders || [],
    anchors: spec.anchors,
    lot: spec.lot,
    triangles: K.S.tris + K.W.tris + K.L.tris,
    groundHeight: spec.groundHeight || (() => 0),
    setPorchLight(s) {
      state = PORCH[s] ? s : 'off';
      lamp.visible = state !== 'off';
      if (lamp.visible) lampMat.color.setHex(PORCH[state]);
    },
    setNight(a) {
      night = Math.max(0, Math.min(1, a || 0));
      winMat.emissiveIntensity = night * (spec.glow || 1);
    },
    update(dt, t) {
      if (lamp.visible) {
        const pulse = state === 'neutral' ? 0 : 0.12 * Math.sin(t * 2.4) * motion();
        lampMat.opacity = (0.5 + 0.5 * night) * (0.88 + pulse);
      }
      if (spec.update) spec.update(dt, t, night, winMat);
    },
    dispose() {
      for (const o of own) o.dispose();
      if (spec.own) for (const o of spec.own) o.dispose();
      own.length = 0;
    },
  };
  if (spec.children) for (const c of spec.children) group.add(c);
  if (spec.extra) Object.assign(home, spec.extra);
  return home;
}

function kit() {
  const S = new Geo(), W = new Geo(), L = new Geo({ alpha: true });
  S.link(W);
  return { S, W, L };
}

// A flag that hangs from a pivot at its top-left corner and extends toward +X.
function flagGeo(w, h, col, o = {}) {
  const g = new Geo(), n = 5, alt = o.alt === undefined ? shade(col, 0.82) : o.alt;
  for (let i = 0; i < n; i++) {
    const x0 = (w * i) / n, x1 = (w * (i + 1)) / n, z0 = Math.sin(i * 1.3) * w * 0.045, z1 = Math.sin((i + 1) * 1.3) * w * 0.045;
    const d0 = o.droop ? o.droop * (i / n) * (i / n) : 0, d1 = o.droop ? o.droop * ((i + 1) / n) * ((i + 1) / n) : 0;
    const hh0 = o.pennant ? h * (1 - i / n) : h, hh1 = o.pennant ? h * (1 - (i + 1) / n) : h;
    const yc0 = -h / 2 - d0, yc1 = -h / 2 - d1;
    g.quad2([x0, yc0 - hh0 / 2, z0], [x1, yc1 - hh1 / 2, z1], [x1, yc1 + hh1 / 2, z1], [x0, yc0 + hh0 / 2, z0], i % 2 ? alt : col);
  }
  return g;
}

// ---- THE HILL: the mansion ---------------------------------------------------------------------
function buildHill(color, seed) {
  const r = rng(seed * 7 + 11), P = PALETTE.hill, K = kit(), { S, W, L } = K;
  const TH = 1.6, wall = P.wall, roof = P.roof, gold = C.gold, trim = C.white;
  const colliders = [];
  const lit = () => r() < 0.72;

  // paving and the red carpet
  S.box(0, 0, 17.75, 5.2, 0.06, 3.9, P.path, { side: shade(P.path, 0.85) });
  S.box(0, 0.06, 17.75, 1.9, 0.025, 3.9, C.velvet, { noTop: false });
  // terrace
  S.box(0, 0, 8.2, 30.8, TH - 0.14, 8.4, shade(wall, 0.88));
  S.box(0, TH - 0.14, 8.25, 31.2, 0.14, 8.7, P.path, { side: shade(wall, 1.05), front: shade(wall, 1.05) });
  S.box(0, 0.5, 12.42, 30.9, 0.1, 0.06, gold);
  S.box(0, TH, 9.9, 1.9, 0.025, 5.0, C.velvet);
  // grand stair: seven steps down from the terrace
  for (let i = 0; i < 7; i++) {
    const top = TH - 0.2 * (i + 1), zc = 12.55 + 0.25 + i * 0.5;
    S.box(0, 0, zc, 7.2, top, 0.5, shade(P.path, i % 2 ? 1 : 0.96));
    S.box(0, top, zc, 1.9, 0.025, 0.5, C.velvet, { front: shade(C.velvet, 0.8) });
  }
  for (const sx of [-1, 1]) {
    // cheek walls with gold orbs
    S.box(sx * 4.05, 0, 13.45, 0.9, TH + 0.45, 1.9, wall, { top: trim });
    S.box(sx * 4.05, 0, 15.25, 0.9, 0.95, 1.9, wall, { top: trim });
    S.box(sx * 4.05, 0.95, 15.6, 0.6, 0.2, 0.6, trim);
    S.sphere(sx * 4.05, 1.5, 15.6, 0.36, C.goldHi, { seg: 7, rings: 4 });
    lineColliders(colliders, sx * 4.05, 12.9, sx * 4.05, 16.0, 0.55);
    // lamp posts at the foot of the stair
    S.cyl(sx * 5.4, 0, 16.6, 0.16, 0.3, C.iron, { seg: 6 });
    S.cyl(sx * 5.4, 0.3, 16.6, 0.07, 2.6, C.iron, { seg: 5 });
    S.box(sx * 5.4, 2.9, 16.6, 0.34, 0.06, 0.34, gold);
    W.sphere(sx * 5.4, 3.22, 16.6, 0.27, 0xfff0c2, { seg: 6, rings: 4 });
    S.cone(sx * 5.4, 3.47, 16.6, 0.2, 0.2, gold, { seg: 6 });
    colliders.push({ x: sx * 5.4, z: 16.6, r: 0.3 });
  }

  // ---- the house -----------------------------------------------------------------------------
  S.box(0, 0, 0, 14.3, TH, 12.3, C.stone);
  S.box(0, TH, 0, 14, 7.4, 12, wall, { side: shade(wall, 0.96), noTop: true });
  S.box(0, 5.02, 0, 14.14, 0.14, 12.14, trim);
  S.box(0, 8.6, 0, 14.4, 0.2, 12.4, gold);
  S.box(0, 8.8, 0, 14.8, 0.22, 12.8, trim);
  for (const sx of [-1, 1]) {
    S.box(sx * 11, 0, -0.2, 8.3, TH, 9.9, C.stone);
    S.box(sx * 11, TH, -0.2, 8, 6.6, 9.6, wall, { side: shade(wall, 0.96), noTop: true });
    S.box(sx * 11, 5.02, -0.2, 8.14, 0.14, 9.74, trim);
    S.box(sx * 11, 7.8, -0.2, 8.4, 0.2, 10.0, gold);
    S.box(sx * 11, 8.0, -0.2, 8.8, 0.2, 10.4, trim);
    hipRoof(S, sx * 11, 8.2, -0.2, 9.2, 10.8, 2.3, roof, 3.6);
    S.box(sx * 6.62, TH, 6.02, 0.76, 7.0, 0.12, trim);
    S.box(sx * 14.62, TH, 4.62, 0.76, 6.2, 0.12, trim);
    // chimneys
    S.box(sx * 4.6, 9.4, -2.6, 0.95, 3.0, 0.95, wall);
    S.box(sx * 4.6, 12.4, -2.6, 1.15, 0.18, 1.15, gold);
    // wing windows, two floors
    for (const wx of [8.75, 11, 13.25]) {
      win(S, W, sx * wx, TH + 0.95, 4.6, 1.15, 2.0, { lit: lit(), hat: gold, mul: '#', mulY: 0.62 });
      win(S, W, sx * wx, TH + 4.25, 4.6, 1.15, 1.7, { lit: lit(), mul: '+' });
    }
    // side wall windows
    S.at(sx * 15, 0, -0.2, (sx * Math.PI) / 2);
    for (const wz of [-2.4, 2.4]) {
      win(S, W, wz, TH + 0.95, 0, 1.15, 2.0, { lit: lit(), hat: gold, mul: '#', mulY: 0.62 });
      win(S, W, wz, TH + 4.25, 0, 1.15, 1.7, { lit: lit(), mul: '+' });
    }
    S.restore();
    // central block front windows
    win(S, W, sx * 4.55, TH + 0.95, 6, 1.25, 2.2, { lit: true, hat: gold, mul: '#', mulY: 0.62 });
    win(S, W, sx * 4.55, TH + 4.35, 6, 1.25, 1.8, { lit: lit(), mul: '+' });
  }
  hipRoof(S, 0, 9.02, 0, 15.4, 13.4, 2.9, roof, 4.7, 0.2);
  // back windows (plain)
  S.at(0, 0, -6, Math.PI);
  for (const bx of [-4.5, -1.5, 1.5, 4.5]) { win(S, W, bx, TH + 0.95, 0, 1.15, 2.0, { lit: lit(), sill: false, mul: '-' }); win(S, W, bx, TH + 4.25, 0, 1.15, 1.7, { lit: lit(), sill: false, mul: '-' }); }
  S.restore();
  // cupola
  S.cyl(0, 11.6, 0, 1.25, 1.5, wall, { seg: 8 });
  for (let i = 0; i < 8; i += 2) { const a = (i * TAU) / 8; W.at(0, 12.0, 0, -a + Math.PI / 2); W.quad([-0.3, 0, 1.17], [0.3, 0, 1.17], [0.3, 0.8, 1.17], [-0.3, 0.8, 1.17], C.glassB); W.restore(); }
  S.cyl(0, 13.1, 0, 1.45, 0.14, gold, { seg: 8 });
  S.lathe(0, 13.24, 0, [[1.38, 0], [1.2, 0.4], [0.78, 0.8], [0.25, 1.02], [0.1, 1.06, gold], [0.1, 1.3]], roof, { seg: 8 });
  S.sphere(0, 14.7, 0, 0.2, C.goldHi, { seg: 6, rings: 3 });

  // ---- portico -------------------------------------------------------------------------------
  for (const cx of [-5.2, -1.9, 1.9, 5.2]) {
    S.box(cx, TH, 9, 0.95, 0.26, 0.95, trim);
    S.cyl(cx, TH + 0.26, 9, 0.37, 5.5, trim, { seg: 8, rt: 0.3, top: false });
    S.box(cx, TH + 5.76, 9, 0.6, 0.12, 0.6, gold);
    S.box(cx, TH + 5.88, 9, 0.9, 0.14, 0.9, gold);
    colliders.push({ x: cx, z: 9, r: 0.52 });
  }
  S.box(0, 7.62, 7.75, 12.6, 0.7, 3.9, trim, { bottom: shade(trim, 0.8) });
  S.box(0, 8.32, 7.75, 12.9, 0.14, 4.1, gold);
  S.gable(0, 8.46, 7.75, 4.1, 2.3, 12.9, roof, { ry: Math.PI / 2, ends: wall });
  S.tube([[-6.5, 8.5, 9.84], [0, 10.82, 9.84], [6.5, 8.5, 9.84]], 0.1, gold, { seg: 4 });
  // a plain gold star in the pediment
  for (let i = 0; i < 5; i++) {
    const a0 = Math.PI / 2 + (i * TAU) / 5, a1 = a0 + TAU / 10, a2 = a0 - TAU / 10, cy = 9.28, rr = 0.62, ri = 0.26;
    S.tri([0, cy, 9.83], [Math.cos(a2) * ri, cy + Math.sin(a2) * ri, 9.83], [Math.cos(a0) * rr, cy + Math.sin(a0) * rr, 9.83], C.goldHi);
    S.tri([0, cy, 9.83], [Math.cos(a0) * rr, cy + Math.sin(a0) * rr, 9.83], [Math.cos(a1) * ri, cy + Math.sin(a1) * ri, 9.83], gold);
  }
  // the door, a fanlight, and lanterns
  door(S, 0, TH, 6, 2.4, 3.3, color, { double: true, frame: gold, ft: 0.16 });
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 4, a1 = ((i + 1) * Math.PI) / 4, cy = TH + 3.62;
    W.tri([0, cy, 6.08], [Math.cos(a0) * 1.2, cy + Math.sin(a0) * 1.0, 6.08], [Math.cos(a1) * 1.2, cy + Math.sin(a1) * 1.0, 6.08], i % 2 ? C.glassA : C.glassB);
  }
  S.tube([[1.28, TH + 3.6, 6.08], [0.9, TH + 4.36, 6.08], [0, TH + 4.68, 6.08], [-0.9, TH + 4.36, 6.08], [-1.28, TH + 3.6, 6.08]], 0.07, gold, { seg: 3 });
  porchLamp(S, L, -1.95, TH + 2.7, 6, 1.5);
  porchLamp(S, L, 1.95, TH + 2.7, 6, 1.5);
  // team banners between the columns
  for (const sx of [-1, 1]) {
    const bx = sx * 3.55, top = 7.5, bot = 4.3, z = 9.05, hw = 0.75;
    S.box(bx, top, z, 1.8, 0.09, 0.09, gold);
    S.quad2([bx - hw, bot, z], [bx + hw, bot, z], [bx + hw, top, z], [bx - hw, top, z], color);
    S.tri2([bx - hw, bot, z], [bx - hw, bot - 0.55, z], [bx, bot, z], color).tri2([bx, bot, z], [bx + hw, bot - 0.55, z], [bx + hw, bot, z], color);
    S.quad2([bx - hw, bot + 0.5, z + 0.012], [bx + hw, bot + 0.5, z + 0.012], [bx + hw, bot + 0.72, z + 0.012], [bx - hw, bot + 0.72, z + 0.012], gold);
    S.quad2([bx - hw, top - 0.5, z + 0.012], [bx + hw, top - 0.5, z + 0.012], [bx + hw, top - 0.28, z + 0.012], [bx - hw, top - 0.28, z + 0.012], gold);
  }

  // ---- terrace balustrade --------------------------------------------------------------------
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0), n = Math.round(len / 0.8);
    S.at(x0, TH, z0, ry);
    S.box(len / 2, 0, 0, len, 0.12, 0.3, trim);
    S.box(len / 2, 0.84, 0, len, 0.13, 0.34, trim);
    for (let i = 0; i < n; i++) S.box(((i + 0.5) * len) / n, 0.12, 0, 0.2, 0.72, 0.2, wall, { noTop: true, tx: 0.5, tz: 0.5 });
    S.restore();
    lineColliders(colliders, x0, z0, x1, z1, 0.5);
  };
  const post = (x, z) => {
    S.box(x, TH, z, 0.5, 1.05, 0.5, wall, { top: trim });
    S.box(x, TH + 1.05, z, 0.62, 0.1, 0.62, gold);
    S.sphere(x, TH + 1.42, z, 0.27, C.goldHi, { seg: 6, rings: 4 });
  };
  for (const sx of [-1, 1]) {
    rail(sx * 4.6, 12.15, sx * 15.1, 12.15);
    rail(sx * 15.1, 12.15, sx * 15.1, 5.0);
    post(sx * 4.5, 12.15); post(sx * 15.1, 12.15); post(sx * 9.8, 12.15);
  }

  // ---- gates, fence, garden --------------------------------------------------------------------
  for (const sx of [-1, 1]) {
    drawGatePillar(S, sx * 3.3, 19.2, 3.5);
    W.sphere(sx * 3.3, 3.92, 19.2, 0.31, 0xfff0c2, { seg: 7, rings: 4 });
    colliders.push({ x: sx * 3.3, z: 19.2, r: 0.75 });
    S.at(sx * 2.72, 0, 19.2, sx > 0 ? Math.PI - 1.15 : 1.15 - Math.PI);
    if (sx < 0) S.scale(-1, 1, 1);
    drawGateLeaf(S, 2.6, 2.6, true);
    S.restore();
    drawFence(S, sx * 3.95, 19.3, sx * 21.4, 19.3, { h: 1.5 });
    drawFence(S, sx * 21.4, 19.3, sx * 21.4, 9.5, { h: 1.5 });
    lineColliders(colliders, sx * 3.95, 19.3, sx * 21.4, 19.3, 0.5, 1.05);
    lineColliders(colliders, sx * 21.4, 18.3, sx * 21.4, 9.5, 0.5, 1.05);
    // topiary and clipped hedges
    drawTree(S, 'topiary', sx * 4.7, 0, 17.9, 1.0, r);
    drawTree(S, 'topiary', sx * 13.6, TH, 10.9, 0.85, r);
    drawTree(S, 'topiary', sx * 17.6, 0, 14.5, 1.15, r);
    colliders.push({ x: sx * 4.7, z: 17.9, r: 0.6 }, { x: sx * 17.6, z: 14.5, r: 0.65 }, { x: sx * 13.6, z: 10.9, r: 0.55 });
    drawHedge(S, sx * 6.2, 13.2, sx * 14.6, 13.2, 0.8, 0.8);
    lineColliders(colliders, sx * 6.2, 13.2, sx * 14.6, 13.2, 0.5, 1.0);
    // flower bed in front of the hedge
    for (let i = 0; i < 6; i++) S.sphere(sx * (6.9 + i * 1.4), 0.16, 14.0, 0.2, i % 2 ? 0xffffff : color, { seg: 4, rings: 2 });
  }
  drawMailbox(S, 5.6, 0, 18.2, color, 'gold');
  colliders.push({ x: 5.6, z: 18.2, r: 0.35 });
  S.shadeY(0, 3.2, 0.9);

  // team flags fly from both wing roofs
  const flags = [];
  for (const sx of [-1, 1]) {
    S.cyl(sx * 11, 10.4, -0.2, 0.06, 3.3, C.metalLt, { seg: 5 });
    S.sphere(sx * 11, 13.78, -0.2, 0.15, C.goldHi, { seg: 5, rings: 3 });
    const f = flagGeo(2.4, 1.4, color, { alt: shade(color, 0.86) }).mesh(flatMat);
    f.name = 'flag'; f.position.set(sx * 11, 13.6, -0.2);
    flags.push(f);
  }

  return finish('hill', K, {
    lot: { w: 44, d: 40 },
    footprint: { w: 30, d: 12 },
    colliders,
    emissive: 0xffcf7a,
    children: flags,
    own: flags.map((f) => f.geometry),
    anchors: {
      door: V3(0, TH, 7.1), mailbox: V3(5.6, 0, 18.2), lawn: V3(-11.5, 0, 16.2), curb: V3(0, 0, 20), roof: V3(0, 11.9, 0),
      sign: V3(-7.2, 0, 17.6), goalposts: V3(11.5, 0, 16.2), resident: V3(3.2, TH, 10.6), trophy: V3(8.2, 0, 17.4),
      plaque: V3(3.1, TH + 1.6, 6.1), truck: V3(-9, 0, 22.2),
      throne: V3(-9.6, TH, 9.4), crown: V3(0, 17.2, 0), telescope: V3(10.2, TH, 11.2), terrace: V3(0, TH, 10.5),
      decor: [V3(-8.75, TH + 3.4, 4.75), V3(8.75, TH + 3.4, 4.75), V3(0, 9.3, 9.6), V3(-4.7, 2.4, 17.9), V3(5.6, 1.5, 18.2), V3(12.5, 0, 15.6)],
    },
    groundHeight(x, z) {
      if (Math.abs(x) <= 15.4 && z <= 12.4 && z >= -6.2) return TH;
      if (Math.abs(x) <= 3.6 && z > 12.4 && z < 16.05) return TH * (1 - (z - 12.4) / 3.65);
      return 0;
    },
    update(dt, t) {
      const m = motion();
      for (let i = 0; i < 2; i++) {
        flags[i].rotation.y = -0.35 + Math.sin(t * 1.1 + i * 1.7) * 0.22 * m + Math.sin(t * 2.7 + i) * 0.06 * m;
        flags[i].scale.x = 1 - 0.05 * m * (0.5 + 0.5 * Math.sin(t * 3.1 + i * 2));
      }
    },
  });
}

// ---- PLAYOFF HEIGHTS: the nice house -------------------------------------------------------------
function buildHeights(color, seed) {
  const r = rng(seed * 13 + 5), P = PALETTE.heights, K = kit(), { S, W, L } = K;
  const wall = P.walls[Math.floor(r() * P.walls.length) % P.walls.length];
  const roofCol = pick(r, [0xb5523a, 0x55698a, 0x6f7f5c, 0x7a4f5e]);
  const mirror = r() < 0.5, style = r() < 0.55 ? 0 : 1, chimSide = r() < 0.5 ? -1 : 1;
  const trim = P.trim, colliders = [];
  const lit = () => r() < 0.6;
  const Y0 = 0.3, WH = 5.6, top = Y0 + WH;
  const doorX = style === 0 ? -1.7 : 0;

  // lawn: smug mowing stripes
  for (let i = 0; i < 12; i++) {
    const x0 = -9.6 + i * 1.6, x1 = x0 + 1.6;
    S.quad([x0, 0.05, 9.6], [x1, 0.05, 9.6], [x1, 0.05, -9.6], [x0, 0.05, -9.6], i % 2 ? P.grass : shade(P.grass, 1.1));
  }
  S.box(0, 0, 9.62, 19.2, 0.05, 0.04, shade(P.grass, 0.8), { noTop: true });

  S.save();
  if (mirror) S.scale(-1, 1, 1);
  // foundation and walls
  S.box(0, 0, 0, 9.2, Y0, 7.2, C.stoneWarm);
  S.box(0, Y0, 0, 9, WH, 7, wall, { side: shade(wall, 0.95), noTop: true });
  S.box(0, Y0 + 2.8, 0, 9.08, 0.12, 7.08, trim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.box(sx * 4.44, Y0, sz * 3.44, 0.22, WH, 0.22, trim);
  gableRoof(S, 0, top, 0, 9, 7, 2.5, wall, roofCol, { over: 0.45 });
  // attic vents in the gable ends
  for (const sx of [-1, 1]) { S.at(sx * 4.5, top + 0.8, 0, (sx * Math.PI) / 2); S.cyl(0, 0, 0.0, 0.34, 0.06, trim, { seg: 8, rx: Math.PI / 2 }); S.cyl(0, 0, 0.03, 0.24, 0.05, shade(wall, 0.6), { seg: 8, rx: Math.PI / 2 }); S.restore(); }

  const shut = color, boxCol = trim;
  if (style === 0) {
    // cross gable bay on the right
    S.box(2.85, 0, 3.9, 3.5, Y0, 0.9, C.stoneWarm);
    S.box(2.85, Y0, 3.9, 3.3, WH, 0.8, wall, { side: shade(wall, 0.95), noTop: true });
    gableRoof(S, 2.85, top, 2.2, 4.2, 3.3, 1.9, wall, roofCol, { ry: Math.PI / 2, over: 0.4 });
    S.cyl(2.85, top + 0.75, 4.31, 0.3, 0.06, trim, { seg: 8, rx: Math.PI / 2 });
    win(S, W, 2.85, Y0 + 0.95, 4.3, 1.7, 1.55, { lit: true, mul: '#', shut, curtain: 0xfff7e6 });
    flowerBox(S, 2.85, Y0 + 0.55, 4.3, 1.9, r, boxCol);
    win(S, W, 2.85, Y0 + 3.75, 4.3, 1.2, 1.3, { lit: lit(), shut });
    // porch on the left
    S.box(-1.75, 0, 4.4, 5.3, Y0, 1.8, C.woodLt, { top: shade(C.woodLt, 1.1) });
    for (const px of [-4.25, -2.9, -0.55, 0.75]) S.box(px, Y0, 5.15, 0.16, 2.6, 0.16, trim);
    S.box(-1.75, Y0 + 2.6, 4.45, 5.6, 0.14, 2.0, trim);
    S.box(-1.75, Y0 + 2.74, 4.45, 5.7, 0.5, 2.1, roofCol, { tz: 0.12, sz: -0.9, tx: 0.98, side: shade(roofCol, 0.85) });
    for (const [a, b] of [[-4.25, -2.9], [-0.55, 0.75]]) { S.box((a + b) / 2, Y0 + 0.75, 5.15, b - a, 0.07, 0.07, trim); for (let i = 1; i < 4; i++) S.box(a + ((b - a) * i) / 4, Y0, 5.15, 0.05, 0.75, 0.05, trim, { noTop: true }); }
    for (let i = 0; i < 2; i++) S.box(doorX, 0, 5.47 + i * 0.32, 1.7, i ? 0.1 : 0.2, 0.34, C.stoneWarm);
    door(S, doorX, Y0, 3.5, 1.05, 2.15, color, { frame: trim });
    win(S, W, -3.5, Y0 + 0.95, 3.5, 1.25, 1.5, { lit: true, shut, curtain: 0xfff7e6 });
    win(S, W, -3.3, Y0 + 3.75, 3.5, 1.05, 1.3, { lit: lit(), shut });
    win(S, W, -1.0, Y0 + 3.75, 3.5, 1.05, 1.3, { lit: lit(), shut });
    porchLamp(S, L, doorX + 0.95, Y0 + 2.0, 3.5);
    for (const px of [-4.25, 0.75]) colliders.push({ x: (mirror ? -1 : 1) * px, z: 5.15, r: 0.2 });
  } else {
    // center hall with a little portico and two dormers
    S.box(0, 0, 4.2, 3.0, Y0, 1.5, C.stoneWarm, { top: shade(C.stoneWarm, 1.08) });
    for (const px of [-1.25, 1.25]) { S.cyl(px, Y0, 4.7, 0.13, 2.5, trim, { seg: 6, top: false }); S.box(px, Y0 + 2.5, 4.7, 0.34, 0.1, 0.34, trim); }
    S.box(0, Y0 + 2.6, 4.2, 3.0, 0.2, 1.6, trim, { bottom: shade(trim, 0.8) });
    gableRoof(S, 0, Y0 + 2.8, 4.2, 1.6, 3.0, 0.8, trim, roofCol, { ry: Math.PI / 2, over: 0.14, thick: 0.12 });
    for (let i = 0; i < 2; i++) S.box(0, 0, 5.1 + i * 0.32, 2.2, i ? 0.08 : 0.19, 0.34, C.stoneWarm);
    door(S, 0, Y0, 3.5, 1.1, 2.2, color, { frame: trim });
    for (const sx of [-1, 1]) {
      win(S, W, sx * 2.9, Y0 + 0.95, 3.5, 1.35, 1.55, { lit: sx < 0 || lit(), shut, mul: '#', curtain: 0xfff7e6 });
      flowerBox(S, sx * 2.9, Y0 + 0.55, 3.5, 1.5, r, boxCol);
      win(S, W, sx * 2.9, Y0 + 3.75, 3.5, 1.1, 1.3, { lit: lit(), shut });
      // dormer
      S.box(sx * 2.4, top + 0.55, 1.5, 1.35, 1.25, 2.0, wall, { noTop: true });
      gableRoof(S, sx * 2.4, top + 1.8, 1.5, 2.0, 1.35, 0.6, wall, roofCol, { ry: Math.PI / 2, over: 0.14, thick: 0.1 });
      win(S, W, sx * 2.4, top + 0.85, 2.5, 0.7, 0.8, { lit: lit(), sill: false, ft: 0.07 });
      colliders.push({ x: sx * 1.25, z: 4.7, r: 0.2 });
    }
    win(S, W, 0, Y0 + 3.75, 3.5, 1.1, 1.3, { lit: lit(), shut });
    porchLamp(S, L, 0.95, Y0 + 2.05, 3.5);
  }
  // side and back windows
  for (const sx of [-1, 1]) {
    S.at(sx * 4.5, 0, 0, (sx * Math.PI) / 2);
    for (const wz of [-1.6, 1.6]) {
      if (sx === chimSide && wz * sx > 0) continue;
      win(S, W, wz, Y0 + 0.95, 0, 1.0, 1.45, { lit: lit() });
      win(S, W, wz, Y0 + 3.75, 0, 1.0, 1.3, { lit: lit() });
    }
    S.restore();
  }
  S.at(0, 0, -3.5, Math.PI);
  for (const bx of [-2.8, 2.8]) { win(S, W, bx, Y0 + 0.95, 0, 1.2, 1.45, { lit: lit() }); win(S, W, bx, Y0 + 3.75, 0, 1.0, 1.3, { lit: lit() }); }
  door(S, 0, Y0, 0, 0.95, 2.1, shade(wall, 0.7), { frame: trim, knob: C.metalLt });
  S.box(0, 0, 0.5, 1.6, Y0, 0.9, C.stoneWarm);
  S.restore();
  // chimney
  S.box(chimSide * 4.95, 0, -1.3, 0.9, 8.9, 1.2, C.brick, { side: C.brickDk });
  S.box(chimSide * 4.95, 8.9, -1.3, 1.1, 0.16, 1.4, C.stoneWarm);
  S.cyl(chimSide * 4.95, 9.06, -1.3, 0.2, 0.32, C.brickDk, { seg: 6, top: C.black });
  // foundation shrubs
  for (const bx of [-4.9, 4.9]) drawBush(S, bx, 0, 4.1, 1.05, r, C.hedge);
  drawBush(S, style === 0 ? 0.6 : -4.2, 0, 4.4, 0.8, r, C.leaf);
  S.restore();

  const dX = mirror ? -doorX : doorX;
  // path, hedge, mailbox
  S.box(dX, 0, 7.75, 1.5, 0.08, 3.8, P.path, { side: shade(P.path, 0.85) });
  for (let i = 0; i < 4; i++) S.quad([dX - 0.75, 0.085, 6.2 + i * 0.95], [dX + 0.75, 0.085, 6.2 + i * 0.95], [dX + 0.75, 0.085, 6.16 + i * 0.95], [dX - 0.75, 0.085, 6.16 + i * 0.95], shade(P.path, 0.82));
  const gapL = dX - 1.25, gapR = dX + 1.25;
  drawHedge(S, -9.3, 9.0, gapL, 9.0, 0.95, 0.75);
  drawHedge(S, gapR, 9.0, 9.3, 9.0, 0.95, 0.75);
  lineColliders(colliders, -9.3, 9.0, gapL - 0.3, 9.0, 0.45);
  lineColliders(colliders, gapR + 0.3, 9.0, 9.3, 9.0, 0.45);
  for (const sx of [-1, 1]) { S.sphere(dX + sx * 1.25, 1.2, 9.0, 0.46, C.leaf, { seg: 6, rings: 4 }); }
  const mbx = dX + 1.75;
  drawMailbox(S, mbx, 0, 9.7, color, 'nice');
  colliders.push({ x: mbx, z: 9.7, r: 0.3 });
  // a tree in the back corner and the yard-of-the-month brag
  const tx = mirror ? 7.2 : -7.2;
  drawTree(S, 'round', tx, 0, -6.8, 1.15, r);
  colliders.push({ x: tx, z: -6.8, r: 0.45 });
  const sgx = dX - 3.4;
  S.box(sgx, 0, 7.6, 0.05, 0.75, 0.05, C.metalLt);
  S.box(sgx, 0.42, 7.63, 1.15, 0.42, 0.04, C.white, { bottom: true });
  S.text('#1 LAWN', sgx, 0.54, 7.655, 0.034, C.leafDk);
  // a flag on an angled pole, upstairs between the windows
  const fpx = (mirror ? -1 : 1) * (style === 0 ? -2.15 : 1.45), fz = 3.5, fside = mirror ? -1 : 1;
  const tipX = fpx + fside * 0.75, tipY = Y0 + 4.5, tipZ = fz + 1.05;
  S.box(fpx, Y0 + 3.5, fz + 0.04, 0.16, 0.2, 0.08, trim);
  S.tube([[fpx, Y0 + 3.6, fz + 0.05], [tipX, tipY, tipZ]], 0.03, C.metalLt, { seg: 3 });
  S.sphere(tipX + fside * 0.03, tipY + 0.04, tipZ + 0.04, 0.06, C.gold, { seg: 4, rings: 2 });
  const fg = flagGeo(1.2, 0.85, color, {});
  const flag = fg.mesh(flatMat); flag.name = 'flag';
  flag.position.set(tipX, tipY - 0.03, tipZ);
  const flagYaw = fside > 0 ? 2.214 : 0.927;
  flag.rotation.set(0, flagYaw, -0.6);
  S.shadeY(0, 2.4, 0.9);

  const wallX = dX + 1.3;
  return finish('heights', K, {
    lot: { w: 20, d: 20 },
    footprint: { w: 9.9, d: 8.4 },
    colliders,
    emissive: 0xffc66b,
    children: [flag],
    own: [flag.geometry],
    anchors: {
      door: V3(dX, Y0, style === 0 ? 4.6 : 4.4), mailbox: V3(mbx, 0, 9.7), lawn: V3(dX < 0 ? 5.6 : -5.6, 0, 6.9), curb: V3(dX, 0, 10),
      roof: V3(0, top + 2.6, 0), sign: V3(dX + 3.0, 0, 7.4), goalposts: V3(dX < 0 ? 4.6 : -4.6, 0, -6.6), resident: V3(dX + 2.4, 0, 6.6),
      trophy: V3(dX < 0 ? 7.2 : -7.2, 0, 7.6), plaque: V3(wallX, Y0 + 1.5, 3.6), truck: V3(-dX * 0.6, 0, 12.2),
      decor: [V3(-4.56, Y0 + 2.2, 0), V3(4.56, Y0 + 2.2, 0), V3(0, top + 1.3, 1.9), V3(tx, 3.2, -6.8), V3(mbx, 1.45, 9.7), V3(dX < 0 ? 4.4 : -4.4, 0, 6.2)],
    },
    update(dt, t) {
      const m = motion();
      flag.rotation.y = flagYaw + Math.sin(t * 1.3 + seed) * 0.16 * m;
      flag.rotation.x = Math.sin(t * 2.1 + seed) * 0.05 * m;
    },
  });
}

// ---- THE BUBBLE: relentlessly beige --------------------------------------------------------------
function buildBubble(color) {
  const r = rng(4242), P = PALETTE.bubble, K = kit(), { S, W, L } = K;
  const wall = P.wall, roofCol = P.roof, trim = P.trim, colliders = [];
  const Y0 = 0.15, WH = 2.7, top = Y0 + WH;

  // the lawn: a little yellow, a little patchy
  S.box(0, 0, 0, 17.4, 0.04, 17.4, P.grass, { side: shade(P.grass, 0.8) });
  const patch = (x, z, rr, col, sx = 1.4) => S.disc(x, 0.07, z, rr, col, { seg: 7, sx, ry: x });
  patch(-5.5, 6.2, 1.3, 0xb9b262); patch(-2.2, 7.6, 0.8, 0xa9a05a, 1.8); patch(-6.8, -6.2, 1.5, 0xb9b262); patch(5.5, -6.6, 1.0, 0xa58f58); patch(-7.3, 2.0, 0.7, 0xa58f58);
  // driveway and walk
  S.box(3.75, 0, 6.6, 3.7, 0.07, 4.2, C.concrete, { side: C.concreteDk });
  S.quad([2.0, 0.075, 6.3], [5.5, 0.075, 6.3], [5.5, 0.075, 6.26], [2.0, 0.075, 6.26], C.concreteDk);
  S.disc(4.3, 0.078, 5.6, 0.45, 0x8e8b80, { seg: 6, sx: 1.5 });
  S.box(-0.2, 0, 5.2, 1.1, 0.07, 3.0, C.concrete, { side: C.concreteDk });
  S.box(0.9, 0, 6.2, 1.3, 0.07, 1.0, C.concrete, { side: C.concreteDk });

  // main block and garage
  S.box(-2.0, 0, 0, 7.6, Y0, 7.1, C.concreteDk);
  S.box(-2.0, Y0, 0, 7.5, WH, 7, wall, { side: shade(wall, 0.95), noTop: true });
  S.box(3.75, 0, 0.75, 4.1, Y0, 7.6, C.concreteDk);
  S.box(3.75, Y0, 0.75, 4.0, WH, 7.5, wall, { side: shade(wall, 0.95), noTop: true });
  hipRoof(S, -2.0, top, 0, 8.4, 7.9, 1.55, roofCol, 2.6);
  gableRoof(S, 3.75, top, 0.75, 7.5, 4.0, 1.25, wall, roofCol, { ry: Math.PI / 2, over: 0.4 });
  S.box(3.75, top + 0.35, 4.51, 0.5, 0.35, 0.05, trim);
  // garage door
  S.box(3.75, Y0, 4.5, 3.3, 2.25, 0.1, trim);
  S.quad([2.25, Y0, 4.57], [5.25, Y0, 4.57], [5.25, Y0 + 2.1, 4.57], [2.25, Y0 + 2.1, 4.57], 0xe9e2cf);
  for (let i = 1; i < 4; i++) S.quad([2.25, Y0 + i * 0.525, 4.578], [5.25, Y0 + i * 0.525, 4.578], [5.25, Y0 + i * 0.525 + 0.035, 4.578], [2.25, Y0 + i * 0.525 + 0.035, 4.578], 0xc9c0a8);
  S.box(3.75, Y0 + 0.9, 4.6, 0.3, 0.05, 0.05, C.metalDk);
  // front door on a little stoop
  S.box(-0.2, 0, 3.95, 1.6, Y0, 0.9, C.concrete);
  door(S, -0.2, Y0, 3.5, 0.98, 2.1, color, { frame: trim, knob: C.metalLt });
  S.box(-0.2, Y0, 4.0, 0.8, 0.02, 0.5, 0x7a6a4e, { ry: 0.12 });
  porchLamp(S, L, 0.65, Y0 + 2.0, 3.5);
  // picture window, blinds almost all the way down, one slat bent for peeking
  win(S, W, -3.7, Y0 + 0.85, 3.5, 2.5, 1.45, { lit: true, frame: trim, mul: '|', blind: 0.8, blindColor: 0xece5d2 });
  W.quad([-3.2, Y0 + 1.42, 3.5 + 0.09], [-2.75, Y0 + 1.38, 3.5 + 0.09], [-2.75, Y0 + 1.53, 3.5 + 0.09], [-3.2, Y0 + 1.5, 3.5 + 0.09], 0x39485a);
  // side and back windows
  S.at(-5.75, 0, 0, -Math.PI / 2);
  win(S, W, -1.4, Y0 + 1.1, 0, 1.0, 1.1, { lit: false, frame: trim, blind: 1, mul: '' });
  win(S, W, 1.6, Y0 + 1.4, 0, 0.7, 0.7, { lit: true, frame: trim, mul: '' });
  S.restore();
  S.at(5.75, 0, 0.75, Math.PI / 2);
  win(S, W, 0, Y0 + 1.3, 0, 0.9, 0.9, { lit: false, frame: trim, mul: '+' });
  S.restore();
  S.at(-2.0, 0, -3.5, Math.PI);
  win(S, W, -1.8, Y0 + 1.0, 0, 1.3, 1.2, { lit: true, frame: trim, blind: 0.5 });
  win(S, W, 1.9, Y0 + 0.1, 0, 1.7, 2.0, { lit: false, frame: trim, mul: '|', sill: false });
  S.restore();
  // AC unit, hose reel, the hose itself
  S.box(-6.35, 0, -1.4, 0.75, 0.75, 0.8, C.metal, { top: C.metalDk });
  S.cyl(-6.74, 0.38, -1.4, 0.26, 0.02, C.metalDk, { seg: 8, rz: Math.PI / 2 });
  S.at(-1.55, Y0 + 0.85, 3.52);
  S.rotX(Math.PI / 2);
  drawTire(S, 0, 0, 0, 0.3, 0.14, { color: 0x3f8f4f, hub: C.metalDk });
  S.restore();
  S.tube([[-1.55, 0.72, 3.66], [-1.6, 0.1, 4.15], [-2.6, 0.09, 5.2], [-2.0, 0.09, 6.2], [-3.4, 0.09, 7.0], [-4.9, 0.09, 6.5], [-5.6, 0.09, 7.2]], 0.045, 0x3f8f4f, { seg: 4 });
  S.box(-5.68, 0.06, 7.3, 0.07, 0.07, 0.22, C.caution, { ry: -0.7 });
  // sad shrubs and a staked sapling
  drawBush(S, -4.6, 0, 4.15, 0.62, r, 0x7f9a4e);
  drawBush(S, -2.9, 0, 4.1, 0.5, r, 0x9a9150);
  S.cyl(-6.2, 0, 5.2, 0.05, 1.5, C.woodDk, { seg: 4 });
  S.box(-5.95, 0, 5.2, 0.05, 1.2, 0.05, C.woodLt);
  S.box(-6.08, 0.9, 5.2, 0.3, 0.04, 0.03, C.tape);
  S.ico(-6.2, 1.75, 5.2, 0.5, 0x8aa653, { jitter: 0.12, rnd: r });
  colliders.push({ x: -6.2, z: 5.2, r: 0.25 });
  // unread newspapers piling up on the driveway
  for (const [nx, nz, ry] of [[2.7, 7.6, 0.4], [3.1, 8.0, 1.6], [2.5, 8.2, 2.5]]) {
    S.at(nx, 0.14, nz, ry);
    S.cyl(-0.18, 0, 0, 0.075, 0.36, 0xdedbd0, { seg: 5, rz: -Math.PI / 2, bottom: true });
    S.cyl(0.0, 0, 0, 0.08, 0.04, C.red, { seg: 5, rz: -Math.PI / 2 });
    S.restore();
  }
  drawMailbox(S, 1.35, 0, 8.4, color, 'plain');
  colliders.push({ x: 1.35, z: 8.4, r: 0.3 });
  S.shadeY(0, 2.0, 0.9);

  return finish('bubble', K, {
    lot: { w: 18, d: 18 },
    footprint: { w: 11.7, d: 8.2 },
    colliders,
    emissive: 0xfff0c8,
    glow: 0.85,
    anchors: {
      door: V3(-0.2, Y0, 4.25), mailbox: V3(1.35, 0, 8.4), lawn: V3(-5.2, 0, 6.6), curb: V3(-0.2, 0, 9), roof: V3(-2, top + 1.7, 0),
      sign: V3(-2.6, 0, 7.9), goalposts: V3(-5.6, 0, -6.2), resident: V3(0.9, 0, 6.3), trophy: V3(-7.2, 0, 7.4),
      plaque: V3(0.95, Y0 + 1.5, 3.6), truck: V3(-3.5, 0, 11.2),
      decor: [V3(-5.3, Y0 + 1.6, 3.62), V3(3.75, Y0 + 2.4, 4.62), V3(-2, top + 0.8, 2.6), V3(-6.2, 1.9, 5.2), V3(1.35, 1.35, 8.4), V3(-4.0, 0, 6.0)],
    },
  });
}

// ---- WAIVER WIRE TRAILER PARK ---------------------------------------------------------------------
function buildPark(color, seed) {
  const r = rng(seed * 17 + 3), P = PALETTE.park, K = kit(), { S, W, L } = K;
  const body = P.wall, colliders = [];
  const Y0 = 0.6, H = 2.55, top = Y0 + H, LEN = 9.6, D = 3.0, hx = LEN / 2, hz = D / 2;

  // packed dirt and weeds
  S.disc(-1, 0.04, 3.6, 2.6, P.path, { seg: 8, sx: 2.2 });
  S.disc(4.8, 0.045, 4.2, 1.1, shade(P.path, 0.9), { seg: 6, sx: 1.4 });
  for (let i = 0; i < 7; i++) { const wx = -6.8 + r() * 13.6, wz = (r() < 0.5 ? -1 : 1) * (2.4 + r() * 3.6); S.cone(wx, 0, wz, 0.16, 0.45, 0x7c8a45, { seg: 3, ry: r() * 3 }); S.cone(wx + 0.14, 0, wz + 0.08, 0.1, 0.32, 0x8d9a4c, { seg: 3 }); }
  // cinder blocks
  for (const bx of [-4.2, -1.4, 1.4, 4.2]) for (const bz of [-1.15, 1.15]) {
    S.box(bx, 0, bz, 0.42, 0.21, 0.24, C.concreteDk);
    S.box(bx + 0.03, 0.21, bz, 0.42, 0.21, 0.24, C.concrete, { ry: 0.12 });
    S.box(bx, 0.42, bz, 0.5, 0.18, 0.2, C.wood);
  }
  S.box(0, 0.36, 0, LEN - 0.5, 0.24, D - 0.5, 0x2b2c30, { bottom: true });
  // the hitch
  S.tube([[-hx, Y0 + 0.1, 0.7], [-hx - 1.5, Y0 + 0.05, 0], [-hx, Y0 + 0.1, -0.7]], 0.06, C.rustDk, { seg: 4 });
  S.cyl(-hx - 1.4, 0, 0, 0.05, Y0 + 0.1, C.metalDk, { seg: 4 });
  S.box(-hx - 1.4, 0, 0, 0.3, 0.05, 0.3, C.metalDk);
  // body: skirt, team stripe, upper shell, bowed roof
  const lower = shade(body, 0.86);
  S.box(0, Y0, 0, LEN, 0.75, D, lower, { bottom: 0x2b2c30, noTop: true });
  S.box(0, Y0 + 0.75, 0, LEN + 0.04, 0.34, D + 0.04, color, { noTop: true });
  S.box(0, Y0 + 1.09, 0, LEN + 0.05, 0.06, D + 0.05, C.white, { noTop: true });
  S.box(0, Y0 + 1.15, 0, LEN, H - 1.15, D, body, { noTop: true });
  S.box(0, top, 0, LEN + 0.16, 0.1, D + 0.16, P.roof);
  S.box(0, top + 0.1, 0, LEN + 0.1, 0.16, D + 0.1, shade(P.roof, 1.1), { tz: 0.55, tx: 0.98 });
  // rust and grime
  const streak = (x, z, sgn, h, w = 0.14) => S.quad([x - w / 2, top - h, z + sgn * 0.012], [x + w / 2, top - h * 0.8, z + sgn * 0.012], [x + w / 2, top, z + sgn * 0.012], [x - w / 2, top, z + sgn * 0.012], C.rust);
  for (let i = 0; i < 5; i++) { const sx = -4.3 + r() * 8.6; streak(sx, hz, 1, 0.3 + r() * 0.5); }
  S.at(0, 0, -hz, Math.PI); for (let i = 0; i < 4; i++) S.quad([-4 + i * 2.3, top - 0.6, 0.012], [-3.85 + i * 2.3, top - 0.45, 0.012], [-3.85 + i * 2.3, top, 0.012], [-4 + i * 2.3, top, 0.012], C.rust); S.restore();
  S.quad([hx - 1.6, Y0, hz + 0.012], [hx, Y0, hz + 0.012], [hx, Y0 + 0.4, hz + 0.012], [hx - 0.9, Y0 + 0.22, hz + 0.012], C.rust);
  S.quad([-hx, Y0, hz + 0.012], [-hx + 1.1, Y0, hz + 0.012], [-hx + 0.5, Y0 + 0.3, hz + 0.012], [-hx, Y0 + 0.5, hz + 0.012], C.rustDk);

  // screen door (patched) and steps
  const dx = -1.5;
  S.box(dx, Y0, hz + 0.03, 1.02, 2.06, 0.08, C.metalLt);
  S.quad([dx - 0.42, Y0 + 0.06, hz + 0.075], [dx + 0.42, Y0 + 0.06, hz + 0.075], [dx + 0.42, Y0 + 1.96, hz + 0.075], [dx - 0.42, Y0 + 1.96, hz + 0.075], 0x4d5a5e);
  S.quad([dx - 0.42, Y0 + 0.06, hz + 0.08], [dx + 0.42, Y0 + 0.06, hz + 0.08], [dx + 0.42, Y0 + 0.7, hz + 0.08], [dx - 0.42, Y0 + 0.7, hz + 0.08], C.metal);
  S.quad([dx - 0.42, Y0 + 0.98, hz + 0.082], [dx + 0.42, Y0 + 0.98, hz + 0.082], [dx + 0.42, Y0 + 1.06, hz + 0.082], [dx - 0.42, Y0 + 1.06, hz + 0.082], C.metalLt);
  // duct tape X and a square patch
  S.at(dx + 0.05, Y0 + 1.5, hz + 0.086, 0, 0, 0.7); S.quad([-0.3, -0.05, 0], [0.3, -0.05, 0], [0.3, 0.05, 0], [-0.3, 0.05, 0], C.tape); S.restore();
  S.at(dx + 0.05, Y0 + 1.5, hz + 0.088, 0, 0, -0.7); S.quad([-0.3, -0.05, 0], [0.3, -0.05, 0], [0.3, 0.05, 0], [-0.3, 0.05, 0], C.tape); S.restore();
  S.at(dx - 0.18, Y0 + 1.22, hz + 0.086, 0, 0, 0.15); S.quad([-0.13, -0.1, 0], [0.13, -0.1, 0], [0.13, 0.1, 0], [-0.13, 0.1, 0], 0xb8a27a); S.restore();
  S.box(dx + 0.36, Y0 + 0.98, hz + 0.1, 0.05, 0.14, 0.05, C.metalDk);
  for (let i = 0; i < 3; i++) S.box(dx + (i === 1 ? 0.04 : 0), 0, hz + 0.3 + i * 0.3, 1.2, Y0 - 0.02 - i * 0.2, 0.3, i % 2 ? C.wood : C.woodLt, { ry: i === 2 ? 0.06 : 0 });
  porchLamp(S, L, dx + 0.85, Y0 + 2.0, hz, 0.9);
  // windows: one with an AC unit propped on a stick, one patched with cardboard
  win(S, W, -3.55, Y0 + 1.25, hz, 1.1, 0.8, { lit: true, frame: C.metalLt, mul: '|', curtain: 0xd9b36a });
  win(S, W, 0.9, Y0 + 1.25, hz, 1.3, 0.8, { lit: true, frame: C.metalLt, mul: '|', blind: 0.35, blindColor: 0xcfc4a2 });
  win(S, W, 3.4, Y0 + 1.25, hz, 1.1, 0.8, { lit: false, frame: C.metalLt, mul: '' });
  S.at(3.62, Y0 + 1.5, hz + 0.09, 0, 0, -0.1); S.quad([-0.33, -0.27, 0], [0.33, -0.27, 0], [0.33, 0.27, 0], [-0.33, 0.27, 0], C.cardboard);
  S.quad([-0.4, 0.2, 0.004], [0.4, 0.2, 0.004], [0.4, 0.29, 0.004], [-0.4, 0.29, 0.004], C.tape); S.quad([-0.38, -0.3, 0.004], [-0.3, -0.3, 0.004], [-0.3, 0.3, 0.004], [-0.38, 0.3, 0.004], C.tape); S.restore();
  S.box(-3.55, Y0 + 1.25, hz + 0.32, 0.72, 0.46, 0.5, 0xd5d2c6, { front: 0x8f9597 });
  S.tube([[-3.55, Y0 + 1.25, hz + 0.5], [-3.4, 0, hz + 0.95]], 0.035, C.woodLt, { seg: 3 });
  S.quad([-3.75, Y0 + 0.75, hz + 0.03], [-3.6, Y0 + 0.75, hz + 0.03], [-3.6, Y0 + 1.2, hz + 0.03], [-3.75, Y0 + 1.2, hz + 0.03], 0x7d8f93);
  // end and back windows
  S.at(hx, 0, 0, Math.PI / 2); win(S, W, 0, Y0 + 1.25, 0, 1.3, 0.8, { lit: true, frame: C.metalLt, mul: '+' }); S.restore();
  S.at(0, 0, -hz, Math.PI); win(S, W, -2.6, Y0 + 1.35, 0, 0.9, 0.6, { lit: false, frame: C.metalLt, mul: '' }); win(S, W, 2.2, Y0 + 1.25, 0, 1.2, 0.8, { lit: true, frame: C.metalLt, mul: '|' }); S.restore();

  // on the roof: crooked antenna, satellite dish, tarp held down by a tire and a brick
  S.at(2.9, top + 0.2, -0.5, 0, 0.1, 0.2);
  S.cyl(0, 0, 0, 0.035, 2.3, C.metalDk, { seg: 4 });
  for (let i = 0; i < 4; i++) S.box(0, 1.2 + i * 0.3, 0, 1.2 - i * 0.22, 0.035, 0.035, C.metalLt, { ry: 0.25, rz: i === 2 ? 0.2 : 0 });
  S.box(0, 1.15, 0, 0.035, 0.035, 1.0, C.metalLt);
  S.restore();
  S.cyl(-4.2, top + 0.2, 0.9, 0.04, 0.5, C.metalDk, { seg: 4 });
  S.at(-4.2, top + 0.85, 0.95, -0.5, -0.9);
  S.lathe(0, 0, 0, [[0.05, 0], [0.36, 0.1], [0.5, 0.22]], C.metalLt, { seg: 8, capTop: false });
  S.band(0.5, 0.22, 0.36, 0.1, 8, Math.PI / 8, 0xe9edf0);
  S.band(0.36, 0.1, 0.05, 0, 8, Math.PI / 8, 0xe9edf0);
  S.tube([[0, 0.2, 0], [0, 0.55, 0.18]], 0.02, C.metalDk, { seg: 3 });
  S.restore();
  const tarp = C.tarp;
  S.quad2([hx - 3.0, top + 0.29, -hz - 0.1], [hx + 0.14, top + 0.24, -hz - 0.1], [hx + 0.14, top + 0.3, 0.6], [hx - 2.7, top + 0.31, 0.75], tarp, C.tarpDk);
  S.quad2([hx + 0.15, top + 0.24, -hz - 0.1], [hx + 0.2, top - 1.3, -hz - 0.2], [hx + 0.22, top - 0.9, 0.5], [hx + 0.15, top + 0.3, 0.6], C.tarpDk, tarp);
  S.quad2([hx - 3.0, top + 0.29, -hz - 0.1], [hx - 2.6, top - 0.8, -hz - 0.16], [hx + 0.2, top - 1.3, -hz - 0.2], [hx + 0.14, top + 0.24, -hz - 0.1], shade(tarp, 0.9), tarp);
  drawTire(S, hx - 1.3, top + 0.31, -0.3, 0.36, 0.22);
  S.box(hx - 2.2, top + 0.31, 0.3, 0.3, 0.12, 0.16, C.brick, { ry: 0.5 });

  // the yard: plastic chair, tire planter, propane, cooler, clothesline
  drawPlasticChair(S, 1.6, 0, 3.6, { ry: -0.5 });
  colliders.push({ x: 1.6, z: 3.6, r: 0.4 });
  drawTire(S, 3.9, 0, 4.4, 0.42, 0.26);
  S.cone(3.9, 0.2, 4.4, 0.16, 0.5, 0x7c8a45, { seg: 4 }); S.sphere(3.95, 0.72, 4.42, 0.09, 0xffd23f, { seg: 4, rings: 2 });
  drawTire(S, -5.6, 0.36, 2.1, 0.36, 0.22, { rx: Math.PI / 2, rz: 0.25, both: true });
  S.lathe(hx + 0.55, 0, 1.0, [[0.2, 0], [0.22, 0.1], [0.22, 0.55], [0.12, 0.72, C.metalDk], [0.12, 0.8]], 0xe6e6e0, { seg: 7 });
  S.box(-0.2, 0, 4.5, 0.66, 0.36, 0.4, 0xc23b3b, { ry: 0.3 }); S.box(-0.2, 0.36, 4.5, 0.7, 0.09, 0.44, C.white, { ry: 0.3 });
  const p0 = [5.6, 0, -4.4], p1 = [-5.8, 0, -4.9];
  for (const p of [p0, p1]) { S.cyl(p[0], 0, p[2], 0.05, 2.0, C.woodDk, { seg: 4, rz: p === p0 ? 0.06 : -0.08 }); colliders.push({ x: p[0], z: p[2], r: 0.2 }); }
  S.tube([[5.5, 1.95, -4.4], [0, 1.6, -4.65], [-5.65, 1.95, -4.9]], 0.015, 0xd8d8d2, { seg: 3 });
  const hang = (x, w, h, col, sleeves) => {
    const y = 1.63 + Math.abs(x) * 0.055, z = -4.65 + x * 0.045;
    S.quad2([x - w / 2, y - h, z], [x + w / 2, y - h, z], [x + w / 2, y, z], [x - w / 2, y, z], col, shade(col, 0.85));
    if (sleeves) { S.quad2([x - w / 2 - 0.2, y - 0.3, z], [x - w / 2, y - 0.34, z], [x - w / 2, y, z], [x - w / 2 - 0.2, y - 0.04, z], col, shade(col, 0.85)); S.quad2([x + w / 2, y - 0.34, z], [x + w / 2 + 0.2, y - 0.3, z], [x + w / 2 + 0.2, y - 0.04, z], [x + w / 2, y, z], col, shade(col, 0.85)); }
  };
  hang(-1.6, 0.6, 0.7, color, true); hang(0.2, 0.5, 0.55, 0xe6e2d6, false); hang(1.6, 0.42, 0.8, 0x6b7f9a, false); hang(-3.3, 0.7, 0.5, 0xd9b36a, false);
  drawMailbox(S, 4.6, 0, 5.9, color, 'dented');
  colliders.push({ x: 4.6, z: 5.9, r: 0.3 });
  S.shadeY(0, 1.6, 0.88);

  let tv = 0;
  return finish('park', K, {
    lot: { w: 15, d: 13 },
    footprint: { w: LEN + 0.3, d: D + 0.3 },
    colliders,
    emissive: 0x9fc4ff,
    anchors: {
      door: V3(dx, 0, hz + 1.5), mailbox: V3(4.6, 0, 5.9), lawn: V3(-4.6, 0, 4.4), curb: V3(dx, 0, 6.5), roof: V3(0, top + 0.26, 0),
      sign: V3(-3.0, 0, 5.6), goalposts: V3(5.6, 0, 3.2), resident: V3(1.2, 0, 4.4), trophy: V3(-6.2, 0, 5.2),
      plaque: V3(dx - 1.0, Y0 + 1.5, hz + 0.1), truck: V3(0, 0, 8.6),
      decor: [V3(2.2, Y0 + 1.7, hz + 0.1), V3(-4.4, Y0 + 2.1, hz + 0.1), V3(0, top + 0.3, 0.6), V3(5.6, 2.0, -4.4), V3(4.6, 1.35, 5.9), V3(-2.4, 0, 4.6)],
    },
    update(dt, t, night, winMat) {
      // somebody left the TV on
      const k = isFinite(t) ? stepRand(t, 7, seed) : 0.5;
      tv += (k - tv) * Math.min(1, dt * 14);
      const m = motion(), f = 0.78 + (tv - 0.5) * 0.5 * m;
      winMat.emissive.setRGB(0.5 * f, 0.68 * f, 1.0 * f);
    },
  });
}

// ---- THE DUMP: a tent on a garbage heap ------------------------------------------------------------
const HEAP_H = 4.0, HEAP_TOP = 3.3;
function heapR(a) {
  // the heap bulges toward the street (+Z) so the climb to the tent is gentler there
  return 9.3 + 1.1 * Math.sin(a) + 0.5 * Math.sin(a * 3 + 1.3) + 0.3 * Math.sin(a * 5 + 0.4);
}
function heapH(x, z) {
  const d = Math.hypot(x, z);
  if (d <= HEAP_TOP) return HEAP_H;
  const R = heapR(Math.atan2(z, x));
  if (d >= R) return 0;
  const t = (d - HEAP_TOP) / (R - HEAP_TOP);
  return HEAP_H * (0.5 + 0.5 * Math.cos(Math.PI * t)) * (1 - 0.12 * t * (1 - t) * 4 * Math.sin(x * 0.9) * Math.cos(z * 0.8));
}

function buildDump(color, seed) {
  const r = rng(seed * 19 + 7), P = PALETTE.dump, K = kit(), { S, W, L } = K;
  const colliders = [], H = HEAP_H;
  const at = (a, d) => { const x = Math.cos(a) * d, z = Math.sin(a) * d; return [x, heapH(x, z), z]; };

  // the heap itself
  const SEG = 18, RINGS = 5, tones = [P.grass, P.path, 0x5a5f48, 0x5f5340, 0x6a6048, 0x4f5540];
  S.jit = 0.08;
  const ring = [];
  for (let j = 0; j <= RINGS; j++) {
    const row = [];
    for (let i = 0; i < SEG; i++) {
      const a = (TAU * (i + (j % 2) * 0.5)) / SEG, R = heapR(a) + (j === RINGS ? 0.5 : 0);
      const d = HEAP_TOP + ((R - HEAP_TOP) * j) / RINGS;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      row.push([x, j === RINGS ? 0 : heapH(x, z), z]);
    }
    ring.push(row);
  }
  const below = [0, -60, 0];
  for (let i = 0; i < SEG; i++) S.triOut([0, H, 0], ring[0][(i + 1) % SEG], ring[0][i], i % 3 ? 0x6a6048 : P.path, below);
  for (let j = 0; j < RINGS; j++) for (let i = 0; i < SEG; i++) {
    const i1 = (i + 1) % SEG, a = ring[j][i], b = ring[j][i1], c = ring[j + 1][i], d = ring[j + 1][i1];
    const ca = tones[Math.floor(r() * tones.length)], cb = tones[Math.floor(r() * tones.length)];
    if (j % 2 === 0) { S.triOut(a, b, c, ca, below); S.triOut(b, d, c, cb, below); } else { S.triOut(a, b, d, ca, below); S.triOut(a, d, c, cb, below); }
  }
  S.jit = 0;

  // litter
  const litter = [0xe9e6dc, 0xffd23f, 0x5aa9e6, 0xe9e6dc, 0xd96b6b, 0xc9c2a8];
  for (let i = 0; i < 16; i++) {
    const p = at(r() * TAU, 4 + r() * 5.6), s = 0.14 + r() * 0.12;
    S.at(p[0], p[1] + 0.07, p[2], r() * TAU, (r() - 0.5) * 0.8, (r() - 0.5) * 0.8);
    S.quad2([-s, 0, -s * 0.7], [-s, 0, s * 0.7], [s, 0, s * 0.7], [s, 0, -s * 0.7], litter[i % litter.length]);
    S.restore();
  }
  // bags, everywhere
  const bagCols = [C.bag, C.bag, C.bagAlt, C.bag, 0x2e3138, C.bagWhite];
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * TAU + r() * 0.3, d = 4.1 + ((i * 37) % 10) * 0.52 + r() * 0.4;
    const p = at(a, Math.min(d, heapR(a) - 0.6));
    drawBag(S, p[0], p[1] - 0.12, p[2], 0.95 + r() * 0.5, bagCols[i % bagCols.length], r, i % 5 === 0 ? C.caution : C.red);
  }
  // boxes
  for (let i = 0; i < 7; i++) {
    const a = 0.5 + (i / 7) * TAU + r() * 0.4, p = at(a, 4.6 + r() * 4.2), s = 0.5 + r() * 0.4;
    drawCardboardBox(S, p[0], p[1] - 0.1, p[2], s, s * 0.8, s * 0.9, { ry: r() * 3, rx: (r() - 0.5) * 0.5, rz: (r() - 0.5) * 0.5, flaps: i % 2 === 0, color: i % 3 ? C.cardboard : C.cardboardDk });
  }
  // tires
  for (const [a, d, tilt] of [[0.4, 8.2, 0.3], [2.6, 6.2, 1.2], [4.1, 7.8, 0.2], [5.4, 5.4, 1.4], [1.9, 9.0, 0.1]]) {
    const p = at(a, d);
    drawTire(S, p[0], p[1] + 0.05, p[2], 0.42, 0.26, { ry: a * 3, rx: tilt, both: tilt > 0.5 });
  }
  // the fridge, door hanging open
  {
    const p = at(2.45, 5.6);
    S.at(p[0], p[1] - 0.25, p[2], -0.4, -0.22, 0.12);
    S.box(0, 0, 0, 0.8, 1.7, 0.72, 0xe4e6e2, { front: 0x3a4046 });
    S.box(0, 0.85, 0.3, 0.7, 0.03, 0.1, 0xb9bfc6);
    S.at(-0.4, 0, 0.36, -1.9); S.box(0.4, 0.04, 0.03, 0.8, 1.1, 0.06, 0xd8dad6); S.box(0.7, 0.5, 0.07, 0.04, 0.3, 0.04, C.metalDk); S.restore();
    S.restore();
    colliders.push({ x: p[0], z: p[2], r: 0.7 });
  }
  // a broken TV with rabbit ears
  {
    const p = at(0.95, 5.9);
    S.at(p[0], p[1] - 0.06, p[2], 0.9, -0.2, 0.2);
    S.box(0, 0, 0, 0.8, 0.62, 0.55, 0x6b4a36, { tz: 0.85 });
    S.quad([-0.3, 0.1, 0.277], [0.2, 0.1, 0.277], [0.2, 0.52, 0.277], [-0.3, 0.52, 0.277], 0x2c3a3a);
    S.tri([-0.2, 0.12, 0.28], [-0.02, 0.33, 0.28], [-0.12, 0.5, 0.28], 0x9fb5b0).tri([-0.02, 0.33, 0.28], [0.15, 0.2, 0.28], [0.1, 0.45, 0.28], 0x7f9892);
    S.box(0.3, 0.38, 0.28, 0.07, 0.07, 0.03, C.metal); S.box(0.3, 0.2, 0.28, 0.07, 0.07, 0.03, C.metal);
    S.tube([[0, 0.62, 0], [-0.3, 1.15, 0.05]], 0.015, C.metalLt, { seg: 3 }); S.tube([[0, 0.62, 0], [0.34, 1.05, -0.05]], 0.015, C.metalLt, { seg: 3 });
    S.restore();
  }
  // traffic cone, barrel, mattress, fish bones, banana peel
  { const p = at(1.45, 8.1); drawTrafficCone(S, p[0], p[1] - 0.02, p[2], 1.3, { rz: 0.35, ry: 1 }); }
  { const p = at(3.6, 5.0); S.cyl(p[0], p[1] - 0.2, p[2], 0.34, 0.95, C.rust, { seg: 8, rx: 0.5, rz: 0.3, top: C.rustDk }); }
  {
    const p = at(4.75, 6.0);
    S.at(p[0], p[1] + 0.1, p[2], 0.6, -1.0, 0.05);
    S.box(0, 0, 0, 1.3, 1.9, 0.22, 0xd9d2c0, { bottom: true });
    for (let i = 0; i < 4; i++) S.quad([-0.5 + i * 0.3, 0.05, 0.112], [-0.4 + i * 0.3, 0.05, 0.112], [-0.4 + i * 0.3, 1.85, 0.112], [-0.5 + i * 0.3, 1.85, 0.112], 0x8fa3b8);
    S.quad([0.1, 0.8, 0.114], [0.45, 0.7, 0.114], [0.5, 1.2, 0.114], [0.15, 1.25, 0.114], 0xa58f58);
    S.restore();
  }
  {
    const p = at(1.75, 6.7);
    S.at(p[0], p[1] + 0.09, p[2], 0.6, -1.25, 0);
    S.box(0, 0, 0, 0.6, 0.03, 0.03, C.white);
    for (let i = 0; i < 4; i++) S.box(-0.16 + i * 0.12, -0.09, 0, 0.025, 0.2, 0.025, C.white);
    S.tri2([0.3, 0.015, 0], [0.5, 0.13, 0], [0.5, -0.1, 0], C.white); S.tri2([-0.3, 0.015, 0], [-0.46, -0.11, 0], [-0.46, 0.14, 0], C.white);
    S.restore();
  }
  {
    const p = at(1.2, 4.3);
    for (let i = 0; i < 3; i++) { S.at(p[0], p[1] + 0.05, p[2], (i * TAU) / 3); S.quad2([-0.06, 0.1, 0], [0.06, 0.1, 0], [0.04, 0.02, 0.3], [-0.04, 0.02, 0.3], 0xf5d547, 0xfaf0b0); S.restore(); }
    S.cone(p[0], p[1] + 0.05, p[2], 0.07, 0.14, 0xf5d547, { seg: 4 });
  }

  // a few bright things that used to be somebody's
  { const p = at(5.9, 6.6); drawFlamingo(S, p[0], p[1] - 0.2, p[2], 1.0, 0, 2.0); }
  {
    const p = at(0.2, 5.2);
    S.at(p[0], p[1] + 0.1, p[2], 0.4, 0.5, 0.9);
    S.cyl(0, 0, 0, 0.02, 1.0, C.metalDk, { seg: 3 });
    S.jit = 0.12; S.band(0.75, 0.62, 0, 0.95, 6, 0, 0xc23b3b); S.band(0, 0.95, 0.75, 0.62, 6, 0, 0x8a2a2a); S.jit = 0;
    S.restore();
  }
  for (const [a, d, ry] of [[3.1, 7.6, 0.4], [3.2, 7.2, 1.1]]) { const p = at(a, d); S.box(p[0], p[1] + 0.02, p[2], 0.5, 0.06, 0.5, 0xe9e6dc, { ry, rx: 0.3, top: 0xd96b6b }); }

  // ---- the tent ------------------------------------------------------------------------------
  const tent = mix(P.wall, 0xb9b487, 0.55), tentDk = shade(tent, 0.72), hw = 1.45, hl = 1.6, th = 1.95;
  // a pallet for a floor
  for (let i = 0; i < 5; i++) S.box(-1.0 + i * 0.5, H, 0.5, 0.42, 0.07, 4.2, i % 2 ? C.woodLt : C.wood);
  S.at(0, H + 0.07, -0.2);
  const ridgeA = [0, th, hl], ridgeM = [0, th - 0.16, 0], ridgeB = [0, th - 0.04, -hl];
  for (const sx of [-1, 1]) {
    const a = [sx * hw, 0, hl], m = [sx * (hw + 0.06), 0, 0], b = [sx * hw, 0, -hl];
    const cols = sx > 0 ? [tent, shade(tent, 1.08)] : [shade(tent, 0.92), tent];
    if (sx > 0) { S.quad2(a, m, ridgeM, ridgeA, cols[0], tentDk); S.quad2(m, b, ridgeB, ridgeM, cols[1], tentDk); } else { S.quad2(m, a, ridgeA, ridgeM, cols[0], tentDk); S.quad2(b, m, ridgeM, ridgeB, cols[1], tentDk); }
    // guy lines and pegs
    for (const gz of [hl, -hl]) { S.tube([[0, gz > 0 ? th : th - 0.04, gz], [sx * 0.2, 0.02, gz + Math.sign(gz) * 1.0]], 0.012, 0xd8d8d2, { seg: 3 }); S.box(sx * 0.2, -0.05, gz + Math.sign(gz) * 1.0, 0.05, 0.2, 0.05, C.woodLt, { rx: Math.sign(gz) * -0.4 }); }
  }
  // back wall and the front flaps (one tied open)
  S.tri2([hw, 0, -hl], [-hw, 0, -hl], ridgeB, tentDk);
  S.tri2([-hw, 0, hl], [-0.12, 0, hl], ridgeA, shade(tent, 1.05));
  S.tri2([0.5, 0, hl + 0.02], [hw, 0, hl], [0.28, th * 0.72, hl], shade(tent, 0.95));
  S.tri2([hw, 0, hl], [0, th, hl], [0.28, th * 0.72, hl], shade(tent, 0.95));
  // patches, sewn on badly
  const patchQ = (sx, t0, z0, s, col, rot) => {
    const px = sx * hw * (1 - t0), py = th * t0 * 0.95;
    S.at(px, py, z0, 0, 0, 0); S.rotZ(sx * Math.atan2(th, hw)); S.translate(0, sx > 0 ? 0.012 : -0.012, 0); S.rotY(rot);
    S.quad2([-s, 0, -s], [-s, 0, s], [s, 0, s], [s, 0, -s], col);
    S.restore();
  };
  patchQ(1, 0.45, 0.5, 0.26, 0xc9a23a, 0.2); patchQ(1, 0.3, -0.7, 0.2, 0x5b6e9a, -0.3); patchQ(-1, 0.5, -0.3, 0.24, 0xb3564a, 0.4); patchQ(-1, 0.25, 0.8, 0.18, C.tape, 0.1);
  // inside: dark, with a lantern that glows at night
  W.tri([-0.1, 0.02, hl - 0.04], [0.5, 0.02, hl - 0.04], [0.14, th * 0.86, hl - 0.04], 0x2a2a22);
  W.sphere(0.2, 0.3, hl - 0.25, 0.12, 0x5a4a2a, { seg: 4, rings: 2 });
  S.restore();

  // the sad pennant on a crooked stick
  const pole = [-1.9, H, -1.0];
  S.tube([[pole[0], H, pole[2]], [pole[0] - 0.1, H + 1.5, pole[2] + 0.05], [pole[0] + 0.12, H + 3.0, pole[2]]], 0.035, C.woodDk, { seg: 4 });
  S.box(pole[0] - 0.08, H + 1.4, pole[2] + 0.05, 0.1, 0.16, 0.1, C.tape);
  const pg = flagGeo(1.1, 0.6, color, { pennant: true, droop: 0.5, alt: shade(color, 0.85) });
  const pennant = pg.mesh(flatMat); pennant.name = 'pennant';
  pennant.position.set(pole[0] + 0.12, H + 2.98, pole[2]);
  pennant.rotation.y = -0.5;

  // HOME SWEET HOME, on cardboard
  const sx0 = 2.25, sz0 = 1.75;
  S.at(sx0, H, sz0, -0.35, 0, 0.06);
  S.box(0, 0, 0, 0.07, 1.0, 0.05, C.woodLt);
  S.box(0, 0.75, 0.04, 1.5, 1.0, 0.04, C.cardboard, { bottom: true, back: C.cardboardDk });
  S.tri([0.75, 1.75, 0.062], [0.5, 1.75, 0.062], [0.75, 1.55, 0.062], C.cardboardDk);
  S.text('HOME', 0, 1.45, 0.065, 0.05, 0x2a2622);
  S.text('SWEET', 0.02, 1.12, 0.065, 0.05, 0x2a2622, { rz: -0.04 });
  S.text('HOME', -0.02, 0.8, 0.065, 0.05, 0x2a2622, { rz: 0.03 });
  S.restore();
  // a bare bulb on a stick is the porch light here
  S.tube([[1.3, H, 1.9], [1.36, H + 1.5, 1.95]], 0.025, C.woodDk, { seg: 3 });
  S.sphere(1.36, H + 1.56, 1.95, 0.075, 0xfff3d0, { seg: 5, rings: 3 });
  L.a = 1; L.ico(1.36, H + 1.56, 1.95, 0.09, 0xffffff);
  halo(L, 1.36, H + 1.56, 1.95, 0.5, 0xffffff, 0.3, 1);
  // mailbox at the foot of the heap
  drawMailbox(S, 2.6, 0, 11.2, color, 'can');
  S.shadeY(0, 2.5, 0.85);

  colliders.push({ x: sx0, z: sz0, r: 0.3 }, { x: pole[0], z: pole[2], r: 0.2 });
  return finish('dump', K, {
    lot: { r: 12 },
    footprint: { w: 2.9, d: 3.2 },
    colliders,
    emissive: 0xff9a3d,
    glow: 1.3,
    children: [pennant],
    own: [pennant.geometry],
    anchors: {
      door: V3(0.3, H, 2.1), mailbox: V3(2.6, 0, 11.2), lawn: V3(-5.4, 0, 10.2), curb: V3(0, 0, 12), roof: V3(0, H + th + 0.1, -0.2),
      sign: V3(-2.2, 0, 11.3), goalposts: V3(6.2, 0, 9.6), resident: V3(-2.0, H, 1.4), trophy: V3(-1.9, H, 2.4),
      plaque: V3(sx0 + 0.9, H + 0.9, sz0 + 0.5), truck: V3(-3, 0, 14.2), cloud: V3(0, H + 6.5, 0), periscope: V3(2.4, H, -0.4),
      decor: [V3(1.0, H + 0.8, 0.3), V3(-1.0, H + 0.8, 0.3), V3(0, H + th + 0.1, 0.4), V3(pole[0], H + 2.2, pole[2]), V3(2.6, 1.3, 11.2), V3(-4.2, heapH(-4.2, 7.0), 7.0)],
    },
    groundHeight: heapH,
    update(dt, t, night, winMat) {
      const m = motion();
      pennant.rotation.y = -0.5 + Math.sin(t * 0.7 + seed) * 0.25 * m;
      pennant.rotation.z = -0.12 + Math.sin(t * 1.3 + seed) * 0.05 * m;
      winMat.emissiveIntensity = night * (1.1 + (flick(t, seed) - 0.5) * 0.5 * m);
    },
  });
}

export function createHome(tier, { color = 0xd7263d, seed = 1 } = {}) {
  // seed may be a team id, a slot index or a string: fold it to a small stable number
  if (typeof seed === 'string') { let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0; seed = Math.abs(h) % 9973; }
  seed = Number.isFinite(+seed) ? Math.abs(Math.floor(+seed)) % 100000 : 1;
  color = Number.isFinite(+color) ? +color : 0xd7263d;
  switch (tier) {
    case 'hill': return buildHill(color, seed);
    case 'heights': return buildHeights(color, seed);
    case 'park': return buildPark(color, seed);
    case 'dump': return buildDump(color, seed);
    default: return buildBubble(color, seed);
  }
}

export { heapH as dumpHeapHeight };
