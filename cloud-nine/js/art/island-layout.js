// The plan of Cloud Nine: where everything is and how high the ground is. PURE: no three.js and
// no DOM, so it runs under `node --test` as well as in the browser.
//
// Axes: +Y up, +X east, +Z south. The camera's default view looks north (toward -Z), so north is
// "ahead" from the plaza. A `facing` is a rotation about +Y (three.js rotation.y) that turns a
// thing's local +Z (its front) the way it looks: heading 0 faces +Z, PI faces north.
// Bearings in this file are degrees clockwise from north.
//
//   const plan = makeIslandPlan()
//   plan.places              Contract 1 places, plus a few extras (cake, fountain, isle, ...)
//   plan.platforms           [{ id, x, z, y, r }]: the basket-toss target clouds
//   plan.slides              [{ id, fromPlatformId, x0, z0, x1, z1, y0, y1, halfWidth }]
//   plan.ground              { groundAt(x, z), islandHeight(x, z), insideMain(x, z), ... }
//   plan.pond                the duck pond: makePond() below (pondColliders(pond) is what is solid)
//
//   groundAt(x, z) -> y of the walkable surface (island, isle, cloud platforms, rainbow slides, the
//   bridge and the duck pond's dock), or -Infinity over open sky. A precomputed height grid plus a
//   handful of analytic shapes, so it costs well under a microsecond.

import { clamp, lerp, smoothstep, valueNoise2, TAU, DEG } from '../core/util.js';

export const GRID_CELL = 2.5; // meters; the ground mesh uses the same grid and triangle split

// ------------------------------------------------------------------------------------- helpers
// World position of a point given in a place's local frame (local +Z is the place's front).
export function toWorld(p, lx, lz) {
  const c = Math.cos(p.facing || 0);
  const s = Math.sin(p.facing || 0);
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}
export function toLocal(p, x, z) {
  const c = Math.cos(p.facing || 0);
  const s = Math.sin(p.facing || 0);
  const dx = x - p.x;
  const dz = z - p.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
// The facing that turns local +Z from (x, z) toward (tx, tz).
export function faceToward(x, z, tx, tz) {
  return Math.atan2(tx - x, tz - z);
}
// Unit vector for a bearing in degrees (clockwise from north).
export function bearingDir(deg) {
  return [Math.sin(deg * DEG), -Math.cos(deg * DEG)];
}
// Distance from a point to the outside of a rotated rectangle (0 inside).
export function rectDistance(x, z, r) {
  const [lx, lz] = toLocal(r, x, z);
  const ox = Math.max(0, Math.abs(lx) - r.w / 2);
  const oz = Math.max(0, Math.abs(lz) - r.d / 2);
  return Math.hypot(ox, oz);
}
// Nearest point on a segment: returns t in [0, 1] and the squared distance.
function segNear(ax, az, bx, bz, x, z, out) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - x;
  const pz = az + dz * t - z;
  out.t = t;
  out.d2 = px * px + pz * pz;
  return out;
}
// Uniform Catmull-Rom through [x, z] control points, sampled every `step` meters (roughly).
export function spline(ctrl, step = 1.5) {
  const out = [];
  const n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(n - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[n - 1].slice());
  return out;
}

// ------------------------------------------------------------------------------------- outline
// The main island: a star-shaped outline around CENTER, given as a rim radius every 15 degrees of
// bearing, joined with a periodic spline and roughened with a little wobble.
export const CENTER = { x: 0, z: -2 };
const RIM = [
  62, 63, 60, 66, 64, 61, //   0 .. 75   gym, a bay, the stage headland, the bridge cape
  60, 61, 65, 67, 71, 72, //  90 .. 165  a little bay, the court, the Capture the Bow field
  71, 68, 66, 70, 68, 71, // 180 .. 255  the field, the lawn, the garden
  73, 73, 66, 61, 61, 62, // 270 .. 345  the garden, the toss headland, back to the gym
];
const RIM_N = 2048;

function rimSpline(ctrl) {
  const n = ctrl.length;
  const table = new Float32Array(RIM_N);
  for (let k = 0; k < RIM_N; k++) {
    const u = (k / RIM_N) * n;
    const i = Math.floor(u);
    const t = u - i;
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i % n];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    const t2 = t * t;
    const t3 = t2 * t;
    let r = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    const b = (k / RIM_N) * TAU;
    r += 1.1 * Math.sin(b * 7 + 0.6) + 0.7 * Math.sin(b * 13 + 2.2) + 0.35 * Math.sin(b * 29 + 4.1);
    table[k] = r;
  }
  return table;
}

function makeOutline(cx, cz, table) {
  const N = table.length;
  // rim radius at a bearing in radians
  function radiusAt(b) {
    let u = (b / TAU) * N;
    u = ((u % N) + N) % N;
    const i = u | 0;
    const t = u - i;
    return table[i] + (table[(i + 1) % N] - table[i]) * t;
  }
  // signed distance-ish: rim radius minus radial distance (> 0 inside)
  function margin(x, z) {
    const dx = x - cx;
    const dz = z - cz;
    return radiusAt(Math.atan2(dx, -dz)) - Math.hypot(dx, dz);
  }
  function rimPoint(b) {
    const r = radiusAt(b);
    return [cx + Math.sin(b) * r, cz - Math.cos(b) * r];
  }
  let maxR = 0;
  for (let i = 0; i < N; i++) maxR = Math.max(maxR, table[i]);
  return { cx, cz, radiusAt, margin, rimPoint, maxR, inside: (x, z) => margin(x, z) >= 0 };
}

