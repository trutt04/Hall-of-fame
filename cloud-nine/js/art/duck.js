// The duck pond's ducks, in the house style: chunky low-poly bodies with flat-shaded vertex colours,
// a pink blush and a shiny eye. One InstancedMesh per kind of duck, so the whole flock is 3 draw calls:
//   'hen'       the mama duck (and the white duck: the same shape, tinted by its instance colour)
//   'drake'     the mallard drake: green head, white collar, chestnut chest
//   'duckling'  a fluffy yellow duckling, modelled at grown-up size and drawn at about 0.45 scale
// Each duck faces +Z and floats with its waterline at y = 0. Under 300 triangles each.
//
// Wings and heads move without bones: every vertex carries `aPart` (0 body, 1 left wing, -1 right
// wing, 2 head) and every duck an `aAnim` (left wing lift, right wing lift, head pitch, head yaw,
// in radians); a few lines in the vertex shader turn the parts about their hinges. So a duck can
// flap, preen and dabble while the flock stays one draw call per kind.
//
//   import { createDuckMeshes, DUCK_KINDS, duckTriangles } from './art/duck.js'
//   const flock = createDuckMeshes({ hen: 2, drake: 1, duckling: 4 })
//   flock.meshes                     { hen, drake, duckling }: THREE.InstancedMesh each (add to a group)
//   flock.set(kind, i, x, y, z, yaw, pitch, roll, scale, wingL, wingR, headPitch, headYaw)
//                                    one duck's pose this frame (nothing allocated)
//   flock.tint(kind, i, hex)         its instance colour (the white duck is a white hen)
//   flock.commit()                   after the frame's set() calls
//   flock.setBounds(x, y, z, r)      the sphere every duck stays inside (for frustum culling)
//   flock.dispose()
//   DUCK_KINDS = ['hen', 'drake', 'duckling'];  duckTriangles(kind) -> triangles in one duck

import * as THREE from '../../lib/three.module.min.js';
import { Geo } from './geo.js';

export const DUCK_KINDS = Object.freeze(['hen', 'drake', 'duckling']);

// the hinges the shader turns parts about (the same in every kind's model)
const NECK = [0, 0.2, 0.15];
const WING_X = 0.105;
const WING_Y = 0.17;

const COL = {
  hen: { body: 0xffffff, back: 0xf3eee8, wing: 0xece4dc, tip: 0xd9cfc6, head: 0xffffff, bill: 0xffb347, eye: 0x17121c, blush: 0xffb0d0 },
  drake: { body: 0xe6e3ec, back: 0xcfcad8, wing: 0xb9b2c4, tip: 0x5a77d6, chest: 0xc98763, head: 0x3fae7a, ring: 0xffffff, bill: 0xffd24a, eye: 0x17121c, blush: 0xff9cc3, tail: 0x3a3442 },
  duckling: { body: 0xffe066, belly: 0xfff1a8, wing: 0xffd23f, head: 0xffe880, bill: 0xffa53a, eye: 0x17121c, blush: 0xff9cc3 },
};

// A little flat oval facing +Z of the current transform (eyes, shines, blush).
function dot(g, x, y, z, rx, ry, hex, yaw, seg = 5) {
  g.at(x, y, z, yaw, 0, 0);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    g.tri([0, 0, 0], [Math.cos(a0) * rx, Math.sin(a0) * ry, 0], [Math.cos(a1) * rx, Math.sin(a1) * ry, 0], hex);
  }
  g.restore();
}

