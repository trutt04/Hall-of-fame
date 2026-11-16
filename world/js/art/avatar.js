// The resident: a chunky vinyl-toy person in a team jersey.
//
// One skinned mesh (one draw call) shared by every avatar, plus an optional accessory mesh and a
// blob shadow. Colors and the jersey number come from a small per-avatar canvas texture, so all
// avatars share the same geometry. Animation is procedural: each clip writes a pose (joint angles),
// poses are blended over ~0.2 s, then written to eleven bones. Nothing is allocated per frame.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, shade } from './geo.js';
import { makeBlob, motion, makeCanvas } from './util.js';
import { C } from './parts.js';

export const AVATAR_HEIGHT = 1.7;
const HIP = 0.72, WAIST = 0.74, NECK = 1.25, SHOULDER = 1.17, ELBOW = 0.92, KNEE = 0.41, ARM_X = 0.318, LEG_X = 0.115;
const B = { hips: 0, spine: 1, head: 2, armL: 3, foreL: 4, armR: 5, foreR: 6, legL: 7, shinL: 8, legR: 9, shinR: 10 };

// Palette swatches inside the avatar texture (128 x 128). The number lives in the top-left 96 x 96.
const SW = { jersey: 0, trim: 1, skin: 2, pants: 3, shoe: 4, hair: 5, white: 6, gold: 7, bag: 8, eye: 9, goldHi: 10, bagHi: 11, goldLo: 12, pantsDk: 13 };
function swatchUV(k) {
  // right column: 8 swatches of 32 x 16; bottom row: 6 swatches of 16 x 32
  if (k < 8) return [(96 + 16) / 128, 1 - (k * 16 + 8) / 128];
  return [((k - 8) * 16 + 8) / 128, 1 - (96 + 16) / 128];
}
function swatchRect(k) { return k < 8 ? [96, k * 16, 32, 16] : [(k - 8) * 16, 96, 16, 32]; }

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

function paint(ctx, color, number) {
  const cols = {
    [SW.jersey]: color, [SW.trim]: shade(color, 0.7), [SW.skin]: C.skin, [SW.pants]: C.pants, [SW.shoe]: C.shoe, [SW.hair]: C.hair,
    [SW.white]: 0xf7f4ea, [SW.gold]: C.gold, [SW.bag]: 0x2a2d33, [SW.eye]: 0x23201f, [SW.goldHi]: C.goldHi, [SW.bagHi]: 0x3d4149,
    [SW.goldLo]: C.goldLo, [SW.pantsDk]: shade(C.pants, 0.8),
  };
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, 128, 128);
  for (const k in cols) { const r = swatchRect(+k); ctx.fillStyle = hex(cols[k]); ctx.fillRect(r[0], r[1], r[2], r[3]); }
  // the number: white (or navy on light jerseys) with a darker outline
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 165;
  const text = String(number === undefined || number === null ? '' : number).slice(0, 2);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, 96, 96); ctx.clip();
  ctx.fillStyle = hex(color); ctx.fillRect(0, 0, 96, 96);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = (text.length > 1 ? '60px' : '72px') + ' "Bungee", Impact, "Arial Narrow", sans-serif';
  ctx.lineJoin = 'round'; ctx.lineWidth = 9;
  ctx.strokeStyle = hex(light ? 0xf7f4ea : shade(color, 0.45));
  ctx.strokeText(text, 48, 52, 86);
  ctx.fillStyle = light ? '#18213f' : '#f7f4ea';
  ctx.fillText(text, 48, 52, 86);
  ctx.restore();
}

// ---- geometry (built once, shared) ----------------------------------------------------------------
let bodyGeo = null;
const accGeo = {};

