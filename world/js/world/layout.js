// League World town plan. PURE: no three.js, no DOM. Runs in Node and the browser.
//
// Axes: Y up, +Z is DOWNHILL (south). The Hill sits at the far north (most negative z) and is the
// highest ground; The Dump sits at the far south and is the lowest. Altitude is the standings.
//
//   makeLayout({ heights, bubble, park })  ->  { lots, places, road, zones, ... }
//
// A lot is { tier, index, x, z, y, facing, w, d, curb: [x, z], street: [x, z] }.
// `facing` is a rotation about Y (three.js rotation.y) that turns the home's local +Z toward its
// street. `y` is the height of the flat pad the terrain cuts for the lot.

import { clamp, lerp, smoothstep, hash2, DEG } from '../core/util.js';

export const ROAD_WIDTH = 7;

export const LOT_SIZE = {
  hill: { w: 44, d: 40 },
  heights: { w: 20, d: 20 },
  bubble: { w: 18, d: 18 },
  park: { w: 15, d: 13 },
  dump: { w: 24, d: 24, r: 12 },
};

// Rotation about Y that makes local +Z point from (x, z) toward (tx, tz).
export function faceToward(x, z, tx, tz) {
  return Math.atan2(tx - x, tz - z);
}

// Distance from a point to the outside of a rotated rectangle (0 when inside).
export function rectDistance(px, pz, rect) {
  const dx = px - rect.x;
  const dz = pz - rect.z;
  const c = Math.cos(rect.facing || 0);
  const s = Math.sin(rect.facing || 0);
  const lx = Math.abs(dx * c - dz * s) - rect.w / 2;
  const lz = Math.abs(dx * s + dz * c) - rect.d / 2;
  const ox = lx > 0 ? lx : 0;
  const oz = lz > 0 ? lz : 0;
  return Math.sqrt(ox * ox + oz * oz);
}

// Corners of a rotated rect as [[x, z] x4].
export function rectCorners(rect, grow = 0) {
  const c = Math.cos(rect.facing || 0);
  const s = Math.sin(rect.facing || 0);
  const hw = rect.w / 2 + grow;
  const hd = rect.d / 2 + grow;
  const out = [];
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    out.push([rect.x + lx * c + lz * s, rect.z - lx * s + lz * c]);
  }
  return out;
}

function easeMix(t, k = 0.6) {
  t = clamp(t, 0, 1);
  return lerp(t, t * t * (3 - 2 * t), k);
}

function cnt(v, fallback) {
  const n = Number.isFinite(v) ? Math.round(v) : fallback;
  return clamp(n, 0, 6);
}

// Uniform Catmull-Rom through control points, then resampled to an even spacing.
function spline(ctrl, spacing) {
  const dense = [];
  const n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(n - 1, i + 2)];
    const steps = 14;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  dense.push(ctrl[n - 1].slice());
  return resample(dense, spacing);
}

export function resample(points, spacing) {
  const out = [points[0].slice()];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    let d = spacing - carry;
    while (d <= len) {
      const t = d / len;
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      d += spacing;
    }
    carry = len - (d - spacing);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.35) out.push(last.slice());
  else out[out.length - 1] = last.slice();
  return out;
}

export function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

// Nearest point on a polyline. Returns { d, i, t, x, z } (segment index i, fraction t).
export function nearestOnPolyline(points, px, pz) {
  let best = Infinity;
  let bi = 0;
  let bt = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i][0];
    const az = points[i][1];
    const bx = points[i + 1][0] - ax;
    const bz = points[i + 1][1] - az;
    const l2 = bx * bx + bz * bz;
    let t = l2 > 0 ? ((px - ax) * bx + (pz - az) * bz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + bx * t);
    const dz = pz - (az + bz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      bi = i;
      bt = t;
    }
  }
  const a = points[bi];
  const b = points[bi + 1] || a;
  return { d: Math.sqrt(best), i: bi, t: bt, x: lerp(a[0], b[0], bt), z: lerp(a[1], b[1], bt) };
}

