// Vehicles: the garbage truck that works the park, the ambulance that parks outside when your
// roster is on IR, and the moving truck that shows up when you change neighborhoods.
// Every vehicle faces +Z (it drives toward +Z), sits on y = 0 and carries a blob shadow.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade } from './geo.js';
import { flatMat, addMat, makeAddMaterial } from './materials.js';
import { rng, motion, makeProp, addMesh, makeBlob, halo, blankTexture, isReducedMotion, V3 } from './util.js';
import { C, drawBag, drawTire, drawCardboardBox } from './parts.js';

function wheel(g, x, y, z, r, w, seg = 8) {
  // axle along X, hub facing outward
  drawTire(g, x - Math.sign(x) * w, y, z, r, w, { rz: x > 0 ? -Math.PI / 2 : Math.PI / 2, seg, hub: C.metalLt });
}
function glassQuad(g, a, b, c, d) { g.tri(a, b, d, C.glassA); g.tri(b, c, d, C.glassB); }

// ---- ambulance ------------------------------------------------------------------------------------------
export function createAmbulance(count = 1) {
  const n = Math.max(0, Math.round(count || 0));
  const group = new THREE.Group(); group.name = 'ambulance';
  const own = [], g = new Geo(), W = C.white, stripe = 0xff6a3d, navy = C.navy;
  g.box(0, 0.32, 0, 1.9, 0.3, 5.1, C.iron, { bottom: true });
  // box module and cab
  g.cloft(0, 0, -0.8, [[0.6, 2.15, 3.5, 0.16], [2.5, 2.15, 3.5, 0.16], [2.66, 1.9, 3.26, 0.16]], W, { capTop: shade(W, 0.96) });
  g.cloft(0, 0, 1.75, [[0.6, 2.0, 1.75, 0.18], [1.5, 2.0, 1.75, 0.18], [2.15, 1.84, 1.0, 0.16, 0, -0.36]], W, {});
  g.cloft(0, 0, -0.8, [[1.12, 2.17, 3.52, 0.16], [1.5, 2.17, 3.52, 0.16]], stripe, { capTop: false });
  g.cloft(0, 0, 1.75, [[1.12, 2.02, 1.77, 0.18], [1.48, 2.02, 1.77, 0.18]], stripe, { capTop: false });
  g.cloft(0, 0, -0.8, [[1.5, 2.17, 3.52, 0.16], [1.56, 2.17, 3.52, 0.16]], navy, { capTop: false });
  // glass
  glassQuad(g, [-0.72, 1.56, 2.63], [0.72, 1.56, 2.63], [0.66, 2.1, 2.0], [-0.66, 2.1, 2.0]);
  for (const sx of [-1, 1]) {
    const x = sx * 1.012, a = [x, 1.56, 2.25], b = [x, 1.56, 1.3], c = [sx * 0.94, 2.06, 1.3], d = [sx * 0.94, 2.06, 1.85];
    if (sx > 0) glassQuad(g, a, b, c, d); else glassQuad(g, b, a, d, c);
    g.box(sx * 1.12, 1.5, 2.2, 0.1, 0.22, 0.06, C.iron);
  }
  // nose
  g.box(0, 0.5, 2.66, 2.05, 0.2, 0.14, C.metal);
  g.quad([-0.5, 0.82, 2.635], [0.5, 0.82, 2.635], [0.5, 1.06, 2.635], [-0.5, 1.06, 2.635], C.iron);
  for (const sx of [-1, 1]) g.quad([sx * 0.78 - 0.14, 0.84, 2.635], [sx * 0.78 + 0.14, 0.84, 2.635], [sx * 0.78 + 0.14, 1.04, 2.635], [sx * 0.78 - 0.14, 1.04, 2.635], 0xfff3c4);
  // rear doors
  g.quad([0.02, 0.7, -2.562], [-0.02, 0.7, -2.562], [-0.02, 2.4, -2.562], [0.02, 2.4, -2.562], C.metalDk);
  for (const sx of [-1, 1]) { glassQuad(g, [sx * 0.5 + 0.28, 1.75, -2.562], [sx * 0.5 - 0.28, 1.75, -2.562], [sx * 0.5 - 0.28, 2.2, -2.562], [sx * 0.5 + 0.28, 2.2, -2.562]); g.quad([sx * 0.86 + 0.08, 0.8, -2.562], [sx * 0.86 - 0.08, 0.8, -2.562], [sx * 0.86 - 0.08, 1.0, -2.562], [sx * 0.86 + 0.08, 1.0, -2.562], C.red); }
  g.box(0, 0.42, -2.62, 2.0, 0.14, 0.2, C.metal);
  // lettering and a heartbeat line on both sides
  const label = 'IR x' + (n > 9 ? '9+' : n);
  for (const sx of [-1, 1]) {
    g.at(sx * 1.09, 0, -0.8, (sx * Math.PI) / 2);
    g.text(label, 0, 1.78, 0, 0.1, C.red);
    const pts = [[-1.5, 0], [-0.75, 0], [-0.6, 0.12], [-0.45, -0.12], [-0.3, 0.14], [-0.15, 0], [0.6, 0], [0.72, 0.1], [0.84, -0.1], [0.96, 0], [1.5, 0]];
    for (let i = 0; i < pts.length - 1; i++) g.quad([pts[i][0], 1.28 + pts[i][1], 0.004], [pts[i + 1][0], 1.28 + pts[i + 1][1], 0.004], [pts[i + 1][0], 1.34 + pts[i + 1][1], 0.004], [pts[i][0], 1.34 + pts[i][1], 0.004], W);
    g.restore();
  }
  for (const [x, z] of [[1.05, 1.7], [-1.05, 1.7], [1.05, -1.7], [-1.05, -1.7]]) wheel(g, x, 0.42, z, 0.42, 0.28);
  // light bar housing with two dim lenses
  g.box(0, 2.66, 0.55, 1.5, 0.1, 0.34, C.metalDk);
  g.box(-0.42, 2.76, 0.55, 0.56, 0.16, 0.28, 0x8a2a2a); g.box(0.42, 2.76, 0.55, 0.56, 0.16, 0.28, 0x9a9aa0);
  g.shadeY(0.2, 1.4, 0.86);
  addMesh(group, g, flatMat, own, 'body');
  // the flash: [red lens + halo][white lens + halo], shown one at a time with drawRange
  const f = new Geo({ alpha: true });
  f.a = 1; f.box(-0.42, 2.75, 0.55, 0.6, 0.2, 0.32, 0xff2a2a, { bottom: true }); halo(f, -0.42, 2.85, 0.55, 0.7, 0xff3030, 0.34, 1);
  const split = f.p.length / 3;
  f.a = 1; f.box(0.42, 2.75, 0.55, 0.6, 0.2, 0.32, 0xffffff, { bottom: true }); halo(f, 0.42, 2.85, 0.55, 0.7, 0xdfe8ff, 0.34, 1);
  const total = f.p.length / 3;
  const flash = addMesh(group, f, addMat, own, 'lightbar');
  group.add(makeBlob(1.5, 3.1));
  return makeProp(group, own, (dt, t) => {
    if (isReducedMotion()) { const k = Math.floor(t) % 2; flash.geometry.setDrawRange(k ? split : 0, k ? total - split : split); return; }
    const k = Math.floor(t * 9) % 8;
    if (k === 0 || k === 2) flash.geometry.setDrawRange(0, split);
    else if (k === 4 || k === 6) flash.geometry.setDrawRange(split, total - split);
    else flash.geometry.setDrawRange(0, 0);
  }, { count: n });
}

