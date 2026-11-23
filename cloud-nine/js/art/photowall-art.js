// The photo wall's art (the plan is js/art/island-layout.js makePhotoWall): a big standing heart in her
// team's hot pink with a black rim set with rhinestones, hung between two striped poles that hold a
// banner over it ("Zuzu's Favorite People"), covered in tilted polaroids held on with washi tape and
// heart pins; fairy lights round its top, heart balloons on both sides, a bench, and a paved heart patio
// in front with stepping stones over to the garden path.
//
// Every polaroid (its frame, photo and caption) and the banner are painted into ONE canvas (the
// atlas), so all of them are one mesh and one draw call. Faces look true to life: the atlas is an sRGB
// texture on an unlit MeshBasicMaterial (toneMapped false; the renderer does no tone mapping anyway,
// and outputs sRGB). The canvas is kept for as long as the wall lives, so when WebGL comes back after
// losing its context, three.js uploads it again whole.
//
//   const art = buildPhotoWallArt(wall, { quality, yAt, title, atlasSize, renderer })
//   art.group                      add to the scene (built in world coordinates)
//   art.pick                       an invisible box round the board: tapping it walks her over
//   art.atlas                      { canvas, texture, size }
//   art.paintSlot(i, content)      repaints polaroid i: { kind: 'empty' } or
//                                  { kind: 'photo', image, w, h, caption } (image: anything drawImage takes)
//   art.setTitle(text)             repaints the banner
//   art.flush()                    sends what was repainted to the GPU: only the changed cells when it
//                                  can (WebGL 2), else the whole atlas once
//   art.slotAt(ray) -> i | -1      the polaroid a THREE.Ray hits (the top one), for "tap a photo"
//   art.update(dt, t)              fairy lights twinkle, rhinestones glint, balloons bob
//   art.drawCalls (5), art.triangles, art.dispose()
//
// Draw calls: the static wall (1), the polaroids and the banner (1), the fairy light bulbs (1), their
// glow and the rhinestone glints (1), the balloons (1, instanced).
//
// Pure (node tests): SLOTS, SLOT_SIZE, atlasLayout(size), slotFrame(i), BANNER, HANDWRITING, EMPTY_LINES

import * as THREE from '../../lib/three.module.min.js';
import { FONT_STACK } from '../config.js';
import { Geo } from './geo.js';
import { flatMat, glowMat, makeAddMaterial } from './materials.js';
import { bow, bench, K } from './island-kit.js';
import { motion } from './util.js';
import { heartPoint, HEART, PHOTO_WALL } from './island-layout.js';
import { coverCrop } from '../core/photos.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------ layout

// World size of a polaroid's frame (m): the star photo in the middle is bigger.
export const SLOT_SIZE = Object.freeze({ regular: Object.freeze({ w: 0.72, h: 0.86 }), star: Object.freeze({ w: 1.16, h: 1.38 }) });

// The polaroids on the board, in the order photos fill them (the first photo is the star). x across
// and y up, in metres from the heart curve's origin; tilt in degrees; layer: higher sits on top;
// hold: 'tape' | 'pin' | 'tapes' (the star: tape on both top corners).
export const SLOTS = Object.freeze([
  { x: 0, y: -0.02, tilt: -2, star: true, layer: 6, hold: 'tapes' },
  { x: -0.98, y: 1.16, tilt: -5, layer: 5, hold: 'tape' },
  { x: 0.98, y: 1.16, tilt: 4, layer: 5, hold: 'pin' },
  { x: -1.3, y: -0.06, tilt: 5, layer: 4, hold: 'pin' },
  { x: 1.3, y: -0.06, tilt: -5, layer: 4, hold: 'tape' },
  { x: -0.8, y: -1.08, tilt: -4, layer: 3, hold: 'tape' },
  { x: 0.8, y: -1.08, tilt: 6, layer: 3, hold: 'pin' },
  { x: -1.9, y: 1.02, tilt: 8, layer: 2, hold: 'pin' },
  { x: 1.9, y: 1.02, tilt: -7, layer: 2, hold: 'tape' },
  { x: -2.0, y: 0.12, tilt: -4, layer: 1, hold: 'tape' },
  { x: 2.0, y: 0.12, tilt: 5, layer: 1, hold: 'pin' },
  { x: 0, y: -1.86, tilt: 2, layer: 0, hold: 'pin' },
].map((s) => Object.freeze(s)));

// The atlas at 2048 px: the star's cell (800 x 960) and eleven 400 x 480 cells in a 5 x 3 grid, then
// the banner's strip across the bottom. A cell holds the polaroid with a margin for the tape and so
// mipmaps don't mix neighbours. A 1024 atlas (weak devices) is the same at half size.
const CELL = { w: 400, h: 480 };
const REG = { frame: [16, 20, 368, 440], photo: [34, 38, 332, 332], caption: [28, 376, 344, 78] };
const STAR = { frame: [28, 38, 744, 884], photo: [58, 68, 684, 684], caption: [48, 758, 704, 150] };
const REG_CELLS = [[2, 0], [3, 0], [4, 0], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2]];
export const BANNER = Object.freeze({ x: 0, y: 1460, w: 2048, h: 300, world: 3.9 });

export function atlasLayout(size = 2048) {
  const k = size / 2048;
  const R = (r, ox, oy) => ({ x: Math.round((ox + r[0]) * k), y: Math.round((oy + r[1]) * k), w: Math.round(r[2] * k), h: Math.round(r[3] * k) });
  const cells = SLOTS.map((s, i) => {
    const ox = s.star ? 0 : REG_CELLS[i - 1][0] * CELL.w;
    const oy = s.star ? 0 : REG_CELLS[i - 1][1] * CELL.h;
    const L = s.star ? STAR : REG;
    const cw = s.star ? CELL.w * 2 : CELL.w;
    const ch = s.star ? CELL.h * 2 : CELL.h;
    return {
      x: Math.round(ox * k), y: Math.round(oy * k), w: Math.round(cw * k), h: Math.round(ch * k),
      frame: R(L.frame, ox, oy), photo: R(L.photo, ox, oy), caption: R(L.caption, ox, oy),
    };
  });
  const banner = { x: Math.round(BANNER.x * k), y: Math.round(BANNER.y * k), w: Math.round(BANNER.w * k), h: Math.round(BANNER.h * k) };
  return { size, k, cells, banner };
}

