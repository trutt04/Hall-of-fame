// The pets, in the house style: flat-shaded vertex colours on the shared flatMat, every part merged
// into ONE skinned geometry (one draw call per pet), plus a soft blob shadow. They face +Z.
//
// The cloud puppy: the pet the 12th spirit stick (Rainbow's End) unlocks. A chunky low-poly puppy
// made of cloud puffs: floppy lilac ears, a black nose, shiny eyes, pink cheeks, a tiny puff tail
// and a hot-pink bow collar with little black stars, matching her bow. About 0.65 m tall; it floats.
//
// The mini husky: there from the start. A grey-and-white coat with a darker mask and saddle, a white
// face and chest, bright blue eyes, upright pointy ears and a fluffy tail curled over its back. It
// stands on the ground (about 0.6 m to the ear tips), trots with its legs, sits, and howls a happy
// little "awoo" (js/world/pets.js). Its colours are all in HUSKY_COLORS below, to match a real dog.
//
//   PET_IDS                          ['none', 'cloudPuppy', 'husky'] (the look's `pet` slot)
//   createPet(kind, { shadow = true } = {})   'husky' -> createHusky, anything else -> createPuppy
//   createHusky({ shadow = true } = {})       the same shape as createPuppy, plus mood.howl (0..1:
//                                    head up for an "awoo"); mood.sit folds it into a real sit and
//                                    mood.move trots its legs. Both say kind and ground (it walks)
//   createPuppy({ shadow = true } = {}) -> {
//     group        its spot: put it on the ground (x, ground y, z). Never rotated
//     body         the floating part: the behaviour sets body.position.y (PIVOT_Y + float + hop),
//                  body.rotation (y heading, x sit or lean, z wobble) and body.scale (squash, stretch)
//     shadow       the blob (a child of group, on the ground); scale it down as the pet rises
//     mood         { sit, happy, move, excite, look, tilt, vy }: knobs the behaviour sets each frame
//                  (sit, happy, move, excite 0..1; look = head turn in radians; tilt = head tilt;
//                  vy = the body's vertical speed, for the ears)
//     update(dt, t)   ears, tail, blinks, tongue and breathing from the mood (allocates nothing)
//     triangles, dispose()
//   }
//   PIVOT_Y                          the body's pivot height above its feet
//   puppyGeometry(), huskyGeometry() the shared geometries (built once, never disposed)
//   petIcon(id) -> '<svg ...>'       the creator's tiles; petTabIcon() -> '<svg ...>' (currentColor)
import * as THREE from '../../lib/three.module.min.js';
import { Geo, lin, hash } from './geo.js';
import { flatMat } from './materials.js';
import { makeBlob, motion } from './util.js';

export const PET_IDS = Object.freeze(['none', 'cloudPuppy', 'husky']);
export const PIVOT_Y = 0.24;

// The mini husky's colours, all in one place: change these to match a real dog.
export const HUSKY_COLORS = Object.freeze({
  coat: 0x9a9fab, // the grey coat
  saddle: 0x5d6270, // the darker saddle on its back and the cap of its mask
  white: 0xf8f8fb, // face, chest, belly, socks and the tail's underside
  eye: 0x3fb4ff, // bright blue eyes
  earIn: 0xf6c9da, // inside the ears
  nose: 0x1d1a22,
  tongue: 0xff6fae,
  collar: 0x1fc8bf, // a teal collar...
  tag: 0xffcd4a, // ...with a little gold tag
});

const C = {
  white: 0xffffff, cream: 0xfff6fb, under: 0xe9dcf5, lilac: 0xcdb4ff, ear: 0xbfa2fb, earTip: 0xf2a6d8,
  pink: 0xff2e93, pinkDk: 0xc4126b, blush: 0xff9ccb, tongue: 0xff6fae, black: 0x17121c,
};

// Bones: every vertex follows exactly one.
const BONE = { root: 0, head: 1, earL: 2, earR: 3, eyes: 4, tongue: 5, tail: 6 };
const BONE_PARENT = [-1, 0, 1, 1, 1, 1, 0];
const BONE_AT = [
  [0, 0, 0], // root (the feet)
  [0, 0.4, 0.1], // head: the neck
  [0.165, 0.635, 0.08], // left ear root (its left is +X when it faces +Z)
  [-0.165, 0.635, 0.08], // right ear root
  [0, 0.548, 0.31], // eyes (blinks squash them)
  [0, 0.425, 0.33], // tongue
  [0, 0.33, -0.24], // tail
];