function newGeo() {
  const g = new Geo({ uv: true, skin: true });
  g.part = { a: 0, b: -1, y: 0 };
  g.skinFn = (x, y, z, si, sw) => {
    const p = g.part;
    if (p.b < 0) { si.push(p.a, 0, 0, 0); sw.push(1, 0, 0, 0); return; }
    if (Math.abs(y - p.y) < 0.004) { si.push(p.a, p.b, 0, 0); sw.push(0.5, 0.5, 0, 0); } else if (y > p.y) { si.push(p.a, 0, 0, 0); sw.push(1, 0, 0, 0); } else { si.push(p.b, 0, 0, 0); sw.push(1, 0, 0, 0); }
  };
  g.pal = (k) => { const uv = swatchUV(k); g.u = uv[0]; g.v = uv[1]; return g; };
  g.bone = (a, b = -1, y = 0) => { g.part.a = a; g.part.b = b; g.part.y = y; return g; };
  return g;
}

function buildBody() {
  const g = newGeo(), W = 0xffffff;
  // pelvis (hips bone) and torso (spine bone)
  g.bone(B.hips).pal(SW.pants);
  g.cloft(0, 0, 0, [[0.6, 0.38, 0.24, 0.07], [0.68, 0.43, 0.27, 0.07], [0.77, 0.43, 0.27, 0.07]], W, { capBot: true, capTop: false });
  g.bone(B.spine).pal(SW.jersey);
  g.cloft(0, 0, 0, [[0.74, 0.44, 0.28, 0.07], [0.98, 0.5, 0.3, 0.08], [1.17, 0.52, 0.29, 0.09], [1.255, 0.3, 0.22, 0.08]], W, { capTop: true });
  g.pal(SW.trim);
  g.cloft(0, 0, 0, [[0.735, 0.455, 0.29, 0.07], [0.775, 0.455, 0.29, 0.07]], W, { capTop: false });
  g.pal(SW.white);
  g.cloft(0, 0, 0, [[1.225, 0.33, 0.25, 0.08], [1.265, 0.25, 0.2, 0.07]], W, { capTop: true });
  // the number, front and back
  const nw = 0.3, y0 = 0.84, y1 = 1.14, zf = 0.153, zb = -0.149;
  g.quadUV([-nw / 2, y0, zf], [nw / 2, y0, zf], [nw / 2, y1, zf - 0.006], [-nw / 2, y1, zf - 0.006], W, 0, 0.25, 0.75, 1);
  g.quadUV([nw / 2, y0, zb], [-nw / 2, y0, zb], [-nw / 2, y1, zb + 0.004], [nw / 2, y1, zb + 0.004], W, 0, 0.25, 0.75, 1);

  // head
  g.bone(B.head).pal(SW.skin);
  g.cloft(0, 0, 0, [[1.22, 0.2, 0.19, 0.06], [1.28, 0.36, 0.33, 0.1], [1.36, 0.45, 0.41, 0.12], [1.56, 0.46, 0.42, 0.12, 0, 0]], W, { capTop: false });
  g.pal(SW.hair);
  g.cloft(0, 0, 0, [[1.56, 0.47, 0.43, 0.12, 0, -0.005], [1.66, 0.41, 0.37, 0.13, 0, -0.01], [1.7, 0.26, 0.24, 0.1, 0, -0.01]], W, { capTop: true });
  g.cloft(0, 0, -0.12, [[1.4, 0.44, 0.2, 0.1], [1.57, 0.47, 0.2, 0.1]], W, { capTop: false });
  g.pal(SW.skin);
  for (const sx of [-1, 1]) g.box(sx * 0.235, 1.4, 0.0, 0.05, 0.1, 0.09, W, { bottom: true });
  g.pal(SW.eye);
  for (const sx of [-1, 1]) g.quad([sx * 0.095 - 0.026, 1.435, 0.212], [sx * 0.095 + 0.026, 1.435, 0.212], [sx * 0.095 + 0.026, 1.505, 0.212], [sx * 0.095 - 0.026, 1.505, 0.212], W);

  // arms: jersey sleeve, bare arm, mitten
  for (const sx of [1, -1]) {
    const up = sx > 0 ? B.armL : B.armR, lo = sx > 0 ? B.foreL : B.foreR, x = sx * ARM_X;
    g.bone(up, lo, ELBOW).pal(SW.jersey);
    g.cloft(x, 0, 0, [[1.215, 0.13, 0.16, 0.05], [1.19, 0.17, 0.19, 0.05], [1.03, 0.165, 0.18, 0.05]].reverse(), W, { capTop: true, capBot: false });
    g.pal(SW.white);
    g.cloft(x, 0, 0, [[0.995, 0.17, 0.185, 0.05], [1.035, 0.17, 0.185, 0.05]], W, { capTop: false, capBot: true });
    g.pal(SW.skin);
    g.cloft(x, 0, 0, [[0.7, 0.12, 0.13, 0.04], [ELBOW, 0.135, 0.15, 0.045], [1.0, 0.14, 0.155, 0.045]], W, { capTop: false });
    g.cloft(x, 0, 0.01, [[0.52, 0.12, 0.13, 0.05], [0.56, 0.155, 0.17, 0.05], [0.66, 0.16, 0.175, 0.05], [0.71, 0.12, 0.13, 0.04]], W, { capTop: true, capBot: true });
    g.box(x - sx * 0.02, 0.6, 0.085, 0.07, 0.07, 0.07, W, { bottom: true }); // thumb
  }
  // legs: pants and shoes
  for (const sx of [1, -1]) {
    const up = sx > 0 ? B.legL : B.legR, lo = sx > 0 ? B.shinL : B.shinR, x = sx * LEG_X;
    g.bone(up, lo, KNEE).pal(SW.pants);
    g.cloft(x, 0, 0, [[0.13, 0.17, 0.19, 0.05], [KNEE, 0.19, 0.21, 0.055], [0.7, 0.21, 0.24, 0.06]], W, { capTop: true });
    g.pal(SW.pantsDk);
    g.cloft(x, 0, 0, [[0.1, 0.185, 0.205, 0.05], [0.15, 0.185, 0.205, 0.05]], W, { capTop: false });
    g.bone(lo).pal(SW.shoe);
    g.cloft(x, 0, 0.045, [[0, 0.2, 0.33, 0.06], [0.07, 0.2, 0.33, 0.07], [0.13, 0.17, 0.24, 0.06, 0, -0.035]], W, { capTop: true, capBot: true });
    g.pal(SW.white);
    g.cloft(x, 0, 0.045, [[0.0, 0.208, 0.338, 0.06], [0.03, 0.208, 0.338, 0.06]], W, { capTop: false });
  }
  const geo = g.build();
  geo.deleteAttribute('color');
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
  geo.userData.shared = true;
  geo.userData.tris = g.tris;
  return geo;
}