// Slot i's quad on the board: its centre, the quad's size (the whole cell, margins included, so the
// frame comes out at SLOT_SIZE), the frame's size, tilt (radians) and how far it stands off the board.
export function slotFrame(i) {
  const s = SLOTS[i];
  const L = s.star ? STAR : REG;
  const size = s.star ? SLOT_SIZE.star : SLOT_SIZE.regular;
  const pxPerM = L.frame[2] / size.w;
  const cw = s.star ? CELL.w * 2 : CELL.w;
  const ch = s.star ? CELL.h * 2 : CELL.h;
  return { x: s.x, y: s.y, qw: cw / pxPerM, qh: ch / pxPerM, w: size.w, h: size.h, tilt: s.tilt * DEG, lift: 0.014 + s.layer * 0.007 };
}

// Captions in a handwritten face the device already has (no font files): Marker Felt and Noteworthy on
// iPhones and iPads, Segoe Print on Windows, the system's cursive elsewhere.
export const HANDWRITING = '"Marker Felt", "Noteworthy", "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';
export const EMPTY_LINES = Object.freeze({ star: Object.freeze(['Your photos go here!', 'They stay on this device.']), regular: 'Your photo here' });

// ------------------------------------------------------------------------------------------ colours

const PINK = 0xff2e93;
const PINK_DEEP = 0xd81b7a;
const PINK_SHADOW = 0xb30f62;
const BLACK = 0x17121c;
const WHITE = 0xfff8fc;
const STONES = [0xffffff, 0xff7ad1, 0xeae8f2, 0xa96bff];
const BULBS = [0xfff1b8, 0xff8cc6, 0xffd36e, 0xdcc6ff];
const BALLOONS = [0xff2e93, 0xff6fb0, 0xc6a4ff, 0xff4d7d];
const PASTELS = ['#ffd6ea', '#e6dbff', '#d4f5e6', '#d8edff', '#fff0bd', '#ffe0d0'];

// ------------------------------------------------------------------------------------------ heart geometry

// The outline as [x, y] (m) round the board, counter-clockwise seen from the front, `cy` up.
function heartRing(n, scale, cy) {
  const out = [];
  const p = [0, 0];
  for (let i = 0; i < n; i++) {
    heartPoint(-(i / n) * TAU, p); // the curve runs clockwise: walk it backwards
    out.push([p[0] * scale, cy + p[1] * scale]);
  }
  return out;
}
// The same heart shrunk about the middle of its height so its edge moves `by` metres in at the sides
// (and about as much at the top and the tip). A plain offset along the normals would fold over itself
// at the dip between the lobes.
function insetHeart(ring, scale, cy, by) {
  const k = 1 - by / ((HEART.width / 2) * scale);
  const my = cy + ((HEART.top + HEART.tip) / 2) * scale;
  return ring.map((p) => [p[0] * k, my + (p[1] - my) * k]);
}
// Points every `step` metres along a ring (or an open run of it), with the outward normal.
function along(ring, step, closed = true) {
  const out = [];
  const n = ring.length;
  const last = closed ? n : n - 1;
  let carry = 0;
  for (let i = 0; i < last; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    while (d < len) {
      const u = d / len;
      const tx = (b[0] - a[0]) / (len || 1);
      const ty = (b[1] - a[1]) / (len || 1);
      out.push({ x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, nx: ty, ny: -tx });
      d += step;
    }
    carry = d - len;
  }
  return out;
}

// An octahedron (a cut rhinestone) centred at p, pointing out of the board (+z).
function gem(g, x, y, z, r, hex) {
  const T = [x, y, z + r * 0.9];
  const Bk = [x, y, z - r * 0.4];
  const pts = [[x + r, y, z], [x, y + r, z], [x - r, y, z], [x, y - r, z]];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    g.tri(a, b, T, hex);
    g.tri(b, a, Bk, hex);
  }
}

// A floor triangle that faces up whichever way round it came.
function floorTri(g, a, b, c, hex) {
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if (ny >= 0) g.tri(a, b, c, hex);
  else g.tri(a, c, b, hex);
}

// ------------------------------------------------------------------------------------------ the static wall