// part ranges: [fromTri, toTri, part]
function buildGeometry(kind) {
  const g = new Geo();
  g.jit = 0.035;
  const parts = [];
  let rs = 11;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const part = (id, fn) => {
    const a = g.tris;
    fn();
    parts.push([a, g.tris, id]);
  };
  const C = COL[kind];
  if (kind === 'duckling') {
    part(0, () => {
      g.ico(0, 0.13, -0.02, 0.2, C.body, { detail: 1, sx: 0.95, sy: 0.82, sz: 1.08, jitter: 0.05, rnd });
      g.ico(0, 0.1, 0.07, 0.13, C.belly, { sx: 1.1, sy: 0.8, jitter: 0.04, rnd });
      g.cone(0, 0.18, -0.2, 0.06, 0.12, C.body, { seg: 5, rx: -1.0 }); // a fluffy tail tuft
    });
    for (const side of [1, -1]) {
      part(side, () => g.ico(side * 0.17, 0.15, -0.03, 0.09, C.wing, { sx: 0.45, sy: 0.7, sz: 1.2, rz: side * 0.3 }));
    }
    part(2, () => {
      g.ico(0, 0.37, 0.13, 0.16, C.head, { detail: 1, sy: 0.95, jitter: 0.03, rnd });
      g.ico(0, 0.52, 0.11, 0.05, C.head, { sx: 0.6, sy: 1.3, rz: 0.3 }); // a tuft on top
      g.box(0, 0.33, 0.27, 0.11, 0.045, 0.1, C.bill, { tx: 0.75, tz: 0.7, bottom: true });
      for (const side of [1, -1]) {
        dot(g, side * 0.105, 0.4, 0.245, 0.03, 0.036, C.eye, side * 0.55);
        dot(g, side * 0.112, 0.415, 0.252, 0.011, 0.011, 0xffffff, side * 0.55, 3);
        dot(g, side * 0.13, 0.335, 0.215, 0.032, 0.02, C.blush, side * 0.75);
      }
    });
  } else {
    const drake = kind === 'drake';
    part(0, () => {
      g.ico(0, 0.11, -0.02, 0.2, C.body, { detail: 1, sx: 0.85, sy: 0.62, sz: 1.35, jitter: 0.04, rnd });
      g.ico(0, 0.16, -0.06, 0.15, C.back, { sx: 0.9, sy: 0.5, sz: 1.2, jitter: 0.04, rnd });
      if (drake) g.ico(0, 0.12, 0.16, 0.12, C.chest, { sx: 1.05, sy: 0.9, sz: 0.8, jitter: 0.03, rnd });
      g.cone(0, 0.13, -0.27, 0.07, 0.15, drake ? C.tail : C.back, { seg: 5, rx: -1.1 });
      if (drake) g.cone(0, 0.24, -0.36, 0.02, 0.07, C.tail, { seg: 4, rx: 0.6 }); // the curly tail feather
    });
    for (const side of [1, -1]) {
      part(side, () => {
        g.ico(side * 0.15, 0.15, -0.05, 0.12, C.wing, { sx: 0.35, sy: 0.5, sz: 1.25, rz: side * 0.25 });
        g.ico(side * 0.16, 0.16, -0.1, 0.06, C.tip || C.wing, { sx: 0.4, sy: 0.5, sz: 1.1, rz: side * 0.25 });
      });
    }
    part(2, () => {
      g.cyl(0, 0.13, 0.17, 0.075, 0.16, drake ? C.head : C.head, { seg: 6, rt: 0.065, top: false, rx: 0.25 });
      if (drake) {
        g.at(0, 0.25, 0.2, 0, 0.25, 0);
        g.band(0.07, 0, 0.068, 0.022, 8, 0, C.ring);
        g.restore();
      }
      g.ico(0, 0.34, 0.2, 0.115, C.head, { detail: 1, sx: 0.92, sz: 1.08, jitter: 0.03, rnd });
      g.box(0, 0.3, 0.315, 0.095, 0.04, 0.13, C.bill, { tx: 0.8, tz: 0.85, bottom: true });
      for (const side of [1, -1]) {
        dot(g, side * 0.075, 0.37, 0.285, 0.022, 0.026, C.eye, side * 0.6);
        dot(g, side * 0.081, 0.381, 0.29, 0.008, 0.008, 0xffffff, side * 0.6, 3);
        dot(g, side * 0.095, 0.315, 0.262, 0.024, 0.015, C.blush, side * 0.8);
      }
    });
  }
  const geo = g.build();
  const n = g.p.length / 3;
  const ids = new Float32Array(n);
  for (const [a, b, id] of parts) for (let v = a * 3; v < b * 3; v++) ids[v] = id;
  geo.setAttribute('aPart', new THREE.BufferAttribute(ids, 1));
  return { geo, triangles: g.tris };
}

