// The island's landmarks, drawn into a batcher: the bow fountain, the cake's dais, the cheer gym,
// the Hit Zero stage, the photo booth, the signpost, the dodgeball court, the Capture the Bow
// field, the freeze tag lawn and everything in the hide-and-seek garden. Plus the furniture the
// decor plan scattered (trees, lamps, benches, planters, flowers, fences, rocks and crystals).
//
//   drawPlaces(plan, decor, batch, { yAt, blob, quality }) -> { flags: [...], parts }
//
// Every solid thing here has its collider in the decor plan (island-decor.js), sized to match.

import { Geo, TAU } from './geo.js';
import { rng } from './util.js';
import { toWorld } from './island-layout.js';
import { signWidth } from './island-decor.js';
import {
  K, FLOWER, shade, star, heart, bow, burst, puff, cottonTree, bigTree, lamp, bench, fence, flowerBed, bushy,
  planter, rock, crystal, text2, zoneKey,
} from './island-kit.js';

const tileKey = zoneKey;

// Draw in a place's frame: g.at(world position of the place, facing).
function inPlace(g, place, y = 0) {
  return g.at(place.x, y, place.z, place.facing || 0);
}

export function drawPlaces(plan, decor, batch, o) {
  const { yAt, blob } = o;
  const low = o.quality === 'low';
  const r = rng(424242);
  const out = { flags: [], booth: null };

  // ---------------------------------------------------------------- scattered furniture
  for (const p of decor.props) {
    const key = tileKey(p.x, p.z);
    const g = batch.geo(key);
    const y = yAt(p.x, p.z);
    switch (p.type) {
      case 'tree':
        cottonTree(g, p.x, y - 0.05, p.z, p.s, p.v, rng(Math.round(p.x * 31 + p.z * 17)), { ry: p.ry, low });
        blob(p.x, p.z, 2.2 * p.s, 2.0 * p.s, 0.2);
        break;
      case 'bigTree':
        bigTree(g, p.x, y - 0.1, p.z, p.s, rng(9));
        blob(p.x, p.z, 5.2, 5.0, 0.22);
        break;
      case 'lamp':
        lamp(g, batch.geo(key, 'glow'), batch.geo(key, 'add'), p.x, y - 0.02, p.z, p.ry);
        blob(p.x, p.z, 0.5, 0.5, 0.22);
        break;
      case 'bench':
        bench(g, p.x, y, p.z, p.ry, { color: p.v ? K.pinkSoft : K.lilac });
        blob(p.x, p.z, 1.2, 0.55, 0.2, p.ry);
        break;
      case 'courtBench':
        bench(g, p.x, y, p.z, p.ry, { color: p.v ? 0xb7a2ff : K.pinkSoft });
        blob(p.x, p.z, 1.2, 0.55, 0.2, p.ry);
        break;
      case 'planter':
        planter(g, p.x, y - 0.02, p.z, r, p.v);
        blob(p.x, p.z, 1.3, 1.3, 0.18);
        break;
      case 'flowers':
        if (low && Math.round(p.x * 7 + p.z) % 2) break;
        flowerBed(g, p.x, y, p.z, 1.25 * p.s, rng(Math.round(p.x * 13 + p.z * 7)));
        break;
      case 'bush':
        bushy(g, p.x, y - 0.05, p.z, p.s, rng(Math.round(p.x * 5 + p.z * 11)), { color: [K.leaf, 0x9fe0c0, 0xb5e8a4][p.v % 3] });
        blob(p.x, p.z, 1.1 * p.s, 1.0 * p.s, 0.18);
        break;
      case 'rock':
        if (low && Math.round(p.x * 3 + p.z) % 2) break;
        rock(g, p.x, y - 0.1, p.z, p.s, r, p.v);
        break;
      case 'crystal':
        if (low && Math.round(p.x * 3 + p.z) % 2) break;
        crystal(g, p.x, y, p.z, p.s, r, p.v);
        break;
      case 'balloons':
        // the weighted post; the balloons themselves float in island-life.js
        g.cyl(p.x, y, p.z, 0.22, 0.18, K.white, { seg: 6 });
        g.cyl(p.x, y + 0.18, p.z, 0.04, 0.9, K.pink, { seg: 4 });
        heart(g, p.x, y + 1.15, p.z, 0.32, K.pink, { thick: 0.06, ry: p.ry });
        break;
      case 'signpost':
        signpost(batch.geo(zoneKey(p.x, p.z)), plan, p.x, y, p.z);
        blob(p.x, p.z, 0.6, 0.6, 0.2);
        break;
      case 'sign': {
        // a little arena sign on two posts, readable from both sides
        const w = signWidth(p.label);
        g.at(p.x, y, p.z, p.ry);
        for (const sx of [-1, 1]) g.cyl(sx * (w / 2 - 0.15), 0, 0, 0.06, 1.25, K.white, { seg: 4 });
        g.box(0, 1.0, 0, w, 0.55, 0.1, p.color, { bottom: true, side: shade(p.color, 0.85) });
        text2(g, p.label, 0, 1.12, 0, 0.06, K.ink, { gap: 0.055 });
        g.restore();
        break;
      }
      default:
        break;
    }
  }
  for (const f of decor.fences) {
    const g = batch.geo(tileKey((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2));
    fence(g, f.x0, f.z0, f.x1, f.z1, yAt);
  }

  // ---------------------------------------------------------------- the plaza: the cake's dais
  {
    const c = plan.cake;
    const g = batch.geo(zoneKey(c.x, c.z));
    g.lathe(c.x, 0, c.z, [[c.r, 0, 0xffe2ef], [c.r, 0.22, 0xffffff], [c.r - 0.05, 0.27]], 0xffe2ef, { seg: 24, capTop: 0xfff6fa });
    g.lathe(c.x, 0.27, c.z, [[c.r - 0.55, 0, K.pinkSoft], [c.r - 0.55, 0.22, K.pinkPale], [c.r - 0.6, 0.26]], K.pinkSoft, { seg: 24, capTop: 0xffffff });
    // piping pearls round both steps
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      g.sphere(c.x + Math.sin(a) * c.r, 0.22, c.z + Math.cos(a) * c.r, 0.07, i % 2 ? K.rSilver : K.pinkPale, { seg: 4, rings: 2 });
    }
    blob(c.x, c.z, c.r + 0.5, c.r + 0.5, 0.18);
  }

  // ---------------------------------------------------------------- the bow fountain
  out.fountain = drawFountain(batch, plan.fountain);
  blob(plan.fountain.x, plan.fountain.z, plan.fountain.r + 0.8, plan.fountain.r + 0.8, 0.16);

  // ---------------------------------------------------------------- the gym and the stage
  drawGym(batch, plan.gym);
  blob(plan.gym.x, plan.gym.z + 0.5, plan.gym.w / 2 + 1.5, plan.gym.d / 2 + 1.5, 0.22);
  drawStage(batch, plan.stage, plan.ground);
  drawBooth(batch, plan.photoBooth);
  blob(plan.photoBooth.x, plan.photoBooth.z, 1.8, 1.8, 0.22);

  // ---------------------------------------------------------------- arenas
  drawCourtDeco(batch, plan.court, yAt);
  out.flags = drawFieldDeco(batch, plan, yAt);
  drawLawnDeco(batch, plan, yAt);
  drawGarden(batch, plan, yAt, blob, low);
  return out;
}

