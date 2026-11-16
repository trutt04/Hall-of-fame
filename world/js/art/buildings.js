// Plaza buildings and the big hardware: Hall of Fame, graveyard, league office, the scoreboard
// frame, the blimp and the stadium floodlight.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade, mix } from './geo.js';
import { flatMat, makeWindowMaterial, makeAddMaterial, makeGlowMaterial } from './materials.js';
import { rng, motion, makeProp, addMesh, halo, beam, blankTexture, V3 } from './util.js';
import { C, drawTree, drawBush, drawPigeon, drawFence } from './parts.js';
import { BRAND, PALETTE } from '../config.js';

function pane(G, x0, y0, x1, y1, z, a = C.glassA, b = C.glassB) {
  G.tri([x0, y0, z], [x1, y0, z], [x0, y1, z], a); G.tri([x1, y0, z], [x1, y1, z], [x0, y1, z], b);
}
function star5(g, cx, cy, z, ro, ri, a, b) {
  for (let i = 0; i < 5; i++) {
    const a0 = Math.PI / 2 + (i * TAU) / 5, a1 = a0 + TAU / 10, a2 = a0 - TAU / 10;
    g.tri([cx, cy, z], [cx + Math.cos(a2) * ri, cy + Math.sin(a2) * ri, z], [cx + Math.cos(a0) * ro, cy + Math.sin(a0) * ro, z], a);
    g.tri([cx, cy, z], [cx + Math.cos(a0) * ro, cy + Math.sin(a0) * ro, z], [cx + Math.cos(a1) * ri, cy + Math.sin(a1) * ri, z], b);
  }
}

function finishBuilding(kind, S, W, spec) {
  const group = new THREE.Group(); group.name = 'building-' + kind;
  const own = [];
  addMesh(group, S, flatMat, own, 'body');
  const winMat = makeWindowMaterial(spec.emissive); own.push(winMat);
  if (W.tris) addMesh(group, W, winMat, own, 'windows');
  if (spec.children) for (const c of spec.children) group.add(c);
  if (spec.own) own.push(...spec.own);
  return makeProp(group, own, spec.update || null, {
    kind,
    footprint: spec.footprint,
    colliders: spec.colliders || [],
    anchors: spec.anchors,
    signSize: spec.signSize,
    setNight(a) { winMat.emissiveIntensity = Math.max(0, Math.min(1, a || 0)) * (spec.glow || 1); },
  });
}

