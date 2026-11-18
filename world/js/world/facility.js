// The practice facility on the west flat: a row of substation bays with wires strung between
// them, a fence along the front, pylons behind and beside, and the catching field in front.
//
// It reads as a wall of industrial steel from the plaza and from the field, which is the whole
// joke: the Draft Day Memorial Gardens got the plot next to the high voltage.
//
//   const facility = createFacility(world)
//   facility.update(dt, t)
//   facility.place      { x, z, facing } where a visitor stands to start the catching drill
//   facility.sight      { x, z, facing } where a visitor stands to look at the substation
//   facility.field      { x0, x1, z0, z1, y } the turf, in world coordinates
//   facility.machine    { x, y, z, facing, muzzle: Vector3, radius }
//   facility.setBest(n) redraws the little sign beside the machine
//
// The art lives in art/facility.js. Every builder is looked up through the art index at call time
// (the same guard regime.js uses with artProp), so a builder that is missing or throws costs this
// area its detail and nothing else: the stand-in steel further down steps in and the world still
// has a substation. Geo puts a box's or a cylinder's BASE at the y it is given.

import * as THREE from '../../lib/three.module.min.js';
import * as ART from '../art/index.js';
import { Geo, flatMat } from '../art/index.js';
import { drawSign } from './signs.js';
import { boardTexture } from './boards.js';

const STEEL = 0x9aa3ad;
const STEEL_DK = 0x6f7883;
const RUST = 0x7a6a5c;
const INSULATOR = 0xb9c2c6;
const WIRE = 0x3a4048;
const SCREEN = 0x1f3a2e; // the dark windscreen fabric every practice field hangs on its fence
const TURF_A = 0x4f9e4a;
const TURF_B = 0x5bb054;
const CHALK = 0xf3eedd;
const GRAVEL = 0xb0a68e;

const SMALL_FAR = 95; // sleds, the cart, the machine and the signs stop drawing past this
const WIRE_FAR = 150; // the wires are a hair wide from the Hill: not worth the draw call

// Art builders are optional until art/facility.js lands. Same guard as regime.js.
function artProp(name, a, b) {
  if (typeof ART[name] !== 'function') return null;
  try {
    return ART[name](a, b) || null;
  } catch (err) {
    console.warn('[lw] art builder "' + name + '" failed, using the stand-in', err);
    return null;
  }
}

// ------------------------------------------------------------------ stand-in art
// Plain boxes and tubes in the same shapes, anchors and collider contract as art/facility.js.
// These only ever run if a real builder is missing or throws, and they keep the wall standing.

function standInBay({ w = 9, d = 7, scale = 1 } = {}) {
  const g = new Geo({ jit: 0.05 });
  const group = new THREE.Group();
  const hw = w / 2;
  const tall = 9.6 * scale;
  const low = 7.1 * scale;
  const backZ = -d / 2 + 0.4;
  const frontZ = d / 2 - 0.7;
  const xs = [-hw + 1.1, 0, hw - 1.1];
  const wireTops = [];
  // line side: three tall posts under one beam, each with a stack of insulators
  for (const x of xs) {
    g.box(x, 0, backZ, 0.34, tall, 0.34, STEEL);
    for (let k = 0; k < 3; k++) g.cyl(x, tall + 0.04 + k * 0.17, backZ, 0.15, 0.15, INSULATOR, { seg: 6 });
    wireTops.push(new THREE.Vector3(x, tall + 0.62, backZ));
  }
  g.box(0, tall - 0.24, backZ, w - 1.0, 0.24, 0.32, STEEL_DK);
  g.box(0, tall - 2.2, backZ, w - 1.0, 0.16, 0.26, STEEL_DK);
  // field side: shorter frame carrying the switchgear
  for (const x of [-hw + 1.7, hw - 1.7]) {
    g.box(x, 0, frontZ, 0.3, low, 0.3, STEEL);
    for (let k = 0; k < 3; k++) g.cyl(x, low + 0.04 + k * 0.17, frontZ, 0.13, 0.15, INSULATOR, { seg: 6 });
  }
  g.box(0, low - 0.22, frontZ, w - 2.6, 0.22, 0.28, STEEL_DK);
  // the transformer, its radiators and the bushing on top, down on the pad
  g.box(0, 0, 0.6, 3.0, 2.9, 2.2, STEEL_DK);
  for (let k = 0; k < 5; k++) g.box(-1.1 + k * 0.55, 0.35, 1.75, 0.3, 2.2, 0.55, RUST);
  g.box(0, 2.9, 0.6, 1.0, 0.55, 1.0, INSULATOR);
  // a walkway tying the two frames together, so the silhouette is not two bare combs
  g.box(0, low - 2.6, (backZ + frontZ) / 2, 0.22, 0.2, frontZ - backZ, STEEL_DK);
  const mesh = g.mesh(flatMat);
  mesh.name = 'substationBay';
  group.add(mesh);
  return {
    group,
    height: tall + 1,
    radius: Math.max(w, d) / 2,
    colliders: [{ x: 0, z: 0.6, r: 2.0 }, { x: -hw + 1.1, z: backZ, r: 0.45 }, { x: hw - 1.1, z: backZ, r: 0.45 }],
    anchors: { wireTops },
    dispose() { mesh.geometry.dispose(); },
  };
}

