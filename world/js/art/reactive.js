// Reactive details: the things that appear outside your home because of how your season is going.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade } from './geo.js';
import { flatMat, makeGlowMaterial, makeAddMaterial } from './materials.js';
import { rng, motion, makeProp, addMesh, makeBlob, makeSparkles, beam, halo, stepRand, toTexture, makeCanvas, V3 } from './util.js';
import { C, drawBag, drawFlamingo, drawTrafficCone } from './parts.js';
import { makeFlySwarm } from './critters.js';

// ---- trash pile: one bag per net loss -------------------------------------------------------------
const BAG_SPOTS = [
  [0, 0, 0, 1.15], [0.78, 0, 0.18, 1.0], [-0.72, 0, 0.24, 1.05], [0.28, 0, 0.8, 0.9], [0.3, 0.6, 0.12, 1.0], [-0.38, 0, -0.7, 1.1],
  [0.6, 0, -0.62, 0.95], [-0.32, 0.56, 0.22, 0.95], [1.38, 0, -0.3, 0.9], [-1.3, 0, -0.34, 1.0], [0.06, 0.58, -0.42, 0.9], [0.02, 1.12, -0.04, 0.9],
];
const BAG_COLORS = [C.bag, C.bagAlt, C.bag, 0x2e3138, C.bag, C.bagWhite, C.bagAlt, C.bag, 0x2e3138, C.bag, C.bagAlt, C.bag];

export function createTrashPile(count = 0) {
  const n = Math.max(0, Math.min(12, Math.round(count || 0)));
  const group = new THREE.Group(); group.name = 'trashPile';
  const own = [];
  let flies = null;
  if (n > 0) {
    const g = new Geo(), r = rng(91);
    if (n >= 6) g.disc(0.1, 0.03, 0, 1.15, 0x4a4a36, { seg: 7, sx: 1.25 });
    for (let i = 0; i < n; i++) {
      const s = BAG_SPOTS[i];
      drawBag(g, s[0], s[1] - 0.03, s[2], s[3], BAG_COLORS[i], r, i % 4 === 1 ? C.caution : C.red, 4);
    }
    if (n >= 3) { g.box(0.95, 0, 0.75, 0.3, 0.05, 0.3, C.cardboard, { ry: 0.4 }); g.cyl(-0.9, 0.05, 0.85, 0.05, 0.16, C.metalLt, { seg: 5, rz: Math.PI / 2 }); }
    g.shadeY(0, 0.6, 0.82);
    addMesh(group, g, flatMat, own, 'bags');
    if (n >= 4) {
      flies = makeFlySwarm(n >= 9 ? 4 : n >= 6 ? 3 : 2, 0.55 + n * 0.03, 0.9 + (n >= 8 ? 0.5 : 0.2), n);
      group.add(flies.mesh);
    }
  }
  return makeProp(group, own, flies ? flies.update : null, { count: n });
}