function buildHof() {
  const S = new Geo(), W = new Geo(); S.link(W);
  const wall = mix(BRAND.navy, 0x3d4a7a, 0.55), chalk = BRAND.chalk, gold = C.gold, roof = PALETTE.plaza.roof === undefined ? 0x0f1734 : mix(PALETTE.plaza.roof, 0x3d4a7a, 0.35);
  const PY = 0.9, colliders = [];
  // steps and podium
  for (let i = 0; i < 3; i++) S.box(0, 0, 4.6 + 0.25 + i * 0.5, 9.4, PY - (i + 1) * 0.225 + 0.0, 0.5, shade(chalk, i % 2 ? 0.93 : 0.98));
  S.box(0, 0, -0.3, 13.4, PY, 9.8, shade(chalk, 0.9), { top: shade(chalk, 1.0) });
  for (const sx of [-1, 1]) {
    S.box(sx * 5.7, 0, 5.3, 2.0, PY + 0.25, 1.5, shade(chalk, 0.95));
    // braziers
    S.lathe(sx * 5.7, PY + 0.25, 5.3, [[0.28, 0], [0.16, 0.2], [0.14, 0.6], [0.5, 0.86], [0.55, 0.96]], gold, { seg: 8, capTop: 0x2a2622 });
    W.lathe(sx * 5.7, PY + 1.15, 5.3, [[0.34, 0, 0xff7a1a], [0.4, 0.2, 0xff8a1a], [0.2, 0.6, 0xffc93c], [0, 1.0]], 0xff7a1a, { seg: 5, capTop: false });
    colliders.push({ x: sx * 5.7, z: 5.3, r: 1.2 });
  }
  // cella
  S.box(0, PY, -1.3, 10.8, 4.7, 6.6, wall, { side: shade(wall, 0.92), noTop: true });
  S.box(0, PY, -1.3, 10.9, 0.5, 6.7, shade(wall, 0.75), { noTop: true });
  for (const sx of [-1, 1]) {
    S.at(sx * 5.4, 0, -1.3, (sx * Math.PI) / 2);
    for (const wz of [-2, 0, 2]) { S.box(wz, PY + 1.2, 0.03, 0.9, 2.7, 0.08, chalk); pane(W, wz - 0.32, PY + 1.3, wz + 0.32, PY + 3.8, 0.076); }
    S.restore();
  }
  // door: tall, warm, open
  S.box(0, PY, 2.03, 3.0, 4.0, 0.1, gold);
  W.quad([-1.25, PY, 2.09], [1.25, PY, 2.09], [1.25, PY + 3.75, 2.09], [-1.25, PY + 3.75, 2.09], 0x3a2c14);
  for (const sx of [-1, 1]) { S.at(sx * 1.25, PY, 2.1, sx * -1.15); S.box(sx * 0.55, 0, 0, 1.1, 3.7, 0.08, C.goldLo, { front: gold, back: gold }); S.box(sx * 0.55, 0.5, 0.045, 0.7, 1.1, 0.02, C.goldLo); S.box(sx * 0.55, 2.0, 0.045, 0.7, 1.3, 0.02, C.goldLo); S.restore(); }
  // colonnade
  for (const cx of [-5.8, -3.5, -1.3, 1.3, 3.5, 5.8]) {
    S.box(cx, PY, 3.6, 0.9, 0.22, 0.9, chalk);
    S.cyl(cx, PY + 0.22, 3.6, 0.36, 4.2, chalk, { seg: 8, rt: 0.29, top: false });
    S.box(cx, PY + 4.42, 3.6, 0.62, 0.12, 0.62, gold); S.box(cx, PY + 4.54, 3.6, 0.88, 0.16, 0.88, gold);
    colliders.push({ x: cx, z: 3.6, r: 0.5 });
  }
  // entablature, pediment, star
  const EY = PY + 4.7;
  S.box(0, EY, -0.4, 13.2, 0.95, 9.3, chalk, { bottom: shade(chalk, 0.75) });
  S.box(0, EY + 0.95, -0.4, 13.5, 0.14, 9.6, gold);
  S.gable(0, EY + 1.09, -0.4, 9.6, 1.9, 13.5, roof, { ry: Math.PI / 2, ends: wall });
  S.tube([[-6.75, EY + 1.12, 4.42], [0, EY + 3.02, 4.42], [6.75, EY + 1.12, 4.42]], 0.11, gold, { seg: 4 });
  star5(S, 0, EY + 1.82, 4.41, 0.56, 0.24, C.goldHi, gold);
  // drum and the gold dome
  const DY = EY + 2.2;
  S.cyl(0, DY, -1.2, 2.7, 1.5, chalk, { seg: 12 });
  for (let i = 0; i < 12; i += 2) { W.at(0, DY + 0.4, -1.2, -(i * TAU) / 12 + Math.PI / 2 + Math.PI / 12 - Math.PI / 12); pane(W, -0.3, 0, 0.3, 0.8, 2.63); W.restore(); }
  S.cyl(0, DY + 1.5, -1.2, 2.95, 0.16, gold, { seg: 12 });
  S.jit = 0.06;
  S.lathe(0, DY + 1.66, -1.2, [[2.8, 0, C.goldLo], [2.7, 0.5, gold], [2.25, 1.3, gold], [1.5, 1.95, C.goldHi], [0.7, 2.35, C.goldHi], [0.24, 2.48, gold], [0.2, 2.9]], gold, { seg: 12 });
  S.jit = 0;
  S.sphere(0, DY + 4.8, -1.2, 0.3, C.goldHi, { seg: 6, rings: 4 });
  S.shadeY(0, 3.0, 0.88);
  return finishBuilding('hof', S, W, {
    emissive: 0xffc66b, glow: 1.1,
    footprint: { w: 13.4, d: 9.8 }, colliders,
    anchors: { door: V3(0, 0, 6.8), sign: V3(0, EY + 0.48, 4.27), top: V3(0, DY + 5.1, -1.2) },
    signSize: { w: 9.6, h: 0.72 },
  });
}

function headstone(g, x, z, kind, ry, tilt, col) {
  g.at(x, 0, z, ry, tilt, tilt * 0.6);
  const dk = shade(col, 0.82);
  if (kind === 0) g.cloft(0, 0, 0, [[0, 0.9, 0.22, 0], [0.75, 0.9, 0.22, 0], [0.98, 0.74, 0.22, 0], [1.1, 0.4, 0.22, 0]], col, { capTop: dk });
  else if (kind === 1) { g.box(0, 0, 0, 0.7, 0.2, 0.7, dk); g.box(0, 0.2, 0, 0.46, 1.5, 0.46, col, { tx: 0.6, tz: 0.6 }); g.cone(0, 1.7, 0, 0.2, 0.26, dk, { seg: 4, ph: Math.PI / 4 }); }
  else if (kind === 2) { g.box(0, 0, 0, 1.0, 0.16, 0.4, dk); g.box(0, 0.16, 0, 0.8, 0.75, 0.2, col); }
  else { g.box(0, 0, 0, 0.8, 0.5, 0.2, col, { tx: 0.8, sx: 0.1 }); g.box(0.5, 0, 0.5, 0.7, 0.2, 0.45, dk, { ry: 0.5, rz: 0.2 }); }
  if (kind === 0 || kind === 2) g.text('RIP', 0, kind === 0 ? 0.62 : 0.5, 0.115, 0.036, shade(col, 0.5));
  g.restore();
}

