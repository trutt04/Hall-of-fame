// The local cheerleader (Contract 2) and everybody else's (remote players and bots).
// Ported from League World's player: camera-relative movement, sliding collisions, tap-to-walk,
// footsteps and teleports, plus height: gravity, a jump, landings, slides you whoosh down sitting,
// and never a death. Over open sky (groundAt is -Infinity) you fall gently, a cloud catches you and
// floats you home.
//
//   const player = createPlayer({ scene, groundAt, platforms, slides, colliders, input, rig, audio, hud, home })
//   player.position (Vector3, y included), player.heading, player.velocity (Vector3), player.grounded
//   player.speed (horizontal m/s), player.anim, player.group, player.radius
//   player.setAvatar(avatar) / player.avatar      a Contract 3 character (or the placeholder)
//   player.frozen = true            input does not move the player (gravity still works)
//   player.takeControl(owner)       -> release(): a mini game drives position, heading and anims
//                                   (player.setAnim) while physics and input movement pause
//   player.controller               the owner in control, or null
//   player.jump()                   -> true when it hopped (Space / the jump button)
//   player.setAnim(name, opts)      what everybody sees; while not controlled it plays until you move
//   player.emote(anim, seconds)     a short reaction (wave, cheer, ...) that movement cancels
//   player.teleport(x, z, facing, { fade, silent }) -> Promise
//   player.place(x, z, facing)      instant, no fade
//   player.walkTo(x, z, { stop, onArrive, marker }) / player.cancelWalk() / player.halt()
//   player.rescue()                 call the rescue cloud now; player.rescuing
//   player.rescueTo = { x, z, facing } | null      where the cloud takes you (default: home())
//   player.getState()               -> { x, y, z, h, anim }   what goes over the network (Contract 4)
//   player.on('jump' | 'land' {height} | 'rescue' | 'rescued' | 'step', fn) -> off
//
//   const peers = createPeers({ scene, net, makeCharacter, labels, camera, meId })
//   peers.sync()                    add and remove characters to match net.players (minus me)
//   peers.update(dt, t)             position everyone from net.stateOf(id)
//   peers.emote(id, { text, icon, anim })   speech bubble (and a little animation) over anyone
//   peers.positionOf(id) -> { x, y, z } | null      peers.list() -> [{ id, nick, bot, group, character }]
//   peers.clear() / peers.dispose()

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { Geo } from '../art/geo.js';
import { flatMat } from '../art/materials.js';
import { isReducedMotion } from '../art/util.js';
import { clamp, damp, dampAngle, lerp, emitter, angleDelta } from '../core/util.js';

export const RUN_SPEED = 7.2;
export const WALK_SPEED = 2.6;
const RADIUS = 0.42;
const ACCEL = 10;
const AIR_ACCEL = 3.2;
const GRAVITY = 24;
export const JUMP_SPEED = 7.4; // about a 1.15 m hop
const MAX_FALL = 15; // even off the highest cloud, you come down softly
const SKY_FALL = 6.5; // over open sky you drift down gently
const STEP_UP = 0.6; // curbs, the stage, a mat: walked onto without a jump
const SNAP_DOWN = 0.5; // walking down a gentle step stays grounded
const COYOTE = 0.12; // a jump still works this long after walking off an edge
const JUMP_BUFFER = 0.14; // and a jump pressed this long before landing happens on landing
const SKY_CATCH_AFTER = 1.0; // seconds of falling over open sky before the cloud swoops in
const SLIDE_ACCEL = 11;
const SLIDE_MAX = 13;
const SLIDE_HALF = 1.15;

const hexOf = (css) => parseInt(String(css).slice(1), 16);