// --------------------------------------------------------------------------------------- plan
export function makeIslandPlan() {
  const main = makeOutline(CENTER.x, CENTER.z, rimSpline(RIM));

  // ---------------------------------------------------------------- the big places
  const plazaC = { x: 0, z: 0, r: 16 }; // the paved circle; the cake stands in the middle
  const cake = { x: 0, z: 0, r: 3.1 };
  const fountain = { x: 0, z: -28, r: 4.4, court: 11 }; // the bow fountain in the gym's forecourt
  const gym = { x: 0, z: -49, w: 24, d: 15, facing: 0 };
  const stage = { x: 31, z: -31, facing: -Math.PI / 4, mat: 12 };
  const court = { x: 40, z: 20, w: 12, d: 22, facing: Math.PI / 2 };
  const bowField = { x: 6, z: 48, w: 22, d: 40, facing: Math.PI / 2 };
  const tag = { x0: -48, z0: 18, x1: -22, z1: 42 };
  const garden = { x0: -64, z0: -20, x1: -34, z1: 8 };
  const photoBooth = { x: -14, z: -3.5, facing: Math.PI / 2 };

  // bases at either end of the field, team 0 at local -Z (west), team 1 at local +Z (east)
  const baseAt = (team) => {
    const [x, z] = toWorld(bowField, 0, (team ? 1 : -1) * (bowField.d / 2 - 5));
    return { team, x, z, r: 3.2 };
  };

  // ---------------------------------------------------------------- the toss headland (north-west)
  // Three pads in a row near the rim, each thrown straight out at a cloud platform floating over
  // open sky. Rainbow slides come back down from the platforms and land beside the pads.
  const tossBearing = 314;
  const [ux, uz] = bearingDir(tossBearing); // outward
  const vx = -uz;
  const vz = ux; // along the rim, toward the gym
  const tossRim = main.rimPoint(tossBearing * DEG);
  const PAD_INSET = 5;
  const tossPads = [];
  const platforms = [];
  const slides = [];
  const heights = [8, 14, 22];
  const out = [12, 19, 28]; // platform centre beyond the rim
  const radii = [3.2, 3.6, 4.2];
  const laterals = [-13, 0, 13];
  // where the line through (x, z) along +u leaves the island
  const rimAlong = (x, z) => {
    let t = -20;
    while (main.margin(x + ux * t, z + uz * t) > 0 && t < 60) t += 0.25;
    return t;
  };
  for (let k = 0; k < 3; k++) {
    const lx = tossRim[0] + vx * laterals[k];
    const lz = tossRim[1] + vz * laterals[k];
    const t = rimAlong(lx, lz);
    const rx = lx + ux * t;
    const rz = lz + uz * t;
    const pad = { id: 'pad' + (k + 1), x: rx - ux * PAD_INSET, z: rz - uz * PAD_INSET, facing: Math.atan2(ux, uz), targetPlatformId: 'cloud' + (k + 1) };
    const pf = { id: 'cloud' + (k + 1), x: rx + ux * out[k], z: rz + uz * out[k], y: heights[k], r: radii[k] };
    tossPads.push(pad);
    platforms.push(pf);
    // the slide lands beside its pad, on the gym side
    const bx = pad.x + vx * 5.6 + ux * 0.6;
    const bz = pad.z + vz * 5.6 + uz * 0.6;
    const dx = bx - pf.x;
    const dz = bz - pf.z;
    const dl = Math.hypot(dx, dz);
    const sx = pf.x + (dx / dl) * (pf.r - 0.7);
    const sz = pf.z + (dz / dl) * (pf.r - 0.7);
    slides.push({ id: 'slide' + (k + 1), fromPlatformId: pf.id, x0: sx, z0: sz, x1: bx, z1: bz, y0: pf.y, y1: 0, halfWidth: 1.45 });
  }

  // ---------------------------------------------------------------- the bow boutique isle (east)
  const bridgeBearing = 77;
  const [bdx, bdz] = bearingDir(bridgeBearing);
  const capeR = main.radiusAt(bridgeBearing * DEG);
  const bridgeStart = [CENTER.x + bdx * (capeR - 3.2), CENTER.z + bdz * (capeR - 3.2)];
  const BRIDGE_SPAN = 28;
  const isle = {
    x: CENTER.x + bdx * (capeR + BRIDGE_SPAN - 3 + 13.5),
    z: CENTER.z + bdz * (capeR + BRIDGE_SPAN - 3 + 13.5),
    r: 13.5, y: 0.35,
  };
  const isleOutline = (() => {
    const N = 512;
    const table = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const b = (k / N) * TAU;
      table[k] = isle.r + 1.0 * Math.sin(b * 3 + 0.4) + 0.6 * Math.sin(b * 5 + 1.9) + 0.3 * Math.sin(b * 11 + 0.7);
    }
    return makeOutline(isle.x, isle.z, table);
  })();
  const bridgeEnd = (() => {
    // walk back from the isle centre toward the island until we are 3 m inside the isle's rim
    let t = 0;
    while (isleOutline.margin(isle.x - bdx * t, isle.z - bdz * t) > 3.2) t += 0.1;
    return [isle.x - bdx * t, isle.z - bdz * t];
  })();
  const bridge = {
    x0: bridgeStart[0], z0: bridgeStart[1], x1: bridgeEnd[0], z1: bridgeEnd[1],
    halfWidth: 1.7, arch: 2.6, y0: 0, y1: isle.y,
  };
  const boutique = { x: isle.x + bdx * 3.2, z: isle.z + bdz * 3.2, facing: Math.atan2(-bdx, -bdz), w: 8, d: 7 };

  // ---------------------------------------------------------------- hide and seek garden
  const hideGarden = makeGarden(garden);

  // ---------------------------------------------------------------- waterfalls (rim springs)
  const waterfalls = [302, 92, 214].map((deg, i) => {
    const b = (deg + (i === 0 ? -9 : 0)) * DEG;
    const r = main.radiusAt(b);
    const [dx, dz] = [Math.sin(b), -Math.cos(b)];
    return { id: 'falls' + (i + 1), bearing: b, x: CENTER.x + dx * (r - 3.2), z: CENTER.z + dz * (r - 3.2), lip: [CENTER.x + dx * r, CENTER.z + dz * r], dir: [dx, dz], pondR: 2.6 };
  });

  // ---------------------------------------------------------------- the duck pond (east lawn)
  // A little pond in the natural hollow between the bridge path and the dodgeball court, with the
  // east waterfall pouring off the rim beyond it. Its dock reaches in from the west shore (the pond's
  // front, `facing`), so from the end of it she looks out over the ducks at the falls and the sky.
  const pond = makePond({ x: 41, z: -1, r: 4.6, facing: -Math.PI / 2, y: -0.8 });

  // ---------------------------------------------------------------- flat pads (the terrain eases to y = 0 under these)
  const pads = [
    { kind: 'disc', x: plazaC.x, z: plazaC.z, r: plazaC.r + 2, blend: 7 },
    { kind: 'disc', x: fountain.x, z: fountain.z, r: fountain.court + 1, blend: 5 },
    { kind: 'rect', x: gym.x, z: gym.z + 1, w: gym.w + 6, d: gym.d + 8, facing: 0, blend: 6 },
    { kind: 'rect', x: stage.x, z: stage.z, w: 30, d: 25, facing: stage.facing, blend: 6 },
    { kind: 'rect', x: court.x, z: court.z, w: court.w + 13, d: court.d + 6, facing: court.facing, blend: 6 },
    { kind: 'rect', x: bowField.x, z: bowField.z, w: bowField.w + 4, d: bowField.d + 4, facing: bowField.facing, blend: 6 },
    { kind: 'rect', x: (tag.x0 + tag.x1) / 2, z: (tag.z0 + tag.z1) / 2, w: tag.x1 - tag.x0 + 3, d: tag.z1 - tag.z0 + 3, facing: 0, blend: 6 },
    { kind: 'rect', x: (garden.x0 + garden.x1) / 2, z: (garden.z0 + garden.z1) / 2, w: garden.x1 - garden.x0 + 3, d: garden.z1 - garden.z0 + 3, facing: 0, blend: 6 },
    { kind: 'disc', x: photoBooth.x, z: photoBooth.z, r: 4, blend: 4 },
    ...tossPads.map((p) => ({ kind: 'disc', x: p.x, z: p.z, r: 5, blend: 5 })),
    ...slides.map((s) => ({ kind: 'disc', x: s.x1, z: s.z1, r: 4, blend: 4 })),
    { kind: 'disc', x: bridge.x0, z: bridge.z0, r: 5, blend: 5 },
    ...waterfalls.map((w) => ({ kind: 'disc', x: w.x, z: w.z, r: w.pondR + 1.6, blend: 4 })),
    { kind: 'disc', x: pond.x, z: pond.z, r: pond.r + 2.8, blend: 4, y: pond.y }, // the hollow, levelled
  ];
  for (const p of pads) {
    if (!Number.isFinite(p.y)) p.y = 0;
    if (p.kind === 'rect') p.reach = Math.hypot(p.w, p.d) / 2 + p.blend;
    else p.reach = p.r + p.blend;
  }

  // soft hills where there is room, each topped by something worth climbing for
  const knolls = [
    { x: -17, z: -50, r: 12, h: 2.6 },  // the big cotton-candy tree north-west of the gym
    { x: 27, z: 1.5, r: 7, h: 1.2 },    // a little rise between the bridge and court paths
    { x: -52, z: 30, r: 9, h: 1.8 },    // behind the freeze tag lawn
    { x: 46, z: 41, r: 8, h: 1.6 },     // south of the court
  ];

  // ---------------------------------------------------------------- paths (pastel paving ribbons)
  const stageFront = toWorld(stage, 0, 12);
  const paths = [
    { id: 'gymWalk', w: 4.5, pts: spline([[0, -14], [0, -18]]) },
    { id: 'gymApron', w: 9, pts: spline([[0, -38], [0, -41.8]]) },
    { id: 'toStage', w: 3.4, pts: spline([[10, -12], [16, -18], stageFront]) },
    { id: 'toBridge', w: 3.4, pts: spline([[15.5, -4], [28, -9], [42, -12.5], [bridge.x0 - bdx * 2, bridge.z0 - bdz * 2]]) },
    { id: 'toCourt', w: 3.4, pts: spline([[13.5, 8], [22, 14], toWorld(court, 0, -court.d / 2 - 2.5)]) },
    { id: 'toField', w: 3.6, pts: spline([[3, 15.6], [4.5, 24], [5.6, 32.5]]) },
    { id: 'toLawn', w: 3.4, pts: spline([[-11, 11.5], [-17, 16.5], [-21, 20]]) },
    { id: 'toGarden', w: 3.4, pts: spline([[-15.8, 2.5], [-24, 1.5], [-32.5, -1]]) },
    { id: 'toToss', w: 3.4, pts: spline([[-9.5, -32], [-20, -36], [-31, -38.5], [tossPads[1].x + 3, tossPads[1].z + 3]]) },
    { id: 'gymToStage', w: 3.0, pts: spline([[10.5, -31], [17, -30.5], toWorld(stage, -14.5, 3)]) },
    { id: 'gardenToToss', w: 3.0, pts: spline([[-46, -21], [-46.5, -26], [tossPads[0].x + 2, tossPads[0].z + 2.5]]) },
    { id: 'isleWalk', w: 2.8, pts: spline([bridgeEnd, toWorld(boutique, 0, 5.2)]) },
  ];

  // ---------------------------------------------------------------- places (Contract 1)
  const places = {
    plaza: { x: 0, z: 9.5, facing: Math.PI },
    gym: { x: gym.x, z: gym.z, w: gym.w, d: gym.d, facing: gym.facing },
    stage: { x: stage.x, z: stage.z, facing: stage.facing },
    tossPads: tossPads.map((p) => ({ id: p.id, x: p.x, z: p.z, facing: p.facing, targetPlatformId: p.targetPlatformId })),
    slides: slides.map((s) => ({ id: s.id, fromPlatformId: s.fromPlatformId, x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 })),
    hideGarden: {
      bounds: { x0: garden.x0, z0: garden.z0, x1: garden.x1, z1: garden.z1 },
      seekerStart: { ...hideGarden.seekerStart },
      hideSpots: hideGarden.spots.map((s) => ({ id: s.id, x: s.x, z: s.z, kind: s.kind, r: s.r })),
    },
    court: { x: court.x, z: court.z, w: court.w, d: court.d, facing: court.facing },
    bowField: { x: bowField.x, z: bowField.z, w: bowField.w, d: bowField.d, facing: bowField.facing, bases: [baseAt(0), baseAt(1)] },
    tagZone: { bounds: { ...tag } },
    photoBooth: { x: photoBooth.x, z: photoBooth.z, facing: photoBooth.facing },
    // extras (not in the contract, handy for the app, audio and content)
    cake: { x: cake.x, z: cake.z, r: cake.r },
    fountain: { x: fountain.x, z: fountain.z, r: fountain.r },
    isle: { x: isle.x, z: isle.z, r: isle.r },
    boutique: { x: boutique.x, z: boutique.z, facing: boutique.facing },
    bridge: { x0: bridge.x0, z0: bridge.z0, x1: bridge.x1, z1: bridge.z1, w: bridge.halfWidth * 2 },
    waterfalls: waterfalls.map((w) => ({ id: w.id, x: w.lip[0], z: w.lip[1] })),
    pond: { x: pond.x, z: pond.z, facing: pond.facing, r: pond.r }, // r: the water's radius
  };

  const plan = {
    center: CENTER, main, isle, isleOutline, places, platforms, slides, bridge, pads, knolls, paths, waterfalls, pond,
    plazaC, cake, fountain, gym, stage, court, bowField, tag, garden, gardenPlan: hideGarden, photoBooth, boutique,
    toss: { bearing: tossBearing, u: [ux, uz], v: [vx, vz], pads: tossPads },
  };
  plan.secrets = secretSpots(plan);
  places.secrets = plan.secrets.map((s) => ({ ...s }));
  plan.ground = createGround(plan);
  return plan;
}

