// League World art: the electrical substation that looms behind the practice field, plus the
// throwing machine that works in front of it. The reference is a switchyard at the end of a
// training field: a grey forest of lattice, stacked insulator columns and sagging cable standing
// over a dark green windscreen wall. Everything here is generic industrial and sports kit, with
// no marks, names or logos of any kind on it.
//
// Each prop is ONE merged Geo drawn with the shared flat material, so a whole yard (6 bays, 4
// pylons, a fence run and every cable in one mesh) costs 12 draw calls and about 5k triangles.
// The solid mass of a bay and of a fence is its `footprint` box, the way homes work; `colliders`
// only carry the bits that a box would miss.
//
//   createSubstationBay({ w, d, scale })     -> { group, height, radius, footprint, colliders, anchors: { wireTops, top, transformer } }
//   createSubstationWires(points, { sag })   -> { group, height, radius, colliders, spans }
//   createPylon({ height, scale })           -> { group, height, radius, colliders, anchors: { wireTops, top } }
//   createSubstationFence({ length, scale }) -> { group, height, radius, footprint, colliders, length }
//   createBallMachine({ scale })             -> { group, height, radius, colliders, anchors: { muzzle, hopper }, setSpeed, update }
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade, mix } from './geo.js';
import { flatMat } from './materials.js';
import { rng, range, motion, makeProp, addMesh, V3 } from './util.js';
import { C } from './parts.js';

// Cool greys against sky, warm white insulators, a windscreen so dark it reads as a hole in the
// hillside. Keeping the whole yard inside one narrow value range is what stops the clutter from
// turning into noise at phone size.
const K = {
  steel: C.metal, steelDk: shade(C.metal, 0.72), steelLt: C.metalLt, steelMid: shade(C.metal, 0.86),
  insul: C.white, insulDk: C.stone,
  wire: mix(C.iron, C.metalDk, 0.3),
  screen: shade(C.pine, 0.5), screenLt: shade(C.pine, 0.64),
  pad: C.concrete, padDk: C.concreteDk,
  tank: C.stoneDk, tankDk: shade(C.stoneDk, 0.78),
  lamp: 0xd9d2b8,
};

// ---- shared parts -------------------------------------------------------------------------------
// A lattice column: four corner rails plus a single zig zag that climbs around all four faces.
// Webbing a whole column with one tube strip is what keeps a yard full of these affordable, and
// because the strip wraps it reads as bracing from any angle instead of only head on.
function latticeColumn(g, x, z, y0, y1, a0, a1, hex, o = {}) {
  const r = o.r === undefined ? 0.05 : o.r, spans = o.spans || 6;
  const corner = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of corner) g.tube([[x + sx * a0, y0, z + sz * a0], [x + sx * a1, y1, z + sz * a1]], r, hex, { seg: 3 });
  const pts = [];
  for (let i = 0; i <= spans; i++) {
    const t = i / spans, a = a0 + (a1 - a0) * t, c = corner[i % 4];
    pts.push([x + c[0] * a, y0 + (y1 - y0) * t, z + c[1] * a]);
  }
  return g.tube(pts, r * 0.72, hex, { seg: 3 });
}

// A flat truss beam along X: two rails and a zig zag web between them. Switchyard cross arms
// really are flat frames, so the honest shape is also the cheap one.
function latticeBeam(g, x0, x1, y, z, h, hex, o = {}) {
  const r = o.r === undefined ? 0.045 : o.r, spans = o.spans || 5;
  g.tube([[x0, y, z], [x1, y, z]], r, hex, { seg: 3 });
  g.tube([[x0, y + h, z], [x1, y + h, z]], r, hex, { seg: 3 });
  const pts = [];
  for (let i = 0; i <= spans; i++) pts.push([x0 + (x1 - x0) * (i / spans), y + (i % 2 ? h : 0), z]);
  return g.tube(pts, r * 0.72, hex, { seg: 3 });
}

// A stack of insulator skirts on a narrow core, base at (x, y, z). Four sided for the columns a
// player can walk up to, three sided for the strings that only ever hang high on a pylon.
function insulators(g, x, y, z, h, discs, o = {}) {
  const seg = o.seg || 4, r = o.r || 0.16, core = r * 0.5;
  const prof = [[core, 0]];
  for (let i = 0; i < discs; i++) prof.push([r, (h * (i + 0.55)) / discs], [core, (h * (i + 1)) / discs]);
  return g.lathe(x, y, z, prof, o.color || K.insul, { seg, capTop: o.cap === undefined ? K.insulDk : o.cap });
}

