// A cute, simple stand-in cheerleader with the same interface as js/art/character.js (Contract 3).
// main.js uses this module whole when the real character module is missing or fails, so it
// exports the same names. Low poly, flat shaded, vertex colors on the shared flatMat: one mesh for
// the body (shorts, top, head, hair, bow) and one per limb, all posed procedurally.
//
//   LOOK_OPTIONS, DEFAULT_LOOK, cleanLook(raw), randomLook(rng)
//   createCharacter(look = DEFAULT_LOOK, { quality }) -> {
//     group, setAnim(name, { speed, loop }), setSpeed(mps), update(dt, t), setLook(look), getLook(),
//     setHighlight(on, color), anchors: { handL, handR, head, back }, dispose(),
//   }
// Feet at y = 0, faces +Z, about 1.45 m tall. Every Contract 3 animation name has a pose here
// (a rough one); unknown names fall back to idle.

import * as THREE from '../../lib/three.module.min.js';
import { Geo, shade } from '../art/geo.js';
import { flatMat, addMat } from '../art/materials.js';
import { makeBlob, isReducedMotion } from '../art/util.js';
import { clamp, damp } from '../core/util.js';

export const PLACEHOLDER = true;

const opt = (id, label, color, extra) => Object.assign({ id, label, color }, extra || {});
export const LOOK_OPTIONS = {
  skin: [opt('fair', 'Fair', 0xf8d9c4), opt('light', 'Light', 0xf0c4a4), opt('tan', 'Tan', 0xdca27a), opt('brown', 'Brown', 0xb07650), opt('deep', 'Deep', 0x7a4a2e)],
  hair: [opt('darkBrown', 'Dark brown', 0x3d2519), opt('black', 'Black', 0x1d1418), opt('brown', 'Brown', 0x6e4228), opt('blonde', 'Blonde', 0xe8c47c), opt('red', 'Red', 0xb8542c), opt('pink', 'Pink', 0xff8cc6), opt('lilac', 'Lilac', 0xb89cf0)],
  hairStyle: [opt('highPony', 'High ponytail'), opt('pigtails', 'Pigtails'), opt('bun', 'Bun'), opt('down', 'Down')],
  bow: [opt('hotPink', 'Hot pink', 0xff2e93), opt('purple', 'Purple', 0xa96bff), opt('black', 'Black', 0x221a28), opt('silver', 'Silver', 0xe4e2ee), opt('babyBlue', 'Baby blue', 0x9fd8ff), opt('mint', 'Mint', 0x9be7c4), opt('lemon', 'Lemon', 0xffe68a)],
  bowPattern: [opt('stars', 'Stars'), opt('dots', 'Dots'), opt('plain', 'Plain')],
  bowSize: [opt('big', 'Big', null, { scale: 1 }), opt('medium', 'Medium', null, { scale: 0.8 }), opt('huge', 'Huge', null, { scale: 1.22 })],
  top: [opt('starCrop', 'Rhinestone crop', 0x1c1620, { gems: true }), opt('pinkCrop', 'Pink crop', 0xff2e93), opt('purpleCrop', 'Purple crop', 0x7b5cff), opt('whiteCrop', 'White crop', 0xfff8fc), opt('mintTank', 'Mint tank', 0x9be7c4)],
  bottom: [opt('pinkShorts', 'Pink shorts', 0xff2e93), opt('blackShorts', 'Black shorts', 0x1c1620), opt('purpleSkirt', 'Purple skirt', 0x7b5cff, { skirt: true }), opt('pinkSkirt', 'Pink skirt', 0xff8cc6, { skirt: true })],
  shoes: [opt('black', 'Black', 0x1c1620), opt('white', 'White', 0xfaf6fb), opt('pink', 'Pink', 0xff8cc6)],
  socks: [opt('blackSparkle', 'Black sparkle', 0x1c1620, { sparkle: true }), opt('white', 'White', 0xfaf6fb), opt('pink', 'Pink', 0xffb3d9), opt('none', 'None', null)],
  sparkle: [opt('rainbow', 'Pink, purple and silver', null, { gems: [0xff7ad1, 0xa96bff, 0xeae8f2] }), opt('pink', 'Pink', null, { gems: [0xff7ad1, 0xffb3e0] }), opt('silver', 'Silver', null, { gems: [0xeae8f2, 0xffffff] }), opt('gold', 'Gold', null, { gems: [0xffd36e, 0xfff0b0] })],
};