// ------------------------------------------------------------------------------------- the garden
// A hedge-walled garden full of things to crouch behind, with two gates (east toward the plaza,
// north toward the toss headland). Objects are laid out in the garden's own frame (origin at its
// centre, +Z south). Each hide spot sits on the far side of its object from the seeker and is
// checked against every collider, so a character can really stand there.
// Kinds: hedge, bush, slide, tent, rack, cloud, barrel, curtain.
export const GARDEN_WALL = 1.1; // hedge wall thickness
const PLAYER_R = 0.45;

// The solid footprint of a garden object (what the colliders use and the art fills).
export function gardenShape(o) {
  const s = o.size;
  switch (o.kind) {
    case 'hedge': return { kind: 'box', w: s, d: 1.2 };
    case 'bush': return { kind: 'circle', r: s };
    case 'slide': return { kind: 'box', w: 1.3, d: 4.2 };
    case 'tent': return { kind: 'circle', r: 1.7 * s };
    case 'rack': return { kind: 'box', w: 2.4, d: 0.6 };
    case 'cloud': return { kind: 'circle', r: 1.55 * s };
    case 'barrel': return { kind: 'circle', r: 0.95 };
    case 'curtain': return { kind: 'box', w: 2.6, d: 0.5 };
    default: return { kind: 'circle', r: 1 };
  }
}