// A puffy pink-and-white cloud to ride home on.
function makeRescueCloud() {
  const g = new Geo();
  g.jit = 0.04;
  // pinker than the sky's clouds, so it reads as her ride, with rhinestones on the rim
  const white = 0xffffff;
  const pink = hexOf(PALETTE.pinkSoft);
  const pale = hexOf(PALETTE.pinkPale);
  g.ico(0, 0, 0, 1.05, pale, { detail: 1, sy: 0.55 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.ico(Math.cos(a) * 0.95, -0.05 + (i % 2) * 0.12, Math.sin(a) * 0.8, 0.55 + (i % 3) * 0.1, i % 3 === 0 ? pink : i % 3 === 1 ? white : pale, { detail: 1, sy: 0.7 });
  }
  g.ico(-0.35, 0.3, -0.2, 0.55, white, { detail: 1, sy: 0.8 });
  g.ico(0.4, 0.28, 0.1, 0.5, pink, { detail: 1, sy: 0.8 });
  const gems = [hexOf(PALETTE.rhinestonePink), hexOf(PALETTE.rhinestonePurple), hexOf(PALETTE.rhinestoneSilver)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    g.ico(Math.cos(a) * 1.32, 0.12, Math.sin(a) * 1.12, 0.09, gems[i % 3], { detail: 0 });
  }
  const mesh = g.mesh(flatMat);
  mesh.name = 'rescueCloud';
  return mesh;
}

export function createPlayer({ scene, groundAt, platforms = [], slides = [], colliders = null, input, rig = null, audio = null, hud = null, home = null }) {
  const events = emitter();
  const group = new THREE.Group();
  group.name = 'player';
  scene.add(group);
  const position = group.position;
  const velocity = new THREE.Vector3();

  // tap-to-walk marker: a pink ring that pulses on the ground
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.6, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.pink, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  marker.renderOrder = 3;
  scene.add(marker);

  const cloud = makeRescueCloud();
  cloud.visible = false;
  scene.add(cloud);

  let avatar = null;
  let heading = Math.PI;
  let speed = 0;
  let grounded = false;
  let frozen = false;
  let stride = 0;
  let coyote = 0;
  let jumpBuffer = 0;
  let airPeak = 0;
  let skyTime = 0;
  let lastSafe = { x: 0, z: 0 };
  let locoAnim = 'idle';
  let landTimer = 0;
  let sliding = null; // the slide we are whooshing down, or null
  let shownAnim = null;
  let override = null; // { anim, until, opts } from emote() or setAnim() while not controlled
  let ownerAnim = 'idle';
  let ownerAnimOpts = undefined;
  let clock = 0;
  const controls = [];
  const mv = { x: 0, y: 0 };
  const probe = { x: 0, z: 0 };
  const auto = { active: false, x: 0, z: 0, stop: 0.35, onArrive: null, stuck: 0, lastD: 0 };
  const rescue = { active: false, t: 0, dur: 3, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), p3: new THREE.Vector3(), dest: null, phase: 'catch' };
  const followTarget = { position, heading, speed: 0 };
  const last = new THREE.Vector3();

  // slides from Contract 1 places: the higher end is the top
  const chutes = slides.map((s) => {
    const ya = groundAt(s.x0, s.z0);
    const yb = groundAt(s.x1, s.z1);
    const top = !(Number.isFinite(yb) && (!Number.isFinite(ya) || yb > ya));
    const x0 = top ? s.x0 : s.x1;
    const z0 = top ? s.z0 : s.z1;
    const x1 = top ? s.x1 : s.x0;
    const z1 = top ? s.z1 : s.z0;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    return { id: s.id, x0, z0, dx, dz, len, ux: dx / len, uz: dz / len };
  });

  function slideAt(x, z) {
    for (const c of chutes) {
      const t = ((x - c.x0) * c.ux + (z - c.z0) * c.uz) / c.len;
      if (t < -0.02 || t > 1.02) continue;
      const px = c.x0 + c.ux * c.len * t;
      const pz = c.z0 + c.uz * c.len * t;
      if (Math.hypot(x - px, z - pz) <= SLIDE_HALF) return t > 0.985 ? null : c;
    }
    return null;
  }

  function onPlatform(x, z, y) {
    for (const p of platforms) if (Math.hypot(x - p.x, z - p.z) <= p.r + 0.6 && y >= p.y - 1) return true;
    return false;
  }

  function homeSpot() {
    const h = (player.rescueTo && Number.isFinite(player.rescueTo.x)) ? player.rescueTo : typeof home === 'function' ? home() : home;
    const x = h && Number.isFinite(h.x) ? h.x : 0;
    const z = h && Number.isFinite(h.z) ? h.z : 0;
    return { x, z, facing: h && Number.isFinite(h.facing) ? h.facing : heading };
  }

  function setAvatar(next) {
    if (avatar && avatar !== next) {
      group.remove(avatar.group);
      if (avatar.dispose) {
        try {
          avatar.dispose();
        } catch (err) { /* already gone */ }
      }
    }
    avatar = next;
    if (avatar) {
      group.add(avatar.group);
      shownAnim = null; // re-send the current anim to the new body
    }
  }

  function cancelWalk() {
    auto.active = false;
    auto.onArrive = null;
    marker.visible = false;
  }

  function walkTo(x, z, opts = {}) {
    const gy = groundAt(x, z);
    if (!Number.isFinite(gy)) return false;
    auto.x = x;
    auto.z = z;
    auto.stop = opts.stop ?? 0.35;
    auto.onArrive = opts.onArrive || null;
    auto.active = true;
    auto.stuck = 0;
    auto.lastD = Infinity;
    if (opts.marker !== false) {
      marker.position.set(x, gy + 0.08, z);
      marker.visible = true;
      marker.scale.setScalar(1.6);
    } else marker.visible = false;
    return true;
  }

  function arrive() {
    const cb = auto.onArrive;
    cancelWalk();
    if (cb) {
      try {
        cb();
      } catch (err) {
        console.error('[c9] walkTo onArrive failed', err);
      }
    }
  }

  function sfx(name, o) {
    if (!audio) return;
    try {
      audio.sfx(name, o);
    } catch (err) { /* sound is never worth a crash */ }
  }

  // ---------------------------------------------------------------- rescue cloud
  function startRescue() {
    if (rescue.active) return;
    cancelWalk();
    rescue.active = true;
    rescue.phase = 'catch';
    rescue.t = 0;
    sliding = null;
    const dest = homeSpot();
    rescue.dest = dest;
    rescue.p0.copy(position);
    const gy = groundAt(dest.x, dest.z);
    const endY = Number.isFinite(gy) ? gy : 0;
    rescue.p3.set(dest.x, endY + 0.6, dest.z);
    const dist = Math.hypot(dest.x - position.x, dest.z - position.z);
    const top = Math.max(position.y, endY) + 7 + dist * 0.12;
    rescue.p1.set(lerp(position.x, dest.x, 0.25), top, lerp(position.z, dest.z, 0.25));
    rescue.p2.set(lerp(position.x, dest.x, 0.8), top + 1.5, lerp(position.z, dest.z, 0.8));
    rescue.dur = clamp(2.2 + dist / 18, 2.6, 5.2);
    velocity.set(0, 0, 0);
    grounded = false;
    cloud.visible = true;
    cloud.scale.setScalar(0.01);
    cloud.position.set(position.x, position.y - 3, position.z);
    sfx('whoosh', { volume: 0.6 });
    events.emit('rescue', { x: position.x, y: position.y, z: position.z });
  }

  function endRescue(silent) {
    if (!rescue.active) return;
    rescue.active = false;
    cloud.visible = false;
    skyTime = 0;
    if (silent) return;
    // hop off onto the plaza (the camera has followed the whole ride, so no cut)
    velocity.set(0, 4.2, 0);
    grounded = false;
    airPeak = position.y;
    sfx('pop', { volume: 0.6 });
    events.emit('rescued', { x: position.x, y: position.y, z: position.z });
  }

  const bez = new THREE.Vector3();
  function bezier(u, out) {
    const a = 1 - u;
    const b0 = a * a * a;
    const b1 = 3 * a * a * u;
    const b2 = 3 * a * u * u;
    const b3 = u * u * u;
    out.set(0, 0, 0)
      .addScaledVector(rescue.p0, b0)
      .addScaledVector(rescue.p1, b1)
      .addScaledVector(rescue.p2, b2)
      .addScaledVector(rescue.p3, b3);
    return out;
  }

  function updateRescue(dt, t) {
    rescue.t += dt;
    if (rescue.phase === 'catch') {
      // the cloud swoops up under the falling cheerleader
      const k = clamp(rescue.t / 0.45, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      position.y -= dt * 2 * (1 - k);
      cloud.scale.setScalar(Math.max(0.01, e));
      cloud.position.set(position.x, lerp(position.y - 3, position.y - 0.25, e), position.z);
      locoAnim = 'fall';
      if (k >= 1) {
        rescue.phase = 'ride';
        rescue.t = 0;
        rescue.p0.copy(position);
        sfx('cradle', { volume: 0.7 });
      }
    } else {
      const u = clamp(rescue.t / rescue.dur, 0, 1);
      const e = u * u * (3 - 2 * u);
      bezier(e, bez);
      const dx = bez.x - position.x;
      const dz = bez.z - position.z;
      if (Math.hypot(dx, dz) > 0.002) heading = dampAngle(heading, Math.atan2(dx, dz), 5, dt);
      position.copy(bez);
      const bob = isReducedMotion() ? 0 : Math.sin(t * 3) * 0.06;
      cloud.position.set(position.x, position.y - 0.25 + bob, position.z);
      cloud.rotation.y += dt * 0.6;
      cloud.scale.setScalar(u > 0.9 ? Math.max(0.01, (1 - u) * 10) : 1);
      locoAnim = 'sit';
      if (u >= 1) endRescue(false);
    }
  }

  // ---------------------------------------------------------------- the frame
  function wantedAnim() {
    if (controls.length) return ownerAnim;
    if (override) return override.anim;
    return locoAnim;
  }

  function syncAnim() {
    const a = wantedAnim();
    if (a === shownAnim) return;
    shownAnim = a;
    if (!avatar || !avatar.setAnim) return;
    const opts = controls.length ? ownerAnimOpts : override ? override.opts : a === 'land' ? { loop: false } : undefined;
    try {
      avatar.setAnim(a, opts);
    } catch (err) { /* a broken animation never stops the player */ }
  }

  function canStepTo(x, z, fromY) {
    const g = groundAt(x, z);
    return g <= fromY + STEP_UP;
  }

  function update(dt, t) {
    clock = t;
    last.copy(position);
    if (controls.length) {
      // a mini game drives: keep the body, the camera target and the anim in sync with it
      grounded = false;
      group.rotation.y = heading;
      speed = dt > 0 ? Math.min(40, Math.hypot(position.x - prevCtl.x, position.z - prevCtl.z) / dt) : 0;
      prevCtl.x = position.x;
      prevCtl.z = position.z;
      followTarget.heading = heading;
      followTarget.speed = speed;
      syncAnim();
      if (avatar) {
        if (avatar.setSpeed) avatar.setSpeed(speed);
        avatar.update(dt, t);
      }
      return;
    }
    if (rescue.active) {
      updateRescue(dt, t);
      group.rotation.y = heading;
      followTarget.heading = heading;
      followTarget.speed = 2;
      speed = 0;
      syncAnim();
      if (avatar) {
        if (avatar.setSpeed) avatar.setSpeed(0);
        avatar.update(dt, t);
      }
      return;
    }

    // ------------------------------------------------ what the thumb (or keys, or a tap) wants
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
          auto.stuck = d > auto.lastD - 0.4 * dt ? auto.stuck + dt : 0;
          auto.lastD = d;
          if (auto.stuck > 0.9) {
            if (d < auto.stop + 2.5) arrive();
            else cancelWalk();
          }
        }
      }
    } else if (auto.active) cancelWalk();
    if (want > 0 && override) override = null; // moving ends a wave or a cheer

    // ------------------------------------------------ horizontal motion
    sliding = grounded ? slideAt(position.x, position.z) : null;
    if (sliding && grounded) {
      // whee: the slide pulls you down it, your thumb only steers a little
      velocity.x += sliding.ux * SLIDE_ACCEL * dt + dirX * want * 0.6 * dt;
      velocity.z += sliding.uz * SLIDE_ACCEL * dt + dirZ * want * 0.6 * dt;
      // keep to the chute: damp sideways motion
      const along = velocity.x * sliding.ux + velocity.z * sliding.uz;
      const sx = velocity.x - sliding.ux * along;
      const sz = velocity.z - sliding.uz * along;
      velocity.x -= sx * (1 - Math.exp(-6 * dt));
      velocity.z -= sz * (1 - Math.exp(-6 * dt));
      const sp = Math.hypot(velocity.x, velocity.z);
      if (sp > SLIDE_MAX) {
        velocity.x *= SLIDE_MAX / sp;
        velocity.z *= SLIDE_MAX / sp;
      }
    } else {
      const k = grounded ? ACCEL : AIR_ACCEL;
      velocity.x = damp(velocity.x, dirX * want, k, dt);
      velocity.z = damp(velocity.z, dirZ * want, k, dt);
      if (grounded && want === 0 && Math.abs(velocity.x) + Math.abs(velocity.z) < 0.02) {
        velocity.x = 0;
        velocity.z = 0;
      }
    }

    let nx = position.x + velocity.x * dt;
    let nz = position.z + velocity.z * dt;
    // a ledge higher than a step is a wall: slide along it
    if (!canStepTo(nx, nz, position.y)) {
      if (canStepTo(nx, position.z, position.y)) {
        nz = position.z;
        velocity.z = 0;
      } else if (canStepTo(position.x, nz, position.y)) {
        nx = position.x;
        velocity.x = 0;
      } else {
        nx = position.x;
        nz = position.z;
        velocity.x = 0;
        velocity.z = 0;
      }
    }
    probe.x = nx;
    probe.z = nz;
    // flat colliders belong to the island floor: not to clouds, slides or the open air above them
    if (colliders && !sliding && !onPlatform(nx, nz, position.y)) colliders.resolve(probe, RADIUS);
    position.x = probe.x;
    position.z = probe.z;

    // ------------------------------------------------ vertical motion
    const g = groundAt(position.x, position.z);
    if (grounded) {
      // a fast ride down a steep slide drops more than a step per frame: stay on it
      const snap = sliding ? Math.max(SNAP_DOWN, Math.hypot(velocity.x, velocity.z) * dt * 1.6) : SNAP_DOWN;
      if (!Number.isFinite(g) || g < position.y - snap) {
        grounded = false; // walked off an edge
        coyote = COYOTE;
        airPeak = position.y;
        velocity.y = 0;
      } else {
        position.y = g > position.y ? damp(position.y, g, 30, dt) : g;
        if (g - position.y < 0.02) position.y = g;
        velocity.y = 0;
        lastSafe = { x: position.x, z: position.z };
      }
    }
    if (!grounded) {
      coyote = Math.max(0, coyote - dt);
      velocity.y -= GRAVITY * dt;
      const overSky = !Number.isFinite(g);
      const cap = overSky ? SKY_FALL : MAX_FALL;
      if (velocity.y < -cap) velocity.y = damp(velocity.y, -cap, 8, dt);
      position.y += velocity.y * dt;
      if (position.y > airPeak) airPeak = position.y;
      if (!overSky && position.y <= g) {
        // landed
        const height = airPeak - g;
        position.y = g;
        velocity.y = 0;
        grounded = true;
        skyTime = 0;
        if (height > 0.35) {
          landTimer = 0.22;
          sfx('land', { volume: clamp(0.35 + height * 0.06, 0.35, 0.9) });
          events.emit('land', { height, x: position.x, y: position.y, z: position.z });
        }
        if (jumpBuffer > 0) {
          jumpBuffer = 0;
          doJump();
        }
      }
      if (overSky) {
        skyTime += dt;
        if (skyTime > SKY_CATCH_AFTER) startRescue();
      } else skyTime = 0;
    }
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    // nothing should ever get here, but a NaN or a fall through the world still ends safely
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z) || position.y < -200) {
      position.set(lastSafe.x, 0, lastSafe.z);
      velocity.set(0, 0, 0);
      startRescue();
    }

    // ------------------------------------------------ facing, anims, sounds
    speed = dt > 0 ? Math.hypot(position.x - last.x, position.z - last.z) / dt : 0;
    const intent = Math.hypot(velocity.x, velocity.z);
    if (intent > 0.35 && !(sliding && grounded)) heading = dampAngle(heading, Math.atan2(velocity.x, velocity.z), 12, dt);
    else if (sliding && grounded) heading = dampAngle(heading, Math.atan2(sliding.ux, sliding.uz), 10, dt);
    group.rotation.y = heading;

    landTimer = Math.max(0, landTimer - dt);
    if (sliding && grounded) locoAnim = 'sit';
    else if (!grounded) locoAnim = velocity.y > 0.5 ? 'jump' : 'fall';
    else if (landTimer > 0 && intent < 2) locoAnim = 'land';
    else locoAnim = intent < 0.3 ? 'idle' : intent < WALK_SPEED + 1.2 ? 'walk' : 'run';
    if (override && (clock >= override.until || !grounded)) override = null;
    syncAnim();
    if (avatar) {
      if (avatar.setSpeed) avatar.setSpeed(grounded ? speed : 0);
      avatar.update(dt, t);
    }

    if (grounded && speed > 0.6 && !sliding) {
      stride += speed * dt;
      const len = locoAnim === 'run' ? 2.05 : 1.25;
      if (stride >= len) {
        stride = 0;
        sfx('step', { volume: locoAnim === 'run' ? 0.7 : 0.45 });
        events.emit('step');
      }
    } else stride = 0.6;

    if (marker.visible) {
      marker.scale.setScalar(damp(marker.scale.x, 1 + Math.sin(t * 7) * 0.08, 10, dt));
      marker.rotation.z += dt * 1.5;
    }
    followTarget.heading = heading;
    followTarget.speed = speed;
  }
  const prevCtl = { x: 0, z: 0 };

  function doJump() {
    velocity.y = JUMP_SPEED;
    grounded = false;
    coyote = 0;
    airPeak = position.y;
    sliding = null;
    override = null;
    sfx('jump', { volume: 0.6 });
    events.emit('jump');
  }

  function jump() {
    if (controls.length || rescue.active || frozen) return false;
    if (grounded || coyote > 0) {
      doJump();
      return true;
    }
    jumpBuffer = JUMP_BUFFER;
    return false;
  }

  function getState() {
    return {
      x: Math.round(position.x * 100) / 100,
      y: Math.round(position.y * 100) / 100,
      z: Math.round(position.z * 100) / 100,
      h: Math.round(((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 1000) / 1000,
      anim: wantedAnim(),
    };
  }

  function halt() {
    cancelWalk();
    velocity.x = 0;
    velocity.z = 0;
  }

  function place(x, z, facing) {
    cancelWalk();
    endRescue(true);
    const g = groundAt(x, z);
    position.set(x, Number.isFinite(g) ? g : 0, z);
    grounded = Number.isFinite(g);
    if (typeof facing === 'number') heading = facing;
    group.rotation.y = heading;
    velocity.set(0, 0, 0);
    airPeak = position.y;
    skyTime = 0;
    sliding = null;
    if (grounded) lastSafe = { x, z };
    followTarget.heading = heading;
    if (rig) rig.snapBehind(heading);
  }

  async function teleport(x, z, facing, opts = {}) {
    const fade = opts.fade !== false && hud && hud.fade;
    if (fade) await hud.fade(true, 170);
    place(x, z, facing);
    if (opts.silent !== true) sfx('whoosh', { volume: 0.5 });
    if (fade) await hud.fade(false, 260);
  }

  function takeControl(owner) {
    const token = { owner: owner === undefined ? 'someone' : owner };
    if (rescue.active) endRescue(true);
    halt();
    velocity.y = 0;
    sliding = null;
    override = null;
    controls.push(token);
    ownerAnim = shownAnim || 'idle';
    ownerAnimOpts = undefined;
    prevCtl.x = position.x;
    prevCtl.z = position.z;
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      const i = controls.indexOf(token);
      if (i >= 0) controls.splice(i, 1);
      if (controls.length) return;
      velocity.set(0, 0, 0);
      const g = groundAt(position.x, position.z);
      grounded = Number.isFinite(g) && Math.abs(position.y - g) < 0.08;
      if (grounded) position.y = g;
      airPeak = position.y;
      skyTime = 0;
      shownAnim = null;
    };
  }

  const player = {
    group,
    position,
    velocity,
    update,
    setAvatar,
    walkTo,
    cancelWalk,
    teleport,
    place,
    halt,
    jump,
    takeControl,
    getState,
    radius: RADIUS,
    rescueTo: null,
    rescue: startRescue,
    on: events.on.bind(events),
    off: events.off.bind(events),
    setAnim(name, opts) {
      if (typeof name !== 'string') return;
      if (controls.length) {
        ownerAnim = name;
        ownerAnimOpts = opts;
        shownAnim = null;
      } else {
        override = { anim: name, until: clock + (opts && opts.seconds ? opts.seconds : 3600), opts };
        shownAnim = null;
      }
      syncAnim();
    },
    emote(anim, seconds = 1.6) {
      if (controls.length || rescue.active || !grounded || typeof anim !== 'string') return false;
      override = { anim, until: clock + seconds, opts: { loop: true } };
      shownAnim = null;
      syncAnim();
      return true;
    },
    get avatar() { return avatar; },
    get heading() { return heading; },
    set heading(v) {
      if (Number.isFinite(v)) heading = v;
    },
    get speed() { return speed; },
    get anim() { return wantedAnim(); },
    get grounded() { return grounded; },
    get frozen() { return frozen; },
    set frozen(v) {
      frozen = !!v;
      if (frozen) halt();
    },
    get controller() { return controls.length ? controls[controls.length - 1].owner : null; },
    get rescuing() { return rescue.active; },
    get sliding() { return !!(sliding && grounded); },
    get walking() { return auto.active; },
    get walkTarget() { return auto.active ? { x: auto.x, z: auto.z } : null; },
  };

  if (rig) rig.setFollow(followTarget);
  return player;
}

