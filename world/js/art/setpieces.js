// Set pieces: the crown, the throne, the fountain and the rest of the town furniture.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade, mix } from './geo.js';
import { flatMat, glowMat, addMat, glassMat, makeAddMaterial, makeSelfLitMaterial } from './materials.js';
import { rng, motion, flick, stepRand, makeProp, addMesh, makeBlob, makeSparkles, makeParticles, halo, beam, isReducedMotion, V3 } from './util.js';
import {
  C, drawBag, drawTree, drawBush, drawTrashCan, drawLawnChair, drawPigeon, drawTrafficCone, drawGatePillar, drawGateLeaf, drawFootball,
} from './parts.js';
import { makeFlySwarm } from './critters.js';

// ---- the crown: the icon of the whole world ---------------------------------------------------------
export function createCrown() {
  const group = new THREE.Group(); group.name = 'crown';
  const spin = new THREE.Group(); group.add(spin);
  const own = [], g = new Geo(), gems = new Geo(), fx = new Geo({ alpha: true });
  const G = C.gold, H = C.goldHi, L = C.goldLo, R = 2.3, SEG = 16;
  // ermine trim
  g.jit = 0.04;
  g.lathe(0, 0, 0, [[R + 0.12, 0], [R + 0.3, 0.14], [R + 0.3, 0.42], [R + 0.14, 0.56]], 0xf7f4ea, { seg: SEG, capTop: false });
  for (let i = 0; i < SEG; i++) { const a = ((i + 0.5) * TAU) / SEG; g.at(0, 0.2, 0, -a); g.box(R + 0.3, 0.02 + (i % 2) * 0.1, 0, 0.03, 0.13, 0.11, 0x23201f); g.restore(); }
  g.fan(R + 0.12, 0.02, SEG, Math.PI / SEG, 0x7d1226, true);
  // the band
  g.jit = 0.07;
  g.lathe(0, 0.56, 0, [[R + 0.1, 0, L], [R + 0.16, 0.1, G], [R + 0.1, 0.24, H], [R + 0.1, 0.72, G], [R + 0.18, 0.84, H], [R + 0.08, 0.98]], G, { seg: SEG, capTop: false });
  g.band(R - 0.08, 1.54, R - 0.08, 0.56, SEG, Math.PI / SEG, L);
  g.band(R + 0.08, 1.54, R - 0.08, 1.54, SEG, Math.PI / SEG, H);
  // eight points, tall and short, each topped with a pearl
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8, tall = i % 2 === 0, top = tall ? 2.15 : 1.35, w = tall ? 0.52 : 0.4;
    g.at(0, 1.5, 0, -a); g.translate(R, 0, 0);
    const tip = [0.06, top, 0], mid = top * 0.42;
    const A = [0, 0, w], B = [0.16, 0, 0], Cc = [0, 0, -w], D = [-0.16, 0, 0];
    const A2 = [0.02, mid, w * 1.15], C2 = [0.02, mid, -w * 1.15], B2 = [0.2, mid, 0], D2 = [-0.14, mid, 0];
    g.quad(A, B, B2, A2, H); g.quad(B, Cc, C2, B2, G); g.quad(Cc, D, D2, C2, L); g.quad(D, A, A2, D2, L);
    g.tri(A2, B2, tip, H); g.tri(B2, C2, tip, G); g.tri(C2, D2, tip, L); g.tri(D2, A2, tip, G);
    g.jit = 0;
    g.sphere(0.06, top + 0.2, 0, tall ? 0.24 : 0.19, tall ? 0xfffbea : H, { seg: 6, rings: 4 });
    g.jit = 0.07;
    g.restore();
  }
  // arches rising to the orb
  for (let i = 0; i < 4; i++) {
    const a = (i * TAU) / 4;
    g.at(0, 0, 0, -a);
    g.tube([[R - 0.05, 1.5, 0], [R - 0.2, 2.5, 0], [R - 0.9, 3.25, 0], [R - 1.7, 3.6, 0], [0.2, 3.62, 0]], 0.13, i % 2 ? G : H, { seg: 4, ph: Math.PI / 4 });
    for (const [px, py] of [[R - 0.22, 2.55], [R - 0.95, 3.3], [R - 1.72, 3.65]]) g.sphere(px, py + 0.12, 0, 0.11, 0xfffbea, { seg: 4, rings: 2 });
    g.restore();
  }
  // velvet cap
  g.jit = 0.06;
  g.lathe(0, 0, 0, [[R - 0.1, 1.5], [R - 0.3, 2.3], [R - 1.0, 3.0], [R - 1.75, 3.35], [0, 3.45]], 0xb01030, { seg: 8, capTop: false });
  // orb and a golden football on top
  g.jit = 0.07;
  g.cyl(0, 3.5, 0, 0.3, 0.2, L, { seg: 8, rt: 0.22 });
  g.sphere(0, 4.02, 0, 0.42, H, { seg: 8, rings: 5 });
  g.cyl(0, 4.0, 0, 0.44, 0.07, L, { seg: 8, top: false });
  g.jit = 0.05;
  drawFootball(g, 0, 4.9, 0, 1.45, 0x9a5a34, { rz: 0.3, seg: 8 });
  g.jit = 0;
  // gems set into the band
  const gemCols = [0xff2d55, 0x2f8dff, 0x2fe08a, 0xff2d55, 0xb26bff, 0x2fe08a, 0xff2d55, 0x2f8dff];
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) * TAU) / 8, big = i % 2 === 0;
    g.at(0, 1.04, 0, -a); g.cyl(R + 0.1, 0, 0, big ? 0.24 : 0.18, 0.08, L, { seg: 6, rz: -Math.PI / 2 }); g.restore();
    gems.at(0, 1.04, 0, -a); gems.sphere(R + 0.21, 0, 0, big ? 0.19 : 0.14, gemCols[i], { seg: 4, rings: 2, sy: big ? 1.3 : 1 }); gems.restore();
  }
  const mat = makeSelfLitMaterial(0.3); own.push(mat);
  addMesh(spin, g, mat, own, 'crown');
  addMesh(spin, gems, glowMat, own, 'gems');
  // glory: three crossed fans of rays and a soft halo
  for (let k = 0; k < 3; k++) {
    fx.at(0, 2.3, 0, (k * Math.PI) / 3);
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12 + k * 0.17, len = i % 2 ? 4.4 : 6.4, w = 0.13;
      const c = Math.cos(a), s = Math.sin(a), r0 = 1.4;
      fx.triG([c * r0 - s * w, s * r0 + c * w, 0], [c * r0 + s * w, s * r0 - c * w, 0], [c * len, s * len, 0], 0xffd35c, 0xffd35c, 0xffb82e, 0.34, 0.34, 0);
    }
    fx.restore();
  }
  const fxMat = makeAddMaterial(0xffffff, 1); own.push(fxMat);
  const rays = addMesh(group, fx, fxMat, own, 'glory');
  rays.frustumCulled = false;
  const sp = makeSparkles([[R + 0.1, 3.9, 0.3, 0.42], [-R * 0.7, 3.1, R * 0.75, 0.34], [0.3, 5.6, -0.2, 0.4], [-R - 0.2, 1.3, -0.6, 0.3], [R * 0.6, 2.2, -R * 0.8, 0.3]], 0xfff6c8, 2.1);
  spin.add(sp.mesh); own.push(sp.mesh.geometry);
  let night = 0;
  const prop = makeProp(group, own, (dt, t) => {
    const m = motion();
    spin.rotation.y = t * 0.35 * (0.3 + 0.7 * m);
    spin.position.y = Math.sin(t * 0.9) * 0.22 * m;
    spin.rotation.z = Math.sin(t * 0.6) * 0.05 * m;
    spin.rotation.x = Math.cos(t * 0.47) * 0.04 * m;
    rays.rotation.y = -t * 0.12 * m;
    rays.position.y = spin.position.y;
    fxMat.opacity = (0.45 + 0.55 * night) * (0.8 + 0.2 * Math.sin(t * 1.7) * m);
    mat.userData.glow.value = 0.28 + 0.5 * night + 0.05 * Math.sin(t * 2.3) * m;
    sp.update(t);
  }, {
    setNight(a) { night = Math.max(0, Math.min(1, a || 0)); },
    radius: R + 0.3, height: 5.5,
  });
  prop.update(0, 0);
  return prop;
}