function makeGarden(g) {
  const cx = (g.x0 + g.x1) / 2;
  const cz = (g.z0 + g.z1) / 2;
  // [kind, lx, lz, ry, size]: ry turns the object (radians), size is its main dimension
  const list = [
    ['hedge', -9, -9.5, 0, 6], ['hedge', 5, -8.5, 0, 5], ['hedge', -2.5, 1.5, Math.PI / 2, 5.5],
    ['hedge', 8.5, 6.5, 0, 5], ['hedge', -11, 8, Math.PI / 2, 4.5],
    ['bush', -5, -4, 0, 1.6], ['bush', 9.5, -5.5, 0, 1.3], ['bush', -12, 0, 0, 1.7],
    ['slide', 4.5, -2.5, Math.PI / 2, 1], ['tent', -6, 10.5, 0.3, 1], ['tent', 11.5, 10, -0.4, 0.9],
    ['rack', 1, 6, 0, 1], ['rack', -12.5, -4.5, Math.PI / 2, 1],
    ['cloud', -7, 4, 0, 1.25], ['cloud', -1.5, -10.5, 0, 1.15], ['cloud', 0, 10.5, 0, 1.2],
    ['barrel', 11.5, 2, 0, 1], ['barrel', -1.5, -6.5, 0, 1],
    ['curtain', 6, 10.5, 0, 1], ['curtain', 12, -10.5, Math.PI / 2, 1],
  ];
  const objects = list.map(([kind, lx, lz, ry, size], i) => ({ id: 'obj' + (i + 1), kind, x: cx + lx, z: cz + lz, ry, size }));
  const gate = { x: g.x1, z: cz - 4, half: 2.4 };
  const north = { x: cx + 3, z: g.z0, half: 2.4 };
  // the seeker counts at a tree just inside the east gate, looking out of the garden
  const seeker = { x: g.x1 - 2.8, z: gate.z, facing: Math.PI / 2 };
  const tree = { x: g.x1 - 1.5, z: gate.z - 3.6, r: 0.5 };

  const colliders = [];
  const T = GARDEN_WALL;
  const walls = [];
  const wall = (x0, z0, x1, z1) => {
    walls.push({ x0, z0, x1, z1 });
    colliders.push({ kind: 'box', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: T, d: Math.hypot(x1 - x0, z1 - z0), rot: Math.atan2(x1 - x0, z1 - z0), tag: 'garden' });
  };
  wall(g.x0, g.z0, g.x0, g.z1); // west
  wall(g.x0, g.z1, g.x1, g.z1); // south
  wall(g.x1, g.z1, g.x1, gate.z + gate.half); // east, south of the gate
  wall(g.x1, gate.z - gate.half, g.x1, g.z0); // east, north of the gate
  wall(g.x0, g.z0, north.x - north.half, g.z0); // north, west of the gate
  wall(north.x + north.half, g.z0, g.x1, g.z0); // north, east of the gate
  const shapes = objects.map((o) => {
    const sh = gardenShape(o);
    if (sh.kind === 'box') colliders.push({ kind: 'box', x: o.x, z: o.z, w: sh.w, d: sh.d, rot: o.ry, tag: 'garden' });
    else colliders.push({ kind: 'circle', x: o.x, z: o.z, r: sh.r, tag: 'garden' });
    return { o, ...sh };
  });
  colliders.push({ kind: 'circle', x: tree.x, z: tree.z, r: tree.r, tag: 'garden' });

  const clear = (x, z) => {
    const m = T / 2 + PLAYER_R;
    if (x < g.x0 + m || x > g.x1 - m || z < g.z0 + m || z > g.z1 - m) return false;
    for (const sh of shapes) {
      if (sh.kind === 'circle') {
        if (Math.hypot(x - sh.o.x, z - sh.o.z) < sh.r + PLAYER_R + 0.05) return false;
      } else if (rectDistance(x, z, { x: sh.o.x, z: sh.o.z, w: sh.w, d: sh.d, facing: sh.o.ry }) < PLAYER_R + 0.05) return false;
    }
    return Math.hypot(x - tree.x, z - tree.z) >= tree.r + PLAYER_R;
  };
  const spots = shapes.map((sh, i) => {
    const o = sh.o;
    let dx;
    let dz;
    let reach;
    if (sh.kind === 'box') {
      // along the object's local normal, on the side away from the seeker
      dx = Math.sin(o.ry);
      dz = Math.cos(o.ry);
      if ((o.x - seeker.x) * dx + (o.z - seeker.z) * dz < 0) { dx = -dx; dz = -dz; }
      reach = sh.d / 2 + PLAYER_R + 0.35;
    } else {
      dx = o.x - seeker.x;
      dz = o.z - seeker.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      reach = sh.r + PLAYER_R + 0.35;
    }
    let x = o.x + dx * reach;
    let z = o.z + dz * reach;
    if (!clear(x, z)) {
      // swing round the object until there is room
      search: for (const turn of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, Math.PI]) {
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const rx = dx * c - dz * s;
        const rz = dx * s + dz * c;
        for (const extra of [0, 0.5, 1.0]) {
          const k = reach + extra + (sh.kind === 'box' ? (Math.abs(Math.sin(turn)) * sh.w) / 2 : 0);
          if (clear(o.x + rx * k, o.z + rz * k)) {
            x = o.x + rx * k;
            z = o.z + rz * k;
            break search;
          }
        }
      }
    }
    return { id: 'spot' + (i + 1), kind: o.kind, x, z, r: o.kind === 'hedge' ? 1.3 : 1.0, object: o.id };
  });
  return { objects, spots, seekerStart: seeker, gate, north, tree, walls, colliders, clear };
}

