// Settle the score: eggs, toilet paper and preset spray tags at the home of the team you beat.
//
// The rule from the original brief: you may vandalize the home of a team you beat, with preset
// tags, eggs and toilet paper only. "A team you beat" is the last completed week
// (model.vandalism.resultWeek), and nothing else in town can be hit. Damage is kept through
// net.vandalism (this device for now, a shared store later) in the target home's own frame, so it
// moves with the house when the standings move it. Damage from any other week never shows.
//
//   const vandal = createVandal(world)
//   vandal.apply(model)        redraw the damage for the current result week
//   vandal.update(dt, t)
//   vandal.summary(teamId)     { egg, tp, tag, by } done to that home this week, or null
//   vandal.right(teamId)       that team's right this week ({ targetId, ... }) or null
//   vandal.enter()             go to the target and start (resolves false without a right)
//   vandal.place               { x, z, facing, name, blurb } where the vandal stands, or null
//   vandal.active              true while the mode has the camera and the input
//   vandal.leave()
//
// Phone: swipe up to throw (speed is power, angle is aim). Paint: pick a tag, tap a wall.
// Keyboard: 1 2 3 pick eggs, toilet paper or paint, hold Space and let go to throw, arrows aim.
// The persistent damage is three draw calls: one instanced mesh for every splat, one merged mesh
// for every streamer of paper, one atlas for every tag.

import * as THREE from '../../lib/three.module.min.js';
import { Geo, flatMat } from '../art/index.js';
import { makeCanvas, hex, FONT_DISPLAY } from './signs.js';
import { mulberry32 } from '../core/util.js';
import { cleanVandalItem } from '../core/net.js';

const TAU = Math.PI * 2;
const G = 9.8;
const KINDS = ['egg', 'tp', 'tag'];
const NAMES = { egg: 'Eggs', tp: 'TP', tag: 'Paint' };
const LOFT = { egg: 0.36, tp: 0.95 };
const SPEED = { egg: [7, 15.5], tp: [6, 14] };
const MAX_SPLATS = 256;
const MAX_TAGS = 8;
const NEAR = 4.5; // trees this far outside the lot still count as the home's own (eggs and paper)
const LOT_PAD = 1.0; // splats and paper on the grass stay this close to the lot
const TAG_W = 2.6; // a tag on the wall, in meters (the atlas cell is 4:1)
const PAPER_W = 0.17;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// A lot's own frame: +Z points at its street (three.js rotation.y = lot.facing).
function frameOf(lot) {
  const c = Math.cos(lot.facing);
  const s = Math.sin(lot.facing);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    lot,
    toWorld: (p, out) => out.set(lot.x + p[0] * c + p[2] * s, lot.y + p[1], lot.z - p[0] * s + p[2] * c),
    dirToWorld: (n, out) => out.set(n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c),
    toLocal: (v) => {
      const dx = v.x - lot.x;
      const dz = v.z - lot.z;
      return [r3(dx * c - dz * s), r3(v.y - lot.y), r3(dx * s + dz * c)];
    },
    dirToLocal: (v) => [r3(v.x * c - v.z * s), r3(v.y), r3(v.x * s + v.z * c)],
    inside: (x, z, pad) => {
      const dx = x - lot.x;
      const dz = z - lot.z;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      return Math.abs(lx) <= lot.w / 2 + pad && Math.abs(lz) <= lot.d / 2 + pad;
    },
  };
}

// ---- textures ------------------------------------------------------------------------------------
// One egg, broken: lumpy white, a yolk, three drips running down (the bottom of the canvas is
// "down" on a wall). Instance colours only tint it.
function drawSplat() {
  const S = 128;
  const cv = makeCanvas(S, S);
  const g = cv.getContext('2d');
  const r = mulberry32(77);
  const cx = 64;
  const cy = 46;
  g.clearRect(0, 0, S, S);
  const drip = (x, w, len) => {
    g.beginPath();
    g.moveTo(x - w / 2, cy);
    g.lineTo(x - w * 0.32, cy + len);
    g.arc(x, cy + len, w * 0.45, Math.PI, 0, true);
    g.lineTo(x + w / 2, cy);
    g.closePath();
    g.fill();
  };
  const blob = (x, y, rr) => {
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.fill();
  };
  const lumps = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + r() * 0.4;
    const d = 18 + r() * 10;
    lumps.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, 7 + r() * 7]);
  }
  const drops = [];
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU;
    const d = 36 + r() * 12;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.85;
    if (y > 5 && y < S - 5 && x > 5 && x < S - 5) drops.push([x, y, 2 + r() * 3]);
  }
  // a darker wet rim first, then the white on top of it
  for (const [fill, grow] of [['#a8862e', 3.2], ['#f3e5a6', 0]]) {
    g.fillStyle = fill;
    drip(cx + 6, 10 + grow * 1.6, 66 + grow * 0.6);
    drip(cx - 14, 8 + grow * 1.6, 40 + grow * 0.6);
    drip(cx + 20, 6 + grow * 1.6, 26 + grow * 0.6);
    blob(cx, cy, 25 + grow);
    for (const [x, y, rr] of lumps) blob(x, y, rr + grow);
    for (const [x, y, rr] of drops) blob(x, y, rr + grow * 0.6);
  }
  const yolk = g.createRadialGradient(cx + 1, cy - 5, 2, cx + 3, cy - 2, 14);
  yolk.addColorStop(0, '#ffe066');
  yolk.addColorStop(0.55, '#f7b52a');
  yolk.addColorStop(1, '#e8961a');
  g.fillStyle = yolk;
  blob(cx + 3, cy - 2, 13);
  g.fillStyle = 'rgba(255,255,240,0.9)';
  g.beginPath();
  g.ellipse(cx - 1, cy - 7, 4, 2.4, -0.5, 0, TAU);
  g.fill();
  return cv;
}

