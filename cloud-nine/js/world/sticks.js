// Spirit sticks: CONTENT's twelve collectibles (js/content/collectibles.js) standing around the
// island where ISLAND's spotFor(where) puts them. Each is a ribboned cheer stick with a bow and a
// gold star that bobs and turns, with a soft glow so it can be spotted from across a lawn. Touch
// one to collect it; main.js does the celebrating (burst, chime, hype line, "Spirit stick 3 of 12!"),
// saves the progress and unlocks the look it gives.
//
//   const sticks = createSpiritSticks({ scene, island, list, found, groundAt, quality })
//       list   SPIRIT_STICKS from js/content/collectibles.js   found: ids already collected
//   sticks.update(dt, t, playerPos) -> the stick just touched ({ id, x, y, z, stick }) or null
//   sticks.collect(id)              hide it (it stays collected)
//   sticks.placed                   [{ id, x, y, z }] where each uncollected one stands
//   sticks.dispose()
//
// Pure helpers (no three.js state, run under node --test):
//   lockedLooks(list, found) -> { [slot]: { [optionId]: { stick, name, hint } } }   what is still locked
//   touching(spot, pos) -> boolean                                                  close enough to collect

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { Geo } from '../art/geo.js';
import { flatMat } from '../art/materials.js';
import { motion } from '../art/util.js';
import { K, star, bow, shade } from '../art/island-kit.js';

const REACH = 1.15; // metres from her feet to the stick, sideways
const REACH_UP = 2.4; // ... and up (a stick on a ledge just above still counts)

const hexOf = (css) => (typeof css === 'string' && /^#[0-9a-f]{6}$/i.test(css) ? parseInt(css.slice(1), 16) : K.pink);

export function lockedLooks(list, found) {
  const have = new Set(Array.isArray(found) ? found : []);
  const out = {};
  for (const s of Array.isArray(list) ? list : []) {
    const u = s && s.unlock;
    if (!u || u.later || have.has(s.id)) continue; // the pet slot locks like any other
    if (typeof u.slot !== 'string' || typeof u.id !== 'string') continue;
    (out[u.slot] = out[u.slot] || {})[u.id] = { stick: s.id, name: s.name, hint: s.hint, label: u.label };
  }
  return out;
}

export function touching(spot, pos) {
  if (!spot || !pos) return false;
  const dy = pos.y - spot.y;
  return Math.hypot(pos.x - spot.x, pos.z - spot.z) <= REACH && dy > -1.2 && dy < REACH_UP;
}

// One stick, about 1.2 m tall, in its own colour with hot-pink and black ribbons.
function stickGeo(color) {
  const g = new Geo();
  g.jit = 0.03;
  // a little sparkly base so it stands up on any ground
  g.cyl(0, 0, 0, 0.26, 0.08, K.white, { seg: 8, top: shade(color, 1.25) });
  g.cyl(0, 0.08, 0, 0.055, 1.0, K.white, { seg: 6 });
  for (let i = 0; i < 5; i++) g.cyl(0, 0.2 + i * 0.17, 0, 0.064, 0.08, i % 2 ? color : i === 2 ? K.black : K.pink, { seg: 6 });
  bow(g, 0, 1.08, 0, 0.36, { color, star: K.black, detail: 'lo' });
  star(g, 0, 1.42, 0, 0.24, 0.1, K.gold, { thick: 0.07, side: 0xffc94c });
  // streamers falling from the bow
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    g.tube([[0, 1.04, 0], [Math.cos(a) * 0.18, 0.8, Math.sin(a) * 0.18], [Math.cos(a) * 0.26, 0.5, Math.sin(a) * 0.26]], 0.022, [K.pink, color, K.rPurple][i], { seg: 3 });
  }
  return g.build();
}

function glowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSpiritSticks({ scene, island, list = [], found = [], groundAt = null, quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'spiritSticks';
  if (scene) scene.add(group);
  const have = new Set(Array.isArray(found) ? found : []);
  const items = [];
  const geos = new Map(); // one geometry per colour

  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s.id !== 'string') continue;
    let spot = null;
    try {
      spot = island && typeof island.spotFor === 'function' ? island.spotFor(s.where) : null;
    } catch (err) {
      spot = null;
    }
    if (!spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.z)) continue;
    // a stick stands where the island keeps its own spirit stick treasure: show ours instead
    if (spot.treasure === 'spiritStick' && island && typeof island.setTreasureVisible === 'function') {
      try {
        island.setTreasureVisible('spiritStick', false);
      } catch (err) { /* both show, no harm */ }
    }
    let y = Number.isFinite(spot.y) ? spot.y : NaN;
    if (!Number.isFinite(y) && groundAt) y = groundAt(spot.x, spot.z);
    if (!Number.isFinite(y)) continue;
    const color = hexOf(PALETTE[s.color] || s.color);
    let geo = geos.get(color);
    if (!geo) {
      geo = stickGeo(color);
      geos.set(color, geo);
    }
    const mesh = new THREE.Mesh(geo, flatMat);
    mesh.name = 'spiritStick:' + s.id;
    mesh.position.set(spot.x, y, spot.z);
    mesh.visible = !have.has(s.id);
    group.add(mesh);
    items.push({ id: s.id, stick: s, x: spot.x, y, z: spot.z, mesh, color, ph: items.length * 1.37, got: have.has(s.id) });
  }

  // all the glows in one additive draw call
  const n = items.length;
  const pos = new Float32Array(Math.max(1, n) * 3);
  const col = new Float32Array(Math.max(1, n) * 3);
  const c3 = new THREE.Color();
  items.forEach((it, i) => {
    pos[i * 3] = it.x;
    pos[i * 3 + 1] = it.got ? -9999 : it.y + 1.1;
    pos[i * 3 + 2] = it.z;
    c3.setHex(shade(it.color, 1.3));
    col[i * 3] = c3.r;
    col[i * 3 + 1] = c3.g;
    col[i * 3 + 2] = c3.b;
  });
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pgeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const tex = glowTexture();
  const pmat = new THREE.PointsMaterial({
    size: quality === 'low' ? 2.2 : 2.6, map: tex, vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: true,
  });
  const glows = new THREE.Points(pgeo, pmat);
  glows.name = 'spiritStickGlows';
  glows.frustumCulled = false;
  glows.renderOrder = 4;
  if (n) group.add(glows);

  function collect(id) {
    const i = items.findIndex((it) => it.id === id);
    if (i < 0) return false;
    const it = items[i];
    it.got = true;
    it.mesh.visible = false;
    pos[i * 3 + 1] = -9999;
    pgeo.attributes.position.needsUpdate = true;
    return true;
  }

  function update(dt, t, playerPos) {
    const m = motion();
    pmat.opacity = 0.62 + 0.25 * Math.sin(t * 2.2) * m;
    let hit = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.got) continue;
      it.mesh.rotation.y = t * 1.1 * (0.25 + 0.75 * m) + it.ph;
      it.mesh.position.y = it.y + 0.06 + Math.sin(t * 2 + it.ph) * 0.08 * m;
      if (!hit && playerPos && touching(it, playerPos)) hit = it;
    }
    return hit ? { id: hit.id, x: hit.x, y: hit.y, z: hit.z, stick: hit.stick } : null;
  }

  return {
    group,
    update,
    collect,
    get placed() {
      return items.filter((it) => !it.got).map((it) => ({ id: it.id, x: it.x, y: it.y, z: it.z }));
    },
    get count() { return items.length; },
    dispose() {
      for (const g of geos.values()) g.dispose();
      geos.clear();
      pgeo.dispose();
      pmat.dispose();
      tex.dispose();
      group.removeFromParent();
    },
  };
}
