// The visitor's avatar: camera-relative movement over the terrain, sliding collisions, tap-to-walk,
// footsteps and teleporting.
//
//   const player = createPlayer({ scene, terrain, colliders, input, rig, audio, hud, store })
//   player.position (Vector3), player.heading (radians, 0 faces +Z), player.speed
//   player.setAvatar(avatar)     avatar = { group, setAnim(name), setSpeed?(v), update(dt, t), dispose?() }
//   player.walkTo(x, z, { stop, onArrive })      auto-walk with a ground marker; joystick input cancels it
//   player.teleport(x, z, facing, { fade })      -> Promise
//   player.getState()            -> { teamId, x, z, heading, anim }  (the presence payload, see core/net.js)
//   player.frozen = true         movement off (cinematics, arrival)

import * as THREE from '../../lib/three.module.min.js';
import { BRAND } from '../config.js';
import { clamp, damp, dampAngle, lerp } from '../core/util.js';

export const RUN_SPEED = 7.8;
export const WALK_SPEED = 2.7;
const RADIUS = 0.45;
const ACCEL = 9;
const MAX_CLIMB = 1.7; // rise over run: steeper than this uphill is a wall
const PROBE = 0.5;

// Merge simple parts into one vertex-colored, flat-shaded geometry.
function mergeColored(parts) {
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    const m = part.matrix || new THREE.Matrix4();
    c.set(part.color);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
    if (g !== part.geo) g.dispose();
    part.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  out.computeVertexNormals();
  return out;
}

// Stand-in until the art library's createAvatar arrives. Same interface, front faces +Z.
export function createPlaceholderAvatar({ color = BRAND.gold } = {}) {
  const group = new THREE.Group();
  group.name = 'placeholderAvatar';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const torso = new THREE.Mesh(mergeColored([
    { geo: new THREE.CylinderGeometry(0.25, 0.31, 0.72, 8), matrix: T(0, 0.94, 0), color },
    { geo: new THREE.IcosahedronGeometry(0.24, 1), matrix: T(0, 1.52, 0), color: 0xf0d2b0 },
    { geo: new THREE.BoxGeometry(0.34, 0.1, 0.16), matrix: T(0, 1.56, 0.19), color: BRAND.night },
    { geo: new THREE.BoxGeometry(0.2, 0.2, 0.08), matrix: T(0, 1.05, 0.27), color: 0xffffff },
    { geo: new THREE.BoxGeometry(0.12, 0.5, 0.14), matrix: T(-0.36, 0.98, 0), color },
    { geo: new THREE.BoxGeometry(0.12, 0.5, 0.14), matrix: T(0.36, 0.98, 0), color },
  ]), mat);
  const legGeo = new THREE.BoxGeometry(0.18, 0.58, 0.2);
  legGeo.translate(0, -0.29, 0);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2a3350, flatShading: true });
  const legL = new THREE.Mesh(legGeo, legMat);
  const legR = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.14, 0.58, 0);
  legR.position.set(0.14, 0.58, 0);
  group.add(torso, legL, legR);

  let anim = 'idle';
  let speed = 0;
  let phase = 0;
  return {
    group,
    setAnim(name) { anim = name; },
    setSpeed(v) { speed = v; },
    setAccessory() {},
    setNumber() {},
    update(dt, t) {
      const moving = anim === 'walk' || anim === 'run';
      const rate = anim === 'run' ? 12.5 : 8;
      if (moving) phase += dt * rate * clamp(speed / (anim === 'run' ? 7.5 : 2.6), 0.5, 1.3);
      const swing = moving ? Math.sin(phase) * (anim === 'run' ? 0.95 : 0.55) : 0;
      legL.rotation.x = damp(legL.rotation.x, swing, 18, dt);
      legR.rotation.x = damp(legR.rotation.x, -swing, 18, dt);
      torso.position.y = moving ? Math.abs(Math.cos(phase)) * (anim === 'run' ? 0.09 : 0.04) : Math.sin(t * 2) * 0.012;
      torso.rotation.x = damp(torso.rotation.x, anim === 'run' ? 0.16 : 0, 8, dt);
    },
    dispose() {
      torso.geometry.dispose();
      legGeo.dispose();
      mat.dispose();
      legMat.dispose();
    },
  };
}

