// Things up in the air: the three cloud platforms (basket-toss targets) with a treasure on each,
// the rainbow slides back down, the rainbow bridge to the isle, and the bow boutique on the isle.
//
//   drawSkyway(plan, batch, { yAt, blob, quality }) -> { treasures: [{ id, platformId, kind, x, y, z, geo, glow, add }] }
//
// The walkable surfaces match groundAt exactly: each platform's top is a flat disc at its y, the
// slides' decks follow slideProfile(), the bridge follows bridgeProfile().

import { Geo, TAU } from './geo.js';
import { rng } from './util.js';
import { slideProfile, bridgeProfile, toWorld } from './island-layout.js';
import { K, shade, star, heart, bow, burst, puff, text2, zoneKey } from './island-kit.js';

// pastel rainbow, outside to inside
export const RAINBOW = [0xff8fb3, 0xffb58a, 0xffe27a, 0x9be7a8, 0x8fd0ff, 0xb59cff, 0xe39cff];

// Quads that face up (or down), whatever order the corners come in.
function upQuad(g, A, B, C, D, col, down = false) {
  const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
  if ((ny > 0) !== down) g.quad(A, B, C, D, col);
  else g.quad(D, C, B, A, col);
}
function upTri(g, A, B, C, col) {
  const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
  if (ny > 0) g.tri(A, B, C, col);
  else g.tri(A, C, B, col);
}

// A rainbow deck from a to b, `hw` half-width, heights from yFn(s). Rails (white, pink caps) on
// both sides, a soft underside. s goes 0..1 from a to b.
function rainbowDeck(g, ax, az, bx, bz, hw, yFn, o = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const nx = -uz;
  const nz = ux;
  const N = Math.max(4, Math.ceil(len / (o.step || 0.9)));
  const bands = RAINBOW.length;
  const railH = o.railH === undefined ? 0.45 : o.railH;
  const railW = 0.16;
  const thick = o.thick || 0.35;
  const under = o.under || 0xf4e6ff;
  const P = (s, off, dy = 0) => [ax + ux * len * s + nx * off, yFn(s) + dy, az + uz * len * s + nz * off];
  for (let i = 0; i < N; i++) {
    const s0 = i / N;
    const s1 = (i + 1) / N;
    // the stripes
    for (let k = 0; k < bands; k++) {
      const o0 = -hw + (2 * hw * k) / bands;
      const o1 = -hw + (2 * hw * (k + 1)) / bands;
      const col = RAINBOW[k];
      upQuad(g, P(s0, o0, 0.01), P(s1, o0, 0.01), P(s1, o1, 0.01), P(s0, o1, 0.01), col);
    }
    // underside
    upQuad(g, P(s0, hw + railW, -thick), P(s1, hw + railW, -thick), P(s1, -hw - railW, -thick), P(s0, -hw - railW, -thick), under, true);
    // rails: inner face, top, outer face, and the outer edge down to the underside
    for (const side of [-1, 1]) {
      const i0 = side * hw;
      const i1 = side * (hw + railW);
      const col = o.rail || K.white;
      const cap = o.cap || K.pinkSoft;
      const q = (A, B, C, D, c) => (side > 0 ? g.quad(A, B, C, D, c) : g.quad(D, C, B, A, c));
      q(P(s0, i0, railH), P(s1, i0, railH), P(s1, i0, 0), P(s0, i0, 0), shade(col, 0.94));
      q(P(s0, i1, railH), P(s1, i1, railH), P(s1, i0, railH), P(s0, i0, railH), cap);
      q(P(s0, i1, -thick), P(s1, i1, -thick), P(s1, i1, railH), P(s0, i1, railH), col);
    }
  }
  return { len, ux, uz, nx, nz, N };
}