function buildAccessory(kind) {
  const g = new Geo({ uv: true }), W = 0xffffff;
  g.pal = (k) => { const uv = swatchUV(k); g.u = uv[0]; g.v = uv[1]; return g; };
  if (kind === 'crown') {
    g.pal(SW.gold);
    g.at(0, 1.665, -0.01, 0, -0.06, 0.1);
    g.band(0.2, 0, 0.215, 0.09, 8, 0, W);
    g.band(0.215, 0.09, 0.2, 0, 8, 0, W);
    for (let i = 0; i < 8; i++) {
      const a0 = (i * Math.PI) / 4, a1 = ((i + 1) * Math.PI) / 4, am = (a0 + a1) / 2, r = 0.215, rt = 0.25;
      const p0 = [Math.cos(a0) * r, 0.09, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0.09, Math.sin(a1) * r], t = [Math.cos(am) * rt, 0.24, Math.sin(am) * rt];
      g.pal(i % 2 ? SW.gold : SW.goldHi);
      g.tri2(p1, p0, t, W);
    }
    g.pal(SW.trim);
    g.fan(0.2, 0.05, 8, 0, W);
    g.restore();
  } else if (kind === 'visor') {
    g.pal(SW.white);
    g.cloft(0, 0, -0.005, [[1.545, 0.5, 0.455, 0.13], [1.615, 0.49, 0.445, 0.13]], W, { capTop: false });
    g.pal(SW.jersey);
    g.quad2([-0.2, 1.56, 0.2], [0.2, 1.56, 0.2], [0.15, 1.53, 0.43], [-0.15, 1.53, 0.43], W);
    g.pal(SW.trim);
    g.quad([-0.2, 1.555, 0.2], [-0.15, 1.525, 0.43], [0.15, 1.525, 0.43], [0.2, 1.555, 0.2], W);
  } else if (kind === 'cap') {
    g.pal(SW.jersey);
    g.cloft(0, 0, -0.01, [[1.55, 0.5, 0.46, 0.13], [1.68, 0.46, 0.42, 0.14], [1.75, 0.3, 0.28, 0.11]], W, { capTop: true });
    g.pal(SW.white);
    g.quad([-0.15, 1.56, 0.224], [0.15, 1.56, 0.224], [0.12, 1.7, 0.196], [-0.12, 1.7, 0.196], W);
    g.pal(SW.trim);
    g.box(0, 1.535, 0.33, 0.36, 0.03, 0.26, W, { tx: 0.8, bottom: true, sz: 0.0 });
    g.box(0, 1.75, -0.01, 0.06, 0.03, 0.06, W);
  } else if (kind === 'bag') {
    // a trash bag poncho: head hole on top, ragged hem
    g.pal(SW.bag);
    g.cloft(0, 0, 0, [[0.58, 0.66, 0.46, 0.12], [0.8, 0.6, 0.4, 0.1], [1.12, 0.62, 0.38, 0.11], [1.25, 0.36, 0.28, 0.09]], W, { capTop: false });
    g.pal(SW.bagHi);
    g.cloft(0, 0, 0, [[0.56, 0.69, 0.49, 0.12], [0.64, 0.66, 0.46, 0.12]], W, { capTop: false });
    g.cloft(0, 0, 0, [[1.24, 0.37, 0.29, 0.09], [1.3, 0.42, 0.34, 0.1]], W, { capTop: false });
  }
  const geo = g.build();
  geo.deleteAttribute('color');
  geo.userData.shared = true;
  geo.userData.tris = g.tris;
  return geo;
}

