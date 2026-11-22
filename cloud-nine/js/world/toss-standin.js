// A stand-in cheerleader for when js/art/character.js is missing (or fails to load). It has the
// Contract 3 shape, so the basket toss treats it exactly like a real character, and it knows every
// pose the toss uses: bases dipping and throwing, the flyer's tricks and body positions, landings.
// One skinned mesh with the shared flat material (one draw call) plus a blob shadow named 'blob'.
// Feet at y = 0, faces +Z, about 1.45 m tall. Nothing is allocated per frame.
//
//   createStandin(style?, { seed }) -> { group, setAnim(name, { speed }), setSpeed(v), update(dt, t),
//                                        setLook(style), getLook(), setHighlight(on, color), anchors, dispose(), anim }
//   standinStyle(seed, team)        -> a style: team 0 is Team Pink (black top, hot-pink shorts), 1 is Team Purple
//   STANDIN_ANIMS                   the poses it knows; any other name falls back to idle

import * as THREE from '../../lib/three.module.min.js';
import { Geo, shade } from '../art/geo.js';
import { flatMat } from '../art/materials.js';
import { makeBlob } from '../art/util.js';

const HIP = 0.66; // hip joints above the feet
const THIGH = 0.29;
const SHIN = 0.37;
const ARM_X = 0.175;
const LEG_X = 0.085;
const B = { hips: 0, spine: 1, head: 2, armL: 3, foreL: 4, armR: 5, foreR: 6, legL: 7, shinL: 8, legR: 9, shinR: 10 };

const SKINS = [0xf6d4bd, 0xeab792, 0xc98c5f, 0x9a6440, 0x6b432a];
const HAIRS = [0x3b2618, 0x1d1410, 0x8a5a2b, 0xd9a957, 0xa3462b];
export const STANDIN_STYLES = [
  { skin: 0xeab792, hair: 0x3b2618, top: 0x17121c, bottom: 0xff2e93, bow: 0xff2e93, shoes: 0x17121c, socks: 0x2b2233, sparkle: [0xff7ad1, 0xa96bff, 0xeae8f2] },
  { skin: 0xeab792, hair: 0x3b2618, top: 0x7b5cff, bottom: 0x17121c, bow: 0xa96bff, shoes: 0x17121c, socks: 0x2b2233, sparkle: [0xffffff, 0xff7ad1, 0xeae8f2] },
];

export function standinStyle(seed = 0, team = 0) {
  const base = STANDIN_STYLES[team === 1 ? 1 : 0];
  const s = Math.abs(Math.floor(seed)) || 0;
  return Object.assign({}, base, { skin: SKINS[(s * 3 + 1) % SKINS.length], hair: HAIRS[(s * 7 + 2) % HAIRS.length] });
}

// ------------------------------------------------------------------------------------- geometry