// A flat 5-point star facing +Z of the current transform.
function star(g, x, y, z, ro, ri, hex, ry = 0, rx = 0) {
  g.at(x, y, z, ry, rx, 0);
  for (let i = 0; i < 10; i++) {
    const a0 = Math.PI / 2 + (i * Math.PI) / 5;
    const a1 = Math.PI / 2 + ((i + 1) * Math.PI) / 5;
    const r0 = i % 2 ? ri : ro;
    const r1 = (i + 1) % 2 ? ri : ro;
    g.tri([0, 0, 0], [Math.cos(a0) * r0, Math.sin(a0) * r0, 0], [Math.cos(a1) * r1, Math.sin(a1) * r1, 0], hex);
  }
  g.restore();
}
// A little flat oval (blush, shines) facing +Z of the current transform.
function dot(g, x, y, z, rx, ry, hex, seg = 6, yaw = 0, pitch = 0) {
  g.at(x, y, z, yaw, pitch, 0);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    g.tri([0, 0, 0], [Math.cos(a0) * rx, Math.sin(a0) * ry, 0], [Math.cos(a1) * rx, Math.sin(a1) * ry, 0], hex);
  }
  g.restore();
}
// Cloud undersides catch a lilac bounce, like the island's clouds (only the vertices from `from` on).
function shadeUnder(g, from, y0, y1, hex) {
  const lc = new THREE.Color(hex);
  for (let i = from * 3; i < g.p.length / 3; i++) {
    const t = Math.min(1, Math.max(0, (g.p[i * 3 + 1] - y0) / (y1 - y0)));
    const k = (1 - t) * 0.6;
    g.c[i * 3] = g.c[i * 3] * (1 - k) + lc.r * k;
    g.c[i * 3 + 1] = g.c[i * 3 + 1] * (1 - k) + lc.g * k;
    g.c[i * 3 + 2] = g.c[i * 3 + 2] * (1 - k) + lc.b * k;
  }
}

