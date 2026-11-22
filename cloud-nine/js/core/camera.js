// Third-person follow camera plus a small cinematic sequencer. Copied from League World unchanged
// apart from log prefixes. In Cloud Nine `terrain` is { heightAt(x, z) } built from world.groundAt
// with open sky clamped to a floor, so the camera never sees -Infinity.
//
//   const rig = createCameraRig({ camera, engine, terrain, input })
//   rig.setFollow({ position: Vector3, heading: number, speed: number })
//   rig.update(dt, t)
//   rig.yaw / rig.pitch / rig.distance        orbit state (yaw 0 = camera south of the target, looking north)
//   rig.snapBehind(heading)                   jump behind the target (after a teleport)
//   rig.play(shots, { skippable })            -> Promise<'done' | 'skipped'>
//   rig.flyAlong(points, { dur, lookAhead, height, onProgress })   -> Promise<'done' | 'skipped'>
//                                             over open sky (terrain.isSky(x, z)) it holds the last ground height
//   rig.skip()
//
// A shot is { pos, look, fov?, dur, ease?, cut?, onStart? }. pos and look are [x, y, z] (the camera
// eases there from wherever the previous shot left it; cut: true jumps) or functions
// (u, seconds) -> [x, y, z] that drive the camera directly, u being eased progress 0..1.

import * as THREE from '../../lib/three.module.min.js';
import { clamp, lerp, damp, smoothDamp, angleDelta, ease as EASE } from './util.js';

const SENS_TOUCH = 0.0052;
const SENS_MOUSE = 0.0042;
const MIN_PITCH = -0.12;
const MAX_PITCH = 1.2;
const MIN_DIST = 3.6;
const MAX_DIST = 26;
const RECENTER_AFTER = 3.5;

