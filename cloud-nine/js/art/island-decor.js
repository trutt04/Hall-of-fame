// Where the island's furniture goes, and what is solid. PURE: no three.js, no DOM.
//
//   const decor = planDecor(plan, { quality })
//   decor.props        [{ type, x, z, ry, s, v }]  static things the art draws (trees, lamps, benches...)
//   decor.fences       [{ x0, z0, x1, z1 }]        picket fence runs
//   decor.colliders    [{ kind: 'circle', x, z, r } | { kind: 'box', x, z, w, d, rot }]
//   decor.garden       the hide-and-seek garden: walls, objects and hide spots, all collider-checked
//
// Everything is deterministic (seeded), so every device builds the same island and the hide spots
// in places.hideGarden match what the players see.

import { mulberry32, TAU } from '../core/util.js';
import { toWorld, rectDistance } from './island-layout.js';

// trunk and post sizes, shared with the art so colliders match what is drawn
export const SOLID = {
  tree: 0.45, bigTree: 1.1, lamp: 0.22, post: 0.22, sign: 0.3,
  bench: { w: 1.9, d: 0.7 }, boothW: 2.6, flagPole: 0.32, planter: 1.05, bush: 0.85,
};

function distToPath(path, x, z) {
  let best = Infinity;
  const p = path.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const ax = p[i][0];
    const az = p[i][1];
    const dx = p[i + 1][0] - ax;
    const dz = p[i + 1][1] - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}
function distToSeg(ax, az, bx, bz, x, z) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

