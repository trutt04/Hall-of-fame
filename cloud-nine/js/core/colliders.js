// Flat (x, z) collision registry: solid circles and rotated boxes. Movers are circles that get
// pushed out of whatever they overlap, which makes them slide along walls instead of sticking.
//
//   const colliders = createColliders()
//   colliders.addCircle(x, z, r, tag?)                 -> handle
//   colliders.addBox(cx, cz, w, d, rotation?, tag?)    -> handle   (rotation as three.js rotation.y)
//   colliders.remove(handle) / colliders.removeGroup(tag) / colliders.clear()
//   colliders.resolve(point, radius)                   mutates point { x, z }, returns true if it was pushed
//   colliders.hits(x, z, radius)                       -> boolean

export function createColliders() {
  const circles = [];
  const boxes = [];

  function addCircle(x, z, r, tag = null) {
    const c = { kind: 'circle', x, z, r, tag };
    circles.push(c);
    return c;
  }

  function addBox(cx, cz, w, d, rotation = 0, tag = null) {
    const b = {
      kind: 'box', x: cx, z: cz, hw: w / 2, hd: d / 2,
      cos: Math.cos(rotation), sin: Math.sin(rotation),
      rad: Math.hypot(w, d) / 2, tag,
    };
    boxes.push(b);
    return b;
  }

  function remove(handle) {
    const list = handle && handle.kind === 'box' ? boxes : circles;
    const i = list.indexOf(handle);
    if (i >= 0) list.splice(i, 1);
  }

  function removeGroup(tag) {
    for (let i = circles.length - 1; i >= 0; i--) if (circles[i].tag === tag) circles.splice(i, 1);
    for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].tag === tag) boxes.splice(i, 1);
  }

  function pass(p, radius) {
    let pushed = false;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-5) {
        p.x += min;
      } else {
        const k = (min - d) / d;
        p.x += dx * k;
        p.z += dz * k;
      }
      pushed = true;
    }
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const reach = b.rad + radius;
      if (dx * dx + dz * dz >= reach * reach) continue;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      const qx = lx < -b.hw ? -b.hw : lx > b.hw ? b.hw : lx;
      const qz = lz < -b.hd ? -b.hd : lz > b.hd ? b.hd : lz;
      let ox = lx - qx;
      let oz = lz - qz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= radius * radius) continue;
      if (d2 < 1e-10) {
        // center is inside the box: leave through the nearest face
        const px = b.hw - Math.abs(lx);
        const pz = b.hd - Math.abs(lz);
        if (px < pz) {
          ox = (lx < 0 ? -1 : 1) * (px + radius);
          oz = 0;
        } else {
          ox = 0;
          oz = (lz < 0 ? -1 : 1) * (pz + radius);
        }
      } else {
        const d = Math.sqrt(d2);
        const k = (radius - d) / d;
        ox *= k;
        oz *= k;
      }
      p.x += ox * b.cos + oz * b.sin;
      p.z += -ox * b.sin + oz * b.cos;
      pushed = true;
    }
    return pushed;
  }

  function resolve(p, radius) {
    let any = false;
    for (let n = 0; n < 3; n++) {
      if (!pass(p, radius)) break;
      any = true;
    }
    return any;
  }

  // True when a point is inside a box at least `minHalf` wide in both directions (a building, not a fence).
  function insideBox(x, z, minHalf = 1.6) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hw < minHalf || b.hd < minHalf) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz >= b.rad * b.rad) continue;
      if (Math.abs(dx * b.cos - dz * b.sin) <= b.hw && Math.abs(dx * b.sin + dz * b.cos) <= b.hd) return true;
    }
    return false;
  }

  const probe = { x: 0, z: 0 };
  function hits(x, z, radius) {
    probe.x = x;
    probe.z = z;
    return pass(probe, radius);
  }

  return {
    addCircle,
    addBox,
    remove,
    removeGroup,
    resolve,
    hits,
    insideBox,
    clear() {
      circles.length = 0;
      boxes.length = 0;
    },
    get count() {
      return circles.length + boxes.length;
    },
    // read-only views for debug drawing
    circles,
    boxes,
  };
}