function buildGeometry(S) {
  const g = new Geo({ skin: true });
  let bone = 0;
  g.skinFn = (x, y, z, si, sw) => {
    si.push(bone, 0, 0, 0);
    sw.push(1, 0, 0, 0);
  };
  const on = (b) => {
    bone = b;
  };
  for (const side of [1, -1]) {
    const x = side * LEG_X;
    on(side > 0 ? B.shinL : B.shinR);
    g.box(x, 0, 0.025, 0.1, 0.075, 0.19, S.shoes, { bottom: true });
    g.cyl(x, 0.07, 0, 0.05, 0.08, S.socks, { seg: 6 });
    g.cyl(x, 0.15, 0, 0.044, 0.22, S.skin, { seg: 6, rt: 0.05 });
    on(side > 0 ? B.legL : B.legR);
    g.cyl(x, HIP - THIGH, 0, 0.052, THIGH + 0.02, S.skin, { seg: 6, rt: 0.064 });
  }
  on(B.hips);
  g.cloft(0, 0, 0, [[0.58, 0.31, 0.21, 0.06], [0.66, 0.275, 0.185, 0.06], [0.75, 0.25, 0.17, 0.05]], S.bottom, { capBot: true, capTop: false });
  on(B.spine);
  g.cloft(0, 0, 0, [[0.74, 0.245, 0.16, 0.05], [0.8, 0.245, 0.16, 0.05, 0, 0, S.top], [0.95, 0.29, 0.18, 0.06], [1.05, 0.31, 0.17, 0.06], [1.09, 0.17, 0.12, 0.04]], S.skin, { capTop: true });
  // rhinestone starbursts on the top
  const spark = S.sparkle || [0xffffff];
  const dots = [[-0.07, 0.99], [0.05, 1.01], [0.0, 0.92], [-0.04, 0.86], [0.08, 0.89], [0.1, 0.96]];
  dots.forEach(([x, y], i) => {
    const c = spark[i % spark.length];
    const s = 0.016;
    g.quad([x - s, y, 0.093], [x, y - s, 0.093], [x + s, y, 0.093], [x, y + s, 0.093], c);
  });
  on(B.head);
  g.cyl(0, 1.05, 0, 0.038, 0.08, S.skin, { seg: 6 });
  g.sphere(0, 1.25, 0, 0.15, S.skin, { seg: 10, rings: 7 });
  g.sphere(0, 1.282, -0.012, 0.16, S.hair, { seg: 10, rings: 7 });
  for (const sx of [-1, 1]) {
    g.box(sx * 0.055, 1.19, 0.124, 0.032, 0.05, 0.03, 0x2b2233);
    g.box(sx * 0.088, 1.165, 0.105, 0.04, 0.022, 0.03, 0xffa3c4);
  }
  g.box(0, 1.15, 0.122, 0.046, 0.014, 0.03, 0xd9466f);
  // a high ponytail and the big cheer bow (with small black stars), seen best from behind
  g.tube([[0, 1.39, -0.1], [0, 1.37, -0.2], [0, 1.25, -0.245], [0, 1.1, -0.225]], 0.056, S.hair, { seg: 6, r1: 0.022 });
  const bowY = 1.4;
  for (const sx of [-1, 1]) {
    g.ico(sx * 0.088, bowY, -0.1, 0.075, S.bow, { sx: 1.35, sy: 1.0, sz: 0.55 });
    g.box(sx * 0.03, bowY - 0.2, -0.13, 0.035, 0.18, 0.02, shade(S.bow, 0.85), { rz: sx * 0.35 });
    g.box(sx * 0.075, bowY + 0.015, -0.145, 0.018, 0.018, 0.01, 0x17121c);
    g.box(sx * 0.12, bowY - 0.03, -0.14, 0.016, 0.016, 0.01, 0x17121c);
  }
  g.ico(0, bowY, -0.105, 0.038, shade(S.bow, 0.82));
  for (const side of [1, -1]) {
    const x = side * ARM_X;
    on(side > 0 ? B.armL : B.armR);
    g.cyl(x, 0.8, 0, 0.034, 0.24, S.skin, { seg: 6, rt: 0.042 });
    on(side > 0 ? B.foreL : B.foreR);
    g.cyl(x, 0.6, 0, 0.029, 0.2, S.skin, { seg: 6, rt: 0.034 });
    g.sphere(x, 0.575, 0.005, 0.042, S.skin, { seg: 6, rings: 4 });
  }
  return g.build();
}

// ------------------------------------------------------------------------------------- poses

const K = { hipY: 0, pitch: 1, yaw: 2, roll: 3, spX: 4, spZ: 5, hdX: 6, hdZ: 7, aLs: 8, aLo: 9, eL: 10, aRs: 11, aRo: 12, eR: 13, lLs: 14, lLo: 15, kL: 16, lRs: 17, lRo: 18, kR: 19, N: 20 };
// aXs: arm swing forward (up over the head near PI). aXo: arm out to the side. eX: elbow bend.
// lXs: leg swing forward (negative is back). lXo: leg out to the side. kX: knee bend.