// ------------------------------------------------------------------------------------ remote players

const POS_LIMIT = 2000;
const NAME_Y = 1.98; // the name tag's centre, just above the bow

export function createPeers({ scene, net, makeCharacter, labels = null, camera = null, meId = () => null }) {
  const peers = new Map(); // id -> { id, nick, bot, look, lookKey, group, character, label, bubble, bubbleUntil, anim, lastPos, speed, visible }
  const root = new THREE.Group();
  root.name = 'peers';
  scene.add(root);

  function lookKey(look) {
    try {
      return JSON.stringify(look || null);
    } catch (err) {
      return 'null';
    }
  }

  function add(p) {
    const group = new THREE.Group();
    group.name = 'peer:' + p.id;
    group.visible = false;
    let character = null;
    try {
      character = makeCharacter(p.look || null);
    } catch (err) {
      console.warn('[c9] could not build a character for a friend', err);
    }
    if (character) group.add(character.group);
    let label = null;
    if (labels) {
      label = labels.nameTag(p.nick, { bot: !!p.bot });
      label.position.y = NAME_Y;
      group.add(label);
    }
    root.add(group);
    const entry = { id: p.id, nick: p.nick, bot: !!p.bot, look: p.look, lookKey: lookKey(p.look), group, character, label, bubble: null, bubbleUntil: 0, anim: null, lastPos: null, speed: 0, emoteUntil: 0 };
    peers.set(p.id, entry);
    return entry;
  }

  function remove(id) {
    const e = peers.get(id);
    if (!e) return;
    peers.delete(id);
    if (e.character && e.character.dispose) {
      try {
        e.character.dispose();
      } catch (err) { /* gone */ }
    }
    if (e.label && labels) labels.release(e.label);
    if (e.bubble && labels) labels.release(e.bubble);
    e.group.removeFromParent();
  }

  function sync() {
    const me = meId();
    const players = net && net.players ? net.players : new Map();
    for (const id of [...peers.keys()]) if (!players.has(id) || id === me) remove(id);
    for (const [id, p] of players) {
      if (id === me || !p) continue;
      const e = peers.get(id);
      if (!e) {
        add(p);
        continue;
      }
      // a new nickname or look: rebuild what changed
      if (p.nick !== e.nick && labels && e.label) {
        labels.release(e.label);
        e.label = labels.nameTag(p.nick, { bot: !!p.bot });
        e.label.position.y = NAME_Y;
        e.group.add(e.label);
        e.nick = p.nick;
      }
      const key = lookKey(p.look);
      if (key !== e.lookKey && e.character) {
        e.lookKey = key;
        try {
          if (e.character.setLook) e.character.setLook(p.look);
        } catch (err) { /* keep the old look */ }
      }
    }
  }

  function emote(id, { text = '', icon = '', anim = null, seconds = 3 } = {}) {
    const e = peers.get(id);
    if (!e) return false;
    if (labels) {
      if (e.bubble) labels.release(e.bubble);
      e.bubble = labels.bubble(text, icon);
      e.bubble.position.y = NAME_Y + 0.25;
      e.group.add(e.bubble);
      e.bubbleUntil = performance.now() + seconds * 1000;
      e.bubblePop = 0;
    }
    if (anim && e.character && e.character.setAnim) {
      e.emoteUntil = performance.now() + 1600;
      e.anim = anim;
      try {
        e.character.setAnim(anim, { loop: true });
      } catch (err) { /* fine */ }
    }
    return true;
  }

  const camPos = new THREE.Vector3();
  function update(dt, t) {
    if (!net) return;
    const now = net.now ? net.now() : Date.now();
    const wall = performance.now();
    if (camera) camPos.copy(camera.position);
    for (const e of peers.values()) {
      let s = null;
      try {
        s = net.stateOf(e.id, now);
      } catch (err) {
        s = null;
      }
      const ok = s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z) && Math.abs(s.x) < POS_LIMIT && Math.abs(s.y) < POS_LIMIT && Math.abs(s.z) < POS_LIMIT;
      if (!ok) {
        e.group.visible = false;
        continue;
      }
      const g = e.group;
      if (!g.visible) {
        g.visible = true;
        g.position.set(s.x, s.y, s.z);
        e.lastPos = { x: s.x, z: s.z };
      }
      g.position.set(s.x, s.y, s.z);
      const h = Number.isFinite(s.h) ? s.h : 0;
      g.rotation.y += angleDelta(g.rotation.y, h) * Math.min(1, dt * 14);
      const moved = e.lastPos ? Math.hypot(s.x - e.lastPos.x, s.z - e.lastPos.z) : 0;
      e.lastPos = { x: s.x, z: s.z };
      e.speed = damp(e.speed, dt > 0 ? Math.min(20, moved / dt) : 0, 8, dt);
      const ch = e.character;
      if (ch) {
        const anim = typeof s.anim === 'string' ? s.anim : 'idle';
        const emoting = wall < e.emoteUntil && (anim === 'idle');
        if (!emoting && anim !== e.anim) {
          e.anim = anim;
          try {
            ch.setAnim(anim, anim === 'land' ? { loop: false } : undefined);
          } catch (err) { /* unknown anims fall back inside the character */ }
        }
        if (ch.setSpeed) ch.setSpeed(e.speed);
        try {
          ch.update(dt, t);
        } catch (err) { /* keep the others moving */ }
      }
      const f = e.label && labels ? labels.place(e.label, camPos, g.position, 1) : 1;
      if (e.bubble) {
        e.bubblePop = Math.min(1, (e.bubblePop || 0) + dt * 6);
        const k = e.bubblePop;
        const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 : 1;
        labels.place(e.bubble, camPos, g.position, pop);
        e.bubble.position.y = NAME_Y + 0.2 * f + 0.05; // just above the name tag
        if (wall > e.bubbleUntil) {
          labels.release(e.bubble);
          e.bubble = null;
        }
      }
    }
  }

  return {
    sync,
    update,
    emote,
    remove,
    get size() { return peers.size; },
    positionOf(id) {
      const e = peers.get(id);
      return e && e.group.visible ? { x: e.group.position.x, y: e.group.position.y, z: e.group.position.z } : null;
    },
    get(id) {
      return peers.get(id) || null;
    },
    list() {
      return [...peers.values()].map((e) => ({ id: e.id, nick: e.nick, bot: e.bot, group: e.group, character: e.character }));
    },
    clear() {
      for (const id of [...peers.keys()]) remove(id);
    },
    dispose() {
      for (const id of [...peers.keys()]) remove(id);
      root.removeFromParent();
    },
  };
}