// ---- yard goalposts ---------------------------------------------------------------------------------
const POST_YELLOW = 0xffd92e;
function drawUprights(g, bend = 0) {
  // gooseneck from the origin up to a crossbar at 1.25, uprights to 3.0
  const y = POST_YELLOW, yd = shade(y, 0.85);
  g.tube([[0, 0, 0], [0, 0.75, 0], [0, 1.1, 0.22], [0, 1.25, 0.5]], 0.07, yd, { seg: 5 });
  g.tube([[-0.95, 1.25, 0.5], [0.95, 1.25, 0.5]], 0.055, y, { seg: 5, caps: true });
  g.tube([[-0.95, 1.25, 0.5], [-0.95, 3.0, 0.5]], 0.045, y, { seg: 5, caps: true });
  g.tube([[0.95, 1.25, 0.5], [0.95 + bend * 0.5, 2.1, 0.5], [0.95 + bend * 1.6, 2.9, 0.5 + bend * 0.4]], 0.045, y, { seg: 5, caps: true });
}
export function createGoalposts(state = 'up') {
  const group = new THREE.Group(); group.name = 'goalposts-' + state;
  const own = [], g = new Geo();
  if (state === 'down') {
    // snapped off at the base, lying on the lawn
    g.tube([[0, 0, 0], [0.02, 0.42, 0]], 0.07, shade(POST_YELLOW, 0.85), { seg: 5 });
    for (let i = 0; i < 5; i++) { const a = (i * TAU) / 5; g.tri2([Math.cos(a) * 0.07, 0.4, Math.sin(a) * 0.07], [Math.cos(a + 1.2) * 0.07, 0.4, Math.sin(a + 1.2) * 0.07], [Math.cos(a + 0.6) * 0.05, 0.58 + (i % 2) * 0.1, Math.sin(a + 0.6) * 0.05], shade(POST_YELLOW, 0.7)); }
    g.at(0.25, 0.09, 0.5, 0.5, Math.PI / 2 - 0.03, 0);
    g.translate(0, -0.45, 0);
    drawUprights(g, 0.5);
    g.restore();
    g.box(-0.4, 0, 0.9, 0.5, 0.03, 0.2, 0x7a6a3a, { ry: 0.6 });
    g.disc(0, 0.025, 0, 0.45, 0x6b5a3e, { seg: 6 });
  } else if (state === 'crooked') {
    g.at(0, 0, 0, 0, 0.1, 0.24);
    drawUprights(g, 0.35);
    g.restore();
    g.disc(0, 0.025, 0, 0.4, 0x6b5a3e, { seg: 6 });
    // caution tape strung around it on little stakes
    const stakes = [[-1.5, 1.2], [1.3, 1.35], [1.6, -0.5], [-1.3, -0.6]];
    for (const [sx, sz] of stakes) g.box(sx, 0, sz, 0.05, 0.85, 0.05, C.woodLt, { rz: (sx * 0.05) });
    for (let i = 0; i < 4; i++) {
      const a = stakes[i], b = stakes[(i + 1) % 4], n = 6;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, sag = (t) => 0.74 - 0.16 * Math.sin(t * Math.PI);
        const p0 = [a[0] + (b[0] - a[0]) * t0, sag(t0), a[1] + (b[1] - a[1]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, sag(t1), a[1] + (b[1] - a[1]) * t1];
        g.quad2(p0, p1, [p1[0], p1[1] + 0.09, p1[2]], [p0[0], p0[1] + 0.09, p0[2]], k % 2 ? C.black : C.caution);
      }
    }
    drawTrafficCone(g, -0.7, 0, 1.5, 0.9, { ry: 0.5 });
  } else {
    drawUprights(g, 0);
    // a padded base and two proud little ribbons
    g.cyl(0, 0, 0, 0.16, 0.7, 0x2d4fa8, { seg: 7 });
    g.cyl(0, 0.3, 0, 0.165, 0.1, C.white, { seg: 7, top: false });
    for (const sx of [-1, 1]) g.tri2([sx * 0.95, 3.0, 0.5], [sx * 0.95, 2.86, 0.5], [sx * 0.95 + 0.32, 2.96, 0.44], C.red);
    g.disc(0, 0.02, 0, 0.5, 0x7fc46a, { seg: 8 });
  }
  addMesh(group, g, flatMat, own, 'goalposts');
  return makeProp(group, own, null, { state });
}