// Her real outfit: high ponytail, dark brown hair, a big hot-pink bow with small black stars, a
// black rhinestone crop top, hot-pink shorts, black cheer shoes, black sparkly socks.
export const DEFAULT_LOOK = Object.freeze({
  skin: 'light', hair: 'darkBrown', hairStyle: 'highPony', bow: 'hotPink', bowPattern: 'stars', bowSize: 'big',
  top: 'starCrop', bottom: 'pinkShorts', shoes: 'black', socks: 'blackSparkle', sparkle: 'rainbow',
});

const SLOTS = Object.keys(LOOK_OPTIONS);

export function cleanLook(raw) {
  const out = Object.assign({}, DEFAULT_LOOK);
  if (!raw || typeof raw !== 'object') return out;
  for (const slot of SLOTS) {
    const v = raw[slot];
    if (typeof v === 'string' && LOOK_OPTIONS[slot].some((o) => o.id === v)) out[slot] = v;
  }
  return out;
}

export function randomLook(rng = Math.random) {
  const out = {};
  for (const slot of SLOTS) {
    const list = LOOK_OPTIONS[slot];
    out[slot] = list[Math.floor(rng() * list.length) % list.length].id;
  }
  return out;
}

const optionOf = (look, slot) => LOOK_OPTIONS[slot].find((o) => o.id === look[slot]) || LOOK_OPTIONS[slot][0];

// ------------------------------------------------------------------------------------ geometry

const HIP_Y = 0.66;
const SHOULDER_Y = 0.37; // above the hip pivot
const ARM_LEN = 0.43;
const LEG_LEN = 0.6;

function star5(g, cx, cy, z, r, hex, facing = 1) {
  // a tiny flat five-point star in the XY plane at depth z, facing +Z (facing = 1) or -Z (-1)
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([cx + Math.cos(a) * rr * facing, cy + Math.sin(a) * rr, z]);
  }
  const c = [cx, cy, z];
  for (let i = 0; i < 10; i++) g.tri(c, pts[i], pts[(i + 1) % 10], hex);
}