export function createCameraRig({ camera, engine, terrain, input }) {
  let follow = null;
  let yaw = 0;
  let pitch = 0.3;
  let dist = 9.6;
  let distTarget = 9.6;
  let lift = 0;
  let lastLook = -100;
  let autoRecenter = true;
  let ready = false;
  let blocker = null; // (x, z) => true when a building is in the way
  let squeeze = 1;
  let cramped = 0;

  const pivot = new THREE.Vector3();
  const vx = { v: 0 };
  const vy = { v: 0 };
  const vz = { v: 0 };
  const fPos = new THREE.Vector3();
  const fLook = new THREE.Vector3();
  const cPos = new THREE.Vector3();
  const cLook = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const mLook = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();

  let cine = null; // { shots, i, el, from, resolve, skippable, age }
  let blend = null; // { t, dur, pos, quat, fov }

  function baseFov() {
    const a = camera.aspect;
    return a < 0.8 ? 70 : a > 1.5 ? 54 : lerp(70, 54, (a - 0.8) / 0.7);
  }

  function toV(v, out) {
    if (!v) return null;
    if (Array.isArray(v)) return out.set(v[0], v[1], v[2]);
    return out.set(v.x, v.y, v.z);
  }

  function computeFollow(dt) {
    if (!follow) return;
    const p = follow.position;
    if (!ready) {
      pivot.set(p.x, p.y + 1.55, p.z);
      vx.v = vy.v = vz.v = 0;
      ready = true;
    } else {
      pivot.x = smoothDamp(pivot.x, p.x, vx, 0.09, dt);
      pivot.z = smoothDamp(pivot.z, p.z, vz, 0.09, dt);
      pivot.y = smoothDamp(pivot.y, p.y + 1.55, vy, 0.2, dt);
    }
    dist = damp(dist, distTarget, 10, dt);
    const cp = Math.cos(pitch);
    fPos.set(pivot.x + Math.sin(yaw) * cp * dist, pivot.y + Math.sin(pitch) * dist, pivot.z + Math.cos(yaw) * cp * dist);
    // Never sit inside a building: slide in toward the avatar until the view is clear.
    cramped = 0;
    if (blocker) {
      const reach = Math.max(0.01, cp * dist);
      const steps = Math.min(40, Math.ceil(reach / 0.28));
      let free = 1;
      for (let k = 1; k <= steps; k++) {
        const s = k / steps;
        if (blocker(lerp(pivot.x, fPos.x, s), lerp(pivot.z, fPos.z, s))) {
          // stop a little short of the wall so the near plane never pokes through it
          free = Math.max(0.02, (((k - 1) / steps) * reach - 0.45) / reach);
          break;
        }
      }
      squeeze = free < squeeze ? damp(squeeze, free, 30, dt) : damp(squeeze, free, 2.5, dt);
      if (squeeze < 0.995) {
        const h = reach * squeeze;
        // pinned against a wall: rise over the avatar's head and look out past it instead
        cramped = clamp(1 - h / 2.2, 0, 1);
        fPos.set(pivot.x + Math.sin(yaw) * h, pivot.y + Math.sin(pitch) * dist * (0.35 + 0.65 * squeeze) + cramped * 0.95, pivot.z + Math.cos(yaw) * h);
      }
    }

    // Keep the camera above the ground and keep the ground from cutting the view of the avatar.
    let need = terrain.heightAt(fPos.x, fPos.z) + 0.9 - fPos.y;
    for (let k = 1; k <= 2; k++) {
      const s = k / 3;
      const gx = lerp(pivot.x, fPos.x, s);
      const gz = lerp(pivot.z, fPos.z, s);
      const lineY = lerp(pivot.y, fPos.y, s);
      const over = terrain.heightAt(gx, gz) + 0.45 - lineY;
      if (over > 0) need = Math.max(need, over / s);
    }
    need = Math.max(0, need);
    lift = need > lift ? damp(lift, need, 16, dt) : damp(lift, need, 3.5, dt);
    fPos.y += lift;
    fLook.set(pivot.x - Math.sin(yaw) * 3.2 * cramped, pivot.y + 0.085 * dist * (1 - cramped) + 0.25 * cramped, pivot.z - Math.cos(yaw) * 3.2 * cramped);
  }

  function startShot() {
    const shot = cine.shots[cine.i];
    cine.el = 0;
    cine.from = { pos: camera.position.clone(), look: cLook.clone(), fov: camera.fov };
    if (typeof shot.onStart === 'function') {
      try {
        shot.onStart(cine.i);
      } catch (err) {
        console.error('[c9] shot onStart failed', err);
      }
    }
  }

  function finish(result) {
    if (!cine) return;
    const done = cine;
    cine = null;
    blend = { t: 0, dur: done.handoff, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    lastLook = engine ? engine.time : 0;
    done.resolve(result);
  }

  function updateCine(dt) {
    cine.age += dt;
    const shot = cine.shots[cine.i];
    cine.el += dt;
    const dur = Math.max(0.0001, shot.dur || 0.0001);
    const u = clamp(cine.el / dur, 0, 1);
    const fn = typeof shot.ease === 'function' ? shot.ease : EASE[shot.ease] || EASE.inOut;
    const e = fn(u);

    if (typeof shot.pos === 'function') toV(shot.pos(e, cine.el), cPos);
    else if (shot.pos) {
      toV(shot.pos, tmp);
      if (shot.cut) cPos.copy(tmp);
      else cPos.copy(cine.from.pos).lerp(tmp, e);
    } else cPos.copy(cine.from.pos);

    if (typeof shot.look === 'function') toV(shot.look(e, cine.el), cLook);
    else if (shot.look) {
      toV(shot.look, tmp);
      if (shot.cut) cLook.copy(tmp);
      else cLook.copy(cine.from.look).lerp(tmp, e);
    } else cLook.copy(cine.from.look);

    const fov = shot.fov ? (shot.cut ? shot.fov : lerp(cine.from.fov, shot.fov, e)) : lerp(cine.from.fov, baseFov(), e);
    setCamera(cPos, cLook, fov);

    if (u >= 1) {
      if (cine.i < cine.shots.length - 1) {
        cine.i++;
        startShot();
      } else {
        finish('done');
      }
    }
    return shot;
  }

  function setCamera(pos, look, fov) {
    camera.position.copy(pos);
    camera.lookAt(look);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function update(dt, t) {
    const look = input ? input.consumeLook() : null;
    const zoom = input ? input.consumeZoom() : 1;
    if (!cine && look && (look.dx || look.dy)) {
      const sens = input.usingTouch ? SENS_TOUCH : SENS_MOUSE;
      yaw -= look.dx * sens;
      pitch = clamp(pitch + look.dy * sens, MIN_PITCH, MAX_PITCH);
      lastLook = t;
    }
    if (!cine && zoom !== 1) {
      distTarget = clamp(distTarget * zoom, MIN_DIST, MAX_DIST);
      lastLook = t;
    }
    if (follow && autoRecenter && !cine && t - lastLook > RECENTER_AFTER && follow.speed > 1.2) {
      const d = angleDelta(yaw, follow.heading + Math.PI);
      if (Math.abs(d) < 2.6) yaw += d * (1 - Math.exp(-1.15 * dt));
    }
    computeFollow(dt);

    if (cine) {
      updateCine(dt);
      return;
    }
    if (!follow) return;
    const fov = baseFov();
    if (blend) {
      blend.t += dt;
      const u = clamp(blend.t / Math.max(0.0001, blend.dur), 0, 1);
      const e = EASE.inOut(u);
      mLook.lookAt(fPos, fLook, UP);
      qB.setFromRotationMatrix(mLook);
      camera.position.copy(blend.pos).lerp(fPos, e);
      camera.quaternion.copy(qA.copy(blend.quat).slerp(qB, e));
      const f = lerp(blend.fov, fov, e);
      if (Math.abs(camera.fov - f) > 0.01) {
        camera.fov = f;
        camera.updateProjectionMatrix();
      }
      cLook.copy(fLook);
      if (u >= 1) blend = null;
      return;
    }
    cLook.copy(fLook);
    setCamera(fPos, fLook, fov);
  }

  function play(shots, opts = {}) {
    if (cine) finish('interrupted');
    blend = null;
    return new Promise((resolve) => {
      if (!shots || !shots.length) {
        resolve('done');
        return;
      }
      cine = { shots, i: 0, el: 0, age: 0, from: null, resolve, skippable: opts.skippable !== false, handoff: opts.handoff ?? 0.9 };
      startShot();
    });
  }

  function flyAlong(points, opts = {}) {
    const dur = opts.dur ?? 12;
    const lookAhead = opts.lookAhead ?? 16;
    const height = opts.height ?? 5;
    const lookHeight = opts.lookHeight ?? 1.4;
    const pts = points.map((p) => (p.length >= 3 ? [p[0], p[2]] : [p[0], p[1]]));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    let seg = 0;
    const at = (d, out) => {
      d = clamp(d, 0, total);
      if (cum[seg] > d) seg = 0;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const span = cum[seg + 1] - cum[seg] || 1;
      const k = clamp((d - cum[seg]) / span, 0, 1);
      out.x = lerp(pts[seg][0], pts[seg + 1][0], k);
      out.z = lerp(pts[seg][1], pts[seg + 1][1], k);
      return out;
    };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const smoothLook = new THREE.Vector3();
    let camY = null;
    let primed = false;
    let lastEl = 0;
    // Cloud Nine: between the island and the clouds there is open sky (terrain.isSky, or a height
    // far below everything). Never dive into it: hold the last real ground until the path reaches
    // ground again (the camera then eases up or down to it).
    const isSky = (x, z, g) => !Number.isFinite(g) || g <= -1000 || (typeof terrain.isSky === 'function' && terrain.isSky(x, z));
    let lastGround = null;
    const groundFor = (x, z, remember) => {
      const g = terrain.heightAt(x, z);
      if (!isSky(x, z, g)) {
        if (remember) lastGround = g;
        return g;
      }
      return lastGround !== null ? lastGround : 0;
    };
    return play([{
      dur,
      ease: opts.ease || 'inOut',
      cut: true,
      pos: (e, el) => {
        const d = e * total;
        const step = Math.max(0, el - lastEl);
        lastEl = el;
        at(d, a);
        const ground = groundFor(a.x, a.z, true);
        const want = ground + height;
        camY = camY === null ? want : damp(camY, want, 4, step || 0.016);
        a.y = Math.max(camY, ground + 1.2);
        // aim a little down the road, eased so corners in the polyline never twitch the view
        at(d + lookAhead, b);
        b.y = groundFor(b.x, b.z, false) + lookHeight;
        if (!primed) {
          smoothLook.copy(b);
          primed = true;
        } else smoothLook.lerp(b, 1 - Math.exp(-6 * (step || 0.016)));
        if (typeof opts.onProgress === 'function') {
          try {
            opts.onProgress(d / total, d, a);
          } catch (err) {
            console.error('[c9] flyAlong onProgress failed', err);
          }
        }
        return a;
      },
      look: () => smoothLook,
    }], { skippable: opts.skippable, handoff: opts.handoff });
  }

  if (input) {
    input.on('any', () => {
      if (cine && cine.skippable && cine.age > 0.45) finish('skipped');
    });
  }

  return {
    update,
    play,
    flyAlong,
    skip() {
      if (cine) finish('skipped');
    },
    setFollow(target) {
      follow = target;
      ready = false;
    },
    setBlocker(fn) {
      blocker = typeof fn === 'function' ? fn : null;
    },
    snapBehind(heading) {
      if (typeof heading === 'number') yaw = heading + Math.PI;
      ready = false;
      lift = 0;
      squeeze = 1;
      blend = null;
      lastLook = engine ? engine.time - RECENTER_AFTER : 0;
    },
    setView(v = {}) {
      if (typeof v.yaw === 'number') yaw = v.yaw;
      if (typeof v.pitch === 'number') pitch = clamp(v.pitch, MIN_PITCH, MAX_PITCH);
      if (typeof v.distance === 'number') {
        distTarget = clamp(v.distance, MIN_DIST, MAX_DIST);
        if (v.instant) dist = distTarget;
      }
    },
    // The three.js camera this rig drives.
    object: camera,
    // World-space point the camera is currently looking at (follow pivot or cinematic look).
    get lookTarget() { return cLook; },
    get yaw() { return yaw; },
    set yaw(v) { yaw = v; },
    get pitch() { return pitch; },
    get distance() { return distTarget; },
    get isCinematic() { return !!cine; },
    get autoRecenter() { return autoRecenter; },
    set autoRecenter(v) { autoRecenter = !!v; },
    baseFov,
  };
}