// ---- moving truck ---------------------------------------------------------------------------------------
function drawCouch(g, x, z, ry) {
  const c = 0x8a7a4a, d = shade(c, 0.82);
  g.at(x, 0, z, ry, 0, 0.05);
  g.box(0, 0.12, 0, 1.9, 0.34, 0.85, c);
  g.box(0, 0.4, -0.34, 1.9, 0.62, 0.22, d, { rx: -0.12 });
  for (const sx of [-1, 1]) { g.box(sx * 0.95, 0.1, 0, 0.24, 0.62, 0.9, d); g.box(sx * 0.42, 0.46, 0.06, 0.8, 0.14, 0.66, shade(c, 1.12), { rz: sx * 0.05 }); g.box(sx * 0.85, 0, 0.32, 0.08, 0.12, 0.08, C.woodDk); g.box(sx * 0.85, 0, -0.32, 0.08, 0.12, 0.08, C.woodDk); }
  // a spring has given up
  g.tube([[0.5, 0.58, 0.1], [0.56, 0.7, 0.16], [0.46, 0.8, 0.1], [0.56, 0.9, 0.04], [0.5, 1.0, 0.1]], 0.015, C.metalLt, { seg: 3 });
  g.quad2([-0.75, 0.47, 0.34], [-0.5, 0.47, 0.34], [-0.5, 0.62, 0.34], [-0.75, 0.62, 0.34], 0x6b7f5a);
  g.restore();
}

