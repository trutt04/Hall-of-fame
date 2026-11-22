// The cheerleader: every player, bot and base in Cloud Nine (Contract 3).
//
//   LOOK_OPTIONS, DEFAULT_LOOK, LOOK_SLOTS, cleanLook(raw), randomLook(rng), lookOption(slot, id), lookKey(look)
//       (from character-looks.js: pure, safe on network input)
//   ANIM_NAMES, ANIM_GROUPS, ANIM_INFO   every animation and its metadata (from character-poses.js)
//
//   createCharacter(look = DEFAULT_LOOK, { quality = 'high' } = {}) -> {
//     group,                       feet at y = 0, faces +Z, about 1.45 m tall (the bow goes higher)
//     setAnim(name, { speed, loop, air, restart } = {})   unknown names play idle
//     setSpeed(metersPerSecond)    while idle / walk / run play, speed blends between them
//     update(dt, t)
//     setLook(look), getLook()     setLook cleans its input and rebuilds only when something changed
//     setHighlight(on, color)      a pulsing rim glow and a ring at her feet ("it", "found", team colour)
//     anchors: { handL, handR, head, back }   Object3Ds that follow her (they survive setLook)
//     dispose()
//     // extras
//     anim, animTime, animDone, airborne     what is playing; one-shots report animDone when finished
//     setFace(name | null)         'smile' | 'grin' | 'happy' | 'wow' | 'aww'; null follows the animation
//     lookAt(vector3 | null)       turn her head toward a world point
//     shadow                       her blob shadow (hide it while a toss carries her)
//     height
//   }
//
// Draw calls: one for the body, one for the rhinestone glints (when sparkle is on), one for the blob
// shadow, and one for the highlight ring while highlighted. About 3k triangles ('high') or 1.5k ('low').
//
// Animation notes for other owners:
//   - Arm motions, positions and game poses hold until the next setAnim. One-shots (jump, land, throw,
//     catch, dodge, tagged, aww and the tricks) finish and hold their last frame: check animDone.
//   - Tricks (toeTouch, pike, kickDouble, twist) jump on their own when started from the ground. Started
//     while airborne (after jump or fall, while something carries her up or down fast, or with
//     { air: true }, as in a basket toss) they play in place and end in a held straight-body pose.
//   - twist and kickDouble never rotate her body: turn her heading yourself, with trickSpin(name, u)
//     or ANIM_INFO[name].turns / spinAt / airSpinAt.
//   - Her ground shadow is the child named 'blob' (also exposed as .shadow): hide it in flight.
//   - throw releases the ball at ANIM_INFO.throw.release (fraction of its duration).
//   - cradle keeps the hips at ANIM_INFO.cradle.hipY above the group origin; sit expects a seat
//     ANIM_INFO.sit.seatY high under her.
import * as THREE from '../../lib/three.module.min.js';
import { flatMat } from './materials.js';
import { makeBlob, isReducedMotion } from './util.js';
import { Geo } from './geo.js';
import { RIG, BONES, B, PARENT, JOINTS } from './character-rig.js';
import { buildCharacter } from './character-build.js';
import { CH, NCH, ANGLE_CH, ANIM_INFO, ANIM_IK, evalAnim, isDone, hasAnim } from './character-poses.js';
import { DEFAULT_LOOK, cleanLook, lookKey, lookOption } from './character-looks.js';

export { LOOK_OPTIONS, DEFAULT_LOOK, LOOK_SLOTS, cleanLook, randomLook, lookOption, lookKey } from './character-looks.js';
export { ANIM_NAMES, ANIM_GROUPS, ANIM_INFO, trickSpin } from './character-poses.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (x) => x * x * (3 - 2 * x);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const LOCO = new Set(['idle', 'walk', 'run']);
const NOMINAL_SPEED = { idle: 0, walk: 1.6, run: 5 };

