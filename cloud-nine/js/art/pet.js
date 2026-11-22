// The cloud puppy: the pet the 12th spirit stick (Rainbow's End) unlocks. A chunky low-poly puppy
// made of cloud puffs, in the house style: flat-shaded vertex colours on the shared flatMat, every
// part merged into ONE skinned geometry (one draw call per pet), plus a soft blob shadow. Floppy
// lilac ears, a black nose, shiny eyes, pink cheeks, a tiny puff tail and a hot-pink bow collar
// with little black stars, matching her bow. About 0.65 m tall; it faces +Z.
//
//   PET_IDS                          ['none', 'cloudPuppy'] (the look's `pet` slot)
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
//   puppyGeometry()                  the shared geometry (built once, never disposed)
//   petIcon(id) -> '<svg ...>'       the creator's tiles; petTabIcon() -> '<svg ...>' (currentColor)
import * as THREE from '../../lib/three.module.min.js';
import { Geo } from './geo.js';
import { flatMat } from './materials.js';
import { makeBlob, motion } from './util.js';

export const PET_IDS = Object.freeze(['none', 'cloudPuppy']);
export const PIVOT_Y = 0.24;

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

// ---- icons for the creator (pure strings) --------------------------------------------------------
const svg = (body) => `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
const PUFFS = [[32, 34, 17], [21, 24, 8], [32, 19, 9], [43, 24, 8], [19, 41, 8], [45, 41, 8]];

export function petIcon(id) {
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