function standInPylon({ height = 16, scale = 1 } = {}) {
  const g = new Geo({ jit: 0.05 });
  const group = new THREE.Group();
  const H = height * scale;
  const base = 1.8 * scale;
  const top = 0.5 * scale;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.tube([[sx * base, 0, sz * base], [sx * base * 0.42, H * 0.55, sz * base * 0.42], [sx * top, H, sz * top]], 0.12 * scale, STEEL, { seg: 4 });
  }
  for (let k = 1; k <= 5; k++) {
    const u = k / 6;
    const r = base * (1 - u) + top * u;
    const y = H * u;
    g.box(0, y, -r, r * 2, 0.09, 0.09, STEEL_DK);
    g.box(0, y, r, r * 2, 0.09, 0.09, STEEL_DK);
    g.box(-r, y, 0, 0.09, 0.09, r * 2, STEEL_DK);
    g.box(r, y, 0, 0.09, 0.09, r * 2, STEEL_DK);
  }
  const arms = [];
  for (const [y, len] of [[H * 0.66, 3.4 * scale], [H * 0.84, 2.7 * scale], [H * 0.98, 1.5 * scale]]) {
    g.box(0, y, -0.12, len * 2, 0.16, 0.24, STEEL);
    for (const sx of [-1, 1]) {
      g.cyl(sx * len, y - 0.7, 0, 0.09, 0.7, INSULATOR, { seg: 5 });
      arms.push(new THREE.Vector3(sx * len, y - 0.78, 0));
    }
  }
  const mesh = g.mesh(flatMat);
  mesh.name = 'pylon';
  group.add(mesh);
  return { group, height: H, radius: base + 0.3, colliders: [{ x: 0, z: 0, r: base + 0.2 }], anchors: { arms }, dispose() { mesh.geometry.dispose(); } };
}

function standInFence({ length = 18, scale = 1 } = {}) {
  const g = new Geo({ jit: 0.03 });
  const group = new THREE.Group();
  const h = 2.5 * scale;
  const half = length / 2;
  g.box(0, 0.18, 0, length, h - 0.3, 0.06, SCREEN);
  g.box(0, h - 0.14, 0, length, 0.14, 0.14, STEEL);
  for (let x = -half; x <= half + 0.01; x += 3) {
    g.box(Math.min(x, half - 0.07), 0, 0, 0.13, h, 0.13, STEEL_DK);
    g.tube([[Math.min(x, half - 0.07), h, 0], [Math.min(x, half - 0.07) + 0.04, h + 0.42, 0.3]], 0.045, STEEL_DK, { seg: 4 });
  }
  const mesh = g.mesh(flatMat);
  mesh.name = 'substationFence';
  group.add(mesh);
  return { group, height: h, length, colliders: [], dispose() { mesh.geometry.dispose(); } };
}