// ---- the throne -----------------------------------------------------------------------------------------
export function createThrone() {
  const group = new THREE.Group(); group.name = 'throne';
  const own = [], g = new Geo(), G = C.gold, H = C.goldHi, L = C.goldLo, V = C.velvet;
  // dais
  g.box(0, 0, 0.2, 2.9, 0.2, 2.6, C.navyLt, { top: shade(C.navyLt, 1.15) });
  g.box(0, 0.2, 0.05, 2.3, 0.2, 2.0, C.navyLt, { top: shade(C.navyLt, 1.2) });
  g.box(0, 0.19, 0.2, 2.94, 0.03, 2.64, G, { noTop: true }); g.box(0, 0.39, 0.05, 2.34, 0.03, 2.04, G, { noTop: true });
  g.box(0, 0.2, 0.9, 0.9, 0.012, 1.2, V); g.box(0, 0.4, 0.5, 0.9, 0.012, 1.1, V);
  g.jit = 0.05;
  const Y = 0.4;
  // seat
  g.box(0, Y, 0, 1.3, 0.5, 1.05, G, { side: L });
  g.box(0, Y + 0.5, 0.03, 1.1, 0.1, 0.92, V, { tx: 0.94, tz: 0.94 });
  for (const sx of [-1, 1]) {
    // arms with lion-paw knobs
    g.box(sx * 0.73, Y, 0.02, 0.22, 0.86, 1.0, G, { side: L });
    g.box(sx * 0.73, Y + 0.86, 0.05, 0.28, 0.09, 1.08, H);
    g.sphere(sx * 0.73, Y + 0.95, 0.56, 0.17, H, { seg: 6, rings: 4 });
    // back posts with spires
    g.box(sx * 0.66, Y, -0.48, 0.2, 2.5, 0.2, G);
    g.cone(sx * 0.66, Y + 2.5, -0.48, 0.16, 0.36, H, { seg: 4, ph: Math.PI / 4 });
    g.sphere(sx * 0.66, Y + 2.94, -0.48, 0.1, H, { seg: 5, rings: 3 });
  }
  // back: gold frame, velvet panel with buttons, pointed top
  g.box(0, Y, -0.48, 1.14, 2.3, 0.14, L);
  g.jit = 0;
  g.quad([-0.5, Y + 0.6, -0.405], [0.5, Y + 0.6, -0.405], [0.5, Y + 2.15, -0.405], [-0.5, Y + 2.15, -0.405], V);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.box(-0.3 + c * 0.3, Y + 0.9 + r * 0.4, -0.4, 0.06, 0.06, 0.02, H, { bottom: true, ry: Math.PI / 4 });
  g.jit = 0.05;
  g.tri([-0.66, Y + 2.3, -0.4], [0.66, Y + 2.3, -0.4], [0, Y + 2.95, -0.4], G); g.tri([0.66, Y + 2.3, -0.56], [-0.66, Y + 2.3, -0.56], [0, Y + 2.95, -0.56], L);
  g.quad([0.66, Y + 2.3, -0.4], [0.66, Y + 2.3, -0.56], [0, Y + 2.95, -0.56], [0, Y + 2.95, -0.4], H); g.quad([-0.66, Y + 2.3, -0.56], [-0.66, Y + 2.3, -0.4], [0, Y + 2.95, -0.4], [0, Y + 2.95, -0.56], H);
  // a little crown on the peak
  g.cyl(0, Y + 2.9, -0.48, 0.2, 0.14, H, { seg: 6, top: false });
  for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; g.cone(Math.cos(a) * 0.19, Y + 3.04, -0.48 + Math.sin(a) * 0.19, 0.06, 0.16, H, { seg: 3 }); }
  g.tri([-0.2, Y + 2.45, -0.398], [0.2, Y + 2.45, -0.398], [0, Y + 2.75, -0.398], 0xff2d55);
  g.jit = 0;
  g.shadeY(0, 0.6, 0.88);
  addMesh(group, g, flatMat, own, 'throne');
  return makeProp(group, own, null, { anchors: { seat: V3(0, Y + 0.6, 0.12), foot: V3(0, 0.4, 0.75) } });
}

// ---- gold gates -------------------------------------------------------------------------------------------
export function createGoldGates() {
  const group = new THREE.Group(); group.name = 'goldGates';
  const own = [], g = new Geo(), gl = new Geo({ alpha: true });
  for (const sx of [-1, 1]) drawGatePillar(g, sx * 3.3, 0, 3.5, gl);
  g.shadeY(0, 2.2, 0.9);
  addMesh(group, g, flatMat, own, 'pillars');
  const glowM = makeAddMaterial(0xffffff, 0.3); own.push(glowM);
  addMesh(group, gl, glowM, own, 'lanterns');
  const lg = new Geo(), rg = new Geo();
  drawGateLeaf(lg, 2.66, 2.6, true);
  rg.scale(-1, 1, 1); drawGateLeaf(rg, 2.66, 2.6, true);
  const left = addMesh(group, lg, flatMat, own, 'leafL'), right = addMesh(group, rg, flatMat, own, 'leafR');
  left.position.set(-2.72, 0, 0); right.position.set(2.72, 0, 0);
  let open = 0.85, cur = 0.85;
  const prop = makeProp(group, own, (dt) => {
    cur += (open - cur) * Math.min(1, dt * 2.5);
    left.rotation.y = cur * 1.35; right.rotation.y = -cur * 1.35;
  }, {
    setOpen(a) { open = Math.max(0, Math.min(1, a)); },
    setNight(a) { glowM.opacity = 0.3 + 0.7 * Math.max(0, Math.min(1, a || 0)); },
    colliders: [{ x: -3.3, z: 0, r: 0.75 }, { x: 3.3, z: 0, r: 0.75 }],
    width: 5.4,
  });
  left.rotation.y = cur * 1.35; right.rotation.y = -cur * 1.35;
  return prop;
}