export function createMovingTruck(direction = 'up') {
  const up = direction !== 'down';
  const group = new THREE.Group(); group.name = 'movingTruck-' + (up ? 'up' : 'down');
  const own = [], g = new Geo();
  const cab = up ? 0xffc93c : 0x7d8590, boxC = up ? 0xfff3d6 : 0xb9b4a6, accent = up ? 0x1b998b : 0x8a4a3a;
  g.box(0, 0.4, 0, 2.0, 0.3, 7.0, C.iron, { bottom: true });
  // cab
  g.cloft(0, 0, 2.8, [[0.6, 2.2, 1.7, 0.2], [1.6, 2.2, 1.7, 0.2], [2.35, 2.05, 1.15, 0.18, 0, -0.26]], cab, {});
  glassQuad(g, [-0.8, 1.66, 3.66], [0.8, 1.66, 3.66], [0.74, 2.3, 3.12], [-0.74, 2.3, 3.12]);
  for (const sx of [-1, 1]) {
    const x = sx * 1.112, a = [x, 1.66, 3.3], b = [x, 1.66, 2.3], c = [sx * 1.04, 2.26, 2.3], d = [sx * 1.04, 2.26, 2.95];
    if (sx > 0) glassQuad(g, a, b, c, d); else glassQuad(g, b, a, d, c);
    g.quad([sx * 0.78 - 0.15, 0.86, 3.655], [sx * 0.78 + 0.15, 0.86, 3.655], [sx * 0.78 + 0.15, 1.08, 3.655], [sx * 0.78 - 0.15, 1.08, 3.655], 0xfff3c4);
  }
  g.box(0, 0.5, 3.68, 2.25, 0.22, 0.14, C.metal);
  g.quad([-0.5, 0.84, 3.655], [0.5, 0.84, 3.655], [0.5, 1.1, 3.655], [-0.5, 1.1, 3.655], C.iron);
  // cargo box: open at the back, dark inside
  const z0 = -3.5, z1 = 1.85, y0 = 0.85, y1 = 3.45, hw = 1.2;
  g.box(0, y0, (z0 + z1) / 2, hw * 2, y1 - y0, z1 - z0, boxC, { back: 0x24262c, top: shade(boxC, 0.94) });
  g.box(0, y0, (z0 + z1) / 2, hw * 2 + 0.03, 0.42, z1 - z0 + 0.03, accent, { noTop: true, back: 0x24262c });
  g.box(0, y1 - 0.14, z0 - 0.02, hw * 2, 0.14, 0.1, C.metalDk);
  for (const sx of [-1, 1]) g.box(sx * (hw - 0.05), y0, z0 - 0.02, 0.1, y1 - y0, 0.1, C.metalDk);
  g.box(0, y1 - 0.5, z0 + 0.08, hw * 2 - 0.2, 0.36, 0.06, shade(boxC, 0.8));
  // lettering on both sides
  for (const sx of [-1, 1]) {
    g.at(sx * (hw + 0.012), 0, (z0 + z1) / 2, (sx * Math.PI) / 2);
    if (up) { g.text("MOVIN' UP", 0, 2.2, 0, 0.1, accent); g.tri([-0.3, 1.5, 0], [0.3, 1.5, 0], [0, 1.95, 0], 0xff6a3d); } else { g.text('DOWNSIZING', 0, 2.2, 0, 0.09, accent); g.tri([-0.3, 1.95, 0], [0, 1.5, 0], [0.3, 1.95, 0], accent); }
    g.restore();
  }
  for (const [x, z] of [[1.1, 2.6], [-1.1, 2.6], [1.1, -1.6], [-1.1, -1.6], [1.1, -2.6], [-1.1, -2.6]]) wheel(g, x, 0.45, z, 0.45, 0.3, 7);
  // the ramp
  const rampTop = [0, y0, z0], rampEnd = [0, 0.06, z0 - 2.7];
  const rl = Math.hypot(y0 - 0.06, 2.7), ra = Math.atan2(y0 - 0.06, 2.7);
  g.at(0, y0, z0, 0, -ra + Math.PI, 0); g.box(0, -0.05, rl / 2, 1.1, 0.05, rl, C.metal, { bottom: C.metalDk }); for (const sx of [-1, 1]) g.box(sx * 0.55, 0, rl / 2, 0.05, 0.06, rl, C.metalDk); g.restore();
  if (up) {
    // neat stacks waiting their turn, and a houseplant
    drawCardboardBox(g, 1.5, 0, z0 - 1.6, 0.8, 0.6, 0.7, { ry: 0.2 }); drawCardboardBox(g, 1.55, 0.6, z0 - 1.6, 0.6, 0.5, 0.55, { ry: -0.15 });
    drawCardboardBox(g, 2.2, 0, z0 - 0.7, 0.7, 0.7, 0.7, { ry: 0.5 });
    g.lathe(-1.6, 0, z0 - 1.3, [[0.16, 0], [0.24, 0.36]], 0xc9683f, { seg: 6, capTop: C.dirt });
    g.ico(-1.6, 0.75, z0 - 1.3, 0.38, C.leafLt, { jitter: 0.15, rnd: rng(5) });
  } else {
    // everything they own, on the curb
    drawCouch(g, 2.6, z0 + 2.2, -Math.PI / 2 + 0.15);
    drawCardboardBox(g, 2.5, 0, z0 + 0.3, 0.75, 0.55, 0.65, { ry: 0.4, flaps: true });
    g.cyl(2.2, 0, z0 - 0.7, 0.14, 0.04, C.metalDk, { seg: 6 }); g.cyl(2.2, 0.04, z0 - 0.7, 0.025, 1.3, C.metalDk, { seg: 4, rz: 0.1 });
    g.lathe(2.07, 1.28, z0 - 0.7, [[0.26, 0], [0.14, 0.3]], 0xd9c7a3, { seg: 6, rz: 0.35 });
    g.at(2.3, 0, z0 + 3.6, -Math.PI / 2 + 0.3, -0.25, 0); g.box(0, 0, 0, 0.7, 0.5, 0.03, C.cardboard, { bottom: true }); g.text('FREE', 0, 0.14, 0.02, 0.045, 0x2a2622); g.restore();
  }
  g.shadeY(0.2, 1.4, 0.86);
  addMesh(group, g, flatMat, own, 'body');
  // the box that is forever being carried up (or down) the ramp
  const bg = new Geo();
  drawCardboardBox(bg, 0, 0, 0, 0.7, 0.6, 0.62, { bottom: true });
  const carried = addMesh(group, bg, flatMat, own, 'carriedBox');
  group.add(makeBlob(1.5, 4.0));
  const prop = makeProp(group, own, (dt, t) => {
    const m = motion(), k = (t * 0.3) % 1, u = up ? k : 1 - k;       // 0 = ground, 1 = inside the truck
    const along = Math.min(1, u / 0.72), inside = Math.max(0, (u - 0.72) / 0.28);
    carried.position.set(Math.sin(t * 6) * 0.02 * m, rampEnd[1] + (rampTop[1] - rampEnd[1]) * along + 0.03 + Math.abs(Math.sin(t * 7)) * 0.03 * m, rampEnd[2] + (rampTop[2] - rampEnd[2]) * along + inside * 1.6);
    carried.rotation.x = along < 1 ? -ra : 0;
    carried.rotation.z = Math.sin(t * 7) * 0.05 * m;
    const edge = Math.min(1, u / 0.06) * (1 - inside);
    carried.scale.setScalar(Math.max(0.001, Math.min(1, edge * 1.4)));
  }, { direction: up ? 'up' : 'down' });
  prop.update(0, 0);
  return prop;
}