function standInBallMachine({ scale = 1 } = {}) {
  const s = scale;
  const g = new Geo({ jit: 0.04 });
  const group = new THREE.Group();
  for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [0, 0.6]]) g.tube([[x * s, 0, z * s], [0, 0.95 * s, 0]], 0.055 * s, STEEL_DK, { seg: 4 });
  g.box(0, 0, 0.5 * s, 0.6 * s, 0.1 * s, 0.14 * s, STEEL_DK);
  g.box(-0.4 * s, 0.95 * s, -0.42 * s, 0.8 * s, 0.62 * s, 0.6 * s, 0x2a3350); // the hopper
  for (let k = 0; k < 4; k++) g.sphere((-0.22 + (k % 2) * 0.28) * s, (1.72 + Math.floor(k / 2) * 0.2) * s, (-0.18 - (k % 2) * 0.2) * s, 0.14 * s, 0x8a4b2a, { seg: 6, rings: 4, sy: 1.6 });
  g.cyl(0.22 * s, 0.95 * s, 0.2 * s, 0.34 * s, 0.44 * s, 0xf5c542, { seg: 8, rz: Math.PI / 2 }); // the body
  g.cyl(0, 1.12 * s, 0.34 * s, 0.17 * s, 0.46 * s, STEEL, { seg: 8, rx: Math.PI / 2 }); // the barrel
  const mesh = g.mesh(flatMat);
  mesh.name = 'ballMachine';
  group.add(mesh);
  // two wheels on axles across the throw: spun about X
  const wg = new Geo();
  for (const sy of [-1, 1]) wg.cyl(0.05 * s, sy * 0.21 * s, 0, 0.23 * s, 0.1 * s, 0x23262e, { seg: 9, rz: Math.PI / 2 });
  for (const sy of [-1, 1]) wg.box(-0.02 * s, sy * 0.21 * s - 0.01 * s, -0.23 * s, 0.11 * s, 0.02 * s, 0.46 * s, 0xff6a3d);
  const wheels = wg.mesh(flatMat);
  wheels.position.set(0, 1.12 * s, 0.1 * s);
  group.add(wheels);
  let spin = 0;
  return {
    group,
    height: 2.0 * s,
    radius: 0.85 * s,
    colliders: [{ x: 0, z: 0, r: 0.75 * s }],
    anchors: { muzzle: new THREE.Vector3(0, 1.12 * s, 0.82 * s) },
    update(dt) {
      spin += dt * 9;
      if (spin > 1e4) spin -= 1e4;
      wheels.rotation.x = spin;
    },
    dispose() {
      mesh.geometry.dispose();
      wheels.geometry.dispose();
    },
  };
}