// ---- poses -------------------------------------------------------------------------------------------
// channels
const P = {
  hipY: 0, hipZ: 1, pitch: 2, roll: 3, yaw: 4, spX: 5, spY: 6, spZ: 7, hdX: 8, hdY: 9, hdZ: 10,
  aLs: 11, aLo: 12, eL: 13, aRs: 14, aRo: 15, eR: 16, lLs: 17, kL: 18, lRs: 19, kR: 20, aLt: 21, aRt: 22, lLo: 23, lRo: 24, N: 25,
};
// aXs = arm swing (forward +), aXo = arm out to the side (+), eX = elbow bend, aXt = arm twist inward
// lXs = leg swing (forward +), kX = knee bend, lXo = leg out to the side

const CLIPS = {
  idle(p, t, s) {
    const br = Math.sin(t * 1.7);
    p[P.hipY] = -0.006 - 0.006 * br; p[P.roll] = 0.025 * Math.sin(t * 0.55); p[P.spX] = 0.015 + 0.012 * br;
    p[P.spZ] = -0.02 * Math.sin(t * 0.55); p[P.hdY] = 0.28 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1); p[P.hdX] = 0.03 * Math.sin(t * 0.8);
    p[P.aLo] = 0.1 + 0.015 * br; p[P.aRo] = 0.1 + 0.015 * br; p[P.aLs] = 0.04 * Math.sin(t * 0.9); p[P.aRs] = -0.04 * Math.sin(t * 0.9);
    p[P.eL] = 0.16; p[P.eR] = 0.16; p[P.lLo] = 0.03; p[P.lRo] = 0.03;
  },
  walk(p, t, s) {
    const a = s.phase, sn = Math.sin(a), cs = Math.cos(a);
    p[P.lLs] = 0.56 * sn; p[P.lRs] = -0.56 * sn; p[P.kL] = 0.08 + 0.85 * Math.max(0, cs); p[P.kR] = 0.08 + 0.85 * Math.max(0, -cs);
    p[P.aLs] = -0.5 * sn; p[P.aRs] = 0.5 * sn; p[P.eL] = 0.3 - 0.2 * sn; p[P.eR] = 0.3 + 0.2 * sn; p[P.aLo] = 0.08; p[P.aRo] = 0.08;
    p[P.hipY] = -0.015 + 0.022 * Math.cos(a * 2); p[P.roll] = 0.035 * sn; p[P.spY] = -0.12 * sn; p[P.spX] = 0.05; p[P.hdY] = 0.07 * sn; p[P.spZ] = -0.03 * sn;
  },
  run(p, t, s) {
    const a = s.phase, sn = Math.sin(a), cs = Math.cos(a);
    p[P.lLs] = 0.25 + 0.95 * sn; p[P.lRs] = 0.25 - 0.95 * sn; p[P.kL] = 0.35 + 1.25 * Math.max(0, cs); p[P.kR] = 0.35 + 1.25 * Math.max(0, -cs);
    p[P.aLs] = -0.95 * sn; p[P.aRs] = 0.95 * sn; p[P.eL] = 1.45; p[P.eR] = 1.45; p[P.aLo] = 0.14; p[P.aRo] = 0.14;
    p[P.hipY] = -0.03 + 0.05 * Math.cos(a * 2); p[P.pitch] = 0.2; p[P.spX] = 0.12; p[P.spY] = -0.2 * sn; p[P.hdX] = -0.2; p[P.roll] = 0.03 * sn;
  },
  sit(p, t, s) {
    const br = Math.sin(t * 1.6);
    p[P.hipY] = -0.28; p[P.lLs] = 1.47; p[P.lRs] = 1.47; p[P.kL] = 1.4; p[P.kR] = 1.4; p[P.lLo] = 0.1; p[P.lRo] = 0.1;
    p[P.spX] = 0.03 + 0.012 * br; p[P.aLs] = 0.42; p[P.aRs] = 0.42; p[P.eL] = 0.95; p[P.eR] = 0.95; p[P.aLo] = 0.14; p[P.aRo] = 0.14;
    p[P.hdY] = 0.3 * Math.sin(t * 0.4); p[P.hdX] = 0.02 * br;
  },
  wave(p, t, s) {
    CLIPS.idle(p, t, s);
    const w = Math.sin(t * 8);
    p[P.aRo] = 2.5 + 0.22 * w; p[P.aRs] = 0.1; p[P.eR] = 0.45 - 0.35 * w; p[P.hdZ] = -0.1; p[P.hdY] = 0; p[P.spZ] = 0.04; p[P.roll] = 0.02;
  },
  grill(p, t, s) {
    const br = Math.sin(t * 1.7), k = (t * 0.45) % 1, flip = k < 0.16 ? Math.sin((k / 0.16) * Math.PI) : 0;
    p[P.hipY] = -0.008; p[P.spX] = 0.12 + 0.01 * br; p[P.hdX] = 0.3 - 0.25 * flip; p[P.hdY] = -0.12;
    p[P.aRs] = 0.85 + 0.25 * flip; p[P.eR] = 1.0 + 0.75 * flip; p[P.aRo] = 0.1; p[P.aRt] = 0.3 * flip;
    p[P.aLo] = 0.55; p[P.eL] = 1.75; p[P.aLs] = -0.25; p[P.aLt] = 0.6; p[P.roll] = 0.02 * Math.sin(t * 0.6);
  },
  pace(p, t, s) {
    // worried: check the phone, then hands on the head, repeat
    const k = (t * 0.22) % 1, despair = k > 0.62 ? Math.min(1, (k - 0.62) / 0.07) * Math.min(1, (1 - k) / 0.07) : 0, ph = 1 - despair;
    const shake = Math.sin(t * 9) * 0.1 * despair, br = Math.sin(t * 2.4);
    p[P.hipY] = -0.012 - 0.008 * br; p[P.spX] = 0.14 * ph - 0.08 * despair; p[P.hdX] = 0.42 * ph - 0.3 * despair; p[P.hdY] = shake + 0.05 * Math.sin(t * 1.3) * ph;
    p[P.aLs] = 0.7 * ph + 2.0 * despair; p[P.eL] = 1.75 * ph + 2.1 * despair; p[P.aLo] = 0.05 * ph + 0.75 * despair; p[P.aLt] = 0.35 * ph;
    p[P.aRs] = 0.25 * ph + 2.0 * despair; p[P.eR] = 0.5 * ph + 2.1 * despair; p[P.aRo] = 0.12 * ph + 0.75 * despair;
    p[P.roll] = 0.03 * Math.sin(t * 1.1); p[P.lLo] = 0.03; p[P.lRo] = 0.03;
  },
  shiver(p, t, s) {
    const m = motion(), tr = Math.sin(t * 41) * m, tr2 = Math.sin(t * 33 + 1) * m;
    p[P.hipY] = -0.035 + 0.004 * tr; p[P.yaw] = 0.03 * tr; p[P.spX] = 0.2; p[P.spZ] = 0.015 * tr2; p[P.hdX] = 0.22; p[P.hdY] = 0.03 * tr2;
    p[P.aLs] = 0.72; p[P.aLo] = -0.42; p[P.eL] = 1.95 + 0.04 * tr; p[P.aLt] = 0.5;
    p[P.aRs] = 0.6; p[P.aRo] = -0.42; p[P.eR] = 1.85 + 0.04 * tr2; p[P.aRt] = 0.5;
    p[P.lLs] = 0.2; p[P.lRs] = 0.2; p[P.kL] = 0.42; p[P.kR] = 0.42; p[P.lLo] = -0.04; p[P.lRo] = -0.04;
  },
  cheer(p, t, s) {
    const m = 0.35 + 0.65 * motion(), j = Math.abs(Math.sin(t * 5.2)), pump = Math.sin(t * 10.4);
    p[P.hipY] = (0.16 * j - 0.03) * m; p[P.kL] = 0.5 * (1 - j) * m; p[P.kR] = 0.5 * (1 - j) * m; p[P.lLs] = 0.25 * (1 - j) * m; p[P.lRs] = 0.25 * (1 - j) * m;
    p[P.aLs] = 2.85; p[P.aRs] = 2.85; p[P.aLo] = 0.38 + 0.12 * pump * m; p[P.aRo] = 0.38 - 0.12 * pump * m; p[P.eL] = 0.3 + 0.25 * j; p[P.eR] = 0.3 + 0.25 * j;
    p[P.hdX] = -0.25; p[P.spX] = -0.06; p[P.lLo] = 0.1; p[P.lRo] = 0.1; p[P.roll] = 0.04 * pump * m;
  },
  lounge(p, t, s) {
    const br = Math.sin(t * 1.2);
    p[P.hipY] = -0.3; p[P.hipZ] = -0.06; p[P.pitch] = -0.62; p[P.spX] = 0.1 + 0.012 * br; p[P.hdX] = 0.3;
    p[P.lLs] = 1.25; p[P.lRs] = 1.0; p[P.kL] = 0.3; p[P.kR] = 0.75; p[P.lLo] = 0.12; p[P.lRo] = 0.12;
    p[P.aLs] = 2.75; p[P.aLo] = 0.95; p[P.eL] = 2.25; p[P.aRs] = 2.75; p[P.aRo] = 0.95; p[P.eR] = 2.25;
    p[P.hdY] = 0.12 * Math.sin(t * 0.3);
  },
};
export const AVATAR_ANIMS = Object.keys(CLIPS);