let geo = null;
export function puppyGeometry() {
  if (geo) return geo;
  const g = new Geo({ skin: true });
  let bone = BONE.root;
  g.skinFn = (x, y, z, si, sw) => {
    si.push(bone, 0, 0, 0);
    sw.push(1, 0, 0, 0);
  };
  g.jit = 0.025;
  const rnd = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();

  // ---- the body: a round cloud with four fluffy lumps and four stubby paws
  bone = BONE.root;
  const b0 = g.tris;
  g.ico(0, 0.25, -0.03, 0.2, C.white, { detail: 1, sy: 0.86, sz: 1.15, jitter: 0.03, rnd });
  g.ico(0, 0.34, -0.13, 0.13, C.white, { jitter: 0.08, rnd });
  g.ico(0.13, 0.22, -0.11, 0.12, C.white, { jitter: 0.08, rnd });
  g.ico(-0.13, 0.22, -0.11, 0.12, C.white, { jitter: 0.08, rnd });
  g.ico(0, 0.19, 0.12, 0.12, C.cream, { jitter: 0.06, rnd });
  g.ico(0, 0.39, 0.075, 0.14, C.white, { sy: 0.75, jitter: 0.05, rnd }); // a fluffy neck for the collar
  for (const [x, z] of [[0.1, 0.12], [-0.1, 0.12], [0.11, -0.16], [-0.11, -0.16]]) g.ico(x, 0.065, z, 0.07, C.white, { sy: 0.85, jitter: 0.05, rnd });
  shadeUnder(g, b0, 0.04, 0.3, C.under);

  // ---- the collar: a hot-pink band with little black stars and a bow at the front
  g.at(0, 0.385, 0.07, 0, 0.38, 0);
  g.band(0.168, -0.026, 0.168, 0.026, 12, 0, C.pink);
  for (const a of [0.95, 1.7, -0.95, -1.7]) star(g, Math.sin(a) * 0.171, 0, Math.cos(a) * 0.171, 0.022, 0.009, C.black, a);
  g.restore();
  // the bow (two lobes, a knot and two little tails), facing out under her chin
  g.at(0, 0.36, 0.245, 0, -0.3, 0);
  for (const sx of [-1, 1]) {
    g.ico(sx * 0.055, 0.004, 0, 0.05, C.pink, { sx: 1.15, sy: 0.85, sz: 0.42, rz: sx * 0.25 });
    star(g, sx * 0.06, 0.008, 0.022, 0.02, 0.008, C.black);
  }
  g.ico(0, -0.002, 0.006, 0.024, C.pinkDk, { sz: 0.8 });
  g.tri([-0.008, -0.012, 0.012], [-0.04, -0.07, 0.012], [-0.016, -0.072, 0.012], C.pink);
  g.tri([0.008, -0.012, 0.012], [0.016, -0.072, 0.012], [0.04, -0.07, 0.012], C.pink);
  g.restore();

  // ---- the head: a big round puff with fluffy cheeks, a tuft, a muzzle and a shiny black nose
  bone = BONE.head;
  const h0 = g.tris;
  g.ico(0, 0.52, 0.16, 0.19, C.white, { detail: 1, sx: 1.08, sy: 0.95, sz: 0.95, jitter: 0.04, rnd });
  g.ico(0.12, 0.455, 0.215, 0.09, C.white, { jitter: 0.07, rnd });
  g.ico(-0.12, 0.455, 0.215, 0.09, C.white, { jitter: 0.07, rnd });
  g.ico(0.02, 0.685, 0.12, 0.075, C.white, { jitter: 0.08, rnd });
  shadeUnder(g, h0, 0.36, 0.5, C.under);
  g.ico(0, 0.462, 0.3, 0.083, C.cream, { sx: 1.18, sy: 0.8, sz: 0.88 });
  g.ico(0, 0.49, 0.372, 0.029, C.black, { sx: 1.4, sy: 0.9, sz: 0.8 });
  dot(g, 0.01, 0.5, 0.394, 0.01, 0.006, C.white, 4);
  // a happy little "w" mouth
  g.at(0, 0.452, 0.374, 0, -0.35, 0);
  for (const sx of [-1, 1]) {
    // two little strokes each side: down and out, then up
    const pts = [[0, 0.004], [sx * 0.015, -0.009], [sx * 0.03, 0.001]];
    for (let i = 0; i < 2; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const a = [ax, ay, 0], b = [bx, by, 0], c = [bx, by + 0.006, 0], d = [ax, ay + 0.006, 0];
      if (bx > ax) g.quad(a, b, c, d, C.black); // counter-clockwise seen from the front
      else g.quad(a, d, c, b, C.black);
    }
  }
  g.restore();
  // blush
  for (const sx of [-1, 1]) dot(g, sx * 0.15, 0.462, 0.296, 0.03, 0.019, C.blush, 6, sx * 0.4);

  // ---- the eyes: round and black with two shines each (a bone, so they can blink)
  bone = BONE.eyes;
  // crisp cartoon eyes: a black oval on the face, a big shine and a small one (same side on both)
  for (const sx of [-1, 1]) {
    g.at(sx * 0.08, 0.552, 0.333, sx * 0.33, -0.17, 0);
    dot(g, 0, 0, 0, 0.041, 0.05, C.black, 10);
    dot(g, 0.014, 0.019, 0.002, 0.014, 0.014, C.white, 6);
    dot(g, -0.012, -0.016, 0.002, 0.007, 0.007, C.white, 4);
    g.restore();
  }

  // ---- the tongue (a bone: it pops out when she is happy, and pants)
  bone = BONE.tongue;
  g.ico(0, 0.415, 0.352, 0.032, C.tongue, { sx: 1.05, sy: 0.5, sz: 1.25 });

  // ---- floppy ears: lilac, pinker at the tips, hanging from the top of her head
  for (const [sx, b] of [[1, BONE.earL], [-1, BONE.earR]]) {
    bone = b;
    const e0 = g.tris;
    g.sphere(sx * 0.235, 0.505, 0.08, 0.1, C.ear, { seg: 6, rings: 4, sx: 0.72, sy: 1.42, sz: 0.48, rz: sx * 0.45, ry: sx * 0.15 });
    // tips blush pink
    const tip = new THREE.Color(C.earTip);
    for (let i = e0 * 3; i < g.p.length / 3; i++) {
      const k = Math.min(1, Math.max(0, (0.47 - g.p[i * 3 + 1]) / 0.1)) * 0.75;
      g.c[i * 3] = g.c[i * 3] * (1 - k) + tip.r * k;
      g.c[i * 3 + 1] = g.c[i * 3 + 1] * (1 - k) + tip.g * k;
      g.c[i * 3 + 2] = g.c[i * 3 + 2] * (1 - k) + tip.b * k;
    }
  }

  // ---- a tiny puff tail
  bone = BONE.tail;
  g.ico(0, 0.37, -0.3, 0.075, C.white, { jitter: 0.08, rnd });

  geo = g.build();
  geo.userData.shared = true;
  return geo;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createPuppy({ shadow = true } = {}) {
  const group = new THREE.Group();
  group.name = 'cloudPuppy';
  const body = new THREE.Object3D();
  body.name = 'cloudPuppy-body';
  body.position.y = PIVOT_Y;
  group.add(body);

  const bones = BONE_AT.map((p, i) => {
    const b = new THREE.Bone();
    b.name = 'pet-' + Object.keys(BONE)[i];
    return b;
  });
  BONE_AT.forEach((p, i) => {
    const parent = BONE_PARENT[i];
    if (parent < 0) bones[i].position.set(p[0], p[1], p[2]);
    else {
      const q = BONE_AT[parent];
      bones[i].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      bones[parent].add(bones[i]);
    }
  });
  const mesh = new THREE.SkinnedMesh(puppyGeometry(), flatMat);
  mesh.name = 'cloudPuppy-mesh';
  mesh.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton); // at the origin, before it has a parent: the bind pose is the model as drawn
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.35, 0), 0.62);
  mesh.position.y = -PIVOT_Y;
  body.add(mesh);

  let blob = null;
  if (shadow) {
    blob = makeBlob(0.27, 0.3);
    blob.name = 'blob';
    group.add(blob);
  }

  const [, head, earL, earR, eyes, tongue, tail] = bones;
  const mood = { sit: 0, happy: 0, move: 0, excite: 0, look: 0, tilt: 0, vy: 0 };
  const ear = { a: 0.12, v: 0, x: 0 };
  let blinkIn = 1 + Math.random() * 2.5;
  let blinkT = 0;
  let pant = 0;
  let tongueOut = 0;
  let headX = 0;
  let headY = 0;
  let headZ = 0;
  let wagPh = Math.random() * 6;
  let disposed = false;

  function update(dt, t) {
    if (disposed) return;
    const m = motion();
    dt = Math.min(0.1, Math.max(0, dt));
    // ears: a soft spring, flung up when the body drops, swept back when she runs
    const want = 0.14 + clamp(-mood.vy * 0.22, -0.25, 1.1) + mood.excite * 0.12 * Math.sin(t * 11);
    ear.v += ((want - ear.a) * 90 - ear.v * 9) * dt;
    ear.a += ear.v * dt;
    ear.a = clamp(ear.a, -0.3, 1.4);
    ear.x += (mood.move * 0.45 - ear.x) * Math.min(1, dt * 6);
    earL.rotation.z = ear.a * m + 0.02;
    earR.rotation.z = -ear.a * m - 0.02;
    earL.rotation.x = earR.rotation.x = ear.x;
    // head: looks about, tilts when curious, bobs while panting
    pant += ((Math.max(mood.happy, mood.excite, mood.move * 0.8) > 0.3 ? 1 : 0) - pant) * Math.min(1, dt * 4);
    headY += (clamp(mood.look, -0.7, 0.7) - headY) * Math.min(1, dt * 5);
    headZ += (mood.tilt - headZ) * Math.min(1, dt * 6);
    headX += (mood.sit * -0.12 + Math.sin(t * 9) * 0.03 * pant * m - headX) * Math.min(1, dt * 8);
    head.rotation.set(headX, headY, headZ);
    // tail: wags, faster and bigger when happy
    wagPh += dt * (9 + mood.happy * 11 + mood.excite * 6);
    tail.rotation.y = Math.sin(wagPh) * (0.3 + mood.happy * 0.5 + mood.excite * 0.3 + mood.move * 0.15) * (0.3 + 0.7 * m);
    tail.rotation.x = -0.25 * mood.sit;
    // eyes: blink now and then; happy squints into little arcs
    blinkIn -= dt;
    if (blinkIn <= 0) {
      blinkT = 0.13;
      blinkIn = 1.6 + Math.random() * 3.4;
    }
    let ey = 1 - mood.happy * 0.5;
    if (blinkT > 0) {
      blinkT -= dt;
      ey = 0.12;
    }
    eyes.scale.y = ey;
    // tongue: out when happy or excited, panting
    tongueOut += ((pant > 0.5 ? 1 : 0) - tongueOut) * Math.min(1, dt * 7);
    const ts = Math.max(0.001, tongueOut);
    tongue.scale.set(ts, ts * (1 + Math.sin(t * 14) * 0.18 * pant * m), ts);
    // breathing
    bones[0].scale.y = 1 + Math.sin(t * 2.6) * 0.018 * m;
  }

  return {
    kind: 'cloudPuppy',
    ground: false,
    group,
    body,
    mesh,
    shadow: blob,
    mood,
    update,
    triangles: puppyGeometry().attributes.position.count / 3,
    dispose() {
      if (disposed) return;
      disposed = true;
      skeleton.dispose();
      group.removeFromParent();
    },
  };
}

