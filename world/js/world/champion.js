// The championship moment: the banners in the plaza, the trophy on the winner's lawn and the
// confetti a visitor gets once, the first time they stand in the plaza after a season is decided.
//
//   const champion = createChampion(world)
//   champion.apply(model)        raises one banner per past champion, newest first
//   champion.update(dt, t)       call once a frame
//   champion.arrived()           the visitor is in the world: arm the confetti
//   champion.champion            the season just decided: { teamId, season, teamName, ... } or null
//
// town.js uses the other two exports to stand the trophy on the champion's lot:
//   seasonChampion(model)        -> the completed season's winner, or null
//   createLawnTrophy({ ... })    -> a Prop: the cup and its name plate
//
// Budget. The banners are ONE textured mesh on ONE atlas canvas (the same trick regime.js uses),
// so five of them cost one draw call however many there are, and the masts cost one more while
// the stand-in art is in use. The whole arc is hidden past 95 m, the way facility.js hides its
// small props, so it costs nothing at all from the Hill. Every art builder is looked up through
// the art index at call time, so one that is missing or throws costs this feature its detail and
// nothing else.

import * as THREE from '../../lib/three.module.min.js';
import * as ART from '../art/index.js';
import { Geo, flatMat, merge } from '../art/index.js';
import { safeStorageGet, safeStorageSet } from '../core/util.js';
import { makeCanvas, fit, wrap, FONT_BODY, FONT_DISPLAY } from './signs.js';
import { boardTexture } from './boards.js';

const FAR = 95; // the masts stop drawing past this, like facility.js and its small props
const NEAR_PLAZA = 55; // the confetti waits until the visitor is this close to the plaza
const SEEN_KEY = 'lw.champ.seen'; // the last season whose confetti this device has already had
const LAST_SEEN_KEY = 'lw.lastSeen'; // the flow's own "since you were last here" record (ui/recap.js)
const MAX_BANNERS = 6; // the arc has room for this many before they start to crowd each other

const GOLD = 0xf5c542;
const GOLD_LO = 0xd49a25;
const IRON = 0x2b2e38;
const POLE = 0x4a4e5a;
const CSS_CREAM = '#fff3cf';
const CSS_NAVY = '#101831';

// Art builders are optional until art/champion lands. Same guard as facility.js and regime.js.
function artProp(name, a, b) {
  if (typeof ART[name] !== 'function') return null;
  try {
    return ART[name](a, b) || null;
  } catch (err) {
    console.warn('[lw] art builder "' + name + '" failed, using the stand-in', err);
    return null;
  }
}

function hexCss(c) {
  return '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

// Readable ink for a background: team colors run from near black to pale pink.
function inkFor(color) {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? CSS_NAVY : CSS_CREAM;
}

// ------------------------------------------------------------------ who won
/**
 * The champion of the season that has just finished, or null. Three sources, best first: the
 * bracket, the record book once the sync has filed the season away, and finally the standings
 * (finalRank decides the order once a season is over, so rank 1 is the winner).
 */
export function seasonChampion(model) {
  if (!model || !model.meta || model.meta.phase !== 'complete') return null;
  const season = Number(model.meta.season);
  if (!Number.isFinite(season)) return null;
  const po = model.playoffs;
  let id = po && po.state === 'final' && po.championId !== null && po.championId !== undefined ? po.championId : null;
  if (id === null) {
    const champs = model.history && Array.isArray(model.history.champions) ? model.history.champions : [];
    const first = champs[0];
    if (first && Number(first.season) === season && first.teamId !== null && first.teamId !== undefined) id = first.teamId;
  }
  if (id === null && Array.isArray(model.order) && model.order.length) id = model.order[0];
  const team = id !== null && id !== undefined && model.teams ? model.teams[id] : null;
  if (!team) return null;
  return {
    teamId: team.id,
    season,
    teamName: String(team.name || ''),
    color: Number.isFinite(team.color) ? team.color : GOLD,
    record: team.record && team.record.text ? team.record.text : '',
  };
}

// Past champions, newest first, cleaned up: the model is data from a sync job, so a malformed
// entry is dropped rather than trusted. `teamId` is null for an owner who has left the league.
function pastChampions(model) {
  const list = model && model.history && Array.isArray(model.history.champions) ? model.history.champions : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const season = Number(c.season);
    const name = String(c.teamName === null || c.teamName === undefined ? '' : c.teamName).trim();
    if (!Number.isFinite(season) || !name) continue;
    const team = c.teamId !== null && c.teamId !== undefined && model.teams ? model.teams[c.teamId] : null;
    out.push({
      season,
      teamName: name,
      record: typeof c.record === 'string' ? c.record : '',
      color: team && Number.isFinite(team.color) ? team.color : null, // null = the owner has left: neutral gold
    });
    if (out.length >= MAX_BANNERS) break;
  }
  return out;
}