// ---- FOR SALE? ---------------------------------------------------------------------------------------
export function createForSaleSign() {
  const group = new THREE.Group(); group.name = 'forSaleSign';
  const own = [], g = new Geo(), n = new Geo();
  g.box(0, 0, 0, 0.1, 2.05, 0.1, C.white);
  g.box(0.48, 1.85, 0, 1.1, 0.09, 0.09, C.white);
  g.cone(0, 2.05, 0, 0.09, 0.12, C.white, { seg: 4 });
  for (const cx of [0.2, 0.92]) g.box(cx, 1.66, 0, 0.02, 0.2, 0.02, C.metalDk);
  g.box(0.56, 0.96, 0, 0.92, 0.7, 0.05, C.navy, { bottom: true });
  g.box(0.56, 0.93, 0, 0.98, 0.04, 0.07, C.white); g.box(0.56, 1.65, 0, 0.98, 0.04, 0.07, C.white);
  g.box(0.56, 0.72, 0, 0.6, 0.2, 0.04, C.white, { bottom: true });
  g.text('CALL NOW', 0.56, 0.78, 0.022, 0.016, C.navy);
  n.text('FOR', 0.56, 1.36, 0.028, 0.042, 0xff4d6d);
  n.text('SALE?', 0.56, 1.05, 0.028, 0.042, 0xffe14d);
  addMesh(group, g, flatMat, own, 'post');
  const mat = makeGlowMaterial(0xffffff); own.push(mat);
  addMesh(group, n, mat, own, 'neon');
  const seed = 3;
  return makeProp(group, own, (dt, t) => {
    // failing neon: mostly on, random dropouts, now and then a long sulk
    const m = motion();
    const drop = stepRand(t, 14, seed) < 0.14 ? 0.25 : 1, sulk = stepRand(t, 0.45, seed + 5) < 0.22 ? (stepRand(t, 22, seed + 9) < 0.5 ? 0.15 : 0.8) : 1;
    const k = 1 - (1 - drop * sulk) * m;
    mat.color.setScalar(0.12 + 0.88 * k);
  });
}

// ---- the golden toilet: lowest score of the week ----------------------------------------------------
export function createGoldenToilet() {
  const group = new THREE.Group(); group.name = 'goldenToilet';
  const own = [], g = new Geo();
  g.box(0, 0, 0, 1.3, 0.18, 1.3, C.stone, { top: shade(C.stone, 1.08) });
  g.box(0, 0.18, 0, 1.05, 0.2, 1.05, C.stoneDk, { top: C.stone });
  g.box(0, 0.2, 0.53, 0.6, 0.12, 0.02, C.gold, { bottom: true });
  g.jit = 0.05;
  const G = C.gold, H = C.goldHi, L = C.goldLo;
  g.at(0, 0.38, 0.05); g.scale(1.25);
  g.lathe(0, 0, 0.05, [[0.17, 0, L], [0.15, 0.08, G], [0.13, 0.22, G], [0.22, 0.34, H], [0.25, 0.4]], G, { seg: 8, sz: 1.25, capTop: false });
  g.band(0.25, 0.4, 0.17, 0.4, 8, Math.PI / 8, H);                 // rim (drawn unscaled, close enough)
  g.at(0, 0, 0.05); g.scale(1, 1, 1.25);
  g.band(0.27, 0.4, 0.27, 0.44, 8, Math.PI / 8, H); g.band(0.27, 0.44, 0.16, 0.44, 8, Math.PI / 8, H); g.band(0.16, 0.44, 0.16, 0.36, 8, Math.PI / 8, L);
  g.fan(0.16, 0.36, 8, Math.PI / 8, 0x7fd0f0);
  g.restore();
  g.box(0, 0.36, -0.3, 0.46, 0.4, 0.2, G, { top: H });
  g.box(0, 0.76, -0.3, 0.5, 0.05, 0.24, H);
  g.box(0.2, 0.66, -0.19, 0.1, 0.03, 0.03, H);
  // the lid, up
  g.at(0, 0.44, -0.17, 0, -0.2); g.cyl(0, 0, 0, 0.26, 0.04, G, { seg: 8, rx: Math.PI / 2, bottom: true }); g.restore();
  g.restore();
  g.jit = 0;
  addMesh(group, g, flatMat, own, 'toilet');
  const sp = makeSparkles([[0.36, 1.12, 0.2, 0.2], [-0.4, 0.86, 0.3, 0.14], [0.1, 1.52, -0.3, 0.17], [-0.3, 1.34, -0.1, 0.11]]);
  group.add(sp.mesh); own.push(sp.mesh.geometry);
  return makeProp(group, own, (dt, t) => sp.update(t));
}