// A hazard plate facing +Z: a coloured square with a hollow triangle on it. Shape only, never
// text or a mark, which is also the only thing that survives being 12 pixels wide on a phone.
function warningPlate(g, x, y, z, s) {
  g.quad2([x - s, y - s, z], [x + s, y - s, z], [x + s, y + s, z], [x - s, y + s, z], C.caution, shade(C.caution, 0.7));
  g.tri2([x - s * 0.74, y - s * 0.6, z + 0.012], [x + s * 0.74, y - s * 0.6, z + 0.012], [x, y + s * 0.74, z + 0.012], C.iron);
  g.tri2([x - s * 0.4, y - s * 0.38, z + 0.022], [x + s * 0.4, y - s * 0.38, z + 0.022], [x, y + s * 0.34, z + 0.022], C.caution);
}

// ---- one repeatable bay of switchyard ------------------------------------------------------------
// Origin at ground centre, the business face toward +Z. Place several in a row along X and string
// `anchors.wireTops` together with createSubstationWires.
export function createSubstationBay({ w = 6, d = 4, scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'substationBay';
  const own = [], g = new Geo(), r = rng(Math.round(w * 131 + d * 17));
  g.scale(scale);
  const H = 7.2;                       // gantry top: tall enough to loom well over a 2.4 m windscreen
  const CX = w / 2 - 0.55;             // the two gantry legs
  const GZ = -d * 0.14;                // the gantry sits a little behind the insulator row
  const FZ = d * 0.3;                  // the row of insulator stacks, nearest the field
  const SX = [-w * 0.3, 0, w * 0.3];   // the three phases, shared by the stubs and the stacks

  // crushed stone pad
  g.box(0, 0, 0, w, 0.12, d, K.pad, { top: shade(K.pad, 1.05), side: K.padDk });

  // the gantry: two lattice legs and a truss head carrying the line stubs
  latticeColumn(g, -CX, GZ, 0.12, H, 0.21, 0.13, K.steel, { spans: 5 });
  latticeColumn(g, CX, GZ, 0.12, H, 0.21, 0.13, K.steel, { spans: 5 });
  latticeBeam(g, -CX, CX, H - 0.6, GZ, 0.6, K.steel, { spans: 5 });
  g.box(0, 4.3, GZ, w - 0.7, 0.16, 0.16, K.steelDk, { bottom: true });

  // the stubs the lines land on, one per phase
  for (const sx of SX) {
    g.cyl(sx, H, GZ, 0.05, 0.46, K.steelDk, { seg: 3 });
    insulators(g, sx, H + 0.46, GZ, 0.36, 1, { seg: 3, r: 0.11 });
  }

  // the row of three insulator stacks on a low frame, with a busbar across the top
  for (const sx of [-1, 1]) g.cyl(sx * w * 0.31, 0.12, FZ, 0.07, 1.0, K.steel, { seg: 3, top: K.steelDk });
  g.box(0, 1.1, FZ, w * 0.74, 0.14, 0.18, K.steelDk, { bottom: true });
  for (const sx of SX) insulators(g, sx, 1.24, FZ, 1.5, 3, { seg: 4, r: 0.17 });
  g.tube([[-w * 0.33, 2.82, FZ], [w * 0.33, 2.82, FZ]], 0.05, K.steelLt, { seg: 3 });

  // transformer: a tank on a plinth, a bank of cooling fins down one end, two bushings on the lid
  const TX = -w * 0.24, TZ = -d * 0.3;
  g.box(TX, 0.12, TZ, 1.9, 0.14, 1.3, K.padDk);
  g.box(TX, 0.26, TZ, 1.5, 1.45, 1.0, K.tank, { top: shade(K.tank, 1.12), side: K.tankDk, back: K.tankDk });
  for (let i = 0; i < 5; i++) {
    const fz = TZ - 0.4 + i * 0.2, fx = TX - 0.75;
    g.quad2([fx, 0.4, fz], [fx - 0.34, 0.4, fz], [fx - 0.34, 1.5, fz], [fx, 1.5, fz], K.steelMid, K.tankDk);
  }
  for (const sx of [-0.38, 0.38]) insulators(g, TX + sx, 1.71, TZ, 0.4, 1, { seg: 3, r: 0.1 });

  // control cabinet
  g.box(w * 0.36, 0.12, d * 0.34, 0.74, 1.2, 0.54, K.steelLt, { top: K.steelMid, side: K.steelMid, bottom: true });
  g.quad([w * 0.36 - 0.26, 0.26, d * 0.34 + 0.275], [w * 0.36 + 0.26, 0.26, d * 0.34 + 0.275], [w * 0.36 + 0.26, 1.2, d * 0.34 + 0.275], [w * 0.36 - 0.26, 1.2, d * 0.34 + 0.275], K.steelMid);

  // loose verticals at odd heights. A real yard is never a tidy grid, and this ragged silhouette
  // is most of what sells "switchyard" from across the field.
  for (let i = 0; i < 3; i++) {
    const px = range(r, -w * 0.44, w * 0.44), pz = range(r, -d * 0.42, -d * 0.02), ph = range(r, 2.8, 5.6);
    g.cyl(px, 0.12, pz, 0.07, ph, K.steel, { seg: 3, top: K.steelDk });
    if (i === 0) g.box(px, ph + 0.12, pz, 1.1, 0.08, 0.09, K.steelDk, { bottom: true });
    // one of them carries a yard lamp, like the service poles dotted through the reference
    if (i === 1) g.box(px, ph + 0.12, pz + 0.12, 0.34, 0.12, 0.34, K.lamp, { bottom: K.steelDk, top: K.steelDk });
  }

  // the base lives in the windscreen's shadow, so sink it
  g.shadeY(0, 2.6 * scale, 0.8);
  addMesh(group, g, flatMat, own, 'bay');

  const k = scale, topY = (H + 0.82) * k;
  return makeProp(group, own, null, {
    height: topY,
    radius: (Math.hypot(w, d) / 2) * k,
    footprint: { w: w * k, d: d * k },
    colliders: [
      { x: -CX * k, z: GZ * k, r: 0.4 * k }, { x: CX * k, z: GZ * k, r: 0.4 * k },
      { x: TX * k, z: TZ * k, r: 0.95 * k },
    ],
    anchors: {
      wireTops: SX.map((sx) => V3(sx * k, topY, GZ * k)),
      top: V3(0, H * k, GZ * k),
      transformer: V3(TX * k, 1.71 * k, TZ * k),
    },
    triangles: g.tris,
  });
}

// ---- the cables ----------------------------------------------------------------------------------
const isPoint = (p) => !!p && (typeof p.x === 'number' || typeof p[0] === 'number');
const toXYZ = (p) => (typeof p.x === 'number' ? [p.x, p.y, p.z] : [p[0], p[1], p[2]]);

// `points` is one run of points, or a list of runs. Taking a list of runs matters: a whole yard of
// cable then lands on one mesh instead of one draw call per phase.
function runsOf(points) {
  if (!points || !points.length) return [];
  const list = isPoint(points[0]) ? [points] : points;
  const out = [];
  for (const run of list) if (run && run.length > 1) out.push(Array.prototype.map.call(run, toXYZ));
  return out;
}

// Thin dark cable hung through a list of points. `sag` is the dip at mid span as a FRACTION of the
// span, so one value looks right over a 7 m bay gap and a 40 m pylon gap alike.
export function createSubstationWires(points, { sag = 0.055, radius = 0.06, color = K.wire, segments = 4 } = {}) {
  const group = new THREE.Group(); group.name = 'substationWires';
  const own = [], g = new Geo(), runs = runsOf(points);
  const seg = Math.max(2, Math.min(6, Math.round(segments)));
  let top = 0, reach = 0, spans = 0;
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i], b = run[i + 1];
      const dip = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * sag;
      const pts = [];
      for (let s = 0; s <= seg; s++) {
        // a parabola and a catenary are the same picture at these sags, and this one is two multiplies
        const t = s / seg, y = a[1] + (b[1] - a[1]) * t - dip * 4 * t * (1 - t);
        const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
        pts.push([x, y, z]);
        top = Math.max(top, y); reach = Math.max(reach, Math.hypot(x, z));
      }
      g.tube(pts, radius, color, { seg: 3 });
      spans++;
    }
  }
  addMesh(group, g, flatMat, own, 'wires');
  // cable hangs overhead, so there is nothing here to walk into
  return makeProp(group, own, null, { height: top, radius: reach, colliders: [], spans, triangles: g.tris });
}