function buildGraveyard() {
  const S = new Geo(), W = new Geo(); S.link(W);
  const stone = 0x9aa0a8, iron = C.iron, r = rng(31), colliders = [];
  S.jit = 0.04;
  for (const sx of [-1, 1]) {
    S.box(sx * 1.9, 0, 0, 1.0, 0.3, 1.0, shade(stone, 0.8));
    S.box(sx * 1.9, 0.3, 0, 0.8, 2.7, 0.8, stone, { side: shade(stone, 0.92) });
    S.box(sx * 1.9, 3.0, 0, 1.0, 0.16, 1.0, shade(stone, 1.1));
    S.cone(sx * 1.9, 3.16, 0, 0.5, 0.4, shade(stone, 0.9), { seg: 4, ph: Math.PI / 4 });
    colliders.push({ x: sx * 1.9, z: 0, r: 0.65 });
    // low wall and iron fence out to the corners
    S.box(sx * 3.75, 0, 0, 2.7, 0.55, 0.45, shade(stone, 0.9), { top: stone });
    S.at(0, 0.5, 0); drawFence(S, sx * 2.45, 0, sx * 5.05, 0, { h: 1.25, tip: 0x8a93a0, postEvery: 2.6, barEvery: 0.5 }); S.restore();
    for (let i = 0; i < 4; i++) colliders.push({ x: sx * (2.6 + i * 0.8), z: 0, r: 0.5 });
  }
  S.jit = 0;
  // the arch and its sign plate
  const arch = (yo, rr) => { const pts = []; for (let i = 0; i <= 8; i++) { const a = Math.PI - (i * Math.PI) / 8; pts.push([Math.cos(a) * 1.9, 3.2 + yo + Math.sin(a) * rr, 0]); } return pts; };
  S.tube(arch(0, 1.5), 0.07, iron, { seg: 4 }); S.tube(arch(-0.1, 0.75), 0.06, iron, { seg: 4 });
  for (let i = 1; i < 8; i++) { const a = Math.PI - (i * Math.PI) / 8; S.tube([[Math.cos(a) * 1.9, 3.1 + Math.sin(a) * 0.75, 0], [Math.cos(a) * 1.9, 3.2 + Math.sin(a) * 1.5, 0]], 0.03, iron, { seg: 3 }); }
  S.box(0, 3.62, 0.0, 2.9, 0.72, 0.1, 0x23262e, { bottom: true });
  S.cone(0, 4.72, 0, 0.14, 0.45, 0x8a93a0, { seg: 4 });
  // gates: one ajar, one hanging off a hinge
  const leaf = (rz) => { S.box(0.6, 0.15, 0, 1.2, 0.07, 0.06, iron); S.box(0.6, 2.05, 0, 1.2, 0.07, 0.06, iron); for (let i = 0; i < 5; i++) { S.at(0.08 + i * 0.26, 0, 0); S.band(0.03, 0.15, 0.025, 2.2 + (i % 2) * 0.12, 3, 0, iron); S.band(0.05, 2.2 + (i % 2) * 0.12, 0, 2.42 + (i % 2) * 0.12, 3, 0, 0x8a93a0); S.restore(); } void rz; };
  S.at(-1.5, 0, 0.05, -1.05); leaf(0); S.restore();
  S.at(1.5, 0.0, 0.05, Math.PI + 0.35, 0, -0.1); leaf(0); S.restore();
  // lantern
  S.box(-1.9, 3.5, 0.42, 0.06, 0.06, 0.5, iron); S.box(-1.9, 3.1, 0.62, 0.2, 0.05, 0.2, iron);
  W.sphere(-1.9, 3.3, 0.62, 0.13, 0xe6ffd0, { seg: 5, rings: 3 });
  // headstones, a fresh mound, a dead tree and a watchful crow
  const stones = [[-3.6, -2.0, 0, 0.1, 0.05], [-1.7, -2.8, 2, -0.1, 0], [0.5, -2.2, 0, 0.05, -0.08], [2.5, -3.0, 1, 0.2, 0.03], [4.0, -1.8, 3, -0.2, 0], [-2.9, -4.6, 1, 0.3, -0.04], [1.3, -4.8, 0, -0.15, 0.1], [3.6, -5.0, 2, 0.1, 0]];
  stones.forEach(([x, z, kind, ry, tilt], i) => { headstone(S, x, z, kind, ry, tilt, i % 2 ? 0xa7adb5 : 0x8f959d); colliders.push({ x, z, r: 0.5 }); });
  S.jit = 0.06;
  S.ico(0.5, 0.05, -1.2, 0.8, 0x6b5a3e, { sy: 0.3, sz: 1.5, sx: 0.8, jitter: 0.1, rnd: r, flat: 0.2 });
  S.jit = 0;
  S.cyl(0.2, 0.2, -0.7, 0.015, 0.4, C.leafDk, { seg: 3, rz: 0.4 }); S.sphere(0.05, 0.56, -0.7, 0.07, 0xd96b6b, { seg: 4, rings: 2 });
  drawTree(S, 'dead', -4.4, 0, -5.2, 1.0, r);
  drawPigeon(S, 0.5, 1.1, -2.2, 1.5, 0.4, 0, 0x23212b);
  colliders.push({ x: -4.4, z: -5.2, r: 0.4 });
  S.shadeY(0, 1.6, 0.85);
  return finishBuilding('graveyard', S, W, {
    emissive: 0xb8ff9a, glow: 1.2,
    footprint: { w: 10.2, d: 0.6 }, colliders,
    anchors: { door: V3(0, 0, 1.5), sign: V3(0, 3.98, 0.06), inside: V3(0, 0, -3.4) },
    signSize: { w: 2.8, h: 0.62 },
  });
}