// Little nooks worth hiding a collectible in (content and the app decide what goes there).
function secretSpots(plan) {
  const { gym, platforms, boutique, gardenPlan, knolls } = plan;
  const behindGym = toWorld(gym, -9, -gym.d / 2 - 1.6);
  const behindShop = toWorld(boutique, 3.5, -boutique.d / 2 - 1.4);
  const spots = [
    { id: 'cloudTop', x: platforms[2].x, y: platforms[2].y, z: platforms[2].z, note: 'on the highest cloud' },
    { id: 'behindGym', x: behindGym[0], z: behindGym[1], note: 'behind the gym' },
    { id: 'bigTree', x: knolls[0].x + 2.2, z: knolls[0].z + 1.6, note: 'under the big tree on the hill' },
    { id: 'isle', x: behindShop[0], z: behindShop[1], note: 'behind the bow boutique' },
    { id: 'garden', x: gardenPlan.objects[9].x - 1.6, z: gardenPlan.objects[9].z + 1.8, note: 'by the garden tent' },
    { id: 'lawnHill', x: knolls[2].x, z: knolls[2].z, note: 'on the hill behind the lawn' },
  ];
  return spots;
}

// ------------------------------------------------------------------------------------- the duck pond
// The pond's furniture in its own frame (local +Z is its front, the west shore where the dock goes in).
//   y: the levelled shore    water: the water's surface    dock: { x, z, w, d, facing, y } the walkable
//   deck (in groundAt), end/foot: the deck's two ends    bench, sign: { x, z, facing }
export const POND = Object.freeze({ waterUp: 0.1, deckUp: 0.26, dockW: 1.5, dockIn: 2.7, dockOut: 1.1, rimR: 0.5, rimAt: 0.3 });
export function makePond({ x, z, r, facing, y }) {
  const p = { x, z, facing };
  const lz0 = r - POND.dockIn; // the dock's end, over the water
  const lz1 = r + POND.dockOut; // its foot, on the shore
  const [dx, dz] = toWorld(p, 0, (lz0 + lz1) / 2);
  const [ex, ez] = toWorld(p, 0, lz0 + 0.55);
  const [fx, fz] = toWorld(p, 0, lz1 + 1.2);
  const [sx, sz] = toWorld(p, -2.3, r + 1.25);
  const [bx, bz] = toWorld(p, -(r + 1.45), -0.6);
  return {
    x, z, r, facing, y, water: y + POND.waterUp,
    dock: { x: dx, z: dz, w: POND.dockW, d: lz1 - lz0, facing, y: y + POND.deckUp },
    end: { x: ex, z: ez }, // where she stands to feed them from the dock
    foot: { x: fx, z: fz, facing: facing + Math.PI }, // on the shore at the dock's foot, looking out
    sign: { x: sx, z: sz, facing: facing - 0.45 },
    bench: { x: bx, z: bz, facing: facing + Math.PI / 2 - 0.1 }, // on the north shore, looking at the water
  };
}
// What is solid at the pond: rim stones all round the water except where the dock goes in, low rails
// along the dock's sides and across its end, the bench and the sign. Pure ({ kind, x, z, ... } like
// planDecor's colliders), so the island registers them with everything else.
export function pondColliders(pond) {
  const out = [];
  const R = pond.r + POND.rimAt;
  const half = POND.dockW / 2;
  const n = Math.ceil((Math.PI * 2 * R) / 0.75);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lx = Math.sin(a) * R;
    const lz = Math.cos(a) * R;
    if (lz > 0 && Math.abs(lx) < half + 0.4) continue; // the dock's way in
    const [x, z] = toWorld(pond, lx, lz);
    out.push({ kind: 'circle', x, z, r: POND.rimR, tag: 'pond' });
  }
  const d = pond.dock;
  for (const side of [-1, 1]) {
    const [x, z] = toWorld(d, side * (half + 0.1), 0);
    out.push({ kind: 'box', x, z, w: 0.2, d: d.d, rot: d.facing, tag: 'pond' });
  }
  {
    const [x, z] = toWorld(d, 0, -d.d / 2 - 0.1);
    out.push({ kind: 'box', x, z, w: POND.dockW + 0.4, d: 0.2, rot: d.facing, tag: 'pond' });
  }
  out.push({ kind: 'box', x: pond.bench.x, z: pond.bench.z, w: 1.9, d: 0.7, rot: pond.bench.facing, tag: 'pond' });
  out.push({ kind: 'circle', x: pond.sign.x, z: pond.sign.z, r: 0.3, tag: 'pond' });
  return out;
}

