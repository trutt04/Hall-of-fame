// The regime: the commissioner as Supreme Leader, all over town. A monument on the plaza, an
// official portrait on the League Office, a mandatory portrait on a post at every home, banners
// down the Boulevard, posters, a bust in every neighborhood, loudspeakers, and a sign at his house.
//
// Everything is driven by model.regime. When that is null nothing of this exists.
// The whole feature is TWO draw calls: one merged vertex-coloured mesh for everything solid
// (statue, busts, poles, frames) and one textured mesh on a single atlas for everything flat
// (portraits, banners, posters, plaques, the residence sign).
//
//   const regime = createRegime(world)
//   regime.apply(model)        rebuilds when the regime text or anybody's address changes
//   regime.update(dt, t)       loudspeaker announcements, night glow
//   regime.place               { x, z, facing } in front of the monument, or null
//   regime.spots               where everything stands (for the map and for tests), or null
//
// 'use' events: { kind: 'monument' }, { kind: 'portrait', official: true }, { kind: 'portrait', teamId },
//               { kind: 'bust', zone }, { kind: 'residence' }
import * as THREE from '../../lib/three.module.min.js';
import * as ART from '../art/index.js';
import { PATHS, REGIME } from '../config.js';
import { makeCanvas, wrap, FONT_BODY, FONT_DISPLAY } from './signs.js';
import { boardTexture } from './boards.js';

const { Geo, merge, flatMat } = ART;
const TAU = Math.PI * 2;
const TAG = 'regime';

const RED = 0xc4122e;
const RED_DK = 0x8f0d22;
const GOLD = 0xf5c542;
const GOLD_LO = 0xd49a25;
const IRON = 0x2b2e38;
const POLE = 0x4a4e5a;
const CSS_GOLD = '#f5c542';
const CSS_CREAM = '#ffe58a';

// ---- the atlas ---------------------------------------------------------------------------------
const AT = 1024;
const CELL = {
  portrait: [0, 0, 384, 384],
  plaque: [392, 0, 384, 64],
  bust: [392, 72, 192, 76],
  sign: [392, 156, 448, 130],
  banner: (i) => [(i % 8) * 128, 384, 128, 384],
  poster: (i) => [(i % 4) * 256, 768, 256, 256],
};

// The single-file preview inlines the artwork as data URIs; everywhere else the path is used.
function assetUrl(path) {
  const pv = typeof window !== 'undefined' ? window.__LW_PREVIEW : null;
  return (pv && pv.assets && pv.assets[path]) || path;
}
function loadImage(path, done) {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => done(img.naturalWidth > 0 ? img : null);
    img.onerror = () => done(null);
    img.src = assetUrl(path);
  } catch (err) {
    done(null);
  }
}

// Biggest type that fits the box, wrapped on words and centred.
function textBlock(g, text, cx, top, maxW, maxH, o = {}) {
  const family = o.family || FONT_DISPLAY;
  const weight = o.weight || '400';
  const str = String(text == null ? '' : text);
  const min = o.min || 12;
  for (let size = o.size || 28; size >= min; size--) {
    g.font = `${weight} ${size}px ${family}`;
    const lines = wrap(g, str, maxW, o.lines || 6);
    const lh = size * (o.lh || 1.14);
    let wide = 0;
    for (const l of lines) wide = Math.max(wide, g.measureText(l).width);
    if ((wide <= maxW && lines.length * lh <= maxH) || size === min) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let y = top + (maxH - lines.length * lh) / 2 + lh / 2;
      for (const l of lines) {
        g.fillText(l, cx, y, maxW);
        y += lh;
      }
      return;
    }
  }
}