// ------------------------------------------------------------------ the banner cloth
// One tall cell per champion on a shared canvas. Team names are untrusted: every string is
// fitted to its box and the name wraps to at most three lines before it is cut.
function drawBannerCell(g, x, y, w, h, c, sample) {
  const bg = c.color === null ? GOLD : c.color;
  const ink = inkFor(bg);
  const pad = Math.round(w * 0.1);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = hexCss(bg);
  g.fillRect(x, y, w, h);
  // a cream rule inside the edge, and a darker foot so the cloth reads as cloth
  g.strokeStyle = ink;
  g.lineWidth = Math.max(2, w * 0.022);
  g.strokeRect(x + pad * 0.55, y + pad * 0.55, w - pad * 1.1, h - pad * 1.1);
  g.globalAlpha = 0.16;
  g.fillStyle = '#000000';
  g.fillRect(x, y + h * 0.9, w, h * 0.1);
  g.globalAlpha = 1;

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = ink;
  const cx = x + w / 2;
  const box = w - pad * 2.2;
  // CHAMPION, then the season, then the team name, then the record it was won with
  g.fillText(fit(g, 'CHAMPION', box, h * 0.055, 9, FONT_DISPLAY, '400'), cx, y + h * 0.105);
  g.fillText(fit(g, String(c.season), box, h * 0.115, 14, FONT_DISPLAY, '400'), cx, y + h * 0.2);
  g.globalAlpha = 0.55;
  g.fillRect(x + pad * 1.4, y + h * 0.265, w - pad * 2.8, Math.max(2, h * 0.005));
  g.globalAlpha = 1;
  let size = Math.round(h * 0.085);
  let lines = [];
  for (; size >= 10; size -= Math.max(1, Math.round(size * 0.08))) {
    g.font = `700 ${size}px ${FONT_BODY}`;
    lines = wrap(g, c.teamName, box, 3);
    const widest = Math.max(...lines.map((l) => g.measureText(l).width), 0);
    if (widest <= box && lines.length * size * 1.1 <= h * 0.44) break;
  }
  const lh = size * 1.12;
  lines.forEach((l, i) => {
    g.fillText(fit(g, l, box, size, 10, FONT_BODY, '700'), cx, y + h * 0.52 + (i - (lines.length - 1) / 2) * lh);
  });
  if (c.record) g.fillText(fit(g, c.record, box, h * 0.07, 10, FONT_DISPLAY, '400'), cx, y + h * 0.815);
  if (sample) {
    g.globalAlpha = 0.72;
    g.fillText(fit(g, 'SAMPLE', box, h * 0.035, 8, FONT_BODY, '700'), cx, y + h * 0.935);
    g.globalAlpha = 1;
  }
  g.restore();
}

// ------------------------------------------------------------------ stand-in art
// Plain shapes in the same anchors and contract as the art builders. These only ever run if a
// real builder is missing or throws, and they keep the plaza's history up.

function standInMast({ height = 8, scale = 1 } = {}) {
  const H = height * scale;
  const bw = 1.8 * scale;
  const bh = 3.7 * scale;
  const g = new Geo({ jit: 0.04 });
  const group = new THREE.Group();
  g.cyl(0, 0, 0, 0.26 * scale, 0.34 * scale, IRON, { seg: 8, bottom: true });
  g.cyl(0, 0.3 * scale, 0, 0.11 * scale, H - 0.3 * scale, POLE, { seg: 6, rt: 0.085 * scale });
  g.sphere(0, H + 0.1 * scale, 0, 0.16 * scale, GOLD, { seg: 6, rings: 4 });
  // the cross arm the cloth hangs from, and a bar across its foot so it does not flap
  g.box(0, H - 0.42 * scale, 0, bw + 0.3 * scale, 0.09 * scale, 0.09 * scale, GOLD_LO, { bottom: true });
  g.box(0, H - 0.42 * scale - bh, 0, bw + 0.14 * scale, 0.07 * scale, 0.07 * scale, GOLD_LO, { bottom: true });
  const mesh = g.mesh(flatMat);
  mesh.name = 'bannerMast';
  group.add(mesh);
  return {
    group,
    mesh,
    height: H,
    colliders: [{ x: 0, z: 0, r: 0.3 * scale }],
    anchors: { bannerTop: new THREE.Vector3(0, H - 0.46 * scale, 0), bannerSize: { w: bw, h: bh } },
    dispose() { mesh.geometry.dispose(); },
  };
}