// ---- fountain -----------------------------------------------------------------------------------------------
export function createFountain() {
  const group = new THREE.Group(); group.name = 'fountain';
  const own = [], g = new Geo(), w = new Geo({ alpha: true }), S = C.stoneWarm, Sd = shade(S, 0.85), Sl = shade(S, 1.1);
  g.jit = 0.04;
  // basin
  g.lathe(0, 0, 0, [[2.5, 0, Sd], [2.6, 0.12, S], [2.5, 0.22, S], [2.5, 0.6, Sl], [2.62, 0.68, Sl], [2.62, 0.78]], S, { seg: 10, capTop: false });
  g.band(2.62, 0.78, 2.3, 0.78, 10, Math.PI / 10, Sl); g.band(2.3, 0.78, 2.25, 0.3, 10, Math.PI / 10, Sd);
  g.fan(2.25, 0.3, 10, Math.PI / 10, 0x3f7fa8);
  // stem and two bowls
  g.lathe(0, 0.3, 0, [[0.62, 0], [0.5, 0.3], [0.3, 0.5], [0.24, 1.25], [0.4, 1.4]], S, { seg: 8, capTop: false });
  g.lathe(0, 1.7, 0, [[0.4, 0, Sd], [1.25, 0.2, S], [1.4, 0.38]], S, { seg: 10, capTop: false });
  g.band(1.4, 2.08, 1.26, 2.08, 10, Math.PI / 10, Sl); g.band(1.26, 2.08, 0.4, 1.86, 10, Math.PI / 10, Sd);
  g.lathe(0, 1.9, 0, [[0.26, 0], [0.18, 0.2], [0.16, 0.9], [0.28, 1.0]], S, { seg: 8, capTop: false });
  g.lathe(0, 2.9, 0, [[0.28, 0, Sd], [0.72, 0.14, S], [0.8, 0.26]], S, { seg: 8, capTop: false });
  g.band(0.8, 3.16, 0.7, 3.16, 8, Math.PI / 8, Sl); g.band(0.7, 3.16, 0.25, 3.02, 8, Math.PI / 8, Sd);
  g.lathe(0, 3.02, 0, [[0.14, 0], [0.1, 0.4], [0.2, 0.5]], S, { seg: 6 });
  g.jit = 0;
  g.sphere(0, 3.7, 0, 0.2, C.goldHi, { seg: 6, rings: 4 });
  g.shadeY(0, 1.2, 0.88);
  addMesh(group, g, flatMat, own, 'stone');
  // water: discs in each bowl and sheets falling from the rims
  w.a = 0.78; w.at(0, 0.66, 0); w.fan(2.28, 0, 10, Math.PI / 10, C.water); w.restore();
  w.a = 0.8; w.at(0, 2.04, 0); w.fan(1.27, 0, 10, Math.PI / 10, C.waterLt); w.restore();
  w.at(0, 3.13, 0); w.fan(0.71, 0, 8, Math.PI / 8, C.waterLt); w.restore();
  w.a = 0.42;
  for (let i = 0; i < 10; i += 2) { const a0 = Math.PI / 10 + (i * TAU) / 10, a1 = a0 + TAU / 10; w.quad([Math.cos(a1) * 1.42, 0.7, Math.sin(a1) * 1.42], [Math.cos(a0) * 1.42, 0.7, Math.sin(a0) * 1.42], [Math.cos(a0) * 1.4, 2.08, Math.sin(a0) * 1.4], [Math.cos(a1) * 1.4, 2.08, Math.sin(a1) * 1.4], C.waterLt); }
  for (let i = 0; i < 8; i += 2) { const a0 = Math.PI / 8 + (i * TAU) / 8, a1 = a0 + TAU / 8; w.quad([Math.cos(a1) * 0.83, 2.08, Math.sin(a1) * 0.83], [Math.cos(a0) * 0.83, 2.08, Math.sin(a0) * 0.83], [Math.cos(a0) * 0.8, 3.16, Math.sin(a0) * 0.8], [Math.cos(a1) * 0.8, 3.16, Math.sin(a1) * 0.8], C.waterLt); }
  const water = addMesh(group, w, glassMat, own, 'water');
  // droplets: a jet from the top and spray off each rim
  const dg = new Geo(); dg.sphere(0, 0, 0, 0.07, 0xffffff, { seg: 4, rings: 2, sy: 1.6 });
  const dgeo = dg.build(); own.push(dgeo);
  const N = 30, drops = makeParticles(dgeo, flatMat, N), k = new Float32Array(N * 3), r = rng(12);
  drops.mesh.name = 'droplets'; drops.mesh.frustumCulled = true; drops.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 4);
  for (let i = 0; i < N; i++) { k[i * 3] = r() * TAU; k[i * 3 + 1] = r(); k[i * 3 + 2] = 0.7 + r() * 0.5; }
  group.add(drops.mesh); own.push(drops.mesh);
  const prop = makeProp(group, own, (dt, t) => {
    const m = 0.3 + 0.7 * motion();
    for (let i = 0; i < N; i++) {
      const a = k[i * 3], u = (t * 0.55 * k[i * 3 + 2] * m + k[i * 3 + 1]) % 1, tier = i % 3;
      let rr, y;
      if (tier === 0) { rr = 0.1 + u * 0.55; y = 3.75 + 1.5 * u * (1 - u) * 2.2 - u * 0.62; } else if (tier === 1) { rr = 0.8 + u * 0.35; y = 3.16 - u * u * 1.1 + 0.25 * u * (1 - u); } else { rr = 1.4 + u * 0.55; y = 2.08 - u * u * 1.4 + 0.3 * u * (1 - u); }
      const s = Math.min(1, u * 6) * Math.min(1, (1 - u) * 5);
      drops.set(i, Math.cos(a) * rr, y, Math.sin(a) * rr, s);
    }
    drops.commit();
    water.position.y = Math.sin(t * 2.2) * 0.012 * m;
    water.rotation.y = Math.sin(t * 0.7) * 0.05 * m;
  }, { colliders: [{ x: 0, z: 0, r: 2.75 }], radius: 2.65 });
  prop.update(0, 0);
  return prop;
}

// ---- streetlight ----------------------------------------------------------------------------------------------
let streetlights = 0;
export function createStreetlight({ flicker = false, seed } = {}) {
  const group = new THREE.Group(); group.name = 'streetlight';
  const own = [], g = new Geo(), l = new Geo({ alpha: true }), I = C.iron;
  g.cyl(0, 0, 0, 0.2, 0.14, I, { seg: 6 });
  g.cyl(0, 0.14, 0, 0.14, 0.7, I, { seg: 6, rt: 0.09 });
  g.cyl(0, 0.84, 0, 0.075, 3.9, I, { seg: 5, rt: 0.055, top: false });
  g.tube([[0, 4.7, 0], [0, 5.15, 0.25], [0, 5.3, 0.8], [0, 5.22, 1.3]], 0.05, I, { seg: 4 });
  g.cloft(0, 5.05, 1.42, [[0, 0.42, 0.62, 0.12], [0.1, 0.4, 0.6, 0.12], [0.2, 0.2, 0.34, 0.08]], I, { capBot: flicker ? 0xd9d2b8 : 0xfff3c4 });
  if (flicker) { g.box(0.06, 1.2, 0.07, 0.28, 0.36, 0.01, 0xe9e6dc, { rz: 0.12, bottom: true }); }
  addMesh(group, g, flatMat, own, 'post');
  const warm = flicker ? 0xfff0b0 : 0xffd98a;
  l.a = 1; l.at(0, 5.04, 1.42); l.fan(0.2, 0, 6, 0, warm, true); l.restore();
  halo(l, 0, 4.98, 1.42, 0.85, warm, 0.34, 1);
  l.at(0, 5.0, 1.42); l.scale(1, -1, 1); beam(l, 0.2, 2.6, 4.95, warm, 0.16, 0.02, 10); l.restore();
  // pool of light on the ground
  for (let i = 0; i < 12; i++) {
    const a0 = (i * TAU) / 12, a1 = ((i + 1) * TAU) / 12, rr = 2.9;
    l.triG([0, 0.06, 1.42], [Math.cos(a1) * rr, 0.06, 1.42 + Math.sin(a1) * rr], [Math.cos(a0) * rr, 0.06, 1.42 + Math.sin(a0) * rr], warm, warm, warm, 0.3, 0, 0);
  }
  const mat = makeAddMaterial(0xffffff, 1); own.push(mat);
  const glow = addMesh(group, l, mat, own, 'glow');
  let on = true, level = 1;
  if (seed === undefined) seed = ++streetlights;   // so two bad bulbs never blink in step
  return makeProp(group, own, (dt, t) => {
    if (!on) return;
    let k = 1;
    if (flicker) {
      const m = motion();
      const drop = stepRand(t, 11, seed) < 0.2 ? 0.15 : 1, dead = stepRand(t, 0.35, seed + 3) < 0.25 ? 0.08 : 1;
      k = 1 - (1 - drop * dead * (0.85 + 0.15 * flick(t, seed))) * m;
      if (m < 1) k = Math.max(k, 0.7);
    }
    mat.opacity = level * k;
  }, {
    setOn(v) { on = !!v; glow.visible = on; },
    setNight(a) { level = 0.35 + 0.65 * Math.max(0, Math.min(1, a || 0)); },
    colliders: [{ x: 0, z: 0, r: 0.25 }],
    height: 5.3,
  });
}