// A spray-painted tag in the attacker's colour: a haze of overspray, a dark outline, the fill and
// a few drips. Text comes from the preset list only.
function drawTag(g, x0, y0, W, H, text, color, seed) {
  const css = hex(color);
  const r = mulberry32(seed);
  g.save();
  g.beginPath();
  g.rect(x0, y0, W, H);
  g.clip();
  let size = Math.round(H * 0.66);
  g.font = `400 ${size}px ${FONT_DISPLAY}`;
  while (size > 20 && g.measureText(text).width > W * 0.86) {
    size -= 2;
    g.font = `400 ${size}px ${FONT_DISPLAY}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = x0 + W / 2;
  const cy = y0 + H * 0.43;
  const tw = Math.min(W * 0.86, g.measureText(text).width);
  g.globalAlpha = 0.4;
  g.shadowColor = css;
  g.shadowBlur = 16;
  g.fillStyle = css;
  g.fillText(text, cx, cy);
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size * 0.1);
  g.strokeStyle = 'rgba(14,14,22,0.9)';
  g.strokeText(text, cx, cy);
  g.fillStyle = css;
  g.fillText(text, cx, cy);
  for (let i = 0; i < 6; i++) {
    const x = cx - tw / 2 + tw * (0.06 + 0.88 * r());
    const y = cy + size * 0.26;
    const len = 6 + r() * Math.max(6, y0 + H - y - 10);
    g.fillRect(x - 1.8, y, 3.6, len);
    g.beginPath();
    g.arc(x, y + len, 2.7, 0, TAU);
    g.fill();
  }
  g.restore();
}

export function createVandal(w) {
  const { scene, terrain, colliders, interact, hud, input, rig, player, audio, store, net } = w;
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const tap = hud.onTap || ((n, fn) => n.addEventListener('click', fn));
  const vstore = net && net.vandalism ? net.vandalism : null;
  const group = new THREE.Group();
  group.name = 'vandalism';
  scene.add(group);

  // ------------------------------------------------------------------ the damage (three draw calls)
  const splatTex = new THREE.CanvasTexture(drawSplat());
  splatTex.colorSpace = THREE.SRGBColorSpace;
  const splatGeo = new THREE.PlaneGeometry(1, 1);
  const splatMat = new THREE.MeshLambertMaterial({ map: splatTex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const splats = new THREE.InstancedMesh(splatGeo, splatMat, MAX_SPLATS);
  splats.name = 'vandal-splats';
  splats.count = 0;
  splats.visible = false;
  group.add(splats);

  const tagCanvas = makeCanvas(1024, 512);
  const tagTex = new THREE.CanvasTexture(tagCanvas);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  tagTex.anisotropy = 4;
  const tagMat = new THREE.MeshLambertMaterial({ map: tagTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const tags = new THREE.Mesh(new THREE.BufferGeometry(), tagMat);
  tags.name = 'vandal-tags';
  tags.visible = false;
  tags.matrixAutoUpdate = false;
  group.add(tags);

  const paperMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const paper = new THREE.Mesh(new THREE.BufferGeometry(), paperMat);
  paper.name = 'vandal-paper';
  paper.visible = false;
  paper.matrixAutoUpdate = false;
  group.add(paper);

  // ------------------------------------------------------------------ things in the air
  const eggGeo = (() => {
    const g = new Geo();
    g.sphere(0, 0, 0, 0.05, 0xf6f1e3, { seg: 7, rings: 4, sy: 1.3 });
    return g.build();
  })();
  const rollGeo = (() => {
    const g = new Geo();
    g.cyl(0, -0.06, 0, 0.065, 0.12, 0xf7f7f1, { seg: 9, bottom: true, top: 0xd8d4c8 });
    return g.build();
  })();
  const eggs = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(eggGeo, flatMat);
    m.visible = false;
    m.name = 'vandal-egg';
    group.add(m);
    eggs.push(m);
  }
  const roll = new THREE.Mesh(rollGeo, flatMat);
  roll.visible = false;
  roll.name = 'vandal-roll';
  group.add(roll);
  const STREAM_MAX = 64;
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAM_MAX * 6 * 3), 3));
  streamGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(STREAM_MAX * 6 * 3), 3));
  streamGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(STREAM_MAX * 6 * 3).fill(0.97), 3));
  streamGeo.setDrawRange(0, 0);
  const stream = new THREE.Mesh(streamGeo, paperMat);
  stream.name = 'vandal-stream';
  stream.frustumCulled = false;
  stream.visible = false;
  group.add(stream);
  const aimLine = (() => {
    const g = new Geo();
    for (let i = 0; i < 6; i++) g.box(0, 0, 0.9 + i * 0.55, 0.07, 0.02, 0.3, 0xffd34d);
    g.tri([-0.22, 0.02, 4.25], [0.22, 0.02, 4.25], [0, 0.02, 4.7], 0xffd34d);
    const m = g.mesh(flatMat);
    m.visible = false;
    m.name = 'vandal-aim';
    return m;
  })();
  group.add(aimLine);

  // ------------------------------------------------------------------ state
  const S = {
    model: null, V: null, W: 0, me: null, right: null, target: null, spot: null, look: new THREE.Vector3(),
    active: false, release: null, item: 'egg', tagId: null, sheet: false, aim: 0, charging: false, charge: 0, chargeDir: 1,
    inFlight: { egg: 0, tp: 0, tag: 0 }, used: 0, lastSay: -1e9, lastLine: '', startUntil: 0, throwAnim: 0,
  };
  const dbg = { swipes: 0, thrown: 0, landed: 0, saved: 0, rejected: 0, last: '' };
  let pending = []; // added this visit, not listed by the store yet
  const shown = { sig: '', counts: new Map(), atlas: '' };
  let drapeCache = new Map();
  let lastDrape = '';
  const drapeLog = [];
  let treeBank = null;
  const ray = new THREE.Raycaster();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const projectiles = [];

  const lines = () => (S.V && S.V.lines) || {};
  const allowance = (kind) => (S.V && S.V.allowance && Number(S.V.allowance[kind])) || 0;

  function rightOf(teamId) {
    if (!S.V || teamId === null || teamId === undefined) return null;
    const r = S.V.rights && S.V.rights[teamId];
    if (!r || r.targetId === undefined || r.targetId === null) return null;
    return r;
  }

  function tagText(attackerId, tagId) {
    if (!S.V) return null;
    const r = rightOf(attackerId);
    const all = (S.V.tags || []).concat(r && Array.isArray(r.tags) ? r.tags : []);
    const t = all.find((x) => x && x.id === tagId);
    return t && typeof t.text === 'string' ? t.text.slice(0, 16) : null;
  }

  // every scatter tree in town, as a crown sphere
  function trees() {
    if (treeBank) return treeBank;
    treeBank = [];
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const mm = new THREE.Matrix4();
    scene.traverse((o) => {
      if (!o.isInstancedMesh || typeof o.name !== 'string') return;
      const k = /^scatter-[a-z]+:(round|pine|dead|topiary)$/.exec(o.name);
      if (!k) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      const cy = bb.min.y + (bb.max.y - bb.min.y) * (k[1] === 'pine' ? 0.5 : k[1] === 'dead' ? 0.64 : 0.68);
      const rr = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 * (k[1] === 'dead' ? 1.05 : 0.9);
      o.updateMatrixWorld(true);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, mm);
        mm.premultiply(o.matrixWorld);
        mm.decompose(pos, q, sc);
        treeBank.push({ c: new THREE.Vector3(pos.x, pos.y + cy * sc.y, pos.z), r: rr * sc.x });
      }
    });
    return treeBank;
  }

  // What a home is made of, for hits: its own meshes, its trees, its box.
  function homeCtx(teamId) {
    const e = w.town && w.town.entry(teamId);
    if (!e || !e.home || !e.lot) return null;
    const F = frameOf(e.lot);
    const key = e.team.tier + ':' + e.lot.tier + e.lot.index + ':' + e.lot.x.toFixed(2) + ',' + e.lot.z.toFixed(2);
    let meshes = null;
    let near = null;
    let box = null;
    return {
      e, F, key,
      get meshes() {
        if (meshes) return meshes;
        meshes = [];
        e.home.group.updateMatrixWorld(true);
        e.home.group.traverse((o) => {
          if (o.isMesh && !o.isSprite && !o.isInstancedMesh && o.geometry && o.geometry.attributes.position) meshes.push(o);
        });
        return meshes;
      },
      get trees() {
        if (near) return near;
        near = trees().filter((t) => F.inside(t.c.x, t.c.z, NEAR + t.r * 0.5));
        return near;
      },
      get box() {
        if (box) return box;
        box = new THREE.Box3().setFromObject(e.home.group).expandByScalar(0.25);
        return box;
      },
    };
  }

  function worldNormal(hit, out) {
    out.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (out.dot(ray.ray.direction) > 0) out.negate();
    return out;
  }

  // ------------------------------------------------------------------ which items show
  function collect() {
    if (!S.V) return [];
    const W = S.W;
    const listed = vstore ? vstore.list(W) : [];
    const ids = new Set(listed.map((x) => x.id));
    pending = pending.filter((x) => x.week === W && !ids.has(x.id));
    const all = listed.concat(pending).sort((a, b) => a.at - b.at);
    const used = new Map();
    const out = [];
    for (const it of all) {
      if (it.week !== W) continue;
      // only the team that beat this home, and never more than the allowance
      if (Number(S.V.victims && S.V.victims[it.targetId]) !== it.attackerId) continue;
      const k = it.attackerId + ':' + it.kind;
      const n = (used.get(k) || 0) + 1;
      if (n > allowance(it.kind)) continue;
      used.set(k, n);
      out.push(it);
    }
    return out;
  }

  function usedBy(attackerId, kind) {
    let n = 0;
    for (const it of collect()) if (it.attackerId === Number(attackerId) && it.kind === kind) n++;
    return n;
  }
  const remaining = (kind) => (S.right ? Math.max(0, allowance(kind) - usedBy(S.me, kind) - S.inFlight[kind]) : 0);

  // ------------------------------------------------------------------ placing what was stored
  function placePoint(it, h) {
    if (it.on === 'miss') return null;
    const p = h.F.toWorld(it.p, new THREE.Vector3());
    if (it.on === 'ground') {
      if (!h.F.inside(p.x, p.z, LOT_PAD)) return null;
      const g = terrain.heightAt(p.x, p.z);
      // the same house keeps its own yard height; a different one sits on the ground
      p.y = it.tier === h.e.team.tier ? Math.max(g, Math.min(p.y, g + 0.35)) : g;
      return { p, n: UP.clone(), on: 'ground' };
    }
    const n = h.F.dirToWorld(it.n, new THREE.Vector3()).normalize();
    if (it.on === 'tree') {
      let best = null;
      let bd = 0.8;
      for (const t of h.trees) {
        const d = Math.abs(p.distanceTo(t.c) - t.r);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (!best) return null;
      n.subVectors(p, best.c).normalize();
      p.copy(best.c).addScaledVector(n, best.r);
      return { p, n, on: 'tree' };
    }
    // Look for the house along the stored normal. On the same house the surface must be right
    // where the item says (so nothing floats in the air); on a different one, anything close.
    const same = it.tier === h.e.team.tier;
    ray.set(v1.copy(p).addScaledVector(n, 0.6), v2.copy(n).negate());
    ray.near = 0;
    ray.far = same ? 1.0 : 1.4;
    const hit = ray.intersectObjects(h.meshes, false)[0];
    if (!hit) return null;
    if (same) return { p, n, on: 'home' };
    return { p: hit.point.clone(), n: worldNormal(hit, new THREE.Vector3()), on: 'home' };
  }

  // Lay a streamer of paper along a flight path: onto roofs, crowns and the lawn, hanging off edges.
  function drape(it, h) {
    if (it.tier !== h.e.team.tier || !Array.isArray(it.pts)) return null;
    const raw = it.pts.map((q) => h.F.toWorld(q, new THREE.Vector3()));
    let P = [];
    for (let i = 0; i < raw.length; i++) {
      if (i) {
        const a = raw[i - 1];
        const b = raw[i];
        const n = Math.min(5, Math.floor(a.distanceTo(b) / 0.5));
        for (let k = 1; k <= n; k++) P.push(new THREE.Vector3().lerpVectors(a, b, k / (n + 1)));
      }
      P.push(raw[i]);
    }
    if (P.length > 44) P = P.slice(P.length - 44);
    const box = h.box;
    const D = [];
    for (const q of P) {
      if (!h.F.inside(q.x, q.z, NEAR)) {
        D.push(null);
        continue;
      }
      const g = terrain.heightAt(q.x, q.z);
      let top = g;
      let on = 'ground';
      for (const t of h.trees) {
        const dx = q.x - t.c.x;
        const dz = q.z - t.c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= t.r * t.r || q.y < t.c.y - t.r) continue;
        const yy = Math.min(t.c.y + Math.sqrt(t.r * t.r - d2), Math.max(q.y, t.c.y));
        if (yy > top) {
          top = yy;
          on = 'tree';
        }
      }
      if (q.x >= box.min.x && q.x <= box.max.x && q.z >= box.min.z && q.z <= box.max.z && q.y + 0.3 > top) {
        ray.set(v1.set(q.x, q.y + 0.3, q.z), DOWN);
        ray.near = 0;
        ray.far = q.y + 0.3 - top;
        const hit = ray.intersectObjects(h.meshes, false)[0];
        if (hit && hit.point.y > top) {
          top = hit.point.y;
          on = 'home';
        }
      }
      if (on === 'ground' && !h.F.inside(q.x, q.z, LOT_PAD)) {
        D.push(null);
        continue;
      }
      D.push({ x: q.x, y: top + (on === 'ground' ? 0.06 : 0.035), z: q.z, on, g });
    }
    lastDrape = D.map((d) => (d ? d.on[0] : '-')).join('');
    // the paper's own geometry, in world space
    const pos = [];
    const rnd = mulberry32(hashStr(it.id));
    const ok = D.filter(Boolean);
    if (ok.length < 2) return pos;
    const first = ok[0];
    const last = ok[ok.length - 1];
    let sx = -(last.z - first.z);
    let sz = last.x - first.x;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const quad = (ax, ay, az, bx, by, bz, wx, wz, width = PAPER_W) => {
      const hw = width / 2;
      pos.push(ax - wx * hw, ay, az - wz * hw, ax + wx * hw, ay, az + wz * hw, bx + wx * hw, by, bz + wz * hw);
      pos.push(ax - wx * hw, ay, az - wz * hw, bx + wx * hw, by, bz + wz * hw, bx - wx * hw, by, bz - wz * hw);
    };
    const flat = (a, b) => {
      let wx = -(b.z - a.z);
      let wz = b.x - a.x;
      const l = Math.hypot(wx, wz);
      if (l < 0.05) {
        wx = sx;
        wz = sz;
      } else {
        wx /= l;
        wz /= l;
      }
      quad(a.x, a.y, a.z, b.x, b.y, b.z, wx, wz);
    };
    const strand = (x, y, z, len) => {
      // hangs straight down with a little sway, broad side to whoever threw it
      let px = x;
      let py = y;
      let pz = z;
      for (let k = 1; k <= 3; k++) {
        const ny = y - (len * k) / 3;
        const ox = x + Math.cos(k * 1.7 + x) * 0.06;
        const oz = z + Math.sin(k * 1.7 + z) * 0.06;
        quad(px, py, pz, ox, ny, oz, sx, sz, 0.09);
        px = ox;
        py = ny;
        pz = oz;
      }
    };
    for (let i = 0; i < D.length - 1; i++) {
      const a = D[i];
      const b = D[i + 1];
      if (!a || !b) continue;
      const hz = Math.hypot(b.x - a.x, b.z - a.z);
      const dy = b.y - a.y;
      if (Math.abs(dy) <= Math.max(0.45, hz * 1.4)) {
        if (a.on !== 'tree' && b.on !== 'tree') flat(a, b);
        else {
          const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
          m.y = Math.max(terrain.heightAt(m.x, m.z) + 0.03, m.y - Math.min(0.3, Math.hypot(hz, dy) * 0.16));
          flat(a, m);
          flat(m, b);
        }
      } else {
        // an edge: the paper goes over it and hangs down toward the lower side
        const hi = a.y > b.y ? a : b;
        const lo = hi === a ? b : a;
        let ox = lo.x - hi.x;
        let oz = lo.z - hi.z;
        const ol = Math.hypot(ox, oz) || 1;
        ox = (ox / ol) * 0.16;
        oz = (oz / ol) * 0.16;
        const ground = terrain.heightAt(hi.x + ox, hi.z + oz);
        const len = Math.max(0.3, Math.min(hi.y - Math.max(lo.y + 0.25, ground + 0.2), 2.8));
        flat(hi, { x: hi.x + ox, y: hi.y - 0.02, z: hi.z + oz });
        strand(hi.x + ox, hi.y - 0.02, hi.z + oz, len);
      }
    }
    // a few strands left hanging in the branches
    let lastTree = -1;
    for (let i = 0; i < D.length; i++) if (D[i] && D[i].on === 'tree') lastTree = i;
    for (let i = 1; i < D.length; i++) {
      const d = D[i];
      if (!d || d.on !== 'tree' || d.y - d.g < 1.2 || (i % 2 === 0 && i !== lastTree)) continue;
      strand(d.x, d.y - 0.05, d.z, Math.min(d.y - d.g - 0.3, 0.5 + rnd() * 1.3));
    }
    // a roll that snagged in a crown leaves loops over the top and a few streamers hanging
    if (it.on === 'tree' && lastTree >= 0) {
      const d = D[lastTree];
      let t = null;
      let bd = Infinity;
      for (const c of h.trees) {
        const dd = Math.hypot(d.x - c.c.x, d.z - c.c.z);
        if (dd < bd) {
          bd = dd;
          t = c;
        }
      }
      if (t && bd < t.r + 0.5) {
        const onTop = (ang, rad) => {
          const x = t.c.x + Math.cos(ang) * rad;
          const z = t.c.z + Math.sin(ang) * rad;
          const dd = Math.min(t.r * 0.98, Math.hypot(x - t.c.x, z - t.c.z));
          return { x, y: t.c.y + Math.sqrt(t.r * t.r - dd * dd) * 0.85 + 0.03, z, on: 'tree' };
        };
        const a0 = rnd() * TAU;
        let prevTop = { x: d.x, y: d.y, z: d.z, on: 'tree' };
        for (let k = 0; k < 4; k++) {
          const p = onTop(a0 + k * 1.4, t.r * (0.35 + 0.45 * rnd()));
          flat(prevTop, p);
          const g = terrain.heightAt(p.x, p.z);
          strand(p.x, p.y - 0.04, p.z, Math.max(0.3, Math.min(p.y - g - 0.4, 0.7 + rnd() * 1.4)));
          prevTop = p;
        }
      }
    }
    return pos;
  }

  // ------------------------------------------------------------------ build the three meshes
  function render(force) {
    const items = S.V ? collect() : [];
    const homes = new Map();
    const parts = [S.W];
    for (const it of items) {
      parts.push(it.id);
      if (!homes.has(it.targetId)) homes.set(it.targetId, homeCtx(it.targetId));
    }
    for (const [id, h] of homes) {
      const t = S.model && S.model.teams[S.V && S.V.victims ? Number(S.V.victims[id]) : -1];
      parts.push(id + '@' + (h ? h.key : '-') + '#' + (t ? t.color : ''));
    }
    const sig = parts.join('|');
    if (!force && sig === shown.sig) return;
    shown.sig = sig;
    shown.counts = new Map();

    const nextCache = new Map();
    const paperPos = [];
    const tagList = [];
    let ns = 0;
    for (const it of items) {
      const h = homes.get(it.targetId);
      if (!h) continue;
      const counts = shown.counts.get(it.targetId) || { egg: 0, tp: 0, tag: 0 };
      if (it.kind === 'tp') {
        const key = it.id + '|' + h.key;
        let pos = drapeCache.get(key);
        if (pos === undefined) {
          pos = drape(it, h);
          drapeLog.push(lastDrape);
          if (drapeLog.length > 12) drapeLog.shift();
        }
        nextCache.set(key, pos);
        if (pos && pos.length && it.on !== 'miss') {
          for (const x of pos) paperPos.push(x);
          counts.tp++;
        }
      } else {
        const at = placePoint(it, h);
        if (!at) {
          shown.counts.set(it.targetId, counts);
          continue;
        }
        if (it.kind === 'egg' && ns < MAX_SPLATS) {
          const r = mulberry32(hashStr(it.id));
          const size = at.on === 'ground' ? 0.9 + r() * 0.25 : at.on === 'tree' ? 0.7 + r() * 0.15 : 0.78 + r() * 0.2;
          const spin = at.on === 'ground' ? r() * TAU : (r() - 0.5) * 0.7;
          splatMatrix(at.p, at.n, size, spin, m4);
          splats.setMatrixAt(ns, m4);
          const k = 0.9 + r() * 0.1;
          col.setRGB(k, k * (0.97 + r() * 0.03), k * (0.9 + r() * 0.08));
          splats.setColorAt(ns, col);
          ns++;
          counts.egg++;
        } else if (it.kind === 'tag' && tagList.length < MAX_TAGS) {
          const text = tagText(it.attackerId, it.tagId);
          const team = S.model && S.model.teams[it.attackerId];
          if (text && Math.abs(at.n.y) < 0.6) {
            tagList.push({ it, at, text, color: team ? team.color : 0xd7263d, scale: tagFit(at, h) });
            counts.tag++;
          }
        }
      }
      shown.counts.set(it.targetId, counts);
    }
    drapeCache = nextCache;

    splats.count = ns;
    splats.visible = ns > 0;
    splats.instanceMatrix.needsUpdate = true;
    if (splats.instanceColor) splats.instanceColor.needsUpdate = true;
    if (ns > 0 && typeof splats.computeBoundingSphere === 'function') splats.computeBoundingSphere();

    // tags: redraw the atlas only when the set changes
    const atlasSig = tagList.map((x) => x.it.id + ':' + x.text + ':' + x.color).join('|');
    if (atlasSig !== shown.atlas) {
      shown.atlas = atlasSig;
      const g = tagCanvas.getContext('2d');
      g.clearRect(0, 0, 1024, 512);
      tagList.forEach((x, i) => drawTag(g, (i % 2) * 512, Math.floor(i / 2) * 128, 512, 128, x.text, x.color, hashStr(x.it.id)));
      tagTex.needsUpdate = true;
    }
    const tp = [];
    const tuv = [];
    tagList.forEach((x, i) => {
      const n = x.at.n;
      const right = v1.crossVectors(UP, n);
      if (right.lengthSq() < 0.01) right.set(1, 0, 0);
      right.normalize();
      const up = v2.crossVectors(n, right).normalize();
      const c = v3.copy(x.at.p).addScaledVector(n, 0.1); // paint goes over the window frames too
      const hw = (TAG_W / 2) * (x.scale || 1);
      const hh = (TAG_W / 8) * (x.scale || 1);
      const corner = (sx, sy) => [c.x + right.x * hw * sx + up.x * hh * sy, c.y + right.y * hw * sx + up.y * hh * sy, c.z + right.z * hw * sx + up.z * hh * sy];
      const A = corner(-1, -1);
      const B = corner(1, -1);
      const C = corner(1, 1);
      const D = corner(-1, 1);
      tp.push(...A, ...B, ...C, ...A, ...C, ...D);
      const u0 = ((i % 2) * 512 + 2) / 1024;
      const u1 = ((i % 2) * 512 + 510) / 1024;
      const v1t = 1 - (Math.floor(i / 2) * 128 + 2) / 512;
      const v0t = 1 - (Math.floor(i / 2) * 128 + 126) / 512;
      tuv.push(u0, v0t, u1, v0t, u1, v1t, u0, v0t, u1, v1t, u0, v1t);
    });
    tags.geometry.dispose();
    const tg = new THREE.BufferGeometry();
    if (tp.length) {
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tp), 3));
      tg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tuv), 2));
      tg.computeVertexNormals();
      tg.computeBoundingSphere();
    }
    tags.geometry = tg;
    tags.visible = tp.length > 0;

    paper.geometry.dispose();
    const pg = new THREE.BufferGeometry();
    if (paperPos.length) {
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(paperPos), 3));
      const cc = new Float32Array(paperPos.length);
      for (let i = 0; i < cc.length; i += 18) {
        const k = 0.93 + ((i / 18) % 5) * 0.012;
        for (let j = 0; j < 18; j += 3) {
          cc[i + j] = k;
          cc[i + j + 1] = k;
          cc[i + j + 2] = k * 0.97;
        }
      }
      pg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      pg.computeVertexNormals();
      pg.computeBoundingSphere();
    }
    paper.geometry = pg;
    paper.visible = paperPos.length > 0;
  }

  // How big a tag can be at this spot: both ends need the wall behind them (tents, porches).
  function tagFit(at, h) {
    const n = at.n;
    const right = new THREE.Vector3().crossVectors(UP, n);
    if (right.lengthSq() < 0.01) return 1;
    right.normalize();
    const probe = (dx) => {
      ray.set(v1.copy(at.p).addScaledVector(right, dx).addScaledVector(n, 0.5), v2.copy(n).negate());
      ray.near = 0;
      ray.far = 0.95;
      return !!ray.intersectObjects(h.meshes, false)[0];
    };
    for (const s of [1, 0.8, 0.62, 0.48]) {
      const hw = (TAG_W / 2) * s * 0.92;
      if (probe(hw) && probe(-hw)) return s;
    }
    return 0.4;
  }

  function splatMatrix(p, n, size, spin, out) {
    const x = v1.crossVectors(UP, n);
    if (x.lengthSq() < 0.01) x.set(1, 0, 0);
    x.normalize();
    const y = v2.crossVectors(n, x).normalize();
    if (spin) {
      const c = Math.cos(spin);
      const s = Math.sin(spin);
      const xx = v3.copy(x).multiplyScalar(c).addScaledVector(y, s);
      y.multiplyScalar(c).addScaledVector(x, -s);
      x.copy(xx);
    }
    out.makeBasis(x, y, n);
    out.scale(v3.set(size, size, size));
    // the yolk sits a little above the middle of the picture: put it where the egg hit
    out.setPosition(p.x + n.x * 0.025 - y.x * size * 0.14, p.y + n.y * 0.025 - y.y * size * 0.14, p.z + n.z * 0.025 - y.z * size * 0.14);
    return out;
  }

  // ------------------------------------------------------------------ the visitor's own right
  function spotFor(e) {
    const A = e.home.anchors || {};
    const F = frameOf(e.lot);
    const door = A.door || new THREE.Vector3(0, 0, e.lot.d / 4);
    const curb = A.curb || new THREE.Vector3(0, 0, e.lot.d / 2);
    const lz = Math.min(door.z + 7.5, curb.z + 1.5);
    const p = new THREE.Vector3();
    for (const dx of [0, 1.2, -1.2, 2.4, -2.4, 3.6, -3.6]) {
      F.toWorld([dx, 0, lz], p);
      if (!colliders.hits(p.x, p.z, 0.45)) break;
    }
    const house = F.toWorld([0, 0, door.z - 1.2], new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(e.home.group);
    const tall = Math.max(2, box.max.y - e.lot.y);
    const look = F.toWorld([0, Math.max(1.3, Math.min(4.2, tall * 0.42)), door.z - 0.6], new THREE.Vector3());
    const wide = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    return { x: p.x, y: terrain.heightAt(p.x, p.z), z: p.z, facing: Math.atan2(house.x - p.x, house.z - p.z), look, wide };
  }

  function refreshRight() {
    S.me = w.playerTeam === null || w.playerTeam === undefined ? null : Number(w.playerTeam);
    S.right = rightOf(S.me);
    const h = S.right ? homeCtx(S.right.targetId) : null;
    S.target = h ? h.e : null;
    S.spot = h ? spotFor(h.e) : null;
    interact.unregister('vandal');
    if (!S.right || !S.spot) {
      if (S.active) leave();
      return;
    }
    interact.register({
      id: 'vandal', position: new THREE.Vector3(S.spot.x, S.spot.y, S.spot.z), radius: 2.8, label: lines().label || 'Settle the score', priority: 3,
      tappable: false, onUse: start,
    });
  }

  // ------------------------------------------------------------------ overlay (ours, under one root)
  const root = el('div', 'lw-vandal');
  root.hidden = true;
  const oLine = el('div', 'lw-vandal-line');
  oLine.setAttribute('role', 'status');
  const oSheet = el('div', 'lw-vandal-sheet');
  oSheet.hidden = true;
  const oMeter = el('div', 'lw-vandal-meter');
  const oFill = el('i');
  oMeter.appendChild(oFill);
  oMeter.hidden = true;
  const oChips = el('div', 'lw-vandal-chips');
  const chips = {};
  for (const k of KINDS) {
    const b = el('button', 'lw-vandal-chip');
    b.type = 'button';
    b.dataset.kind = k;
    const n = el('span', 'lw-vandal-chip-n', '0');
    b.append(el('span', 'lw-vandal-chip-name', NAMES[k]), n);
    oChips.appendChild(b);
    chips[k] = { b, n };
    tap(b, () => select(k));
  }
  const oLeave = el('button', 'lw-vandal-leave', 'Tap to leave');
  oLeave.type = 'button';
  root.append(oLine, oSheet, oMeter, oChips, oLeave);
  hud.el.appendChild(root);
  tap(oLeave, () => leave());

  const byTouch = () => input.usingTouch || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  function hint() {
    const touch = byTouch();
    if (S.item === 'tag') {
      if (remaining('tag') <= 0) return 'Out of paint.';
      if (S.sheet || !S.tagId) return 'Pick a tag.';
      return (touch ? 'Tap' : 'Click') + ' a wall of the house to spray ' + (tagText(S.me, S.tagId) || 'it') + '.';
    }
    if (remaining(S.item) <= 0) return S.item === 'egg' ? 'Out of eggs.' : 'Out of rolls.';
    if (S.item === 'tp') return touch ? 'Swipe up to lob a roll over the roof.' : 'Hold Space, let go to lob a roll. Arrows aim.';
    return touch ? 'Swipe up to throw. Faster is farther.' : 'Hold Space, let go to throw. Arrows aim.';
  }
  function hudText() {
    for (const k of KINDS) {
      const n = remaining(k);
      chips[k].n.textContent = String(n);
      chips[k].b.classList.toggle('lw-off', n <= 0);
      chips[k].b.setAttribute('aria-pressed', S.item === k ? 'true' : 'false');
      chips[k].b.setAttribute('aria-label', NAMES[k] + ', ' + n + ' left');
    }
    oLeave.textContent = byTouch() ? 'Tap to leave' : 'Esc to leave';
    if (performance.now() >= S.startUntil) oLine.textContent = hint();
    oLine.hidden = S.sheet || S.charging;
  }

  function openSheet() {
    oSheet.replaceChildren();
    const r = S.right;
    const all = (S.V.tags || []).concat(r && Array.isArray(r.tags) ? r.tags : []);
    for (const t of all) {
      if (!t || typeof t.id !== 'string' || typeof t.text !== 'string') continue;
      const b = el('button', 'lw-vandal-tag', t.text);
      b.type = 'button';
      if (S.tagId === t.id) b.setAttribute('aria-pressed', 'true');
      tap(b, () => {
        S.tagId = t.id;
        S.sheet = false;
        oSheet.hidden = true;
        S.startUntil = 0;
        hudText();
      });
      oSheet.appendChild(b);
    }
    S.sheet = true;
    oSheet.hidden = false;
    S.startUntil = 0;
    hudText();
  }

  function select(kind) {
    if (!S.active) return;
    if (remaining(kind) <= 0) say('empty');
    S.item = kind;
    S.charging = false;
    oMeter.hidden = true;
    aimLine.visible = false;
    if (kind === 'tag' && remaining('tag') > 0) openSheet();
    else {
      S.sheet = false;
      oSheet.hidden = true;
    }
    S.startUntil = 0;
    hudText();
  }

  function say(kind, force) {
    const L = lines();
    const leader = S.model && S.model.regime ? Number(S.model.regime.teamId) : null;
    const res = S.right && leader !== null && Number(S.right.targetId) === leader && L.residence && Array.isArray(L.residence[kind]) && L.residence[kind].length;
    const list = res ? L.residence[kind] : L[kind];
    if (!Array.isArray(list) || !list.length) return;
    const now = performance.now();
    if (!force && now - S.lastSay < 2000) return;
    let pool = list.filter((x) => typeof x === 'string' && x !== S.lastLine);
    if (!pool.length) pool = list.filter((x) => typeof x === 'string');
    if (!pool.length) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    S.lastSay = now;
    S.lastLine = line;
    hud.toast(line, { ms: 2800 });
  }

  // ------------------------------------------------------------------ throwing
  const dirOf = (yaw, out) => {
    const f = S.spot.facing;
    out.set(Math.sin(f), 0, Math.cos(f));
    const rx = -out.z;
    const rz = out.x;
    return out.set(out.x * Math.cos(yaw) + rx * Math.sin(yaw), 0, out.z * Math.cos(yaw) + rz * Math.sin(yaw));
  };

  function blockers() {
    const out = [];
    for (const e of w.town.entries()) {
      if (!e || !e.home || (S.target && e.team.id === S.target.team.id)) continue;
      out.push(new THREE.Box3().setFromObject(e.home.group));
    }
    return out;
  }

  function doThrow(power, yaw) {
    if (!S.active || !S.right || (S.item !== 'egg' && S.item !== 'tp')) return false;
    const kind = S.item;
    if (remaining(kind) <= 0) {
      say('empty');
      return false;
    }
    if (kind === 'tp' && S.inFlight.tp > 0) return false;
    if (kind === 'egg' && S.inFlight.egg >= eggs.length) return false;
    const h = homeCtx(S.right.targetId);
    if (!h) return false;
    power = Math.max(0, Math.min(1, power));
    yaw = Math.max(-0.5, Math.min(0.5, yaw));
    const [v0, v1s] = SPEED[kind];
    const v = v0 + (v1s - v0) * power;
    const d = dirOf(yaw, new THREE.Vector3());
    const right = new THREE.Vector3(-d.z, 0, d.x);
    const pos = new THREE.Vector3(S.spot.x, S.spot.y + 1.45, S.spot.z).addScaledVector(d, 0.35).addScaledVector(right, 0.22);
    const vel = d.clone().multiplyScalar(v * Math.cos(LOFT[kind])).addScaledVector(UP, v * Math.sin(LOFT[kind]));
    const mesh = kind === 'egg' ? eggs.find((m) => !m.visible) : roll;
    const pr = {
      kind, pos, vel, t: 0, alive: true, mesh, h, bounces: 0, path: [pos.clone()], side: right,
      ignore: h.trees.filter((t) => t.c.distanceTo(pos) < t.r + 0.2),
      block: S.blockers || (S.blockers = blockers()),
      week: S.W, attackerId: S.me, targetId: Number(S.right.targetId), tier: h.e.team.tier,
    };
    mesh.position.copy(pos);
    mesh.visible = true;
    projectiles.push(pr);
    dbg.thrown++;
    S.inFlight[kind]++;
    S.used++;
    S.startUntil = 0;
    S.throwAnim = 0.5;
    if (player.avatar && player.avatar.setAnim) player.avatar.setAnim('cheer');
    if (kind === 'tp') audio.sfx('tp', { volume: 0.7 });
    else audio.sfx('whoosh', { volume: 0.25 });
    hudText();
    return true;
  }

  function raySphere(o, d, len, t, grow = 1) {
    const r = t.r * grow;
    const ox = o.x - t.c.x;
    const oy = o.y - t.c.y;
    const oz = o.z - t.c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - r * r;
    if (c < 0) return 0;
    const disc = b * b - c;
    if (disc < 0) return Infinity;
    const s = -b - Math.sqrt(disc);
    return s >= 0 && s <= len ? s : Infinity;
  }

  const prev = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const boxHit = new THREE.Vector3();
  function step(pr, dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const hstep = dt / n;
    for (let i = 0; i < n && pr.alive; i++) {
      prev.copy(pr.pos);
      pr.vel.y -= G * hstep;
      if (pr.kind === 'tp') pr.vel.multiplyScalar(1 - 0.1 * hstep);
      pr.pos.addScaledVector(pr.vel, hstep);
      pr.t += hstep;
      seg.subVectors(pr.pos, prev);
      const len = seg.length();
      if (len < 1e-6) continue;
      seg.divideScalar(len);
      ray.set(prev, seg);
      ray.near = 0;
      ray.far = len;
      // somebody else's house is in the way: the egg breaks there and nothing sticks
      let blockD = Infinity;
      for (const b of pr.block) {
        if (ray.ray.intersectBox(b, boxHit)) {
          const d = boxHit.distanceTo(prev);
          if (d <= len && d < blockD) blockD = d;
        }
      }
      const hit = ray.intersectObjects(pr.h.meshes, false)[0];
      let treeD = Infinity;
      let tree = null;
      for (const t of pr.h.trees) {
        if (pr.ignore.includes(t)) continue;
        const d = raySphere(prev, seg, len, t, pr.kind === 'tp' ? 1.15 : 1);
        if (d < treeD) {
          treeD = d;
          tree = t;
        }
      }
      const homeD = hit ? hit.distance : Infinity;
      const gy = terrain.heightAt(pr.pos.x, pr.pos.z);
      const groundD = pr.pos.y <= gy ? len : Infinity;
      const best = Math.min(blockD, homeD, treeD, groundD);
      if (pr.kind === 'tp' && pr.path.length) {
        const lastP = pr.path[pr.path.length - 1];
        if (lastP.distanceTo(pr.pos) > 0.35) pr.path.push(pr.pos.clone());
        if (pr.path.length > 60) pr.path.splice(1, 1);
      }
      if (best === Infinity) {
        if (pr.t > 4 || pr.pos.distanceTo(v1.set(S.spot ? S.spot.x : pr.pos.x, pr.pos.y, S.spot ? S.spot.z : pr.pos.z)) > 45) land(pr, 'miss', pr.pos, null);
        continue;
      }
      if (best === blockD) {
        land(pr, 'miss', v1.copy(prev).addScaledVector(seg, blockD), null);
      } else if (best === homeD) {
        worldNormal(hit, nrm);
        if (pr.kind === 'tp' && nrm.y > 0.45 && pr.bounces < 3 && pr.vel.length() > 1.6) {
          // a roll on a roof keeps rolling: up, over and off the far side, unspooling as it goes
          pr.bounces++;
          pr.pos.copy(hit.point).addScaledVector(nrm, 0.06);
          const vn = pr.vel.dot(nrm);
          pr.vel.addScaledVector(nrm, -1.3 * vn).multiplyScalar(0.62);
          continue;
        }
        const yard = nrm.y > 0.85 && hit.point.y < pr.h.e.lot.y + 0.35;
        land(pr, yard ? 'ground' : 'home', hit.point, yard ? UP : nrm);
      } else if (best === treeD) {
        const p = v1.copy(prev).addScaledVector(seg, treeD);
        nrm.subVectors(p, tree.c).normalize();
        // eggs break on the outside of the crown; a roll snags in it
        if (pr.kind === 'egg') p.copy(tree.c).addScaledVector(nrm, tree.r);
        else pr.path.push(p.clone());
        land(pr, 'tree', p, nrm);
      } else {
        const p = v1.set(pr.pos.x, gy, pr.pos.z);
        land(pr, pr.h.F.inside(p.x, p.z, LOT_PAD) ? 'ground' : 'miss', p, UP);
      }
    }
    if (pr.alive && pr.mesh) {
      pr.mesh.position.copy(pr.pos);
      if (pr.kind === 'tp') pr.mesh.rotation.set(pr.t * 9, pr.t * 2.5, 0);
      else pr.mesh.rotation.set(pr.t * 11, 0, pr.t * 4);
    }
  }

  function land(pr, on, point, normal) {
    pr.alive = false;
    dbg.landed++;
    dbg.last = (dbg.last + ' ' + on).slice(-120);
    if (pr.mesh) pr.mesh.visible = false;
    S.inFlight[pr.kind] = Math.max(0, S.inFlight[pr.kind] - 1);
    const h = homeCtx(pr.targetId) || pr.h;
    const F = h.F;
    const it = {
      id: newId(), week: pr.week, attackerId: pr.attackerId, targetId: pr.targetId, kind: pr.kind, tier: pr.tier, on,
      p: F.toLocal(point), n: normal ? F.dirToLocal(normal) : [0, 1, 0], at: Date.now(),
    };
    if (pr.kind === 'tp') {
      const path = pr.path.concat([point.clone()]);
      const inside = path.filter((q) => F.inside(q.x, q.z, NEAR));
      if (inside.length < 2) it.on = 'miss';
      // up to 24 points along the flight, ending where it came down
      const keep = [];
      const n = Math.min(24, path.length);
      for (let i = 0; i < n; i++) keep.push(F.toLocal(path[Math.round((i / Math.max(1, n - 1)) * (path.length - 1))]));
      it.pts = keep;
      if (it.on === 'miss') say('eggMiss');
      else if (on === 'tree' && lines().tpTree) say('tpTree');
      else if (on === 'ground' && lines().tpGround) say('tpGround');
      else say('tp');
      audio.sfx('pop', { volume: 0.25 });
    } else {
      audio.sfx('splat', { volume: on === 'miss' ? 0.35 : 0.8 });
      say(on === 'home' ? 'egg' : on === 'tree' && lines().eggTree ? 'eggTree' : on === 'tree' ? 'egg' : 'eggMiss');
    }
    if ((on === 'home' || on === 'tree') && w.residents && typeof w.residents.react === 'function' && S.spot) w.residents.react(pr.targetId, S.spot.x, S.spot.z, 3.5);
    save(it);
  }

  function save(it) {
    const c = cleanVandalItem(it);
    if (!c) {
      dbg.rejected++;
      dbg.last = ('rejected ' + it.kind + ' ' + it.on).slice(0, 120);
      return;
    }
    dbg.saved++;
    pending.push(c);
    if (vstore) {
      try {
        vstore.add(c).catch(() => {});
      } catch (err) { /* the store is optional */ }
    }
    render();
    if (S.active) hudText();
  }

  // Paint: the tap must land on a wall of the target house.
  function sprayAt(clientX, clientY) {
    if (!S.active || S.item !== 'tag' || !S.tagId || !S.right) return;
    if (remaining('tag') <= 0) {
      say('empty');
      return;
    }
    const h = homeCtx(S.right.targetId);
    if (!h) return;
    const cv = w.engine.renderer.domElement;
    const rect = cv.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, w.camera3D);
    ray.near = 0;
    ray.far = 45;
    const hit = ray.intersectObjects(h.meshes, false)[0];
    if (!hit) {
      oLine.textContent = 'That is not their house. Tap a wall of it.';
      S.startUntil = performance.now() + 1800;
      return;
    }
    const n = worldNormal(hit, new THREE.Vector3());
    if (Math.abs(n.y) > 0.45) {
      const low = hit.point.y - terrain.heightAt(hit.point.x, hit.point.z) < 1.2;
      oLine.textContent = low ? 'Tap a wall, not the yard.' : 'Tap a wall, not the roof.';
      S.startUntil = performance.now() + 1800;
      return;
    }
    n.y = 0;
    n.normalize();
    const p = hit.point.clone();
    const ground = terrain.heightAt(p.x, p.z);
    if (p.y < ground + 0.55) p.y = ground + 0.55;
    // keep the whole tag under the eaves
    ray.set(v1.copy(p).addScaledVector(n, 0.08), UP);
    ray.far = 0.45;
    const eave = ray.intersectObjects(h.meshes, false)[0];
    if (eave) p.y = Math.max(ground + 0.45, eave.point.y - 0.42);
    const F = h.F;
    const it = {
      id: newId(), week: S.W, attackerId: S.me, targetId: Number(S.right.targetId), kind: 'tag', tier: h.e.team.tier, on: 'home',
      p: F.toLocal(p), n: F.dirToLocal(n), tagId: S.tagId, at: Date.now(),
    };
    S.used++;
    S.startUntil = 0;
    audio.sfx('spray', { volume: 0.8 });
    say('tag');
    if (w.residents && typeof w.residents.react === 'function' && S.spot) w.residents.react(it.targetId, S.spot.x, S.spot.z, 3.5);
    save(it);
    S.tagId = null;
    if (remaining('egg') > 0) S.item = 'egg';
    else if (remaining('tp') > 0) S.item = 'tp';
    hudText();
  }

  // ------------------------------------------------------------------ input while the mode is on
  const canvas = w.engine.renderer.domElement;
  const sw = { id: null, x: 0, y: 0, t: 0, trail: [], onCanvas: false };
  function onDown(e) {
    if (!S.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (sw.id !== null) return; // one finger at a time: extra fingers are ignored
    sw.id = e.pointerId;
    sw.x = e.clientX;
    sw.y = e.clientY;
    sw.t = performance.now();
    sw.trail = [[sw.x, sw.y, sw.t]];
    sw.onCanvas = e.target === canvas;
  }
  function onMove(e) {
    if (e.pointerId !== sw.id) return;
    sw.trail.push([e.clientX, e.clientY, performance.now()]);
    if (sw.trail.length > 24) sw.trail.shift();
  }
  function onCancel(e) {
    if (e.pointerId === sw.id) sw.id = null;
  }
  function onUp(e) {
    if (!S.active || e.pointerId !== sw.id) return;
    sw.id = null;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    const ms = Math.max(40, performance.now() - sw.t);
    const H = window.innerHeight || 640;
    if (S.item === 'tag') {
      if (sw.onCanvas && Math.hypot(dx, dy) < 16 && ms < 700) sprayAt(e.clientX, e.clientY);
      return;
    }
    if (-dy < H * 0.05 || ms > 1400) return; // not an upward swipe
    // power from how fast the finger was going as it let go, aim from the whole stroke (as the kicks)
    const now = performance.now();
    let from = sw.trail[0];
    for (const p of sw.trail) {
      if (now - p[2] <= 130) break;
      from = p;
    }
    const span = Math.max(30, now - from[2]);
    const flick = (Math.hypot(e.clientX - from[0], e.clientY - from[1]) / span) * 1000 / H;
    const whole = (Math.hypot(dx, dy) / ms) * 1000 / H;
    dbg.swipes++;
    dbg.last = 'p' + ((Math.max(flick, whole) - 0.4) / 2.9).toFixed(2) + ' y' + (Math.atan2(dx, -dy) * 0.62).toFixed(2);
    doThrow(wobble((Math.max(flick, whole) - 0.4) / 2.9, 0.025), wobble(Math.atan2(dx, -dy) * 0.62, 0.035));
  }
  function wobble(v, amount) {
    return v + (Math.random() * 2 - 1) * amount;
  }
  function onKeyDown(e) {
    if (!S.active) return;
    if (e.code === 'Escape') {
      leave();
      return;
    }
    if (e.code === 'Digit1' || e.code === 'Numpad1') select('egg');
    else if (e.code === 'Digit2' || e.code === 'Numpad2') select('tp');
    else if (e.code === 'Digit3' || e.code === 'Numpad3') select('tag');
    else if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat || S.item === 'tag') return;
      if (remaining(S.item) <= 0) {
        say('empty');
        return;
      }
      S.charging = true;
      S.charge = 0;
      S.chargeDir = 1;
      oMeter.hidden = false;
      oLine.hidden = true;
      aimLine.visible = true;
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      if (S.item === 'tag') return;
      S.aim = Math.max(-0.45, Math.min(0.45, S.aim + (e.code === 'ArrowLeft' ? -0.03 : 0.03)));
      aimLine.visible = true;
    }
  }
  function onKeyUp(e) {
    if (!S.active || e.code !== 'Space' || !S.charging) return;
    S.charging = false;
    oMeter.hidden = true;
    oLine.hidden = S.sheet;
    doThrow(wobble(0.12 + 0.88 * S.charge, 0.02), wobble(S.aim, 0.03));
  }

  // ------------------------------------------------------------------ start and leave
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camWant = new THREE.Vector3();
  const lookWant = new THREE.Vector3();
  let camReady = false;

  // Things the mode's camera must not end up behind: everything solid in the scene, minus
  // people, decals, glows and particles. Built when the mode starts.
  function solids() {
    const out = [];
    const skip = new Set([group]);
    scene.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isSprite) return;
      for (let a = o; a; a = a.parent) {
        if (!a.visible || skip.has(a)) return;
      }
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && (m.transparent || m.depthWrite === false)) return;
      out.push(o);
    });
    return out;
  }
  function clear(list, a, b, slack) {
    const d = v2.copy(b).sub(a);
    const len = d.length();
    if (len < 0.05) return true;
    ray.set(a, d.normalize());
    ray.near = 0.15;
    ray.far = Math.max(0.2, len - (slack || 0));
    return !ray.intersectObjects(list, false).length;
  }
  // Behind the shoulder, then higher, then closer: the first spot that can see the thrower and the house.
  function cameraFor(sp, portrait) {
    const extra = Math.max(0, Math.min(6, ((sp.wide || 10) - 11) * 0.45));
    const base = (portrait ? 5.8 : 4.6) + extra;
    const lift = (portrait ? 2.8 : 2.2) + extra * 0.35;
    const tries = [[base, lift], [base, lift + 1.6], [base * 0.75, lift + 1.2], [base * 0.55, lift + 1.8], [base * 0.4, lift + 2.4], [base, lift + 3.4], [2.2, 3.6]];
    const list = solids();
    const head = new THREE.Vector3(sp.x, sp.y + 1.5, sp.z);
    const fx = Math.sin(sp.facing);
    const fz = Math.cos(sp.facing);
    const at = new THREE.Vector3();
    for (const [back, up] of tries) {
      at.set(sp.x - fx * back - fz * 0.55, sp.y + up, sp.z - fz * back + fx * 0.55);
      at.y = Math.max(at.y, terrain.heightAt(at.x, at.z) + 1.4);
      const toHouse = v3.copy(sp.look);
      if (clear(list, head, at, 0.1) && clear(list.filter((o) => !S.target || !isOf(o, S.target.home.group)), at, toHouse, 1.2)) return { back, up };
    }
    return { back: 2.2, up: 3.6 };
  }
  function isOf(o, root) {
    for (let a = o; a; a = a.parent) if (a === root) return true;
    return false;
  }

  function start() {
    if (S.active || !S.right || !S.spot || player.seated || rig.isCinematic) return false;
    refreshRight();
    if (!S.right || !S.spot) return false;
    if (remaining('egg') + remaining('tp') + remaining('tag') <= 0) {
      say('empty', true);
      return false;
    }
    S.active = true;
    S.seat = S.spot; // where the visitor actually sits, even if a refresh moves the target
    S.release = w.freezePlayer();
    S.hadTags = !!w.hideTags;
    w.hideTags = true; // the floating name tag sits right where the eggs go
    S.blockers = null;
    S.used = 0;
    S.aim = 0;
    S.charging = false;
    S.sheet = false;
    S.tagId = null;
    S.item = remaining('egg') > 0 ? 'egg' : remaining('tp') > 0 ? 'tp' : remaining('tag') > 0 ? 'tag' : 'egg';
    camReady = false;
    const sp = S.spot;
    player.sit(sp.x, sp.y, sp.z, sp.facing, () => leave(), 'idle');
    root.hidden = false;
    oSheet.hidden = true;
    oMeter.hidden = true;
    const startLine = lines().start && lines().start[S.me];
    oLine.textContent = typeof startLine === 'string' ? startLine : hint();
    S.startUntil = performance.now() + (typeof startLine === 'string' ? 4500 : 0);
    hudText();
    oLine.hidden = false;
    input.setSuspended(true);
    sw.id = null;
    for (const node of [canvas, root]) {
      node.addEventListener('pointerdown', onDown);
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onCancel);
    }
    if (hud.hideHint) hud.hideHint();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    audio.sfx('pop', { volume: 0.5 });
    const portrait = w.camera3D.aspect < 1;
    const cam = cameraFor(sp, portrait);
    rig.play([{
      cut: true, dur: 1e7, ease: 'linear', fov: portrait ? 60 : 48,
      pos: () => {
        const f = sp.facing;
        const fx = Math.sin(f);
        const fz = Math.cos(f);
        const back = cam.back;
        camWant.set(sp.x - fx * back - fz * 0.55, sp.y + cam.up, sp.z - fz * back + fx * 0.55);
        camWant.y = Math.max(camWant.y, terrain.heightAt(camWant.x, camWant.z) + 1.4);
        if (!camReady || calm) camPos.copy(camWant);
        else camPos.lerp(camWant, 0.08);
        return camPos;
      },
      look: () => {
        lookWant.copy(sp.look);
        const pr = projectiles.length ? projectiles[projectiles.length - 1] : null;
        if (pr && pr.alive && !calm) lookWant.lerp(pr.pos, 0.22);
        if (!camReady || calm) camLook.copy(lookWant);
        else camLook.lerp(lookWant, 0.1);
        camReady = true;
        return camLook;
      },
    }], { skippable: false, handoff: calm ? 0.01 : 0.7 }).then(() => leave(true));
    return true;
  }

  function leave(fromOutside) {
    if (!S.active) return;
    S.active = false;
    S.charging = false;
    S.sheet = false;
    root.hidden = true;
    oSheet.hidden = true;
    oMeter.hidden = true;
    aimLine.visible = false;
    for (const node of [canvas, root]) {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
    }
    sw.id = null;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    input.setSuspended(hud.isModalOpen());
    if (player.avatar && player.avatar.setAnim) player.avatar.setAnim('idle');
    const sp = S.seat || S.spot;
    S.seat = null;
    if (player.seated) {
      if (sp) player.stand(sp.x, sp.z, sp.facing);
      else player.stand(player.position.x, player.position.z, player.heading);
    }
    if (fromOutside !== true && rig.isCinematic) rig.skip();
    if (sp) rig.setView({ yaw: sp.facing + Math.PI });
    if (S.release) S.release();
    S.release = null;
    w.hideTags = !!S.hadTags;
    if (fromOutside !== true && S.used > 0 && !hud.isModalOpen()) say('leave', true);
  }

  // Go to the target and start, from anywhere (a card, the map).
  async function enter() {
    refreshRight();
    if (!S.right || !S.spot) return false;
    if (S.active) return true;
    const pp = player.position;
    if (Math.hypot(pp.x - S.spot.x, pp.z - S.spot.z) > 1.5 || player.seated) {
      await w.travelTo({ x: S.spot.x, z: S.spot.z, facing: S.spot.facing });
    }
    return start();
  }

  input.on('escape', () => leave());
  hud.on('modal', (open) => {
    if (open) leave();
  });
  store.on('model', () => leave());
  if (w.engine && typeof w.engine.on === 'function') {
    w.engine.on('visibility', (visible) => {
      if (!visible) leave();
    });
  }
  if (vstore) vstore.on('change', () => render());

  function apply(model) {
    S.model = model || null;
    const V = model && model.vandalism && typeof model.vandalism === 'object' ? model.vandalism : null;
    const W = V ? Number(V.resultWeek) : 0;
    if (!V || !(W > 0)) {
      S.V = null;
      S.W = 0;
    } else {
      S.V = V;
      S.W = W;
    }
    if (vstore && model && model.meta) vstore.setSeason(model.meta.season);
    treeBank = null;
    S.blockers = null;
    refreshRight();
    render();
  }

  let lastTeam;
  let lastAmmoCheck = 0;
  function update(dt) {
    lastAmmoCheck += dt;
    if (lastAmmoCheck > 0.5 && S.spot && !S.active) {
      lastAmmoCheck = 0;
      // only matters near the throw spot: there the action follows what is left to throw
      const pp = player.position;
      if (Math.hypot(pp.x - S.spot.x, pp.z - S.spot.z) < 9) {
        const item = typeof interact.get === 'function' ? interact.get('vandal') : null;
        if (item) item.enabled = remaining('egg') + remaining('tp') + remaining('tag') > 0;
      }
    }
    if (w.playerTeam !== lastTeam) {
      lastTeam = w.playerTeam;
      if (S.active) leave(); // somebody else's grudge now
      refreshRight();
    }
    for (const pr of projectiles) if (pr.alive) step(pr, Math.min(dt, 0.05));
    for (let i = projectiles.length - 1; i >= 0; i--) if (!projectiles[i].alive) projectiles.splice(i, 1);
    // the streamer behind a roll in the air
    const pr = projectiles.find((p) => p.kind === 'tp' && p.alive);
    if (pr) drawStream(pr);
    else if (stream.visible) stream.visible = false;
    if (!S.active) return;
    if (S.throwAnim > 0) {
      S.throwAnim -= dt;
      if (S.throwAnim <= 0 && player.avatar && player.avatar.setAnim) player.avatar.setAnim('idle');
    }
    if (S.charging) {
      S.charge += (S.chargeDir * dt) / 1.05;
      if (S.charge >= 1) {
        S.charge = 1;
        S.chargeDir = -1;
      } else if (S.charge <= 0) {
        S.charge = 0;
        S.chargeDir = 1;
      }
      oFill.style.transform = 'scaleX(' + S.charge.toFixed(3) + ')';
    }
    if (aimLine.visible && S.spot) {
      const d = dirOf(S.aim, v1);
      aimLine.position.set(S.spot.x, S.spot.y + 0.06, S.spot.z);
      aimLine.rotation.set(0, Math.atan2(d.x, d.z), 0);
    }
    if (S.startUntil && performance.now() >= S.startUntil && !S.sheet) {
      S.startUntil = 0;
      oLine.textContent = hint();
    }
  }

  function drawStream(pr) {
    const pos = streamGeo.attributes.position.array;
    const nor = streamGeo.attributes.normal.array;
    const pts = pr.path.concat([pr.pos]);
    const start = Math.max(0, pts.length - STREAM_MAX - 1);
    let k = 0;
    const sx = pr.side.x * (PAPER_W / 2);
    const sz = pr.side.z * (PAPER_W / 2);
    for (let i = start; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const quad = [a.x - sx, a.y, a.z - sz, a.x + sx, a.y, a.z + sz, b.x + sx, b.y, b.z + sz, a.x - sx, a.y, a.z - sz, b.x + sx, b.y, b.z + sz, b.x - sx, b.y, b.z - sz];
      for (let j = 0; j < 18; j++) pos[k * 18 + j] = quad[j];
      for (let j = 0; j < 6; j++) {
        nor[k * 18 + j * 3] = 0;
        nor[k * 18 + j * 3 + 1] = 1;
        nor[k * 18 + j * 3 + 2] = 0;
      }
      k++;
    }
    streamGeo.setDrawRange(0, k * 6);
    streamGeo.attributes.position.needsUpdate = true;
    streamGeo.attributes.normal.needsUpdate = true;
    stream.visible = k > 0;
  }

  return {
    group,
    apply,
    update,
    enter,
    leave: () => leave(),
    start,
    get active() { return S.active; },
    right(teamId) { return rightOf(teamId === undefined ? w.playerTeam : teamId); },
    summary(teamId) {
      if (!S.V) return null;
      render();
      const c = shown.counts.get(Number(teamId));
      if (!c || c.egg + c.tp + c.tag === 0) return null;
      const by = S.V.victims ? Number(S.V.victims[teamId]) : NaN;
      return { egg: c.egg, tp: c.tp, tag: c.tag, by: Number.isFinite(by) ? by : null };
    },
    get place() {
      if (!S.right || !S.spot) return null;
      if (remaining('egg') + remaining('tp') + remaining('tag') <= 0) return null;
      const L = lines();
      return { x: S.spot.x, z: S.spot.z, facing: S.spot.facing, name: L.label || 'Settle the score', blurb: (L.blurb && L.blurb[S.me]) || '' };
    },
    get debug() { return { ...dbg }; },
    get state() {
      return { active: S.active, item: S.item, tagId: S.tagId, sheet: S.sheet, inFlight: { ...S.inFlight }, left: { egg: remaining('egg'), tp: remaining('tp'), tag: remaining('tag') }, week: S.W, flying: projectiles.length };
    },
    // tests: a throw with exact numbers (power 0..1, yaw radians), a spray at a screen point
    _throw(kind, power, yaw) {
      if (kind) S.item = kind;
      return doThrow(power, yaw);
    },
    // what the visitor still has to throw this week (what the chips show)
    left(teamId) {
      if (!S.right || (teamId !== undefined && Number(teamId) !== S.me)) return null;
      return { egg: remaining('egg'), tp: remaining('tp'), tag: remaining('tag') };
    },
    _debugDrapes() { return drapeLog.slice(); },
    // tests: the power and yaw that send a throw through a world point (no drag, so a little long)
    _aim(x, y, z, kind = 'egg') {
      if (!S.spot) return null;
      const f = S.spot.facing;
      const dx = x - S.spot.x;
      const dz = z - S.spot.z;
      const X = Math.hypot(dx, dz);
      let yaw = f - Math.atan2(dx, dz);
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const th = LOFT[kind];
      const den = 2 * Math.cos(th) ** 2 * (1.45 + X * Math.tan(th) - (y - S.spot.y));
      const v = den > 0 ? Math.sqrt((G * X * X) / den) * (kind === 'tp' ? 1.06 : 1) : SPEED[kind][1];
      return { yaw, power: (v - SPEED[kind][0]) / (SPEED[kind][1] - SPEED[kind][0]) };
    },
    _trees() { return S.right ? (homeCtx(S.right.targetId) || { trees: [] }).trees.map((t) => ({ c: t.c.toArray(), r: t.r })) : []; },
    _spray(tagId, x, y) {
      S.item = 'tag';
      S.tagId = tagId;
      sprayAt(x, y);
    },
  };
}
