// Critters: raccoons, seagulls, dogs, pigeons and flies.
// Each group is ONE InstancedMesh (plus one for blob shadows, or wings for gulls) and wanders by
// itself inside `radius` around the group origin. All state lives in typed arrays.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU } from './geo.js';
import { flatMat, blobMat } from './materials.js';
import { rng, motion, makeProp, getBlobGeo } from './util.js';
import { drawPigeon } from './parts.js';

const _o = new THREE.Object3D();
function put(mesh, i, x, y, z, yaw, pitch, roll, sx, sy, sz) {
  _o.position.set(x, y, z);
  _o.rotation.set(pitch, yaw, roll, 'YXZ');
  _o.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
  _o.updateMatrix();
  _o.matrix.toArray(mesh.instanceMatrix.array, i * 16);
}

const geos = {};
function geoFor(kind) {
  if (geos[kind]) return geos[kind];
  const g = new Geo();
  if (kind === 'raccoon') {
    const grey = 0x8b9098, dk = 0x34373e, lt = 0xdcdfe2;
    g.sphere(0, 0.21, -0.02, 0.17, grey, { seg: 6, rings: 4, sz: 1.75, sy: 0.95 });
    g.sphere(0, 0.14, -0.02, 0.14, lt, { seg: 5, rings: 3, sz: 1.5, sy: 0.6 });
    g.sphere(0, 0.29, 0.3, 0.135, grey, { seg: 6, rings: 3, sz: 1.05 });
    g.box(0, 0.262, 0.385, 0.25, 0.07, 0.09, dk, { bottom: true });
    for (const sx of [-1, 1]) {
      g.box(sx * 0.06, 0.28, 0.432, 0.035, 0.035, 0.01, 0xffffff, { bottom: true });
      g.cone(sx * 0.095, 0.38, 0.27, 0.05, 0.1, dk, { seg: 3 });
      g.box(sx * 0.1, 0, 0.16, 0.07, 0.12, 0.08, dk, { noTop: true });
      g.box(sx * 0.1, 0, -0.2, 0.07, 0.12, 0.08, dk, { noTop: true });
    }
    g.cone(0, 0.255, 0.4, 0.06, 0.12, lt, { seg: 4, rx: Math.PI / 2 });
    g.box(0, 0.24, 0.5, 0.04, 0.04, 0.04, dk, { bottom: true });
    const tail = [[0, 0.24, -0.3], [0, 0.3, -0.42], [0, 0.4, -0.52], [0, 0.52, -0.58], [0, 0.63, -0.58]];
    for (let i = 0; i < 4; i++) g.tube([tail[i], tail[i + 1]], 0.075 - i * 0.008, i % 2 ? dk : grey, { seg: 5, caps: i === 3 });
  } else if (kind === 'dog') {
    const tan = 0xc98f52, dk = 0x7a4f2c, wh = 0xf1e6d2;
    g.cloft(0, 0.36, -0.3, [[0, 0.2, 0.2, 0.06], [0.3, 0.26, 0.26, 0.07], [0.6, 0.24, 0.26, 0.07]], tan, { rx: Math.PI / 2, capBot: true });
    g.box(0, 0.24, 0.26, 0.2, 0.1, 0.1, wh, { bottom: true });
    g.cloft(0, 0.4, 0.3, [[0, 0.2, 0.2, 0.05], [0.16, 0.24, 0.24, 0.07], [0.3, 0.2, 0.2, 0.07]], tan, {});
    g.box(0, 0.44, 0.44, 0.13, 0.11, 0.16, wh, { bottom: true });
    g.box(0, 0.51, 0.52, 0.06, 0.05, 0.04, 0x2a2622, { bottom: true });
    for (const sx of [-1, 1]) {
      g.box(sx * 0.13, 0.5, 0.3, 0.05, 0.2, 0.12, dk, { rz: sx * -0.25, bottom: true });
      g.box(sx * 0.07, 0.585, 0.423, 0.035, 0.04, 0.01, 0x2a2622, { bottom: true });
      g.box(sx * 0.09, 0, 0.2, 0.075, 0.28, 0.085, tan, { noTop: true });
      g.box(sx * 0.09, 0, -0.22, 0.075, 0.28, 0.085, tan, { noTop: true });
      g.box(sx * 0.09, 0, 0.215, 0.08, 0.06, 0.1, wh, { noTop: true });
      g.box(sx * 0.09, 0, -0.205, 0.08, 0.06, 0.1, wh, { noTop: true });
    }
    g.box(0, 0.42, -0.3, 0.06, 0.26, 0.06, dk, { rx: -0.7, tx: 0.5, tz: 0.5 });
  } else if (kind === 'pigeon') {
    drawPigeon(g, 0, 0, 0, 1.25, 0, 0);
  } else if (kind === 'seagull') {
    const wh = 0xf4f5f2, gr = 0xaeb8c2;
    g.sphere(0, 0, 0, 0.13, wh, { seg: 6, rings: 3, sz: 2.2, sy: 0.9 });
    g.sphere(0, 0.06, 0.27, 0.085, wh, { seg: 5, rings: 3 });
    g.cone(0, 0.05, 0.34, 0.035, 0.13, 0xf2a53a, { seg: 4, rx: Math.PI / 2 });
    g.tri2([-0.1, 0.02, -0.24], [0.1, 0.02, -0.24], [0, 0.02, -0.46], gr);
    g.quad([-0.09, 0.118, -0.2], [0.09, 0.118, -0.2], [0.07, 0.118, 0.12], [-0.07, 0.118, 0.12], gr);
  } else if (kind === 'seagullWing') {
    const gr = 0xaeb8c2, dk = 0x33363d;
    for (const sx of [-1, 1]) {
      g.quad2([sx * 0.06, 0, -0.12], [sx * 0.06, 0, 0.14], [sx * 0.5, 0.2, 0.1], [sx * 0.5, 0.2, -0.12], gr, 0xf4f5f2);
      g.quad2([sx * 0.5, 0.2, -0.12], [sx * 0.5, 0.2, 0.1], [sx * 0.92, 0.24, -0.02], [sx * 0.86, 0.24, -0.14], dk, 0xdfe3e6);
    }
  } else if (kind === 'fly') {
    g.sphere(0, 0, 0, 0.028, 0x1c1d22, { seg: 4, rings: 2, sz: 1.5 });
    g.tri2([0, 0.01, 0], [0.06, 0.03, -0.02], [0.03, 0.03, 0.03], 0xb9c7d6).tri2([0, 0.01, 0], [-0.03, 0.03, 0.03], [-0.06, 0.03, -0.02], 0xb9c7d6);
  }
  const geo = g.build();
  geo.userData.shared = true;
  geo.userData.tris = g.tris;
  geos[kind] = geo;
  return geo;
}