// Stand-in when the artwork is missing: a gold head and shoulders, shades on.
function silhouette(g, x, y, w, h) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#b3122b');
  grad.addColorStop(1, '#6f0a1a');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = CSS_GOLD;
  g.beginPath();
  g.ellipse(x + w / 2, y + h * 1.04, w * 0.43, h * 0.37, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.ellipse(x + w / 2, y + h * 0.42, w * 0.19, h * 0.23, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#6f0a1a';
  g.fillRect(x + w * 0.33, y + h * 0.36, w * 0.34, h * 0.075);
  g.restore();
}

function drawAtlas(cv, R, art) {
  const g = cv.getContext('2d');
  g.fillStyle = '#8f0d22';
  g.fillRect(0, 0, AT, AT);
  const slogans = (R.slogans && R.slogans.length ? R.slogans : [R.title || '']).map((s) => String(s || '').toUpperCase());
  const slogan = (i) => slogans[((i % slogans.length) + slogans.length) % slogans.length];

  // the official portrait
  {
    const [x, y, w, h] = CELL.portrait;
    if (art.portrait) g.drawImage(art.portrait, x, y, w, h);
    else silhouette(g, x, y, w, h);
    const v = g.createRadialGradient(x + w / 2, y + h * 0.45, w * 0.3, x + w / 2, y + h / 2, w * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(20,6,2,0.42)');
    g.fillStyle = v;
    g.fillRect(x, y, w, h);
  }
  // engraved gold: the monument plaque and the plate on every bust
  const plate = (cell, text, size, lines) => {
    const [x, y, w, h] = cell;
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#ffe58a');
    grad.addColorStop(0.5, '#f5c542');
    grad.addColorStop(1, '#c98f1f');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(90,54,8,0.7)';
    g.lineWidth = 2;
    g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    g.fillStyle = '#4a2c06';
    textBlock(g, String(text || '').toUpperCase(), x + w / 2, y + 7, w - 22, h - 14, { size, min: 10, lines });
  };
  plate(CELL.plaque, (R.monument && R.monument.plaque) || R.title, 30, 1);
  plate(CELL.bust, R.title, 26, 2);
  // the sign at his gate: first sentence big, the rest small
  {
    const [x, y, w, h] = CELL.sign;
    g.fillStyle = '#7d0b1d';
    g.fillRect(x, y, w, h);
    g.strokeStyle = CSS_GOLD;
    g.lineWidth = 5;
    g.strokeRect(x + 5, y + 5, w - 10, h - 10);
    const text = String(R.residence || 'Official Residence');
    const m = text.match(/^(.*?)[.!?]\s+(.+)$/);
    const head = (m ? m[1] : text).toUpperCase();
    g.fillStyle = CSS_CREAM;
    textBlock(g, head, x + w / 2, y + 12, w - 36, m ? 56 : h - 24, { size: 40, min: 14, lines: m ? 1 : 2 });
    if (m) {
      g.fillStyle = '#f3e3c2';
      textBlock(g, m[2], x + w / 2, y + 68, w - 36, 48, { size: 25, min: 12, lines: 2, family: FONT_BODY, weight: '700' });
    }
  }
  // banners: poster art in a gold ring on red, one slogan each
  for (let i = 0; i < 8; i++) {
    const [x, y, w, h] = CELL.banner(i);
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#cf1531');
    grad.addColorStop(1, '#9a0d22');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.fillStyle = CSS_GOLD;
    g.fillRect(x, y, w, 8);
    g.fillRect(x, y + 13, w, 3);
    g.fillRect(x, y + h - 8, w, 8);
    g.fillRect(x, y + h - 16, w, 3);
    const cx = x + w / 2;
    const cy = y + 86;
    const r = 48;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r - 2, 0, TAU);
    g.clip();
    if (art.poster) g.drawImage(art.poster, cx - r, cy - r, r * 2, r * 2);
    else silhouette(g, cx - r, cy - r, r * 2, r * 2);
    g.restore();
    g.strokeStyle = CSS_GOLD;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.stroke();
    g.fillStyle = CSS_CREAM;
    textBlock(g, slogan(i + 1), cx, y + 148, w - 14, h - 148 - 26, { size: 30, min: 13, lines: 6 });
  }
  // posters: the art, full bleed, with the slogan on a band
  for (let i = 0; i < 4; i++) {
    const [x, y, w, h] = CELL.poster(i);
    if (art.poster) g.drawImage(art.poster, x, y, w, h);
    else silhouette(g, x, y, w, h);
    g.fillStyle = 'rgba(112,8,24,0.94)';
    g.fillRect(x, y + h - 70, w, 70);
    g.fillStyle = CSS_GOLD;
    g.fillRect(x, y + h - 73, w, 3);
    g.fillStyle = CSS_CREAM;
    textBlock(g, slogan(i * 2), x + w / 2, y + h - 66, w - 24, 58, { size: 30, min: 13, lines: 2 });
    g.strokeStyle = CSS_GOLD;
    g.lineWidth = 6;
    g.strokeRect(x + 3, y + 3, w - 6, h - 6);
  }
}

// ---- small geometry helpers --------------------------------------------------------------------
// A local frame on the ground: +Z is where it faces, like three.js rotation.y.
function frameAt(x, y, z, facing) {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x, y, z, facing, p: (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c] };
}