// ---- free standing transmission pylon --------------------------------------------------------------
export function createPylon({ height = 14, scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'pylon';
  const own = [], g = new Geo(), H = Math.max(6, height);
  g.scale(scale);
  const base = H * 0.085, waist = H * 0.034, neck = H * 0.027;
  const WY = H * 0.4, BY = H * 0.76;                   // waist height and the top of the mast
  const ARM = [[BY, H * 0.3], [H * 0.9, H * 0.2]];     // [height, half length] lower arm then upper

  g.box(0, 0, 0, base * 2.5, 0.16, base * 2.5, K.pad, { top: shade(K.pad, 1.05), side: K.padDk });
  // the body in two sections so it has a waist instead of being a plain pyramid
  latticeColumn(g, 0, 0, 0.16, WY, base, waist, K.steel, { spans: 5, r: 0.06 });
  latticeColumn(g, 0, 0, WY, H * 0.95, waist, neck, K.steel, { spans: 5, r: 0.05 });
  for (const [y, s] of [[WY, waist], [BY, neck * 1.1], [H * 0.9, neck]]) g.box(0, y, 0, s * 2.1, 0.07, s * 2.1, K.steelDk, { noTop: true });

  const tops = [];
  for (const [y, half] of ARM) {
    g.box(0, y, 0, half * 2, 0.18, 0.2, K.steelDk, { bottom: true });
    for (const sx of [-1, 1]) {
      // a stay back to the mast, then an insulator string with the conductor on its bottom
      g.tube([[sx * half * 0.94, y, 0], [sx * neck * 0.6, y + H * 0.075, 0]], 0.04, K.steel, { seg: 3 });
      insulators(g, sx * half * 0.9, y - 0.56, 0, 0.56, 1, { seg: 3, r: 0.1, cap: K.steelDk });
      tops.push([sx * half * 0.9, y - 0.6, 0]);
    }
  }
  // earth wire peaks above everything, the way the real ones do
  g.cone(0, H * 0.95, 0, neck * 1.1, H * 0.05, K.steel, { seg: 3 });
  for (const sx of [-1, 1]) g.cyl(sx * neck * 0.8, H * 0.95, 0, 0.04, H * 0.055, K.steelDk, { seg: 3 });
  g.shadeY(0, H * 0.25 * scale, 0.84);
  addMesh(group, g, flatMat, own, 'pylon');

  const k = scale;
  return makeProp(group, own, null, {
    height: H * 1.01 * k,
    radius: ARM[0][1] * k,
    colliders: [{ x: 0, z: 0, r: base * 1.25 * k }],
    anchors: {
      wireTops: tops.map((p) => V3(p[0] * k, p[1] * k, p[2] * k)),
      top: V3(0, H * k, 0),
    },
    triangles: g.tris,
  });
}

// ---- the fence and its windscreen ------------------------------------------------------------------
// Runs along X, centred on the origin, field side facing +Z. The solid wall is `footprint`;
// `colliders` are only the posts, as with a home.
export function createSubstationFence({ length = 20, scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'substationFence';
  const own = [], g = new Geo(), len = Math.max(2, length);
  g.scale(scale);
  const H = 2.4, ST = H * 0.66;                    // windscreen covers the bottom two thirds
  const n = Math.max(1, Math.round(len / 2.6)), step = len / n, x0 = -len / 2;
  const colliders = [];

  // rails: bottom, the line the windscreen is tied along, and the top
  for (const y of [0.1, ST, H - 0.04]) g.tube([[x0, y, 0.02], [x0 + len, y, 0.02]], 0.045, K.steelDk, { seg: 3 });

  for (let i = 0; i <= n; i++) {
    const x = x0 + i * step;
    g.cyl(x, 0, 0, 0.065, H + 0.06, K.steelDk, { seg: 3, top: K.steel });
    colliders.push({ x: x * scale, z: 0, r: 0.25 * scale });
    if (i === n) break;
    // one windscreen panel per bay, alternating tone so a long run does not read as one flat slab
    const xa = x + 0.03, xb = x + step - 0.03, col = i % 2 ? K.screen : K.screenLt;
    g.quad2([xa, 0.06, 0.065], [xb, 0.06, 0.065], [xb, ST, 0.065], [xa, ST, 0.065], col, shade(col, 0.82));
  }

  // chain link above the windscreen, sketched as sparse wires. Real mesh is invisible at any
  // distance anyway, and a solid panel up there would turn the fence into a wall.
  const wires = Math.max(1, Math.round(len / 1.5)), wstep = len / wires;
  for (let i = 1; i < wires; i++) {
    const x = x0 + i * wstep;
    g.quad2([x - 0.016, ST, 0.062], [x + 0.016, ST, 0.062], [x + 0.016, H - 0.04, 0.062], [x - 0.016, H - 0.04, 0.062], K.steel, K.steelMid);
  }
  for (const y of [ST + (H - ST) * 0.36, ST + (H - ST) * 0.72]) {
    g.quad2([x0, y - 0.014, 0.062], [x0 + len, y - 0.014, 0.062], [x0 + len, y + 0.014, 0.062], [x0, y + 0.014, 0.062], K.steel, K.steelMid);
  }

  // a hazard plate every few bays, on the field side
  const signs = Math.max(1, Math.round(len / 8));
  for (let i = 0; i < signs; i++) warningPlate(g, x0 + (len * (i + 0.5)) / signs, ST * 0.62, 0.08, 0.2);

  g.shadeY(0, H * scale, 0.86);
  addMesh(group, g, flatMat, own, 'fence');

  const k = scale;
  return makeProp(group, own, null, {
    height: (H + 0.06) * k,
    radius: (len / 2) * k,
    length: len * k,
    footprint: { w: len * k, d: 0.3 * k },
    colliders,
    triangles: g.tris,
  });
}

// ---- the throwing machine ---------------------------------------------------------------------------
// One wheel geometry, two counter rotating instances: a throwing machine drives the ball with both
// wheel faces moving the same way, so the pair has to turn opposite ways to be believable.
function ballWheel(own) {
  const g = new Geo(), R = 0.21, W = 0.11, n = 6;
  g.at(-W / 2, 0, 0, 0, 0, -Math.PI / 2);              // lay it on its side so the axle runs along X
  g.band(R, 0, R, W, n, 0, C.tire);
  g.band(R, W, R * 0.52, W, n, 0, K.steelLt);
  g.band(R * 0.52, 0, R, 0, n, 0, K.steelLt);
  g.fan(R * 0.52, W, n, 0, K.steelDk);
  g.fan(R * 0.52, 0, n, 0, K.steelDk, true);
  // three marks on the rim, otherwise a smooth wheel spinning looks like a wheel standing still
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3 + 0.4, x = Math.cos(a) * R * 0.78, z = Math.sin(a) * R * 0.78, s = 0.035;
    g.quad([x - s, W + 0.004, z + s], [x + s, W + 0.004, z + s], [x + s, W + 0.004, z - s], [x - s, W + 0.004, z - s], C.iron);
    g.quad([x - s, -0.004, z - s], [x + s, -0.004, z - s], [x + s, -0.004, z + s], [x - s, -0.004, z + s], C.iron);
  }
  g.restore();
  const geo = g.build();
  own.push(geo);
  return geo;
}

export function createBallMachine({ scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'ballMachine';
  const own = [], g = new Geo();
  g.scale(scale);
  const HUB = 0.6, WZ = 0.08, PINCH = 1.13, R = 0.21;
  const WHEELS = [[0.92, 1], [1.34, -1]];              // [centre height, spin direction]

  // wheeled tripod
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * TAU) / 3, lx = Math.cos(a) * 0.46, lz = Math.sin(a) * 0.46;
    g.tube([[lx, 0.1, lz], [0, HUB, 0]], 0.035, K.steelDk, { seg: 3 });
    g.cyl(lx, 0.07, lz, 0.07, 0.055, C.tire, { seg: 4, rz: Math.PI / 2, bottom: true, top: K.steelLt });
  }
  g.cyl(0, HUB - 0.02, 0, 0.065, 0.3, K.steelDk, { seg: 5, top: K.steelMid });

  // head: a back plate with an arm above and below carrying the wheel axles
  g.box(0, 0.72, -0.14, 0.5, 0.78, 0.1, K.steelMid, { bottom: true, side: K.steelDk });
  for (const [cy] of WHEELS) {
    g.box(0, cy - 0.05, WZ - 0.11, 0.46, 0.1, 0.24, K.steelLt, { bottom: true, side: K.steelMid });
  }
  // guide lips above and below the pinch, so the gap reads as a muzzle
  for (const sy of [-1, 1]) {
    const y = PINCH + sy * 0.145;
    g.quad2([-0.17, y, WZ + 0.1], [0.17, y, WZ + 0.1], [0.17, y + sy * 0.03, WZ + 0.3], [-0.17, y + sy * 0.03, WZ + 0.3], K.steelDk, K.steelMid);
  }

  // feed chute from the hopper down into the back of the pinch
  g.cyl(0, 1.3, -0.34, 0.1, 0.33, K.steelLt, { seg: 5, rx: 2.17, top: false });

  // hopper: an open basket. Its inside wall is drawn mirrored so the far side is not see through.
  const HY = 1.28, HZ = -0.36;
  g.lathe(0, HY, HZ, [[0.16, 0], [0.3, 0.26]], K.steelLt, { seg: 6, capTop: false });
  g.save(); g.scale(-1, 1, 1);
  g.lathe(0, HY, HZ, [[0.15, 0.015], [0.288, 0.26]], K.steelMid, { seg: 6, capTop: false });
  g.restore();
  g.fan(0.15, HY + 0.015, 6, Math.PI / 6, K.steelDk);
  g.band(0.3, HY + 0.26, 0.288, HY + 0.24, 6, Math.PI / 6, K.steelDk);
  for (const [bx, by, bz, br] of [[-0.1, 0.12, -0.06, 0.1], [0.1, 0.11, 0.05, 0.1], [0.0, 0.26, -0.02, 0.1]]) {
    g.ico(bx, HY + by, HZ + bz, br, 0x8a4a2a, { sz: 1.45, ry: bx * 7 });
  }

  // control box on the operator side, with its cable up to the head
  g.box(-0.04, 0.26, -0.44, 0.28, 0.3, 0.17, K.steelLt, { bottom: true, back: K.steelMid });
  g.quad([-0.14, 0.32, -0.524], [0.06, 0.32, -0.524], [0.06, 0.5, -0.524], [-0.14, 0.5, -0.524], C.iron);
  g.tube([[-0.04, 0.56, -0.44], [-0.1, 0.78, -0.22], [-0.04, 0.9, -0.2]], 0.016, C.iron, { seg: 3 });
  g.shadeY(0, 0.7 * scale, 0.88);
  addMesh(group, g, flatMat, own, 'machine');

  const wheels = new THREE.InstancedMesh(ballWheel(own), flatMat, WHEELS.length);
  wheels.name = 'wheels';
  wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wheels.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1 * scale, 0), 0.9 * scale);
  group.add(wheels); own.push(wheels);

  const wa = wheels.instanceMatrix.array;
  let speed = 7, spin = 0;
  const prop = makeProp(group, own, (dt, t) => {
    spin += speed * dt * motion();
    if (spin > 1e4) spin -= 1e4;
    for (let i = 0; i < WHEELS.length; i++) {
      const o = i * 16, a = spin * WHEELS[i][1], c = Math.cos(a) * scale, s = Math.sin(a) * scale;
      wa[o] = scale; wa[o + 1] = 0; wa[o + 2] = 0; wa[o + 3] = 0;
      wa[o + 4] = 0; wa[o + 5] = c; wa[o + 6] = s; wa[o + 7] = 0;
      wa[o + 8] = 0; wa[o + 9] = -s; wa[o + 10] = c; wa[o + 11] = 0;
      wa[o + 12] = 0; wa[o + 13] = WHEELS[i][0] * scale; wa[o + 14] = WZ * scale; wa[o + 15] = 1;
    }
    wheels.instanceMatrix.needsUpdate = true;
  }, {
    setSpeed(v) { speed = Math.max(0, v || 0); },
    height: (HY + 0.3) * scale,
    radius: 0.55 * scale,
    colliders: [{ x: 0, z: 0, r: 0.45 * scale }],
    anchors: {
      muzzle: V3(0, PINCH * scale, (WZ + 0.3) * scale),
      hopper: V3(0, (HY + 0.26) * scale, HZ * scale),
    },
    triangles: g.tris,
  });
  prop.update(0, 0);
  return prop;
}