// ---- burning barrel ---------------------------------------------------------------------------------------------
export function createBurningBarrel() {
  const group = new THREE.Group(); group.name = 'burningBarrel';
  const own = [], g = new Geo(), gl = new Geo({ alpha: true });
  g.jit = 0.08;
  g.lathe(0, 0, 0, [[0.3, 0, C.rustDk], [0.32, 0.04, C.rust], [0.32, 0.3, 0x6b4a3a], [0.335, 0.33, C.rust], [0.32, 0.36, C.rustDk], [0.32, 0.6, C.rust], [0.335, 0.63, 0x5a4034], [0.32, 0.66, 0x3a2c26], [0.33, 0.9]], C.rust, { seg: 8, capTop: false });
  g.band(0.33, 0.9, 0.29, 0.9, 8, Math.PI / 8, 0x2a2622); g.band(0.29, 0.9, 0.29, 0.55, 8, Math.PI / 8, 0x1c1814);
  g.jit = 0;
  for (const [x, z] of [[-0.24, 0.3], [0.3, 0.2], [0.0, -0.36]]) g.box(x, 0, z, 0.2, 0.09, 0.12, C.brick, { ry: x * 3 });
  addMesh(group, g, flatMat, own, 'barrel');
  // flames: orange tongues around a hot core, one unlit mesh that breathes and twists
  const tongue = (geo, x, z, r, h, col, col2) => geo.lathe(x, 0, z, [[r * 0.7, 0, col], [r, h * 0.25, col], [r * 0.55, h * 0.62, col2], [0, h]], col, { seg: 5, capTop: false });
  const fa = new Geo();
  tongue(fa, -0.08, 0.02, 0.2, 0.9, 0xff5a1a, 0xff8a1a); tongue(fa, 0.12, -0.08, 0.15, 0.62, 0xff6a1f, 0xffa020); tongue(fa, 0.04, 0.13, 0.13, 0.5, 0xff5a1a, 0xff8a1a);
  tongue(fa, 0.02, 0.0, 0.11, 1.0, 0xffc93c, 0xffe98a);
  const flameA = addMesh(group, fa, glowMat, own, 'flames');
  flameA.position.y = 0.6;
  // additive: the glowing rust holes, the coal bed, a halo and a pool of firelight
  gl.a = 0.9; gl.at(0, 0.62, 0); gl.fan(0.29, 0, 8, Math.PI / 8, 0xff7a1a); gl.restore();
  for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; gl.at(0, 0, 0, -a); gl.quad([0.337, 0.14 + (i % 2) * 0.1, 0.05], [0.337, 0.14 + (i % 2) * 0.1, -0.05], [0.337, 0.24 + (i % 2) * 0.1, -0.05], [0.337, 0.24 + (i % 2) * 0.1, 0.05], i % 2 ? 0xffb020 : 0xff6a1f); gl.restore(); }
  halo(gl, 0, 1.0, 0, 1.1, 0xff8a2a, 0.16, 1);
  for (let i = 0; i < 10; i++) { const a0 = (i * TAU) / 10, a1 = ((i + 1) * TAU) / 10; gl.triG([0, 0.05, 0], [Math.cos(a1) * 2.4, 0.05, Math.sin(a1) * 2.4], [Math.cos(a0) * 2.4, 0.05, Math.sin(a0) * 2.4], 0xff8a2a, 0xff8a2a, 0xff8a2a, 0.24, 0, 0); }
  const glMat = makeAddMaterial(0xffffff, 1); own.push(glMat);
  addMesh(group, gl, glMat, own, 'glow');
  // embers
  const eg = new Geo({ alpha: true }); eg.a = 1; eg.sphere(0, 0, 0, 0.03, 0xffb040, { seg: 4, rings: 2 });
  const egeo = eg.build(); own.push(egeo);
  const N = 10, embers = makeParticles(egeo, addMat, N), k = new Float32Array(N * 3), r = rng(4);
  embers.mesh.name = 'embers'; embers.mesh.frustumCulled = true; embers.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 3);
  for (let i = 0; i < N; i++) { k[i * 3] = r(); k[i * 3 + 1] = r() * TAU; k[i * 3 + 2] = 0.6 + r() * 0.8; }
  group.add(embers.mesh); own.push(embers.mesh);
  let night = 0;
  const prop = makeProp(group, own, (dt, t) => {
    const m = motion(), a = flick(t, 1), b = flick(t * 1.3, 5);
    flameA.scale.set(1 + (a - 0.5) * 0.3 * m, 1 + (a - 0.5) * 0.8 * m, 1 + (b - 0.5) * 0.3 * m);
    flameA.rotation.y = t * 1.9 * m;
    glMat.opacity = (0.5 + 0.5 * night) * (0.8 + (a - 0.5) * 0.5 * m);
    for (let i = 0; i < N; i++) {
      const u = (t * 0.35 * k[i * 3 + 2] * (0.4 + 0.6 * m) + k[i * 3]) % 1, an = k[i * 3 + 1] + u * 3;
      const rr = 0.1 + u * 0.45;
      embers.set(i, Math.cos(an) * rr, 1.0 + u * 2.4, Math.sin(an) * rr, (1 - u) * (0.6 + 0.6 * k[i * 3 + 2]));
    }
    embers.commit();
  }, {
    setNight(a) { night = Math.max(0, Math.min(1, a || 0)); },
    colliders: [{ x: 0, z: 0, r: 0.45 }],
  });
  prop.update(0, 0);
  return prop;
}