// ---- searchlight for the week's top scorer ----------------------------------------------------------
export function createSpotlight() {
  const group = new THREE.Group(); group.name = 'spotlight';
  const own = [], base = new Geo(), head = new Geo(), bm = new Geo({ alpha: true }), B = 0x2d4fa8;
  base.box(0, 0, 0, 1.3, 0.14, 0.9, C.iron);
  for (const [x, z] of [[-0.55, -0.38], [0.55, -0.38], [-0.55, 0.38], [0.55, 0.38]]) base.cyl(x, 0, z, 0.13, 0.12, C.tire, { seg: 6, rz: Math.PI / 2 });
  base.cyl(0, 0.14, 0, 0.34, 0.2, C.metalDk, { seg: 8 });
  base.cyl(0, 0.34, 0, 0.12, 0.5, C.metalDk, { seg: 6 });
  addMesh(group, base, flatMat, own, 'base');
  const yaw = new THREE.Group(), tilt = new THREE.Group();
  yaw.position.y = 0.34; tilt.position.y = 0.85;
  group.add(yaw); yaw.add(tilt);
  // the drum and its bracket turn and tilt together
  head.lathe(0, -0.35, 0, [[0.3, 0], [0.44, 0.12], [0.46, 0.7], [0.5, 0.74]], B, { seg: 10, capTop: 0xfff7d6, capBot: true });
  head.cyl(0, 0.37, 0, 0.5, 0.05, C.gold, { seg: 10, top: false });
  for (const sx of [-1, 1]) { head.box(sx * 0.52, -0.42, 0, 0.07, 0.5, 0.18, C.metalLt, { bottom: true }); }
  head.box(0, -0.46, 0, 1.1, 0.07, 0.18, C.metalLt, { bottom: true });
  addMesh(tilt, head, flatMat, own, 'drum');
  bm.at(0, 0.4, 0);
  beam(bm, 0.42, 3.6, 46, 0xfff3c4, 0.4, 0, 10);
  beam(bm, 0.2, 1.4, 40, 0xffffff, 0.28, 0, 8);
  bm.restore();
  const beamMat = makeAddMaterial(0xffffff, 0.45); own.push(beamMat);
  const beamMesh = addMesh(tilt, bm, beamMat, own, 'beam');
  beamMesh.frustumCulled = false;
  const prop = makeProp(group, own, (dt, t) => {
    const m = 0.25 + 0.75 * motion();
    yaw.rotation.y = Math.sin(t * 0.31 * m) * 1.3 + t * 0.06 * m;
    tilt.rotation.x = 0.55 + 0.3 * Math.sin(t * 0.53 * m + 1);
  }, {
    // the beam is faint by day and strong at night
    setNight(a) { beamMat.opacity = 0.45 + 0.55 * Math.max(0, Math.min(1, a || 0)); },
  });
  prop.update(0, 0);
  return prop;
}

// ---- unluckiest: a black cat. luckiest: a horseshoe ---------------------------------------------------
export function createBlackCat() {
  const group = new THREE.Group(); group.name = 'blackCat';
  const own = [], g = new Geo(), tl = new Geo(), K = 0x23212b, K2 = 0x34313f;
  g.jit = 0.06;
  g.lathe(0, 0, 0, [[0.17, 0], [0.2, 0.1], [0.16, 0.3], [0.1, 0.44]], K, { seg: 7, sz: 1.15, capTop: true });
  g.sphere(0, 0.52, 0.05, 0.14, K, { seg: 7, rings: 4, sy: 0.9 });
  for (const sx of [-1, 1]) {
    g.cone(sx * 0.085, 0.6, 0.04, 0.055, 0.13, K2, { seg: 3, ph: Math.PI / 2 });
    g.box(sx * 0.07, 0, 0.17, 0.07, 0.3, 0.07, K2, { noTop: true });
    g.box(sx * 0.07, 0, 0.2, 0.08, 0.05, 0.11, K2);
  }
  g.jit = 0;
  for (const sx of [-1, 1]) { g.quad([sx * 0.055 - 0.028, 0.515, 0.181], [sx * 0.055 + 0.028, 0.515, 0.181], [sx * 0.055 + 0.028, 0.56, 0.176], [sx * 0.055 - 0.028, 0.56, 0.176], 0xd8ff3a); g.quad([sx * 0.055 - 0.007, 0.515, 0.184], [sx * 0.055 + 0.007, 0.515, 0.184], [sx * 0.055 + 0.007, 0.56, 0.179], [sx * 0.055 - 0.007, 0.56, 0.179], 0x16151a); }
  g.tri([-0.015, 0.49, 0.19], [0.015, 0.49, 0.19], [0, 0.472, 0.19], 0xff8fab);
  addMesh(group, g, flatMat, own, 'cat');
  tl.tube([[0, 0, 0], [0.16, 0.03, -0.08], [0.3, 0.1, -0.04], [0.38, 0.24, 0.02], [0.36, 0.38, 0.05]], 0.035, K2, { seg: 4, r1: 0.022, caps: true });
  const tail = addMesh(group, tl, flatMat, own, 'tail');
  tail.position.set(0.06, 0.06, -0.2);
  group.add(makeBlob(0.3, 0.34));
  return makeProp(group, own, (dt, t) => {
    const m = motion();
    tail.rotation.y = Math.sin(t * 1.6) * 0.7 * m - 0.2;
    tail.rotation.x = Math.sin(t * 2.3) * 0.12 * m;
  });
}