export function createFacility(w) {
  const { scene, layout, terrain, colliders, audio } = w;
  const S = layout.places.substation;
  const F = layout.places.practiceField;
  const A = layout.places.graveAnnex;
  const group = new THREE.Group();
  group.name = 'facility';
  scene.add(group);

  const Y = S.y;
  const fx0 = F.x - F.w / 2;
  const fx1 = F.x + F.w / 2;
  const fz0 = F.z - F.d / 2;
  const fz1 = F.z + F.d / 2;
  const field = { x0: fx0, x1: fx1, z0: fz0, z1: fz1, y: Y };

  const items = []; // { prop, x, z, small, far }
  const cam = new THREE.Vector3();

  function put(prop, x, z, facing = 0, o = {}) {
    if (!prop || !prop.group) return null;
    const y = o.y !== undefined ? o.y : terrain.heightAt(x, z);
    prop.group.position.set(x, y, z);
    prop.group.rotation.y = facing;
    group.add(prop.group);
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    if (o.solid !== false) {
      if (prop.footprint) colliders.addBox(x, z, prop.footprint.w, prop.footprint.d, facing, 'facility');
      for (const col of prop.colliders || []) colliders.addCircle(x + col.x * c + col.z * s, z - col.x * s + col.z * c, col.r, 'facility');
    }
    const item = { prop, x, z, small: !!o.small, far: o.far || 0 };
    items.push(item);
    return item;
  }
  // World position of a prop-local anchor.
  const anchorOf = (prop, a, out = new THREE.Vector3()) => out.copy(a).applyAxisAngle(THREE.Object3D.DEFAULT_UP, prop.group.rotation.y).add(prop.group.position);

  // ------------------------------------------------------------------ the substation bays
  // Six bays stand shoulder to shoulder along the west edge, each turned a quarter turn: a bay is
  // built side by side along its own x, so local +x runs along world -z (the row) and local +z
  // points east at the field. Together they are the wall.
  const BAY_W = 8;
  const BAY_D = 5;
  const BAY_N = 6;
  const BAY_STEP = 8.1;
  const bays = [];
  for (let i = 0; i < BAY_N; i++) {
    const z = S.z + (i - (BAY_N - 1) / 2) * BAY_STEP;
    const prop = artProp('createSubstationBay', { w: BAY_W, d: BAY_D, scale: 1, seed: i + 1 }) || standInBay({ w: BAY_W, d: BAY_D, scale: 1 });
    put(prop, S.bayX, z, Math.PI / 2);
    bays.push(prop);
  }

  // ------------------------------------------------------------------ pylons, behind and beside
  // Two stand just inside the fence, right over the new graves. Two stand back for depth.
  const pylons = [];
  for (const [px, pz, ph] of [[S.bayX + 6.5, A.z + A.step * 1.5, 15], [S.bayX + 6.5, S.z + 14, 13], [S.bayX - 5, S.z - 25, 18], [S.bayX - 5, S.z + 25, 16]]) {
    const prop = artProp('createPylon', { height: ph, scale: 1 }) || standInPylon({ height: ph, scale: 1 });
    put(prop, px, pz, pz < S.z ? 0.1 : -0.08);
    pylons.push(prop);
  }

  // ------------------------------------------------------------------ wires
  // One run per phase along the whole row of bays, plus the transmission line crossing the yard
  // between the two back pylons. The art builder takes a LIST of runs and merges the lot into one
  // mesh, and its `sag` is a fraction of each span, so one number suits a 8 m gap and a 50 m one.
  const SAG = 0.045;
  let wireMesh = null;
  const wireProps = [];
  {
    const anchorsOf = (prop) => ((prop && prop.anchors && prop.anchors.wireTops) || []).map((v) => anchorOf(prop, v));
    const tops = bays.map(anchorsOf);
    const runs = [];
    const lanes = tops.length ? Math.min(...tops.map((t) => t.length)) : 0;
    for (let k = 0; k < lanes; k++) runs.push(tops.map((t) => t[k]));
    const back = [anchorsOf(pylons[2]), anchorsOf(pylons[3])];
    for (let k = 0; k < Math.min(back[0].length, back[1].length); k++) runs.push([back[0][k], back[1][k]]);
    const live = runs.filter((r) => r.length > 1 && r.every(Boolean));
    const prop = live.length ? artProp('createSubstationWires', live.map((r) => r.map((p) => p.clone())), { sag: SAG }) : null;
    if (prop && prop.group) {
      group.add(prop.group);
      wireProps.push(prop);
    } else if (live.length) {
      // stand-in: the same parabolas, merged by hand
      const g = new Geo();
      for (const run of live) {
        for (let i = 0; i < run.length - 1; i++) {
          const a = run[i];
          const b = run[i + 1];
          const dip = a.distanceTo(b) * SAG;
          const pts = [];
          for (let k = 0; k <= 4; k++) {
            const u = k / 4;
            pts.push([a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u - dip * 4 * u * (1 - u), a.z + (b.z - a.z) * u]);
          }
          g.tube(pts, 0.045, WIRE, { seg: 3 });
        }
      }
      wireMesh = g.mesh(flatMat);
      wireMesh.name = 'substationWires';
      wireMesh.matrixAutoUpdate = false;
      group.add(wireMesh);
    }
  }

  // ------------------------------------------------------------------ the fence along the front
  // One run north to south at fenceX, facing the field, in pieces so no builder has to make a
  // single 48 m length. One box collider stands in for every post.
  {
    const total = S.z1 - S.z0 - 3;
    const count = Math.max(1, Math.round(total / 18));
    const len = total / count;
    for (let i = 0; i < count; i++) {
      const z = S.z0 + 1.5 + len * (i + 0.5);
      const prop = artProp('createSubstationFence', { length: len, scale: 1 }) || standInFence({ length: len, scale: 1 });
      put(prop, S.fenceX, z, Math.PI / 2, { solid: false });
    }
    const backX = Math.min(S.x - S.w / 2, -82); // well past the world edge, so nobody rounds the back of the yard
    colliders.addBox(S.fenceX, (S.z0 + S.z1) / 2, 0.5, total, 0, 'facility');
    colliders.addBox((S.fenceX + backX) / 2, S.z0 + 1.5, S.fenceX - backX, 0.5, 0, 'facility');
    colliders.addBox((S.fenceX + backX) / 2, S.z1 - 1.5, S.fenceX - backX, 0.5, 0, 'facility');
    // The two end colliders above reach past the world edge so the yard cannot be walked into
    // from behind. Draw fence across the part a player can actually reach, or they stop dead
    // in open grass with nothing to see.
    const endTo = layout.bounds.minX + 0.5;
    const endLen = S.fenceX - endTo;
    for (const z of [S.z0 + 1.5, S.z1 - 1.5]) {
      const prop = artProp('createSubstationFence', { length: endLen, scale: 1 }) || standInFence({ length: endLen, scale: 1 });
      put(prop, (S.fenceX + endTo) / 2, z, 0, { solid: false, y: S.y });
    }
  }

  // ------------------------------------------------------------------ ground: turf, lines, path
  // Everything flat is one vertex-colored mesh: the field and its markings, the gravel apron in
  // front of the fence, and the path out to the new section of the Memorial Gardens.
  {
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    const quad = (x0, z0, x1, z1, y, hex) => {
      c.set(hex);
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
    };
    const strip = (ax, az, bx, bz, half, y, hex) => {
      const dx = bx - ax;
      const dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const ox = (-dz / l) * half;
      const oz = (dx / l) * half;
      c.set(hex);
      pos.push(ax - ox, y, az - oz, bx - ox, y, bz - oz, bx + ox, y, bz + oz);
      pos.push(ax - ox, y, az - oz, bx + ox, y, bz + oz, ax + ox, y, az + oz);
      for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
    };
    const YD = 0.9144;
    let i = 0;
    for (let z = fz0; z < fz1 - 0.01; z += 5 * YD, i++) quad(fx0, z, fx1, Math.min(fz1, z + 5 * YD), Y + 0.045, i % 2 ? TURF_A : TURF_B);
    for (let k = 0; k < 9; k++) {
      const z = fz0 + 2.2 + k * 4.5;
      if (z > fz1 - 1.2) break;
      quad(fx0 + 0.5, z - 0.07, fx1 - 0.5, z + 0.07, Y + 0.06, CHALK);
      for (const hx of [F.x - 2.4, F.x + 2.4]) quad(hx - 0.32, z + 2.18, hx + 0.32, z + 2.32, Y + 0.062, CHALK);
    }
    quad(fx0 + 0.32, fz0 + 0.5, fx0 + 0.48, fz1 - 0.5, Y + 0.06, CHALK);
    quad(fx1 - 0.48, fz0 + 0.5, fx1 - 0.32, fz1 - 0.5, Y + 0.06, CHALK);
    quad(S.fenceX + 0.35, S.z0 + 1.6, fx0 - 0.7, S.z1 - 1.6, Y + 0.04, GRAVEL);
    const path = [[-38.6, 14.5], [-40.3, 4.6], [-54.2, 3.9], [-54.2, A.z + A.step * (A.count - 1) + 2.6]];
    for (let k = 0; k < path.length - 1; k++) strip(path[k][0], path[k][1], path[k + 1][0], path[k + 1][1], 0.85, Y + 0.05, GRAVEL);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -3 }));
    ground.name = 'facilityGround';
    ground.matrixAutoUpdate = false;
    group.add(ground);
  }

  // ------------------------------------------------------------------ field furniture
  // Two blocking sleds and a row of dummies in one mesh, the water cart in another.
  {
    const g = new Geo({ jit: 0.05 });
    const sled = (x, z, yaw) => {
      g.at(x, terrain.heightAt(x, z), z, yaw);
      g.box(0, 0, 0, 2.4, 0.18, 1.6, STEEL_DK);
      for (let k = 0; k < 3; k++) {
        g.box(-0.8 + k * 0.8, 0.18, -0.4, 0.62, 1.45, 0.42, 0xd7263d);
        g.box(-0.8 + k * 0.8, 1.63, -0.42, 0.66, 0.16, 0.5, 0x23262e);
      }
      g.box(0, 0.55, 0.5, 2.3, 0.14, 0.14, STEEL);
      g.restore();
      colliders.addCircle(x, z, 1.25, 'facility');
    };
    // Kept clear of the drill's run box (see RUN in catch.js): the receiver is driven by
    // setSeat, which ignores colliders, so anything inside that box gets walked through.
    sled(fx0 + 3.0, fz1 - 1.6, 0.18);
    sled(fx1 - 3.2, fz1 - 1.5, -0.26);
    for (let k = 0; k < 4; k++) {
      const x = fx0 + 0.55;
      const z = fz0 + 11 + k * 3.4;
      g.at(x, terrain.heightAt(x, z), z, k * 0.7);
      g.cyl(0, 0, 0, 0.42, 0.14, 0x23262e, { seg: 7 });
      g.cyl(0, 0.14, 0, 0.3, 1.5, k % 2 ? 0xff6a3d : 0xf5c542, { seg: 7 });
      g.sphere(0, 1.78, 0, 0.29, 0x23262e, { seg: 7, rings: 4 });
      g.restore();
      colliders.addCircle(x, z, 0.42, 'facility');
    }
    const mesh = g.mesh(flatMat);
    mesh.name = 'fieldSleds';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    items.push({ prop: { group: mesh }, x: F.x, z: fz1 - 6, small: true, far: SMALL_FAR });
  }
  {
    const g = new Geo({ jit: 0.04 });
    const x = fx1 - 1.9;
    const z = fz0 + 6.5;
    g.at(x, terrain.heightAt(x, z), z, -0.4);
    for (const [cx, cz] of [[-0.6, -0.44], [0.6, -0.44], [-0.6, 0.44], [0.6, 0.44]]) g.cyl(cx + 0.05, 0.1, cz, 0.24, 0.1, 0x23262e, { seg: 7, rz: Math.PI / 2 });
    g.box(0, 0.34, 0, 1.6, 0.12, 1.0, STEEL_DK);
    g.cyl(-0.36, 0.46, 0, 0.32, 0.72, 0xf3eedd, { seg: 8 });
    g.cyl(0.36, 0.46, 0, 0.32, 0.72, 0xf3eedd, { seg: 8 });
    for (let k = 0; k < 6; k++) g.cyl(-0.5 + k * 0.2, 1.18, 0.1, 0.05, 0.2, 0xff6a3d, { seg: 5 });
    g.box(0, 0.46, -0.62, 1.2, 0.5, 0.06, 0x2a3350);
    g.restore();
    colliders.addCircle(x, z, 0.95, 'facility');
    const mesh = g.mesh(flatMat);
    mesh.name = 'waterCart';
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    items.push({ prop: { group: mesh }, x, z, small: true, far: SMALL_FAR });
  }

  // ------------------------------------------------------------------ the ball machine
  const machineProp = artProp('createBallMachine', { scale: 1 }) || standInBallMachine({ scale: 1 });
  const MX = F.machine[0];
  const MZ = F.machine[1];
  put(machineProp, MX, MZ, 0, { small: true, far: SMALL_FAR }); // facing 0: it fires south, down the field
  const machine = {
    group: machineProp.group,
    x: MX,
    z: MZ,
    y: terrain.heightAt(MX, MZ),
    facing: 0,
    radius: machineProp.radius || 0.85,
    muzzle: machineProp.anchors && machineProp.anchors.muzzle
      ? anchorOf(machineProp, machineProp.anchors.muzzle)
      : new THREE.Vector3(MX, terrain.heightAt(MX, MZ) + 1.15, MZ + 0.8),
  };

  // ------------------------------------------------------------------ signs
  // Two meshes each: a merged post and frame, and the printed face.
  function makeSign(lines, wd, ht, x, z, facing, bg) {
    const draw = (ls) => drawSign(ls, wd / ht, { height: 192, bg, color: '#ffffff', borderColor: '#f5c542', subBody: true });
    const tex = boardTexture(draw(lines));
    const y = terrain.heightAt(x, z);
    const g = new Geo();
    g.at(x, y, z, facing);
    g.box(0, 0, -0.07, 0.13, 1.4 + ht / 2, 0.13, 0x18213f); // behind the face, or it splits the text
    g.box(0, 1.4, -0.03, wd + 0.12, ht + 0.14, 0.09, 0x18213f);
    g.restore();
    const frame = g.mesh(flatMat);
    frame.name = 'facilitySignPost';
    frame.matrixAutoUpdate = false;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), new THREE.MeshLambertMaterial({ map: tex }));
    face.position.set(x + Math.sin(facing) * 0.055, y + 1.47 + ht / 2, z + Math.cos(facing) * 0.055);
    face.rotation.y = facing;
    group.add(frame, face);
    colliders.addCircle(x, z, 0.26, 'facility');
    items.push({ prop: { group: frame }, x, z, small: true, far: SMALL_FAR }, { prop: { group: face }, x, z, small: true, far: SMALL_FAR });
    return { redraw(ls) { tex.image = draw(ls); tex.needsUpdate = true; } };
  }
  const bestSign = makeSign(['CATCHING DRILL', 'Best: none yet'], 2.5, 1.15, fx1 + 1.0, MZ + 2.4, -Math.PI / 2 + 0.3, '#14553c');
  makeSign(['DANGER  HIGH VOLTAGE', 'Draft picks rest here'], 2.3, 1.05, S.fenceX + 0.5, A.z - 2.6, Math.PI / 2, '#7a2318');

  // ------------------------------------------------------------------ where visitors stand
  const place = { x: F.x + 2.2, z: MZ + 3.4, facing: Math.PI };
  const sight = { x: fx0 - 1.8, z: A.z + A.step * 1.5, facing: -Math.PI / 2 };

  function update(dt, t) {
    cam.copy(w.engine.camera.position);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const dx = it.x - cam.x;
      const dz = it.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (it.small) {
        const show = d2 < it.far * it.far;
        if (it.prop.group.visible !== show) it.prop.group.visible = show;
        if (!show) continue;
      }
      if (it.prop.update && d2 < SMALL_FAR * SMALL_FAR) it.prop.update(dt, t);
    }
    const dx = S.x - cam.x;
    const dz = S.z - cam.z;
    const near = dx * dx + dz * dz < WIRE_FAR * WIRE_FAR;
    if (wireMesh && wireMesh.visible !== near) wireMesh.visible = near;
    for (const p of wireProps) {
      if (p.group.visible !== near) p.group.visible = near;
      if (near && p.update) p.update(dt, t);
    }
  }

  // The yard hums. Registered once; the audio module builds the nodes when the visitor is close
  // enough to hear it, and gives them back when they walk away or turn the sound off.
  if (audio && typeof audio.drone === 'function') {
    audio.drone('substation', {
      position: { x: S.fenceX - 4, z: (S.z0 + S.z1) / 2 },
      falloff: 16,
      range: 55, // a transformer is loud up close and gone by the boulevard
      volume: 0.85,
    });
  }

  return {
    group,
    update,
    place,
    sight,
    field,
    machine,
    // the machine's wheels wind up before a throw
    spinMachine(v) {
      if (typeof machineProp.setSpeed === 'function') machineProp.setSpeed(v);
    },
    setBest(n) {
      bestSign.redraw(['CATCHING DRILL', n > 0 ? 'Best: ' + n + (n === 1 ? ' catch' : ' catches') : 'Best: none yet']);
    },
    // tests and the console: true once art/facility.js is in the art index
    get usingArt() { return typeof ART.createSubstationBay === 'function'; },
  };
}