// ---- personal rain cloud ------------------------------------------------------------------------------------------
export function createRainCloud({ radius = 5, height = 9, seed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'rainCloud';
  const own = [], g = new Geo(), r = rng(seed * 7 + 2), R = radius;
  const dark = 0x525a6b, mid = 0x687182, lite = 0x8a93a3;
  g.jit = 0.035;
  g.ico(0, height + R * 0.14, 0, R * 0.58, mid, { detail: 1, jitter: 0.05, rnd: r, sy: 0.66, flat: 0.55 });
  const puffs = [[-0.56, 0, 0.1, 0.42], [0.56, 0.02, -0.05, 0.46], [0.05, -0.02, 0.5, 0.4], [-0.1, 0.02, -0.5, 0.4], [-0.28, 0.2, -0.16, 0.38], [0.3, 0.22, 0.18, 0.36], [0.9, -0.05, 0.25, 0.27], [-0.92, -0.05, -0.15, 0.27]];
  for (const [px, py, pz, pr] of puffs) g.ico(px * R, height + py * R + R * 0.08, pz * R, pr * R, r() < 0.5 ? mid : lite, { detail: 1, jitter: 0.05, rnd: r, sy: 0.74, flat: 0.6 });
  g.shadeY(height - R * 0.3, height + R * 0.4, 0.55);
  g.jit = 0;
  void dark;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xcfe0ff, emissiveIntensity: 0 });
  mat.name = 'lw-cloud'; own.push(mat);
  addMesh(group, g, mat, own, 'cloud');
  // rain
  const sg = new Geo(); sg.band(0.022, 0, 0.022, 0.55, 3, 0, 0xbfd8f2);
  const sgeo = sg.build(); own.push(sgeo);
  const N = Math.max(16, Math.min(90, Math.round(R * R * 2.2))), rain = makeParticles(sgeo, flatMat, N), k = new Float32Array(N * 3);
  rain.mesh.name = 'rain'; rain.mesh.frustumCulled = true; rain.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), Math.max(R, height / 2) + 2);
  for (let i = 0; i < N; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.85; k[i * 3] = Math.cos(a) * d; k[i * 3 + 1] = Math.sin(a) * d; k[i * 3 + 2] = r(); }
  group.add(rain.mesh); own.push(rain.mesh);
  // lightning bolt
  const b = new Geo(), pts = [[0, height - R * 0.25, 0], [0.5, height * 0.74, 0.2], [-0.3, height * 0.6, -0.1], [0.45, height * 0.4, 0.15], [-0.15, height * 0.22, 0], [0.2, 0.1, 0.1]];
  for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1], w = 0.16 - i * 0.02; b.quad2([p[0] - w, p[1], p[2]], [q[0] - w * 0.7, q[1], q[2]], [q[0] + w * 0.7, q[1], q[2]], [p[0] + w, p[1], p[2]], i % 2 ? 0xfff6c8 : 0xffffff); b.quad2([p[0], p[1], p[2] - w], [q[0], q[1], q[2] - w * 0.7], [q[0], q[1], q[2] + w * 0.7], [p[0], p[1], p[2] + w], 0xfff6c8); }
  const bolt = addMesh(group, b, glowMat, own, 'bolt');
  bolt.visible = false;
  let next = 4 + r() * 6, flash = -1;
  const prop = makeProp(group, own, (dt, t) => {
    const fallH = height - R * 0.2;
    for (let i = 0; i < N; i++) {
      const u = (t * 1.5 + k[i * 3 + 2] * 3) % 1;
      rain.set(i, k[i * 3], fallH * (1 - u), k[i * 3 + 1], 1, 0.7 + k[i * 3 + 2] * 0.7, 1);
    }
    rain.commit();
    if (isReducedMotion()) { mat.emissiveIntensity = 0; bolt.visible = false; return; }
    next -= dt;
    if (next <= 0 && flash < 0) {
      flash = 0; next = 6 + r() * 9;
      bolt.rotation.y = r() * TAU; bolt.position.set((r() - 0.5) * R * 0.8, 0, (r() - 0.5) * R * 0.8);
      if (prop.onFlash) prop.onFlash();
    }
    if (flash >= 0) {
      flash += dt;
      const e = flash < 0.08 ? 1 : flash < 0.16 ? 0.15 : flash < 0.26 ? 0.85 : Math.max(0, 1 - (flash - 0.26) / 0.3) * 0.5;
      mat.emissiveIntensity = e * 0.9;
      bolt.visible = flash < 0.08 || (flash > 0.16 && flash < 0.26);
      if (flash > 0.56) { flash = -1; mat.emissiveIntensity = 0; bolt.visible = false; }
    }
  }, { onFlash: null, radius: R, height });
  prop.update(0, 0);
  return prop;
}