// ------------------------------------------------------------------------------------- heights
function padDistance(p, x, z) {
  if (p.kind === 'disc') return Math.max(0, Math.hypot(x - p.x, z - p.z) - p.r);
  return rectDistance(x, z, p);
}

// The analytic shape of the island's top: soft rolling lawns, knolls, flat pads for every place,
// and a gentle roll-off at the rim.
function makeIslandHeight(plan) {
  const { main, pads, knolls } = plan;
  return function islandHeight(x, z) {
    let h = (valueNoise2(x * 0.052 + 7.1, z * 0.052 + 3.3) - 0.5) * 1.7;
    h += (valueNoise2(x * 0.13 + 1.7, z * 0.13 + 9.1) - 0.5) * 0.45;
    for (let i = 0; i < knolls.length; i++) {
      const k = knolls[i];
      const d = Math.hypot(x - k.x, z - k.z);
      if (d < k.r) h += k.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / k.r));
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (Math.abs(x - p.x) > p.reach || Math.abs(z - p.z) > p.reach) continue;
      const d = padDistance(p, x, z);
      if (d < p.blend) {
        const t = 1 - smoothstep(0, p.blend, d);
        // the pad wins inside, but knolls stay hills (pads only shave the rolling noise)
        h = lerp(h, p.y, t);
      }
    }
    const m = main.margin(x, z);
    h -= 0.55 * (1 - smoothstep(0, 4.5, m));
    return h;
  };
}