function buildStatic(wall, q, yAt) {
  const g = new Geo();
  g.jit = 0.025;
  const B = wall.board;
  const S = B.scale;
  const zf = B.d / 2;
  const n = q === 'low' ? 84 : 120;
  const outer = heartRing(n, S, B.cy);
  const RIM = 0.15;
  const inner = insetHeart(outer, S, B.cy, RIM);
  const mid = [0, B.cy - 0.35];
  const P3 = (p, z) => [p[0], p[1], z];
  g.at(wall.x, wall.y, wall.z, wall.facing);

  // ---- the board: a black rim and a hot pink face, front and back, and its black edge
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    g.quad(P3(outer[i], zf), P3(outer[j], zf), P3(inner[j], zf), P3(inner[i], zf), BLACK);
    g.tri(P3(mid, zf), P3(inner[i], zf), P3(inner[j], zf), PINK);
    g.quad(P3(outer[j], -zf), P3(outer[i], -zf), P3(inner[i], -zf), P3(inner[j], -zf), BLACK);
    g.tri(P3(mid, -zf), P3(inner[j], -zf), P3(inner[i], -zf), PINK_DEEP);
    g.triOut(P3(outer[i], -zf), P3(outer[j], -zf), P3(outer[j], zf), BLACK, [0, B.cy, 0]);
    g.triOut(P3(outer[i], -zf), P3(outer[j], zf), P3(outer[i], zf), BLACK, [0, B.cy, 0]);
  }
  // ---- rhinestones all round the rim, front and back
  const studs = along(inner.map((p, i) => [(p[0] + outer[i][0]) / 2, (p[1] + outer[i][1]) / 2]), q === 'low' ? 0.42 : 0.3);
  studs.forEach((s, k) => {
    gem(g, s.x, s.y, zf + 0.004, 0.05, STONES[k % STONES.length]);
    if (k % 2 === 0) {
      g.save().scale(1, 1, -1);
      gem(g, s.x, s.y, zf + 0.004, 0.045, STONES[(k + 1) % STONES.length]);
      g.restore();
    }
  });
  // ---- the signature cheer bow on the back, with its black stars (the island's own bow)
  bow(g, 0, B.cy + 0.35, -zf - 0.04, 2.3, { color: PINK, star: BLACK, ry: Math.PI });
  // ---- soft shadows under the polaroids (a darker pink, down and to the right)
  for (let i = 0; i < SLOTS.length; i++) {
    const f = slotFrame(i);
    g.at(f.x + 0.035, B.cy + f.y - 0.05, zf + 0.005, 0, 0, f.tilt);
    const w = f.w / 2 + 0.012;
    const h = f.h / 2 + 0.012;
    g.quad([-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0], PINK_SHADOW);
    g.restore();
  }
  // ---- the board hangs from the poles on black brackets; a black plinth with pink trim under the tip
  for (const sx of [-1, 1]) {
    const x = sx * PHOTO_WALL.poleX;
    for (const y of [B.cy - 0.35, B.cy + 1.15]) {
      const len = PHOTO_WALL.poleBack - zf + 0.04;
      g.box(x, y, -zf - len / 2 + 0.02, 0.16, 0.12, len, BLACK);
    }
  }
  g.box(0, 0, -0.06, 0.95, 0.32, 0.5, BLACK, { top: 0x2a2030 });
  g.box(0, 0.32, -0.06, 1.0, 0.06, 0.55, PINK);
  // ---- the banner's poles: black with hot pink stripes, a pink pompom on top
  const top = bannerTop(wall);
  for (const sx of [-1, 1]) {
    const x = sx * PHOTO_WALL.poleX;
    const z = -PHOTO_WALL.poleBack;
    g.cyl(x, 0, z, 0.06, top + 0.08, BLACK, { seg: 8 });
    for (let y = 0.35; y < top - 0.2; y += 0.62) g.cyl(x, y, z, 0.068, 0.16, PINK, { seg: 8 });
    g.ico(x, top + 0.2, z, 0.16, PINK, { detail: 1 });
    g.box(x, -0.02, z, 0.36, 0.1, 0.36, BLACK);
    // little hooks the banner hangs from
    g.box(x - sx * 0.07, top - 0.06, z + 0.05, 0.16, 0.06, 0.06, 0xffd36e);
  }
  // ---- the balloons' stakes
  for (const sx of [-1, 1]) {
    const x = sx * PHOTO_WALL.stakeX;
    g.cyl(x, 0, PHOTO_WALL.stakeAt, 0.035, 0.55, WHITE, { seg: 6 });
    g.ico(x, 0.58, PHOTO_WALL.stakeAt, 0.07, PINK);
  }
  // ---- the patio: a paved heart lying on the grass, lobes at the board's foot, tip toward the plaza
  {
    const pw = wall.patio.w;
    const ps = pw / HEART.width;
    const toFloor = (p, y) => [p[0] * ps, y, wall.patio.at + (HEART.top - p[1]) * ps];
    const ring = [];
    const pt = [0, 0];
    const m = q === 'low' ? 48 : 72;
    for (let i = 0; i < m; i++) ring.push([...heartPoint((i / m) * TAU, pt)]);
    const centre = [0, 1.2];
    const kerb = insetHeart(ring, 1, 0, 0.55 / ps);
    const Y = 0.03;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ray = Math.floor((i * 16) / m) % 2 ? 0xffd2e6 : 0xffe9f3;
      floorTri(g, toFloor(centre, Y), toFloor(kerb[i], Y), toFloor(kerb[j], Y), ray);
      floorTri(g, toFloor(kerb[i], Y), toFloor(ring[i], Y + 0.01), toFloor(ring[j], Y + 0.01), WHITE);
      floorTri(g, toFloor(kerb[i], Y), toFloor(ring[j], Y + 0.01), toFloor(kerb[j], Y), WHITE);
    }
    // a hot pink heart inlaid in the middle, where she stands
    const small = 0.9 / HEART.width;
    const cz = wall.patio.at + (HEART.top - centre[1]) * ps;
    for (let i = 0; i < 32; i++) {
      const a = heartPoint((i / 32) * TAU, [0, 0]);
      const b = heartPoint(((i + 1) / 32) * TAU, [0, 0]);
      const P = (p) => [p[0] * small, Y + 0.012, cz - 0.05 - (p[1] - 2) * small];
      floorTri(g, [0, Y + 0.012, cz], P(a), P(b), PINK);
    }
  }
  g.restore();

  // ---- the bench beside the patio, facing the wall (world coordinates): the island's bench in her colours
  {
    const b = wall.bench;
    bench(g, b.x, yAt(b.x, b.z), b.z, b.facing, { color: K.pink, leg: BLACK });
  }
  // ---- stepping stones over the grass to the garden path
  wall.stones.forEach((s, k) => {
    g.cyl(s.x, yAt(s.x, s.z) - 0.03, s.z, s.r, 0.09, k % 2 ? 0xffe3ef : 0xf3e6ff, { seg: 7, ph: k });
  });
  return g;
}

// The banner's top edge, above the lobes of the heart (m from the ground).
function bannerTop(wall) {
  const B = wall.board;
  return B.cy + HEART.top * B.scale + 0.15 + (BANNER.world * BANNER.h) / BANNER.w;
}

// ------------------------------------------------------------------------------------------ the polaroids