export function createPlayer({ scene, terrain, colliders, input, rig, audio = null, hud = null, store = null }) {
  const group = new THREE.Group();
  group.name = 'player';
  scene.add(group);
  const position = group.position;

  // soft blob shadow, the only "shadow" in the world
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.06;
  shadow.renderOrder = 2;
  group.add(shadow);

  // tap-to-walk marker
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.62, 20),
    new THREE.MeshBasicMaterial({ color: BRAND.gold, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  marker.renderOrder = 3;
  scene.add(marker);

  let avatar = null;
  let heading = Math.PI;
  let speed = 0;
  let anim = 'idle';
  let frozen = false;
  let stride = 0;
  let stateClock = 0;
  const vel = { x: 0, z: 0 };
  const mv = { x: 0, y: 0 };
  const probe = { x: 0, z: 0 };
  const auto = { active: false, x: 0, z: 0, stop: 0.35, onArrive: null, stuck: 0, lastD: 0 };
  const seat = { on: false, x: 0, y: 0, z: 0, onLeave: null, pose: 'sit' };
  const followTarget = { position, heading, speed: 0 };

  function setAvatar(next) {
    if (avatar) {
      group.remove(avatar.group);
      if (avatar.dispose) avatar.dispose();
    }
    avatar = next;
    if (avatar) {
      group.add(avatar.group);
      if (avatar.setAnim) avatar.setAnim(seat.on ? seat.pose : anim);
    }
    // art avatars bring their own blob shadow
    shadow.visible = !!(avatar && avatar.group.name === 'placeholderAvatar');
  }
  setAvatar(createPlaceholderAvatar({ color: BRAND.gold }));

  function cancelWalk() {
    auto.active = false;
    auto.onArrive = null;
    marker.visible = false;
  }

  function walkTo(x, z, opts = {}) {
    const b = terrain.bounds;
    auto.x = clamp(x, b.minX + 0.5, b.maxX - 0.5);
    auto.z = clamp(z, b.minZ + 0.5, b.maxZ - 0.5);
    auto.stop = opts.stop ?? 0.35;
    auto.onArrive = opts.onArrive || null;
    auto.active = true;
    auto.stuck = 0;
    auto.lastD = Infinity;
    if (opts.marker !== false) {
      marker.position.set(auto.x, terrain.heightAt(auto.x, auto.z) + 0.1, auto.z);
      marker.visible = true;
      marker.scale.setScalar(1.6);
    } else marker.visible = false;
  }

  function arrive() {
    const cb = auto.onArrive;
    cancelWalk();
    if (cb) {
      try {
        cb();
      } catch (err) {
        console.error('[lw] walkTo onArrive failed', err);
      }
    }
  }

  // Looks half a meter ahead so the answer does not depend on the frame rate, and so curbs and
  // small ledges (under about 0.85 m) are simply walked over.
  function canStep(fromX, fromZ, toX, toZ, fromY) {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const run = Math.hypot(dx, dz);
    if (run < 1e-5) return true;
    const k = PROBE / run;
    const rise = terrain.heightAt(fromX + dx * k, fromZ + dz * k) - fromY;
    return rise <= MAX_CLIMB * PROBE;
  }

  function update(dt, t) {
    if (seat.on) {
      // sitting: pinned to the seat until someone calls stand()
      position.set(seat.x, seat.y, seat.z);
      group.rotation.y = heading;
      vel.x = 0;
      vel.z = 0;
      speed = 0;
      followTarget.heading = heading;
      followTarget.speed = 0;
      if (avatar) avatar.update(dt, t);
      return;
    }
    let dirX = 0;
    let dirZ = 0;
    let want = 0;
    if (!frozen) {
      input.getMove(mv);
      const mag = Math.min(1, Math.hypot(mv.x, mv.y));
      if (mag > 0.05) {
        if (auto.active) cancelWalk();
        const yaw = rig ? rig.yaw : 0;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        dirX = (rx * mv.x + fx * mv.y) / mag;
        dirZ = (rz * mv.x + fz * mv.y) / mag;
        want = mag < 0.55 ? lerp(0.6, WALK_SPEED, mag / 0.55) : lerp(WALK_SPEED, RUN_SPEED, clamp((mag - 0.55) / 0.3, 0, 1));
      } else if (auto.active) {
        const dx = auto.x - position.x;
        const dz = auto.z - position.z;
        const d = Math.hypot(dx, dz);
        if (d <= auto.stop) arrive();
        else {
          dirX = dx / d;
          dirZ = dz / d;
          want = Math.min(RUN_SPEED, 1.6 + (d - auto.stop) * 2.2);
          // give up politely if something solid is in the way
          auto.stuck = d > auto.lastD - 0.4 * dt ? auto.stuck + dt : 0;
          auto.lastD = d;
          if (auto.stuck > 0.9) {
            if (d < auto.stop + 2.5) arrive();
            else cancelWalk();
          }
        }
      }
    } else if (auto.active) cancelWalk();

    vel.x = damp(vel.x, dirX * want, ACCEL, dt);
    vel.z = damp(vel.z, dirZ * want, ACCEL, dt);
    if (want === 0 && Math.abs(vel.x) + Math.abs(vel.z) < 0.02) {
      vel.x = 0;
      vel.z = 0;
    }

    let nx = position.x + vel.x * dt;
    let nz = position.z + vel.z * dt;

    // soft world edge: the last few meters push back gently, then a hard stop
    const b = terrain.bounds;
    const EDGE = 5;
    if (vel.x > 0 && nx > b.maxX - EDGE) nx = position.x + vel.x * dt * clamp((b.maxX - position.x) / EDGE, 0, 1);
    if (vel.x < 0 && nx < b.minX + EDGE) nx = position.x + vel.x * dt * clamp((position.x - b.minX) / EDGE, 0, 1);
    if (vel.z > 0 && nz > b.maxZ - EDGE) nz = position.z + vel.z * dt * clamp((b.maxZ - position.z) / EDGE, 0, 1);
    if (vel.z < 0 && nz < b.minZ + EDGE) nz = position.z + vel.z * dt * clamp((position.z - b.minZ) / EDGE, 0, 1);
    nx = clamp(nx, b.minX, b.maxX);
    nz = clamp(nz, b.minZ, b.maxZ);

    // cliffs are walls on the way up (slide along them), slides on the way down
    const groundY = terrain.heightAt(position.x, position.z);
    if (!canStep(position.x, position.z, nx, nz, groundY)) {
      if (canStep(position.x, position.z, nx, position.z, groundY)) nz = position.z;
      else if (canStep(position.x, position.z, position.x, nz, groundY)) nx = position.x;
      else {
        nx = position.x;
        nz = position.z;
      }
    }

    probe.x = nx;
    probe.z = nz;
    if (colliders) colliders.resolve(probe, RADIUS);
    const movedX = probe.x - position.x;
    const movedZ = probe.z - position.z;
    position.x = probe.x;
    position.z = probe.z;

    const h = terrain.heightAt(position.x, position.z);
    position.y = h >= position.y ? damp(position.y, h, 45, dt) : damp(position.y, h, 16, dt);
    if (Math.abs(position.y - h) > 30) position.y = h;

    speed = dt > 0 ? Math.hypot(movedX, movedZ) / dt : 0;
    const intent = Math.hypot(vel.x, vel.z);
    if (intent > 0.35) heading = dampAngle(heading, Math.atan2(vel.x, vel.z), 12, dt);
    group.rotation.y = heading;

    const nextAnim = intent < 0.3 ? 'idle' : intent < WALK_SPEED + 1.2 ? 'walk' : 'run';
    if (nextAnim !== anim) {
      anim = nextAnim;
      if (avatar && avatar.setAnim) avatar.setAnim(anim);
    }
    if (avatar) {
      if (avatar.setSpeed) avatar.setSpeed(speed);
      avatar.update(dt, t);
    }

    // footsteps on stride
    if (speed > 0.6) {
      stride += speed * dt;
      const len = anim === 'run' ? 2.05 : 1.25;
      if (stride >= len) {
        stride = 0;
        if (audio) audio.sfx('step', { volume: anim === 'run' ? 0.85 : 0.55 });
      }
    } else stride = 0.6;

    if (marker.visible) {
      marker.scale.setScalar(damp(marker.scale.x, 1 + Math.sin(t * 7) * 0.08, 10, dt));
      marker.rotation.z += dt * 1.5;
    }

    followTarget.heading = heading;
    followTarget.speed = speed;

    stateClock += dt;
    if (store && stateClock > 0.25) {
      stateClock = 0;
      store.set('player', getState());
    }
  }

  function getState() {
    return {
      teamId: store ? store.get('teamId') ?? null : null,
      x: Math.round(position.x * 100) / 100,
      z: Math.round(position.z * 100) / 100,
      heading: Math.round(heading * 1000) / 1000,
      anim,
    };
  }

  // Stop dead: no walk target, no coasting.
  function halt() {
    cancelWalk();
    vel.x = 0;
    vel.z = 0;
  }

  // Leaving a seat because something moved the player (fast travel): tell whoever sat us down.
  function unseat() {
    if (!seat.on) return;
    seat.on = false;
    anim = 'idle';
    if (avatar && avatar.setAnim) avatar.setAnim('idle');
    const cb = seat.onLeave;
    seat.onLeave = null;
    if (cb) {
      try {
        cb();
      } catch (err) {
        console.error('[lw] seat onLeave failed', err);
      }
    }
  }

  function place(x, z, facing) {
    unseat();
    cancelWalk();
    position.set(x, terrain.heightAt(x, z), z);
    if (typeof facing === 'number') heading = facing;
    group.rotation.y = heading;
    vel.x = 0;
    vel.z = 0;
    followTarget.heading = heading;
    if (rig) rig.snapBehind(heading);
  }

  async function teleport(x, z, facing, opts = {}) {
    const fade = opts.fade !== false && hud && hud.fade;
    if (fade) await hud.fade(true, 170);
    place(x, z, facing);
    if (audio && opts.silent !== true) audio.sfx('whoosh', { volume: 0.5 });
    if (fade) await hud.fade(false, 260);
  }

  // Pin the avatar somewhere (a throne, the back of a truck). pose is the animation to hold.
  function sit(x, y, z, facing, onLeave, pose = 'sit') {
    halt();
    seat.on = true;
    seat.pose = pose;
    seat.onLeave = typeof onLeave === 'function' ? onLeave : null;
    seat.x = x;
    seat.y = y;
    seat.z = z;
    if (typeof facing === 'number') heading = facing;
    position.set(x, y, z);
    group.rotation.y = heading;
    anim = pose;
    if (avatar && avatar.setAnim) avatar.setAnim(pose);
  }

  // Move the seat while seated (it is riding something).
  function setSeat(x, y, z, facing) {
    if (!seat.on) return;
    seat.x = x;
    seat.y = y;
    seat.z = z;
    if (typeof facing === 'number') heading = facing;
  }

  function stand(x, z, facing) {
    if (!seat.on) return;
    seat.on = false;
    seat.onLeave = null;
    anim = 'idle';
    if (avatar && avatar.setAnim) avatar.setAnim('idle');
    position.set(x, terrain.heightAt(x, z), z);
    if (typeof facing === 'number') heading = facing;
    group.rotation.y = heading;
    followTarget.heading = heading;
  }

  if (rig) rig.setFollow(followTarget);

  return {
    group,
    position,
    update,
    setAvatar,
    walkTo,
    cancelWalk,
    teleport,
    place,
    sit,
    setSeat,
    stand,
    halt,
    get seated() { return seat.on; },
    getState,
    radius: RADIUS,
    get avatar() { return avatar; },
    get heading() { return heading; },
    set heading(v) { heading = v; },
    get speed() { return speed; },
    get anim() { return anim; },
    get frozen() { return frozen; },
    set frozen(v) { frozen = !!v; },
    get walking() { return auto.active; },
    get walkTarget() { return auto.active ? { x: auto.x, z: auto.z } : null; },
  };
}