// hip drop that keeps both feet on the ground for a thigh swing a and knee bend b
const crouch = (a, b) => THIGH * Math.cos(a) + SHIN * Math.cos(a - b) - HIP;
const arms = (p, s, o, e = 0) => {
  p[K.aLs] = s;
  p[K.aRs] = s;
  p[K.aLo] = o;
  p[K.aRo] = o;
  p[K.eL] = e;
  p[K.eR] = e;
};
const legs = (p, s, o, k = 0) => {
  p[K.lLs] = s;
  p[K.lRs] = s;
  p[K.lLo] = o;
  p[K.lRo] = o;
  p[K.kL] = k;
  p[K.kR] = k;
};
const tight = (p) => arms(p, 0.55, -0.55, 2.0); // arms crossed on the chest: the twist position

const POSES = {
  idle(p, t) {
    const br = Math.sin(t * 1.8);
    arms(p, 0.04 * Math.sin(t * 0.9), 0.13 + 0.015 * br, 0.16);
    p[K.hipY] = -0.004 - 0.004 * br;
    p[K.spX] = 0.02 + 0.01 * br;
    p[K.hdX] = 0.03 * Math.sin(t * 0.8);
    p[K.hdZ] = 0.05 * Math.sin(t * 0.37);
    legs(p, 0, 0.03);
  },
  walk(p, t, s) {
    const a = s.phase;
    const sn = Math.sin(a);
    const cs = Math.cos(a);
    p[K.lLs] = 0.55 * sn;
    p[K.lRs] = -0.55 * sn;
    p[K.kL] = 0.08 + 0.8 * Math.max(0, cs);
    p[K.kR] = 0.08 + 0.8 * Math.max(0, -cs);
    p[K.aLs] = -0.45 * sn;
    p[K.aRs] = 0.45 * sn;
    p[K.aLo] = 0.1;
    p[K.aRo] = 0.1;
    p[K.eL] = 0.3;
    p[K.eR] = 0.3;
    p[K.hipY] = -0.015 + 0.02 * Math.cos(a * 2);
    p[K.spX] = 0.05;
  },
  run(p, t, s) {
    const a = s.phase;
    const sn = Math.sin(a);
    const cs = Math.cos(a);
    p[K.lLs] = 0.25 + 0.9 * sn;
    p[K.lRs] = 0.25 - 0.9 * sn;
    p[K.kL] = 0.35 + 1.2 * Math.max(0, cs);
    p[K.kR] = 0.35 + 1.2 * Math.max(0, -cs);
    p[K.aLs] = -0.9 * sn;
    p[K.aRs] = 0.9 * sn;
    p[K.eL] = 1.4;
    p[K.eR] = 1.4;
    p[K.aLo] = 0.14;
    p[K.aRo] = 0.14;
    p[K.hipY] = -0.03 + 0.05 * Math.cos(a * 2);
    p[K.pitch] = 0.18;
  },
  // bases: hands together in front at the waist, knees bent, ready to load the flyer
  base(p, t) {
    legs(p, 0.5, 0.12, 1.0);
    p[K.hipY] = crouch(0.5, 1.0);
    p[K.spX] = 0.3;
    arms(p, 1.05, -0.14, 0.55);
    p[K.hdX] = -0.15 + 0.02 * Math.sin(t * 2);
  },
  throw(p) {
    legs(p, 0, 0.1);
    p[K.hipY] = 0.05;
    arms(p, 3.0, 0.16, 0);
    p[K.spX] = -0.1;
    p[K.hdX] = -0.35;
  },
  catch(p) {
    legs(p, 0.25, 0.12, 0.5);
    p[K.hipY] = crouch(0.25, 0.5);
    arms(p, 1.75, 0.05, 0.3);
    p[K.hdX] = -0.3;
  },
  cradle(p) {
    p[K.pitch] = -1.05;
    p[K.hipY] = 0.1;
    legs(p, 1.25, 0.05, 0.1);
    p[K.spX] = 0.3;
    arms(p, 1.55, 0.95, 1.25);
    p[K.hdX] = 0.25;
  },
  highV(p) {
    arms(p, 2.75, 0.55, 0);
    legs(p, 0, 0.03);
    p[K.hdX] = -0.15;
  },
  lowV(p) {
    arms(p, 0.15, 0.62, 0);
    legs(p, 0, 0.03);
  },
  tMotion(p) {
    arms(p, 0.05, 1.57, 0);
    legs(p, 0, 0.03);
  },
  touchdown(p) {
    arms(p, 3.02, 0.08, 0);
    legs(p, 0, 0.03);
    p[K.hdX] = -0.1;
  },
  daggers(p) {
    arms(p, 0.25, 0.14, 2.45);
    legs(p, 0, 0.05);
  },
  punch(p) {
    p[K.aRs] = 3.0;
    p[K.aRo] = 0.05;
    p[K.aLs] = -0.25;
    p[K.aLo] = 0.5;
    p[K.eL] = 1.6;
    legs(p, 0, 0.05);
    p[K.hdX] = -0.12;
  },
  clasp(p) {
    arms(p, 0.95, -0.32, 1.75);
    legs(p, 0, 0.03);
  },
  jump(p) {
    legs(p, 0.6, 0.08, 0.75);
    arms(p, 2.8, 0.4, 0);
    p[K.hdX] = -0.2;
  },
  fall(p, t) {
    arms(p, 2.45, 0.85 + 0.05 * Math.sin(t * 9), 0.1);
    legs(p, 0.05, 0.04, 0.2);
  },
  land(p) {
    legs(p, 0.75, 0.15, 1.4);
    p[K.hipY] = crouch(0.75, 1.4);
    p[K.spX] = 0.35;
    arms(p, 0.9, 0.55, 0.2);
  },
  // flyer tricks: the shape only, the toss turns the whole body for twists
  toeTouch(p) {
    p[K.lLo] = 1.42;
    p[K.lRo] = 1.42;
    p[K.lLs] = 0.35;
    p[K.lRs] = 0.35;
    p[K.pitch] = -0.18;
    p[K.spX] = 0.22;
    arms(p, 0.4, 1.3, 0);
    p[K.hdX] = 0.05;
  },
  pike(p) {
    legs(p, 1.6, 0.02, 0);
    p[K.pitch] = -0.35;
    p[K.spX] = 0.85;
    arms(p, 1.75, 0.05, 0);
    p[K.hdX] = 0.2;
  },
  kickDouble(p, t, s) {
    if (s.age < 0.28) {
      p[K.lRs] = 2.3;
      p[K.lRo] = 0.1;
      arms(p, 0.1, 1.5, 0);
      p[K.hdX] = -0.1;
    } else tight(p);
  },
  twist(p) {
    tight(p);
    legs(p, 0, 0);
  },
  liberty(p) {
    p[K.lRs] = 0.55;
    p[K.lRo] = 0.75;
    p[K.kR] = 1.9;
    arms(p, 2.75, 0.55, 0);
    p[K.hdX] = -0.12;
  },
  heelStretch(p) {
    p[K.lRs] = 2.65;
    p[K.lRo] = 0.25;
    p[K.aRs] = 2.75;
    p[K.aRo] = 0.3;
    p[K.aLs] = 2.3;
    p[K.aLo] = 0.95;
    p[K.spZ] = -0.08;
  },
  scorpion(p) {
    p[K.lRs] = -0.95;
    p[K.kR] = 2.3;
    p[K.spX] = -0.35;
    arms(p, 2.95, 0.1, 0.85);
    p[K.hdX] = -0.3;
  },
  bowArrow(p) {
    p[K.lRo] = 2.5;
    p[K.lRs] = 0.35;
    p[K.aRo] = 2.45;
    p[K.aRs] = 0.3;
    p[K.aLs] = 1.5;
    p[K.aLo] = -0.5;
    p[K.eL] = 0.4;
    p[K.spZ] = 0.15;
  },
  arabesque(p) {
    p[K.lRs] = -1.2;
    p[K.pitch] = 0.35;
    p[K.spX] = -0.15;
    p[K.aLs] = 2.0;
    p[K.aLo] = 0.2;
    p[K.aRs] = -0.2;
    p[K.aRo] = 1.3;
    p[K.hdX] = -0.2;
  },
  cheer(p, t) {
    const j = Math.abs(Math.sin(t * 5.2));
    const pump = Math.sin(t * 10.4);
    p[K.hipY] = 0.12 * j - 0.02;
    legs(p, 0.2 * (1 - j), 0.1, 0.45 * (1 - j));
    p[K.aLs] = 2.8;
    p[K.aRs] = 2.8;
    p[K.aLo] = 0.4 + 0.12 * pump;
    p[K.aRo] = 0.4 - 0.12 * pump;
    p[K.hdX] = -0.25;
  },
  clap(p, t) {
    const c = Math.sin(t * 11);
    arms(p, 1.1, -0.1 + 0.28 * Math.max(0, c), 0.95);
    legs(p, 0, 0.05);
    p[K.hipY] = 0.01 * Math.abs(c);
    p[K.hdX] = -0.1;
  },
  wave(p, t) {
    POSES.idle(p, t);
    const w = Math.sin(t * 8);
    p[K.aRo] = 2.5 + 0.2 * w;
    p[K.aRs] = 0.1;
    p[K.eR] = 0.45 - 0.35 * w;
    p[K.hdZ] = -0.1;
  },
  aww(p, t) {
    arms(p, 0.25, 0.32, 1.35);
    legs(p, 0, 0.04);
    p[K.hdZ] = 0.2 + 0.03 * Math.sin(t * 2);
    p[K.hipY] = 0.02;
  },
  dance(p, t) {
    const a = Math.sin(t * 6);
    p[K.roll] = 0.08 * a;
    p[K.spZ] = -0.1 * a;
    p[K.aLs] = 1.4 + 0.8 * a;
    p[K.aRs] = 1.4 - 0.8 * a;
    p[K.aLo] = 0.4;
    p[K.aRo] = 0.4;
    p[K.eL] = 0.6;
    p[K.eR] = 0.6;
    legs(p, 0.15, 0.08, 0.3 + 0.2 * Math.abs(a));
    p[K.hipY] = crouch(0.15, 0.3 + 0.2 * Math.abs(a));
  },
  sit(p) {
    legs(p, 1.5, 0.1, 1.5);
    p[K.hipY] = -0.3;
    arms(p, 0.4, 0.15, 0.9);
  },
};
export const STANDIN_ANIMS = Object.keys(POSES);