export function createRegime(w) {
  const { scene, terrain, layout, colliders, interact, store, hud, audio, sky, player, rig } = w;
  const group = new THREE.Group();
  group.name = 'regime';
  scene.add(group);

  const art = { portrait: null, poster: null };
  const canvas = makeCanvas(AT, AT);
  let built = null; // { own: [], ids: [], tex, mat, R, speakers: [], spots }
  let sig = '';
  let lastNight = -1;

  const redraw = () => {
    if (!built) return;
    drawAtlas(canvas, built.R, art);
    built.tex.needsUpdate = true;
  };
  loadImage(PATHS.leaderPortrait, (img) => { art.portrait = img; redraw(); });
  loadImage(PATHS.leaderPoster, (img) => { art.poster = img; redraw(); });

  const use = (payload) => () => store.emit('use', payload);
  const groundY = (x, z) => terrain.heightAt(x, z);

  // ---- keep clear of the trees and of whatever already stands there ---------------------------
  const scatter = terrain.scatterPoints || [];
  function crowded(x, z, r) {
    for (const p of scatter) {
      const lim = r + (p.kind === 'tree' ? 2.3 : 0.9);
      if (Math.abs(p.x - x) < lim && Math.abs(p.z - z) < lim) return true;
    }
    return false;
  }
  function settle(x, z, dx, dz, r = 0.8, solid = true) {
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
      const px = x + dx * k * 1.7;
      const pz = z + dz * k * 1.7;
      if (!crowded(px, pz, r) && !(solid && colliders.hits(px, pz, r * 0.6))) return [px, pz];
    }
    return [x, z];
  }
  function roadAt(s) {
    const R = layout.road;
    const S = layout.roadS;
    let i = 0;
    while (i < R.length - 2 && S[i + 1] < s) i++;
    const span = S[i + 1] - S[i] || 1;
    const k = Math.min(1, Math.max(0, (s - S[i]) / span));
    let tx = R[i + 1][0] - R[i][0];
    let tz = R[i + 1][1] - R[i][1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    return { x: R[i][0] + (R[i + 1][0] - R[i][0]) * k, z: R[i][1] + (R[i + 1][1] - R[i][1]) * k, tx, tz };
  }

  function clear() {
    if (!built) return;
    for (const id of built.ids) interact.unregister(id);
    colliders.removeGroup(TAG);
    for (const child of group.children.slice()) group.remove(child);
    for (const d of built.own) d.dispose();
    built = null;
    lastNight = -1;
  }

  function build(model, R) {
    const own = [];
    const ids = [];
    const S = new Geo();
    const baked = [];
    const A = { pos: [], uv: [] };
    const spots = { monument: null, portrait: null, banners: [], posters: [], busts: {}, speakers: [], doors: {}, residence: null };
    let POST = {}; // where the mandatory portrait stands at each kind of home

    // ---- flat things on the atlas ----
    const quad = (a, b, c, d, cell) => {
      A.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      const i = 1.5;
      const u0 = (cell[0] + i) / AT;
      const u1 = (cell[0] + cell[2] - i) / AT;
      const v0 = 1 - (cell[1] + cell[3] - i) / AT;
      const v1 = 1 - (cell[1] + i) / AT;
      A.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };
    // a panel facing local +Z; `back` adds a readable reverse side that far behind it
    const panel = (F, cx, cy, lz, pw, ph, cell, back) => {
      const x0 = cx - pw / 2;
      const x1 = cx + pw / 2;
      const y0 = cy - ph / 2;
      const y1 = cy + ph / 2;
      quad(F.p(x0, y0, lz), F.p(x1, y0, lz), F.p(x1, y1, lz), F.p(x0, y1, lz), cell);
      if (back) quad(F.p(x1, y0, lz - back), F.p(x0, y0, lz - back), F.p(x0, y1, lz - back), F.p(x1, y1, lz - back), cell);
    };
    const inFrame = (F, fn) => {
      S.at(F.x, F.y, F.z, F.facing);
      fn();
      S.restore();
    };

    // ---- art props, baked into the one solid mesh ----
    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    function bake(prop, x, y, z, ry, rx = 0, rz = 0) {
      euler.set(rx, ry, rz, 'YXZ');
      quat.setFromEuler(euler);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quat, one);
      prop.group.updateMatrixWorld(true);
      prop.group.traverse((c) => {
        const at = c.isMesh && c.geometry ? c.geometry.attributes : null;
        if (!at || !at.position || !at.color || at.color.itemSize !== 3) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', at.position.clone());
        geo.setAttribute('color', at.color.clone());
        geo.applyMatrix4(mat4.multiplyMatrices(m, c.matrixWorld));
        baked.push(geo);
      });
      if (prop.dispose) prop.dispose();
      return (v) => v.clone().applyMatrix4(m);
    }
    const artProp = (name, opts) => (typeof ART[name] === 'function' ? ART[name](opts) : null);

    // ---- taps ----
    const pickGeo = new THREE.BoxGeometry(1, 1, 1);
    const pickMat = new THREE.MeshBasicMaterial();
    own.push(pickGeo, pickMat);
    const pickBox = (F, cx, cy, cz, bw, bh, bd) => {
      const m = new THREE.Mesh(pickGeo, pickMat);
      const p = F.p(cx, cy, cz);
      m.position.set(p[0], p[1], p[2]);
      m.rotation.y = F.facing;
      m.scale.set(bw, bh, bd);
      m.visible = false; // never drawn, only there for taps
      group.add(m);
      return m;
    };
    const register = (def) => {
      ids.push(def.id);
      interact.register(def);
    };
    const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

    // a tall banner on a pole: the arm points along local +X, the cloth reads from both sides
    const bannerPole = (x, z, facing, cell, o = {}) => {
      const H = o.height || 6.7;
      const bw = o.width || 1.4;
      const bh = bw * 3;
      const F = frameAt(x, groundY(x, z), z, facing);
      const top = H - 0.3;
      inFrame(F, () => {
        S.cyl(0, -0.9, 0, H > 5 ? 0.075 : 0.05, H + 0.9, POLE, { seg: 5 });
        S.sphere(0, H + 0.1, 0, H > 5 ? 0.15 : 0.1, GOLD, { seg: 5, rings: 3 });
        S.box(bw / 2 + 0.08, top, 0, bw + 0.2, 0.06, 0.06, GOLD_LO, { bottom: true });
        S.box(bw / 2 + 0.08, top - bh - 0.06, 0, bw + 0.1, 0.05, 0.05, GOLD_LO, { bottom: true });
      });
      panel(F, bw / 2 + 0.12, top - bh / 2, 0.012, bw, bh, CELL.banner(cell), 0.024);
      colliders.addCircle(x, z, 0.2, TAG);
      return F;
    };

    // ============================================================ 1. the monument
    {
      const k = 0.9;
      const M = { x: 17.5, z: 5.5 };
      const plaza = layout.stations.plaza;
      const facing = Math.atan2(plaza.x - M.x, plaza.z - M.z);
      const F = frameAt(M.x, groundY(M.x, M.z) + 0.04, M.z, facing);
      const statue = artProp('createLeaderStatue', { scale: k });
      let plaqueAt = [0, 0.47 * k, 2.47 * k];
      let plaqueSize = { w: 1.9 * k, h: 0.32 * k };
      let blocks = [{ x: -1.6 * k, z: 0, r: 2.6 * k }, { x: 1.6 * k, z: 0, r: 2.6 * k }];
      let tall = 8.8 * k;
      if (statue) {
        if (statue.anchors && statue.anchors.plaque) plaqueAt = statue.anchors.plaque.toArray();
        if (statue.plaqueSize) plaqueSize = statue.plaqueSize;
        if (statue.colliders) blocks = statue.colliders;
        if (statue.height) tall = statue.height;
        bake(statue, F.x, F.y, F.z, facing);
      } else {
        inFrame(F, () => {
          S.box(0, 0, 0, 7.2 * k, 0.9 * k, 4.8 * k, RED, { top: RED_DK });
          S.box(0, 0.9 * k, 0, 2.6 * k, 6.6 * k, 1.8 * k, 0x9c8a48);
        });
      }
      panel(F, plaqueAt[0], plaqueAt[1], plaqueAt[2] + 0.012, plaqueSize.w, plaqueSize.h, CELL.plaque);
      for (const c of blocks) {
        const p = F.p(c.x, 0, c.z);
        colliders.addCircle(p[0], p[2], c.r, TAG);
      }
      // the two round blocks leave a dent in the middle of the plinth's long faces: fill it
      for (const cz of [0.6 * k, -0.6 * k]) {
        const p = F.p(0, 0, cz);
        colliders.addCircle(p[0], p[2], 1.95 * k, TAG);
      }
      // wreaths against the plinth and flowers at its corners
      inFrame(F, () => {
        for (const sx of [-1, 1]) {
          S.at(sx * 1.85 * k, 0.62, 2.55 * k + 0.32, 0, -0.3);
          const ring = [];
          for (let i = 0; i <= 8; i++) ring.push([Math.cos((i / 8) * TAU) * 0.42, Math.sin((i / 8) * TAU) * 0.42, 0]);
          S.tube(ring, 0.11, 0x35733c, { seg: 4 });
          S.box(0, -0.56, 0.1, 0.26, 0.3, 0.05, RED, { bottom: true });
          for (let i = 0; i < 4; i++) S.sphere(Math.cos(i * 1.57 + 0.8) * 0.42, Math.sin(i * 1.57 + 0.8) * 0.42, 0.1, 0.07, i % 2 ? GOLD : RED, { seg: 4, rings: 2 });
          S.restore();
          S.box(sx * 3.05 * k, 0, 2.55 * k + 0.35, 1.0, 0.3, 0.42, IRON);
          for (let i = 0; i < 5; i++) S.sphere(sx * 3.05 * k - 0.36 + i * 0.18, 0.38 + (i % 2) * 0.06, 2.55 * k + 0.35 + ((i * 7) % 3 - 1) * 0.07, 0.13, i % 2 ? GOLD : RED, { seg: 5, rings: 3 });
        }
      });
      // two banner poles flanking it
      for (const sx of [-1, 1]) {
        const p = F.p(sx * (3.75 * k + 1.5), 0, 0.7);
        bannerPole(p[0], p[2], facing + (sx < 0 ? Math.PI : 0), sx < 0 ? 0 : 4, { height: 7.4, width: 1.3 });
      }
      const stand = F.p(0, 0, plaqueAt[2] + 1.5);
      register({
        id: 'monument', position: v3(stand), radius: 3.4, label: 'Pay your respects', priority: 2,
        object3D: pickBox(F, 0, tall / 2, 0, 6.0 * k, tall, 3.6 * k), onUse: use({ kind: 'monument' }),
      });
      // The map lands the visitor off to one side. Straight in front would put the camera, which
      // trails behind them, inside the champion's statue in the middle of the plaza.
      const dl = Math.hypot(plaza.x - M.x, plaza.z - M.z) || 1;
      const dx = (plaza.x - M.x) / dl;
      const dz = (plaza.z - M.z) / dl;
      const sx = M.x + dx * 4.0 - dz * 2.8;
      const sz = M.z + dz * 4.0 + dx * 2.8;
      spots.monument = { x: M.x, z: M.z, facing, stand: { x: sx, z: sz, facing: Math.atan2(M.x - sx, M.z - sz) } };
    }

    // ============================================================ 2. the official portrait
    {
      const O = layout.places.leagueOffice;
      const F = frameAt(O.x, groundY(O.x, O.z) + 0.12, O.z, O.facing);
      const cx = -4.1;
      const cy = 3.45;
      const size = 3.0;
      const zf = 3.84;
      inFrame(F, () => {
        // stays for the part that stands above the roof
        for (const sx of [-1, 1]) S.box(cx + sx * 1.15, 3.6, zf - 0.2, 0.12, 1.75, 0.12, IRON);
        S.box(cx, cy - size / 2, zf - 0.06, size + 0.1, size, 0.04, IRON, { bottom: true });
        S.box(cx, cy + size / 2, zf, size + 0.4, 0.2, 0.14, GOLD, { bottom: true });
        S.box(cx, cy - size / 2 - 0.2, zf, size + 0.4, 0.2, 0.14, GOLD, { bottom: true });
        for (const sx of [-1, 1]) S.box(cx + sx * (size / 2 + 0.1), cy - size / 2, zf, 0.2, size, 0.14, GOLD_LO);
        // red drapes and a valance
        for (const sx of [-1, 1]) {
          const dx = cx + sx * (size / 2 + 0.39);
          S.box(dx, 3.0, zf + 0.03, 0.38, 2.5, 0.12, RED, { side: RED_DK, tx: 1.15, bottom: true });
          S.box(dx, 1.45, zf + 0.03, 0.44, 1.5, 0.12, RED, { side: RED_DK, tx: 0.8, bottom: true });
          S.box(dx, 2.92, zf + 0.04, 0.46, 0.12, 0.15, GOLD, { bottom: true });
        }
        S.box(cx, cy + size / 2 + 0.2, zf + 0.03, size + 1.2, 0.4, 0.16, RED, { side: RED_DK, bottom: RED_DK });
        S.box(cx, cy + size / 2 + 0.14, zf + 0.04, size + 1.24, 0.07, 0.18, GOLD, { bottom: true });
      });
      panel(F, cx, cy, zf - 0.035, size, size, CELL.portrait);
      const stand = F.p(cx, -0.12, zf + 2.4);
      register({
        id: 'portrait:official', position: v3(stand), radius: 2.6, label: 'The official portrait', priority: 1,
        object3D: pickBox(F, cx, cy, zf, size + 0.6, size + 0.6, 0.5), onUse: use({ kind: 'portrait', official: true }),
      });
      const wall = F.p(cx, cy, zf);
      spots.portrait = { x: wall[0], y: wall[1], z: wall[2], facing: O.facing, stand: { x: stand[0], z: stand[2] } };
    }

    // ============================================================ 3. a mandatory portrait at every home
    // On a short post by the front path, facing the street: plain to see from the road, and far
    // enough from the door, the plaque and the mailbox that each of those keeps its own button.
    {
      // where the post stands, measured from the door: across, toward the street; turn = extra yaw
      POST = {
        hill: { x: -4.0, z: 4.9, size: 0.8, up: 1.6, turn: 0.6, reach: 1.95 }, // on the terrace by the steps, turned to the gates
        heights: { x: -1.7, z: 2.4 },
        bubble: { x: 7.1, z: 2.95 }, // past the drive: the resident paces the walk, the lawn is for flamingos, vans park out front
        park: { x: 0.6, z: 2.1, wood: true },
        dump: { x: -1.8, z: 2.2, wood: true },
      };
      for (const id of model.order || []) {
        const e = w.town.entry(id);
        if (!e || !e.home || !e.home.anchors || !e.home.anchors.door) continue;
        const { lot, team } = e;
        const door = e.home.anchors.door;
        const o = POST[team.tier] || POST.bubble;
        const size = o.size || 0.56;
        const up = o.up || 1.45;
        const at = frameAt(lot.x, lot.y, lot.z, lot.facing).p(door.x + o.x, 0, door.z + o.z);
        const F = frameAt(at[0], groundY(at[0], at[2]), at[2], lot.facing + (o.turn || 0));
        inFrame(F, () => {
          S.cyl(0, -0.5, -0.06, 0.045, up + size / 2 + 0.56, o.wood ? 0x8a5a36 : IRON, { seg: 5 });
          S.box(0, up - size / 2 - 0.06, 0.035, size + 0.12, size + 0.12, 0.07, GOLD, { side: GOLD_LO, bottom: GOLD_LO, back: GOLD_LO });
        });
        panel(F, 0, up, 0.082, size, size, CELL.portrait);
        colliders.addCircle(at[0], at[2], 0.14, TAG);
        const stand = F.p(0, 0, o.reach || 1.0);
        register({
          // below doors, plaques and mailboxes on purpose: it only offers itself where none of them reach
          id: 'portrait:' + id, position: new THREE.Vector3(stand[0], groundY(stand[0], stand[2]), stand[2]), radius: 1.0, label: 'The portrait', priority: -1,
          object3D: pickBox(F, 0, up, 0.03, size + 0.34, size + 0.34, 0.3), onUse: use({ kind: 'portrait', teamId: id }),
        });
        const pic = F.p(0, up, 0.08);
        spots.doors[id] = { x: pic[0], y: pic[1], z: pic[2], facing: F.facing, tier: team.tier, stand: { x: stand[0], z: stand[2] } };
      }
    }

    // ============================================================ 4. banners down the Boulevard
    {
      // [distance down the road, side, how far off the centre line]: the arrival ride looks ahead
      // and glances at the homes, and the truck's camera trails a few metres east of the road, so
      // each banner stands where neither of them is looking, or well clear of them
      const total = layout.roadLength;
      const along = [[5, 1], [38, -1], [74, -1], [99, -1], [126, 1, 10], [163, 1], [192, 1]];
      along.forEach(([at, side, off = 5.3], i) => {
        const r = roadAt((at / 236.8) * total);
        const nx = -r.tz * side;
        const nz = r.tx * side;
        const [x, z] = settle(r.x + nx * off, r.z + nz * off, r.tx, r.tz, 0.9);
        bannerPole(x, z, Math.atan2(-nz, nx), i);
        spots.banners.push({ x, z, zone: terrain.dominantZone ? terrain.dominantZone(x, z) : '' });
      });
      // The trailer park's stretch of the Boulevard is where every ride turns and looks around,
      // so its banner stands at the far end of the park's own lane instead, facing down it.
      const lane = layout.places.parkLane;
      const end = lane[0][0] < lane[lane.length - 1][0] ? lane[0] : lane[lane.length - 1];
      const [x, z] = settle(end[0] - 2.5, end[1] + 2.0, 0, 1, 0.9);
      bannerPole(x, z, Math.PI / 2, along.length);
      spots.banners.push({ x, z, zone: terrain.dominantZone ? terrain.dominantZone(x, z) : '' });
    }

    // ============================================================ 5. posters
    {
      // a square poster on two posts, readable from both sides
      const board = (x, z, facing, size, bottom, cell, where) => {
        const F = frameAt(x, groundY(x, z), z, facing);
        const half = size / 2 - 0.3;
        const top = bottom + size;
        inFrame(F, () => {
          for (const sx of [-1, 1]) {
            const wp = F.p(sx * half, 0, 0);
            const dy = Math.min(0, groundY(wp[0], wp[2]) - F.y);
            S.box(sx * half, dy - 1.2, 0.05, 0.2, bottom - dy + 1.2, 0.2, IRON);
          }
          S.box(0, bottom - 0.14, 0.05, size + 0.28, size + 0.28, 0.12, GOLD_LO, { bottom: GOLD_LO });
        });
        panel(F, 0, bottom + size / 2, 0.122, size, size, CELL.poster(cell), 0.144);
        for (const sx of [-1, 1]) {
          const wp = F.p(sx * half, 0, 0);
          colliders.addCircle(wp[0], wp[2], 0.3, TAG);
        }
        spots.posters.push({ x, z, facing, y: F.y + bottom + size / 2, size, where });
      };
      // the big one, where the Boulevard leaves the plaza: beside the road, never over it, set back
      // far enough that the rides see it off to one side, and it reads from the plaza as well
      {
        const st = layout.stations.plaza;
        const r = roadAt(layout.roadLength * (146 / 236.8));
        const [x, z] = settle(r.x - r.tz * 9.4, r.z + r.tx * 9.4, r.tx, r.tz, 1.6);
        board(x, z, Math.atan2(st.x - x, st.z - z), 4.4, Math.max(2.6, st.y + 0.4 - groundY(x, z)), 0, 'plaza');
      }
      // on the trailer park fence, in the gap between the two trailers nearest the gate: west of
      // the gate, because the truck ride ends looking east along the fence
      {
        const gate = layout.places.landfillGate;
        const lots = (layout.lots.park || []).slice().sort((a, b) => b.x - a.x);
        const gx = lots.length > 1 ? (lots[0].x + lots[1].x) / 2 : gate.x - gate.width / 2 - 12;
        const [x, z] = settle(gx, gate.z - 0.45, 1, 0, 1.2, false); // the fence itself is solid: only dodge the trees
        board(x, z, Math.PI, 3.4, 1.3, 1, 'fence');
      }
      // across the Boulevard from the mouth of the cul-de-sac: the first thing the Bubble sees on
      // its way out, and on the side the rides do not look at when they turn in
      {
        const j = layout.places.culdesac.junction;
        const r = roadAt(layout.roadLength * (171 / 236.8));
        const [x, z] = settle(j[0] - r.tz * 9.5, j[1] + r.tx * 9.5, r.tx, r.tz, 1.6);
        board(x, z, Math.atan2(layout.places.culdesac.x - x, layout.places.culdesac.z - z), 3.2, 1.7, 2, 'culdesac');
      }
      // behind the uprights, off to one side
      {
        const kf = layout.places.kickField;
        const px = kf.x - kf.w / 2 + 0.3;
        const pz = kf.z - kf.d / 2 - 3.5;
        const facing = Math.atan2(kf.x - px, kf.z - 5 - pz);
        const [x, z] = settle(px, pz, -1, 0, 1.8);
        board(x, z, facing, 4.0, 2.4, 3, 'kick');
      }
    }

    // ============================================================ 6. a bust in every neighborhood
    {
      const P = layout.places;
      const st = layout.stations;
      const hillLot = P.hillGate;
      const lane = P.parkLane;
      const laneMid = lane[Math.floor(lane.length * 0.28)] || [-34, st.laneZ];
      const spur = P.culdesac.spur;
      const spurMid = spur[Math.floor(spur.length * 0.72)] || [13, P.culdesac.z];
      const where = {
        hill: { x: hillLot.x - 14.5, z: hillLot.z + 2.4, look: [hillLot.x - 4, hillLot.z + 9] }, // the far side of the gates from the truck stop
        heights: { x: st.fountain.x - st.fountain.r - 1.4, z: st.fountain.z, look: [st.fountain.x, st.fountain.z] },
        plaza: { x: st.plaza.x - st.plaza.r + 1.7, z: st.plaza.z + 6.4, look: [st.plaza.x, st.plaza.z] },
        bubble: { x: spurMid[0], z: spurMid[1] - 5.2, look: [spurMid[0], spurMid[1]] },
        park: { x: laneMid[0], z: laneMid[1] - 4.5, look: [laneMid[0], laneMid[1]] },
        dump: { x: st.dump.x - 10.5, z: st.dump.z - 4.5, look: [P.landfillGate.x, P.landfillGate.z] },
      };
      for (const zone of Object.keys(where)) {
        if (!R.busts || !R.busts[zone]) continue;
        const b = where[zone];
        const facing = Math.atan2(b.look[0] - b.x, b.look[1] - b.z);
        const fx = Math.cos(facing);
        const fz = -Math.sin(facing);
        const [x, z] = zone === 'dump' ? [b.x, b.z] : settle(b.x, b.z, fx, fz, 0.8);
        const weathered = zone === 'dump';
        const k = 1.1;
        const y = groundY(x, z) - (weathered ? 0.62 : 0.06);
        const F = frameAt(x, y, z, facing);
        const prop = artProp('createLeaderBust', { weathered, scale: k });
        let topAt = null;
        if (prop) {
          const anchors = prop.anchors || {};
          const size = prop.plaqueSize || { w: 0.4 * k, h: 0.16 * k };
          const toWorld = bake(prop, x, y, z, facing, weathered ? -0.07 : 0, weathered ? 0.13 : 0);
          if (anchors.top) topAt = toWorld(anchors.top);
          if (!weathered && anchors.plaque) panel(F, anchors.plaque.x, anchors.plaque.y, anchors.plaque.z + 0.012, size.w, size.h, CELL.bust);
        } else {
          inFrame(F, () => {
            S.box(0, 0, 0, 0.9 * k, 1.2 * k, 0.9 * k, 0xb9b3a2);
            S.sphere(0, 1.7 * k, 0, 0.42 * k, 0x9c8a48, { seg: 6, rings: 4 });
          });
        }
        if (weathered) {
          // half sunk in rubbish, and a gull has moved in
          inFrame(F, () => {
            S.sphere(0.75, 0.7, 0.35, 0.5, 0x23262b, { seg: 5, rings: 3, sy: 0.7 });
            S.sphere(-0.8, 0.66, 0.2, 0.42, 0x3a4a3a, { seg: 5, rings: 3, sy: 0.7 });
            S.sphere(0.1, 0.62, 0.85, 0.4, 0xd8d8d2, { seg: 5, rings: 3, sy: 0.6 });
            S.box(-0.55, 0.55, -0.6, 0.7, 0.4, 0.5, 0xbf9460, { ry: 0.5, rz: 0.2 });
          });
          if (topAt) {
            S.at(topAt.x, topAt.y - 0.02, topAt.z, facing + 0.6);
            S.scale(1.5);
            S.sphere(0, 0.15, 0, 0.13, 0xf3f1ea, { seg: 5, rings: 3, sz: 1.7, sy: 0.85 });
            S.sphere(0, 0.29, 0.17, 0.075, 0xf3f1ea, { seg: 5, rings: 3 });
            S.box(0, 0.265, 0.27, 0.03, 0.03, 0.09, 0xf2a020, { bottom: true });
            for (const sx of [-1, 1]) S.box(sx * 0.105, 0.11, -0.04, 0.035, 0.1, 0.3, 0x9aa3ad, { bottom: true });
            S.box(0, 0.13, -0.27, 0.1, 0.03, 0.12, 0x555b66, { bottom: true });
            for (const sx of [-1, 1]) S.box(sx * 0.04, 0, 0.02, 0.012, 0.06, 0.012, 0xf2a020);
            S.restore();
          }
        }
        colliders.addCircle(x, z, 0.66 * k, TAG);
        const stand = F.p(0, 0, 1.25);
        register({
          id: 'bust:' + zone, position: new THREE.Vector3(stand[0], groundY(stand[0], stand[2]), stand[2]), radius: 1.7, label: 'Read the plaque', priority: 1,
          object3D: pickBox(F, 0, 1.25 * k, 0, 1.25 * k, 2.5 * k, 1.25 * k), onUse: use({ kind: 'bust', zone }),
        });
        spots.busts[zone] = { x, z, facing };
      }
    }

    // ============================================================ 7. loudspeakers
    const speakers = [];
    {
      const P = layout.places;
      const st = layout.stations;
      const cross = roadAt(layout.roadLength * (213 / 236.8));
      const list = [
        { id: 'plaza', x: st.plaza.x + 12.5, z: st.plaza.z + 17, look: [st.plaza.x, st.plaza.z] },
        // across the Boulevard from the cul-de-sac, beside the poster: the rides all look east here
        { id: 'bubble', x: P.culdesac.junction[0] - 7.8, z: P.culdesac.junction[1] + 6.8, look: [P.culdesac.junction[0], P.culdesac.junction[1]] },
        // behind Outhouse Row: the rides swing west here, and the truck's camera runs just east of the road
        { id: 'park', x: P.outhouseRow.x + 3.2, z: st.laneZ + 3.8, look: [cross.x, st.laneZ] },
        { id: 'hill', x: P.hillGate.x - 6, z: P.hillGate.z + 1.6, look: [P.hillGate.x, P.hillGate.z + 10] },
      ];
      for (const sp of list) {
        const facing = Math.atan2(sp.look[0] - sp.x, sp.look[1] - sp.z);
        const [x, z] = settle(sp.x, sp.z, Math.cos(facing), -Math.sin(facing), 0.7);
        const y = groundY(x, z) - 0.05;
        const prop = artProp('createLoudspeaker', { scale: 1 });
        if (prop) bake(prop, x, y, z, facing);
        else {
          S.cyl(x, y, z, 0.09, 5.8, 0x8d949b, { seg: 5 });
          S.box(x, y + 5.4, z, 1.5, 0.5, 0.5, 0xb6bdc3, { bottom: true });
        }
        colliders.addCircle(x, z, 0.25, TAG);
        speakers.push({ id: sp.id, x, z });
        spots.speakers.push({ id: sp.id, x, z });
      }
    }

    // ============================================================ 8. his own house
    // One pole at a front corner of the lot: a small banner on top, the sign at eye level.
    {
      const e = w.town.entry(R.teamId);
      if (e && e.home && e.home.anchors) {
        const { lot, team } = e;
        const An = e.home.anchors;
        const curb = An.curb || An.door;
        const F0 = frameAt(lot.x, lot.y, lot.z, lot.facing);
        // the corner with the least going on (mailbox, yard sign, his own mandatory portrait)
        const off = Math.min((lot.w || 24) / 2 - 1.4, 7.6);
        const busy = [An.mailbox, An.sign].filter(Boolean).map((v) => v.x);
        if (POST[team.tier] && An.door) busy.push(An.door.x + POST[team.tier].x);
        const room = (x) => busy.reduce((m, bx) => Math.min(m, Math.abs(bx - x)), 99);
        let lx = room(off) >= room(-off) ? off : -off;
        // on the Hill it stands outside the railings, in the Heights outside the hedge
        const lz = team.tier === 'hill' ? curb.z + 0.9 : team.tier === 'heights' ? curb.z + 0.6 : curb.z - 0.7;
        let facing = lot.facing;
        let p = F0.p(lx, 0, lz);
        if (team.tier === 'dump') {
          // out of the gateway, and turned to the people coming through it
          const gate = layout.places.landfillGate;
          const q = F0.p(-lx, 0, lz);
          if (Math.abs(q[0] - gate.x) > Math.abs(p[0] - gate.x)) {
            p = q;
            lx = -lx;
          }
          facing = Math.atan2(gate.x - p[0], gate.z - 4 - p[2]);
        }
        const F = bannerPole(p[0], p[2], facing + (lx < 0 ? Math.PI : 0), 2, { height: 3.7, width: 0.5 });
        const bw = 2.3;
        const bh = bw * (CELL.sign[3] / CELL.sign[2]);
        const B = frameAt(p[0], F.y, p[2], facing);
        inFrame(B, () => S.box(0, 0.92, 0.09, bw + 0.1, bh + 0.1, 0.06, GOLD_LO, { back: RED_DK, bottom: GOLD_LO }));
        panel(B, 0, 0.97 + bh / 2, 0.126, bw, bh, CELL.sign);
        const mid = B.p(0, 0, 0.09);
        colliders.addBox(mid[0], mid[2], bw + 0.1, 0.3, facing, TAG); // nobody walks through the board
        const stand = B.p(0, 0, 1.5);
        register({
          id: 'residence', position: new THREE.Vector3(stand[0], groundY(stand[0], stand[2]), stand[2]), radius: 1.8, label: 'Read the sign', priority: 1,
          object3D: pickBox(B, 0, 0.97 + bh / 2, 0.1, bw + 0.3, bh + 0.5, 0.4), onUse: use({ kind: 'residence' }),
        });
        spots.residence = { x: p[0], z: p[2], facing, teamId: R.teamId };
      }
    }

    // ---- two meshes ----
    const solidGeo = merge([S.build(), ...baked]);
    for (const b of baked) b.dispose();
    const solid = new THREE.Mesh(solidGeo, flatMat);
    solid.name = 'regime-solid';
    solid.matrixAutoUpdate = false;
    group.add(solid);
    own.push(solidGeo);

    drawAtlas(canvas, R, art);
    const tex = boardTexture(canvas);
    const flatGeo = new THREE.BufferGeometry();
    flatGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A.pos), 3));
    flatGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(A.uv), 2));
    flatGeo.computeVertexNormals();
    flatGeo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const flat = new THREE.Mesh(flatGeo, mat);
    flat.name = 'regime-flat';
    flat.matrixAutoUpdate = false;
    group.add(flat);
    own.push(flatGeo, mat, tex);

    built = { own, ids, tex, mat, R, speakers, spots, triangles: solidGeo.attributes.position.count / 3 + A.pos.length / 9 };
  }

  // ---- the loudspeakers --------------------------------------------------------------------
  const HEAR = 14;
  const GAP = 75; // seconds between lines, anywhere in town
  // With sound on, the first announcement of a visit is spoken out loud, then at most every five
  // minutes. The rest stay as written lines with the chime, so the voice never gets old.
  const VOICE_GAP = 300;
  const VOICE_LINE = REGIME && typeof REGIME.voiceLine === 'string' ? REGIME.voiceLine : '';
  let lastSaid = -1e9;
  let lastSpoken = -1e9;
  let line = Math.floor(Math.random() * 1000); // every visit starts on a different line
  let said = []; // toasts that may still be up
  let clock = 0;
  // a card or a panel has the floor: take the announcement down
  const offModal = typeof hud.on === 'function' ? hud.on('modal', (open) => {
    if (!open) return;
    for (const t of said) if (t && typeof t.remove === 'function') t.remove();
    said = [];
  }) : null;
  function quiet() {
    return hud.isModalOpen() || rig.isCinematic || player.frozen || player.seated
      || (w.traffic && w.traffic.riding) || (w.kick && w.kick.active) || (w.landmarks && w.landmarks.seated);
  }
  function announce(t, pole) {
    const lines = (built.R.broadcasts || []).filter(Boolean);
    if (!lines.length) return;
    lastSaid = t;
    const show = (text, ms) => {
      said = said.filter((x) => x && x.isConnected).concat(hud.toast('LOUDSPEAKER: ' + text, { ms }) || []);
    };
    const written = () => {
      show(String(lines[line % lines.length]), 5200);
      line++;
    };
    const speak = !!(VOICE_LINE && audio.enabled && typeof audio.clip === 'function' && t - lastSpoken >= VOICE_GAP);
    try {
      audio.sfx('chime', { volume: 0.7 });
    } catch (err) { /* sound is optional */ }
    if (!speak) {
      written();
      return;
    }
    // The spoken words go on screen only once the voice really plays; otherwise a written line.
    lastSpoken = t;
    const at = pole ? { x: pole.x, z: pole.z } : null;
    Promise.resolve()
      .then(() => audio.clip(assetUrl(PATHS.loudspeakerVoice), { volume: 1, position: at, falloff: 26, delay: 1.25 }))
      .then((ok) => {
        if (ok) show(VOICE_LINE, 9000);
        else {
          lastSpoken = -1e9; // it did not play: try again next time
          written();
        }
      }, () => {
        lastSpoken = -1e9;
        written();
      });
  }
  function update(dt, t) {
    if (!built) return;
    clock += dt;
    if (clock < 0.25) return;
    clock = 0;
    const night = sky && typeof sky.nightAmount === 'number' ? sky.nightAmount : 0;
    if (Math.abs(night - lastNight) > 0.02) {
      lastNight = night;
      built.mat.emissiveIntensity = 0.34 * night; // lit like the boards, so he can be admired after dark
    }
    const pp = player.position;
    let d = Infinity;
    let pole = null;
    for (const sp of built.speakers) {
      const dd = Math.hypot(sp.x - pp.x, sp.z - pp.z);
      if (dd < d) {
        d = dd;
        pole = sp;
      }
    }
    if (d > HEAR || quiet()) return;
    if (t - lastSaid >= GAP) announce(t, pole); // one on the way in, then never more often than that, whichever pole it is
  }

  function apply(model) {
    const R = model && model.regime ? model.regime : null;
    if (!R) {
      sig = '';
      clear();
      return;
    }
    const where = (model.order || []).map((id) => {
      const e = w.town.entry(id);
      if (!e) return id + ':-';
      const door = e.home && e.home.anchors && e.home.anchors.door;
      return id + ':' + e.lot.tier + e.lot.index + (door ? ':' + door.x.toFixed(1) + ',' + door.z.toFixed(1) : '');
    }).join('|');
    const next = JSON.stringify(R) + '#' + where;
    if (next === sig && built) return;
    clear();
    sig = next;
    build(model, R);
  }

  return {
    group,
    apply,
    update,
    get place() { return built && built.spots.monument ? built.spots.monument.stand : null; },
    get spots() { return built ? built.spots : null; },
    get triangles() { return built ? built.triangles : 0; },
    dispose() {
      clear();
      if (typeof offModal === 'function') offModal();
      scene.remove(group);
    },
  };
}