// ------------------------------------------------------------------------------------- signpost
function signpost(g, plan, x, y, z) {
  const P = plan.places;
  const toss = P.tossPads[1];
  const items = [
    ['CHEER GYM', P.gym, 0xffc4df],
    ['HIT ZERO', P.stage, 0xc9b6ff],
    ['BASKET TOSS', toss, 0xffe08a],
    ['HIDE AND SEEK', { x: (P.hideGarden.bounds.x0 + P.hideGarden.bounds.x1) / 2, z: (P.hideGarden.bounds.z0 + P.hideGarden.bounds.z1) / 2 }, 0xa9ecd0],
    ['DODGEBALL', P.court, 0xffb3d9],
    ['CAPTURE THE BOW', P.bowField, 0xffd0b0],
    ['FREEZE TAG', { x: (P.tagZone.bounds.x0 + P.tagZone.bounds.x1) / 2, z: (P.tagZone.bounds.z0 + P.tagZone.bounds.z1) / 2 }, 0x9fd8ff],
    ['BOW BOUTIQUE', P.boutique, 0xe7d6ff],
  ];
  const H = 6.0;
  g.cyl(x, y, z, 0.26, 0.2, K.pink, { seg: 6 });
  g.cyl(x, y + 0.2, z, 0.12, H, K.white, { seg: 6, rt: 0.1 });
  star(g, x, y + H + 0.55, z, 0.42, 0.18, K.pink, { thick: 0.1 });
  items.forEach(([label, place, col], i) => {
    const dx = place.x - x;
    const dz = place.z - z;
    const ry = Math.atan2(-dz, dx); // local +X points at the place
    const px = 0.052;
    const w = Math.max(1.4, (label.length * 4 - 1) * px + 0.5);
    const yy = y + H - 0.1 - i * 0.48;
    g.at(x, yy, z, ry);
    const x0 = 0.16;
    const x1 = x0 + w;
    const hh = 0.19;
    const th = 0.045;
    g.box(x0 + w / 2 - 0.1, -hh, 0, w - 0.2, hh * 2, th * 2, col, { bottom: true, side: shade(col, 0.85) });
    // arrow tip
    g.tri([x1 - 0.2, -hh - 0.05, th], [x1 + 0.22, 0, th], [x1 - 0.2, hh + 0.05, th], col);
    g.tri([x1 - 0.2, hh + 0.05, -th], [x1 + 0.22, 0, -th], [x1 - 0.2, -hh - 0.05, -th], col);
    g.quad([x1 - 0.2, -hh - 0.05, -th], [x1 + 0.22, 0, -th], [x1 + 0.22, 0, th], [x1 - 0.2, -hh - 0.05, th], shade(col, 0.85));
    g.quad([x1 + 0.22, 0, -th], [x1 - 0.2, hh + 0.05, -th], [x1 - 0.2, hh + 0.05, th], [x1 + 0.22, 0, th], shade(col, 0.85));
    text2(g, label, x0 + w / 2 - 0.05, -0.13, 0, px, K.ink, { gap: th + 0.004 });
    g.restore();
  });
}

// ------------------------------------------------------------------------------------- fountain
function drawFountain(batch, f) {
  const key = zoneKey(f.x, f.z);
  const g = batch.geo(key);
  const glass = batch.geo(key, 'glass');
  const add = batch.geo(key, 'add');
  const STONE = 0xfff1f7;
  const TRIM = 0xffc6e0;
  g.at(f.x, 0, f.z);
  // basin: a scalloped rim of white stone with a pink band
  g.lathe(0, 0, 0, [[f.r - 0.1, 0, 0xf3dbe8], [f.r, 0.12, STONE], [f.r, 0.5, STONE], [f.r + 0.06, 0.56, TRIM], [f.r + 0.06, 0.68, TRIM], [f.r - 0.05, 0.72]], STONE, { seg: 24, capTop: false });
  g.band(f.r - 0.05, 0.72, f.r - 0.45, 0.72, 24, Math.PI / 24, 0xffffff);
  g.band(f.r - 0.45, 0.72, f.r - 0.5, 0.25, 24, Math.PI / 24, 0xe7d3ee);
  g.fan(f.r - 0.5, 0.25, 24, Math.PI / 24, 0x8fd6f5);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    heart(g, Math.sin(a) * (f.r + 0.07), 0.3, Math.cos(a) * (f.r + 0.07), 0.2, K.pink, { ry: a });
  }
  // pedestal and the catching bowl
  const LIFT = 2.45;
  g.lathe(0, 0.25, 0, [[0.95, 0, 0xe9d8f6], [0.78, 0.3, STONE], [0.55, 0.6, STONE], [0.44, 1.9 + LIFT, 0xf5e9ff], [0.62, 2.1 + LIFT, TRIM], [0.5, 2.2 + LIFT]], STONE, { seg: 10 });
  for (let i = 0; i < 6; i++) heart(g, Math.sin((i / 6) * TAU) * 0.53, 1.4, Math.cos((i / 6) * TAU) * 0.53, 0.22, K.pink, { ry: (i / 6) * TAU });
  g.lathe(0, 2.3 + LIFT, 0, [[0.35, 0, 0xf3dbe8], [1.2, 0.25, STONE], [1.45, 0.45, TRIM], [1.42, 0.55]], STONE, { seg: 16, capTop: false });
  g.band(1.42, 2.85 + LIFT, 1.2, 2.85 + LIFT, 16, Math.PI / 16, 0xffffff);
  g.fan(1.2, 2.72 + LIFT, 16, Math.PI / 16, 0x8fd6f5);
  g.lathe(0, 2.75 + LIFT, 0, [[0.3, 0, STONE], [0.22, 0.6, 0xf5e9ff], [0.32, 0.8, TRIM], [0.25, 0.9]], STONE, { seg: 8 });
  // the giant bow on top, facing the plaza
  bow(g, 0, 4.55 + LIFT, 0.05, 3.4, { color: K.pink, star: K.black, detail: 'hi', rx: -0.08 });
  g.restore();
  // water: the basin pool and the bowl, a little see-through
  glass.at(f.x, 0, f.z);
  glass.a = 0.75;
  glass.fan(f.r - 0.48, 0.55, 24, Math.PI / 24, 0x9fe3ff);
  glass.fan(1.22, 2.78 + 2.45, 16, Math.PI / 16, 0xb5ecff);
  // (the veil of water spilling from the bowl is drawn with the waterfalls, island-life.js)
  glass.a = 1;
  glass.restore();
  // glitter in the pool
  add.at(f.x, 0, f.z);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    burst(add, Math.sin(a) * 2.6, 0.62, Math.cos(a) * 2.6, 0.22, i % 2 ? 0xffd6f0 : 0xffffff, 0.8, { ry: a });
  }
  add.restore();
  return { x: f.x, z: f.z, r: f.r, bowY: 7.0 };
}

