// Interactable things in the world. Everything the visitor can "use" registers here, and the HUD
// shows one big action button for whichever is in reach.
//
//   interact.register({ id, position, radius, label, icon?, onUse, priority?, object3D?, enabled? })
//       position: THREE.Vector3 or () => Vector3 (for things that move)
//       object3D: optional mesh/group; tapping it in the 3D view walks over and uses it
//   interact.unregister(id)
//   interact.update(dt)            call once a frame
//   interact.current               the entry in reach, or null
//   interact.use(entry?)           triggers entry.onUse (defaults to the current one)
//   interact.pick(clientX, clientY)  -> entry under a screen point, or null

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
    return out.set(p.x, p.y, p.z);
  }

  function register(def) {
    if (!def || def.id === undefined || def.id === null) throw new Error('interact.register needs an id');
    const item = Object.assign({ radius: 2.5, label: 'Use', icon: null, priority: 0, object3D: null, enabled: true }, def);
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
    if (hud) hud.setAction(item ? { label: item.label, icon: item.icon } : null);
  }

  function findBest() {
    let best = null;
    let bestScore = -Infinity;
    const pp = player.position;
    for (const item of items.values()) {
      if (item.enabled === false) continue;
      posOf(item, v);
      const dx = v.x - pp.x;
      const dz = v.z - pp.z;
      const d = Math.hypot(dx, dz);
      if (d > item.radius || Math.abs(v.y - pp.y) > 6) continue;
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
    const best = player.frozen ? null : findBest();
    if (best !== current) setCurrent(best);
    else if (best && hud && hud.actionLabel !== best.label) hud.setAction({ label: best.label, icon: best.icon });
  }

  function use(item = current) {
    if (!item || item.enabled === false || typeof item.onUse !== 'function') return false;
    try {
      item.onUse(item);
    } catch (err) {
      console.error('[lw] onUse failed for "' + item.id + '"', err);
    }
    return true;
  }

  function ownerOf(object) {
    for (let o = object; o; o = o.parent) {
      if (o.userData && o.userData.interactId !== undefined && items.has(o.userData.interactId)) return items.get(o.userData.interactId);
    }
    return null;
  }

  // Finds the interactable under a screen point: exact raycast against registered objects first,
  // then a forgiving thumb-sized search around their projected positions.
  function pick(clientX, clientY) {
    const el = canvas || document.documentElement;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null;
    let bestD = Infinity;
    for (const item of items.values()) {
      if (item.enabled === false || !item.object3D) continue;
      item.object3D.userData.interactId = item.id;
      hitsBuf.length = 0;
      ray.intersectObject(item.object3D, true, hitsBuf);
      if (hitsBuf.length && hitsBuf[0].distance < bestD) {
        bestD = hitsBuf[0].distance;
        best = ownerOf(hitsBuf[0].object) || item;
      }
    }
    if (best) return best;
    const slop = 46;
    let bestPx = slop;
    for (const item of items.values()) {
      if (item.enabled === false || item.tappable === false) continue;
      posOf(item, v);
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

  // Walk the player to an entry, then use it. Uses it right away when already in reach.
  function walkToAndUse(item) {
    if (!item) return;
    posOf(item, v);
    const pp = player.position;
    const d = Math.hypot(v.x - pp.x, v.z - pp.z);
    if (d <= item.radius) {
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