function buildBody(look) {
  const skin = optionOf(look, 'skin').color;
  const hair = optionOf(look, 'hair').color;
  const style = optionOf(look, 'hairStyle').id;
  const bowO = optionOf(look, 'bow');
  const pattern = optionOf(look, 'bowPattern').id;
  const bowScale = optionOf(look, 'bowSize').scale || 1;
  const topO = optionOf(look, 'top');
  const bottomO = optionOf(look, 'bottom');
  const gems = optionOf(look, 'sparkle').gems;
  const g = new Geo();
  g.jit = 0.03;

  // shorts or skirt (local origin is the hip pivot)
  if (bottomO.skirt) g.cyl(0, -0.16, 0, 0.25, 0.24, bottomO.color, { seg: 10, rt: 0.15, bottom: true });
  else g.cloft(0, -0.1, 0, [[0, 0.3, 0.2, 0.06], [0.18, 0.28, 0.19, 0.06]], bottomO.color, { capBot: true });
  // midriff, crop top, neck
  g.cloft(0, 0.08, 0, [[0, 0.25, 0.17, 0.06], [0.08, 0.26, 0.17, 0.06]], skin);
  g.cloft(0, 0.15, 0, [[0, 0.28, 0.19, 0.06], [0.16, 0.32, 0.2, 0.07], [0.27, 0.3, 0.18, 0.08]], topO.color);
  g.cyl(0, 0.41, 0, 0.05, 0.08, skin, { seg: 6 });
  if (topO.gems) {
    // rhinestone starbursts on the front and back of the crop top
    const spots = [[-0.08, 0.3], [0.07, 0.33], [0.0, 0.22], [-0.1, 0.19], [0.1, 0.2], [0.03, 0.36], [-0.03, 0.27]];
    spots.forEach(([x, y], i) => {
      star5(g, x, y, 0.102, 0.022, gems[i % gems.length], 1);
      star5(g, -x, y, -0.102, 0.02, gems[(i + 1) % gems.length], -1);
    });
  }

  // head: a slightly big, friendly head
  const HY = 0.6;
  g.sphere(0, HY, 0.005, 0.165, skin, { seg: 12, rings: 8 });
  // hair cap, offset back so the face shows
  g.sphere(0, HY + 0.035, -0.035, 0.172, hair, { seg: 12, rings: 8 });
  // bangs: a soft fringe across the forehead
  g.at(0, HY + 0.1, 0.11, 0, -0.5, 0);
  g.cloft(0, 0, 0, [[0, 0.28, 0.06, 0.03], [0.05, 0.24, 0.05, 0.025]], hair, { capBot: true });
  g.restore();
  // face: eyes, blush, smile (just in front of the faceted sphere)
  const fz = 0.162;
  for (const sx of [-1, 1]) {
    g.box(sx * 0.058, HY - 0.012, fz, 0.034, 0.05, 0.012, 0x221a28);
    g.box(sx * 0.064, HY + 0.018, fz + 0.007, 0.012, 0.012, 0.004, 0xffffff);
    g.box(sx * 0.098, HY - 0.06, fz - 0.025, 0.04, 0.018, 0.01, 0xff9ec4, { ry: sx * 0.5 });
  }
  g.box(0, HY - 0.085, fz - 0.004, 0.05, 0.012, 0.01, 0xc23a6a);

  // hair style
  const crown = [0, HY + 0.15, -0.07];
  if (style === 'highPony') {
    g.sphere(crown[0], crown[1] + 0.02, crown[2] - 0.03, 0.06, hair, { seg: 7, rings: 5 });
    const tail = [[0, HY + 0.17, -0.12], [0, HY + 0.11, -0.2], [0, HY + 0.0, -0.24], [0, HY - 0.12, -0.24], [0, HY - 0.22, -0.2]];
    g.tube(tail, 0.06, hair, { seg: 6, r1: 0.02, caps: true });
  } else if (style === 'pigtails') {
    for (const sx of [-1, 1]) g.tube([[sx * 0.15, HY + 0.08, -0.04], [sx * 0.22, HY - 0.02, -0.05], [sx * 0.22, HY - 0.16, -0.04]], 0.05, hair, { seg: 6, r1: 0.02, caps: true });
  } else if (style === 'bun') {
    g.sphere(0, HY + 0.19, -0.06, 0.085, hair, { seg: 8, rings: 6 });
  } else {
    g.cloft(0, HY - 0.25, -0.07, [[0, 0.26, 0.14, 0.06], [0.3, 0.34, 0.2, 0.08]], hair, { capBot: true, capTop: false });
  }

  // the big cheer bow, on the ponytail base (or the top of the head)
  const bowAt = style === 'highPony' ? [0, HY + 0.2, -0.1] : style === 'bun' ? [0, HY + 0.24, -0.02] : [0, HY + 0.17, -0.06];
  g.at(bowAt[0], bowAt[1], bowAt[2], 0, -0.25, 0);
  g.scale(bowScale);
  const bowHex = bowO.color;
  const dark = shade(bowHex, 0.82);
  for (const sx of [-1, 1]) {
    // a loop: a puffy triangle-ish wing built from a squashed sphere
    g.sphere(sx * 0.105, 0.025, 0, 0.1, bowHex, { seg: 8, rings: 5, sx: 1.25, sy: 0.85, sz: 0.42, rz: sx * 0.32 });
    // tails hanging down
    g.at(sx * 0.04, -0.03, -0.01, 0, 0, sx * 0.35);
    g.quad2([-0.03, 0, 0], [0.03, 0, 0], [0.04, -0.16, 0.0], [-0.04, -0.16, 0.0], dark);
    g.restore();
    if (pattern === 'stars' || pattern === 'dots') {
      const pc = bowHex === 0x221a28 ? 0xff2e93 : 0x17121c;
      for (const [px, py] of [[0.09, 0.05], [0.15, -0.01], [0.12, 0.09]]) {
        if (pattern === 'stars') {
          star5(g, sx * px, py, -0.045, 0.019, pc, -1);
          star5(g, sx * px, py, 0.045, 0.019, pc, 1);
        } else {
          g.box(sx * px, py, -0.046, 0.02, 0.02, 0.004, pc);
          g.box(sx * px, py, 0.046, 0.02, 0.02, 0.004, pc);
        }
      }
    }
  }
  g.sphere(0, 0.02, 0, 0.045, dark, { seg: 7, rings: 5 });
  g.restore();
  return g.build();
}