// ------------------------------------------------------------------------------------- the gym
function drawGym(batch, gym) {
  const g = batch.geo(zoneKey(gym.x, gym.z));
  const glow = batch.geo(zoneKey(gym.x, gym.z), 'glow');
  const W = gym.w;
  const D = gym.d;
  const hw = W / 2;
  const hd = D / 2;
  const WALL = 0xffe4f1;
  const WALL2 = 0xfbd6e8;
  const TRIM = K.white;
  const HP = K.pink;
  const BK = K.black;
  const WALL_H = 6.2;
  inPlace(g, gym);
  inPlace(glow, gym);
  // plinth and walls
  g.box(0, 0, 0, W + 0.6, 0.32, D + 0.6, 0xf1e4f7, { top: 0xfff6fb });
  g.box(0, 0.32, 0, W, WALL_H - 0.32, D, WALL, { side: WALL2, back: WALL2 });
  g.box(0, 0.32, 0, W + 0.06, 0.55, D + 0.06, HP, { noTop: true });
  g.box(0, WALL_H - 0.35, 0, W + 0.2, 0.35, D + 0.2, TRIM, { bottom: shade(TRIM, 0.85) });
  // the barrel roof: pink panels with white ribs
  const N = 12;
  const R = hd + 0.3;
  const RISE = 3.6;
  const P = (x, a) => [x, WALL_H + Math.sin(a) * RISE, Math.cos(a) * R];
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI;
    const a1 = ((k + 1) / N) * Math.PI;
    const col = k % 2 ? 0xffb3d6 : 0xffc6e0;
    g.quad(P(-hw - 0.3, a0), P(hw + 0.3, a0), P(hw + 0.3, a1), P(-hw - 0.3, a1), col);
    g.quad(P(hw + 0.3, a0), P(-hw - 0.3, a0), P(-hw - 0.3, a1), P(hw + 0.3, a1), shade(col, 0.7));
  }
  for (const x of [-hw - 0.3, hw + 0.3]) {
    // gable ends and white ribs
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI;
      const a1 = ((k + 1) / N) * Math.PI;
      const sgn = x > 0 ? 1 : -1;
      const A = [x * 0.995, WALL_H, 0];
      const B = [x * 0.995, WALL_H + Math.sin(a0) * RISE, Math.cos(a0) * R];
      const C = [x * 0.995, WALL_H + Math.sin(a1) * RISE, Math.cos(a1) * R];
      if (sgn > 0) g.tri(A, C, B, WALL2);
      else g.tri(A, B, C, WALL2);
    }
  }
  for (let i = 0; i <= 6; i++) {
    const x = -hw - 0.3 + ((W + 0.6) * i) / 6;
    const pts = [];
    for (let k = 0; k <= N; k++) pts.push(P(x, (k / N) * Math.PI));
    g.tube(pts.map((p) => [p[0], p[1] + 0.05, p[2] * 1.01]), 0.09, TRIM, { seg: 4 });
  }
  // round skylight windows along the roof
  for (let i = -2; i <= 2; i++) glow.cyl(i * 4.2, WALL_H + RISE - 0.05, 0, 0.7, 0.12, 0xcfeeff, { seg: 8 });
  // front: doors, windows, the awning and the sign
  const FZ = hd + 0.01;
  // doors
  g.box(0, 0.32, FZ, 4.6, 3.6, 0.2, TRIM);
  for (const sx of [-1, 1]) {
    g.box(sx * 1.1, 0.32, FZ + 0.05, 2.05, 3.3, 0.14, HP, { front: 0xff4fa7 });
    glow.cyl(sx * 1.1, 2.55, FZ + 0.13, 0.38, 0.03, 0xcfeeff, { seg: 10, rx: Math.PI / 2 });
    star(g, sx * 1.1, 1.3, FZ + 0.13, 0.32, 0.14, K.white);
    g.box(sx * 0.18, 1.55, FZ + 0.15, 0.08, 0.5, 0.06, K.rSilver);
  }
  // tall windows either side
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = sx * (4.4 + i * 2.6);
      g.box(x, 1.1, FZ, 1.7, 3.3, 0.12, TRIM);
      glow.quad([x - 0.68, 1.25, FZ + 0.07], [x + 0.68, 1.25, FZ + 0.07], [x + 0.68, 4.2, FZ + 0.07], [x - 0.68, 4.2, FZ + 0.07], 0xd5efff);
      g.box(x, 2.6, FZ + 0.07, 1.4, 0.06, 0.04, TRIM);
      g.box(x, 1.25, FZ + 0.07, 0.06, 2.95, 0.04, TRIM);
      // a little window box of flowers
      g.box(x, 0.85, FZ + 0.25, 1.6, 0.3, 0.4, 0xffffff, { top: 0x8fdcaa });
      for (let f = 0; f < 5; f++) g.ico(x - 0.6 + f * 0.3, 1.2, FZ + 0.25, 0.1, FLOWER[(f + i) % FLOWER.length], { detail: 0 });
    }
  }
  // the awning: hot pink and black stripes with a scalloped edge
  const AW = 9.6;
  const AZ = 3.1;
  const AY0 = 4.55;
  const AY1 = 3.75;
  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    const x0 = -AW / 2 + (AW * i) / stripes;
    const x1 = -AW / 2 + (AW * (i + 1)) / stripes;
    const col = i % 2 ? BK : HP;
    g.quad([x0, AY0, FZ], [x0, AY1, FZ + AZ], [x1, AY1, FZ + AZ], [x1, AY0, FZ], col);
    g.quad([x1, AY0, FZ], [x1, AY1, FZ + AZ], [x0, AY1, FZ + AZ], [x0, AY0, FZ], shade(col === BK ? 0x3a3040 : col, 0.7));
    // scallop
    const xm = (x0 + x1) / 2;
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * Math.PI;
      const a1 = ((k + 1) / 4) * Math.PI;
      const rr = (x1 - x0) / 2;
      const A = [xm, AY1, FZ + AZ];
      const B = [xm - Math.cos(a0) * rr, AY1 - Math.sin(a0) * rr * 0.9, FZ + AZ];
      const C = [xm - Math.cos(a1) * rr, AY1 - Math.sin(a1) * rr * 0.9, FZ + AZ];
      g.tri2(A, C, B, i % 2 ? HP : BK);
    }
  }
  for (const sx of [-1, 1]) {
    g.lathe(sx * 5.4, 0, FZ + 2.9, [[0.2, 0, TRIM], [0.14, 0.25, HP], [0.11, 0.9, TRIM], [0.11, 1.7, HP], [0.11, 2.5, TRIM], [0.11, AY1 - 0.1, HP], [0.16, AY1]], TRIM, { seg: 6 });
  }
  // the CHEER sign above the awning, with rhinestones
  g.box(0, 4.75, FZ + 0.02, 7.6, 1.45, 0.12, K.white, { bottom: true });
  g.box(0, 4.7, FZ + 0.01, 7.8, 1.55, 0.1, HP);
  g.text('CHEER', 0, 4.93, FZ + 0.09, 0.23, BK);
  for (let i = 0; i < 10; i++) {
    const x = -3.5 + i * 0.78;
    star(g, x, 6.06, FZ + 0.1, 0.09, 0.04, i % 2 ? K.rPurple : K.rPink);
    star(g, x + 0.39, 4.78, FZ + 0.1, 0.07, 0.03, K.rSilver);
  }
  // the star bow on top: a big starburst with the bow in front
  const TY = WALL_H + RISE - 0.4;
  g.at(0, TY, hd * 0.25);
  star(g, 0, 1.9, 0, 2.3, 1.0, 0xffe066, { thick: 0.35, side: 0xf2c94c });
  star(g, 0, 1.9, 0.19, 1.55, 0.66, K.white, {});
  bow(g, 0, 1.8, 0.45, 3.1, { color: HP, star: BK, detail: 'hi' });
  g.restore();
  // megaphones on the front corners
  for (const sx of [-1, 1]) {
    g.at(sx * (hw - 0.6), WALL_H - 0.8, FZ + 0.6, sx * 0.5, -0.5, sx * 0.0);
    g.lathe(0, 0, 0, [[0.18, 0, HP], [0.35, 0.6, HP], [0.8, 1.5, BK], [0.82, 1.6]], HP, { seg: 10, capTop: 0x2d2433, rx: 0 });
    g.restore();
  }
  // side windows and pennant bunting along the eaves
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -hd + 2.5 + i * 5;
      g.at(sx * (hw + 0.01), 0, z, sx * Math.PI / 2);
      g.box(0, 1.6, 0, 2.2, 2.5, 0.12, TRIM);
      glow.quad([-0.92, 1.75, 0.07], [0.92, 1.75, 0.07], [0.92, 3.95, 0.07], [-0.92, 3.95, 0.07], 0xd5efff);
      g.restore();
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = -hw + 0.7 + (i * (W - 1.4)) / 17;
    if (Math.abs(x) < 4.3) continue;
    const col = [HP, K.white, BK, K.rPurple][i % 4];
    g.tri2([x - 0.32, WALL_H - 0.4, FZ + 0.12], [x + 0.32, WALL_H - 0.4, FZ + 0.12], [x, WALL_H - 1.05, FZ + 0.12], col);
  }
  g.shadeY(0, 1.4, 0.9, 0);
  g.restore();
  glow.restore();
}