// ---- the mini husky ------------------------------------------------------------------------------
const HB = { root: 0, head: 1, earL: 2, earR: 3, eyes: 4, tongue: 5, tail: 6, legFL: 7, legFR: 8, legBL: 9, legBR: 10 };
const HB_PARENT = [-1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const HB_AT = [
  [0, 0, 0], // root (the feet)
  [0, 0.335, 0.12], // head: the neck
  [0.066, 0.515, 0.148], // left ear root (+X)
  [-0.066, 0.515, 0.148], // right ear root
  [0, 0.458, 0.272], // eyes
  [0, 0.372, 0.3], // tongue
  [0, 0.31, -0.2], // tail root
  [0.066, 0.2, 0.1], [-0.066, 0.2, 0.1], // front legs (shoulders)
  [0.066, 0.21, -0.12], [-0.066, 0.21, -0.12], // back legs (hips)
];
// Recolour the faces drawn since triangle `from` by where they are: fn(x, y, z) -> hex | null (keep).
function paint(g, from, fn) {
  for (let t = from; t < g.tris; t++) {
    const i = t * 9;
    const hex = fn((g.p[i] + g.p[i + 3] + g.p[i + 6]) / 3, (g.p[i + 1] + g.p[i + 4] + g.p[i + 7]) / 3, (g.p[i + 2] + g.p[i + 5] + g.p[i + 8]) / 3);
    if (hex === null || hex === undefined) continue;
    const c = lin(hex);
    const k = 1 + (hash(t * 7 + 3) - 0.5) * 0.06;
    for (let v = 0; v < 3; v++) {
      g.c[(t * 3 + v) * 3] = c[0] * k;
      g.c[(t * 3 + v) * 3 + 1] = c[1] * k;
      g.c[(t * 3 + v) * 3 + 2] = c[2] * k;
    }
  }
}

let hgeo = null;
export function huskyGeometry() {
  if (hgeo) return hgeo;
  const H = HUSKY_COLORS;
  const g = new Geo({ skin: true });
  let bone = HB.root;
  g.skinFn = (x, y, z, si, sw) => {
    si.push(bone, 0, 0, 0);
    sw.push(1, 0, 0, 0);
  };
  g.jit = 0.03;
  const rnd = (() => {
    let s = 11;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();

  // ---- the body: grey on top with a darker saddle, a white belly and chest
  bone = HB.root;
  const b0 = g.tris;
  g.ico(0, 0.25, -0.02, 0.12, H.coat, { detail: 1, sy: 0.88, sz: 1.55, jitter: 0.025, rnd });
  g.ico(0, 0.285, 0.12, 0.09, H.white, { jitter: 0.06, rnd }); // the fluffy chest
  g.ico(0, 0.335, 0.105, 0.078, H.coat, { sy: 1.05, jitter: 0.04, rnd }); // the neck ruff
  paint(g, b0, (x, y, z) => {
    if (z > 0.06 && y < 0.36 && (z > 0.13 || y < 0.31)) return H.white; // chest and throat
    if (y < 0.215) return H.white; // the belly
    if (y > 0.315 && z < 0.06) return H.saddle; // the saddle
    return H.coat;
  });
  // the collar with a little tag
  g.at(0, 0.325, 0.12, 0, 0.55, 0);
  g.band(0.083, -0.016, 0.083, 0.016, 10, 0, H.collar);
  g.restore();
  g.ico(0, 0.272, 0.2, 0.018, H.tag, { sz: 0.5 });

  // ---- four legs (grey outside at the top, white socks), each on its own bone
  for (const [b, x, z, y0] of [[HB.legFL, 0.066, 0.1, 0.2], [HB.legFR, -0.066, 0.1, 0.2], [HB.legBL, 0.066, -0.12, 0.21], [HB.legBR, -0.066, -0.12, 0.21]]) {
    bone = b;
    const l0 = g.tris;
    g.lathe(x, 0.02, z, [[0.03, 0], [0.034, (y0 - 0.02) * 0.55], [0.042, y0 - 0.02]], H.white, { seg: 6, capTop: false });
    paint(g, l0, (px, py) => (py > 0.12 && Math.sign(px) * (px - x) > -0.005 ? H.coat : null));
    g.ico(x, 0.024, z + 0.012, 0.034, H.white, { sy: 0.7, sz: 1.2 }); // the paw
  }

  // ---- the head: a grey cap with a dark widow's peak, white cheeks and spectacles, a white muzzle
  bone = HB.head;
  const h0 = g.tris;
  g.ico(0, 0.445, 0.17, 0.112, H.coat, { detail: 1, sx: 1.08, sy: 0.96, sz: 0.98, jitter: 0.02, rnd });
  for (const sx of [-1, 1]) g.ico(sx * 0.072, 0.405, 0.205, 0.062, H.white, { jitter: 0.06, rnd }); // fluffy cheeks
  paint(g, h0, (x, y, z) => {
    const ax = Math.abs(x);
    const dy = y - 0.445;
    const dz = z - 0.17;
    if (dz > 0.035 && dy < 0.032 && !(ax < 0.022 && dy > -0.01)) return H.white; // the white face, under a dark peak
    if (dy < -0.045) return H.white; // the jaw
    if (dy > 0.06 || (ax < 0.03 && dz > -0.02)) return H.saddle; // the cap of the mask
    return H.coat;
  });
  // the muzzle and its shiny black nose
  g.ico(0, 0.405, 0.275, 0.054, H.white, { sx: 1.05, sy: 0.82, sz: 1.15 });
  g.ico(0, 0.428, 0.33, 0.022, H.nose, { sx: 1.35, sy: 0.9, sz: 0.85 });
  dot(g, 0.008, 0.436, 0.349, 0.007, 0.004, H.white, 4);
  // a little smile under the nose
  g.at(0, 0.398, 0.342, 0, -0.5, 0);
  for (const sx of [-1, 1]) {
    const a = [0, 0.004, 0], b = [sx * 0.018, -0.006, 0], c = [sx * 0.018, -0.001, 0], d = [0, 0.009, 0];
    if (sx > 0) g.quad(a, b, c, d, H.nose);
    else g.quad(a, d, c, b, H.nose);
  }
  g.restore();

  // ---- the eyes: bright blue with a dark pupil and a shine (a bone, so they can blink)
  bone = HB.eyes;
  for (const sx of [-1, 1]) {
    g.at(sx * 0.047, 0.458, 0.274, sx * 0.42, -0.12, 0);
    dot(g, 0, 0, 0, 0.026, 0.024, H.nose, 10);
    dot(g, 0, 0, 0.0015, 0.021, 0.019, H.eye, 10);
    dot(g, 0, -0.001, 0.003, 0.01, 0.011, H.nose, 8);
    dot(g, 0.008, 0.008, 0.0045, 0.006, 0.006, H.white, 5);
    g.restore();
  }

  // ---- the tongue
  bone = HB.tongue;
  g.ico(0, 0.37, 0.305, 0.026, H.tongue, { sx: 1.05, sy: 0.45, sz: 1.3 });

  // ---- upright pointy ears: grey outside, pink inside
  for (const [sx, b] of [[1, HB.earL], [-1, HB.earR]]) {
    bone = b;
    const bx = sx * 0.066, by = 0.5, bz = 0.15;
    const tip = [bx + sx * 0.022, by + 0.125, bz - 0.012];
    const fo = [bx - sx * 0.034, by, bz + 0.02], fi = [bx + sx * 0.036, by - 0.008, bz + 0.016], bk = [bx, by + 0.004, bz - 0.036];
    const behind = [bx, by + 0.03, bz - 0.05], mid = [bx, by + 0.03, bz - 0.005];
    g.triOut(fo, fi, tip, H.coat, behind);
    g.triOut(fi, bk, tip, H.saddle, mid);
    g.triOut(bk, fo, tip, H.saddle, mid);
    // the pink inside, just in front of the front face
    g.triOut([bx - sx * 0.02, by + 0.012, bz + 0.03], [bx + sx * 0.02, by + 0.006, bz + 0.027], [tip[0] - sx * 0.004, tip[1] - 0.028, tip[2] + 0.018], H.earIn, behind);
  }

  // ---- a fluffy tail, curled up over its back: grey on top, white underneath and at the tip
  bone = HB.tail;
  const t0 = g.tris;
  const curl = [[0, 0.325, -0.215, 0.046], [0, 0.39, -0.258, 0.054], [0.012, 0.448, -0.232, 0.054], [0.026, 0.44, -0.165, 0.046], [0.032, 0.405, -0.122, 0.036]];
  for (const [x, y, z, r] of curl) g.ico(x, y, z, r, H.coat, { jitter: 0.1, rnd });
  paint(g, t0, (x, y, z) => (z > -0.15 && x > 0.02 ? H.white : y < 0.43 && z < -0.2 && x <= 0.001 ? H.white : y > 0.455 ? H.saddle : null));

  hgeo = g.build();
  hgeo.userData.shared = true;
  return hgeo;
}

function bonesFor(at, parents, names, prefix) {
  const bones = at.map((p, i) => {
    const b = new THREE.Bone();
    b.name = prefix + names[i];
    return b;
  });
  at.forEach((p, i) => {
    const parent = parents[i];
    if (parent < 0) bones[i].position.set(p[0], p[1], p[2]);
    else {
      const q = at[parent];
      bones[i].position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      bones[parent].add(bones[i]);
    }
  });
  return bones;
}

// The sit: the whole dog pitches nose-up about its back hips and settles onto them, front legs
// straight, back legs folded forward under it.
const SIT_PITCH = -0.5;
const SIT_DROP = 0.115;
const HIP_Y = 0.2;
const HIP_Z = -0.13;

export function createHusky({ shadow = true } = {}) {
  const group = new THREE.Group();
  group.name = 'husky';
  const body = new THREE.Object3D();
  body.name = 'husky-body';
  body.position.y = PIVOT_Y;
  group.add(body);

  const bones = bonesFor(HB_AT, HB_PARENT, Object.keys(HB), 'husky-');
  const mesh = new THREE.SkinnedMesh(huskyGeometry(), flatMat);
  mesh.name = 'husky-mesh';
  mesh.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton); // at the origin, before it has a parent: the bind pose is the model as drawn
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 0.6);
  mesh.position.y = -PIVOT_Y;
  body.add(mesh);

  let blob = null;
  if (shadow) {
    blob = makeBlob(0.27, 0.3);
    blob.name = 'blob';
    group.add(blob);
  }

  const [root, head, earL, earR, eyes, tongue, tail, legFL, legFR, legBL, legBR] = bones;
  const mood = { sit: 0, happy: 0, move: 0, excite: 0, look: 0, tilt: 0, vy: 0, howl: 0 };
  const ear = { a: 0, v: 0, x: 0 };
  let blinkIn = 1 + Math.random() * 2.5;
  let blinkT = 0;
  let pant = 0;
  let tongueOut = 0;
  let headX = 0;
  let headY = 0;
  let headZ = 0;
  let howl = 0;
  let sit = 0;
  let gait = Math.random() * 6;
  let wagPh = Math.random() * 6;
  let disposed = false;

  function update(dt, t) {
    if (disposed) return;
    const m = motion();
    dt = Math.min(0.1, Math.max(0, dt));
    sit += (clamp(mood.sit, 0, 1) - sit) * Math.min(1, dt * 8);
    howl += (clamp(mood.howl, 0, 1) - howl) * Math.min(1, dt * 7);
    // the sit: pitch about the hips, then settle onto them
    const a = SIT_PITCH * sit;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    root.rotation.x = a;
    root.position.set(0, HIP_Y - (HIP_Y * ca - HIP_Z * sa) - SIT_DROP * sit, HIP_Z - (HIP_Y * sa + HIP_Z * ca));
    // the trot: diagonal pairs swing together
    const mv = clamp(mood.move, 0, 1) * (1 - sit);
    gait += dt * (5 + mv * 9);
    const swing = Math.sin(gait) * 0.55 * mv * (0.35 + 0.65 * m);
    legFL.rotation.x = -SIT_PITCH * sit + swing;
    legBR.rotation.x = -0.76 * sit + swing;
    legFR.rotation.x = -SIT_PITCH * sit - swing;
    legBL.rotation.x = -0.76 * sit - swing;
    // ears: perked up, swept back a little when it runs, a flick when it lands
    ear.v += ((clamp(-mood.vy * 0.06, -0.2, 0.3) - ear.a) * 80 - ear.v * 9) * dt;
    ear.a = clamp(ear.a + ear.v * dt, -0.3, 0.4);
    ear.x += (-mood.move * 0.35 + mood.happy * 0.08 - ear.x) * Math.min(1, dt * 6);
    earL.rotation.set(ear.x, 0, -ear.a * m);
    earR.rotation.set(ear.x, 0, ear.a * m);
    // head: looks about, tilts when curious, points up to howl, bobs while panting
    pant += ((Math.max(mood.happy, mood.excite, mood.move * 0.8) > 0.3 ? 1 : 0) - pant) * Math.min(1, dt * 4);
    headY += (clamp(mood.look, -0.7, 0.7) * (1 - howl) - headY) * Math.min(1, dt * 5);
    headZ += (mood.tilt * (1 - howl) - headZ) * Math.min(1, dt * 6);
    headX += (0.36 * sit - 0.62 * howl + Math.sin(t * 9) * 0.025 * pant * m * (1 - howl) - headX) * Math.min(1, dt * 8);
    head.rotation.set(headX, headY, headZ);
    // the curled tail sways side to side: faster and bigger when happy
    wagPh += dt * (8 + mood.happy * 10 + mood.excite * 6);
    const wag = Math.sin(wagPh) * (0.16 + mood.happy * 0.3 + mood.excite * 0.2 + mood.move * 0.08) * (0.3 + 0.7 * m);
    tail.rotation.set(-0.12 * sit, wag * 0.6, wag);
    // eyes: blink now and then; happy squints
    blinkIn -= dt;
    if (blinkIn <= 0) {
      blinkT = 0.13;
      blinkIn = 1.6 + Math.random() * 3.4;
    }
    let ey = 1 - mood.happy * 0.45;
    if (blinkT > 0) {
      blinkT -= dt;
      ey = 0.12;
    }
    eyes.scale.y = ey;
    // tongue: out when happy or excited (tucked in while it howls)
    tongueOut += ((pant > 0.5 && howl < 0.3 ? 1 : 0) - tongueOut) * Math.min(1, dt * 7);
    const ts = Math.max(0.001, tongueOut);
    tongue.scale.set(ts, ts * (1 + Math.sin(t * 14) * 0.18 * pant * m), ts);
    // breathing
    root.scale.y = 1 + Math.sin(t * 2.6) * 0.012 * m;
  }

  return {
    kind: 'husky',
    ground: true,
    group,
    body,
    mesh,
    shadow: blob,
    mood,
    update,
    triangles: huskyGeometry().attributes.position.count / 3,
    dispose() {
      if (disposed) return;
      disposed = true;
      skeleton.dispose();
      group.removeFromParent();
    },
  };
}

export function createPet(kind, opts = {}) {
  return kind === 'husky' ? createHusky(opts) : createPuppy(opts);
}

// ---- icons for the creator (pure strings) --------------------------------------------------------
const svg = (body) => `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
const PUFFS = [[32, 34, 17], [21, 24, 8], [32, 19, 9], [43, 24, 8], [19, 41, 8], [45, 41, 8]];

// the mini husky's face, in HUSKY_COLORS (so the tile matches the model when the colours change)
function huskyIcon() {
  const H = Object.fromEntries(Object.entries(HUSKY_COLORS).map(([k, v]) => [k, '#' + v.toString(16).padStart(6, '0')]));
  const ears = `<path d="M13 30L17 4L31 19Z" fill="${H.saddle}"/><path d="M51 30L47 4L33 19Z" fill="${H.saddle}"/>`
    + `<path d="M17 24L19 11L26 19Z" fill="${H.earIn}"/><path d="M47 24L45 11L38 19Z" fill="${H.earIn}"/>`;
  const head = `<ellipse cx="32" cy="35" rx="21" ry="19" fill="${H.coat}"/>`
    + `<path d="M11.5 33C12 19 22 15 32 15C42 15 52 19 52.5 33C46 27 40 26 32 31C24 26 18 27 11.5 33Z" fill="${H.saddle}"/>`
    + `<path d="M14 37C16 29 24 27 29 32L32 35L35 32C40 27 48 29 50 37C50 47 42 54 32 54C22 54 14 47 14 37Z" fill="${H.white}"/>`;
  const eyes = [24, 40].map((x) => `<circle cx="${x}" cy="36" r="4.4" fill="${H.eye}" stroke="${H.nose}" stroke-width="1.3"/>`
    + `<circle cx="${x}" cy="36.3" r="1.9" fill="${H.nose}"/><circle cx="${x + 1.4}" cy="34.4" r="1.1" fill="#ffffff"/>`).join('');
  const face = `<ellipse cx="32" cy="45" rx="7.5" ry="5.2" fill="#ffffff"/><ellipse cx="32" cy="42" rx="3.7" ry="2.7" fill="${H.nose}"/>`
    + `<path d="M28.6 46.2Q30.3 48 32 46.2Q33.7 48 35.4 46.2" fill="none" stroke="${H.nose}" stroke-width="1.2" stroke-linecap="round"/>`
    + `<ellipse cx="32" cy="49.6" rx="2.2" ry="2.4" fill="${H.tongue}"/>`;
  const collar = `<path d="M17 56Q32 63 47 56" fill="none" stroke="${H.collar}" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="60" r="2.8" fill="${H.tag}"/>`;
  return svg(ears + head + eyes + face + collar);
}

export function petIcon(id) {
  if (id === 'husky') return huskyIcon();
  if (id === 'cloudPuppy') {
    const ears = '<ellipse cx="12.5" cy="35" rx="7" ry="14" transform="rotate(18 12.5 35)" fill="#bfa2fb"/>'
      + '<ellipse cx="51.5" cy="35" rx="7" ry="14" transform="rotate(-18 51.5 35)" fill="#bfa2fb"/>'
      + '<ellipse cx="11" cy="44" rx="4.6" ry="4" fill="#f2a6d8"/><ellipse cx="53" cy="44" rx="4.6" ry="4" fill="#f2a6d8"/>';
    const outline = PUFFS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#e3d6f5" stroke="#d9c8f2" stroke-width="3"/>`).join('');
    const fill = PUFFS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff"/>`).join('');
    const face = '<ellipse cx="32" cy="42" rx="8" ry="5.6" fill="#fff6fb" stroke="#eadff7" stroke-width="1"/>'
      + '<ellipse cx="24.5" cy="33" rx="3.2" ry="4" fill="#17121c"/><ellipse cx="39.5" cy="33" rx="3.2" ry="4" fill="#17121c"/>'
      + '<circle cx="25.8" cy="31.4" r="1.25" fill="#fff"/><circle cx="40.8" cy="31.4" r="1.25" fill="#fff"/>'
      + '<ellipse cx="32" cy="39" rx="3.6" ry="2.6" fill="#17121c"/>'
      + '<path d="M28.6 43.2Q30.3 45 32 43.2Q33.7 45 35.4 43.2" fill="none" stroke="#17121c" stroke-width="1.2" stroke-linecap="round"/>'
      + '<ellipse cx="32" cy="46.4" rx="2.3" ry="2.6" fill="#ff6fae"/>'
      + '<ellipse cx="19.5" cy="40.5" rx="3.2" ry="2" fill="#ff9ccb" opacity=".8"/><ellipse cx="44.5" cy="40.5" rx="3.2" ry="2" fill="#ff9ccb" opacity=".8"/>';
    const bow = '<path d="M32 54C27 48 19 48 20 54C21 60 28 58 32 55ZM32 54C37 48 45 48 44 54C43 60 36 58 32 55Z" fill="#ff2e93"/>'
      + '<rect x="29.5" y="51.5" width="5" height="5" rx="2" fill="#c4126b"/>'
      + '<path d="M24.5 51.6l.6 1.3 1.4.2-1 1 .2 1.4-1.2-.7-1.3.7.3-1.4-1-1 1.4-.2z" fill="#17121c"/>'
      + '<path d="M39.5 51.6l.6 1.3 1.4.2-1 1 .2 1.4-1.2-.7-1.3.7.3-1.4-1-1 1.4-.2z" fill="#17121c"/>';
    return svg(ears + outline + fill + face + bow);
  }
  // no pet: a little cloud having a nap at home
  return svg('<circle cx="32" cy="32" r="25" fill="none" stroke="#d9c8f2" stroke-width="2.5" stroke-dasharray="5 5"/>'
    + '<path d="M18 40a8 8 0 0 1 3-15 10 10 0 0 1 19-2 8 8 0 0 1 6 15z" fill="#f6ecf7" stroke="#d9c8f2" stroke-width="2"/>'
    + '<path d="M44 14h6l-6 6h6M38 22h4l-4 4h4" fill="none" stroke="#b89cf0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
}

export function petTabIcon() {
  return svg('<ellipse cx="32" cy="42" rx="12" ry="10" fill="currentColor"/>'
    + '<ellipse cx="15" cy="27" rx="5.5" ry="7" fill="currentColor"/><ellipse cx="49" cy="27" rx="5.5" ry="7" fill="currentColor"/>'
    + '<ellipse cx="25" cy="16" rx="5.5" ry="7.5" fill="currentColor"/><ellipse cx="39" cy="16" rx="5.5" ry="7.5" fill="currentColor"/>');
}