function buildPolaroids(wall, layout) {
  const g = new Geo({ uv: true });
  const B = wall.board;
  const zf = B.d / 2;
  const S = layout.size;
  const uv = (r) => [r.x / S, 1 - (r.y + r.h) / S, (r.x + r.w) / S, 1 - r.y / S];
  g.at(wall.x, wall.y, wall.z, wall.facing);
  for (let i = 0; i < SLOTS.length; i++) {
    const f = slotFrame(i);
    const [u0, v0, u1, v1] = uv(layout.cells[i]);
    g.at(f.x, B.cy + f.y, zf + f.lift, 0, 0, f.tilt);
    const w = f.qw / 2;
    const h = f.qh / 2;
    g.quadUV([-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0], 0xffffff, u0, v0, u1, v1);
    g.restore();
  }
  // the banner, both sides, the text the right way round from each
  {
    const [u0, v0, u1, v1] = uv(layout.banner);
    const top = bannerTop(wall);
    const bw = BANNER.world / 2;
    const bh = (BANNER.world * BANNER.h) / BANNER.w;
    const z = -PHOTO_WALL.poleBack + 0.09;
    g.quadUV([-bw, top - bh, z], [bw, top - bh, z], [bw, top, z], [-bw, top, z], 0xffffff, u0, v0, u1, v1);
    g.quadUV([bw, top - bh, z - 0.02], [-bw, top - bh, z - 0.02], [-bw, top, z - 0.02], [bw, top, z - 0.02], 0xffffff, u0, v0, u1, v1);
  }
  g.restore();
  return g;
}

// ------------------------------------------------------------------------------------------ fairy lights

function buildLights(wall, q) {
  const B = wall.board;
  const zf = B.d / 2;
  // the upper part of the outline, from the middle of one side over both lobes to the other side
  const n = 160;
  const run = [];
  const p = [0, 0];
  for (let i = 0; i <= n; i++) {
    const t = 2.05 - (4.1 * i) / n; // counter-clockwise, so along() gives outward normals
    heartPoint(t, p);
    run.push([p[0] * B.scale, B.cy + p[1] * B.scale]);
  }
  const pts = along(run, q === 'low' ? 0.42 : 0.3, false);
  const bulbs = new Geo();
  const halos = new Geo({ alpha: true });
  const list = [];
  bulbs.at(wall.x, wall.y, wall.z, wall.facing);
  halos.at(wall.x, wall.y, wall.z, wall.facing);
  pts.forEach((s, k) => {
    // draped: the string sags out a little between the pins
    const sag = 0.17 + 0.07 * Math.abs(Math.sin((k * Math.PI) / 4));
    const x = s.x + s.nx * sag;
    const y = s.y + s.ny * sag;
    const z = zf + 0.05;
    const hex = BULBS[k % BULBS.length];
    gem(bulbs, x, y, z, 0.045, hex);
    const from = halos.c.length;
    const r = 0.17;
    const seg = 6;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU;
      const a1 = ((i + 1) / seg) * TAU;
      halos.triG([x, y, z + 0.01], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, z + 0.01], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, z + 0.01], hex, hex, hex, 0.85, 0, 0);
    }
    list.push({ from, to: halos.c.length, k });
  });
  // a few rhinestones on the rim catch the light now and then: four-point glints
  const glints = [];
  const outer = heartRing(96, B.scale, B.cy);
  const inner = insetHeart(outer, B.scale, B.cy, 0.075);
  for (let k = 0; k < (q === 'low' ? 6 : 10); k++) {
    const i = Math.floor((k * 96) / (q === 'low' ? 6 : 10) + 5) % 96;
    const x = inner[i][0];
    const y = inner[i][1];
    const z = zf + 0.07;
    const from = halos.c.length;
    const L = 0.2;
    const w = 0.035;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      halos.triG([x, y, z], [x + dx * L - dy * w, y + dy * L + dx * w, z], [x + dx * L + dy * w, y + dy * L - dx * w, z], 0xffffff, 0xffffff, 0xffffff, 1, 0, 0);
      halos.triG([x - dy * w * 1.5, y + dx * w * 1.5, z], [x + dx * L * 0.35, y + dy * L * 0.35, z], [x + dy * w * 1.5, y - dx * w * 1.5, z], 0xffffff, 0xffffff, 0xffffff, 0.8, 0.8, 0.8);
    }
    glints.push({ from, to: halos.c.length, k });
  }
  bulbs.restore();
  halos.restore();
  return { bulbs, halos, list, glints };
}

// ------------------------------------------------------------------------------------------ balloons

function balloonGeometry() {
  const g = new Geo();
  const L = 2.6;
  g.box(0, 0, 0, 0.018, L, 0.018, 0xffffff); // the ribbon
  g.ico(0, L + 0.03, 0, 0.04, 0xffffff); // the knot
  g.at(0, L + 0.36, 0, 0, 0, 0);
  g.ico(-0.15, 0.1, 0, 0.2, 0xffffff, { sz: 0.6, detail: 1 });
  g.ico(0.15, 0.1, 0, 0.2, 0xffffff, { sz: 0.6, detail: 1 });
  g.cone(0, 0.06, 0, 0.29, 0.38, 0xffffff, { seg: 8, rx: Math.PI, sz: 0.5 });
  g.ico(-0.17, 0.2, 0.09, 0.05, 0xffffff); // a shine
  g.restore();
  return g;
}