function buildOffice() {
  const S = new Geo(), W = new Geo(); S.link(W);
  const brick = 0xb5a78f, brickDk = 0x93876f, conc = C.concrete, colliders = [], r = rng(8);
  const Y0 = 0.12, H = 3.6, top = Y0 + H;
  S.box(0, 0, 0, 12.2, Y0, 7.2, C.concreteDk);
  S.box(0, Y0, 0, 12, H, 7, brick, { side: shade(brick, 0.93), noTop: true });
  S.box(0, Y0, 0, 12.06, 0.6, 7.06, brickDk, { noTop: true });
  S.box(0, top, 0, 12.3, 0.22, 7.3, conc, { top: 0x5a5d63 });
  // the clock bay
  S.box(0, Y0, 3.75, 3.8, 5.6, 0.5, brick, { side: shade(brick, 0.93) });
  S.box(0, Y0 + 5.6, 3.6, 4.1, 0.2, 0.9, conc);
  S.cyl(0, 4.55, 4.0, 0.86, 0.06, C.navy, { seg: 12, rx: Math.PI / 2 });
  S.cyl(0, 4.55, 4.03, 0.74, 0.05, 0xf3eedd, { seg: 12, rx: Math.PI / 2 });
  for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; S.at(Math.cos(a) * 0.62, 4.55 + Math.sin(a) * 0.62, 4.085, 0, 0, a); S.quad([-0.06, -0.018, 0], [0.06, -0.018, 0], [0.06, 0.018, 0], [-0.06, 0.018, 0], C.navy); S.restore(); }
  // sign board over the canopy
  S.box(0, 3.0, 4.0, 3.4, 0.74, 0.06, C.navy, { bottom: true });
  S.box(0, 3.05, 4.035, 3.26, 0.64, 0.02, 0xe9e2cf, { bottom: true });
  // entrance: glass doors under a concrete canopy
  S.box(0, Y0, 4.02, 2.3, 2.45, 0.08, C.metalDk);
  pane(W, -1.02, Y0 + 0.1, -0.03, Y0 + 2.3, 4.07); pane(W, 0.03, Y0 + 0.1, 1.02, Y0 + 2.3, 4.07);
  for (const sx of [-1, 1]) S.box(sx * 0.14, Y0 + 1.0, 4.08, 0.04, 0.4, 0.05, C.metalLt);
  S.box(0, 2.62, 4.75, 4.4, 0.18, 1.6, conc, { bottom: shade(conc, 0.7) });
  for (const sx of [-1, 1]) { S.cyl(sx * 1.9, 0, 5.3, 0.07, 2.62, C.metalDk, { seg: 5, top: false }); colliders.push({ x: sx * 1.9, z: 5.3, r: 0.2 }); }
  S.box(0, 0, 4.9, 3.2, 0.12, 1.6, conc);
  // windows with tired blinds
  const winAt = (x, lit, blind) => {
    S.box(x, Y0 + 1.15, 3.53, 1.7, 1.45, 0.08, conc);
    const G = lit ? W : S;
    pane(G, x - 0.75, Y0 + 1.25, x + 0.75, Y0 + 2.5, 3.576);
    G.quad([x - 0.75, Y0 + 2.5 - 1.25 * blind, 3.582], [x + 0.75, Y0 + 2.5 - 1.25 * blind, 3.582], [x + 0.75, Y0 + 2.5, 3.582], [x - 0.75, Y0 + 2.5, 3.582], 0xd9d2bd);
    S.quad([x - 0.02, Y0 + 1.25, 3.59], [x + 0.02, Y0 + 1.25, 3.59], [x + 0.02, Y0 + 2.5, 3.59], [x - 0.02, Y0 + 2.5, 3.59], conc);
    S.box(x, Y0 + 1.08, 3.6, 1.86, 0.08, 0.2, conc);
  };
  winAt(-4.6, true, 0.55); winAt(-2.75, false, 0.9); winAt(2.75, true, 0.3); winAt(4.6, true, 0.7);
  S.box(4.6, Y0 + 1.25, 3.72, 0.7, 0.42, 0.4, 0xd5d2c6, { front: 0x8f9597 });
  for (const sx of [-1, 1]) { S.at(sx * 6, 0, 0, (sx * Math.PI) / 2); for (const wz of [-1.6, 1.6]) { S.box(wz, Y0 + 1.15, 0.03, 1.4, 1.45, 0.08, conc); pane(r() < 0.5 ? W : S, wz - 0.6, Y0 + 1.25, wz + 0.6, Y0 + 2.5, 0.076); } S.restore(); }
  // roof clutter
  S.box(-3.5, top + 0.22, -1, 1.6, 0.8, 1.2, C.metal, { top: C.metalDk }); S.cyl(3.6, top + 0.22, -1.5, 0.16, 0.7, C.metalDk, { seg: 6 }); S.cone(3.6, top + 0.92, -1.5, 0.3, 0.16, C.metalDk, { seg: 6 });
  // notice board, bench, planter, flagpole with a limp flag
  S.box(3.6, Y0 + 0.95, 4.02, 1.3, 0.95, 0.06, C.woodDk, { bottom: true }); S.box(3.6, Y0 + 1.02, 4.055, 1.16, 0.81, 0.02, 0xb98552, { bottom: true });
  for (const [px, py, col, rz] of [[3.25, 1.75, 0xf7f4ea, 0.08], [3.62, 1.5, 0xffe58a, -0.05], [3.95, 1.78, 0xf7f4ea, 0.02], [3.4, 1.32, 0xd9e6f2, -0.1]]) { S.at(px, py, 4.08, 0, 0, rz); S.quad([-0.13, -0.17, 0], [0.13, -0.17, 0], [0.13, 0.17, 0], [-0.13, 0.17, 0], col); S.restore(); }
  S.box(-3.6, 0.4, 4.5, 1.7, 0.07, 0.45, C.wood); S.box(-3.6, 0.5, 4.3, 1.7, 0.45, 0.06, C.wood, { rx: -0.12 });
  for (const sx of [-1, 1]) S.box(-3.6 + sx * 0.7, 0, 4.5, 0.07, 0.4, 0.42, C.iron);
  colliders.push({ x: -3.6, z: 4.5, r: 0.7 });
  S.box(-1.95, 0, 5.0, 0.8, 0.5, 0.8, conc, { top: C.dirt }); drawBush(S, -1.95, 0.45, 5.0, 0.55, r, 0x7f9a4e);
  S.cyl(5.2, 0, 4.9, 0.06, 6.4, C.metalLt, { seg: 5 }); S.sphere(5.2, 6.48, 4.9, 0.11, C.gold, { seg: 5, rings: 3 });
  S.quad2([5.26, 6.3, 4.9], [5.42, 4.85, 4.98], [5.9, 4.95, 5.02], [5.62, 6.3, 4.92], C.navy, shade(C.navy, 1.3)); S.quad2([5.3, 5.5, 4.93], [5.38, 5.25, 4.96], [5.82, 5.3, 5.0], [5.72, 5.56, 4.96], C.gold);
  colliders.push({ x: 5.2, z: 4.9, r: 0.2 }, { x: -1.95, z: 5.0, r: 0.55 });
  S.shadeY(0, 2.2, 0.88);
  // clock hands that keep real local time
  const hg = new Geo(), mg = new Geo();
  hg.box(0, -0.06, 0, 0.07, 0.44, 0.02, C.navy, { bottom: true }); mg.box(0, -0.08, 0, 0.045, 0.68, 0.02, 0x23201f, { bottom: true });
  const hour = hg.mesh(flatMat), minute = mg.mesh(flatMat);
  hour.name = 'hourHand'; minute.name = 'minuteHand';
  hour.position.set(0, 4.55, 4.1); minute.position.set(0, 4.55, 4.125);
  const tz = new Date().getTimezoneOffset() * 60000;
  const setHands = () => {
    const ms = (Date.now() - tz) % 43200000, h = ms / 3600000;
    hour.rotation.z = -(h / 12) * TAU; minute.rotation.z = -(h % 1) * TAU;
  };
  setHands();
  return finishBuilding('office', S, W, {
    emissive: 0xdff3ff, glow: 0.9,
    footprint: { w: 12.2, d: 7.2 }, colliders,
    children: [hour, minute], own: [hour.geometry, minute.geometry],
    anchors: { door: V3(0, 0.12, 5.9), sign: V3(0, 3.37, 4.06), clock: V3(0, 4.55, 4.1) },
    signSize: { w: 3.2, h: 0.6 },
    update: setHands,
  });
}