// ---- the defending champion's statue ----------------------------------------------------------------------------------
export function createStatue(condition = 'shiny') {
  const group = new THREE.Group(); group.name = 'statue-' + condition;
  const own = [], g = new Geo(), r = rng(9);
  const shiny = condition === 'shiny', pig = condition === 'pigeons';
  const F = shiny ? C.gold : pig ? 0x5f9c8a : 0x857b6c, Fh = shiny ? C.goldHi : pig ? 0x7fb8a4 : 0x9a9082, Fl = shiny ? C.goldLo : pig ? 0x4a7f72 : 0x6b6256;
  const stone = shiny ? C.stone : pig ? 0xa7ab9e : 0x9a968c;
  // plinth: flat front face 2.5 x 1.5
  g.box(0, 0, 0, 3.1, 0.25, 2.3, shade(stone, 0.88));
  g.box(0, 0.25, 0, 2.5, 1.5, 1.8, stone, { side: shade(stone, 0.94) });
  g.box(0, 1.75, 0, 2.8, 0.2, 2.1, shade(stone, 1.08));
  const PY = 1.95;
  g.jit = shiny ? 0.07 : 0.05;
  // legs, one boot up on a football
  g.cloft(-0.3, PY, 0, [[0, 0.34, 0.5, 0.1, 0, 0.06], [0.14, 0.32, 0.4, 0.1], [0.75, 0.36, 0.38, 0.1], [1.45, 0.42, 0.42, 0.12, 0.06, 0]], F, {});
  drawFootball(g, 0.42, PY + 0.2, 0.3, 0.62, Fl, { ry: 0.5 });
  g.cloft(0.36, PY + 0.4, 0.22, [[0, 0.34, 0.48, 0.1, 0, 0.06], [0.14, 0.32, 0.38, 0.1], [0.62, 0.36, 0.38, 0.1, 0, -0.06]], F, {});
  g.cloft(0.33, PY + 1.0, 0.16, [[0, 0.38, 0.4, 0.1], [0.5, 0.42, 0.42, 0.12, -0.05, -0.16]], Fh, { capTop: false });
  // hips, torso, big shoulder pads
  g.cloft(0, PY + 1.4, 0, [[0, 0.82, 0.46, 0.14], [0.3, 0.74, 0.44, 0.14], [0.85, 0.9, 0.5, 0.16], [1.1, 1.0, 0.52, 0.16]], F, {});
  g.cloft(0, PY + 2.42, 0, [[0, 1.5, 0.66, 0.2], [0.22, 1.56, 0.7, 0.24], [0.4, 0.9, 0.5, 0.2]], Fh, {});
  // helmeted head with a face bar
  g.cloft(0, PY + 2.8, 0.02, [[0, 0.3, 0.3, 0.1], [0.12, 0.56, 0.6, 0.18], [0.46, 0.6, 0.64, 0.2], [0.62, 0.44, 0.48, 0.18]], F, {});
  g.box(0, PY + 2.96, 0.3, 0.38, 0.26, 0.06, Fl);
  g.tube([[-0.28, PY + 2.98, 0.24], [-0.2, PY + 2.92, 0.42], [0.2, PY + 2.92, 0.42], [0.28, PY + 2.98, 0.24]], 0.03, Fh, { seg: 3 });
  g.box(0, PY + 3.38, 0.02, 0.1, 0.07, 0.6, Fh);
  // arm on the hip
  g.tube([[-0.74, PY + 2.4, 0], [-1.02, PY + 1.95, 0.05], [-0.62, PY + 1.6, 0.16]], 0.17, F, { seg: 5, caps: true });
  // the other arm thrusts a trophy at the sky
  g.tube([[0.74, PY + 2.45, 0], [1.0, PY + 3.0, 0.04], [0.92, PY + 3.62, 0.08]], 0.17, F, { seg: 5, caps: true });
  g.sphere(0.92, PY + 3.72, 0.08, 0.2, Fh, { seg: 6, rings: 3 });
  const TY = PY + 3.88;
  g.lathe(0.92, TY, 0.08, [[0.2, 0, Fl], [0.2, 0.06, F], [0.07, 0.14, F], [0.07, 0.34, Fh], [0.3, 0.52, Fh], [0.42, 0.95]], Fh, { seg: 8, capTop: false });
  g.at(0.92, TY, 0.08); g.band(0.42, 0.95, 0.34, 0.95, 8, Math.PI / 8, Fh); g.band(0.34, 0.95, 0.2, 0.56, 8, Math.PI / 8, Fl);
  for (const sx of [-1, 1]) g.tube([[sx * 0.36, 0.88, 0], [sx * 0.62, 0.8, 0], [sx * 0.6, 0.56, 0], [sx * 0.28, 0.5, 0]], 0.04, F, { seg: 3 });
  g.restore();
  g.jit = 0;
  if (pig) {
    // weathered: streaks, droppings, and tenants
    const W = 0xeef0ea;
    for (const [x, y, z, s] of [[0.1, PY + 3.44, 0.1, 0.16], [-0.5, PY + 2.83, 0.2, 0.2], [0.6, PY + 2.83, -0.1, 0.16], [0.9, 1.96, 0.7, 0.22], [-0.8, 1.96, -0.4, 0.2], [0.3, 1.96, 0.85, 0.14]]) g.disc(x, y, z, s, W, { seg: 5, sx: 1.4, ry: x * 9 });
    g.quad([0.86, 1.2, 0.905], [1.0, 1.2, 0.905], [0.98, 1.75, 0.905], [0.84, 1.75, 0.905], W); g.quad([-0.6, PY + 2.2, 0.36], [-0.5, PY + 2.2, 0.36], [-0.48, PY + 2.82, 0.355], [-0.58, PY + 2.82, 0.355], W);
    drawPigeon(g, 0.02, PY + 3.44, 0.0, 1.5, 0.6, 0);
    drawPigeon(g, 0.93, TY + 0.96, 0.4, 1.4, -0.4, 0);
    drawPigeon(g, -1.05, 1.95, 0.6, 1.4, 2.4, 1);
    drawPigeon(g, -0.62, PY + 2.84, -0.05, 1.4, 3.6, 0);
  } else if (!shiny) {
    // neglected: a traffic cone hat, a bag someone left, weeds
    drawTrafficCone(g, 0.02, PY + 3.36, 0.02, 1.5, { rz: 0.12 });
    drawBag(g, 1.7, 0, 0.8, 0.9, C.bag, r);
    for (const [x, z] of [[-1.5, 1.1], [-1.3, 1.25], [1.2, -1.2], [0.2, 1.25]]) g.cone(x, 0, z, 0.14, 0.5, 0x7c8a45, { seg: 3, ry: x });
    g.quad([-0.9, 0.7, 0.905], [-0.5, 0.62, 0.905], [-0.46, 1.1, 0.905], [-0.86, 1.2, 0.905], 0xe9e6dc);
    g.text('LOL', -0.68, 0.84, 0.91, 0.03, 0x2a2622, { rz: -0.15 });
  }
  g.shadeY(0, 1.2, 0.9);
  addMesh(group, g, flatMat, own, 'statue');
  let sp = null;
  if (shiny) { sp = makeSparkles([[1.2, TY + 1.1, 0.3, 0.3], [-0.5, PY + 3.3, 0.5, 0.2], [0.5, PY + 2.2, 0.5, 0.18]]); group.add(sp.mesh); own.push(sp.mesh.geometry); }
  return makeProp(group, own, sp ? (dt, t) => sp.update(t) : null, {
    condition,
    anchors: { plaque: V3(0, 1.0, 0.91), top: V3(0.92, TY + 1.0, 0.08) },
    plaqueSize: { w: 2.2, h: 1.2 },
    colliders: [{ x: 0, z: 0, r: 1.7 }],
  });
}

// ---- small town furniture ---------------------------------------------------------------------------------------------
export function createNewspaperBox() {
  const group = new THREE.Group(); group.name = 'newspaperBox';
  const own = [], g = new Geo(), B = 0xc7382e, Bd = shade(B, 0.78);
  g.box(0, 0, 0, 0.5, 0.06, 0.44, C.iron);
  g.box(0, 0.06, 0, 0.12, 0.34, 0.12, C.iron);
  g.cloft(0, 0.4, 0, [[0, 0.56, 0.46, 0.05], [0.72, 0.56, 0.46, 0.05], [0.8, 0.5, 0.36, 0.05, 0, -0.03]], B, {});
  g.quad([-0.21, 0.6, 0.232], [0.21, 0.6, 0.232], [0.21, 1.02, 0.232], [-0.21, 1.02, 0.232], 0x2a3644);
  // today's paper
  g.quad([-0.17, 0.62, 0.236], [0.17, 0.62, 0.236], [0.17, 1.0, 0.236], [-0.17, 1.0, 0.236], 0xf1ead8);
  g.quad([-0.14, 0.9, 0.24], [0.14, 0.9, 0.24], [0.14, 0.97, 0.24], [-0.14, 0.97, 0.24], 0x23201f);
  for (let i = 0; i < 3; i++) g.quad([-0.14, 0.82 - i * 0.07, 0.24], [0.02 + (i % 2) * 0.1, 0.82 - i * 0.07, 0.24], [0.02 + (i % 2) * 0.1, 0.85 - i * 0.07, 0.24], [-0.14, 0.85 - i * 0.07, 0.24], 0x8a8478);
  g.quad([0.05, 0.66, 0.24], [0.14, 0.66, 0.24], [0.14, 0.8, 0.24], [0.05, 0.8, 0.24], 0xaab3bf);
  g.box(0, 0.5, 0.235, 0.3, 0.05, 0.03, C.metalLt);
  g.box(0.2, 1.06, 0.2, 0.1, 0.1, 0.05, C.metalDk);
  g.box(0, 1.2, -0.03, 0.56, 0.2, 0.05, Bd, { bottom: true });
  g.text('NEWS', 0, 1.235, 0.0, 0.026, C.goldHi);
  addMesh(group, g, flatMat, own, 'box');
  return makeProp(group, own, null, { colliders: [{ x: 0, z: 0, r: 0.4 }] });
}