// ------------------------------------------------------------------------------------------ painting

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function heartPath(ctx, x, y, s) {
  // a heart about 2s across, centred on (x, y)
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.95);
  ctx.bezierCurveTo(x - s * 1.45, y - s * 0.05, x - s * 0.7, y - s * 1.15, x, y - s * 0.42);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.15, x + s * 1.45, y - s * 0.05, x, y + s * 0.95);
  ctx.closePath();
}
function starPath(ctx, x, y, r, inner = 0.48, points = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
function sparkle(ctx, x, y, r, color) {
  starPath(ctx, x, y, r, 0.3, 4, 0);
  ctx.fillStyle = color;
  ctx.fill();
}

// Washi tape across a top edge: a strip with zigzag ends and a pattern, a little crooked.
function tape(ctx, cx, cy, w, h, angle, style) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  const zz = h / 6;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 0; i <= 6; i++) ctx.lineTo(w / 2 + (i % 2 ? -zz : 0), -h / 2 + (h * i) / 6);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = 6; i >= 0; i--) ctx.lineTo(-w / 2 + (i % 2 ? zz : 0), -h / 2 + (h * i) / 6);
  ctx.closePath();
  const base = ['#ff8cc6', '#c9b1ff', '#9fe3c6', '#ffd36e'][style % 4];
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  if (style % 2) {
    for (let x = -w / 2 - h; x < w / 2 + h; x += h * 0.7) {
      ctx.beginPath();
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x + h * 0.3, -h / 2);
      ctx.lineTo(x + h * 0.3 + h * 0.5, h / 2);
      ctx.lineTo(x + h * 0.5, h / 2);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    for (let x = -w / 2 + h * 0.4; x < w / 2; x += h * 0.55) {
      for (const y of [-h * 0.2, h * 0.22]) {
        ctx.beginPath();
        ctx.arc(x + (y > 0 ? h * 0.27 : 0), y, h * 0.09, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, h * 0.04);
  ctx.strokeStyle = 'rgba(23,18,28,0.25)';
  ctx.stroke();
  ctx.restore();
}

// A heart-shaped push pin.
function pin(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = 'rgba(80,10,50,0.35)';
  heartPath(ctx, x + s * 0.18, y + s * 0.2, s);
  ctx.fill();
  const grd = ctx.createLinearGradient(x, y - s, x, y + s);
  grd.addColorStop(0, '#ff6fb8');
  grd.addColorStop(1, '#e0137c');
  ctx.fillStyle = grd;
  heartPath(ctx, x, y, s);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.12);
  ctx.strokeStyle = '#17121c';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.38, y - s * 0.3, s * 0.18, s * 0.11, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Fits text on at most two lines in width w, as big as fits up to `size`: -> { lines, size }
function fitLines(ctx, text, w, size, min, family, weight = '700') {
  const words = String(text).split(' ');
  for (let s = size; s >= min; s -= 2) {
    ctx.font = weight + ' ' + s + 'px ' + family;
    if (ctx.measureText(text).width <= w) return { lines: [text], size: s };
    // the best place to break it in two
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (m <= w && (!best || m < best.m)) best = { m, lines: [a, b] };
    }
    if (best && s <= size * 0.86) return { lines: best.lines, size: s };
  }
  ctx.font = weight + ' ' + min + 'px ' + family;
  // still too long (one long word): cut it to fit
  let cut = String(text);
  while (cut.length > 1 && ctx.measureText(cut + '...').width > w) cut = cut.slice(0, -1);
  return { lines: [cut === text ? cut : cut.trim() + '...'], size: min };
}

function doodle(ctx, kind, x, y, s) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, s * 0.1);
  ctx.strokeStyle = '#ff2e93';
  ctx.fillStyle = '#ffffff';
  if (kind === 'heart') {
    heartPath(ctx, x, y + s * 0.05, s * 0.85);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff8cc6';
    heartPath(ctx, x, y + s * 0.08, s * 0.42);
    ctx.fill();
  } else if (kind === 'bow') {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + sx * s * 0.4, y - s * 0.8, x + sx * s * 1.25, y - s * 0.55, x + sx * s * 1.05, y + s * 0.05);
      ctx.bezierCurveTo(x + sx * s * 0.95, y + s * 0.5, x + sx * s * 0.35, y + s * 0.35, x, y);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + sx * s * 0.08, y + s * 0.1);
      ctx.lineTo(x + sx * s * 0.45, y + s * 0.85);
      ctx.lineTo(x + sx * s * 0.2, y + s * 0.78);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y + s * 0.02, s * 0.2, 0, TAU);
    ctx.fillStyle = '#ff2e93';
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'star') {
    starPath(ctx, x, y + s * 0.06, s, 0.5);
    ctx.fill();
    ctx.stroke();
  } else {
    // a big plus in a circle
    ctx.beginPath();
    ctx.arc(x, y, s * 0.85, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = Math.max(3, s * 0.2);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.42, y);
    ctx.lineTo(x + s * 0.42, y);
    ctx.moveTo(x, y - s * 0.42);
    ctx.lineTo(x, y + s * 0.42);
    ctx.stroke();
  }
  ctx.restore();
}