// ------------------------------------------------------------------------------------- the stage
function drawStage(batch, st, G) {
  const key = zoneKey(st.x, st.z);
  const g = batch.geo(key);
  const glow = batch.geo(key, 'glow');
  const add = batch.geo(key, 'add');
  const BLUE = 0x4f8ff0;
  const BLUE_DK = 0x3a6fc4;
  const M = st.mat / 2;
  inPlace(g, st);
  // the spring floor: nine blue strips, white boundary, a star at centre
  g.box(0, 0, 0, st.mat, G.stageMatY, st.mat, BLUE_DK, { top: BLUE });
  for (let i = 1; i < 9; i++) {
    const x = -M + (st.mat * i) / 9;
    g.box(x, G.stageMatY, 0, 0.04, 0.006, st.mat - 0.4, shade(BLUE, 0.9));
  }
  const LINE = K.white;
  const y = G.stageMatY + 0.002;
  g.box(0, y, -M + 0.2, st.mat - 0.2, 0.012, 0.1, LINE);
  g.box(0, y, M - 0.2, st.mat - 0.2, 0.012, 0.1, LINE);
  g.box(-M + 0.2, y, 0, 0.1, 0.012, st.mat - 0.2, LINE);
  g.box(M - 0.2, y, 0, 0.1, 0.012, st.mat - 0.2, LINE);
  g.box(0, y, 0, 0.06, 0.012, st.mat - 0.4, shade(BLUE, 1.12));
  g.save();
  g.translate(0, y + 0.012, 0);
  g.rotX(-Math.PI / 2);
  star(g, 0, 0, 0, 0.9, 0.38, K.white);
  g.restore();
  // bleachers either side, facing the mat
  for (const b of G.bleachers) {
    g.at(b.lx, 0, b.lz, b.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    // local +Z faces the mat; rows climb toward -Z
    for (let k = 0; k < b.rows; k++) {
      const zc = (b.rows * b.depth) / 2 - (k + 0.5) * b.depth;
      const top = (k + 1) * b.rise;
      g.box(0, 0, zc, b.len, top, b.depth, k % 2 ? 0xffffff : 0xf3e8ff, { top: k % 2 ? K.pinkSoft : 0xc9b2ff, side: 0xe3d3f3 });
      g.box(0, top, zc - b.depth * 0.18, b.len - 0.2, 0.05, b.depth * 0.5, k % 2 ? K.pink : K.lavender);
    }
    // back rail
    const zb = -(b.rows * b.depth) / 2 + 0.05;
    for (let i = 0; i <= 5; i++) g.cyl(-b.len / 2 + (b.len * i) / 5, b.rows * b.rise, zb, 0.05, 0.9, K.white, { seg: 4 });
    g.box(0, b.rows * b.rise + 0.85, zb, b.len, 0.08, 0.08, K.pink);
    g.restore();
  }
  // judges' table, skirt with stars, three chairs facing the mat, score cards
  g.at(0, 0, 9.4);
  g.box(0, 0, 0, 6.4, 0.78, 1.3, K.pink, { top: K.white, side: shade(K.pink, 0.85) });
  g.box(0, 0.78, 0, 6.6, 0.06, 1.4, K.white);
  for (let i = 0; i < 7; i++) star(g, -2.7 + i * 0.9, 0.45, -0.66, 0.16, 0.07, i % 2 ? K.black : K.white, { ry: Math.PI });
  for (let i = -1; i <= 1; i++) {
    const x = i * 2.1;
    g.box(x, 0, 1.05, 0.6, 0.48, 0.55, K.lilac, { top: K.lavender });
    g.box(x, 0.48, 1.3, 0.6, 0.65, 0.08, K.lilac);
    // a score card propped on the table, facing the mat
    g.box(x, 0.84, -0.2, 0.55, 0.4, 0.04, K.white, { rx: 0.2 });
    g.text(['10', '10', '10'][i + 1], x, 0.92, -0.25, 0.045, K.pink, { ry: Math.PI });
  }
  g.restore();
  // the backdrop: curtain, an arch of lights and the HIT ZERO board
  g.at(0, 0, -9.3);
  g.box(0, 0, 0, 15, 0.3, 1.2, K.white);
  for (const sx of [-1, 1]) g.box(sx * 7.2, 0.3, 0, 0.6, 5.2, 0.6, K.white, { top: K.pink });
  const CUR = 0xb9a0ff;
  for (let i = 0; i < 14; i++) {
    const x0 = -6.9 + i * (13.8 / 14);
    const x1 = x0 + 13.8 / 14;
    const depth = i % 2 ? 0.12 : -0.12;
    g.quad([x0, 0.3, depth], [x1, 0.3, -depth], [x1, 4.6, -depth], [x0, 4.6, depth], i % 2 ? CUR : shade(CUR, 1.08));
  }
  g.box(0, 4.6, 0, 15, 0.5, 0.7, K.pink);
  g.box(0, 5.1, 0.1, 6.8, 1.3, 0.2, K.black, { bottom: true });
  g.text('HIT ZERO', 0, 5.33, 0.22, 0.16, K.white);
  for (let i = 0; i < 6; i++) star(g, -3 + i * 1.2, 4.85, 0.38, 0.13, 0.06, i % 2 ? K.rPink : K.rSilver);
  // speakers on stands
  for (const sx of [-1, 1]) {
    g.at(sx * 8.6, 0, 0.9, sx * -0.3);
    g.cyl(0, 0, 0, 0.35, 0.1, K.black, { seg: 6 });
    g.cyl(0, 0.1, 0, 0.05, 1.6, K.black, { seg: 4 });
    g.box(0, 1.7, 0, 0.8, 1.3, 0.6, 0x2d2433, { top: K.black });
    g.cyl(0, 2.05, 0.31, 0.24, 0.04, 0x4a3f55, { seg: 8, rx: Math.PI / 2 });
    g.cyl(0, 1.95 - 0.55, 0.31, 0.14, 0.04, 0x4a3f55, { seg: 8, rx: Math.PI / 2 });
    g.restore();
  }
  g.restore();
  // light bulbs round the arch and twinkles on the curtain
  glow.at(st.x, 0, st.z, st.facing);
  add.at(st.x, 0, st.z, st.facing);
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    const x = -7.2 + t * 14.4;
    glow.sphere(x, 4.62 + 0.08, -9.3 + 0.38, 0.09, i % 2 ? 0xfff2b0 : 0xffc4e8, { seg: 4, rings: 2 });
  }
  for (let i = 0; i < 18; i++) {
    const x = -6.4 + (i % 6) * 2.55 + (i % 2) * 0.4;
    const yy = 1.0 + Math.floor(i / 6) * 1.25;
    burst(add, x, yy, -9.3 + 0.2, 0.22, i % 3 ? 0xffffff : 0xffd0f0, 0.7);
  }
  glow.restore();
  add.restore();
}