export function createTelescope() {
  const group = new THREE.Group(); group.name = 'telescope';
  const own = [], g = new Geo(), M = 0x5d7fa3, Md = shade(M, 0.75);
  g.lathe(0, 0, 0, [[0.3, 0, C.iron], [0.3, 0.06, C.iron], [0.12, 0.14, Md], [0.09, 0.95, Md], [0.13, 1.02]], Md, { seg: 7 });
  for (const sx of [-1, 1]) g.box(sx * 0.2, 1.0, 0, 0.05, 0.36, 0.12, C.metalLt);
  g.box(0, 1.0, 0, 0.44, 0.05, 0.12, C.metalLt);
  g.at(0, 1.32, 0, 0, -0.14);
  g.cloft(0, 0, -0.2, [[0, 0.32, 0.4, 0.1], [0.2, 0.36, 0.44, 0.12], [0.4, 0.32, 0.4, 0.1]], M, { rx: Math.PI / 2, capBot: true });
  for (const sx of [-1, 1]) {
    g.cyl(sx * 0.085, 0.01, 0.2, 0.075, 0.2, C.metalLt, { seg: 6, rx: Math.PI / 2, top: C.glassB });
    g.cyl(sx * 0.085, 0.01, -0.2, 0.05, 0.1, C.iron, { seg: 6, rx: -Math.PI / 2, top: 0x14161c });
  }
  g.box(0, 0.2, -0.02, 0.1, 0.08, 0.16, C.gold);
  g.restore();
  g.box(0.14, 1.06, -0.12, 0.08, 0.12, 0.05, C.gold);
  addMesh(group, g, flatMat, own, 'telescope');
  return makeProp(group, own, null, { colliders: [{ x: 0, z: 0, r: 0.35 }], anchors: { viewer: V3(0, 0, -0.75) } });
}

// The Dump's answer to the telescope: cardboard, duct tape and hope.
export function createPeriscope() {
  const group = new THREE.Group(); group.name = 'periscope';
  const own = [], g = new Geo(), K = C.cardboard, Kd = C.cardboardDk, T = C.tape;
  g.lathe(0, 0, 0, [[0.2, 0], [0.26, 0.34]], 0x8fa3a8, { seg: 7, capTop: 0x6b6a62 });
  g.box(0.1, 0.28, 0.06, 0.12, 0.1, 0.12, C.concreteDk); g.box(-0.09, 0.3, -0.04, 0.1, 0.08, 0.1, C.concrete);
  g.at(0, 0.2, 0, 0, 0.05, -0.06);
  g.box(0, 0, 0, 0.24, 2.3, 0.24, K, { side: Kd });
  g.box(0, 2.1, 0.2, 0.26, 0.26, 0.5, K, { side: Kd, front: 0x23201f });
  g.quad([-0.08, 2.14, 0.452], [0.08, 2.14, 0.452], [0.06, 2.3, 0.452], [-0.1, 2.26, 0.452], C.glassB);
  g.box(0, 0.75, -0.2, 0.26, 0.26, 0.5, K, { side: Kd, back: 0x23201f });
  g.cyl(0, 0.88, -0.45, 0.09, 0.08, Kd, { seg: 6, rx: -Math.PI / 2, top: 0x14161c });
  for (const y of [0.66, 1.0, 2.04, 1.5]) g.box(0, y, 0, 0.26, 0.07, 0.26, T, { noTop: true });
  g.box(0, 2.06, 0.12, 0.28, 0.06, 0.07, T); g.box(0, 0.98, -0.12, 0.28, 0.06, 0.07, T);
  g.text('HILL CAM', 0, 1.2, 0.122, 0.019, 0x2a2622, { rz: 0.05 });
  g.tri([0.0, 1.42, 0.123], [0.07, 1.34, 0.123], [-0.07, 1.34, 0.123], 0x2a2622);
  g.restore();
  g.tube([[0.1, 1.3, 0.1], [0.75, 0, 0.5]], 0.025, C.woodLt, { seg: 3 });
  addMesh(group, g, flatMat, own, 'periscope');
  return makeProp(group, own, null, { colliders: [{ x: 0, z: 0, r: 0.35 }], anchors: { viewer: V3(0, 0, -0.9) } });
}

export function createOuthouse() {
  const group = new THREE.Group(); group.name = 'outhouse';
  const own = [], g = new Geo(), A = C.wood, B = C.woodLt, D = C.woodDk;
  g.box(0, 0, 0, 1.5, 0.1, 1.5, D);
  // plank walls
  for (let i = 0; i < 5; i++) {
    const x = -0.56 + i * 0.28, col = i % 2 ? A : shade(A, 1.1);
    g.box(x, 0.1, -0.62, 0.27, 2.2, 0.06, col); g.box(-0.62, 0.1, x, 0.06, 2.2, 0.27, col); g.box(0.62, 0.1, x, 0.06, 2.2, 0.27, shade(col, 0.94));
  }
  for (const sx of [-1, 1]) g.box(sx * 0.52, 0.1, 0.62, 0.24, 2.45, 0.06, A);
  g.box(0, 2.2, 0.62, 0.8, 0.35, 0.06, shade(A, 1.1));
  for (const sx of [-1, 1]) g.tri2([sx * 0.65, 2.3, -0.65], [sx * 0.65, 2.3, 0.65], [sx * 0.65, 2.56, 0.65], A);
  // the door, with the traditional moon
  g.box(0, 0.12, 0.65, 0.78, 2.05, 0.05, B);
  for (const y of [0.5, 1.7]) g.box(0, y, 0.68, 0.78, 0.1, 0.02, D);
  g.box(0.28, 1.05, 0.69, 0.06, 0.16, 0.04, C.iron);
  for (let i = 0; i < 5; i++) {
    const a0 = -1.2 + i * 0.48, a1 = a0 + 0.48, ro = 0.17, cx = -0.02, cy = 1.42, k0 = Math.sin(((i) / 5) * Math.PI) * 0.09, k1 = Math.sin(((i + 1) / 5) * Math.PI) * 0.09;
    const p = (a, rr) => [cx - Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.677];
    g.quad(p(a0, ro), p(a0, ro - k0), p(a1, ro - k1), p(a1, ro), 0x1c1814);
  }
  // roof and vent
  g.at(0, 2.44, 0, 0, -0.19); g.box(0, 0, 0, 1.75, 0.08, 1.85, 0x5d6b73, { bottom: 0x3f4a50 }); g.restore();
  g.cyl(0.45, 2.3, -0.4, 0.05, 0.7, C.metalDk, { seg: 5 });
  // a blank board for the world's sign
  g.box(0, 2.22, 0.665, 0.92, 0.3, 0.03, 0xe9dfc4, { bottom: true });
  g.shadeY(0, 1.0, 0.88);
  addMesh(group, g, flatMat, own, 'outhouse');
  const flies = makeFlySwarm(3, 0.5, 2.4, 5);
  flies.mesh.position.set(0.5, 0, 0.4);
  group.add(flies.mesh); own.push(flies.mesh);
  return makeProp(group, own, flies.update, {
    anchors: { sign: V3(0, 2.37, 0.685), door: V3(0, 0, 1.3) },
    signSize: { w: 0.88, h: 0.26 },
    footprint: { w: 1.5, d: 1.5 },
  });
}