// ---- garbage truck --------------------------------------------------------------------------------------
let wheelGeo = null, bagGeo = null;
function getWheelGeo() {
  if (wheelGeo) return wheelGeo;
  const g = new Geo(), r = 0.52, w = 0.34, n = 8;
  g.at(-w / 2, 0, 0, 0, 0, -Math.PI / 2);
  g.band(r, 0, r, w, n, 0, C.tire);
  g.band(r, w, r * 0.58, w, n, 0, shade(C.tire, 1.3)); g.band(r * 0.58, 0, r, 0, n, 0, shade(C.tire, 1.3));
  g.fan(r * 0.58, w, n, 0, C.metalLt); g.fan(r * 0.58, 0, n, 0, C.metalLt, true);
  // lug nuts so the spin reads
  for (let i = 0; i < 4; i++) {
    const a = (i * TAU) / 4 + 0.4, x = Math.cos(a) * 0.17, z = Math.sin(a) * 0.17, k = 0.045;
    g.quad([x - k, w + 0.004, z + k], [x + k, w + 0.004, z + k], [x + k, w + 0.004, z - k], [x - k, w + 0.004, z - k], C.metalDk);
    g.quad([x - k, -0.004, z - k], [x + k, -0.004, z - k], [x + k, -0.004, z + k], [x - k, -0.004, z + k], C.metalDk);
  }
  g.restore();
  wheelGeo = g.build(); wheelGeo.userData.shared = true;
  return wheelGeo;
}
function getBagGeo() {
  if (bagGeo) return bagGeo;
  const g = new Geo();
  drawBag(g, 0, 0, 0, 1, C.bag, rng(3), 0xd7263d, 4);
  bagGeo = g.build(); bagGeo.userData.shared = true;
  return bagGeo;
}