// ------------------------------------------------------------------------------------- photo booth
function drawBooth(batch, b) {
  const g = batch.geo(zoneKey(b.x, b.z));
  const glow = batch.geo(zoneKey(b.x, b.z), 'glow');
  const BODY = 0xe7d6ff;
  inPlace(g, b);
  g.box(0, 0, 0, 2.6, 0.15, 2.6, K.white);
  g.box(0, 0.15, 0, 2.4, 2.35, 2.4, BODY, { side: 0xdac6fa, back: 0xdac6fa, noTop: true });
  // rounded roof
  g.cloft(0, 2.5, 0, [[0, 2.6, 2.6, 0.3], [0.25, 2.5, 2.5, 0.5], [0.55, 1.7, 1.7, 0.6]], K.pink, { capTop: K.pinkSoft });
  // front opening with a curtain and a scalloped valance
  g.box(0, 0.15, 1.21, 1.5, 2.0, 0.04, 0x3b2c47);
  for (let i = 0; i < 6; i++) {
    const x0 = -0.75 + i * 0.25;
    const fold = i % 2 ? 0.05 : 0;
    g.quad([x0, 0.25, 1.25 + fold], [x0 + 0.25, 0.25, 1.25 + 0.05 - fold], [x0 + 0.25, 2.1, 1.25 + 0.05 - fold], [x0, 2.1, 1.25 + fold], i % 2 ? K.pink : 0xff5fae);
  }
  for (let i = 0; i < 8; i++) {
    const x = -1.05 + i * 0.3;
    g.tri([x - 0.15, 2.32, 1.27], [x, 2.12, 1.27], [x + 0.15, 2.32, 1.27], i % 2 ? K.white : K.pink);
  }
  // sign board with chaser bulbs
  g.box(0, 3.0, 0.2, 2.2, 0.7, 0.14, K.black, { bottom: true });
  g.text('PHOTO', 0, 3.12, 0.28, 0.07, K.white);
  // camera on top
  g.box(0, 3.08, -0.3, 0.9, 0.55, 0.5, K.white, { top: K.rSilver });
  g.cyl(0, 3.35, -0.05, 0.18, 0.1, K.black, { seg: 8, rx: Math.PI / 2 });
  g.restore();
  glow.at(b.x, 0, b.z, b.facing);
  for (let i = 0; i < 9; i++) {
    const x = -1.0 + i * 0.25;
    glow.sphere(x, 3.42, 0.28, 0.05, i % 2 ? 0xfff2b0 : 0xffb0dc, { seg: 4, rings: 2 });
    glow.sphere(x, 2.78, 0.28, 0.05, i % 2 ? 0xffb0dc : 0xfff2b0, { seg: 4, rings: 2 });
  }
  glow.cyl(0, 3.35, 0.06, 0.1, 0.04, 0x9fd8ff, { seg: 8, rx: Math.PI / 2 });
  glow.restore();
}