export function createTree(kind = 'round', { seed = 1, scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'tree-' + kind;
  const own = [], g = new Geo();
  drawTree(g, kind, 0, 0, 0, scale, rng(seed * 11 + kind.length));
  if (kind === 'dead') {
    // one plastic bag, snagged for ever
    g.quad2([0.5 * scale, 2.6 * scale, 0.3 * scale], [0.9 * scale, 2.5 * scale, 0.36 * scale], [0.86 * scale, 2.95 * scale, 0.44 * scale], [0.52 * scale, 2.9 * scale, 0.3 * scale], 0xe9e6dc);
  }
  if (kind === 'round' || kind === 'pine') g.shadeY(0.8 * scale, 3.4 * scale, 0.8);
  const mesh = addMesh(group, g, flatMat, own, 'tree');
  return makeProp(group, own, null, { mesh, colliders: [{ x: 0, z: 0, r: kind === 'topiary' ? 0.55 : 0.35 * scale }] });
}

export function createBush({ seed = 1, scale = 1, color } = {}) {
  const group = new THREE.Group(); group.name = 'bush';
  const own = [], g = new Geo();
  drawBush(g, 0, 0, 0, scale, rng(seed * 5 + 1), color || C.hedge);
  g.shadeY(0, 0.7 * scale, 0.78);
  const mesh = addMesh(group, g, flatMat, own, 'bush');
  return makeProp(group, own, null, { mesh });
}

export function createTrashCan({ seed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'trashCan';
  const own = [], g = new Geo(), r = rng(seed);
  drawTrashCan(g, 0, 0, 0, { lidTilt: 0.22 });
  drawBag(g, 0.05, 0.42, 0.02, 0.55, C.bag, r);
  g.shadeY(0, 0.5, 0.85);
  const mesh = addMesh(group, g, flatMat, own, 'can');
  return makeProp(group, own, null, { mesh, colliders: [{ x: 0, z: 0, r: 0.38 }] });
}

// Gold stanchions and a red rope, centered on the origin and running along X.
export function createVelvetRope(length = 4) {
  const group = new THREE.Group(); group.name = 'velvetRope';
  const own = [], g = new Geo(), len = Math.max(1, length), n = Math.max(1, Math.round(len / 2.2)), colliders = [];
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (len * i) / n;
    g.lathe(x, 0, 0, [[0.19, 0, C.goldLo], [0.19, 0.04, C.gold], [0.045, 0.12, C.gold], [0.035, 0.92, C.goldHi], [0.07, 0.96]], C.gold, { seg: 6 });
    g.sphere(x, 1.02, 0, 0.075, C.goldHi, { seg: 4, rings: 2 });
    colliders.push({ x, z: 0, r: 0.2 });
    if (i < n) {
      const x1 = -len / 2 + (len * (i + 1)) / n, pts = [];
      for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push([x + (x1 - x) * t, 0.9 - Math.sin(t * Math.PI) * 0.26, 0]); }
      g.tube(pts, 0.042, C.velvet, { seg: 4 });
    }
  }
  const mesh = addMesh(group, g, flatMat, own, 'rope');
  return makeProp(group, own, null, { mesh, colliders, length: len });
}

export function createLawnChair({ color } = {}) {
  const group = new THREE.Group(); group.name = 'lawnChair';
  const own = [], g = new Geo();
  drawLawnChair(g, 0, 0, 0, { color });
  const mesh = addMesh(group, g, flatMat, own, 'chair');
  return makeProp(group, own, null, { mesh, anchors: { seat: V3(0, 0.44, 0.02) }, colliders: [{ x: 0, z: 0, r: 0.4 }] });
}

export function createGrill() {
  const group = new THREE.Group(); group.name = 'grill';
  const own = [], g = new Geo(), f = new Geo(), K = 0xc7382e, Kd = shade(K, 0.7);
  for (const [x, z, wheel] of [[-0.3, -0.22, 1], [0.3, -0.22, 1], [0, 0.32, 0]]) {
    g.tube([[x, wheel ? 0.1 : 0, z], [x * 0.5, 0.62, z * 0.5]], 0.02, C.metalLt, { seg: 3 });
    if (wheel) g.cyl(x + (x > 0 ? 0.02 : -0.06), 0.1, z, 0.1, 0.04, C.tire, { seg: 6, rz: -Math.PI / 2, bottom: true });
  }
  g.lathe(0, 0.55, 0, [[0.1, 0, Kd], [0.34, 0.12, K], [0.42, 0.34]], K, { seg: 8, capTop: false });
  g.band(0.42, 0.89, 0.4, 0.89, 8, Math.PI / 8, C.metalLt); g.band(0.4, 0.89, 0.12, 0.62, 8, Math.PI / 8, 0x2a2622);
  g.fan(0.4, 0.86, 8, Math.PI / 8, 0x3a3632);
  // lid, propped open at the back
  g.at(0, 0.9, -0.4, 0, -1.15);
  g.lathe(0, 0, 0.4, [[0.43, 0], [0.36, 0.14], [0.14, 0.24]], K, { seg: 8, capTop: K }); g.band(0.14, 0.24, 0.36, 0.14, 8, Math.PI / 8, Kd); g.band(0.36, 0.14, 0.43, 0, 8, Math.PI / 8, Kd);
  g.box(0, 0.24, 0.4, 0.16, 0.07, 0.05, C.woodDk);
  g.restore();
  g.box(0.55, 0.78, 0, 0.34, 0.03, 0.4, C.woodLt, { bottom: true });
  // burgers and dogs
  g.cyl(-0.14, 0.87, 0.06, 0.09, 0.04, 0x6b3a24, { seg: 6 }); g.cyl(0.12, 0.87, -0.1, 0.09, 0.04, 0x7a4428, { seg: 6 });
  g.cyl(0.14, 0.9, 0.14, 0.03, 0.2, 0xc4553e, { seg: 4, rz: Math.PI / 2 });
  addMesh(group, g, flatMat, own, 'grill');
  for (let i = 0; i < 6; i++) { const a = i * 1.1, x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2; f.quad([x - 0.04, 0.866, z + 0.03], [x + 0.04, 0.866, z + 0.03], [x + 0.04, 0.866, z - 0.03], [x - 0.04, 0.866, z - 0.03], i % 2 ? 0xff7a1a : 0xffb020); }
  addMesh(group, f, glowMat, own, 'coals');
  const pg = new Geo(); pg.ico(0, 0, 0, 0.12, 0xd9dcdf, { jitter: 0.15, rnd: rng(3) });
  const pgeo = pg.build(); own.push(pgeo);
  const N = 6, puffs = makeParticles(pgeo, flatMat, N);
  puffs.mesh.name = 'smoke'; puffs.mesh.frustumCulled = true; puffs.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 2.5);
  group.add(puffs.mesh); own.push(puffs.mesh);
  const prop = makeProp(group, own, (dt, t) => {
    const m = 0.35 + 0.65 * motion();
    for (let i = 0; i < N; i++) {
      const u = (t * 0.28 * m + i / N) % 1;
      const s = Math.sin(u * Math.PI) * (0.6 + u * 1.1);
      puffs.set(i, Math.sin(i * 2.4 + u * 3) * 0.12 * (1 + u) + u * 0.35, 1.0 + u * 1.9, Math.cos(i * 1.7 + u * 2) * 0.1, s);
    }
    puffs.commit();
  }, { anchors: { stand: V3(0, 0, 0.8) }, colliders: [{ x: 0, z: 0, r: 0.5 }] });
  prop.update(0, 0);
  return prop;
}

void mix; void makeBlob; void drawLawnChair;