function buildArm(look) {
  const skin = optionOf(look, 'skin').color;
  const gems = optionOf(look, 'sparkle').gems;
  const g = new Geo();
  g.cloft(0, -ARM_LEN + 0.06, 0, [[0, 0.065, 0.065, 0.02], [ARM_LEN - 0.06, 0.08, 0.08, 0.025]], skin, { capBot: true });
  g.sphere(0, -ARM_LEN + 0.03, 0.005, 0.05, skin, { seg: 7, rings: 5 });
  // a sparkly wristband
  g.cyl(0, -ARM_LEN + 0.07, 0, 0.043, 0.035, gems[0], { seg: 7 });
  return g.build();
}

function buildLeg(look) {
  const skin = optionOf(look, 'skin').color;
  const shoes = optionOf(look, 'shoes').color;
  const socks = optionOf(look, 'socks');
  const g = new Geo();
  g.cloft(0, -LEG_LEN + 0.04, 0, [[0, 0.085, 0.09, 0.025], [LEG_LEN - 0.08, 0.11, 0.12, 0.035], [LEG_LEN - 0.02, 0.12, 0.13, 0.04]], skin);
  if (socks.color !== null) {
    g.cloft(0, -LEG_LEN + 0.05, 0, [[0, 0.095, 0.1, 0.03], [0.2, 0.098, 0.102, 0.03]], socks.color, { capTop: false });
    if (socks.sparkle) {
      for (let i = 0; i < 5; i++) g.box(((i * 37) % 5 - 2) * 0.016, -LEG_LEN + 0.09 + i * 0.03, 0.052, 0.012, 0.012, 0.004, 0xeae8f2);
    }
  }
  // cheer shoe: rounded toe, thick sole
  g.cloft(0, -LEG_LEN - 0.03, 0.03, [[0, 0.12, 0.22, 0.05, 0, 0, 0xf4eef8], [0.025, 0.12, 0.22, 0.05, 0, 0, shoes], [0.09, 0.1, 0.17, 0.045, 0, -0.02]], shoes, { capBot: true });
  return g.build();
}

const ringGeos = new Map();
function ringGeo(hex) {
  let geo = ringGeos.get(hex);
  if (geo) return geo;
  const g = new Geo({ alpha: true });
  const seg = 28;
  for (let i = 0; i < seg; i++) {
    const a0 = (Math.PI * 2 * i) / seg;
    const a1 = (Math.PI * 2 * (i + 1)) / seg;
    const p = (r, a) => [Math.cos(a) * r, 0, Math.sin(a) * r];
    g.triG(p(0.42, a0), p(0.62, a1), p(0.62, a0), hex, hex, hex, 0.0, 0.85, 0.85);
    g.triG(p(0.42, a0), p(0.42, a1), p(0.62, a1), hex, hex, hex, 0.0, 0.0, 0.85);
    g.triG(p(0.62, a0), p(0.62, a1), p(0.8, a1), hex, hex, hex, 0.85, 0.85, 0.0);
    g.triG(p(0.62, a0), p(0.8, a1), p(0.8, a0), hex, hex, hex, 0.85, 0.0, 0.0);
  }
  geo = g.build();
  geo.userData.shared = true;
  ringGeos.set(hex, geo);
  return geo;
}