function standInTrophy({ scale = 1 } = {}) {
  const s = scale;
  const g = new Geo({ jit: 0.03 });
  const group = new THREE.Group();
  // plinth, stem, bowl, handles, lid
  g.box(0, 0, 0, 1.05 * s, 0.22 * s, 0.8 * s, 0x6b7079, { top: 0x878d96 });
  g.box(0, 0.22 * s, 0, 0.78 * s, 0.34 * s, 0.6 * s, 0x2a3350, { top: 0x3a456a });
  g.cyl(0, 0.56 * s, 0, 0.2 * s, 0.1 * s, GOLD_LO, { seg: 8 });
  g.cyl(0, 0.66 * s, 0, 0.07 * s, 0.32 * s, GOLD, { seg: 6 });
  g.lathe(0, 0.98 * s, 0, [[0.1, 0], [0.26, 0.12], [0.34, 0.42], [0.3, 0.6]], GOLD, { seg: 10 });
  for (const sx of [-1, 1]) {
    g.tube([[sx * 0.3 * s, 1.5 * s, 0], [sx * 0.52 * s, 1.36 * s, 0], [sx * 0.46 * s, 1.1 * s, 0], [sx * 0.3 * s, 1.08 * s, 0]], 0.045 * s, GOLD, { seg: 4 });
  }
  g.cyl(0, 1.58 * s, 0, 0.3 * s, 0.07 * s, GOLD_LO, { seg: 10 });
  g.cone(0, 1.65 * s, 0, 0.17 * s, 0.22 * s, GOLD, { seg: 8 });
  g.sphere(0, 1.9 * s, 0, 0.08 * s, GOLD, { seg: 6, rings: 4 });
  const mesh = g.mesh(flatMat);
  mesh.name = 'championTrophy';
  group.add(mesh);
  return {
    group,
    height: 2 * s,
    colliders: [{ x: 0, z: 0, r: 0.62 * s }],
    anchors: { plaque: new THREE.Vector3(0, 0.39 * s, 0.31 * s) },
    plaqueSize: { w: 0.68 * s, h: 0.26 * s },
    dispose() { mesh.geometry.dispose(); },
  };
}

function standInConfetti({ count = 180, color = null } = {}) {
  const n = Math.max(8, Math.min(400, Math.round(count)));
  const calm = typeof ART.isReducedMotion === 'function' && ART.isReducedMotion();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const tint = new THREE.Color();
  const mixed = [color === null ? GOLD : color, GOLD, 0xf3eedd, 0xff6a3d, 0x33c6e8];
  for (let i = 0; i < n; i++) {
    tint.set(mixed[i % mixed.length]);
    col[i * 3] = tint.r;
    col[i * 3 + 1] = tint.g;
    col[i * 3 + 2] = tint.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.26, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.name = 'pieces';
  points.frustumCulled = false;
  points.visible = false;
  const group = new THREE.Group();
  group.name = 'confetti';
  group.add(points);
  let alive = 0;
  let life = 0;
  const SPAN = calm ? 3.4 : 4.4;

  return {
    group,
    height: 4,
    radius: 3.2,
    colliders: [],
    // x, y, z are LOCAL, with y = 0 the ground the pieces land on (art/champion.js does the same)
    burst(x = 0, y = 0, z = 0) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 * 3.7;
        const k = i * 3;
        pos[k] = x + Math.cos(a) * 0.1;
        pos[k + 1] = y;
        pos[k + 2] = z + Math.sin(a) * 0.1;
        vel[k] = Math.cos(a) * (0.8 + ((i * 17) % 9) * 0.22) * (calm ? 0.5 : 1);
        vel[k + 1] = (4.6 + ((i * 13) % 11) * 0.24) * (calm ? 0.55 : 1);
        vel[k + 2] = Math.sin(a) * (0.8 + ((i * 29) % 9) * 0.22) * (calm ? 0.5 : 1);
      }
      alive = n;
      life = SPAN;
      mat.opacity = 1;
      points.visible = true;
      geo.attributes.position.needsUpdate = true;
      geo.computeBoundingSphere();
    },
    update(dt, t) {
      if (life <= 0) return;
      life -= dt;
      if (life <= 0) {
        alive = 0;
        points.visible = false;
        return;
      }
      const d = Math.min(0.05, Math.max(0, dt || 0));
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        if (pos[k + 1] <= 0.02) continue;
        vel[k + 1] -= 8 * d;
        if (vel[k + 1] < -1.5) vel[k + 1] = -1.5;
        const sway = calm ? 0 : Math.sin(t * 3.1 + i) * 0.5;
        pos[k] += (vel[k] + sway) * d;
        pos[k + 1] += vel[k + 1] * d;
        pos[k + 2] += (vel[k + 2] - sway * 0.6) * d;
        vel[k] *= 1 - 2.3 * d;
        vel[k + 2] *= 1 - 2.3 * d;
        if (pos[k + 1] < 0.02) pos[k + 1] = 0.02;
      }
      mat.opacity = Math.max(0, Math.min(1, life / 0.7));
      geo.attributes.position.needsUpdate = true;
    },
    get busy() { return alive > 0 && life > 0; },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ the lawn trophy (Contract 7 detail)