export function createHorseshoe() {
  const group = new THREE.Group(); group.name = 'horseshoe';
  const own = [], g = new Geo(), S = 0xcfd6dc, S2 = 0x9aa3ab;
  g.box(0, 0, 0, 0.09, 0.95, 0.07, C.wood);
  g.box(0, 0.62, 0.04, 0.78, 0.86, 0.05, C.woodLt, { bottom: true, back: C.wood });
  g.box(0, 0.6, 0.04, 0.84, 0.05, 0.07, C.wood); g.box(0, 1.47, 0.04, 0.84, 0.05, 0.07, C.wood);
  const pts = [];
  for (let i = 0; i <= 8; i++) { const a = Math.PI * (1.0 + 0.16) + (i / 8) * Math.PI * (1 - 0.32) + Math.PI * 0; pts.push([Math.cos(a) * 0.25 * (1 + 0 * i), 1.1 + Math.sin(a) * 0.3, 0.09]); }
  // open end up, so the luck stays in
  const u = pts.map((p) => [p[0], 2.2 - p[1] - 0.06 + 0.0, p[2]]).map((p) => [p[0], 2.14 - p[1] + 0.0, p[2]]);
  g.jit = 0.06;
  g.tube(u, 0.055, S, { seg: 4, ph: Math.PI / 4 });
  g.jit = 0;
  for (const p of [u[1], u[3], u[5], u[7]]) g.box(p[0], p[1] - 0.02, p[2] + 0.055, 0.035, 0.035, 0.012, S2, { bottom: true });
  g.box(u[0][0], u[0][1] - 0.02, 0.09, 0.14, 0.07, 0.1, S); g.box(u[8][0], u[8][1] - 0.02, 0.09, 0.14, 0.07, 0.1, S);
  addMesh(group, g, flatMat, own, 'horseshoe');
  const sp = makeSparkles([[0.3, 1.38, 0.16, 0.13], [-0.26, 0.92, 0.16, 0.1]], 0xffffff, 2.9);
  group.add(sp.mesh); own.push(sp.mesh.geometry);
  return makeProp(group, own, (dt, t) => sp.update(t));
}

// ---- win streak flamingos ----------------------------------------------------------------------------
const FLAMINGO_SPOTS = [[0, 0, 0.2, 0], [0.7, 0.25, -0.5, 1], [-0.65, 0.1, 0.5, 0], [1.3, -0.3, 0.3, 0], [-1.25, 0.35, -0.3, 1], [0.2, 0.9, -0.8, 0]];
export function createFlamingos(count = 2) {
  const n = Math.max(0, Math.min(6, Math.round(count || 0)));
  const group = new THREE.Group(); group.name = 'flamingos';
  const own = [], g = new Geo();
  for (let i = 0; i < n; i++) { const s = FLAMINGO_SPOTS[i]; drawFlamingo(g, s[0], 0, s[1], 0.95 + (i % 3) * 0.08, s[3], s[2]); }
  if (n) addMesh(group, g, flatMat, own, 'flamingos');
  return makeProp(group, own, null, { count: n });
}