// ------------------------------------------------------------------------------------ poses
// Each pose sets targets; anything not set relaxes to the rest pose. Angles in radians.
// aL/aR: arm rotation x (negative swings forward/up) and z (outward: + for left, - for right).
// lL/lR: leg rotation x (negative kicks forward) and z (outward). hip: pivot height offset (m).
const REST = { hip: 0, lean: 0, twist: 0, tilt: 0, aLx: 0, aLz: 0.1, aRx: 0, aRz: -0.1, lLx: 0, lLz: 0.02, lRx: 0, lRz: -0.02 };
const POSES = {
  idle: {},
  walk: {},
  run: { lean: 0.12 },
  jump: { aLz: 2.5, aRz: -2.5, lLx: -0.35, lRx: 0.25 },
  fall: { aLz: 2.1, aRz: -2.1, aLx: -0.3, aRx: -0.3, lLx: -0.2, lRx: 0.15, flutter: 1 },
  land: { hip: -0.1, aLz: 0.7, aRz: -0.7, lean: 0.15 },
  wave: { aRz: -2.7, wave: 1 },
  cheer: { aLz: 2.6, aRz: -2.6, hop: 1 },
  clap: { aLx: -1.35, aRx: -1.35, clap: 1 },
  sit: { hip: -0.52, lLx: -1.45, lRx: -1.45, lean: -0.05, aLx: -0.4, aRx: -0.4, aLz: 0.3, aRz: -0.3 },
  dance: { dance: 1 },
  aww: { aLz: 0.55, aRz: -0.55, aLx: -0.5, aRx: -0.5, tilt: 0.16, lean: -0.08 },
  throw: { aRx: -2.6, aRz: -0.3, twist: -0.35, lean: 0.1, aLx: -0.6 },
  catch: { aLx: -1.4, aRx: -1.4, aLz: -0.15, aRz: 0.15, lean: 0.1 },
  dodge: { hip: -0.18, tilt: 0.45, lean: 0.2, aLz: 1.2, aRz: -0.6 },
  frozen: { aLz: 1.5, aRz: -1.5, lLz: 0.25, lRz: -0.25, still: 1 },
  tagged: { aLz: 2.2, aRz: -2.2, lean: -0.15, hop: 0.5 },
  seek: { aLx: -2.35, aRx: -2.35, aLz: -0.35, aRz: 0.35, lean: 0.12 },
  hide: { hip: -0.34, lean: 0.55, aLx: -1.1, aRx: -1.1, lLx: -1.0, lRx: -1.0 },
  base: { hip: -0.14, aLx: -1.0, aRx: -1.0, aLz: -0.05, aRz: 0.05, lLz: 0.22, lRz: -0.22, lean: 0.05 },
  cradle: { lean: -0.9, lLx: -1.25, lRx: -1.25, aLz: 1.1, aRz: -1.1, hip: -0.05 },
  highV: { aLz: 2.45, aRz: -2.45 },
  lowV: { aLz: 0.62, aRz: -0.62 },
  tMotion: { aLz: 1.57, aRz: -1.57 },
  touchdown: { aLz: 3.05, aRz: -3.05 },
  daggers: { aLx: -2.6, aRx: -2.6, aLz: 0.35, aRz: -0.35 },
  punch: { aRz: -3.05, aLz: 0.6, aLx: -0.3 },
  clasp: { aLx: -1.25, aRx: -1.25, aLz: -0.4, aRz: 0.4 },
  toeTouch: { aLz: 1.6, aRz: -1.6, lLz: 1.35, lRz: -1.35, lLx: -0.55, lRx: -0.55 },
  pike: { lLx: -1.45, lRx: -1.45, aLx: -1.45, aRx: -1.45, lean: 0.45 },
  kickDouble: { lRx: -1.8, aLz: 1.6, aRz: -1.6, kick: 1 },
  twist: { aLx: -1.3, aRx: -1.3, aLz: -0.4, aRz: 0.4, spin: 1 },
  liberty: { lRx: -1.3, aLz: 2.45, aRz: -2.45 },
  heelStretch: { lRz: -2.5, lRx: -0.5, aRz: -2.6, aLz: 2.4 },
  scorpion: { lRx: 2.5, aRx: 2.2, aRz: -0.6, aLz: 2.4, lean: 0.15 },
  bowArrow: { lRz: -2.6, lRx: -0.3, aRz: -2.7, aLz: 1.57, aLx: -0.3 },
  arabesque: { lRx: 1.45, lean: 0.4, aLx: -2.6, aRz: -1.4 },
};
// Played once and then back to whatever was looping, unless setAnim says { loop: true }.
const ONE_SHOT = { land: 0.32, throw: 0.55, catch: 0.6, tagged: 0.8 };
const ONE_SHOT_DEFAULT = 1.3; // for anything else asked for with { loop: false }