// ------------------------------------------------------------------------------------- court
function drawCourtDeco(batch, c, yAt) {
  const g = batch.geo(zoneKey(c.x, c.z));
  // team pennants at the corners, and a little scoreboard
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      const [x, z] = toWorld(c, side * (c.w / 2 + 0.8), end * (c.d / 2 + 0.6));
      const y = yAt(x, z);
      const col = end < 0 ? K.teamA : K.teamB;
      g.cyl(x, y, z, 0.06, 2.4, K.white, { seg: 4 });
      g.at(x, y + 2.35, z, c.facing + (end < 0 ? 0 : Math.PI));
      g.tri2([0, 0, 0], [0, -0.55, 0], [0.9 * side, -0.27, 0], col);
      g.restore();
      g.sphere(x, y + 2.45, z, 0.1, K.gold, { seg: 4, rings: 2 });
    }
  }
  // scoreboard on the far side
  const [sx, sz] = toWorld(c, -(c.w / 2 + 5.4), 0);
  const sy = yAt(sx, sz);
  g.at(sx, sy, sz, c.facing + Math.PI / 2);
  for (const lx of [-1.4, 1.4]) g.cyl(lx, 0, 0, 0.08, 2.2, K.white, { seg: 4 });
  g.box(0, 2.0, 0, 3.4, 1.2, 0.18, 0x2d2433, { bottom: true });
  g.box(-0.85, 2.1, 0.1, 1.5, 0.95, 0.04, K.teamA);
  g.box(0.85, 2.1, 0.1, 1.5, 0.95, 0.04, K.teamB);
  g.text('PINK', -0.85, 2.42, 0.13, 0.065, K.white);
  g.text('PURPLE', 0.85, 2.42, 0.13, 0.05, K.white);
  heart(g, -0.85, 2.27, 0.13, 0.2, K.white);
  star(g, 0.85, 2.27, 0.13, 0.12, 0.05, K.white);
  g.restore();
  // a ball cart
  const [bx, bz] = toWorld(c, c.w / 2 - 1.4, c.d / 2 + 2.4);
  const by = yAt(bx, bz);
  g.box(bx, by + 0.15, bz, 1.4, 0.5, 0.8, K.white, { side: K.rSilver });
  for (let i = 0; i < 6; i++) g.sphere(bx - 0.5 + (i % 3) * 0.5, by + 0.82 + Math.floor(i / 3) * 0.2, bz + (i % 2 ? 0.15 : -0.15), 0.22, i % 2 ? K.teamA : K.teamB, { seg: 6, rings: 4 });
  for (const lx of [-0.6, 0.6]) for (const lz of [-0.32, 0.32]) g.cyl(bx + lx, by, bz + lz, 0.08, 0.15, K.black, { seg: 4 });
}

// ------------------------------------------------------------------------------------- field
function drawFieldDeco(batch, plan, yAt) {
  const f = plan.places.bowField;
  const flags = [];
  for (const b of f.bases) {
    const g = batch.geo(zoneKey(b.x, b.z));
    const y = yAt(b.x, b.z);
    const col = b.team ? K.teamB : K.teamA;
    g.cyl(b.x, y, b.z, 0.32, 0.25, K.white, { seg: 8 });
    g.lathe(b.x, y + 0.25, b.z, [[0.1, 0, K.white], [0.09, 1.5, col], [0.085, 2.1, K.white], [0.08, 3.6, col], [0.075, 4.2, K.white], [0.07, 5.6]], K.white, { seg: 6 });
    g.sphere(b.x, y + 5.85, b.z, 0.16, K.gold, { seg: 6, rings: 3 });
    // the bow and its pennant sway on their own (island-life animates `flag`)
    const fg = new Geo();
    bow(fg, 0, 0, 0, 2.0, { color: col, star: b.team ? K.white : K.black, detail: 'hi' });
    fg.tri2([0, -0.5, 0], [0, -1.4, 0], [1.3, -0.95, 0.02], col);
    fg.tri2([0, -0.65, 0.01], [0, -1.25, 0.01], [0.85, -0.95, 0.03], K.white);
    flags.push({ team: b.team, x: b.x, y: y + 5.2, z: b.z, geo: fg, facing: f.facing + (b.team ? -Math.PI / 2 : Math.PI / 2) });
    // cones round the base
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const cx = b.x + Math.sin(a) * (b.r + 0.4);
      const cz = b.z + Math.cos(a) * (b.r + 0.4);
      g.cone(cx, yAt(cx, cz), cz, 0.16, 0.4, i % 2 ? col : K.white, { seg: 5 });
    }
  }
  // field signs
  return flags;
}