// ---- signs that carry a canvas -----------------------------------------------------------------------
function panelMaterial(src, own, unlit) {
  if (!src) { const c = makeCanvas(8, 8); const x = c.getContext('2d'); x.fillStyle = '#f3eedd'; x.fillRect(0, 0, 8, 8); src = c; }
  const { tex, own: mine } = toTexture(src);
  if (mine) own.push(tex);
  const mat = unlit ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ map: tex });
  own.push(mat);
  const img = tex.image || {};
  return { mat, tex, aspect: img.width && img.height ? img.width / img.height : 2 };
}

// A corrugated-plastic yard sign on a wire stake. The canvas is the face (both sides).
export function createYardSign(canvasOrTexture, { width = 1.1 } = {}) {
  const group = new THREE.Group(); group.name = 'yardSign';
  const own = [], g = new Geo();
  const { mat, tex, aspect } = panelMaterial(canvasOrTexture, own);
  const w = width, h = Math.max(0.3, Math.min(1.2, w / aspect)), y0 = 0.42;
  for (const sx of [-1, 1]) g.box(sx * w * 0.3, 0, 0, 0.025, y0 + h * 0.7, 0.025, C.metalLt, { noTop: true });
  g.box(0, y0 - 0.02, 0, w + 0.04, h + 0.04, 0.025, C.white, { bottom: true });
  addMesh(group, g, flatMat, own, 'stake');
  const pg = new Geo({ uv: true });
  pg.quadUV([-w / 2, y0, 0.016], [w / 2, y0, 0.016], [w / 2, y0 + h, 0.016], [-w / 2, y0 + h, 0.016], 0xffffff, 0, 0, 1, 1);
  pg.quadUV([w / 2, y0, -0.016], [-w / 2, y0, -0.016], [-w / 2, y0 + h, -0.016], [w / 2, y0 + h, -0.016], 0xffffff, 0, 0, 1, 1);
  const geo = pg.build(); geo.deleteAttribute('color'); geo.computeVertexNormals();
  const face = new THREE.Mesh(geo, mat); face.name = 'face'; group.add(face); own.push(geo);
  group.rotation.z = 0.03;
  return makeProp(group, own, null, { face, texture: tex, size: { w, h } });
}

// A framed plaque for a wall or a plinth. Origin is the center of its back, it faces +Z.
export function createPlaque(canvasOrTexture, { width = 1.1 } = {}) {
  const group = new THREE.Group(); group.name = 'plaque';
  const own = [], g = new Geo();
  const { mat, tex, aspect } = panelMaterial(canvasOrTexture, own);
  const w = width, h = Math.max(0.2, Math.min(w * 1.4, w / aspect)), b = Math.min(0.08, w * 0.06);
  g.at(0, -h / 2 - b, 0);
  g.box(0, 0, 0.02, w + 2 * b, h + 2 * b, 0.04, C.goldLo, { bottom: true });
  g.box(0, 0, 0.05, w + 2 * b, b, 0.03, C.gold, { bottom: true }); g.box(0, h + b, 0.05, w + 2 * b, b, 0.03, C.goldHi, { bottom: true });
  g.box(-w / 2 - b / 2, b, 0.05, b, h, 0.03, C.gold); g.box(w / 2 + b / 2, b, 0.05, b, h, 0.03, C.gold);
  for (const sx of [-1, 1]) for (const sy of [0, 1]) g.box(sx * (w / 2 + b / 2), sy * (h + b) + b * 0.2, 0.07, b * 0.5, b * 0.5, 0.012, C.goldDeep, { bottom: true });
  g.restore();
  addMesh(group, g, flatMat, own, 'frame');
  const pg = new Geo({ uv: true });
  pg.quadUV([-w / 2, -h / 2, 0.045], [w / 2, -h / 2, 0.045], [w / 2, h / 2, 0.045], [-w / 2, h / 2, 0.045], 0xffffff, 0, 0, 1, 1);
  const geo = pg.build(); geo.deleteAttribute('color'); geo.computeVertexNormals();
  const face = new THREE.Mesh(geo, mat); face.name = 'face'; group.add(face); own.push(geo);
  return makeProp(group, own, null, { face, texture: tex, size: { w: w + 2 * b, h: h + 2 * b } });
}

export { V3 as _V3, halo as _halo };