export function createBuilding(kind = 'hof') {
  if (kind === 'graveyard') return buildGraveyard();
  if (kind === 'office') return buildOffice();
  return buildHof();
}

// ---- stadium scoreboard frame --------------------------------------------------------------------------------
export function createBoardFrame({ w = 12, h = 6 } = {}) {
  const group = new THREE.Group(); group.name = 'boardFrame';
  const own = [], g = new Geo(), navy = mix(BRAND.navy, 0x3d4a7a, 0.4), gold = C.gold;
  const legH = Math.max(3.2, h * 0.55), m = Math.max(0.35, Math.min(w, h) * 0.07), cy = legH + m + h / 2, d = Math.max(0.6, w * 0.06);
  const lx = w / 2 - Math.max(0.8, w * 0.14);
  for (const sx of [-1, 1]) {
    g.box(sx * lx, 0, -d * 0.5, d * 1.3, 0.3, d * 1.6, C.concrete);
    g.box(sx * lx, 0.3, -d * 0.5, d * 0.7, legH, d * 0.7, C.metalDk, { side: C.iron });
    g.tube([[sx * lx, 0.3, -d * 2.4], [sx * lx, legH + h * 0.3, -d * 0.9]], d * 0.16, C.metalDk, { seg: 4 });
  }
  g.box(0, legH * 0.55, -d * 0.5, lx * 2, d * 0.3, d * 0.3, C.metalDk);
  // cabinet and gold trim
  g.box(0, legH, -d * 0.5, w + 2 * m, h + 2 * m, d, navy, { bottom: shade(navy, 0.7), back: shade(navy, 0.7) });
  const z = 0.02;
  g.box(0, legH, z, w + 2 * m, m * 0.5, 0.08, gold, { bottom: true }); g.box(0, legH + h + m * 1.5, z, w + 2 * m, m * 0.5, 0.08, gold);
  for (const sx of [-1, 1]) g.box(sx * (w / 2 + m * 0.75), legH + m * 0.5, z, m * 0.5, h + m, 0.08, gold);
  // crown-shaped topper
  const ty = legH + h + 2 * m;
  g.box(0, ty, -d * 0.5, w * 0.5, m * 1.2, d * 0.8, navy);
  g.box(0, ty + m * 1.2, -d * 0.5, w * 0.52, m * 0.25, d * 0.85, gold);
  for (let i = -2; i <= 2; i++) g.cone(i * w * 0.1, ty + m * 1.45, -d * 0.5, m * 0.42, m * (i % 2 ? 0.8 : 1.3), gold, { seg: 4, ph: Math.PI / 4 });
  // speakers
  for (const sx of [-1, 1]) { g.box(sx * (w / 2 + m + d * 0.45), legH + h * 0.25, -d * 0.4, d * 0.7, h * 0.5, d * 0.7, C.iron); g.quad([sx * (w / 2 + m + d * 0.45) - d * 0.25, legH + h * 0.3, -d * 0.045], [sx * (w / 2 + m + d * 0.45) + d * 0.25, legH + h * 0.3, -d * 0.045], [sx * (w / 2 + m + d * 0.45) + d * 0.25, legH + h * 0.7, -d * 0.045], [sx * (w / 2 + m + d * 0.45) - d * 0.25, legH + h * 0.7, -d * 0.045], 0x3a3d46); }
  g.shadeY(0, legH, 0.85);
  addMesh(group, g, flatMat, own, 'frame');
  // the screen: exactly w x h, the world sets screen.material.map
  const blank = blankTexture(0x0a1022); own.push(blank);
  const sg = new THREE.PlaneGeometry(w, h); own.push(sg);
  const sm = new THREE.MeshBasicMaterial({ map: blank }); own.push(sm);
  const screen = new THREE.Mesh(sg, sm); screen.name = 'screen';
  screen.position.set(0, cy, 0.03);
  group.add(screen);
  // chaser bulbs along the top and bottom trim, two alternating sets
  const sets = [new Geo(), new Geo()], n = Math.max(6, Math.round(w / 0.7));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / n, s = sets[i % 2], rr = Math.min(0.11, m * 0.2);
    s.sphere(x, legH + m * 0.25, 0.1, rr, 0xfff0b0, { seg: 4, rings: 2 }); s.sphere(x, legH + h + m * 1.75, 0.1, rr, 0xfff0b0, { seg: 4, rings: 2 });
  }
  const mA = makeGlowMaterial(0xffffff), mB = makeGlowMaterial(0xffffff); own.push(mA, mB);
  addMesh(group, sets[0], mA, own, 'bulbsA'); addMesh(group, sets[1], mB, own, 'bulbsB');
  return makeProp(group, own, (dt, t) => {
    const k = motion() < 1 ? 0.5 : (Math.floor(t * 2.5) % 2);
    mA.color.setScalar(0.3 + 0.7 * k); mB.color.setScalar(0.3 + 0.7 * (1 - k));
  }, {
    screen,
    size: { w, h },
    anchors: { screen: V3(0, cy, 0.03), base: V3(0, 0, 0) },
    colliders: [{ x: -lx, z: 0, r: d }, { x: lx, z: 0, r: d }],
  });
}