// ------------------------------------------------------------------------------------- lawn
function drawLawnDeco(batch, plan, yAt) {
  const t = plan.tag;
  const g = batch.geo(zoneKey((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2));
  const r = rng(5);
  for (const [x, z] of [[t.x0 - 1.8, t.z0 - 1.8], [t.x1 + 1.8, t.z0 - 1.8], [t.x1 + 1.8, t.z1 + 1.8]]) {
    planter(g, x, yAt(x, z), z, r, Math.round(x) % 3);
  }
  // little signs at the arena entrances
}

// ------------------------------------------------------------------------------------- garden
function drawGarden(batch, plan, yAt, blob, low) {
  const gp = plan.gardenPlan;
  const gkey = zoneKey((plan.garden.x0 + plan.garden.x1) / 2, (plan.garden.z0 + plan.garden.z1) / 2);
  const g = batch.geo(gkey);
  const add = batch.geo(gkey, 'add');
  const cg = batch.geo(gkey, 'cloud');
  const r = rng(77);
  const HEDGE = 0x7fd39a;
  const HEDGE_LT = 0x99e3ad;
  // hedge walls: rounded tops, a scatter of roses
  const hedge = (x0, z0, x1, z1, h, w) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const y = Math.min(yAt(x0, z0), yAt(x1, z1), yAt(mx, mz)) - 0.08;
    g.at(mx, y, mz, ry);
    g.cloft(0, 0, 0, [[0, w, len, 0.12], [h - 0.35, w, len, 0.2, 0, 0, HEDGE_LT], [h, w * 0.7, len - 0.2, 0.25]], HEDGE, { capTop: HEDGE_LT });
    const n = Math.round(len * 0.9);
    for (let i = 0; i < n; i++) {
      const zz = -len / 2 + 0.3 + r() * (len - 0.6);
      const side = r() < 0.5 ? -1 : 1;
      const yy = 0.5 + r() * (h - 0.8);
      const xx = side * (w / 2 + 0.03);
      const c = FLOWER[Math.floor(r() * FLOWER.length)];
      g.tri2([xx, yy - 0.11, zz], [xx, yy, zz + 0.11], [xx, yy + 0.11, zz], c);
      g.tri2([xx, yy - 0.11, zz], [xx, yy + 0.11, zz], [xx, yy, zz - 0.11], c);
    }
    g.restore();
  };
  for (const w of gp.walls) hedge(w.x0, w.z0, w.x1, w.z1, 1.75, 1.1);
  // gate arches with roses
  for (const gate of [gp.gate, gp.north]) {
    const alongX = gate === gp.north;
    const y = yAt(gate.x, gate.z);
    g.at(gate.x, y, gate.z, alongX ? 0 : Math.PI / 2);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (i / 10) * Math.PI;
      pts.push([Math.cos(a) * gate.half, 2.2 + Math.sin(a) * 0.9, 0]);
    }
    for (const sx of [-1, 1]) g.cyl(sx * gate.half, 0, 0, 0.09, 2.2, K.white, { seg: 5 });
    g.tube(pts, 0.09, K.white, { seg: 4 });
    for (let i = 0; i < 9; i++) {
      const p = pts[i + 1];
      g.ico(p[0], p[1] + 0.05, 0.06, 0.16, i % 2 ? K.pink : 0xffb3d9, { detail: 0 });
    }
    g.restore();
  }
  // the counting tree and its sign
  cottonTree(g, gp.tree.x, yAt(gp.tree.x, gp.tree.z) - 0.05, gp.tree.z, 0.9, 1, rng(3), { low });
  blob(gp.tree.x, gp.tree.z, 2, 2, 0.2);
  {
    const s = gp.seekerStart;
    const sx = s.x + Math.sin(s.facing) * 0.9 + 0.9;
    const sz = s.z + Math.cos(s.facing) * 0.9 + 1.4;
    const y = yAt(sx, sz);
    g.at(sx, y, sz, s.facing + Math.PI);
    g.cyl(0, 0, 0, 0.05, 1.2, K.white, { seg: 4 });
    g.box(0, 1.15, 0, 1.6, 0.5, 0.08, K.lemon, { bottom: true });
    text2(g, 'COUNT TO 10!', 0, 1.27, 0, 0.034, K.ink, { gap: 0.045 });
    g.restore();
  }
  // the hiding things
  for (const o of gp.objects) {
    const y = yAt(o.x, o.z);
    g.at(o.x, y, o.z, o.ry);
    switch (o.kind) {
      case 'hedge': {
        g.cloft(0, -0.08, 0, [[0, o.size, 1.2, 0.15], [1.25, o.size, 1.2, 0.22, 0, 0, HEDGE_LT], [1.6, o.size - 0.25, 0.85, 0.25]], HEDGE, { rx: 0, capTop: HEDGE_LT });
        for (let i = 0; i < Math.round(o.size); i++) g.ico(-o.size / 2 + 0.5 + i, 0.9 + r() * 0.5, 0.62 * (i % 2 ? 1 : -1), 0.1, FLOWER[i % FLOWER.length], { detail: 0 });
        break;
      }
      case 'bush':
        g.restore();
        bushy(g, o.x, y - 0.05, o.z, o.size * 0.95, rng(o.x * 3 + 1), { color: 0x8fdcaa });
        g.at(o.x, y, o.z, o.ry);
        break;
      case 'slide': {
        // a playground slide: ladder at one end, platform, a pink chute down to the other
        const P = 0xffb3d9;
        g.box(0, 0, -1.6, 1.0, 0.08, 1.0, K.white);
        for (const sx of [-0.45, 0.45]) {
          g.box(sx, 0, -1.95, 0.08, 1.9, 0.08, K.white);
          g.box(sx, 0, -1.25, 0.08, 1.9, 0.08, K.white);
        }
        for (let i = 0; i < 5; i++) g.box(0, 0.3 + i * 0.32, -2.0, 0.9, 0.06, 0.06, K.lilac);
        g.box(0, 1.6, -1.6, 1.1, 0.12, 0.9, K.lilac, { top: 0xd9c6ff });
        g.at(0, 1.62, -1.15, 0, 0.62);
        g.box(0, -0.02, 1.6, 0.85, 0.06, 3.2, P, { bottom: true });
        for (const sx of [-1, 1]) g.box(sx * 0.45, 0, 1.6, 0.08, 0.22, 3.2, shade(P, 0.9));
        g.restore();
        break;
      }
      case 'tent': {
        const s = o.size;
        const w = 1.2 * s;
        const h = 1.7 * s;
        const d = 1.25 * s;
        const STR = [K.pinkSoft, K.white];
        for (let i = 0; i < 6; i++) {
          const z0 = -d + (2 * d * i) / 6;
          const z1 = -d + (2 * d * (i + 1)) / 6;
          const col = STR[i % 2];
          g.quad([-w, 0, z0], [-w, 0, z1], [0, h, z1], [0, h, z0], shade(col, 0.92));
          g.quad([w, 0, z1], [w, 0, z0], [0, h, z0], [0, h, z1], col);
        }
        g.tri([-w, 0, -d], [0, h, -d], [w, 0, -d], K.pink);
        // the front: open flaps and a dark doorway
        g.tri([-w, 0, d], [-w * 0.25, 0, d + 0.02], [0, h, d], K.pink);
        g.tri([w * 0.25, 0, d + 0.02], [w, 0, d], [0, h, d], K.pink);
        g.tri([-w * 0.25, 0, d + 0.01], [w * 0.25, 0, d + 0.01], [0, h * 0.8, d + 0.01], 0x4a3a55);
        g.cyl(0, h, d, 0.03, 0.5, K.white, { seg: 3 });
        g.tri2([0, h + 0.5, d], [0, h + 0.3, d], [0.35, h + 0.4, d], K.lemon);
        break;
      }
      case 'rack': {
        // a costume rack hung with little cheer uniforms: tops with stars, pleated skirts
        for (const sx of [-1.0, 1.0]) {
          g.box(sx, 0, 0, 0.5, 0.06, 0.5, K.rSilver);
          g.cyl(sx, 0.06, 0, 0.04, 1.8, K.rSilver, { seg: 4 });
        }
        g.cyl(-1.0, 1.84, 0, 0.035, 2.0, K.rSilver, { seg: 4, rz: -Math.PI / 2 });
        const tops = [K.black, K.pink, K.white, K.rPurple, K.black];
        const skirts = [K.pink, K.black, K.pink, K.white, K.rPurple];
        for (let i = 0; i < 5; i++) {
          const x = -0.76 + i * 0.38;
          g.tri2([x - 0.13, 1.66, 0], [x + 0.13, 1.66, 0], [x, 1.84, 0], K.rSilver);
          g.box(x, 1.18, 0, 0.32, 0.48, 0.1, tops[i], { bottom: true });
          g.box(x, 1.56, 0, 0.2, 0.08, 0.1, tops[i]);
          g.cloft(x, 0.72, 0, [[0, 0.46, 0.16, 0.04], [0.46, 0.3, 0.12, 0.03]], skirts[i], {});
          for (const sz of [-1, 1]) star(g, x, 1.38, sz * 0.056, 0.07, 0.03, tops[i] === K.white ? K.pink : K.white, { ry: sz < 0 ? Math.PI : 0 });
        }
        break;
      }
      case 'cloud': {
        g.restore();
        puff(cg, o.x, y - 0.25, o.z, 1.25 * o.size, rng(Math.round(o.x * 11)), { color: 0xfffafd, under: 0xead9f5, lumps: 6, detail: low ? 0 : 1, flat: 0.3 });
        burst(add, o.x + 0.6, y + 2.0 * o.size, o.z + 0.4, 0.3, 0xffffff, 0.8);
        g.at(o.x, y, o.z, o.ry);
        break;
      }
      case 'barrel': {
        const cols = [0xffc4df, 0xc9b6ff, 0xa9ecd0];
        const spots = [[-0.38, -0.2], [0.42, -0.1], [0.0, 0.42]];
        spots.forEach(([bx, bz], i) => {
          const col = cols[i % 3];
          g.lathe(bx, 0, bz, [[0.36, 0, shade(col, 0.85)], [0.42, 0.45, col], [0.36, 0.95]], col, { seg: 8, capTop: shade(col, 1.12) });
          g.cyl(bx, 0.2, bz, 0.395, 0.06, K.white, { seg: 8, top: false });
          g.cyl(bx, 0.7, bz, 0.395, 0.06, K.white, { seg: 8, top: false });
        });
        g.lathe(0.05, 0.95, 0.05, [[0.3, 0, 0xffe08a], [0.34, 0.38, 0xffe08a], [0.3, 0.75]], 0xffe08a, { seg: 8, capTop: 0xfff0b8 });
        break;
      }
      case 'curtain': {
        // a little puppet theatre: a frame with a velvet curtain and a star on top
        for (const sx of [-1.25, 1.25]) {
          g.box(sx, 0, 0, 0.25, 0.08, 0.5, K.white);
          g.box(sx, 0.08, 0, 0.14, 2.3, 0.14, K.white);
        }
        g.box(0, 2.3, 0, 2.8, 0.35, 0.3, K.pink);
        for (let i = 0; i < 10; i++) {
          const x0 = -1.15 + i * 0.23;
          const f = i % 2 ? 0.06 : -0.06;
          g.quad2([x0, 0.1, f], [x0 + 0.23, 0.1, -f], [x0 + 0.23, 2.3, -f], [x0, 2.3, f], i % 2 ? 0xb65cff : 0xa64bf0, i % 2 ? 0x9a48d8 : 0x8c3ccc);
        }
        star(g, 0, 2.95, 0, 0.3, 0.13, K.lemon, { thick: 0.06 });
        break;
      }
      default:
        break;
    }
    g.restore();
    const sh = o.kind === 'hedge' ? [o.size / 2 + 0.3, 0.9] : o.kind === 'slide' ? [0.9, 2.4] : o.kind === 'rack' || o.kind === 'curtain' ? [1.5, 0.5] : [1.2 * (o.size || 1), 1.2 * (o.size || 1)];
    blob(o.x, o.z, sh[0], sh[1], 0.2, o.ry + (o.kind === 'slide' ? 0 : 0));
  }
}