// One polaroid into its cell: the white frame, the photo (cover-cropped, a little above the middle)
// or a placeholder, the caption in handwriting, and the tape or pin that holds it on.
function paintPolaroid(ctx, cell, i, content, k) {
  const s = SLOTS[i];
  const f = cell.frame;
  const ph = cell.photo;
  const cap = cell.caption;
  ctx.save();
  ctx.clearRect(cell.x, cell.y, cell.w, cell.h);
  ctx.beginPath();
  ctx.rect(cell.x, cell.y, cell.w, cell.h);
  ctx.clip();
  // the frame: warm white card, a faint edge
  roundRect(ctx, f.x, f.y, f.w, f.h, 7 * k);
  ctx.fillStyle = '#fffdf7';
  ctx.fill();
  ctx.lineWidth = 2 * k;
  ctx.strokeStyle = '#e9dfe6';
  ctx.stroke();
  const photo = content && content.kind === 'photo' && content.image ? content : null;
  if (photo) {
    const c = coverCrop(photo.w, photo.h, ph.w, ph.h);
    ctx.drawImage(photo.image, c.sx, c.sy, c.sw, c.sh, ph.x, ph.y, ph.w, ph.h);
  } else {
    const bg = PASTELS[i % PASTELS.length];
    ctx.fillStyle = bg;
    ctx.fillRect(ph.x, ph.y, ph.w, ph.h);
    // tiny hearts and dots in the paper
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let yy = 0; yy < 5; yy++) {
      for (let xx = 0; xx < 5; xx++) {
        const px = ph.x + ((xx + 0.5 + (yy % 2) * 0.5) * ph.w) / 5;
        const py = ph.y + ((yy + 0.5) * ph.h) / 5;
        if (px > ph.x + ph.w - 4) continue;
        ctx.beginPath();
        ctx.arc(px, py, ph.w * 0.012, 0, TAU);
        ctx.fill();
      }
    }
    const kinds = ['heart', 'plus', 'bow', 'star'];
    doodle(ctx, s.star ? 'heart' : kinds[i % kinds.length], ph.x + ph.w / 2, ph.y + ph.h * 0.5, ph.w * 0.24);
  }
  // a soft inner line round the photo
  ctx.lineWidth = 1.5 * k;
  ctx.strokeStyle = 'rgba(23,18,28,0.12)';
  ctx.strokeRect(ph.x + 0.5, ph.y + 0.5, ph.w - 1, ph.h - 1);
  // the caption
  const text = photo ? photo.caption || '' : null;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (photo) {
    if (text) {
      const fit = fitLines(ctx, text, cap.w - 10 * k, Math.round((s.star ? 58 : 36) * k), Math.round((s.star ? 34 : 22) * k), HANDWRITING);
      ctx.font = '700 ' + fit.size + 'px ' + HANDWRITING;
      ctx.fillStyle = '#2b2233';
      const lh = fit.size * 1.05;
      fit.lines.forEach((line, n) => ctx.fillText(line, cap.x + cap.w / 2, cap.y + cap.h / 2 + (n - (fit.lines.length - 1) / 2) * lh, cap.w));
    } else {
      // no caption yet: a little row of hearts
      ctx.fillStyle = '#ff8cc6';
      for (let n = -1; n <= 1; n++) {
        heartPath(ctx, cap.x + cap.w / 2 + n * cap.h * 0.42, cap.y + cap.h / 2, cap.h * 0.13);
        ctx.fill();
      }
    }
  } else if (s.star) {
    const [l1, l2] = EMPTY_LINES.star;
    let size = Math.round(54 * k);
    ctx.font = '700 ' + size + 'px ' + HANDWRITING;
    while (size > 24 * k && ctx.measureText(l1).width > cap.w - 10 * k) {
      size -= 2;
      ctx.font = '700 ' + size + 'px ' + HANDWRITING;
    }
    ctx.fillStyle = '#c2156f';
    ctx.fillText(l1, cap.x + cap.w / 2, cap.y + cap.h * 0.34, cap.w);
    let small = Math.round(36 * k);
    ctx.font = '700 ' + small + 'px ' + HANDWRITING;
    while (small > 18 * k && ctx.measureText(l2).width > cap.w - 10 * k) {
      small -= 2;
      ctx.font = '700 ' + small + 'px ' + HANDWRITING;
    }
    ctx.fillStyle = '#2b2233';
    ctx.fillText(l2, cap.x + cap.w / 2, cap.y + cap.h * 0.74, cap.w);
  } else {
    const fit = fitLines(ctx, EMPTY_LINES.regular, cap.w - 10 * k, Math.round(32 * k), Math.round(20 * k), HANDWRITING);
    ctx.font = '700 ' + fit.size + 'px ' + HANDWRITING;
    ctx.fillStyle = '#9a6b8a';
    ctx.fillText(fit.lines[0], cap.x + cap.w / 2, cap.y + cap.h / 2, cap.w);
  }
  // the star photo: a gold star sticker and rhinestones on the frame
  if (s.star) {
    const sx = ph.x + ph.w - 18 * k;
    const sy = ph.y + ph.h - 14 * k;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(0.2);
    starPath(ctx, 0, 0, 54 * k, 0.5);
    ctx.fillStyle = '#ffd36e';
    ctx.fill();
    ctx.lineWidth = 6 * k;
    ctx.strokeStyle = '#17121c';
    ctx.stroke();
    ctx.restore();
    sparkle(ctx, sx - 10 * k, sy - 12 * k, 14 * k, '#ffffff');
    for (const [gx, gy] of [[f.x + 14 * k, f.y + f.h - 16 * k], [f.x + f.w - 14 * k, f.y + f.h - 16 * k]]) {
      ctx.beginPath();
      ctx.arc(gx, gy, 7 * k, 0, TAU);
      ctx.fillStyle = '#ff7ad1';
      ctx.fill();
      sparkle(ctx, gx, gy, 9 * k, '#ffffff');
    }
  }
  // what holds it on: tape across the top, a heart pin, or (the star) tape on both corners
  if (s.hold === 'tapes') {
    tape(ctx, f.x + 40 * k, f.y + 14 * k, 150 * k, 44 * k, -0.62, 0);
    tape(ctx, f.x + f.w - 40 * k, f.y + 14 * k, 150 * k, 44 * k, 0.62, 1);
  } else if (s.hold === 'tape') {
    tape(ctx, f.x + f.w / 2 + ((i % 3) - 1) * 14 * k, f.y + 4 * k, 128 * k, 34 * k, ((i % 5) - 2) * 0.045, i);
  } else {
    pin(ctx, f.x + f.w / 2, f.y + 18 * k, 17 * k);
  }
  ctx.restore();
}

// The banner: a hot pink ribbon with folded black ends, the words in white with a black edge, hearts
// and rhinestones.
function paintBanner(ctx, r, title, k) {
  ctx.save();
  ctx.clearRect(r.x, r.y, r.w, r.h);
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const x0 = r.x;
  const y0 = r.y;
  const W = r.w;
  const H = r.h;
  const end = 150 * k;
  const band = { x: x0 + end * 0.7, y: y0 + H * 0.12, w: W - end * 1.4, h: H * 0.76 };
  // the folded tails behind each end
  for (const sx of [-1, 1]) {
    const cx = sx < 0 ? x0 : x0 + W;
    ctx.beginPath();
    ctx.moveTo(cx - sx * end * 1.05, band.y + band.h * 0.2);
    ctx.lineTo(cx, band.y + band.h * 0.2);
    ctx.lineTo(cx - sx * end * 0.35, band.y + band.h * 0.62);
    ctx.lineTo(cx, band.y + band.h * 1.04);
    ctx.lineTo(cx - sx * end * 1.05, band.y + band.h * 1.04);
    ctx.closePath();
    ctx.fillStyle = '#b30f62';
    ctx.fill();
    ctx.lineWidth = 8 * k;
    ctx.strokeStyle = '#17121c';
    ctx.stroke();
  }
  roundRect(ctx, band.x, band.y, band.w, band.h, 26 * k);
  const grd = ctx.createLinearGradient(0, band.y, 0, band.y + band.h);
  grd.addColorStop(0, '#ff5aa9');
  grd.addColorStop(0.55, '#ff2e93');
  grd.addColorStop(1, '#e0137c');
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.lineWidth = 10 * k;
  ctx.strokeStyle = '#17121c';
  ctx.stroke();
  // a stitched line inside the edge
  ctx.setLineDash([16 * k, 12 * k]);
  ctx.lineWidth = 4 * k;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  roundRect(ctx, band.x + 16 * k, band.y + 16 * k, band.w - 32 * k, band.h - 32 * k, 16 * k);
  ctx.stroke();
  ctx.setLineDash([]);
  // the words, as big as fit
  const text = String(title || 'Favorite People');
  const room = band.w - 230 * k;
  let size = Math.round(132 * k);
  ctx.font = '900 ' + size + 'px ' + FONT_STACK;
  while (size > 40 * k && ctx.measureText(text).width > room) {
    size -= 3;
    ctx.font = '900 ' + size + 'px ' + FONT_STACK;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tx = band.x + band.w / 2;
  const ty = band.y + band.h / 2 + 4 * k;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 18 * k;
  ctx.strokeStyle = '#17121c';
  ctx.strokeText(text, tx, ty, room);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, tx, ty, room);
  // hearts at both ends of the words, and rhinestones along the band
  const tw = Math.min(room, ctx.measureText(text).width);
  for (const sx of [-1, 1]) {
    const hx = tx + sx * (tw / 2 + 62 * k);
    ctx.fillStyle = '#ffffff';
    heartPath(ctx, hx, ty, 34 * k);
    ctx.fill();
    ctx.lineWidth = 7 * k;
    ctx.strokeStyle = '#17121c';
    ctx.stroke();
  }
  for (let i = 0; i < 9; i++) {
    const gx = band.x + 50 * k + (i * (band.w - 100 * k)) / 8;
    for (const gy of [band.y + 8 * k, band.y + band.h - 8 * k]) {
      ctx.beginPath();
      ctx.arc(gx, gy, 9 * k, 0, TAU);
      ctx.fillStyle = i % 2 ? '#eae8f2' : '#ff7ad1';
      ctx.fill();
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = '#17121c';
      ctx.stroke();
    }
  }
  sparkle(ctx, band.x + band.w - 40 * k, band.y + 26 * k, 26 * k, '#ffffff');
  sparkle(ctx, band.x + 44 * k, band.y + band.h - 30 * k, 20 * k, '#ffffff');
  ctx.restore();
}