/**
 * The cup the champion keeps on the lawn, with a plate naming the team and the season.
 * Returns a Prop town.js can hang at a home's `trophy` anchor, or null if nothing could be built.
 */
export function createLawnTrophy({ teamName = '', season = 0, color = GOLD, sample = false } = {}) {
  const group = new THREE.Group();
  group.name = 'championLawn';
  const own = [];
  const cup = artProp('createChampionTrophy') || standInTrophy({ scale: 1 });
  if (!cup || !cup.group) return null;
  group.add(cup.group);

  // The plate: on the cup's own plinth when the art offers a spot, otherwise on two short legs
  // just in front of it. Local +Z is the street side, so either way it faces the visitor.
  const size = cup.plaqueSize && cup.plaqueSize.w > 0 ? cup.plaqueSize : { w: 0.74, h: 0.28 };
  const at = cup.anchors && cup.anchors.plaque ? cup.anchors.plaque.clone() : null;
  const cv = makeCanvas(512, Math.max(64, Math.round((512 * size.h) / size.w)));
  {
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#3a2f16');
    grad.addColorStop(1, '#241c0c');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#f5c542';
    g.lineWidth = Math.max(3, H * 0.055);
    g.strokeRect(g.lineWidth, g.lineWidth, W - g.lineWidth * 2, H - g.lineWidth * 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f5c542';
    g.fillText(fit(g, season ? season + ' CHAMPION' : 'CHAMPION', W * 0.82, H * 0.3, 10, FONT_DISPLAY, '400'), W / 2, H * 0.3);
    g.fillStyle = '#fff3cf';
    g.fillText(fit(g, teamName, W * 0.88, H * 0.34, 10, FONT_BODY, '700'), W / 2, H * 0.63);
    if (sample) {
      g.fillStyle = 'rgba(255,243,207,0.7)';
      g.fillText(fit(g, 'SAMPLE HISTORY', W * 0.5, H * 0.13, 8, FONT_BODY, '700'), W / 2, H * 0.88);
    }
  }
  const tex = boardTexture(cv);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), new THREE.MeshLambertMaterial({ map: tex }));
  own.push(face.geometry, face.material, tex);
  if (at) {
    face.position.set(at.x, at.y, at.z + 0.012);
    group.add(face);
  } else {
    const stand = new Geo({ jit: 0.03 });
    const lift = 0.55;
    for (const sx of [-1, 1]) stand.box(sx * (size.w / 2 - 0.06), 0, 0, 0.06, lift, 0.06, IRON);
    stand.box(0, lift - 0.03, -0.02, size.w + 0.08, size.h + 0.08, 0.05, IRON, { bottom: true });
    const legs = stand.mesh(flatMat);
    legs.name = 'trophyPlateStand';
    legs.position.set(0, 0, 0.95);
    group.add(legs);
    own.push(legs.geometry);
    face.position.set(0, lift + size.h / 2 - 0.03, 0.95 + 0.04);
    group.add(face);
  }

  const colliders = (cup.colliders || []).map((c) => ({ x: c.x, z: c.z, r: c.r }));
  if (!at) colliders.push({ x: 0, z: 0.95, r: 0.3 });
  return {
    group,
    colliders,
    update: typeof cup.update === 'function' ? (dt, t) => cup.update(dt, t) : undefined,
    dispose() {
      if (cup.dispose) cup.dispose();
      for (const o of own) if (o && o.dispose) o.dispose();
    },
  };
}