export function planDecor(plan, { quality = 'high' } = {}) {
  void quality; // solid things never depend on quality; the art thins the rest
  const rnd = mulberry32(20151111);
  const props = [];
  const fences = [];
  const colliders = [];
  const P = plan.places;
  const circle = (x, z, r, tag) => colliders.push({ kind: 'circle', x, z, r, tag });
  const box = (x, z, w, d, rot = 0, tag) => colliders.push({ kind: 'box', x, z, w, d, rot, tag });
  const prop = (type, x, z, ry = 0, s = 1, v = 0, extra) => {
    const p = Object.assign({ type, x, z, ry, s, v }, extra);
    props.push(p);
    return p;
  };

  // ---------------------------------------------------------------- big structures
  circle(plan.cake.x, plan.cake.z, plan.cake.r, 'cake');
  circle(plan.fountain.x, plan.fountain.z, plan.fountain.r, 'fountain');
  box(plan.gym.x, plan.gym.z, plan.gym.w, plan.gym.d, plan.gym.facing, 'gym');
  for (const sx of [-1, 1]) {
    const [x, z] = toWorld(plan.gym, sx * 5.4, plan.gym.d / 2 + 3.1);
    circle(x, z, 0.28, 'gym');
  }
  box(plan.photoBooth.x, plan.photoBooth.z, SOLID.boothW, SOLID.boothW, plan.photoBooth.facing, 'booth');
  {
    const st = plan.stage;
    const [tx, tz] = toWorld(st, 0, 9.4);
    box(tx, tz, 6.4, 1.3, st.facing, 'stage');
    const [bx, bz] = toWorld(st, 0, -9.3);
    box(bx, bz, 15, 1.2, st.facing, 'stage');
    for (const sx of [-1, 1]) {
      const [x, z] = toWorld(st, sx * 8.6, -8.4);
      circle(x, z, 0.6, 'stage');
    }
  }
  // dodgeball benches along both long sides
  {
    const c = plan.court;
    for (const side of [-1, 1]) {
      for (const lz of [-6, 6]) {
        const [x, z] = toWorld(c, side * (c.w / 2 + 2.2), lz);
        box(x, z, 0.7, 3.2, c.facing, 'court');
        prop('courtBench', x, z, c.facing + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 1, side > 0 ? 1 : 0);
      }
    }
  }
  for (const b of P.bowField.bases) circle(b.x, b.z, SOLID.flagPole, 'field');

  // ---------------------------------------------------------------- the hide-and-seek garden
  const garden = plan.gardenPlan;
  for (const c of garden.colliders) colliders.push({ ...c });

  // ---------------------------------------------------------------- slides, platforms and the bridge
  for (const s of plan.slides) {
    const pf = plan.platforms.find((p) => p.id === s.fromPlatformId);
    const dx = s.x1 - s.x0;
    const dz = s.z1 - s.z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    // rails from where the slide leaves its cloud to the bottom
    const start = Math.max(0, pf.r + 0.2 - (pf.r - 0.7));
    const rot = Math.atan2(ux, uz);
    for (const side of [-1, 1]) {
      const ox = -uz * side * (s.halfWidth + 0.18);
      const oz = ux * side * (s.halfWidth + 0.18);
      const runs = Math.ceil((len - start) / 4);
      for (let k = 0; k < runs; k++) {
        const a = start + ((len - start) * k) / runs;
        const b = start + ((len - start) * (k + 1)) / runs;
        const m = (a + b) / 2;
        box(s.x0 + ux * m + ox, s.z0 + uz * m + oz, 0.36, b - a, rot, 'slide');
      }
    }
    // a fluffy rim round each cloud, open where its slide leaves
    const away = Math.atan2(s.x0 - pf.x, s.z0 - pf.z);
    const n = Math.round((TAU * (pf.r + 0.3)) / 0.9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      let d = a - away;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) * pf.r < s.halfWidth + 0.4) continue;
      circle(pf.x + Math.sin(a) * (pf.r + 0.35), pf.z + Math.cos(a) * (pf.r + 0.35), 0.5, 'cloudRim');
    }
  }
  {
    const b = plan.bridge;
    const dx = b.x1 - b.x0;
    const dz = b.z1 - b.z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const rot = Math.atan2(ux, uz);
    for (const side of [-1, 1]) {
      const ox = -uz * side * (b.halfWidth + 0.15);
      const oz = ux * side * (b.halfWidth + 0.15);
      const runs = Math.ceil(len / 4);
      for (let k = 0; k < runs; k++) {
        const m = (len * (k + 0.5)) / runs;
        box(b.x0 + ux * m + ox, b.z0 + uz * m + oz, 0.3, len / runs, rot, 'bridge');
      }
    }
  }

  // ---------------------------------------------------------------- the isle and its shop
  {
    const shop = plan.boutique;
    box(shop.x, shop.z, shop.w ?? 8, shop.d ?? 7, shop.facing, 'isle');
    // a ring of fence round the isle, open toward the bridge
    const isle = plan.isle;
    const toBridge = Math.atan2(plan.bridge.x1 - isle.x, plan.bridge.z1 - isle.z);
    const N = 40;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      let d = a - toBridge;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const r = plan.isleOutline.radiusAt(Math.atan2(Math.sin(a), -Math.cos(a))) - 1.1;
      const pt = [isle.x + Math.sin(a) * r, isle.z + Math.cos(a) * r];
      if (Math.abs(d) < 0.2) { prev = null; continue; }
      if (prev) fences.push({ x0: prev[0], z0: prev[1], x1: pt[0], z1: pt[1], island: 'isle' });
      prev = pt;
    }
    for (const [lx, lz, v] of [[-4.8, 3.8, 1], [5.2, 2.6, 2], [-2.6, -4.6, 0], [4.6, -3.8, 1]]) {
      const [x, z] = toWorld(shop, lx, lz);
      prop('tree', x, z, rnd() * TAU, 0.85, v);
      circle(x, z, SOLID.tree * 0.85, 'isle');
    }
    const [bx, bz] = toWorld(shop, -3.4, 6.6);
    prop('bench', bx, bz, shop.facing + Math.PI, 1, 0);
    box(bx, bz, SOLID.bench.w, SOLID.bench.d, shop.facing + Math.PI, 'isle');
    for (const sx of [-1, 1]) {
      const [lx, lz] = toWorld(shop, sx * 2.6, 6.2);
      prop('lamp', lx, lz, shop.facing, 1, 0);
      circle(lx, lz, SOLID.lamp, 'isle');
    }
  }

  // ---------------------------------------------------------------- waterfalls: little rim ponds
  for (const w of plan.waterfalls) circle(w.x, w.z, w.pondR + 0.2, 'falls');

  // ---------------------------------------------------------------- fences on the main island
  // the toss headland's rim (gaps where the rainbows come in) and the outer sides of the lawn
  {
    const toss = plan.toss;
    const B0 = toss.bearing - 22;
    const B1 = toss.bearing + 26;
    let prev = null;
    for (let b = B0; b <= B1; b += 2.5) {
      const r = plan.main.radiusAt((b * Math.PI) / 180) - 1.6;
      const pt = [plan.center.x + Math.sin((b * Math.PI) / 180) * r, plan.center.z - Math.cos((b * Math.PI) / 180) * r];
      if (prev) {
        const mx = (prev[0] + pt[0]) / 2;
        const mz = (prev[1] + pt[1]) / 2;
        const blocked = plan.slides.some((s) => distToSeg(s.x0, s.z0, s.x1, s.z1, mx, mz) < s.halfWidth + 1.3) ||
          plan.waterfalls.some((w) => Math.hypot(w.x - mx, w.z - mz) < w.pondR + 3);
        if (!blocked) fences.push({ x0: prev[0], z0: prev[1], x1: pt[0], z1: pt[1] });
      }
      prev = pt;
    }
    const t = plan.tag;
    fences.push({ x0: t.x0 - 1.2, z0: t.z0 + 4, x1: t.x0 - 1.2, z1: t.z1 + 1.2 });
    fences.push({ x0: t.x0 - 1.2, z0: t.z1 + 1.2, x1: t.x1 - 6, z1: t.z1 + 1.2 });
  }
  for (const f of fences) {
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    if (len < 0.05) continue;
    box((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, 0.24, len + 0.1, Math.atan2(f.x1 - f.x0, f.z1 - f.z0), 'fence');
  }

  // ---------------------------------------------------------------- what scatter must keep clear of
  const areas = [
    { kind: 'disc', x: plan.plazaC.x, z: plan.plazaC.z, r: plan.plazaC.r + 1.5 },
    { kind: 'disc', x: plan.fountain.x, z: plan.fountain.z, r: plan.fountain.court + 0.5 },
    { kind: 'rect', x: plan.gym.x, z: plan.gym.z + 2, w: plan.gym.w + 4, d: plan.gym.d + 8, facing: 0 },
    { kind: 'rect', x: plan.stage.x, z: plan.stage.z, w: 29, d: 24, facing: plan.stage.facing },
    { kind: 'rect', x: plan.court.x, z: plan.court.z, w: plan.court.w + 7, d: plan.court.d + 3, facing: plan.court.facing },
    { kind: 'rect', x: plan.bowField.x, z: plan.bowField.z, w: plan.bowField.w + 2, d: plan.bowField.d + 2, facing: plan.bowField.facing },
    { kind: 'rect', x: (plan.tag.x0 + plan.tag.x1) / 2, z: (plan.tag.z0 + plan.tag.z1) / 2, w: plan.tag.x1 - plan.tag.x0 + 1, d: plan.tag.z1 - plan.tag.z0 + 1, facing: 0 },
    { kind: 'rect', x: (plan.garden.x0 + plan.garden.x1) / 2, z: (plan.garden.z0 + plan.garden.z1) / 2, w: plan.garden.x1 - plan.garden.x0 + 2.5, d: plan.garden.z1 - plan.garden.z0 + 2.5, facing: 0 },
    { kind: 'disc', x: plan.photoBooth.x, z: plan.photoBooth.z, r: 3.5 },
    ...P.tossPads.map((p) => ({ kind: 'disc', x: p.x, z: p.z, r: 6 })),
    ...plan.waterfalls.map((w) => ({ kind: 'disc', x: w.x, z: w.z, r: w.pondR + 2 })),
    { kind: 'disc', x: plan.bridge.x0, z: plan.bridge.z0, r: 4 },
    { kind: 'disc', x: P.plaza.x, z: P.plaza.z, r: 4 },
  ];
  const inArea = (x, z, m) => areas.some((a) => (a.kind === 'disc' ? Math.hypot(x - a.x, z - a.z) < a.r + m : rectDistance(x, z, a) < m));
  const onPath = (x, z, m) => plan.paths.some((p) => distToPath(p, x, z) < p.w / 2 + m);
  const onSlide = (x, z, m) => plan.slides.some((s) => distToSeg(s.x0, s.z0, s.x1, s.z1, x, z) < s.halfWidth + m);
  const solidNear = (x, z, r) => colliders.some((c) => (c.kind === 'circle' ? Math.hypot(x - c.x, z - c.z) < c.r + r : rectDistance(x, z, { x: c.x, z: c.z, w: c.w, d: c.d, facing: c.rot }) < r));
  const near = (x, z, r, types) => props.some((p) => (!types || types.includes(p.type)) && Math.hypot(p.x - x, p.z - z) < r);

  // ---------------------------------------------------------------- the plaza ring
  {
    const R = plan.plazaC.r;
    // bearings where the paths leave the plaza ring (keep lamps and planters off them)
    const gaps = [0];
    for (const path of plan.paths) {
      for (const [x, z] of path.pts) {
        const r = Math.hypot(x - plan.plazaC.x, z - plan.plazaC.z);
        if (r >= R - 1 && r <= R + 4) {
          gaps.push((Math.atan2(x - plan.plazaC.x, -(z - plan.plazaC.z)) * 180) / Math.PI);
          break;
        }
      }
    }
    const clearOf = (deg) => gaps.every((g) => Math.abs(((deg - g + 540) % 360) - 180) > 10);
    for (let i = 0; i < 12; i++) {
      const deg = 15 + i * 30;
      if (!clearOf(deg)) continue;
      const a = (deg * Math.PI) / 180;
      const x = Math.sin(a) * (R + 1.0);
      const z = -Math.cos(a) * (R + 1.0);
      prop('lamp', x, z, Math.atan2(-x, -z), 1, 0);
      circle(x, z, SOLID.lamp, 'plaza');
    }
    for (const deg of [50, 130, 230, 310]) {
      const a = (deg * Math.PI) / 180;
      const x = Math.sin(a) * (R - 3.2);
      const z = -Math.cos(a) * (R - 3.2);
      const ry = Math.atan2(-x, -z);
      prop('bench', x, z, ry, 1, 1);
      box(x, z, SOLID.bench.w, SOLID.bench.d, ry, 'plaza');
    }
    for (const deg of [20, 82, 142, 200, 252, 336]) {
      if (!clearOf(deg)) continue;
      const a = (deg * Math.PI) / 180;
      const x = Math.sin(a) * (R - 1.2);
      const z = -Math.cos(a) * (R - 1.2);
      if (Math.hypot(x - plan.photoBooth.x, z - plan.photoBooth.z) < 4) continue;
      prop('planter', x, z, rnd() * TAU, 1, Math.floor(rnd() * 3));
      circle(x, z, SOLID.planter, 'plaza');
    }
    for (const deg of [-24, 24]) {
      const a = (deg * Math.PI) / 180;
      const x = Math.sin(a) * 6.4;
      const z = -Math.cos(a) * 6.4;
      prop('balloons', x, z, rnd() * TAU, 1, deg < 0 ? 0 : 1);
      circle(x, z, SOLID.post, 'plaza');
    }
    const sp = [6.2, 6.4];
    prop('signpost', sp[0], sp[1], 0, 1, 0);
    circle(sp[0], sp[1], SOLID.sign, 'plaza');
    // the gym forecourt: lamps and planters round the fountain
    for (const deg of [45, 135, 225, 315]) {
      const a = (deg * Math.PI) / 180;
      const x = plan.fountain.x + Math.sin(a) * (plan.fountain.court - 1.2);
      const z = plan.fountain.z - Math.cos(a) * (plan.fountain.court - 1.2);
      prop('lamp', x, z, Math.atan2(plan.fountain.x - x, plan.fountain.z - z), 1, 0);
      circle(x, z, SOLID.lamp, 'forecourt');
    }
    for (const sx of [-1, 1]) {
      const [x, z] = toWorld(plan.gym, sx * 9.6, plan.gym.d / 2 + 1.6);
      prop('balloons', x, z, 0, 1.1, sx > 0 ? 1 : 0);
      circle(x, z, SOLID.post, 'gym');
    }
  }

  // ---------------------------------------------------------------- lamps along the paths
  for (const path of plan.paths) {
    if (path.w > 5 || path.id === 'isleWalk') continue;
    const pts = path.pts;
    let run = 6;
    let side = 1;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dz = pts[i][1] - pts[i - 1][1];
      const l = Math.hypot(dx, dz);
      run += l;
      if (run < 13) continue;
      run = 0;
      const ox = (-dz / l) * side * (path.w / 2 + 0.9);
      const oz = (dx / l) * side * (path.w / 2 + 0.9);
      const x = pts[i][0] + ox;
      const z = pts[i][1] + oz;
      side = -side;
      if (plan.main.margin(x, z) < 2.5 || inArea(x, z, 0.4) || onSlide(x, z, 1) || solidNear(x, z, 0.6)) continue;
      prop('lamp', x, z, Math.atan2(-ox, -oz), 1, 0);
      circle(x, z, SOLID.lamp, 'path');
    }
  }

  // ---------------------------------------------------------------- hero trees
  {
    const k = plan.knolls[0];
    prop('bigTree', k.x, k.z, 0.4, 1, 0);
    circle(k.x, k.z, SOLID.bigTree, 'tree');
    const k2 = plan.knolls[1];
    prop('tree', k2.x, k2.z, 1.1, 1.15, 2);
    circle(k2.x, k2.z, SOLID.tree * 1.15, 'tree');
    const k3 = plan.knolls[3];
    prop('tree', k3.x, k3.z, 2.1, 1.1, 1);
    circle(k3.x, k3.z, SOLID.tree * 1.1, 'tree');
  }

  // ---------------------------------------------------------------- scatter: trees, bushes, flower beds
  // The same on every device (solid things must agree for multiplayer); 'low' only draws less.
  {
    const STEP = 6.5;
    const m = plan.main;
    for (let gz = m.cz - m.maxR; gz < m.cz + m.maxR; gz += STEP) {
      for (let gx = m.cx - m.maxR; gx < m.cx + m.maxR; gx += STEP) {
        const x = gx + (rnd() - 0.5) * STEP * 0.9;
        const z = gz + (rnd() - 0.5) * STEP * 0.9;
        const roll = rnd();
        const pick = rnd();
        const s = 0.8 + rnd() * 0.45;
        const ry = rnd() * TAU;
        const v = Math.floor(rnd() * 3);
        if (roll > 0.62) continue;
        const edge = m.margin(x, z);
        if (edge < 3.2) continue;
        if (inArea(x, z, 1.2) || onPath(x, z, 1.4) || onSlide(x, z, 2.5) || solidNear(x, z, 1.4)) continue;
        if (pick < 0.46) {
          if (near(x, z, 5.2, ['tree', 'bigTree'])) continue;
          // keep the view from the spawn to the gym open
          if (Math.abs(x) < 7 && z < -14 && z > -40) continue;
          prop('tree', x, z, ry, s, v);
          circle(x, z, SOLID.tree * s, 'tree');
        } else if (pick < 0.76) {
          if (near(x, z, 3.4)) continue;
          prop('flowers', x, z, ry, s, v);
        } else {
          if (near(x, z, 3)) continue;
          prop('bush', x, z, ry, s * 0.9, v);
          circle(x, z, SOLID.bush * s * 0.9, 'bush');
        }
      }
    }
    // flower beds hugging the plaza and the forecourt
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.5) / 10) * TAU;
      const x = Math.sin(a) * (plan.plazaC.r + 3.2);
      const z = -Math.cos(a) * (plan.plazaC.r + 3.2);
      if (onPath(x, z, 0.6) || near(x, z, 2.2) || solidNear(x, z, 0.8)) continue;
      prop('flowers', x, z, a, 0.9, i % 3);
    }
  }

  // the rim: pastel rocks and crystals along the edge (no colliders, purely pretty)
  {
    const m = plan.main;
    const n = 90;
    for (let i = 0; i < n; i++) {
      const b = (i / n) * TAU + rnd() * 0.02;
      const r = m.radiusAt(b) - 0.9 - rnd() * 1.6;
      const x = m.cx + Math.sin(b) * r;
      const z = m.cz - Math.cos(b) * r;
      if (onPath(x, z, 0.4) || onSlide(x, z, 0.6) || inArea(x, z, -0.5) || solidNear(x, z, 0.3)) continue;
      if (Math.hypot(x - plan.bridge.x0, z - plan.bridge.z0) < 4) continue;
      prop(rnd() < 0.3 ? 'crystal' : 'rock', x, z, rnd() * TAU, 0.6 + rnd() * 0.7, Math.floor(rnd() * 4));
    }
  }

  return { props, fences, colliders, garden, areas, onPath, inArea };
}