// ------------------------------------------------------------------------------------------ build

export function buildPhotoWallArt(wall, { quality = 'high', yAt = () => wall.y, title = 'Favorite People', atlasSize = 2048, renderer = null } = {}) {
  const q = quality === 'low' ? 'low' : 'high';
  const group = new THREE.Group();
  group.name = 'photoWall';
  const own = [];
  const ground = (x, z) => {
    const y = yAt(x, z);
    return Number.isFinite(y) ? y : wall.y;
  };

  // ---- the static wall
  const stat = buildStatic(wall, q, ground);
  const statGeo = stat.build();
  own.push(statGeo);
  const statMesh = new THREE.Mesh(statGeo, flatMat);
  statMesh.name = 'photoWallBoard';
  group.add(statMesh);

  // ---- the atlas: every polaroid and the banner
  const size = atlasSize >= 2048 ? 2048 : 1024;
  const layout = atlasLayout(size);
  let canvas = null;
  let ctx = null;
  let tex = null;
  const dirty = new Set();
  let wholeDirty = true;
  let scratch = null;
  let scratchTex = null;
  const canPartial = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2 && typeof renderer.copyTextureToTexture === 'function');
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    ctx = canvas.getContext('2d');
  }
  if (ctx) {
    for (let i = 0; i < SLOTS.length; i++) paintPolaroid(ctx, layout.cells[i], i, { kind: 'empty' }, layout.k);
    paintBanner(ctx, layout.banner, title, layout.k);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer && renderer.capabilities ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
    own.push(tex);
  }
  const polGeo = buildPolaroids(wall, layout).build();
  own.push(polGeo);
  const polMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false, fog: false, vertexColors: false });
  own.push(polMat);
  const polMesh = new THREE.Mesh(polGeo, polMat);
  polMesh.name = 'photoWallPolaroids';
  polMesh.visible = !!tex;
  group.add(polMesh);

  // ---- fairy lights
  const lights = buildLights(wall, q);
  const bulbGeo = lights.bulbs.build();
  const haloGeo = lights.halos.build();
  own.push(bulbGeo, haloGeo);
  const bulbMesh = new THREE.Mesh(bulbGeo, glowMat);
  bulbMesh.name = 'photoWallBulbs';
  group.add(bulbMesh);
  const haloMat = makeAddMaterial(0xffffff, 0.9);
  own.push(haloMat);
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.name = 'photoWallGlow';
  haloMesh.renderOrder = 3;
  group.add(haloMesh);
  const haloCol = haloGeo.attributes.color;
  const haloBase = Float32Array.from(haloCol.array);

  // ---- heart balloons on both sides
  const balloonGeo = balloonGeometry().build();
  own.push(balloonGeo);
  const balloons = new THREE.InstancedMesh(balloonGeo, flatMat, 4);
  balloons.name = 'photoWallBalloons';
  balloons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tie = [];
  const col = new THREE.Color();
  [[-1, 0, 1.0, 0.25], [-1, 1, 0.86, -0.3], [1, 0, 0.94, -0.2], [1, 1, 1.06, 0.3]].forEach(([sx, k, s, lean], i) => {
    const stake = wall.stakes[sx < 0 ? 0 : 1];
    tie.push({ x: stake.x, y: ground(stake.x, stake.z) + 0.58, z: stake.z, s, lean: lean + sx * 0.12, ph: i * 1.9 + k });
    balloons.setColorAt(i, col.setHex(BALLOONS[i]));
  });
  // the balloons, the stakes and the polaroids all stay near the wall: one bounding sphere
  balloons.boundingSphere = new THREE.Sphere(new THREE.Vector3(wall.x, wall.y + 3, wall.z), 7);
  group.add(balloons);
  const m4 = new THREE.Matrix4();
  const qt = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  function poseBalloons(t, m) {
    for (let i = 0; i < tie.length; i++) {
      const b = tie[i];
      const sway = Math.sin(t * 0.8 + b.ph) * 0.09 * m;
      eul.set(Math.sin(t * 0.6 + b.ph * 1.3) * 0.05 * m, wall.facing, b.lean * 0.32 + sway);
      qt.setFromEuler(eul);
      pos.set(b.x, b.y + Math.sin(t * 1.1 + b.ph) * 0.04 * m, b.z);
      scl.setScalar(b.s);
      m4.compose(pos, qt, scl);
      balloons.setMatrixAt(i, m4);
    }
    balloons.instanceMatrix.needsUpdate = true;
  }
  poseBalloons(0, 1);

  // ---- the invisible box round the board: tapping it walks her over (never drawn)
  const B = wall.board;
  const pick = new THREE.Mesh(new THREE.BoxGeometry(B.w + 0.3, B.h + 1.0, 0.8), new THREE.MeshBasicMaterial());
  own.push(pick.geometry, pick.material);
  {
    const c = Math.cos(wall.facing);
    const s = Math.sin(wall.facing);
    const ly = B.cy + ((HEART.top + HEART.tip) / 2) * B.scale;
    pick.position.set(wall.x + 0.1 * s, wall.y + ly, wall.z + 0.1 * c);
    pick.rotation.y = wall.facing;
    pick.updateMatrixWorld(true);
  }

  // ---- which polaroid is under a ray
  const inv = new THREE.Matrix4();
  const wallMatrix = new THREE.Matrix4().compose(new THREE.Vector3(wall.x, wall.y, wall.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, wall.facing, 0)), new THREE.Vector3(1, 1, 1));
  inv.copy(wallMatrix).invert();
  const lray = new THREE.Ray();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(B.d / 2 + 0.02));
  const hit = new THREE.Vector3();
  const byLayer = SLOTS.map((s, i) => i).sort((a, b) => SLOTS[b].layer - SLOTS[a].layer);
  function slotAt(ray) {
    if (!ray) return -1;
    lray.copy(ray).applyMatrix4(inv);
    if (lray.direction.z >= 0) return -1; // from behind
    if (!lray.intersectPlane(plane, hit)) return -1;
    for (const i of byLayer) {
      const f = slotFrame(i);
      const dx = hit.x - f.x;
      const dy = hit.y - (B.cy + f.y);
      const c = Math.cos(-f.tilt);
      const s = Math.sin(-f.tilt);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      if (Math.abs(lx) <= f.w / 2 && Math.abs(ly) <= f.h / 2) return i;
    }
    return -1;
  }

  // ---- painting and uploading
  function paintSlot(i, content) {
    if (!ctx || !(i >= 0 && i < SLOTS.length)) return;
    paintPolaroid(ctx, layout.cells[i], i, content, layout.k);
    dirty.add(i);
  }
  function setTitle(text) {
    if (!ctx) return;
    paintBanner(ctx, layout.banner, text, layout.k);
    dirty.add('banner');
  }
  let uploaded = false;
  if (tex) {
    tex.onUpdate = () => {
      uploaded = true;
    };
  }
  // the whole atlas now (while the game loads, so the first look at the wall costs nothing)
  if (tex && renderer && typeof renderer.initTexture === 'function') {
    try {
      renderer.initTexture(tex);
      wholeDirty = false;
    } catch (err) { /* it goes up with the first frame instead */ }
  }
  const at = new THREE.Vector2();
  function flush() {
    if (!tex || (!dirty.size && !wholeDirty)) return;
    if (wholeDirty || !uploaded || !canPartial) {
      tex.needsUpdate = true;
      wholeDirty = false;
      dirty.clear();
      return;
    }
    try {
      for (const key of dirty) {
        const r = key === 'banner' ? layout.banner : layout.cells[key];
        if (!scratch) {
          scratch = document.createElement('canvas');
          scratchTex = new THREE.Texture(scratch);
        }
        if (scratch.width !== r.w || scratch.height !== r.h) {
          scratch.width = r.w;
          scratch.height = r.h;
        }
        const sc = scratch.getContext('2d');
        sc.clearRect(0, 0, r.w, r.h);
        sc.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        // the canvas's top row is the texture's top (flipY): rows count up from the bottom there
        at.set(r.x, size - r.y - r.h);
        renderer.copyTextureToTexture(at, scratchTex, tex, 0);
      }
    } catch (err) {
      tex.needsUpdate = true;
    }
    dirty.clear();
  }

  // ---- per frame
  const m = motion();
  const haloAlpha = haloCol.array;
  const stride = haloCol.itemSize;
  let haloClock = 0;
  function update(dt, t) {
    poseBalloons(t, m);
    haloClock += dt;
    if (haloClock < 0.07) return;
    haloClock = 0;
    // the fairy lights: a slow twinkle running along the string; the rhinestones glint now and then
    for (const b of lights.list) {
      const f = m < 0.5 ? 0.9 : 0.55 + 0.45 * Math.sin(t * 2.3 - b.k * 0.7);
      for (let v = b.from / stride; v < b.to / stride; v++) haloAlpha[v * stride + 3] = haloBase[v * stride + 3] * f;
    }
    for (const gl of lights.glints) {
      const ph = (t * 0.55 + gl.k * 0.37) % 1;
      const f = m < 0.5 ? 0 : ph < 0.12 ? Math.sin((ph / 0.12) * Math.PI) : 0;
      for (let v = gl.from / stride; v < gl.to / stride; v++) haloAlpha[v * stride + 3] = haloBase[v * stride + 3] * f;
    }
    haloCol.needsUpdate = true;
  }
  update(0, 0);

  const triangles = statGeo.attributes.position.count / 3 + polGeo.attributes.position.count / 3
    + bulbGeo.attributes.position.count / 3 + haloGeo.attributes.position.count / 3 + 4 * (balloonGeo.attributes.position.count / 3);

  return {
    group,
    pick,
    get atlas() { return { canvas, texture: tex, size }; },
    layout,
    paintSlot,
    setTitle,
    flush,
    slotAt,
    update,
    drawCalls: 5,
    triangles: Math.round(triangles),
    get canPartial() { return canPartial; },
    // the polaroid's centre in world space (the viewer's "fly from the wall" start, tests)
    slotWorld(i, out = new THREE.Vector3()) {
      const f = slotFrame(i);
      return out.set(f.x, B.cy + f.y, B.d / 2).applyMatrix4(wallMatrix);
    },
    dispose() {
      for (const o of own) o.dispose();
      own.length = 0;
      if (scratchTex) scratchTex.dispose();
      balloons.dispose();
      if (group.parent) group.parent.remove(group);
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (scratch) {
        scratch.width = 0;
        scratch.height = 0;
      }
    },
  };
}