// ------------------------------------------------------------------------------------- character

export function createStandin(style = STANDIN_STYLES[0], { seed = 0 } = {}) {
  let look = Object.assign({}, STANDIN_STYLES[0], style);
  let geometry = buildGeometry(look);

  const bones = [];
  const bone = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones.push(b);
    return b;
  };
  const hips = bone(null, 0, HIP, 0);
  const spine = bone(hips, 0, 0.08, 0);
  const head = bone(spine, 0, 0.34, 0);
  const armL = bone(spine, ARM_X, 0.29, 0);
  const foreL = bone(armL, 0, -0.23, 0);
  const armR = bone(spine, -ARM_X, 0.29, 0);
  const foreR = bone(armR, 0, -0.23, 0);
  const legL = bone(hips, LEG_X, 0, 0);
  const shinL = bone(legL, 0, -THIGH, 0);
  const legR = bone(hips, -LEG_X, 0, 0);
  const shinR = bone(legR, 0, -THIGH, 0);

  const group = new THREE.Group();
  group.name = 'standin';
  const mesh = new THREE.SkinnedMesh(geometry, flatMat);
  mesh.name = 'standinBody';
  mesh.add(hips);
  group.add(mesh);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.75, 0), 1.35);
  const blob = makeBlob(0.38, 0.34);
  group.add(blob);

  const anchor = (parent, x, y, z) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const anchors = {
    handL: anchor(foreL, 0, -0.23, 0),
    handR: anchor(foreR, 0, -0.23, 0),
    head: anchor(head, 0, 0.32, 0),
    back: anchor(spine, 0, 0.2, -0.1),
  };

  let ring = null;
  const from = new Float32Array(K.N);
  const to = new Float32Array(K.N);
  const cur = new Float32Array(K.N);
  const state = { phase: (seed % 7) * 0.9, age: 0 };
  let anim = 'idle';
  let blend = 1;
  let speed = 0;
  let rate = 1;
  const seedT = (seed % 13) * 0.61;
  POSES.idle(cur, 0, state);

  function apply(p) {
    hips.position.y = HIP + p[K.hipY];
    hips.rotation.set(p[K.pitch], p[K.yaw], p[K.roll]);
    spine.rotation.set(p[K.spX], 0, p[K.spZ]);
    head.rotation.set(p[K.hdX], 0, p[K.hdZ]);
    armL.rotation.set(-p[K.aLs], 0, p[K.aLo]);
    foreL.rotation.set(-p[K.eL], 0, 0);
    armR.rotation.set(-p[K.aRs], 0, -p[K.aRo]);
    foreR.rotation.set(-p[K.eR], 0, 0);
    legL.rotation.set(-p[K.lLs], 0, p[K.lLo]);
    shinL.rotation.set(p[K.kL], 0, 0);
    legR.rotation.set(-p[K.lRs], 0, -p[K.lRo]);
    shinR.rotation.set(p[K.kR], 0, 0);
  }
  apply(cur);

  const api = {
    group,
    anchors,
    get anim() { return anim; },
    setAnim(name, opts = {}) {
      const next = POSES[name] ? name : 'idle';
      rate = opts && Number.isFinite(opts.speed) && opts.speed > 0 ? opts.speed : 1;
      if (next === anim) return;
      from.set(cur);
      blend = 0;
      anim = next;
      state.age = 0;
    },
    setSpeed(v) {
      speed = Math.max(0, +v || 0);
    },
    update(dt, t) {
      state.age += dt * rate;
      const stride = anim === 'run' ? 2.2 : 1.2;
      state.phase += dt * ((Math.max(0.35, speed) / stride) * Math.PI * 2);
      if (state.phase > 1e4) state.phase -= 1e4;
      to.fill(0);
      POSES[anim](to, t + seedT, state);
      if (blend < 1) {
        blend = Math.min(1, blend + dt / 0.16);
        const k = blend * blend * (3 - 2 * blend);
        for (let i = 0; i < K.N; i++) cur[i] = from[i] + (to[i] - from[i]) * k;
      } else cur.set(to);
      apply(cur);
      if (ring) ring.rotation.z += dt;
    },
    setLook(next) {
      look = Object.assign({}, STANDIN_STYLES[0], next || {});
      const old = geometry;
      geometry = buildGeometry(look);
      mesh.geometry = geometry;
      old.dispose();
    },
    getLook() {
      return Object.assign({}, look);
    },
    setHighlight(on, color = 0xffd36e) {
      if (on && !ring) {
        ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        group.add(ring);
      }
      if (ring) {
        ring.visible = !!on;
        ring.material.color.set(color);
      }
    },
    dispose() {
      geometry.dispose();
      skeleton.dispose();
      if (ring) {
        ring.geometry.dispose();
        ring.material.dispose();
      }
      group.remove(blob);
    },
  };
  return api;
}