export function drawSkyway(plan, batch, o) {
  const { yAt, blob } = o;
  const low = o.quality === 'low';
  const r = rng(2468);
  const treasures = [];

  // ---------------------------------------------------------------- cloud platforms
  plan.platforms.forEach((p, idx) => {
    const g = batch.geo(zoneKey(p.x, p.z), 'cloud');
    const add = batch.geo(zoneKey(p.x, p.z), 'add');
    const slide = plan.slides.find((s) => s.fromPlatformId === p.id);
    const away = Math.atan2(slide.x0 - p.x, slide.z0 - p.z);
    // the walkable top: a soft disc exactly at p.y
    const seg = 24;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU;
      const a1 = ((i + 1) / seg) * TAU;
      const rr = p.r + 0.15;
      const ring0 = [p.x + Math.sin(a0) * rr * 0.55, p.y + 0.012, p.z + Math.cos(a0) * rr * 0.55];
      const ring1 = [p.x + Math.sin(a1) * rr * 0.55, p.y + 0.012, p.z + Math.cos(a1) * rr * 0.55];
      upTri(g, [p.x, p.y + 0.012, p.z], ring1, ring0, i % 2 ? 0xfff6fb : 0xfffbfd);
      const e0 = [p.x + Math.sin(a0) * rr, p.y + 0.012, p.z + Math.cos(a0) * rr];
      const e1 = [p.x + Math.sin(a1) * rr, p.y + 0.012, p.z + Math.cos(a1) * rr];
      upQuad(g, ring0, ring1, e1, e0, i % 2 ? 0xfdeef7 : 0xf9eaff);
    }
    // the body: a big puffy cloud under the top, a ring of puffs round its middle, wisps below,
    // and a fluffy rim round the walkable top (open where the slide leaves)
    const body = rng(100 + idx);
    puff(g, p.x, p.y - 3.6 - p.r * 0.3, p.z, p.r * 1.45, body, { lumps: 8, detail: low ? 0 : 1, color: 0xfffafd, under: 0xe2cff6 });
    const mid = 7;
    for (let i = 0; i < mid; i++) {
      const a = (i / mid) * TAU + body() * 0.4;
      const rr = p.r * 0.85 + 0.9;
      const sz = 1.15 + body() * 0.5;
      g.ico(p.x + Math.sin(a) * rr, p.y - 1.75 - body() * 0.4, p.z + Math.cos(a) * rr, sz, i % 2 ? 0xfffafd : 0xfbf2ff, { detail: 0, jitter: 0.1, rnd: body, sy: 0.72 });
    }
    for (let i = 0; i < 3; i++) {
      const a = body() * TAU;
      g.ico(p.x + Math.sin(a) * p.r * 0.5, p.y - 6.2 - p.r * 0.5 - i * 0.9, p.z + Math.cos(a) * p.r * 0.5, 0.9 - i * 0.2, 0xf6ecff, { detail: 0, jitter: 0.12, rnd: body, sy: 0.7 });
    }
    const n = Math.round(p.r * 3.6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + body() * 0.2;
      let d = a - away;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const gap = Math.abs(d) * p.r < slide.halfWidth + 0.5;
      const rr = p.r + 0.3 + body() * 0.2;
      const sz = 0.75 + body() * 0.3;
      const yy = gap ? p.y - 1.5 : p.y - 0.98;
      g.ico(p.x + Math.sin(a) * rr, yy + sz * 0.5, p.z + Math.cos(a) * rr, sz, i % 3 ? 0xfffafd : 0xf8eeff, { detail: 0, jitter: 0.1, rnd: body, sy: 0.85 });
    }
    // little twinkles round the rim
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      burst(add, p.x + Math.sin(a) * (p.r + 0.6), p.y + 0.9 + (i % 2) * 0.5, p.z + Math.cos(a) * (p.r + 0.6), 0.28, i % 2 ? 0xffffff : 0xffd6f2, 0.75, { ry: a });
    }
    // the treasure, toward the back of the cloud so the landing spot stays clear
    const back = away + Math.PI;
    const tx = p.x + Math.sin(back) * (p.r * 0.48);
    const tz = p.z + Math.cos(back) * (p.r * 0.48);
    const kind = ['poms', 'trophy', 'spiritStick'][idx] || 'star';
    const tg = new Geo();
    const tglow = new Geo();
    const tadd = new Geo({ alpha: true });
    drawTreasure(kind, tg, tglow, tadd, r);
    treasures.push({ id: kind, platformId: p.id, kind, x: tx, y: p.y, z: tz, geo: tg, glow: tglow, add: tadd, facing: Math.atan2(p.x - tx, p.z - tz) });
  });

  // ---------------------------------------------------------------- rainbow slides
  for (const s of plan.slides) {
    const g = batch.geo(zoneKey((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2));
    const cg = batch.geo(zoneKey((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2), 'cloud');
    const yFn = (t) => s.y1 + (s.y0 - s.y1) * slideProfile(t);
    const d = rainbowDeck(g, s.x0, s.z0, s.x1, s.z1, s.halfWidth, yFn, { step: 0.8, railH: 0.5 });
    // where the slide runs over the island, a ridge of cloud holds it up
    const cr = rng(Math.round(s.x0 * 7));
    for (let k = 1; k <= d.N; k += 2) {
      const t = k / d.N;
      const x = s.x0 + d.ux * d.len * t;
      const z = s.z0 + d.uz * d.len * t;
      const ground = yAt(x + d.nx * (s.halfWidth + 1.2), z + d.nz * (s.halfWidth + 1.2));
      const deck = yFn(t);
      if (ground > -1e6 && deck - ground > 0.35) {
        const hgt = deck - ground;
        puff(cg, x, ground - 0.2, z, Math.min(1.9, 0.6 + hgt * 0.42), cr, { lumps: 4, detail: 0, color: 0xfffafd, under: 0xead9f5, squash: 0.6 });
      }
    }
    // a puff where it leaves its cloud
    puff(cg, s.x0 + d.ux * 0.6, yFn(0.02) - 1.2, s.z0 + d.uz * 0.6, 1.1, cr, { lumps: 4, detail: 0, color: 0xfffafd });
    blob(s.x1, s.z1, 1.8, 1.8, 0.18);
  }

  // ---------------------------------------------------------------- the rainbow bridge
  {
    const b = plan.bridge;
    const bkey = zoneKey((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    const g = batch.geo(bkey);
    const add = batch.geo(bkey, 'add');
    const cg = batch.geo(bkey, 'cloud');
    const yFn = (t) => bridgeProfile(b, t);
    const d = rainbowDeck(g, b.x0, b.z0, b.x1, b.z1, b.halfWidth, yFn, { step: 1.0, railH: 0.15, thick: 0.4 });
    // white posts with hearts, a handrail on top
    const posts = Math.round(d.len / 2.2);
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        const x = b.x0 + d.ux * d.len * t + d.nx * side * (b.halfWidth + 0.08);
        const z = b.z0 + d.uz * d.len * t + d.nz * side * (b.halfWidth + 0.08);
        const y = yFn(t);
        g.cyl(x, y + 0.1, z, 0.07, 0.95, K.white, { seg: 5 });
        heart(g, x, y + 1.18, z, 0.26, i % 2 ? K.pink : K.rPurple, { ry: Math.atan2(d.nx * side, d.nz * side) });
        heart(g, x, y + 1.18, z, 0.26, i % 2 ? K.pink : K.rPurple, { ry: Math.atan2(d.nx * side, d.nz * side) + Math.PI });
        pts.push([x, y + 0.98, z]);
      }
      g.tube(pts, 0.05, K.pinkPale, { seg: 4 });
    }
    // clouds under the span and at both ends
    const cr = rng(31);
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const x = b.x0 + d.ux * d.len * t;
      const z = b.z0 + d.uz * d.len * t;
      puff(cg, x + (cr() - 0.5) * 2, yFn(t) - 2.6 - cr() * 0.8, z + (cr() - 0.5) * 2, 1.4 + cr() * 0.6, cr, { lumps: 4, detail: 0, color: 0xfffafd, under: 0xead9f5 });
    }
    for (let i = 0; i < 10; i++) {
      const t = (i + 0.5) / 10;
      burst(add, b.x0 + d.ux * d.len * t + d.nx * (i % 2 ? 1 : -1) * 2.4, yFn(t) + 1.4 + (i % 3) * 0.3, b.z0 + d.uz * d.len * t + d.nz * (i % 2 ? 1 : -1) * 2.4, 0.22, i % 2 ? 0xffffff : 0xffe0f4, 0.6);
    }
  }

  // ---------------------------------------------------------------- the bow boutique (coming soon)
  {
    const shop = plan.boutique;
    const g = batch.geo(zoneKey(shop.x, shop.z));
    const glow = batch.geo(zoneKey(shop.x, shop.z), 'glow');
    const y = yAt(shop.x, shop.z);
    const W = shop.w;
    const D = shop.d;
    const H = 3.6;
    g.at(shop.x, y - 0.05, shop.z, shop.facing);
    glow.at(shop.x, y - 0.05, shop.z, shop.facing);
    // a gift box of a shop: white walls tied with a hot pink ribbon
    g.box(0, 0, 0, W + 0.4, 0.25, D + 0.4, 0xf3e6fb);
    g.box(0, 0.25, 0, W, H, D, K.white, { side: 0xf7eefb, back: 0xf7eefb });
    g.box(0, 0.25, 0, 1.0, H + 0.04, D + 0.04, K.pink, { noTop: true });
    g.box(0, 0.25, 0, W + 0.04, H + 0.04, 1.0, K.pink, { noTop: true });
    g.box(0, H + 0.25, 0, W + 0.5, 0.45, D + 0.5, K.pinkPale, { bottom: 0xf2c6dd });
    g.box(0, H + 0.7, 0, 1.0, 0.04, D + 0.5, K.pink);
    g.box(0, H + 0.7, 0, W + 0.5, 0.04, 1.0, K.pink);
    bow(g, 0, H + 1.6, 0.6, 3.4, { color: K.pink, star: K.black, detail: 'hi', rx: -0.25 });
    // striped awning over the windows, the door, a sign
    const FZ = D / 2 + 0.02;
    for (let i = 0; i < 10; i++) {
      const x0 = -W / 2 + (W * i) / 10;
      const x1 = -W / 2 + (W * (i + 1)) / 10;
      const col = i % 2 ? K.white : K.pinkSoft;
      g.quad([x0, 2.95, FZ], [x0, 2.45, FZ + 1.3], [x1, 2.45, FZ + 1.3], [x1, 2.95, FZ], col);
      g.quad([x1, 2.95, FZ], [x1, 2.45, FZ + 1.3], [x0, 2.45, FZ + 1.3], [x0, 2.95, FZ], shade(col, 0.75));
      g.tri2([x0, 2.45, FZ + 1.3], [x1, 2.45, FZ + 1.3], [(x0 + x1) / 2, 2.2, FZ + 1.3], col === K.white ? K.pinkSoft : K.white);
    }
    g.box(0, 0.25, FZ, 1.6, 2.2, 0.08, K.lilac);
    g.box(0, 0.35, FZ + 0.05, 1.4, 2.0, 0.06, 0xd9c6ff);
    heart(g, 0, 1.7, FZ + 0.1, 0.42, K.pink);
    g.box(0, 1.0, FZ + 0.1, 1.2, 0.36, 0.04, K.white, { bottom: true });
    g.text('SOON!', 0, 1.06, FZ + 0.13, 0.045, K.pink);
    for (const sx of [-1, 1]) {
      g.box(sx * 2.45, 0.85, FZ, 1.9, 1.6, 0.1, K.white);
      glow.quad([sx * 2.45 - 0.85, 0.92, FZ + 0.06], [sx * 2.45 + 0.85, 0.92, FZ + 0.06], [sx * 2.45 + 0.85, 2.36, FZ + 0.06], [sx * 2.45 - 0.85, 2.36, FZ + 0.06], 0xfff0f8);
      // bows on display
      for (let k = 0; k < 3; k++) bow(glow, sx * 2.45 - 0.55 + k * 0.55, 1.45 + (k % 2) * 0.35, FZ + 0.1, 0.42, { color: [K.pink, K.rPurple, 0xffb3d9][k], star: K.black, detail: 'lo' });
    }
    g.box(0, 3.05, FZ + 0.05, 5.6, 0.62, 0.12, K.black, { bottom: true });
    g.text('BOW BOUTIQUE', 0, 3.17, FZ + 0.12, 0.072, K.white);
    g.restore();
    glow.restore();
    blob(shop.x, shop.z, W / 2 + 1.2, D / 2 + 1.2, 0.22, shop.facing);
    // a welcome arch where the bridge lands
    const bx = plan.bridge.x1;
    const bz = plan.bridge.z1;
    const ry = Math.atan2(plan.bridge.x1 - plan.bridge.x0, plan.bridge.z1 - plan.bridge.z0) + Math.PI / 2;
    const ay = yAt(bx, bz);
    g.at(bx, ay, bz, ry);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI - (i / 12) * Math.PI;
      pts.push([Math.cos(a) * 2.1, 2.3 + Math.sin(a) * 1.1, 0]);
    }
    for (const sx of [-1, 1]) g.cyl(sx * 2.1, 0, 0, 0.1, 2.3, K.white, { seg: 5 });
    g.tube(pts, 0.1, K.white, { seg: 4 });
    for (let i = 0; i < 11; i++) g.ico(pts[i + 1][0], pts[i + 1][1] + 0.08, 0.05, 0.2, RAINBOW[i % RAINBOW.length], { detail: 0 });
    g.restore();
  }
  void toWorld;
  void text2;
  void star;
  return { treasures };
}