export function createGarbageTruck() {
  const group = new THREE.Group(); group.name = 'garbageTruck';
  const own = [], g = new Geo(), cab = 0xf1ead8, body = 0x3a9a78, bodyDk = shade(body, 0.78);
  // chassis and cab
  g.box(0, 0.5, -0.3, 1.9, 0.36, 6.6, C.iron, { bottom: true });
  g.cloft(0, 0, 2.55, [[0.7, 2.3, 1.8, 0.22], [1.8, 2.3, 1.8, 0.22], [2.6, 2.16, 1.4, 0.2, 0, -0.16]], cab, {});
  g.cloft(0, 0, 2.55, [[0.7, 2.32, 1.82, 0.22], [1.0, 2.32, 1.82, 0.22]], body, { capTop: false });
  glassQuad(g, [-0.85, 1.86, 3.46], [0.85, 1.86, 3.46], [0.8, 2.5, 3.1], [-0.8, 2.5, 3.1]);
  for (const sx of [-1, 1]) {
    const x = sx * 1.162, a = [x, 1.86, 3.1], b = [x, 1.86, 2.0], c = [sx * 1.1, 2.46, 2.0], d = [sx * 1.1, 2.46, 2.9];
    if (sx > 0) glassQuad(g, a, b, c, d); else glassQuad(g, b, a, d, c);
    g.box(sx * 1.3, 1.75, 3.2, 0.1, 0.34, 0.08, C.iron);
    g.quad([sx * 0.82 - 0.16, 1.1, 3.455], [sx * 0.82 + 0.16, 1.1, 3.455], [sx * 0.82 + 0.16, 1.34, 3.455], [sx * 0.82 - 0.16, 1.34, 3.455], 0xfff3c4);
  }
  g.quad([-0.55, 1.06, 3.455], [0.55, 1.06, 3.455], [0.55, 1.4, 3.455], [-0.55, 1.4, 3.455], C.iron);
  g.box(0, 0.56, 3.5, 2.36, 0.26, 0.16, C.metal);
  g.cyl(-0.95, 1.0, 1.5, 0.07, 2.2, C.metalDk, { seg: 5, top: C.black });
  g.box(0, 2.6, 2.4, 0.5, 0.06, 0.3, C.metalDk); g.cyl(0, 2.66, 2.4, 0.13, 0.16, 0xb86a10, { seg: 6 });
  g.shadeY(0.3, 1.3, 0.86);
  addMesh(group, g, flatMat, own, 'cab');

  // the bed, hinged at the back
  const pivot = new THREE.Group(); pivot.position.set(0, 0.88, -3.55); group.add(pivot);
  const b = new Geo();
  b.translate(0, 0, 0.35);
  b.cloft(0, 0, 2.4, [[0, 2.36, 4.6, 0.2], [0.3, 2.44, 4.6, 0.22], [1.9, 2.44, 4.6, 0.22], [2.15, 2.1, 4.3, 0.3]], body, { capBot: bodyDk, capTop: shade(body, 1.1) });
  for (const sx of [-1, 1]) for (const z of [0.7, 4.1]) b.box(sx * 1.23, 0.1, z, 0.08, 1.9, 0.14, bodyDk);
  // tailgate hopper with hazard stripes
  b.cloft(0, 0, -0.35, [[0.05, 2.3, 1.1, 0.2], [1.2, 2.4, 1.3, 0.2], [2.0, 2.2, 0.7, 0.2, 0, 0.3]], bodyDk, {});
  for (let i = 0; i < 6; i++) { const x0 = -1.05 + i * 0.35; b.quad([x0 + 0.35, 0.3, -0.905], [x0, 0.3, -0.905], [x0 + 0.12, 0.62, -0.955], [x0 + 0.47 > 1.05 ? 1.05 : x0 + 0.47, 0.62, -0.955], i % 2 ? C.black : C.caution); }
  for (const sx of [-1, 1]) b.quad([sx * 0.9 + 0.13, 0.75, -0.985], [sx * 0.9 - 0.13, 0.75, -0.985], [sx * 0.9 - 0.13, 0.95, -1.0], [sx * 0.9 + 0.13, 0.95, -1.0], C.red);
  b.shadeY(0, 1.2, 0.88);
  addMesh(pivot, b, flatMat, own, 'bed');
  // one mesh, both sides, for the world's lettering
  const pg = new Geo({ uv: true }), pz0 = 1.35, pz1 = 4.15, py0 = 0.55, py1 = 1.75, px = 1.235;
  pg.quadUV([px, py0, pz1], [px, py0, pz0], [px, py1, pz0], [px, py1, pz1], 0xffffff, 0, 0, 1, 1);
  pg.quadUV([-px, py0, pz0], [-px, py0, pz1], [-px, py1, pz1], [-px, py1, pz0], 0xffffff, 0, 0, 1, 1);
  const pgeo = pg.build(); pgeo.deleteAttribute('color'); pgeo.computeVertexNormals(); own.push(pgeo);
  const blank = blankTexture(0xf3eedd); own.push(blank);
  const panelMat = new THREE.MeshLambertMaterial({ map: blank }); own.push(panelMat);
  const sidePanel = new THREE.Mesh(pgeo, panelMat); sidePanel.name = 'sidePanel'; pivot.add(sidePanel);

  // wheels: one instanced mesh, spun by writing matrices
  const WH = [[1.02, 2.5], [-1.02, 2.5], [1.02, -1.5], [-1.02, -1.5], [1.02, -2.65], [-1.02, -2.65]];
  const wheels = new THREE.InstancedMesh(getWheelGeo(), flatMat, WH.length);
  wheels.name = 'wheels'; wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wheels.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 4.5);
  group.add(wheels);
  // beacon
  const bc = new Geo({ alpha: true });
  bc.a = 1; bc.ico(0, 2.76, 2.4, 0.15, 0xffb020); halo(bc, 0, 2.76, 2.4, 0.6, 0xffa010, 0.3, 0);
  const beaconMat = makeAddMaterial(0xffffff, 1); own.push(beaconMat);
  addMesh(group, bc, beaconMat, own, 'beacon');
  // bags that tumble out when the bed tips
  const NB = 5, bags = new THREE.InstancedMesh(getBagGeo(), flatMat, NB);
  bags.name = 'bags'; bags.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bags.frustumCulled = false; bags.visible = false;
  group.add(bags);
  const prog = new Float32Array(NB);
  group.add(makeBlob(1.7, 4.2));

  let tilt = 0, speed = 0, spin = 0;
  const wa = wheels.instanceMatrix.array, ba = bags.instanceMatrix.array;
  const placeBag = (i, x, y, z, s, rot) => {
    const o = i * 16, c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
    ba[o] = s; ba[o + 1] = 0; ba[o + 2] = 0; ba[o + 3] = 0;
    ba[o + 4] = 0; ba[o + 5] = c; ba[o + 6] = sn; ba[o + 7] = 0;
    ba[o + 8] = 0; ba[o + 9] = -sn; ba[o + 10] = c; ba[o + 11] = 0;
    ba[o + 12] = x; ba[o + 13] = y; ba[o + 14] = z; ba[o + 15] = 1;
  };
  const prop = makeProp(group, own, (dt, t) => {
    spin += (speed / 0.52) * dt;
    if (spin > 1e4) spin -= 1e4;
    const c = Math.cos(spin), s = Math.sin(spin);
    for (let i = 0; i < WH.length; i++) {
      const o = i * 16;
      wa[o] = 1; wa[o + 1] = 0; wa[o + 2] = 0; wa[o + 3] = 0;
      wa[o + 4] = 0; wa[o + 5] = c; wa[o + 6] = s; wa[o + 7] = 0;
      wa[o + 8] = 0; wa[o + 9] = -s; wa[o + 10] = c; wa[o + 11] = 0;
      wa[o + 12] = WH[i][0]; wa[o + 13] = 0.52; wa[o + 14] = WH[i][1]; wa[o + 15] = 1;
    }
    wheels.instanceMatrix.needsUpdate = true;
    pivot.rotation.x = -tilt * 0.7;
    // amber beacon: two quick flashes, then a rest
    const k = (t * 1.4) % 1, on = (k < 0.12 || (k > 0.22 && k < 0.34)) ? 1 : 0.12;
    beaconMat.opacity = isReducedMotion() ? 0.6 : on;
    // bags
    bags.visible = tilt > 0.2 || prog[0] > 0;
    if (tilt < 0.06) prog.fill(0);
    if (bags.visible) {
      for (let i = 0; i < NB; i++) {
        if (tilt > 0.3 + i * 0.1) prog[i] = Math.min(1, prog[i] + dt * 1.3);
        const p = prog[i], sx = ((i * 0.53) % 1 - 0.5) * 1.5, fall = Math.min(1, p / 0.7), roll = Math.max(0, (p - 0.7) / 0.3);
        const z = -3.9 - fall * (0.7 + i * 0.22) - roll * 0.5, y = Math.max(0, 1.3 * (1 - fall * fall)) + (fall < 1 ? 0 : Math.sin(roll * Math.PI) * 0.18);
        placeBag(i, sx, y, z, p > 0 ? 0.85 + (i % 3) * 0.12 : 0.0001, -fall * 2.2 - roll * 1.2 + i);
      }
      bags.instanceMatrix.needsUpdate = true;
    }
  }, {
    sidePanel,
    sidePanels: [sidePanel],
    bed: pivot,
    setBedTilt(v) { tilt = Math.max(0, Math.min(1, v || 0)); },
    setSpeed(v) { speed = v || 0; },
    anchors: { rear: V3(0, 0, -4.4), driver: V3(1.6, 0, 2.6) },
  });
  prop.update(0, 0);
  return prop;
}