export function createAvatar({ color = 0xd7263d, number = 1, accessory = null } = {}) {
  if (!bodyGeo) bodyGeo = buildBody();
  const canvas = makeCanvas(128, 128), ctx = canvas.getContext('2d');
  paint(ctx, color, number);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.MeshLambertMaterial({ map: tex, flatShading: true });
  mat.name = 'lw-avatar';

  // bones
  const bones = [];
  const bone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); return b; };
  const hips = bone('hips', null, 0, HIP, 0);
  const spine = bone('spine', hips, 0, WAIST - HIP, 0);
  const head = bone('head', spine, 0, NECK - WAIST, 0);
  const armL = bone('armL', spine, ARM_X, SHOULDER - WAIST, 0), foreL = bone('foreL', armL, 0, ELBOW - SHOULDER, 0);
  const armR = bone('armR', spine, -ARM_X, SHOULDER - WAIST, 0), foreR = bone('foreR', armR, 0, ELBOW - SHOULDER, 0);
  const legL = bone('legL', hips, LEG_X, 0, 0), shinL = bone('shinL', legL, 0, KNEE - HIP, 0);
  const legR = bone('legR', hips, -LEG_X, 0, 0), shinR = bone('shinR', legR, 0, KNEE - HIP, 0);

  const group = new THREE.Group();
  group.name = 'avatar';
  const mesh = new THREE.SkinnedMesh(bodyGeo, mat);
  mesh.name = 'body';
  mesh.add(hips);
  group.add(mesh);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
  const blob = makeBlob(0.42, 0.36);
  group.add(blob);

  let acc = null, accKind = null;
  function setAccessory(kind) {
    if (kind === accKind) return;
    if (acc) { acc.parent.remove(acc); acc = null; }
    accKind = kind || null;
    if (!accKind || !['crown', 'visor', 'cap', 'bag'].includes(accKind)) { accKind = null; return; }
    if (!accGeo[accKind]) accGeo[accKind] = buildAccessory(accKind);
    acc = new THREE.Mesh(accGeo[accKind], mat);
    acc.name = 'accessory-' + accKind;
    if (accKind === 'bag') { spine.add(acc); acc.position.set(0, -WAIST, 0); } else { head.add(acc); acc.position.set(0, -NECK, 0); }
  }
  setAccessory(accessory);

  // animation state (all preallocated)
  const from = new Float32Array(P.N), to = new Float32Array(P.N), cur = new Float32Array(P.N);
  const state = { phase: 0 };
  let anim = 'idle', blend = 1, speed = 1.5, seedT = (number || 0) * 0.37;
  CLIPS.idle(cur, 0, state);

  function apply(p) {
    hips.position.y = HIP + p[P.hipY]; hips.position.z = p[P.hipZ];
    hips.rotation.set(p[P.pitch], p[P.yaw], p[P.roll]);
    spine.rotation.set(p[P.spX], p[P.spY], p[P.spZ]);
    head.rotation.set(p[P.hdX], p[P.hdY], p[P.hdZ]);
    armL.rotation.set(-p[P.aLs], -p[P.aLt], p[P.aLo]); foreL.rotation.x = -p[P.eL];
    armR.rotation.set(-p[P.aRs], p[P.aRt], -p[P.aRo]); foreR.rotation.x = -p[P.eR];
    legL.rotation.set(-p[P.lLs], 0, p[P.lLo]); shinL.rotation.x = p[P.kL];
    legR.rotation.set(-p[P.lRs], 0, -p[P.lRo]); shinR.rotation.x = p[P.kR];
  }
  apply(cur);

  const avatar = {
    group,
    height: AVATAR_HEIGHT,
    sitOffset: 0.35,           // sitting on a seat of height h: put the group at y = h - sitOffset
    anim: 'idle',
    setAnim(name) {
      if (!CLIPS[name] || name === anim) return;
      from.set(cur); blend = 0; anim = name; avatar.anim = name;
    },
    setAccessory,
    setNumber(n) { number = n; paint(ctx, color, number); tex.needsUpdate = true; },
    setColor(c) { color = c; paint(ctx, color, number); tex.needsUpdate = true; },
    setSpeed(v) { speed = Math.max(0, v || 0); },
    update(dt, t) {
      // cadence follows ground speed so feet do not skate
      const stride = anim === 'run' ? 2.5 : 1.35;
      state.phase += dt * ((Math.max(0.35, speed) / stride) * Math.PI * 2);
      if (state.phase > 1e4) state.phase -= 1e4;
      to.fill(0);
      CLIPS[anim](to, t + seedT, state);
      if (blend < 1) {
        blend = Math.min(1, blend + dt / 0.2);
        const k = blend * blend * (3 - 2 * blend);
        for (let i = 0; i < P.N; i++) cur[i] = from[i] + (to[i] - from[i]) * k;
      } else cur.set(to);
      apply(cur);
      // the shadow shrinks a little when the body leaves the ground
      const lift = Math.max(0, cur[P.hipY]);
      blob.scale.set(0.42 * (1 - lift * 1.5), 1, 0.36 * (1 - lift * 1.5));
    },
    dispose() {
      tex.dispose(); mat.dispose(); skeleton.dispose();
    },
  };
  return avatar;
}
