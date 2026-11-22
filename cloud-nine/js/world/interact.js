// Things you can use in the world (Contract 1: world.interact). Ported from League World: whatever
// registers here and is in reach shows up on the HUD's use button; E / Enter / Space (when no jump
// is wanted), the button, or tapping the thing itself uses it. Reach is height-aware, so a thing on
// the ground does not light up for someone standing on a cloud above it.
//
//   interact.register({ id, position, radius, label, onUse, icon?, priority?, object3D?, enabled?, height? })
//       position: THREE.Vector3 / { x, y, z } or () => one (for things that move)
//       height:   how far above or below it you can still use it (default 3 m)
//       object3D: optional mesh or group; tapping it in the 3D view walks over and uses it
//   interact.unregister(id)
//   interact.update(dt)              once a frame
//   interact.current                 the entry in reach, or null
//   interact.use(entry?)             runs entry.onUse (the current one by default) -> boolean
//   interact.pick(clientX, clientY)  the entry under a screen point, or null
//   interact.walkToAndUse(entry)

import * as THREE from '../../lib/three.module.min.js';

export function createInteract({ player, camera, hud = null, canvas = null }) {
  const items = new Map();
  let current = null;
  let clock = 0;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const v = new THREE.Vector3();
  const hitsBuf = [];

  function posOf(item, out) {
    const p = typeof item.position === 'function' ? item.position() : item.position;
    if (!p) return out.set(NaN, NaN, NaN);
    return out.set(Number(p.x), Number(p.y) || 0, Number(p.z));
  }

  function register(def) {
    if (!def || def.id === undefined || def.id === null) throw new Error('interact.register needs an id');
    const item = Object.assign({ radius: 2.5, label: 'Use', icon: null, priority: 0, object3D: null, enabled: true, height: 3 }, def);
    items.set(item.id, item);
    clock = 1; // re-evaluate on the next update
    return item;
  }

  function unregister(id) {
    const item = items.get(id);
    if (!item) return;
    items.delete(id);
    if (current === item) setCurrent(null);
  }

  function setCurrent(item) {
    if (item === current) return;
    current = item;
    if (hud && hud.setAction) hud.setAction(item ? { label: item.label, icon: item.icon } : null);
  }

  function findBest() {
    let best = null;
    let bestScore = -Infinity;
    const pp = player.position;
    for (const item of items.values()) {
      if (item.enabled === false) continue;
      posOf(item, v);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) continue;
      const d = Math.hypot(v.x - pp.x, v.z - pp.z);
      if (d > item.radius || Math.abs(v.y - pp.y) > item.height) continue;
      const score = item.priority * 1000 - d;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  function update(dt) {
    clock += dt;
    if (clock < 0.1) return;
    clock = 0;
    const best = player.frozen || player.controller || player.rescuing ? null : findBest();
    if (best !== current) setCurrent(best);
    else if (best && hud && hud.actionLabel !== undefined && hud.actionLabel !== best.label) hud.setAction({ label: best.label, icon: best.icon });
  }

  function use(item = current) {
    if (!item || item.enabled === false || typeof item.onUse !== 'function') return false;
    try {
      item.onUse(item);
    } catch (err) {
      console.error('[c9] onUse failed for "' + item.id + '"', err);
    }
    return true;
  }

  function ownerOf(object) {
    for (let o = object; o; o = o.parent) {
      if (o.userData && o.userData.interactId !== undefined && items.has(o.userData.interactId)) return items.get(o.userData.interactId);
    }
    return null;
  }

  function pick(clientX, clientY) {
    const node = canvas || document.documentElement;
    const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null;
    let bestD = Infinity;
    for (const item of items.values()) if (item.object3D) item.object3D.userData.interactId = item.id;
    for (const item of items.values()) {
      if (item.enabled === false || !item.object3D) continue;
      hitsBuf.length = 0;
      ray.intersectObject(item.object3D, true, hitsBuf);
      if (!hitsBuf.length) continue;
      const owner = ownerOf(hitsBuf[0].object) || item;
      if (owner.enabled === false) continue;
      const d = hitsBuf[0].distance;
      if (d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && best && owner.priority > best.priority)) {
        bestD = d;
        best = owner;
      }
    }
    if (best) return best;
    const slop = 46;
    let bestPx = slop;
    for (const item of items.values()) {
      if (item.enabled === false || item.tappable === false) continue;
      posOf(item, v);
      if (!Number.isFinite(v.x)) continue;
      const dist = v.distanceTo(camera.position);
      if (dist > 70) continue;
      v.y += 1;
      v.project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const px = Math.hypot(sx - clientX, sy - clientY);
      if (px < bestPx) {
        bestPx = px;
        best = item;
      }
    }
    return best;
  }

  function walkToAndUse(item) {
    if (!item) return;
    posOf(item, v);
    const pp = player.position;
    const d = Math.hypot(v.x - pp.x, v.z - pp.z);
    if (d <= item.radius && Math.abs(v.y - pp.y) <= item.height) {
      use(item);
      return;
    }
    player.walkTo(v.x, v.z, { stop: Math.max(1.1, item.radius * 0.75), marker: true, onArrive: () => use(item) });
  }

  return {
    register,
    unregister,
    update,
    use,
    pick,
    walkToAndUse,
    get(id) { return items.get(id) || null; },
    list() { return [...items.values()]; },
    positionOf(item, out = new THREE.Vector3()) { return posOf(item, out); },
    get current() { return current; },
    get count() { return items.size; },
  };
}