export function createCharacter(look = DEFAULT_LOOK, { quality = 'high' } = {}) {
  let current = cleanLook(look);
  const group = new THREE.Group();
  group.name = 'placeholderCharacter';

  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  group.add(hips);
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(0.19, SHOULDER_Y, 0);
  armR.position.set(-0.19, SHOULDER_Y, 0);
  hips.add(armL, armR);
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(0.085, HIP_Y - 0.02, 0);
  legR.position.set(-0.085, HIP_Y - 0.02, 0);
  group.add(legL, legR);

  const meshes = { body: null, armL: null, armR: null, legL: null, legR: null };
  function build() {
    for (const k of Object.keys(meshes)) {
      if (meshes[k]) {
        meshes[k].parent.remove(meshes[k]);
        meshes[k].geometry.dispose();
      }
    }
    meshes.body = new THREE.Mesh(buildBody(current), flatMat);
    const armGeo = buildArm(current);
    meshes.armL = new THREE.Mesh(armGeo, flatMat);
    meshes.armR = new THREE.Mesh(armGeo.clone(), flatMat);
    const legGeo = buildLeg(current);
    meshes.legL = new THREE.Mesh(legGeo, flatMat);
    meshes.legR = new THREE.Mesh(legGeo.clone(), flatMat);
    hips.add(meshes.body);
    armL.add(meshes.armL);
    armR.add(meshes.armR);
    legL.add(meshes.legL);
    legR.add(meshes.legR);
  }
  build();

  const blob = makeBlob(0.42, 0.36, 0.03);
  group.add(blob);
  const ring = new THREE.Mesh(ringGeo(0xffffff), addMat);
  ring.position.y = 0.05;
  ring.visible = false;
  ring.renderOrder = 2;
  group.add(ring);

  const anchors = {
    handL: new THREE.Object3D(),
    handR: new THREE.Object3D(),
    head: new THREE.Object3D(),
    back: new THREE.Object3D(),
  };
  anchors.handL.position.set(0, -ARM_LEN, 0.02);
  anchors.handR.position.set(0, -ARM_LEN, 0.02);
  anchors.head.position.set(0, 0.8, 0);
  anchors.back.position.set(0, 0.25, -0.13);
  armL.add(anchors.handL);
  armR.add(anchors.handR);
  hips.add(anchors.head, anchors.back);

  const cur = Object.assign({}, REST);
  let anim = 'idle';
  let base = 'idle'; // what a one-shot returns to
  let oneShot = 0;
  let animTime = 0;
  let animSpeed = 1;
  let speed = 0;
  let phase = 0;
  let squash = 1;
  let spin = 0;
  const calm = () => isReducedMotion();

  function setAnim(name, o = {}) {
    const next = POSES[name] ? name : 'idle';
    animSpeed = typeof o.speed === 'number' && o.speed > 0 ? o.speed : 1;
    const loop = o.loop !== undefined ? !!o.loop : !(next in ONE_SHOT);
    if (loop) {
      oneShot = 0;
      base = next;
    } else {
      if (oneShot <= 0) base = anim; // a one-shot on top of a one-shot returns to the first base
      oneShot = (ONE_SHOT[next] || ONE_SHOT_DEFAULT) / animSpeed;
    }
    if (next !== anim) {
      if (next === 'land') squash = 0.86;
      animTime = 0;
    }
    anim = next;
  }

  function update(dt, t) {
    animTime += dt * animSpeed;
    if (oneShot > 0) {
      oneShot -= dt;
      if (oneShot <= 0) {
        anim = base;
        animTime = 0;
      }
    }
    const pose = POSES[anim] || POSES.idle;
    const tgt = Object.assign({}, REST, pose);
    const k = calm() ? 0.4 : 1;
    const moving = anim === 'walk' || anim === 'run' || ((anim === 'idle') && speed > 0.4);
    if (moving) {
      const run = anim === 'run' || speed > 4.2;
      const rate = run ? 11.5 : 7.5;
      phase += dt * rate * clamp(speed / (run ? 7 : 2.6), 0.55, 1.35);
      const sw = Math.sin(phase) * (run ? 0.95 : 0.55);
      tgt.lLx = sw;
      tgt.lRx = -sw;
      tgt.aLx = -sw * 0.8;
      tgt.aRx = sw * 0.8;
      tgt.hip = Math.abs(Math.cos(phase)) * (run ? 0.07 : 0.035) - 0.01;
      tgt.lean = run ? 0.16 : 0.04;
    } else if (anim === 'idle') {
      tgt.hip = Math.sin(t * 2.1) * 0.008;
      tgt.aLz = 0.1 + Math.sin(t * 2.1) * 0.03;
      tgt.aRz = -0.1 - Math.sin(t * 2.1) * 0.03;
    }
    if (pose.hop) tgt.hip = Math.max(0, Math.sin(animTime * 7)) * 0.16 * pose.hop * k;
    if (pose.wave) tgt.aRz += Math.sin(animTime * 10) * 0.32 * k;
    if (pose.clap) {
      const c = (Math.sin(animTime * 14) * 0.5 + 0.5) * k;
      tgt.aLz = -0.05 - c * 0.38;
      tgt.aRz = 0.05 + c * 0.38;
    }
    if (pose.flutter) {
      tgt.aLz += Math.sin(t * 9) * 0.25 * k;
      tgt.aRz -= Math.sin(t * 9 + 1) * 0.25 * k;
      tgt.lLx += Math.sin(t * 6) * 0.25 * k;
      tgt.lRx -= Math.sin(t * 6) * 0.25 * k;
    }
    if (pose.dance) {
      const s = Math.sin(animTime * 6);
      tgt.twist = s * 0.35 * k;
      tgt.tilt = Math.sin(animTime * 3) * 0.12 * k;
      tgt.aLz = 1.4 + s * 1.0;
      tgt.aRz = -1.4 + s * 1.0;
      tgt.hip = Math.abs(Math.sin(animTime * 6)) * 0.05 * k;
    }
    if (pose.kick) tgt.lRx = -1.8 + Math.sin(animTime * 8) * 0.25;
    if (pose.spin && !calm()) spin += dt * 14;
    else spin = damp(spin, Math.round(spin / (Math.PI * 2)) * Math.PI * 2, 8, dt);
    const lambda = pose.still ? 30 : anim === 'land' ? 26 : 13;
    for (const key of Object.keys(REST)) cur[key] = damp(cur[key], tgt[key], lambda, dt);
    squash = damp(squash, 1, 9, dt);

    hips.position.y = HIP_Y + cur.hip;
    hips.rotation.set(cur.lean, cur.twist + spin, cur.tilt);
    armL.rotation.set(cur.aLx, 0, cur.aLz);
    armR.rotation.set(cur.aRx, 0, cur.aRz);
    legL.rotation.set(cur.lLx, 0, cur.lLz);
    legR.rotation.set(cur.lRx, 0, cur.lRz);
    // when sitting or crouching, the legs come down with the hips
    legL.position.y = HIP_Y - 0.02 + Math.min(0, cur.hip);
    legR.position.y = legL.position.y;
    group.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
    if (ring.visible) ring.rotation.y += dt * 1.2;
  }

  return {
    group,
    placeholder: true,
    setAnim,
    setSpeed(v) {
      speed = Number.isFinite(v) ? Math.max(0, v) : 0;
    },
    update,
    setLook(next) {
      current = cleanLook(next);
      build();
    },
    getLook() {
      return Object.assign({}, current);
    },
    setHighlight(on, color = 0xffffff) {
      ring.visible = !!on;
      if (on) {
        const hex = typeof color === 'string' ? new THREE.Color(color).getHex() : Number(color) >>> 0;
        ring.geometry = ringGeo(hex & 0xffffff);
      }
    },
    get anim() { return anim; },
    anchors,
    quality,
    dispose() {
      for (const k of Object.keys(meshes)) {
        if (meshes[k]) meshes[k].geometry.dispose();
        meshes[k] = null;
      }
      group.removeFromParent();
    },
  };
}