// ---- the blimp ---------------------------------------------------------------------------------------------------
export function createBlimp() {
  const group = new THREE.Group(); group.name = 'blimp';
  const body = new THREE.Group(); group.add(body);
  const own = [], g = new Geo(), navy = mix(BRAND.navy, 0x3d4a7a, 0.5), chalk = BRAND.chalk, gold = C.gold;
  const CY = 4.9;
  g.jit = 0.035;
  // envelope: nose toward +Z, bands of chalk, gold and navy
  g.at(0, CY, 0, 0, Math.PI / 2);
  g.lathe(0, 0, 0, [[0, -8.2, gold], [1.5, -7.5, navy], [2.8, -6.0, chalk], [3.6, -3.2, chalk], [3.85, -0.6, navy], [3.8, 1.2, chalk], [3.3, 3.8, chalk], [2.4, 6.0, gold], [1.2, 7.5, gold], [0, 8.1]], chalk, { seg: 12, capTop: false });
  g.restore();
  g.jit = 0;
  // tail fins
  for (let i = 0; i < 4; i++) {
    g.at(0, CY, -5.6, 0, 0, (i * Math.PI) / 2 + Math.PI / 4);
    g.box(0, 2.0, 0, 0.16, 2.6, 2.6, navy, { tz: 0.45, sz: -0.9, bottom: true });
    g.box(0, 4.45, -0.92, 0.2, 0.16, 1.2, gold);
    g.restore();
  }
  // gondola with windows and a little motor
  g.cloft(0, CY - 4.75, 0.6, [[0, 1.2, 3.0, 0.4], [0.5, 1.5, 3.6, 0.5], [1.0, 1.4, 3.4, 0.5]], navy, { capBot: shade(navy, 0.7), capTop: false });
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) g.quad(...(sx > 0 ? [[0.752, CY - 4.3, 1.5 - i * 0.9 + 0.3], [0.752, CY - 4.3, 1.5 - i * 0.9 - 0.3], [0.72, CY - 3.92, 1.5 - i * 0.9 - 0.3], [0.72, CY - 3.92, 1.5 - i * 0.9 + 0.3]] : [[-0.752, CY - 4.3, 1.5 - i * 0.9 - 0.3], [-0.752, CY - 4.3, 1.5 - i * 0.9 + 0.3], [-0.72, CY - 3.92, 1.5 - i * 0.9 + 0.3], [-0.72, CY - 3.92, 1.5 - i * 0.9 - 0.3]]), 0xbfe3ff);
  g.quad([-0.45, CY - 4.3, 2.36], [0.45, CY - 4.3, 2.36], [0.4, CY - 3.92, 2.3], [-0.4, CY - 3.92, 2.3], 0xbfe3ff);
  g.cyl(0, CY - 4.35, -1.35, 0.3, 0.7, C.metalDk, { seg: 6, rx: -Math.PI / 2 });
  g.shadeY(CY - 5, CY + 1, 0.84);
  // propeller
  const pg = new Geo();
  for (let i = 0; i < 3; i++) { pg.at(0, 0, 0, 0, 0, (i * TAU) / 3); pg.box(0, 0, 0, 0.16, 0.85, 0.03, C.metalLt, { tx: 0.5, bottom: true }); pg.restore(); }
  pg.sphere(0, 0, 0, 0.11, gold, { seg: 5, rings: 3 });
  const prop = addMesh(body, pg, flatMat, own, 'propeller');
  prop.position.set(0, CY - 4.35, -2.12);
  // the banner trails behind on two lines; text reads correctly from both sides
  const BL = 15, BH = 2.3, B0 = -10.8, SEGS = 14;
  const lines = g;
  lines.tube([[0, CY + 0.2, -8.0], [0, CY + BH / 2 - 0.1, B0]], 0.02, 0x23201f, { seg: 3 }); lines.tube([[0, CY - 0.2, -8.0], [0, CY - BH / 2 + 0.1, B0]], 0.02, 0x23201f, { seg: 3 });
  lines.box(0, CY - BH / 2 - 0.05, B0, 0.07, BH + 0.1, 0.07, C.woodLt);
  addMesh(body, g, flatMat, own, 'envelope');
  const pos = new Float32Array(SEGS * 2 * 6 * 3), uv = new Float32Array(SEGS * 2 * 6 * 2), sAt = new Float32Array(SEGS * 2 * 6);
  let o = 0;
  const put = (s, top, u) => { pos[o * 3] = 0; pos[o * 3 + 1] = CY + (top ? BH / 2 : -BH / 2); pos[o * 3 + 2] = B0 - s * BL; uv[o * 2] = u; uv[o * 2 + 1] = top ? 1 : 0; sAt[o] = s; o++; };
  for (let i = 0; i < SEGS; i++) {
    const s0 = i / SEGS, s1 = (i + 1) / SEGS;
    // side facing +X
    put(s0, 0, s0); put(s1, 0, s1); put(s1, 1, s1); put(s0, 0, s0); put(s1, 1, s1); put(s0, 1, s0);
    // side facing -X (mirrored u so the text is not backwards)
    put(s1, 0, 1 - s1); put(s0, 0, 1 - s0); put(s0, 1, 1 - s0); put(s1, 0, 1 - s1); put(s0, 1, 1 - s0); put(s1, 1, 1 - s1);
  }
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  bgeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  bgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, CY, B0 - BL / 2), BL / 2 + 2);
  own.push(bgeo);
  const blank = blankTexture(0xf3eedd); own.push(blank);
  const bmat = new THREE.MeshBasicMaterial({ map: blank }); own.push(bmat);
  const banner = new THREE.Mesh(bgeo, bmat); banner.name = 'banner';
  body.add(banner);
  const result = makeProp(group, own, (dt, t) => {
    const m = motion();
    prop.rotation.z = t * 14 * (0.2 + 0.8 * m);
    body.position.y = Math.sin(t * 0.5) * 0.35 * m;
    body.rotation.z = Math.sin(t * 0.37) * 0.03 * m;
    body.rotation.x = Math.sin(t * 0.29 + 1) * 0.02 * m;
    for (let i = 0; i < sAt.length; i++) { const s = sAt[i]; pos[i * 3] = Math.sin(s * 8 - t * 3.2) * 0.38 * s * (0.25 + 0.75 * m); }
    bgeo.attributes.position.needsUpdate = true;
  }, { banner, bannerSize: { w: BL, h: BH }, length: 16.3, height: CY + 3.9 });
  result.update(0, 0);
  return result;
}