// Height profile of a rainbow slide: s = 0 at the platform, 1 at the bottom. Eases in and out,
// so it leaves the cloud gently, swoops, and runs out flat onto the grass.
export function slideProfile(s) {
  s = clamp(s, 0, 1);
  return 1 - s * s * (3 - 2 * s);
}

// Height of the bridge deck at fraction s along it.
export function bridgeProfile(b, s) {
  return lerp(b.y0, b.y1, s) + b.arch * Math.sin(Math.PI * clamp(s, 0, 1));
}

// ------------------------------------------------------------------------------------- groundAt
export function createGround(plan, { cell = GRID_CELL } = {}) {
  const { main, isle, isleOutline, platforms, slides, bridge, stage } = plan;
  const islandHeight = makeIslandHeight(plan);

  // ---- height grid over the main island
  const pad = 6;
  const X0 = Math.floor((main.cx - main.maxR - pad) / cell) * cell;
  const Z0 = Math.floor((main.cz - main.maxR - pad) / cell) * cell;
  const X1 = Math.ceil((main.cx + main.maxR + pad) / cell) * cell;
  const Z1 = Math.ceil((main.cz + main.maxR + pad) / cell) * cell;
  const NX = Math.round((X1 - X0) / cell);
  const NZ = Math.round((Z1 - Z0) / cell);
  const H = new Float32Array((NX + 1) * (NZ + 1));
  const M = new Float32Array((NX + 1) * (NZ + 1)); // rim margin at each vertex (> 0 inside)
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = X0 + i * cell;
      const z = Z0 + j * cell;
      H[j * (NX + 1) + i] = islandHeight(x, z);
      M[j * (NX + 1) + i] = main.margin(x, z);
    }
  }
  // Triangle-exact interpolation, with the same diagonal split as the ground mesh.
  function gridHeight(x, z) {
    const fx = (x - X0) / cell;
    const fz = (z - Z0) / cell;
    if (!(fx >= 0 && fz >= 0 && fx < NX && fz < NZ)) return islandHeight(x, z);
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const k = j * (NX + 1) + i;
    const h00 = H[k];
    const h10 = H[k + 1];
    const h01 = H[k + NX + 1];
    const h11 = H[k + NX + 2];
    if (((i + j) & 1) === 0) {
      return v >= u ? h00 + (h01 - h00) * v + (h11 - h01) * u : h00 + (h10 - h00) * u + (h11 - h10) * v;
    }
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // ---- the stage: a raised spring floor and two sets of walkable bleachers
  const STAGE_MAT_Y = 0.2;
  const matHalf = stage.mat / 2;
  const bleachers = [-1, 1].map((side) => ({ side, lx: side * 11.2, lz: 1, len: 10, rows: 3, rise: 0.42, depth: 0.85 }));
  const stageReach = Math.hypot(15, 15);
  function stageHeight(x, z, base) {
    const [lx, lz] = toLocal(stage, x, z);
    if (Math.abs(lx) <= matHalf && Math.abs(lz) <= matHalf) return base + STAGE_MAT_Y;
    for (const b of bleachers) {
      // rows climb away from the mat
      const across = (lx - b.lx) * b.side + (b.rows * b.depth) / 2;
      if (Math.abs(lz - b.lz) <= b.len / 2 && across >= 0 && across < b.rows * b.depth) {
        return base + (Math.floor(across / b.depth) + 1) * b.rise;
      }
    }
    return NaN;
  }

  // ---- sky structures: cloud platforms, rainbow slides and the bridge
  const near = { t: 0, d2: 0 };
  const slideData = slides.map((s) => {
    const y1 = gridHeight(s.x1, s.z1);
    s.y1 = y1;
    const pad2 = s.halfWidth + 0.01;
    return {
      s, y1, hw2: s.halfWidth * s.halfWidth,
      minX: Math.min(s.x0, s.x1) - pad2, maxX: Math.max(s.x0, s.x1) + pad2,
      minZ: Math.min(s.z0, s.z1) - pad2, maxZ: Math.max(s.z0, s.z1) + pad2,
    };
  });
  function slideY(sd, x, z) {
    const s = sd.s;
    segNear(s.x0, s.z0, s.x1, s.z1, x, z, near);
    if (near.d2 > sd.hw2) return NaN;
    return sd.y1 + (s.y0 - sd.y1) * slideProfile(near.t);
  }
  bridge.y0 = gridHeight(bridge.x0, bridge.z0) + 0.12;
  const bridgeBox = {
    minX: Math.min(bridge.x0, bridge.x1) - bridge.halfWidth, maxX: Math.max(bridge.x0, bridge.x1) + bridge.halfWidth,
    minZ: Math.min(bridge.z0, bridge.z1) - bridge.halfWidth, maxZ: Math.max(bridge.z0, bridge.z1) + bridge.halfWidth,
    hw2: bridge.halfWidth * bridge.halfWidth,
  };
  function bridgeY(x, z) {
    segNear(bridge.x0, bridge.z0, bridge.x1, bridge.z1, x, z, near);
    if (near.d2 > bridgeBox.hw2) return NaN;
    return bridgeProfile(bridge, near.t);
  }
  // the duck pond's dock: a flat deck a step up from the shore
  const dock = plan.pond ? plan.pond.dock : null;
  const dockReach = dock ? Math.hypot(dock.w, dock.d) / 2 : 0;
  const dockC = dock ? Math.cos(dock.facing) : 1;
  const dockS = dock ? Math.sin(dock.facing) : 0;
  function dockY(x, z) {
    const dx = x - dock.x;
    const dz = z - dock.z;
    if (Math.abs(dx) > dockReach || Math.abs(dz) > dockReach) return NaN;
    return Math.abs(dx * dockC - dz * dockS) <= dock.w / 2 && Math.abs(dx * dockS + dz * dockC) <= dock.d / 2 ? dock.y : NaN;
  }
  // the isle: a low dome, flat enough for a shop
  function isleHeight(x, z) {
    const d = Math.hypot(x - isle.x, z - isle.z);
    const m = isleOutline.margin(x, z);
    return isle.y + 0.35 * (1 - smoothstep(0, isle.r, d)) - 0.35 * (1 - smoothstep(0, 3, m));
  }

  function groundAt(x, z) {
    let best = -Infinity;
    // cloud platforms: flat discs
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.r * p.r && p.y > best) best = p.y;
    }
    for (let i = 0; i < slideData.length; i++) {
      const sd = slideData[i];
      if (x < sd.minX || x > sd.maxX || z < sd.minZ || z > sd.maxZ) continue;
      const y = slideY(sd, x, z);
      if (y > best) best = y;
    }
    if (x >= bridgeBox.minX && x <= bridgeBox.maxX && z >= bridgeBox.minZ && z <= bridgeBox.maxZ) {
      const y = bridgeY(x, z);
      if (y > best) best = y;
    }
    // the isle
    {
      const dx = x - isle.x;
      const dz = z - isle.z;
      if (dx * dx + dz * dz < (isleOutline.maxR + 1) * (isleOutline.maxR + 1) && isleOutline.margin(x, z) >= 0) {
        const y = isleHeight(x, z);
        if (y > best) best = y;
      }
    }
    // the main island
    if (main.margin(x, z) >= 0) {
      let y = gridHeight(x, z);
      const sx = x - stage.x;
      const sz = z - stage.z;
      if (sx * sx + sz * sz < stageReach * stageReach) {
        const st = stageHeight(x, z, y);
        if (st === st) y = st;
      }
      if (dock) {
        const dy = dockY(x, z);
        if (dy > y) y = dy;
      }
      if (y > best) best = y;
    }
    return best;
  }

  return {
    groundAt, islandHeight, gridHeight, isleHeight, stageHeight, slideY: (i, x, z) => slideY(slideData[i], x, z), bridgeY,
    insideMain: (x, z) => main.margin(x, z) >= 0,
    insideIsle: (x, z) => isleOutline.margin(x, z) >= 0,
    grid: { X0, Z0, NX, NZ, cell, H, M },
    stageMatY: STAGE_MAT_Y, bleachers,
  };
}