// ------------------------------------------------------------------------------------- treasures
// Each one is drawn at the origin (base at y = 0, facing +Z) in its own Geos so it can spin.
function drawTreasure(kind, g, glow, add, r) {
  // a fluffy little cloud pedestal
  g.ico(0, 0.18, 0, 0.5, 0xfffafd, { detail: 1, jitter: 0.1, rnd: r, sy: 0.55, flat: 0.3 });
  g.ico(0.35, 0.14, 0.1, 0.3, 0xf8eeff, { detail: 0, jitter: 0.1, rnd: r, sy: 0.7, flat: 0.3 });
  g.ico(-0.32, 0.15, -0.1, 0.32, 0xfffafd, { detail: 0, jitter: 0.1, rnd: r, sy: 0.7, flat: 0.3 });
  if (kind === 'poms') {
    // two golden pom-poms with silver streamers
    for (const sx of [-1, 1]) {
      const cx = sx * 0.28;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        const e = (i % 3) * 0.35 - 0.3;
        glow.cone(cx + Math.cos(a) * 0.05, 0.8, Math.sin(a) * 0.05, 0.05, 0.42, i % 2 ? 0xffd36e : 0xfff0b0, { seg: 3, rx: Math.sin(a) * (0.9 + e), rz: -Math.cos(a) * (0.9 + e) });
      }
      g.cyl(cx, 0.3, 0, 0.06, 0.5, K.white, { seg: 5, rz: sx * 0.25 });
    }
  } else if (kind === 'trophy') {
    g.cyl(0, 0.35, 0, 0.32, 0.18, 0xf1e6ff, { seg: 8 });
    g.lathe(0, 0.53, 0, [[0.24, 0, 0xffd36e], [0.1, 0.12, 0xffd36e], [0.07, 0.42, 0xffe08a], [0.3, 0.62, 0xffd36e], [0.42, 1.05, 0xffe08a], [0.4, 1.1]], 0xffd36e, { seg: 10, capTop: 0xd9a93a });
    for (const sx of [-1, 1]) g.tube([[sx * 0.38, 1.4, 0], [sx * 0.62, 1.35, 0], [sx * 0.55, 1.12, 0], [sx * 0.3, 1.0, 0]], 0.04, 0xffd36e, { seg: 4 });
    star(glow, 0, 2.0, 0, 0.3, 0.13, 0xfff0b0, { thick: 0.08 });
    burst(add, 0, 2.0, 0, 0.6, 0xffe7a0, 0.5);
  } else {
    // the spirit stick: a ribboned stick with a glowing star, the big prize
    g.cyl(0, 0.3, 0, 0.07, 1.6, 0xfff6fb, { seg: 6 });
    for (let i = 0; i < 6; i++) g.cyl(0, 0.45 + i * 0.24, 0, 0.078, 0.1, i % 2 ? K.pink : K.black, { seg: 6 });
    bow(g, 0, 1.75, 0.0, 0.55, { color: K.pink, star: K.black, detail: 'lo' });
    star(glow, 0, 2.35, 0, 0.5, 0.21, 0xffe066, { thick: 0.14, side: 0xffc94c });
    star(glow, 0, 2.35, 0.08, 0.3, 0.12, 0xffffff);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6;
      glow.tube([[0, 1.95, 0], [Math.cos(a) * 0.3, 1.5, Math.sin(a) * 0.3], [Math.cos(a) * 0.45, 1.0, Math.sin(a) * 0.45]], 0.03, [K.pink, K.rPurple, 0x9fd8ff, 0xffe066][i], { seg: 3 });
    }
    const sa = add.a;
    add.a = 0.22;
    add.ico(0, 2.35, 0, 0.5, 0xffe7a0, { detail: 1 });
    add.a = sa;
    burst(add, 0, 2.35, 0, 1.1, 0xfff4c0, 0.7);
    burst(add, 0, 2.35, 0, 0.7, 0xffffff, 0.6, { ry: Math.PI / 4 });
  }
}