// ------------------------------------------------------------------ the plaza arc
export function createChampion(w) {
  const { scene, layout, terrain, colliders, hud, player, audio } = w;
  const ARC = layout.places.championArc;
  const PLAZA = layout.stations.plaza;
  const group = new THREE.Group();
  group.name = 'champions';
  scene.add(group);

  const TAG = 'champion';
  let built = null; // { own, props, sig }
  let model = null;
  let champ = null; // the season just decided, or null
  let armed = false; // a visitor is in the world and has not had this season's confetti
  let thrown = false; // ... and it has gone up, so it never goes up twice in one visit
  let visitorHere = false; // arrived() has been called at least once this visit
  let visible = true;
  const cam = new THREE.Vector3();

  // Three throws across the plaza, each its own prop: one burst reaches about 3 m, and a town
  // that has waited a year for this deserves more than one puff over the statue. The group sits
  // on the paving, so a burst is thrown in LOCAL coordinates with y = 0 the ground it lands on.
  // Between bursts every piece is hidden and the lot costs nothing.
  const THROWS = [[0, 0], [-7.5, 7], [8, 6.5]];
  const confetti = THROWS.map(([ox, oz], i) => {
    const prop = artProp('createConfetti', { count: i ? 110 : 150, color: null }) || standInConfetti({ count: i ? 110 : 150, color: null });
    if (!prop || !prop.group) return null;
    prop.group.position.set(PLAZA.x + ox, terrain.heightAt(PLAZA.x + ox, PLAZA.z + oz), PLAZA.z + oz);
    group.add(prop.group);
    return prop;
  }).filter(Boolean);

  // ---------------------------------------------------------------- storage (see ui/recap.js)
  // The flow already keeps one "since you were last here" record. This adds one small line of
  // its own, the season whose confetti has been and gone, and reads the flow's record as well so
  // a member who was already here after the final whistle is not handed confetti for old news.
  function readJson(key) {
    try {
      const raw = safeStorageGet(key);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : null;
    } catch (err) {
      return null;
    }
  }
  function alreadyCelebrated(season) {
    if (String(safeStorageGet(SEEN_KEY) || '') === String(season)) return true;
    const prev = readJson(LAST_SEEN_KEY);
    // the flow stores the season and week of the last visit: the same pair means they were here
    // after this season ended, so the confetti has already been somebody else's problem
    return !!(prev && Number(prev.season) === Number(season) && model && Number(prev.week) === Number(model.meta.week));
  }

  // ---------------------------------------------------------------- build the arc
  function clear() {
    if (!built) return;
    for (const p of built.props) {
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      if (p.dispose) p.dispose();
    }
    for (const o of built.own) if (o && o.dispose) o.dispose();
    colliders.removeGroup(TAG);
    built = null;
  }

  // Every mast baked into one geometry, or null when any of them is not a plain single-mesh
  // prop on the shared flat material. Baking freezes a prop, so one that animates is left alone.
  function bakeMasts(masts) {
    const geos = [];
    for (const m of masts) {
      if (typeof m.prop.update === 'function') return null;
      const meshes = [];
      m.prop.group.traverse((o) => {
        if (o.isMesh || o.isPoints || o.isSprite || o.isLine) meshes.push(o);
      });
      if (meshes.length !== 1) return null;
      const mesh = meshes[0];
      const at = mesh.isMesh && mesh.geometry ? mesh.geometry.attributes : null;
      if (mesh.material !== flatMat || !at || !at.position || !at.color || at.color.itemSize !== 3 || at.uv) return null;
      m.prop.group.updateMatrixWorld(true);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', at.position.clone());
      geo.setAttribute('color', at.color.clone());
      geo.applyMatrix4(mesh.matrixWorld);
      geos.push(geo);
    }
    if (!geos.length) return null;
    const out = merge(geos);
    for (const geo of geos) geo.dispose();
    return out;
  }

  // Where mast i stands. Bearings run clockwise from north, so the newest champion takes the
  // first spot, the one the arrival walk looks straight at, and the arc sweeps back in time.
  // Every cloth is turned to face the same spot on the arrival walk, so the whole arc reads
  // from where a visitor lands instead of only the one in the middle.
  function spotOf(i, n) {
    const step = n > 1 ? Math.min(ARC.maxStep, ARC.span / (n - 1)) : 0;
    const a = ARC.from + step * i;
    const x = ARC.x + Math.sin(a) * ARC.r;
    const z = ARC.z - Math.cos(a) * ARC.r;
    return { x, z, facing: Math.atan2(ARC.aim[0] - x, ARC.aim[1] - z) };
  }

  function build(list) {
    clear();
    if (!list.length) return;
    const own = [];
    const props = [];
    const nodes = []; // what the distance cull switches off
    const sample = !!(model && model.meta && model.meta.historyIsSample);

    // the cloth: one cell per champion on one canvas, one quad per cell, both sides readable
    const cellW = 320;
    const pos = [];
    const uv = [];
    const quad = (a, b, c, d, u0, v0, u1, v1) => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };

    const masts = [];
    for (let i = 0; i < list.length; i++) {
      const s = spotOf(i, list.length);
      const height = ARC.height - i * 0.18;
      const prop = artProp('createBannerMast', { height, scale: ARC.scale }) || standInMast({ height, scale: ARC.scale });
      if (!prop || !prop.group) continue;
      const y = terrain.heightAt(s.x, s.z);
      prop.group.position.set(s.x, y, s.z);
      prop.group.rotation.y = s.facing;
      masts.push({ prop, x: s.x, y, z: s.z, facing: s.facing });
      const c = Math.cos(s.facing);
      const sn = Math.sin(s.facing);
      for (const col of prop.colliders || []) {
        colliders.addCircle(s.x + col.x * c + col.z * sn, s.z - col.x * sn + col.z * c, Math.max(0.18, col.r), TAG);
      }
      if (!prop.colliders || !prop.colliders.length) colliders.addCircle(s.x, s.z, 0.3, TAG);
    }
    if (!masts.length) return;

    // The banner cells all share one aspect: the first mast's, so a mast that reports an odd
    // size cannot stretch the others. Each cloth is drawn to fit its own mast all the same.
    const a0 = masts[0].prop.anchors || {};
    const size0 = a0.bannerSize && a0.bannerSize.w > 0 && a0.bannerSize.h > 0 ? a0.bannerSize : { w: 1.8, h: 3.7 };
    const cellH = Math.max(64, Math.min(1024, Math.round((cellW * size0.h) / size0.w)));
    const cv = makeCanvas(cellW * masts.length, cellH);
    const g = cv.getContext('2d');

    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < masts.length; i++) {
      const m = masts[i];
      const an = m.prop.anchors || {};
      const size = an.bannerSize && an.bannerSize.w > 0 && an.bannerSize.h > 0 ? an.bannerSize : size0;
      const top = an.bannerTop ? an.bannerTop.clone() : new THREE.Vector3(0, (m.prop.height || ARC.height) - 0.46, 0);
      top.applyAxisAngle(up, m.facing);
      const cx = m.x + top.x;
      const cy = m.y + top.y;
      const cz = m.z + top.z;
      const rx = Math.cos(m.facing) * (size.w / 2); // the cloth's own right, along the mast's local x
      const rz = -Math.sin(m.facing) * (size.w / 2);
      const nx = Math.sin(m.facing) * 0.02; // stood just off the mast so the pole never splits it
      const nz = Math.cos(m.facing) * 0.02;
      const P = (sx, dy, side) => new THREE.Vector3(cx + rx * sx + nx * side, cy + dy, cz + rz * sx + nz * side);
      const u0 = (i * cellW + 1.5) / cv.width;
      const u1 = ((i + 1) * cellW - 1.5) / cv.width;
      quad(P(-1, -size.h, 1), P(1, -size.h, 1), P(1, 0, 1), P(-1, 0, 1), u0, 0, u1, 1);
      quad(P(1, -size.h, -1), P(-1, -size.h, -1), P(-1, 0, -1), P(1, 0, -1), u0, 0, u1, 1);
      drawBannerCell(g, i * cellW, 0, cellW, cellH, list[i], sample);
      props.push(m.prop);
    }

    // The masts: every one of them is a single merged vertex-colored mesh on the shared flat
    // material, so the lot bakes into one geometry and one draw call. A mast that does not fit
    // that shape, or that animates, keeps its own group and pays for itself.
    const baked = bakeMasts(masts);
    if (baked) {
      const mesh = new THREE.Mesh(baked, flatMat);
      mesh.name = 'bannerMasts';
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      nodes.push(mesh);
      own.push(baked);
    } else {
      for (const m of masts) {
        group.add(m.prop.group);
        nodes.push(m.prop.group);
      }
    }

    const tex = boardTexture(cv);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    const cloth = new THREE.Mesh(geo, mat);
    cloth.name = 'championBanners';
    cloth.matrixAutoUpdate = false;
    group.add(cloth);
    nodes.push(cloth);
    own.push(geo, mat, tex);

    built = { own, props, nodes, count: masts.length };
  }

  // ---------------------------------------------------------------- the model
  function signatureOf(list) {
    return list.map((c) => c.season + ':' + c.teamName + ':' + c.record + ':' + c.color).join('|')
      + '#' + (model && model.meta ? model.meta.historyIsSample : '');
  }
  let sig = null;

  function apply(next) {
    model = next;
    const was = champ;
    champ = seasonChampion(model);
    const list = pastChampions(model);
    const s = signatureOf(list);
    if (s !== sig) {
      sig = s;
      build(list);
    }
    if (!champ) {
      armed = false;
    } else if (!was || was.season !== champ.season) {
      // a different season is on the board (a refresh decided one while the page was open):
      // that is a new thing to celebrate, so the one burst comes back
      thrown = false;
      if (visitorHere) arrived();
    }
  }

  // ---------------------------------------------------------------- the confetti
  /** The visitor is in the world. Arms the one burst this season has coming. */
  function arrived() {
    visitorHere = true;
    if (thrown || !champ) return false;
    if (alreadyCelebrated(champ.season)) {
      thrown = true;
      return false;
    }
    armed = true;
    return true;
  }

  function fire() {
    armed = false;
    thrown = true;
    if (champ) safeStorageSet(SEEN_KEY, String(champ.season));
    for (const prop of confetti) {
      if (typeof prop.burst !== 'function') continue;
      try {
        prop.burst(0, 1.2, 0); // thrown from head height, so it rises and comes down over the paving
      } catch (err) {
        console.warn('[lw] the confetti did not go up', err);
      }
    }
    try {
      audio.sfx('fanfare', { volume: 0.8 });
    } catch (err) { /* sound is optional */ }
    if (hud && typeof hud.toast === 'function' && champ) {
      hud.toast(champ.season + ' is in the books. The trophy is on ' + champ.teamName + "'s lawn.", { ms: 5600 });
    }
  }

  // ---------------------------------------------------------------- per frame
  function update(dt, t) {
    cam.copy(w.engine.camera.position);
    const dx = ARC.x - cam.x;
    const dz = ARC.z - cam.z;
    const near = dx * dx + dz * dz < FAR * FAR;
    if (near !== visible) {
      visible = near;
      if (built) for (const node of built.nodes) node.visible = near;
    }
    if (near && built) for (const p of built.props) if (p.update) p.update(dt, t);
    for (const prop of confetti) if (prop.update) prop.update(dt, t);
    if (!armed) return;
    // Wait for the visitor to be standing in the plaza with nothing in the way: no ride, no
    // picker, no card. Otherwise it goes up behind the loading veil and nobody ever sees it.
    if (w.rig.isCinematic || w.idle || player.seated) return;
    if (hud && typeof hud.isModalOpen === 'function' && hud.isModalOpen()) return;
    const px = player.position.x - PLAZA.x;
    const pz = player.position.z - PLAZA.z;
    if (px * px + pz * pz > NEAR_PLAZA * NEAR_PLAZA) return;
    fire();
  }

  return {
    group,
    apply,
    update,
    arrived,
    get champion() { return champ; },
    get armed() { return armed; },
    get thrown() { return thrown; },
    get busy() { return confetti.some((p) => p.busy); },
    get banners() { return built ? built.count : 0; },
    // tests and the console
    _fire() {
      armed = true;
      thrown = false;
    },
    dispose() {
      clear();
      for (const prop of confetti) if (prop.dispose) prop.dispose();
      scene.remove(group);
    },
  };
}