// ---- shared bits (never disposed) ----------------------------------------------------------------
const glintUniforms = { uTime: { value: 0 }, uTwinkle: { value: 1 } };
let glintMat = null;
function glintTexture() {
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.14, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  x.globalCompositeOperation = 'lighter';
  const ray = (ang, len, w) => {
    x.save();
    x.translate(32, 32);
    x.rotate(ang);
    const lg = x.createLinearGradient(-len, 0, len, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = lg;
    x.beginPath();
    x.moveTo(-len, 0); x.lineTo(0, -w); x.lineTo(len, 0); x.lineTo(0, w);
    x.closePath();
    x.fill();
    x.restore();
  };
  ray(0, 31, 2.6); ray(Math.PI / 2, 31, 2.6); ray(Math.PI / 4, 15, 1.6); ray(-Math.PI / 4, 15, 1.6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function getGlintMat() {
  if (glintMat) return glintMat;
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: glintTexture(), fog: false,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = glintUniforms.uTime;
    sh.uniforms.uTwinkle = glintUniforms.uTwinkle;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 glint;\nuniform float uTime;\nuniform float uTwinkle;\nvarying float vTw;')
      .replace('#include <project_vertex>', [
        '#include <project_vertex>',
        'float tw = max(sin(uTime * glint.w * 2.6 + glint.z * 6.2831), 0.0);',
        'tw = mix(0.6, tw * tw * tw, uTwinkle);',
        'vTw = tw;',
        'mvPosition.xy += glint.xy * (0.25 + 0.95 * tw);',
        'mvPosition.z += 0.03;',
        'gl_Position = projectionMatrix * mvPosition;',
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTw;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vTw;');
  };
  m.customProgramCacheKey = () => 'c9-glint';
  m.name = 'c9-glint';
  m.userData.shared = true;
  glintMat = m;
  return m;
}
let ringGeo = null;
function getRingGeo() {
  if (ringGeo) return ringGeo;
  const g = new Geo({ alpha: true }), seg = 36, W = 0xffffff;
  for (let i = 0; i < seg; i++) {
    const a0 = (TAU * i) / seg, a1 = (TAU * (i + 1)) / seg;
    const P = (r, a) => [Math.cos(a) * r, 0, Math.sin(a) * r];
    g.triG([0, 0, 0], P(0.34, a1), P(0.34, a0), W, W, W, 0.22, 0.05, 0.05);
    for (const [r0, r1, al0, al1] of [[0.34, 0.39, 0.05, 0.95], [0.39, 0.45, 0.95, 0]]) {
      g.triG(P(r0, a0), P(r1, a1), P(r1, a0), W, W, W, al0, al1, al1);
      g.triG(P(r0, a0), P(r0, a1), P(r1, a1), W, W, W, al0, al0, al1);
    }
  }
  ringGeo = g.build();
  ringGeo.userData.shared = true;
  return ringGeo;
}
function makeRimMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.name = 'c9-rim';
  m.userData.rim = { color: { value: new THREE.Color(0xff2e93) }, k: { value: 0.6 } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = m.userData.rim.color;
    sh.uniforms.uRimK = m.userData.rim.k;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimK;')
      .replace('#include <opaque_fragment>', [
        'float rimF = 1.0 - abs(dot(normal, normalize(vViewPosition)));',
        'outgoingLight += uRimColor * uRimK * (0.08 + 1.6 * rimF * rimF);',
        '#include <opaque_fragment>',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'c9-rim';
  return m;
}

// ---- expressions -----------------------------------------------------------------------------------
const FACES = {
  smile: { eyes: 1, happy: 0, smile: 1, grin: 0, o: 0, brow: 0 },
  grin: { eyes: 1, happy: 0, smile: 0, grin: 1, o: 0, brow: 0.002 },
  happy: { eyes: 0, happy: 1, smile: 0, grin: 1, o: 0, brow: 0.004 },
  wow: { eyes: 1.12, happy: 0, smile: 0, grin: 0, o: 1, brow: 0.008 },
  aww: { eyes: 1, happy: 0, smile: 1, grin: 0, o: 0, brow: 0.006 },
};

// The bind-pose position of a bone for this look.
function bindPos(name, rest) {
  if (JOINTS[name]) return JOINTS[name];
  const ch = rest.chain || [[0, 1.3, -0.1], [0, 1.3, -0.16], [0, 1.2, -0.2], [0, 1.1, -0.2]];
  const f = rest.face || {};
  const head = [0, RIG.headY, RIG.headZ + RIG.headR];
  switch (name) {
    case 'pony0': return ch[0];
    case 'pony1': return ch[1];
    case 'pony2': return ch[2];
    case 'bow': return rest.bowPos;
    case 'eyeL': return f.eyeL || head;
    case 'eyeR': return f.eyeR || head;
    case 'happy': return f.happy || head;
    case 'brows': return f.brows || head;
    default: return f.mouth || head; // the three mouths
  }
}

export function createCharacter(look = DEFAULT_LOOK, { quality = 'high' } = {}) {
  const q = quality === 'low' ? 'low' : 'high';
  let cur = cleanLook(look);
  let key = lookKey(cur);

  const group = new THREE.Group();
  group.name = 'cheerleader';
  const blob = makeBlob(0.3, 0.26);
  group.add(blob);

  const anchors = {};
  for (const k of ['handL', 'handR', 'head', 'back']) {
    anchors[k] = new THREE.Object3D();
    anchors[k].name = 'anchor-' + k;
  }
  const ANCHOR_BONE = { handL: 'foreL', handR: 'foreR', head: 'head', back: 'chest' };

  // highlight
  let rimMat = null, ringMat = null, ring = null;
  const hl = { on: false, color: new THREE.Color(0xff2e93) };

  // per-look parts
  let body = null, glintMesh = null, skeleton = null, bones = [], rest = null;
  let disposed = false;

  // animation state
  const st = {
    name: 'idle', time: 0, speed: 1, loop: true, ground: true, airborne: false,
    move: 0, run: 0, speedSet: false, mps: 0, smoothMps: 0, phase: 0, t: 0, m: 1,
    seed: Math.random() * 10,
  };
  const from = new Float32Array(NCH), to = new Float32Array(NCH), pose = new Float32Array(NCH);
  let blend = 1, blendDur = 0.2;

  // face state
  let faceOverride = null;
  const face = { eyes: 1, happy: 0, smile: 1, grin: 0, o: 0, brow: 0 };
  let blinkIn = 1.5 + Math.random() * 3, blinkT = 0;

  // secondary motion
  const sim = { on: false, rest: [], len: [], dir: [], pts: [], prev: [], reset: true, hr: 0.2, stiff: [0, 0.3, 0.16, 0.08] };
  for (let i = 0; i < 4; i++) { sim.rest.push(new THREE.Vector3()); sim.pts.push(new THREE.Vector3()); sim.prev.push(new THREE.Vector3()); }
  for (let i = 0; i < 3; i++) sim.dir.push(new THREE.Vector3(0, -1, 0));
  const bowSpring = { px: 0, vx: 0, pz: 0, vz: 0, last: new THREE.Vector3(), vel: new THREE.Vector3(), has: false, scale: 1 };
  const skirt = { f: 0, b: 0, l: 0, r: 0 };
  let lookTarget = null, lookW = 0, lookYaw = 0, lookPitch = 0;
  // how fast something is carrying her up or down (a toss, a fall): tricks started then play in place
  const carry = { y: 0, has: false, peak: 0 };

  // scratch
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vd = new THREE.Vector3(), ve = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), e3 = new THREE.Euler(0, 0, 0, 'YXZ');
  const T = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const headC = new THREE.Vector3(), backA = new THREE.Vector3(), backB = new THREE.Vector3();

  function rebuild() {
    const built = buildCharacter(cur, q);
    const oldBody = body, oldGlint = glintMesh, oldSkel = skeleton;
    rest = built.rest;
    bones = BONES.map((name) => {
      const b = new THREE.Bone();
      b.name = name;
      return b;
    });
    for (const name of BONES) {
      const b = bones[B[name]], p = PARENT[name], wp = bindPos(name, rest);
      if (p) {
        const pp = bindPos(p, rest);
        b.position.set(wp[0] - pp[0], wp[1] - pp[1], wp[2] - pp[2]);
        bones[B[p]].add(b);
      } else b.position.set(wp[0], wp[1], wp[2]);
    }
    body = new THREE.SkinnedMesh(built.body, hl.on && rimMat ? rimMat : flatMat);
    body.name = 'cheerleader-body';
    body.add(bones[B.hips]);
    group.add(body);
    skeleton = new THREE.Skeleton(bones);
    body.bind(skeleton);
    body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.1);
    glintMesh = null;
    if (built.glints) {
      glintMesh = new THREE.SkinnedMesh(built.glints, getGlintMat());
      glintMesh.name = 'cheerleader-glints';
      glintMesh.bind(skeleton, body.bindMatrix);
      glintMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.1);
      glintMesh.renderOrder = 3;
      group.add(glintMesh);
    }
    for (const k in anchors) {
      const bn = ANCHOR_BONE[k], a = anchors[k], w = rest.anchors[k], bp = bindPos(bn, rest);
      bones[B[bn]].add(a);
      a.position.set(w[0] - bp[0], w[1] - bp[1], w[2] - bp[2]);
    }
    // hair chain
    sim.on = !!rest.chain;
    if (sim.on) {
      const hp = JOINTS.head;
      for (let i = 0; i < 4; i++) sim.rest[i].set(rest.chain[i][0] - hp[0], rest.chain[i][1] - hp[1], rest.chain[i][2] - hp[2]);
      for (let i = 0; i < 3; i++) {
        sim.len[i] = sim.rest[i].distanceTo(sim.rest[i + 1]);
        sim.dir[i].subVectors(sim.rest[i + 1], sim.rest[i]).normalize();
      }
      sim.hr = cur.hairStyle === 'longDown' || cur.hairStyle === 'halfUp' ? 0.178 : 0.205;
      sim.stiff = cur.hairStyle === 'longDown' || cur.hairStyle === 'halfUp' ? [0, 0.4, 0.22, 0.12] : cur.hairStyle === 'braidPony' ? [0, 0.3, 0.14, 0.07] : [0, 0.28, 0.15, 0.075];
      sim.reset = true;
    }
    bowSpring.scale = rest.bowSize || 1;
    bowSpring.has = false;
    if (oldBody) {
      group.remove(oldBody);
      oldBody.geometry.dispose();
    }
    if (oldGlint) {
      group.remove(oldGlint);
      oldGlint.geometry.dispose();
    }
    if (oldSkel) oldSkel.dispose();
    applyPose(pose);
    applyFace();
  }

  // ---- posing -------------------------------------------------------------------------------------
  function limb(b, side, sx, sz, tw) {
    const el = Math.hypot(sx, sz);
    const S = el < 1e-6 ? 0.5 : Math.sin(el / 2) / el;
    qa.set(-sz * S, 0, side * sx * S, Math.cos(el / 2));
    qb.setFromAxisAngle(Y, side * tw);
    b.quaternion.multiplyQuaternions(qa, qb);
  }
  function spineQ(b, x, y, z) {
    e3.set(x, y, z, 'YXZ');
    b.quaternion.setFromEuler(e3);
  }
  // Where a limb points (in the hips' frame) for the skirt: returns [forward, side, back] lift angles.
  function legLift(sx, sz, side) {
    const el = Math.hypot(sx, sz), s = Math.sin(el), dy = -Math.cos(el);
    const dx = el > 1e-6 ? (s * sx) / el : 0, dz = el > 1e-6 ? (s * sz) / el : 0;
    return [Math.max(0, Math.atan2(dz, -dy)), Math.max(0, Math.atan2(dx, -dy)), Math.max(0, Math.atan2(-dz, -dy)), side];
  }
  function applyPose(p) {
    if (!bones.length) return;
    const hb = bones[B.hips];
    hb.position.set(p[CH.rootX], RIG.hipY + p[CH.rootY], p[CH.rootZ]);
    qa.setFromAxisAngle(Y, p[CH.yaw]);
    qb.setFromAxisAngle(X, p[CH.pitch]); qa.multiply(qb);
    qb.setFromAxisAngle(Z, p[CH.roll]); qa.multiply(qb);
    qb.setFromAxisAngle(Y, p[CH.spin]); qa.multiply(qb);
    hb.quaternion.copy(qa);
    spineQ(bones[B.waist], p[CH.waistX], p[CH.waistY], p[CH.waistZ]);
    spineQ(bones[B.chest], p[CH.chestX], p[CH.chestY], p[CH.chestZ]);
    spineQ(bones[B.head], p[CH.headX], p[CH.headY], p[CH.headZ]);
    limb(bones[B.armL], 1, p[CH.aLx], p[CH.aLz], p[CH.aLt]);
    bones[B.foreL].quaternion.setFromAxisAngle(X, -p[CH.eL]);
    limb(bones[B.armR], -1, p[CH.aRx], p[CH.aRz], p[CH.aRt]);
    bones[B.foreR].quaternion.setFromAxisAngle(X, -p[CH.eR]);
    limb(bones[B.legL], 1, p[CH.lLx], p[CH.lLz], p[CH.lLt]);
    bones[B.shinL].quaternion.setFromAxisAngle(X, p[CH.kL]);
    bones[B.footL].quaternion.setFromAxisAngle(X, p[CH.fL]);
    limb(bones[B.legR], -1, p[CH.lRx], p[CH.lRz], p[CH.lRt]);
    bones[B.shinR].quaternion.setFromAxisAngle(X, p[CH.kR]);
    bones[B.footR].quaternion.setFromAxisAngle(X, p[CH.fR]);
  }
  function applySkirt(p, dt) {
    if (cur.bottom.indexOf('skirt') !== 0) return;
    const a = legLift(p[CH.lLx], p[CH.lLz], 1), b = legLift(p[CH.lRx], p[CH.lRz], -1);
    const pad = (v) => (v > 0.12 ? v + 0.1 : v * 0.5);
    const flare = 0.05 * st.run + 0.03 * st.move;
    const k = dt > 0 ? 1 - Math.exp(-30 * dt) : 1;
    skirt.f += (pad(Math.max(a[0], b[0])) + flare - skirt.f) * k;
    skirt.b += (pad(Math.max(a[2], b[2])) + flare - skirt.b) * k;
    skirt.l += (pad(a[1]) + flare - skirt.l) * k;
    skirt.r += (pad(b[1]) + flare - skirt.r) * k;
    bones[B.skirtF].quaternion.setFromAxisAngle(X, -clamp(skirt.f, 0, 1.7));
    bones[B.skirtB].quaternion.setFromAxisAngle(X, clamp(skirt.b, 0, 1.7));
    bones[B.skirtL].quaternion.setFromAxisAngle(Z, clamp(skirt.l, 0, 1.7));
    bones[B.skirtR].quaternion.setFromAxisAngle(Z, -clamp(skirt.r, 0, 1.7));
  }

  // ---- two-bone IK (hands to feet, eyes, each other; a foot to a knee) -------------------------
  const IK_CHAINS = {
    armL: { up: B.armL, lo: B.foreL, ch: CH.ikL, a: RIG.upperArm, b: RIG.foreArm, arm: true },
    armR: { up: B.armR, lo: B.foreR, ch: CH.ikR, a: RIG.upperArm, b: RIG.foreArm, arm: true },
    legL: { up: B.legL, lo: B.shinL, ch: CH.ikLL, a: RIG.thigh, b: RIG.shin, arm: false },
    legR: { up: B.legR, lo: B.shinR, ch: CH.ikLR, a: RIG.thigh, b: RIG.shin, arm: false },
  };
  const ikSpec = { armL: null, armR: null, legL: null, legR: null };
  const ikPrev = { armL: null, armR: null, legL: null, legR: null };
  const iT = new THREE.Vector3(), iS = new THREE.Vector3(), iD = new THREE.Vector3(), iP = new THREE.Vector3();
  const iE = new THREE.Vector3(), iU = new THREE.Vector3(), iF = new THREE.Vector3();
  const iX = new THREE.Vector3(), iY = new THREE.Vector3(), iZ = new THREE.Vector3();
  function solve(chain, spec, w) {
    const ub = bones[chain.up], lb = bones[chain.lo], tb = bones[B[spec.bone]];
    iT.set(spec.at[0], spec.at[1], spec.at[2]).applyMatrix4(tb.matrixWorld);
    iS.setFromMatrixPosition(ub.matrixWorld);
    iD.subVectors(iT, iS);
    let d = iD.length();
    if (d < 1e-5) return;
    iD.multiplyScalar(1 / d);
    const a = chain.a, b = chain.b;
    d = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    // the pole says where the elbow (or knee) points, in her own frame
    group.getWorldQuaternion(qc);
    iP.set(spec.pole[0], spec.pole[1], spec.pole[2]).applyQuaternion(qc);
    iP.addScaledVector(iD, -iP.dot(iD));
    if (iP.lengthSq() < 1e-8) iP.set(0, 0, 1).applyQuaternion(qc);
    iP.normalize();
    iE.copy(iS).addScaledVector(iD, a * cosA).addScaledVector(iP, a * sinA); // the joint
    iU.subVectors(iE, iS).normalize(); // upper bone direction
    iF.copy(iS).addScaledVector(iD, d).sub(iE).normalize(); // lower bone direction
    iZ.copy(iF).addScaledVector(iU, -iF.dot(iU)); // which way the lower bone bends
    if (iZ.lengthSq() < 1e-8) iZ.copy(iP).multiplyScalar(-1);
    iZ.normalize();
    if (!chain.arm) iZ.multiplyScalar(-1); // knees bend back: the shin turns toward local -Z
    iY.copy(iU).multiplyScalar(-1);
    iX.crossVectors(iY, iZ).normalize();
    iZ.crossVectors(iX, iY).normalize();
    m4.makeBasis(iX, iY, iZ);
    qa.setFromRotationMatrix(m4);
    ub.parent.getWorldQuaternion(qb);
    qb.invert().multiply(qa);
    const flex = Math.acos(clamp(iU.dot(iF), -1, 1));
    ub.quaternion.slerp(qb, w);
    qa.setFromAxisAngle(X, chain.arm ? -flex : flex);
    lb.quaternion.slerp(qa, w);
    ub.updateMatrixWorld(true);
  }
  function runIK(p) {
    const spec = ANIM_IK[st.name];
    for (const k of ['legL', 'legR', 'armL', 'armR']) {
      const chain = IK_CHAINS[k], w = clamp(p[chain.ch], 0, 1);
      if (spec && spec[k]) { ikSpec[k] = spec[k]; ikPrev[k] = spec[k]; } else ikSpec[k] = ikPrev[k];
      if (w > 0.001 && ikSpec[k]) solve(chain, ikSpec[k], w);
    }
  }

  // ---- hair and bow -------------------------------------------------------------------------------
  function stepHair(dt) {
    if (!sim.on) return;
    const hb = bones[B.head];
    for (let i = 0; i < 4; i++) T[i].copy(sim.rest[i]).applyMatrix4(hb.matrixWorld);
    if (sim.reset || sim.pts[0].distanceToSquared(T[0]) > 1.5) {
      for (let i = 0; i < 4; i++) { sim.pts[i].copy(T[i]); sim.prev[i].copy(T[i]); }
      sim.reset = false;
    }
    const frozen = st.name === 'frozen';
    const h = clamp(dt, 0, 1 / 30), f60 = h * 60;
    sim.pts[0].copy(T[0]); sim.prev[0].copy(T[0]);
    headC.set(0, RIG.headY - RIG.neckY, RIG.headZ).applyMatrix4(hb.matrixWorld);
    const cb = bones[B.chest];
    backA.set(0, -0.04, -0.01).applyMatrix4(cb.matrixWorld);
    backB.set(0, 0.16, -0.01).applyMatrix4(cb.matrixWorld);
    if (!frozen && h > 0) {
      const damping = Math.pow(0.9, f60), grav = 7 * h * h;
      for (let i = 1; i < 4; i++) {
        const p = sim.pts[i], pr = sim.prev[i];
        vd.subVectors(p, pr).multiplyScalar(damping);
        if (vd.lengthSq() > 0.04) vd.setLength(0.2);
        pr.copy(p);
        p.add(vd);
        p.y -= grav;
        const k = 1 - Math.pow(1 - sim.stiff[i], f60);
        p.lerp(T[i], k);
      }
    } else if (frozen) {
      // frozen means frozen: the hair keeps its shape relative to her head
      for (let i = 1; i < 4; i++) { sim.pts[i].copy(T[i]); sim.prev[i].copy(T[i]); }
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < 4; i++) {
        const p = sim.pts[i], q0 = sim.pts[i - 1];
        vd.subVectors(p, q0);
        const L = vd.length() || 1e-6;
        p.copy(q0).addScaledVector(vd, sim.len[i - 1] / L);
        // keep out of the head and the upper back
        vd.subVectors(p, headC);
        const dh = vd.length();
        if (dh < sim.hr) p.copy(headC).addScaledVector(vd, sim.hr / (dh || 1e-6));
        ve.subVectors(backB, backA);
        const t = clamp(vd.subVectors(p, backA).dot(ve) / ve.lengthSq(), 0, 1);
        vc.copy(backA).addScaledVector(ve, t);
        vd.subVectors(p, vc);
        const db = vd.length(), rb = 0.11;
        if (db < rb) p.copy(vc).addScaledVector(vd, rb / (db || 1e-6));
      }
    }
    // aim the bones down the simulated chain
    hb.getWorldQuaternion(qc);
    for (let i = 0; i < 3; i++) {
      const b = bones[B.pony0 + i];
      vd.subVectors(sim.pts[i + 1], sim.pts[i]).normalize();
      qb.copy(qc).invert();
      vd.applyQuaternion(qb);
      b.quaternion.setFromUnitVectors(sim.dir[i], vd);
      qc.multiply(b.quaternion);
    }
  }
  function stepBow(dt) {
    const hb = bones[B.head];
    if (!dt || !bones.length) return;
    va.set(0, RIG.headY - RIG.neckY + 0.15, -0.1).applyMatrix4(hb.matrixWorld);
    if (!bowSpring.has) { bowSpring.last.copy(va); bowSpring.vel.set(0, 0, 0); bowSpring.has = true; }
    vb.subVectors(va, bowSpring.last).multiplyScalar(1 / dt);
    if (vb.lengthSq() > 400) vb.set(0, 0, 0); // a teleport, not a motion
    vc.subVectors(vb, bowSpring.vel).multiplyScalar(1 / dt); // acceleration
    bowSpring.vel.copy(vb);
    bowSpring.last.copy(va);
    hb.getWorldQuaternion(qa).invert();
    vc.applyQuaternion(qa);
    const s = bowSpring.scale, kk = 160 / s, c = 9 / Math.sqrt(s), m = st.m;
    const fx = clamp(-vc.y * 0.0035 * s + vc.z * 0.002 * s, -2, 2) * m, fz = clamp(vc.x * 0.003 * s, -2, 2) * m;
    const h = Math.min(dt, 1 / 30);
    bowSpring.vx += (-kk * bowSpring.px - c * bowSpring.vx + fx * kk) * h;
    bowSpring.px = clamp(bowSpring.px + bowSpring.vx * h, -0.4, 0.4);
    bowSpring.vz += (-kk * bowSpring.pz - c * bowSpring.vz + fz * kk) * h;
    bowSpring.pz = clamp(bowSpring.pz + bowSpring.vz * h, -0.35, 0.35);
    e3.set(bowSpring.px, 0, bowSpring.pz, 'XYZ');
    bones[B.bow].quaternion.setFromEuler(e3);
  }

  // ---- face ---------------------------------------------------------------------------------------
  function applyFace() {
    if (!bones.length) return;
    const blink = blinkT > 0 ? 0.08 : 1;
    const ey = face.eyes, ok = ey > 0.02;
    bones[B.eyeL].scale.set(ok ? ey : 0, ok ? ey * blink : 0, ok ? 1 : 0);
    bones[B.eyeR].scale.copy(bones[B.eyeL].scale);
    const hp = face.happy;
    bones[B.happy].scale.set(hp, hp, hp > 0.02 ? 1 : 0);
    bones[B.mouthSmile].scale.set(face.smile, face.smile, face.smile > 0.02 ? 1 : 0);
    bones[B.mouthGrin].scale.set(face.grin, face.grin, face.grin > 0.02 ? 1 : 0);
    bones[B.mouthO].scale.set(face.o, face.o, face.o > 0.02 ? 1 : 0);
    const bp = bindPos('brows', rest), hp0 = JOINTS.head;
    bones[B.brows].position.set(bp[0] - hp0[0], bp[1] - hp0[1] + face.brow, bp[2] - hp0[2]);
  }
  function stepFace(dt) {
    const name = faceOverride || (ANIM_INFO[st.name] && ANIM_INFO[st.name].face) || 'smile';
    const want = FACES[name] || FACES.smile;
    const k = 1 - Math.exp(-26 * dt);
    for (const key in face) face[key] += (want[key] - face[key]) * k;
    // snap tiny values so hidden features collapse fully
    for (const key of ['happy', 'smile', 'grin', 'o']) if (Math.abs(face[key] - want[key]) < 0.02) face[key] = want[key];
    if (st.name === 'frozen') blinkT = 0;
    else if (blinkT > 0) blinkT -= dt;
    else if ((blinkIn -= dt) <= 0) {
      blinkT = 0.12;
      blinkIn = Math.random() < 0.2 ? 0.25 : 2.2 + Math.random() * 3.5; // sometimes a double blink
    }
    applyFace();
  }

  // ---- highlight ----------------------------------------------------------------------------------
  function applyHighlight() {
    if (hl.on) {
      if (!rimMat) rimMat = makeRimMaterial();
      rimMat.userData.rim.color.value.copy(hl.color);
      if (!ring) {
        ringMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: hl.color });
        ringMat.name = 'c9-ring';
        ring = new THREE.Mesh(getRingGeo(), ringMat);
        ring.name = 'highlight-ring';
        ring.position.y = 0.03;
        ring.renderOrder = 2;
        group.add(ring);
      }
      ringMat.color.copy(hl.color);
      ring.visible = true;
      if (body) body.material = rimMat;
    } else {
      if (ring) ring.visible = false;
      if (body) body.material = flatMat;
    }
  }

  // ---- the API ------------------------------------------------------------------------------------
  const api = {
    group,
    anchors,
    shadow: blob,
    height: RIG.height,
    get anim() { return st.name; },
    get animTime() { return st.time; },
    get animDone() { return isDone(st.name, st.time, st.loop); },
    get airborne() { return st.airborne; },

    setAnim(name, opts) {
      if (disposed) return;
      if (!hasAnim(name)) name = 'idle';
      const o = opts && typeof opts === 'object' ? opts : {};
      const info = ANIM_INFO[name];
      const speed = typeof o.speed === 'number' && o.speed > 0 ? clamp(o.speed, 0.1, 4) : null;
      if (name === st.name && !o.restart) {
        if (speed) st.speed = speed;
        if (typeof o.loop === 'boolean') st.loop = o.loop;
        return;
      }
      const bothLoco = LOCO.has(name) && LOCO.has(st.name);
      if (!bothLoco) {
        from.set(pose);
        for (const c of ANGLE_CH) from[c] = angleDelta(0, from[c]);
        blend = 0;
        blendDur = Math.max(0.04, info.blend);
      }
      st.ground = typeof o.air === 'boolean' ? !o.air : !(st.airborne || carry.peak > 1.6);
      if (info.air) st.airborne = true;
      else if (info.trick) st.airborne = !st.ground;
      else st.airborne = false;
      st.name = name;
      st.time = 0;
      st.speed = speed || 1;
      st.loop = typeof o.loop === 'boolean' ? o.loop : info.loop;
      if (!bothLoco && LOCO.has(name) && !st.speedSet) st.smoothMps = NOMINAL_SPEED[name];
    },

    setSpeed(v) {
      st.mps = Number.isFinite(v) ? clamp(Math.abs(v), 0, 20) : 0;
      st.speedSet = true;
    },

    update(dt, t) {
      if (disposed || !bones.length) return;
      dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
      t = Number.isFinite(t) ? t : st.t + dt;
      st.t = t;
      st.m = isReducedMotion() ? 0.15 : 1;
      // locomotion blend from speed
      const target = st.speedSet ? st.mps : NOMINAL_SPEED[st.name] || 0;
      st.smoothMps = damp(st.smoothMps, target, 9, dt);
      const v = st.smoothMps;
      st.move = sstep(0.12, 0.95, v);
      st.run = sstep(2.8, 4.8, v);
      const cycle = 1.2 + 1.1 * st.run;
      if (v > 0.05) st.phase = (st.phase + dt * clamp(v / cycle, 0.75, 3.1) * TAU) % (TAU * 64);
      // the clip and the blend into it
      st.time += dt * st.speed;
      evalAnim(st.name, to, LOCO.has(st.name) ? t : st.time, st, st.loop);
      if (blend < 1) {
        blend = Math.min(1, blend + dt / blendDur);
        const k = smooth(blend);
        for (let i = 0; i < NCH; i++) pose[i] = from[i] + (to[i] - from[i]) * k;
        for (const c of ANGLE_CH) pose[c] = from[c] + angleDelta(from[c], to[c]) * k;
      } else pose.set(to);
      // look at something
      const kind = ANIM_INFO[st.name].kind;
      const canLook = lookTarget && (kind === 'move' || kind === 'react' || kind === 'arm') && st.name !== 'sit';
      lookW = damp(lookW, canLook ? 1 : 0, 5, dt);
      if (lookTarget && lookW > 0.001) {
        va.copy(lookTarget);
        group.worldToLocal(va);
        const dx = va.x, dy = va.y - (RIG.headY + pose[CH.rootY]), dz = va.z;
        lookYaw = damp(lookYaw, clamp(Math.atan2(dx, dz), -0.9, 0.9), 6, dt);
        lookPitch = damp(lookPitch, clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.35, 0.4), 6, dt);
        pose[CH.headY] = pose[CH.headY] * (1 - lookW) + (lookYaw - pose[CH.chestY] - pose[CH.waistY]) * lookW;
        pose[CH.headX] = pose[CH.headX] * (1 - lookW * 0.7) + lookPitch * lookW * 0.7;
      }
      applyPose(pose);
      applySkirt(pose, dt);
      group.updateWorldMatrix(true, true);
      const wy = group.matrixWorld.elements[13];
      if (carry.has && dt > 0 && Math.abs(wy - carry.y) < 3) {
        carry.peak = Math.max(Math.abs(wy - carry.y) / dt, carry.peak * Math.exp(-2.5 * dt));
      }
      carry.y = wy;
      carry.has = true;
      runIK(pose);
      stepHair(dt);
      stepBow(dt);
      stepFace(dt);
      // blob shadow shrinks as she leaves the ground
      const lift = Math.max(0, pose[CH.rootY]);
      const s = 1 / (1 + lift * 2.2);
      blob.scale.set(0.3 * s, 1, 0.26 * s);
      if (hl.on) {
        const pulse = st.m < 0.5 ? 0.6 : 0.55 + 0.25 * Math.sin(t * 5);
        rimMat.userData.rim.k.value = pulse;
        ring.scale.setScalar(1 + 0.05 * Math.sin(t * 5) * st.m);
        ring.rotation.y = t * 0.6 * st.m;
      }
      glintUniforms.uTime.value = t;
      glintUniforms.uTwinkle.value = st.m < 0.5 ? 0 : 1;
    },

    setLook(next) {
      if (disposed) return;
      const clean = cleanLook(next), k = lookKey(clean);
      if (k === key) return;
      cur = clean;
      key = k;
      rebuild();
    },
    getLook() { return Object.assign({}, cur); },

    setHighlight(on, color) {
      hl.on = !!on;
      if (color !== undefined && color !== null) {
        try {
          if (typeof color === 'number' && Number.isFinite(color)) hl.color.setHex(color & 0xffffff);
          else if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) hl.color.set(color);
          else if (color && color.isColor) hl.color.copy(color);
        } catch (err) {
          // keep the previous colour
        }
      }
      applyHighlight();
    },

    setFace(name) { faceOverride = typeof name === 'string' && FACES[name] ? name : null; },
    lookAt(v) {
      if (v && v.isVector3) lookTarget = (lookTarget || new THREE.Vector3()).copy(v);
      else lookTarget = null;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      if (body) body.geometry.dispose();
      if (glintMesh) glintMesh.geometry.dispose();
      if (skeleton) skeleton.dispose();
      if (rimMat) rimMat.dispose();
      if (ringMat) ringMat.dispose();
      body = glintMesh = skeleton = null;
      bones = [];
    },
  };

  evalAnim('idle', pose, 0, st, true);
  rebuild();
  group.userData.character = api;
  return api;
}

// The bow's colours, for UI that wants to match (creator swatches, name tags).
export function lookColors(look) {
  const l = cleanLook(look);
  return {
    bow: lookOption('bow', l.bow).color,
    hair: lookOption('hair', l.hair).color,
    top: lookOption('top', l.top).color,
    skin: lookOption('skin', l.skin).color,
  };
}