const TRIS = {};
export function duckTriangles(kind) {
  if (!(kind in TRIS)) {
    const b = buildGeometry(kind);
    TRIS[kind] = b.triangles;
    b.geo.dispose();
  }
  return TRIS[kind];
}

const v3 = (a) => 'vec3(' + a.map((n) => n.toFixed(3)).join(', ') + ')';
let material = null;
function duckMaterial() {
  if (material) return material;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.name = 'c9-duck';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nattribute vec4 aAnim;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'if (aPart > 1.5) {',
        '  vec3 q = transformed - ' + v3(NECK) + ';',
        '  float cp = cos(aAnim.z); float sp = sin(aAnim.z);',
        '  q = vec3(q.x, cp * q.y - sp * q.z, sp * q.y + cp * q.z);',
        '  float cy = cos(aAnim.w); float sy = sin(aAnim.w);',
        '  q = vec3(cy * q.x + sy * q.z, q.y, cy * q.z - sy * q.x);',
        '  transformed = q + ' + v3(NECK) + ';',
        '} else if (abs(aPart) > 0.5) {',
        '  float side = sign(aPart);',
        '  float a = (side > 0.0 ? aAnim.x : aAnim.y) * side;',
        '  vec3 h = vec3(side * ' + WING_X.toFixed(3) + ', ' + WING_Y.toFixed(3) + ', 0.0);',
        '  vec3 q = transformed - h;',
        '  float c = cos(a); float s = sin(a);',
        '  transformed = vec3(c * q.x - s * q.y, s * q.x + c * q.y, q.z) + h;',
        '}',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'c9-duck';
  material = m;
  return m;
}

export function createDuckMeshes(counts = {}) {
  const meshes = {};
  const anims = {};
  const mat = duckMaterial();
  const own = [];
  for (const kind of DUCK_KINDS) {
    const n = Math.max(1, Math.min(16, Math.floor(Number(counts[kind]) || 0)));
    const { geo } = buildGeometry(kind);
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', anim);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = 'ducks-' + kind;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < n; i++) mesh.setColorAt(i, white);
    mesh.count = Number(counts[kind]) > 0 ? n : 0;
    meshes[kind] = mesh;
    anims[kind] = anim;
    own.push(geo);
  }
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  return {
    meshes,
    set(kind, i, x, y, z, yaw, pitch, roll, scale, wingL = 0, wingR = 0, headPitch = 0, headYaw = 0) {
      const mesh = meshes[kind];
      if (!mesh || i < 0 || i >= mesh.count) return;
      e.set(pitch, yaw, roll, 'YXZ');
      q.setFromEuler(e);
      p.set(x, y, z);
      s.set(scale, scale, scale);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
      const a = anims[kind].array;
      a[i * 4] = wingL;
      a[i * 4 + 1] = wingR;
      a[i * 4 + 2] = headPitch;
      a[i * 4 + 3] = headYaw;
    },
    tint(kind, i, hex) {
      const mesh = meshes[kind];
      if (!mesh || i < 0 || i >= mesh.count) return;
      mesh.setColorAt(i, col.set(hex));
      mesh.instanceColor.needsUpdate = true;
    },
    commit() {
      for (const kind of DUCK_KINDS) {
        meshes[kind].instanceMatrix.needsUpdate = true;
        anims[kind].needsUpdate = true;
      }
    },
    setBounds(x, y, z, r) {
      for (const kind of DUCK_KINDS) meshes[kind].boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
    },
    dispose() {
      for (const g of own) g.dispose();
      own.length = 0;
    },
  };
}