// ---- stadium floodlight --------------------------------------------------------------------------------------------
export function createFloodlight() {
  const group = new THREE.Group(); group.name = 'floodlight';
  const own = [], g = new Geo(), l = new Geo({ alpha: true }), M = C.metalDk, H = 13;
  g.box(0, 0, 0, 1.5, 0.35, 1.5, C.concrete);
  // lattice mast: four legs leaning in, cross braces
  const half = (y) => 0.55 - 0.3 * (y / H);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.tube([[sx * half(0.35), 0.35, sz * half(0.35)], [sx * half(H), H, sz * half(H)]], 0.06, M, { seg: 4 });
  for (let i = 0; i < 6; i++) {
    const y0 = 0.5 + i * 2.05, y1 = y0 + 2.05, h0 = half(y0), h1 = half(y1);
    for (const s of [-1, 1]) {
      g.tube([[-h0, y0, s * h0], [h1, y1, s * h1]], 0.03, M, { seg: 3 }); g.tube([[s * h0, y0, h0], [s * h1, y1, -h1]], 0.03, M, { seg: 3 });
    }
    g.box(0, y1 - 0.03, 0, h1 * 2, 0.06, h1 * 2, M, { noTop: true });
  }
  g.box(0, H, 0, 1.3, 0.12, 1.3, M);
  for (const sx of [-1, 1]) g.box(sx * 0.62, H + 0.12, 0, 0.04, 0.9, 1.26, M, { noTop: true });
  // lamp bank, tilted down toward +Z
  const tilt = 0.5;
  g.at(0, H + 1.4, 0.35, 0, tilt);
  g.box(0, -1.2, -0.12, 3.6, 2.4, 0.16, C.iron, { bottom: true });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const x = -1.28 + c * 0.85, y = -0.78 + r * 0.78;
    g.cyl(x, y, 0.0, 0.33, 0.24, M, { seg: 8, rx: Math.PI / 2, top: 0xe9eef2 });
    l.at(0, H + 1.4, 0.35, 0, tilt); l.a = 1; l.at(x, y, 0.25); l.rotX(Math.PI / 2); l.fan(0.29, 0, 8, Math.PI / 8, 0xffffff); l.restore(); l.restore();
  }
  g.restore();
  g.shadeY(0, 3, 0.85);
  addMesh(group, g, flatMat, own, 'tower');
  l.at(0, H + 1.4, 0.35, 0, tilt);
  halo(l, 0, 0, 0.5, 2.6, 0xfff6dc, 0.2, 1);
  l.rotX(Math.PI / 2); beam(l, 1.6, 9, 26, 0xfff6dc, 0.13, 0, 10);
  l.restore();
  const mat = makeAddMaterial(0xffffff, 1); own.push(mat);
  const glow = addMesh(group, l, mat, own, 'glow');
  glow.frustumCulled = false;
  let on = true;
  return makeProp(group, own, null, {
    setOn(v) { on = !!v; glow.visible = on; },
    setNight(a) { mat.opacity = 0.4 + 0.6 * Math.max(0, Math.min(1, a || 0)); },
    height: H + 2.6,
    colliders: [{ x: 0, z: 0, r: 0.9 }],
  });
}