function instanced(geo, mat, count, radius, y) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, y, 0), radius + 2);
  return m;
}

// A tight buzzing cloud of flies. Used on its own and by smelly props.
export function makeFlySwarm(count, radius = 0.5, height = 1.0, seed = 1) {
  const r = rng(seed * 31 + 9);
  const mesh = instanced(geoFor('fly'), flatMat, count, radius, height);
  mesh.name = 'flies';
  const k = new Float32Array(count * 6);
  for (let i = 0; i < k.length; i++) k[i] = r();
  return {
    mesh,
    update(dt, t) {
      const m = 0.3 + 0.7 * motion();
      for (let i = 0; i < count; i++) {
        const o = i * 6, a = t * (2.2 + k[o] * 2.5) * m + k[o + 1] * TAU, b = t * (1.7 + k[o + 2] * 2.2) * m + k[o + 3] * TAU, c = t * (3.1 + k[o + 4] * 2) * m;
        const rr = radius * (0.45 + 0.55 * k[o + 5]);
        const x = Math.sin(a) * rr + Math.sin(c * 1.7) * 0.06, z = Math.cos(b) * rr + Math.cos(c * 1.3) * 0.06;
        const y = height + Math.sin(a * 0.7 + b) * radius * 0.5;
        put(mesh, i, x, y, z, a + Math.PI / 2, 0, 0, 1);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// Run one zero-length step so instances are placed even before the first world update.
function started(prop) { prop.update(0, 0); return prop; }

const WALK = {
  raccoon: { speed: 1.9, pause: [0.8, 2.6], bob: 0.035, step: 11, sit: -0.6, blob: [0.22, 0.34], scale: 1.15, fly: 0 },
  dog: { speed: 1.5, pause: [1.5, 4.5], bob: 0.03, step: 9, sit: -0.5, blob: [0.24, 0.42], scale: 1.1, fly: 0 },
  pigeon: { speed: 0.5, pause: [1.2, 3.5], bob: 0.012, step: 14, sit: 0, blob: [0.13, 0.17], scale: 1, fly: 0.3 },
};

export function createCritters(kind, { count = 4, radius = 4, seed = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'critters-' + kind;
  const r = rng(seed * 101 + kind.length * 7), N = Math.max(1, Math.min(64, count | 0));

  if (kind === 'fly') {
    const swarm = makeFlySwarm(N, Math.min(radius, 3), 1.1, seed);
    group.add(swarm.mesh);
    swarm.update(0, 0);
    return makeProp(group, [swarm.mesh], swarm.update, { kind, count: N });
  }

  if (kind === 'seagull') {
    const body = instanced(geoFor('seagull'), flatMat, N, radius + 4, 8), wings = instanced(geoFor('seagullWing'), flatMat, N, radius + 4, 8);
    body.name = 'gulls'; wings.name = 'gull-wings';
    group.add(body, wings);
    const ownGulls = [body, wings];
    const ang = new Float32Array(N), w = new Float32Array(N), orb = new Float32Array(N), h = new Float32Array(N), dip = new Float32Array(N), next = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      ang[i] = r() * TAU; w[i] = (0.28 + r() * 0.25) * (r() < 0.5 ? -1 : 1); orb[i] = radius * (0.45 + 0.55 * r()); h[i] = 6 + r() * 4; dip[i] = -1; next[i] = 3 + r() * 9;
    }
    return started(makeProp(group, ownGulls, (dt, t) => {
      const m = motion();
      for (let i = 0; i < N; i++) {
        ang[i] += w[i] * dt;
        next[i] -= dt;
        if (next[i] <= 0 && dip[i] < 0) { dip[i] = 0; next[i] = 7 + r() * 10; }
        let d = 0;
        if (dip[i] >= 0) { dip[i] += dt / 2.6; if (dip[i] >= 1) dip[i] = -1; else d = Math.sin(dip[i] * Math.PI); }
        const x = Math.cos(ang[i]) * orb[i], z = Math.sin(ang[i]) * orb[i];
        const y = h[i] - d * 3.4 * (0.4 + 0.6 * m) + Math.sin(t * 0.7 + i) * 0.3 * m;
        const yaw = w[i] > 0 ? -ang[i] : Math.PI - ang[i], roll = (w[i] > 0 ? 0.32 : -0.32);
        const flap = d > 0.05 ? Math.cos(t * 13 + i) * (0.4 + 0.6 * m) : 0.72 + 0.14 * Math.sin(t * 1.9 + i * 2);
        put(body, i, x, y, z, yaw, d * 0.35, roll, 1.3);
        put(wings, i, x, y, z, yaw, d * 0.35, roll, 1.3, 1.3 * flap, 1.3);
      }
      body.instanceMatrix.needsUpdate = true; wings.instanceMatrix.needsUpdate = true;
    }, { kind, count: N }));
  }

  const cfg = WALK[kind] || WALK.pigeon;
  const body = instanced(geoFor(WALK[kind] ? kind : 'pigeon'), flatMat, N, radius, 0.5);
  const blobs = instanced(getBlobGeo(), blobMat, N, radius, 0);
  body.name = kind + 's'; blobs.name = 'blobs'; blobs.renderOrder = 1;
  group.add(blobs, body);
  const x = new Float32Array(N), z = new Float32Array(N), hd = new Float32Array(N), tx = new Float32Array(N), tz = new Float32Array(N);
  const timer = new Float32Array(N), ph = new Float32Array(N), sit = new Float32Array(N), air = new Float32Array(N), mode = new Uint8Array(N);
  const pickTarget = (i, far) => {
    const a = r() * TAU, d = Math.sqrt(r()) * radius * (far ? 1 : 0.9);
    tx[i] = Math.cos(a) * d; tz[i] = Math.sin(a) * d;
  };
  for (let i = 0; i < N; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * radius;
    x[i] = Math.cos(a) * d; z[i] = Math.sin(a) * d; hd[i] = r() * TAU; ph[i] = r() * 10;
    mode[i] = r() < 0.5 ? 0 : 1; timer[i] = r() * 2; pickTarget(i);
  }
  return started(makeProp(group, [body, blobs], (dt, t) => {
    const m = motion();
    for (let i = 0; i < N; i++) {
      let y = 0, pitch = 0, roll = 0;
      if (mode[i] === 1) {
        // paused: sit, peck or look around
        timer[i] -= dt;
        sit[i] += (1 - sit[i]) * Math.min(1, dt * 6);
        if (kind === 'pigeon') pitch = Math.max(0, Math.sin(t * 6 + i * 2.3)) * 0.75;
        else if (kind === 'dog') roll = Math.sin(t * 11 + i) * 0.05 * m;
        else hd[i] += Math.sin(t * 1.3 + i * 4) * dt * 0.9;
        if (timer[i] <= 0) { mode[i] = cfg.fly && r() < cfg.fly ? 2 : 0; air[i] = 0; pickTarget(i, mode[i] === 2); }
      } else {
        const fly = mode[i] === 2, dx = tx[i] - x[i], dz = tz[i] - z[i], d = Math.hypot(dx, dz);
        sit[i] += (0 - sit[i]) * Math.min(1, dt * 8);
        if (d < 0.15) { mode[i] = 1; timer[i] = cfg.pause[0] + r() * (cfg.pause[1] - cfg.pause[0]); } else {
          let da = Math.atan2(dx, dz) - hd[i];
          while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
          hd[i] += da * Math.min(1, dt * 7);
          const sp = Math.min((fly ? 3.4 : cfg.speed) * dt, d);
          x[i] += Math.sin(hd[i]) * sp; z[i] += Math.cos(hd[i]) * sp;
          ph[i] += dt * cfg.step;
          if (fly) {
            air[i] = Math.min(1, air[i] + dt * 2.5);
            y = Math.min(1, d * 0.8) * air[i] * 1.1;
            roll = Math.sin(t * 34 + i) * 0.5 * (0.3 + 0.7 * m); pitch = -0.3;
          } else {
            y = Math.abs(Math.sin(ph[i])) * cfg.bob * m;
            roll = Math.sin(ph[i]) * 0.07 * m;
          }
        }
      }
      const s = cfg.scale;
      put(body, i, x[i], y + sit[i] * (cfg.sit ? 0.1 : 0), z[i], hd[i], pitch + sit[i] * cfg.sit, roll, s);
      const k = 1 - Math.min(0.6, y * 0.5);
      put(blobs, i, x[i], 0.03, z[i], hd[i], 0, 0, cfg.blob[0] * s * k, 1, cfg.blob[1] * s * k);
    }
    body.instanceMatrix.needsUpdate = true; blobs.instanceMatrix.needsUpdate = true;
  }, { kind, count: N }));
}