// Smallest ring radius (to the lot fronts) that fits n lots of width w around a circle with one
// street entrance. Returns { rf, gap } in meters / radians.
function solveRing(n, w, minRf) {
  let rf = minRf;
  for (let guard = 0; guard < 200; guard++) {
    const gap = Math.asin(Math.min(1, (ROAD_WIDTH / 2 + 2.5) / rf));
    const arc = Math.PI * 2 - 2 * gap;
    const lotAngle = 2 * Math.atan((w / 2 + 0.8) / rf);
    if (n * lotAngle <= arc) return { rf, gap, arc, lotAngle };
    rf += 0.25;
  }
  return { rf, gap: 0.3, arc: Math.PI * 2 - 0.6, lotAngle: 0.5 };
}

export function makeLayout(counts = {}) {
  const nH = cnt(counts.heights, 3);
  const nB = cnt(counts.bubble, 4);
  const nP = cnt(counts.park, 3);

  // ---------------------------------------------------------------- stations, top to bottom
  const hill = { x: 0, z: -122, y: 23.5 };
  const fountain = { x: 0, z: -62, y: 13, r: 12, basinR: 3.6, laneR: 8.2 };
  const plaza = { x: 0, z: 0, y: 6, r: 22 };

  const ring = solveRing(nB, LOT_SIZE.bubble.w, 13);
  const grow = Math.max(0, ring.rf - 13);
  const bulb = { x: 30 + Math.min(5, grow * 0.8), z: 55, y: 2.5, r: ring.rf - 1.5, rf: ring.rf };

  // Bubble lots ring the bulb clockwise in rank order, starting on the uphill side of the entrance.
  const bubbleLots = [];
  const bubbleAngles = [];
  {
    const start = -Math.PI + ring.gap;
    const step = nB > 0 ? ring.arc / nB : 0;
    const R = ring.rf + LOT_SIZE.bubble.d / 2;
    for (let i = 0; i < nB; i++) {
      const a = start + step * (i + 0.5);
      bubbleAngles.push(a);
      const x = bulb.x + Math.cos(a) * R;
      const z = bulb.z + Math.sin(a) * R;
      bubbleLots.push({
        tier: 'bubble', index: i, x, z, y: bulb.y,
        facing: faceToward(x, z, bulb.x, bulb.z),
        w: LOT_SIZE.bubble.w, d: LOT_SIZE.bubble.d,
        curb: [bulb.x + Math.cos(a) * ring.rf, bulb.z + Math.sin(a) * ring.rf],
        street: [bulb.x + Math.cos(a) * bulb.r, bulb.z + Math.sin(a) * bulb.r],
      });
    }
  }
  let bubbleSouth = bulb.z + bulb.r + 2;
  for (const lot of bubbleLots) for (const c of rectCorners(lot)) bubbleSouth = Math.max(bubbleSouth, c[1]);

  // Everything south of the Bubble slides further south if an unusually big cul-de-sac needs room.
  const LANE_Z = 92;
  const shift = Math.max(0, bubbleSouth + 2.4 - (LANE_Z - 2.4));
  const laneZ = LANE_Z + shift;
  const fenceZ = laneZ + 19.5;
  const dump = { x: 0, z: fenceZ + 14.5, y: -1.0, r: LOT_SIZE.dump.r };
  const parkY = 0.8;

  const bounds = { minX: -75, maxX: 75, minZ: -150, maxZ: dump.z + 22 };

  // ---------------------------------------------------------------- the Boulevard
  const JX = -9.5; // where the cul-de-sac spur leaves the Boulevard
  const ROAD_X = 6.5; // the Boulevard through the trailer park
  const GATE_X = 4.5;
  const fa = (deg, r) => [fountain.x + Math.cos(deg * DEG) * r, fountain.z + Math.sin(deg * DEG) * r];
  const ctrl = [
    [0, hill.z + LOT_SIZE.hill.d / 2 + 0.5],
    [1.2, hill.z + 24.5],
    [15.5, hill.z + 32.5],
    [14, fountain.z - 17.5],
    fa(-30, fountain.laneR),
    fa(10, fountain.laneR),
    fa(50, fountain.laneR),
    fa(85, fountain.laneR),
    [-7, -44.5],
    [-8, -34],
    [-4, -22.5],
    [-6.6, -9],
    [-6.6, 6],
    [-3, 22.5],
    [-7, 34],
    [-9.5, 45],
    [JX, bulb.z],
    [-6 - grow * 0.9, bulb.z + 13 + shift * 0.3],
    [2 - grow * 1.1, bulb.z + 25 + shift * 0.7],
    [ROAD_X, laneZ],
    [ROAD_X, laneZ + 10],
    [GATE_X, fenceZ],
    [2, fenceZ + 3.6],
  ];
  const road = spline(ctrl, 2);
  const roadS = [0];
  for (let i = 1; i < road.length; i++) roadS.push(roadS[i - 1] + Math.hypot(road[i][0] - road[i - 1][0], road[i][1] - road[i - 1][1]));
  const roadLength = roadS[roadS.length - 1];

  // Vertical profile of the road: level through each neighborhood, eased grades between.
  const anchors = [[0, 3, hill.y]];
  const spanInside = (cx, cz, r) => {
    let a = -1;
    let b = -1;
    for (let i = 0; i < road.length; i++) {
      if (Math.hypot(road[i][0] - cx, road[i][1] - cz) <= r) {
        if (a < 0) a = i;
        b = i;
      }
    }
    return a < 0 ? null : [roadS[a], roadS[b]];
  };
  const fSpan = spanInside(fountain.x, fountain.z, fountain.r + 0.5);
  if (fSpan) anchors.push([fSpan[0], fSpan[1], fountain.y]);
  const pSpan = spanInside(plaza.x, plaza.z, plaza.r + 0.5);
  if (pSpan) anchors.push([pSpan[0], pSpan[1], plaza.y]);
  const sAt = (x, z) => {
    const n = nearestOnPolyline(road, x, z);
    return lerp(roadS[n.i], roadS[Math.min(road.length - 1, n.i + 1)], n.t);
  };
  const sJunction = sAt(JX, bulb.z);
  anchors.push([sJunction - 8, sJunction + 8, bulb.y]);
  const sLane = sAt(ROAD_X, laneZ);
  anchors.push([sLane - 6, sLane + 7, parkY]);
  anchors.push([roadLength - 1.5, roadLength, dump.y + 0.1]);
  const roadYAt = (s) => {
    if (s <= anchors[0][1]) return anchors[0][2];
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (s >= a[0] && s <= a[1]) return a[2];
      const b = anchors[i + 1];
      if (b && s > a[1] && s < b[0]) return lerp(a[2], b[2], easeMix((s - a[1]) / (b[0] - a[1]), 0.35));
    }
    return anchors[anchors.length - 1][2];
  };
  const roadY = roadS.map(roadYAt);

  const junction = [JX + ROAD_WIDTH / 2 - 0.2, bulb.z];
  const spur = resample([junction, [bulb.x - bulb.r + 0.3, bulb.z]], 2);

  // ---------------------------------------------------------------- base ground profile
  // Flat shelves joined by eased slopes. The Hill is a mesa: only the middle reaches full height.
  const shelves = [
    [-Infinity, hill.z + 22, 0],
    [fountain.z - 13, fountain.z + 13, fountain.y],
    [-26, 26, plaza.y],
    [bulb.z - 12, bulb.z + 15 + shift * 0.5, bulb.y],
    [laneZ - 7, laneZ + 14, parkY],
    [fenceZ + 5, Infinity, dump.y],
  ];
  function baseY(x, z) {
    const ax = Math.abs(x);
    const mesa = 1 - smoothstep(30, 58, ax);
    shelves[0][2] = 17.5 + (hill.y - 17.5) * mesa;
    let y = shelves[shelves.length - 1][2];
    for (let i = 0; i < shelves.length; i++) {
      const s = shelves[i];
      if (z <= s[1]) {
        if (z >= s[0]) y = s[2];
        else {
          const p = shelves[i - 1];
          y = lerp(p[2], s[2], easeMix((z - p[1]) / (s[0] - p[1])));
        }
        break;
      }
    }
    // Valley walls, a backdrop rise behind the mansion, and a berm beyond the landfill.
    const wall = Math.max(0, ax - 58) / 55;
    y += 26 * (1 - Math.exp(-wall * wall));
    const back = Math.max(0, bounds.minZ + 4 - z) / 50;
    y += 12 * (1 - Math.exp(-back * back));
    const berm = Math.max(0, z - (bounds.maxZ - 6)) / 40;
    y += 12 * (1 - Math.exp(-berm * berm));
    return y;
  }

  // ---------------------------------------------------------------- lots
  const hillLot = {
    tier: 'hill', index: 0, x: hill.x, z: hill.z, y: hill.y, facing: 0,
    w: LOT_SIZE.hill.w, d: LOT_SIZE.hill.d,
    curb: [hill.x, hill.z + LOT_SIZE.hill.d / 2],
    street: road[0].slice(),
  };

  // Heights: up to three lots ring the fountain circle (two west, one east of where the Boulevard
  // slips past the fountain). Leagues with more playoff teams get extra terraces just below.
  const heightsLots = [];
  {
    const rf = 15.5;
    const R = rf + LOT_SIZE.heights.d / 2;
    const half = Math.atan((LOT_SIZE.heights.w / 2 + 0.8) / rf) / DEG;
    const ringAngles = nH <= 0 ? [] : nH === 1 ? [205] : nH === 2 ? [205, 30] : [205 + half, 205 - half, 30];
    for (const deg of ringAngles) {
      const a = deg * DEG;
      const x = fountain.x + Math.cos(a) * R;
      const z = fountain.z + Math.sin(a) * R;
      heightsLots.push({
        tier: 'heights', x, z, y: fountain.y,
        facing: faceToward(x, z, fountain.x, fountain.z),
        w: LOT_SIZE.heights.w, d: LOT_SIZE.heights.d,
        curb: [fountain.x + Math.cos(a) * rf, fountain.z + Math.sin(a) * rf],
        street: [fountain.x + Math.cos(a) * fountain.r, fountain.z + Math.sin(a) * fountain.r],
      });
    }
    const overflow = [
      { x: -31, z: -28.5, y: 8.5, facing: Math.PI / 2 },
      { x: 33.5, z: -24.5, y: 8.5, facing: -Math.PI / 2 },
      { x: 52, z: -49, y: 11, facing: -Math.PI / 2 },
    ];
    for (let i = 0; i < nH - 3 && i < overflow.length; i++) {
      const o = overflow[i];
      const fx = Math.sin(o.facing);
      const fz = Math.cos(o.facing);
      const curb = [o.x + fx * LOT_SIZE.heights.d / 2, o.z + fz * LOT_SIZE.heights.d / 2];
      const near = nearestOnPolyline(road, curb[0], curb[1]);
      const dl = Math.max(0.001, Math.hypot(near.x - curb[0], near.z - curb[1]));
      const stop = Math.max(0, dl - ROAD_WIDTH / 2) / dl;
      heightsLots.push({
        tier: 'heights', x: o.x, z: o.z, y: o.y, facing: o.facing,
        w: LOT_SIZE.heights.w, d: LOT_SIZE.heights.d,
        curb, street: [lerp(curb[0], near.x, stop), lerp(curb[1], near.z, stop)],
      });
    }
    // Best rank lives highest: order north to south, ring lots before overflow terraces.
    heightsLots.sort((a, b) => (b.y - a.y) || (a.z - b.z) || (a.x - b.x));
    heightsLots.forEach((lot, i) => { lot.index = i; });
  }

  // Park: a ragged row of trailers backing onto the landfill fence, fronting a dirt lane.
  const parkLots = [];
  {
    const west = [ROAD_X - 14.5, ROAD_X - 32, ROAD_X - 49.5];
    const east = [ROAD_X + 22.5, ROAD_X + 40, ROAD_X + 57.5];
    const nWest = Math.min(3, nP);
    const xs = west.slice(0, nWest).concat(east.slice(0, nP - nWest));
    xs.sort((a, b) => Math.abs(b - GATE_X) - Math.abs(a - GATE_X)); // worst rank parks next to the gate
    xs.forEach((x, i) => {
      const j = hash2(Math.round(x * 3), 77);
      const k = hash2(Math.round(x * 5), 131);
      const z = laneZ + 10.2 + (j - 0.4) * 1.8;
      const facing = Math.PI + (k - 0.5) * 0.2;
      const fx = Math.sin(facing);
      const fz = Math.cos(facing);
      parkLots.push({
        tier: 'park', index: i, x, z, y: parkY, facing,
        w: LOT_SIZE.park.w, d: LOT_SIZE.park.d,
        curb: [x + fx * LOT_SIZE.park.d / 2, z + fz * LOT_SIZE.park.d / 2],
        street: [x + fx * 2, laneZ + 1.9],
      });
    });
  }

  const dumpLot = {
    tier: 'dump', index: 0, x: dump.x, z: dump.z, y: dump.y, facing: Math.PI,
    w: LOT_SIZE.dump.w, d: LOT_SIZE.dump.d, r: LOT_SIZE.dump.r,
    curb: [dump.x, dump.z - dump.r],
    street: road[road.length - 1].slice(),
  };

  const lots = { hill: [hillLot], heights: heightsLots, bubble: bubbleLots, park: parkLots, dump: [dumpLot] };

  // ---------------------------------------------------------------- park lane and landfill fence
  let laneMin = -12;
  let laneMax = 22;
  for (const lot of parkLots) {
    laneMin = Math.min(laneMin, lot.x - 10);
    laneMax = Math.max(laneMax, lot.x + 10);
  }
  const laneCtrl = [];
  for (let x = laneMin; x <= laneMax + 0.01; x += 6) laneCtrl.push([x, laneZ + Math.sin(x * 0.13) * 0.7]);
  const parkLane = resample(laneCtrl, 2);

  const gateX = nearestOnPolyline(road, GATE_X, fenceZ).x;
  const gateHalf = 5;
  const fence = [
    [[-72, fenceZ + 12], [-72, fenceZ], [gateX - gateHalf, fenceZ]],
    [[gateX + gateHalf, fenceZ], [72, fenceZ], [72, fenceZ + 12]],
  ];

  // ---------------------------------------------------------------- plaza buildings (flat pads)
  const buildings = {
    hallOfFame: { x: -34, z: -4, y: plaza.y, facing: Math.PI / 2, w: 16, d: 12 },
    leagueOffice: { x: 34, z: -4, y: plaza.y, facing: -Math.PI / 2, w: 14, d: 11 },
    graveyard: { x: -27, z: 21.5, y: plaza.y, facing: faceToward(-27, 21.5, -4, 2), w: 15, d: 13 },
  };

  // ---------------------------------------------------------------- zones
  // Blended along the valley. `edges` are the z values where one neighborhood hands over to the next.
  const zoneKeys = ['hill', 'heights', 'plaza', 'bubble', 'park', 'dump'];
  const edges = [hill.z + 23, -36, 29, laneZ - 6.5, fenceZ];
  const blends = [9, 9, 9, 7, 5];
  function weightsAt(x, z, out = {}) {
    let prev = 1;
    for (let i = 0; i < zoneKeys.length; i++) {
      const next = i < edges.length ? smoothstep(edges[i] - blends[i], edges[i] + blends[i], z) : 0;
      out[zoneKeys[i]] = prev * (1 - next);
      prev = prev * next;
    }
    return out;
  }
  const zones = {
    keys: zoneKeys,
    edges,
    bounds,
    weightsAt,
    hill: { center: [hill.x, hill.z], y: hill.y },
    heights: { center: [fountain.x, fountain.z], y: fountain.y },
    plaza: { center: [plaza.x, plaza.z], y: plaza.y, r: plaza.r },
    bubble: { center: [bulb.x, bulb.z], y: bulb.y },
    park: { center: [-10, laneZ + 9], y: parkY },
    dump: { center: [dump.x, dump.z], y: dump.y },
  };

  // ---------------------------------------------------------------- places
  const P = (x, z, facing = 0, extra) => Object.assign({ x, z, facing }, extra);
  const places = {
    spawnPlaza: P(4, 14, Math.PI),
    statue: P(plaza.x, plaza.z, 0),
    standingsBoard: P(13, -15.5, faceToward(13, -15.5, 3, 12)),
    matchupBoard: P(-16.5, -12, faceToward(-16.5, -12, 3, 12)),
    newspaperBox: P(11, 9, faceToward(11, 9, 3, 13)),
    hallOfFame: P(buildings.hallOfFame.x, buildings.hallOfFame.z, buildings.hallOfFame.facing, { w: 16, d: 12 }),
    leagueOffice: P(buildings.leagueOffice.x, buildings.leagueOffice.z, buildings.leagueOffice.facing, { w: 14, d: 11 }),
    graveyard: P(buildings.graveyard.x, buildings.graveyard.z, buildings.graveyard.facing, { w: 15, d: 13 }),
    fountain: P(fountain.x, fountain.z, 0, { r: fountain.r, basinR: fountain.basinR }),
    hillGate: P(hill.x, hill.z + LOT_SIZE.hill.d / 2, 0),
    overlook: P(hill.x, hill.z + LOT_SIZE.hill.d / 2 - 3, 0),
    culdesac: { x: bulb.x, z: bulb.z, r: bulb.r, rf: bulb.rf, spur, junction },
    parkLane,
    outhouseRow: P(ROAD_X + 9, laneZ + 9.5, -Math.PI / 2),
    burningBarrel: P(-14, laneZ - 5, 0),
    landfillGate: P(gateX, fenceZ, Math.PI, { width: gateHalf * 2 }),
    fence,
    dumpHeap: P(dump.x, dump.z, Math.PI, { r: dump.r }),
    blimpPath: { center: [0, -6], radius: 62, height: 54 },
    truckRoute: road.map((p) => p.slice()),
    truckUnload: P(road[road.length - 1][0], road[road.length - 1][1], faceToward(road[road.length - 2][0], road[road.length - 2][1], road[road.length - 1][0], road[road.length - 1][1])),
    // The painted playoff line. cutLine(i) is the boundary AFTER bubble lot i (between i and i + 1):
    // a segment from the middle of the cul-de-sac out between the two front yards.
    cutLine(indexAfter) {
      const n = bubbleAngles.length;
      const step = n > 0 ? ring.arc / n : ring.arc;
      const start = -Math.PI + ring.gap;
      const i = clamp(Math.round(indexAfter), -1, Math.max(-1, n - 1));
      const a = start + step * (i + 1);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const reach = ring.rf + 5;
      return {
        a: [bulb.x, bulb.z],
        b: [bulb.x + dx * reach, bulb.z + dz * reach],
        curb: [bulb.x + dx * bulb.r, bulb.z + dz * bulb.r],
        angle: a,
        // unit vector pointing at the playoff side (toward lot i, the better rank)
        inSide: [dz, -dx],
        y: bulb.y,
      };
    },
  };

  // ---------------------------------------------------------------- what the terrain must flatten
  const allLots = [hillLot, ...heightsLots, ...bubbleLots, ...parkLots];
  const pads = {
    rects: allLots.map((l) => ({ x: l.x, z: l.z, w: l.w, d: l.d, facing: l.facing, y: l.y, tier: l.tier, index: l.index }))
      .concat(Object.keys(buildings).map((k) => Object.assign({ tier: 'plaza', kind: k }, buildings[k]))),
    discs: [
      { x: fountain.x, z: fountain.z, r: fountain.r + 0.6, y: fountain.y, blend: 3, kind: 'fountain' },
      { x: plaza.x, z: plaza.z, r: plaza.r + 1.5, y: plaza.y, blend: 6, kind: 'plaza' },
      { x: bulb.x, z: bulb.z, r: bulb.r + 0.8, y: bulb.y, blend: 3, kind: 'bulb' },
      { x: dump.x, z: dump.z, r: dump.r + 1, y: dump.y, blend: 6, kind: 'dump' },
    ],
    corridors: [
      { kind: 'boulevard', pts: road, ys: roadY, half: ROAD_WIDTH / 2, flat: ROAD_WIDTH / 2 + 3.8, blend: ROAD_WIDTH / 2 + 9.5 },
      { kind: 'spur', pts: spur, ys: spur.map(() => bulb.y), half: ROAD_WIDTH / 2, flat: ROAD_WIDTH / 2 + 3.8, blend: ROAD_WIDTH / 2 + 8.5 },
      { kind: 'lane', pts: parkLane, ys: parkLane.map(() => parkY), half: 2.1, flat: 5.5, blend: 10 },
    ],
  };

  return {
    counts: { hill: 1, heights: nH, bubble: nB, park: nP, dump: 1 },
    lots, places, road, roadY, roadS, roadLength, zones, bounds, pads, buildings,
    stations: { hill, fountain, plaza, bulb, laneZ, fenceZ, dump, parkY, shift },
    baseY,
  };
}
