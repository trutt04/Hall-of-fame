// Pets: a cloud puppy (js/art/pet.js) for every player whose look has `pet: 'cloudPuppy'`: me, and
// friends in a room (following their interpolated positions). Never bots, so it stays special.
// A pet follows its owner with a soft spring about 1.2 m behind and to one side, floating a little
// above the ground with a gentle bob. It hops along when she moves, settles and sits when she stands
// still, and does a happy spin when she cheers or lands a toss. It poofs along with her when she
// teleports (travel, the rescue cloud), waits at the pad and bounces during her basket toss, sits
// beside the stage mat during Hit Zero and beside her in the photo booth (in the picture). During
// squad games it poofs into a tiny cloud (a pet following a hider would give her away) and comes
// back after. It never collides with anything and is never a camera blocker.
//
//   const pets = createPets(world, { myLook })     myLook() -> my current look
//   pets.update(dt, t)          once a frame, after the player, the toss and the peers
//   pets.sync()                 match pets to looks (mine and net.players); also runs on net events
//   pets.cheer(id)              a happy spin: id 'me' or a player id
//   pets.arrive(id)             the unlock moment: a poof right beside her, a happy bark and a spin
//   pets.count                  pets in the world;  pets.mine -> my pet's entry or null (tests)
//   pets.track(id, owner)       tests: a pet for any owner { position, heading, speed } (null removes)
//   pets.dispose()
//
// Pure helpers (node tests): PET, wantsPet(look), followSpot(x, z, heading, side, out),
// springStep(s, target, omega, dt), petMode(flags), stageSpot(stage, x, z, out), padSpot(pad, out)

import * as THREE from '../../lib/three.module.min.js';
import { createPuppy, PIVOT_Y } from '../art/pet.js';
import { motion, isReducedMotion } from '../art/util.js';

export const PET = Object.freeze({
  back: 1.0, // metres behind her...
  beside: 0.65, // ... and to one side: about 1.2 m from her
  omega: 5, // spring stiffness (critically damped: it never overshoots)
  catchUp: 14, // farther than this from where it should be: it poofs there
  jump: 3, // she moved this far in one frame: a teleport
  airborne: 2.5, // she is this high above the ground (a toss, a fall): it waits below
  stageSide: 7, // Hit Zero: beside the 12 m mat, this far from its middle
  max: 10, // pets at most (a full room)
});
const SPIN = 0.75;
const LOCO = new Set(['idle', 'walk', 'run', 'jump', 'fall', 'land']);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = Number.isFinite;
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
const smooth = (x) => x * x * (3 - 2 * x);

// ---- pure helpers --------------------------------------------------------------------------------

export function wantsPet(look) {
  return !!look && typeof look === 'object' && look.pet === 'cloudPuppy';
}

// Where a pet likes to be: behind her and to one side (side +1 is her right, -1 her left).
// heading 0 faces +Z; her right is then -X.
export function followSpot(x, z, heading, side, out, back = PET.back, beside = PET.beside) {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  out.x = x - s * back - c * beside * side;
  out.z = z - c * back + s * beside * side;
  return out;
}

// One step of a critically damped spring toward the target, exact for any dt (no overshoot, no
// blow-up on a slow frame). s = { x, z, vx, vz } (and y, vy when the target has y).
export function springStep(s, target, omega, dt) {
  const e = Math.exp(-omega * dt);
  if (fin(target.x)) {
    const x = s.x - target.x;
    const k = (s.vx + omega * x) * dt;
    s.vx = (s.vx - omega * k) * e;
    s.x = target.x + (x + k) * e;
  }
  if (fin(target.y) && fin(s.y)) {
    const y = s.y - target.y;
    const k = (s.vy + omega * y) * dt;
    s.vy = (s.vy - omega * k) * e;
    s.y = target.y + (y + k) * e;
  }
  if (fin(target.z)) {
    const z = s.z - target.z;
    const k = (s.vz + omega * z) * dt;
    s.vz = (s.vz - omega * k) * e;
    s.z = target.z + (z + k) * e;
  }
  return s;
}

// What a pet is doing, from what its owner is doing (first match wins).
export function petMode(f) {
  if (!f || !f.visible) return 'away'; // not on the island (yet)
  if (f.game) return 'hidden'; // squad games: it would give a hider away
  if (f.rescuing) return 'hidden'; // the rescue cloud: back with a poof when she lands
  if (f.tossing) return 'wait'; // her basket toss: waits at the pad and bounces
  if (f.stage) return 'stage'; // Hit Zero: sits beside the mat
  if (f.booth) return 'booth'; // the photo booth: sits beside her, in the picture
  if (f.airborne) return 'wait'; // way up (a friend's toss): waits below
  return 'follow';
}

// Hit Zero: beside the mat on her side of it, a little toward the judges. stage = { x, z, facing }.
export function stageSpot(stage, x, z, out) {
  const f = fin(stage.facing) ? stage.facing : 0;
  const c = Math.cos(f);
  const s = Math.sin(f);
  const dx = x - stage.x;
  const dz = z - stage.z;
  const lx = c * dx - s * dz; // across the mat
  const lz = s * dx + c * dz; // toward the judges
  const ax = (lx >= 0 ? 1 : -1) * PET.stageSide;
  const az = clamp(lz + 1.2, -5, 5);
  out.x = stage.x + c * ax + s * az;
  out.z = stage.z - s * ax + c * az;
  return out;
}

// The basket toss: beside the pad's mat, a little behind it (pad = { x, z, heading }).
export function padSpot(pad, out) {
  const h = fin(pad.heading) ? pad.heading : 0;
  const lx = 2.3;
  const lz = -0.7;
  out.x = pad.x + Math.cos(h) * lx + Math.sin(h) * lz;
  out.z = pad.z - Math.sin(h) * lx + Math.cos(h) * lz;
  return out;
}

// ---- the poof: a tiny cloud of soft puffs, all pets' poofs in one draw call -----------------------

function createPuffs(scene) {
  const N = 72;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const alpha = new Float32Array(N);
  const age = new Float32Array(N).fill(99);
  const life = new Float32Array(N).fill(1);
  const s0 = new Float32Array(N);
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -9999;
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3);
  const aSize = new THREE.BufferAttribute(size, 1);
  const aAlpha = new THREE.BufferAttribute(alpha, 1);
  for (const a of [aPos, aSize, aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aAlpha', aAlpha);
  const uScale = { value: 400 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale },
    transparent: true,
    depthWrite: false,
    vertexShader: [
      'attribute float aSize;',
      'attribute float aAlpha;',
      'uniform float uScale;',
      'varying float vA;',
      'void main() {',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  gl_Position = projectionMatrix * mv;',
      '  gl_PointSize = aSize * uScale / max(0.2, -mv.z);',
      '  vA = aAlpha;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying float vA;',
      'void main() {',
      '  vec2 p = gl_PointCoord * 2.0 - 1.0;',
      '  float d = dot(p, p);',
      '  if (d > 1.0 || vA < 0.01) discard;',
      '  vec3 col = mix(vec3(1.0, 0.99, 1.0), vec3(0.86, 0.8, 0.98), smoothstep(-0.1, 1.0, p.y) * 0.7);',
      '  gl_FragColor = vec4(col, vA * smoothstep(1.0, 0.45, d));',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'petPoofs';
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.visible = false;
  scene.add(points);
  let next = 0;
  let live = 0;
  return {
    points,
    poof(x, y, z, scale = 1) {
      const n = isReducedMotion() ? 7 : 12;
      for (let k = 0; k < n; k++) {
        const i = next;
        next = (next + 1) % N;
        const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
        const sp = (0.9 + Math.random() * 0.7) * scale;
        pos[i * 3] = x + Math.cos(a) * 0.12 * scale;
        pos[i * 3 + 1] = y + (Math.random() - 0.3) * 0.25 * scale;
        pos[i * 3 + 2] = z + Math.sin(a) * 0.12 * scale;
        vel[i * 3] = Math.cos(a) * sp;
        vel[i * 3 + 1] = (0.35 + Math.random() * 0.9) * scale;
        vel[i * 3 + 2] = Math.sin(a) * sp;
        age[i] = 0;
        life[i] = 0.5 + Math.random() * 0.3;
        s0[i] = (0.2 + Math.random() * 0.17) * scale;
      }
      live = 1.2;
      points.visible = true;
    },
    update(dt, camera, renderer) {
      if (live <= 0) return;
      live -= dt;
      const drag = Math.exp(-3.6 * dt);
      for (let i = 0; i < N; i++) {
        if (age[i] >= life[i]) {
          if (alpha[i] !== 0) {
            alpha[i] = 0;
            size[i] = 0;
          }
          continue;
        }
        age[i] += dt;
        const u = Math.min(1, age[i] / life[i]);
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3] *= drag;
        vel[i * 3 + 1] *= drag;
        vel[i * 3 + 2] *= drag;
        size[i] = s0[i] * (0.55 + 1.05 * (1 - (1 - u) * (1 - u)));
        alpha[i] = Math.pow(1 - u, 1.4) * Math.min(1, age[i] * 14) * 0.95;
      }
      aPos.needsUpdate = true;
      aSize.needsUpdate = true;
      aAlpha.needsUpdate = true;
      if (camera && renderer) {
        const h = renderer.domElement ? renderer.domElement.height : 800;
        uScale.value = h / (2 * Math.tan(((camera.fov || 50) * Math.PI) / 360));
      }
      if (live <= 0) points.visible = false;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      points.removeFromParent();
    },
  };
}

// ---- a happy little bark: two short "arf!"s, synthesized like the game's other sounds ------------

function bark(audio) {
  let ok = false;
  try {
    const real = audio && audio.real;
    const ctx = real && real.context;
    if (audio && audio.enabled && ctx && ctx.state === 'running') {
      const t0 = ctx.currentTime + 0.02;
      const out = ctx.createGain();
      out.gain.value = 0.32;
      out.connect(ctx.destination);
      [[0, 1], [0.2, 1.12]].forEach(([at, p]) => {
        const t = t0 + at;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(560 * p, t);
        o.frequency.linearRampToValueAtTime(760 * p, t + 0.035);
        o.frequency.exponentialRampToValueAtTime(380 * p, t + 0.15);
        const f1 = ctx.createBiquadFilter(); // the "a" in "arf"
        f1.type = 'bandpass';
        f1.Q.value = 3;
        f1.frequency.setValueAtTime(1300, t);
        f1.frequency.exponentialRampToValueAtTime(800, t + 0.15);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.014);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
        o.connect(f1);
        f1.connect(lp);
        lp.connect(g);
        g.connect(out);
        o.start(t);
        o.stop(t + 0.2);
      });
      setTimeout(() => {
        try { out.disconnect(); } catch (err) { /* gone */ }
      }, 900);
      ok = true;
    }
  } catch (err) {
    ok = false;
  }
  if (!ok && audio && typeof audio.sfx === 'function') {
    // no context of our own to play on: the closest of the game's sounds, twice ("arf arf!")
    audio.sfx('pop', { volume: 0.7, pitch: 0.8 });
    setTimeout(() => audio.sfx('pop', { volume: 0.7, pitch: 0.95 }), 190);
  }
}

// ---- the pets ------------------------------------------------------------------------------------

export function createPets(world, { myLook = () => world.look } = {}) {
  const { scene, player, net, groundAt } = world;
  const root = new THREE.Group();
  root.name = 'pets';
  scene.add(root);
  const puffs = createPuffs(scene);
  const pets = new Map(); // owner id ('me' for me) -> entry
  const list = []; // the same entries, for the frame loop (no iterator per frame)
  const tracked = new Map(); // tests: owner id -> { position, heading, speed } or 'peer' (any peer, even a bot)
  const own = { x: 0, y: 0, z: 0, h: 0, speed: 0, anim: 'idle', visible: false, ground: -Infinity };
  const flags = { visible: false, game: false, rescuing: false, tossing: false, stage: false, booth: false, airborne: false };
  const tgt = { x: 0, y: 0, z: 0 };
  const spot = { x: 0, z: 0 };
  const camPos = new THREE.Vector3();
  let syncIn = 0;

  const meId = () => (net && net.me ? net.me.id : null);
  const groundY = (x, z) => {
    let y = -Infinity;
    try {
      y = groundAt(x, z);
    } catch (err) {
      y = -Infinity;
    }
    return fin(y) ? y : -Infinity;
  };

  function add(id, mine) {
    const model = createPuppy();
    model.body.rotation.order = 'YXZ';
    model.group.visible = false;
    root.add(model.group);
    const e = {
      id, mine, model, visible: false, mode: 'away',
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, th: 0, side: mine ? 1 : sideFor(id),
      ox: NaN, oz: NaN, still: 0, sit: 0, move: 0, hopPh: Math.random() * 3, spinT: 0, happyT: 0, excite: 0,
      lastY: 0, bodyY: 0, ph: Math.random() * 6, tiltT: 2 + Math.random() * 3, tilt: 0, wait: null, arrive: 0,
    };
    pets.set(id, e);
    list.push(e);
    return e;
  }
  function sideFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 2 ? 1 : -1;
  }
  function remove(id, poof) {
    const e = pets.get(id);
    if (!e) return;
    if (poof && e.visible) puffOut(e);
    pets.delete(id);
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    e.model.dispose();
  }

  // ---- who has a pet
  function sync() {
    const want = new Set();
    if (wantsPet(safe(myLook))) want.add('me');
    const me = meId();
    const players = net && net.players;
    if (players && typeof players.forEach === 'function') {
      players.forEach((p, id) => {
        if (!p || p.bot || id === me || want.size >= PET.max) return;
        if (wantsPet(p.look)) want.add(id);
      });
    }
    for (const id of tracked.keys()) if (want.size < PET.max) want.add(id);
    for (const id of [...pets.keys()]) if (!want.has(id)) remove(id, true);
    for (const id of want) if (!pets.has(id)) add(id, id === 'me');
  }
  function safe(fn) {
    try {
      return fn();
    } catch (err) {
      return null;
    }
  }
  const onNet = () => sync();
  const NET_EVENTS = ['join', 'leave', 'player', 'room', 'status'];
  if (net && typeof net.on === 'function') for (const ev of NET_EVENTS) net.on(ev, onNet);

  // ---- owners
  function readOwner(e) {
    own.visible = false;
    const tr = tracked.get(e.id);
    if (e.mine) {
      const p = player.position;
      own.x = p.x;
      own.y = p.y;
      own.z = p.z;
      own.h = player.heading;
      own.speed = player.speed || 0;
      own.anim = player.anim;
      own.visible = world.mode !== 'boot';
    } else if (tr && tr.position) {
      const o = tr;
      own.x = o.position.x;
      own.y = o.position.y;
      own.z = o.position.z;
      own.h = o.heading || 0;
      own.speed = o.speed || 0;
      own.anim = o.anim || 'idle';
      own.visible = true;
    } else {
      const pe = world.peers && world.peers.get ? world.peers.get(e.id) : null;
      if (pe && pe.group && pe.group.visible) {
        const p = pe.group.position;
        own.x = p.x;
        own.y = p.y;
        own.z = p.z;
        own.h = pe.group.rotation.y;
        own.speed = pe.speed || 0;
        own.anim = pe.anim || 'idle';
        own.visible = true;
      }
    }
    own.ground = own.visible ? groundY(own.x, own.z) : -Infinity;
    return own;
  }
  const stage = () => {
    const s = world.places && world.places.stage;
    return s && fin(s.x) && fin(s.z) ? s : null;
  };
  function onMat(x, z) {
    const s = stage();
    if (!s) return false;
    const f = fin(s.facing) ? s.facing : 0;
    const dx = x - s.x;
    const dz = z - s.z;
    return Math.abs(Math.cos(f) * dx - Math.sin(f) * dz) <= 6 && Math.abs(Math.sin(f) * dx + Math.cos(f) * dz) <= 6;
  }
  function modeFor(e) {
    const o = own;
    flags.visible = o.visible;
    flags.game = !!world.activeGame;
    const ctl = e.mine ? player.controller : null;
    flags.rescuing = e.mine && !!player.rescuing;
    flags.tossing = e.mine && !!(world.toss && world.toss.active);
    flags.stage = e.mine ? ctl === 'hitZero' : onMat(o.x, o.z) && !LOCO.has(o.anim);
    flags.booth = e.mine && ctl === 'photoBooth';
    flags.airborne = !fin(o.ground) || o.y - o.ground > PET.airborne;
    return petMode(flags);
  }

  // ---- poofs
  function puffOut(e) {
    puffs.poof(e.x, e.bodyY + 0.2, e.z, 1);
    sound('pop', e, 0.4, 1.35);
    e.visible = false;
    e.model.group.visible = false;
  }
  function puffIn(e, x, z, y) {
    e.x = x;
    e.z = z;
    e.y = y;
    e.vx = e.vy = e.vz = 0;
    e.visible = true;
    e.model.group.visible = true;
    e.still = 0;
    puffs.poof(x, y + 0.35, z, 1);
    sound('pop', e, 0.45, 1.6);
  }
  function sound(name, e, volume, pitch) {
    try {
      if (world.audio && world.audio.sfx) world.audio.sfx(name, e.mine ? { volume, pitch } : { volume: volume * 0.8, pitch, x: e.x, z: e.z });
    } catch (err) { /* sound is a bonus */ }
  }
  // where it floats: over the ground under it or under her, whichever is higher (it is a cloud:
  // beside her on a cloud platform it floats over open sky); her own height when both are sky
  function floorY(g, o) {
    const b = Math.max(g, o.ground);
    return fin(b) ? b : o.y;
  }

  // ---- the frame
  function update(dt, t) {
    dt = Math.min(0.1, Math.max(0, dt));
    if ((syncIn -= dt) <= 0) {
      syncIn = 1; // a slow safety net; net events do the real work
      sync();
    }
    if (world.camera) camPos.copy(world.camera.position);
    for (let i = 0; i < list.length; i++) step(list[i], dt, t);
    puffs.update(dt, world.camera, world.renderer);
  }

  function step(e, dt, t) {
    const o = readOwner(e);
    let mode = modeFor(e);
    if (mode === 'stage' && !stage()) mode = 'follow';
    e.mode = mode;
    if (e.arrive > 0) e.arrive = Math.max(0, e.arrive - dt); // an unlock hello waits a few seconds at most
    // gone: poof out (games, the rescue cloud) or just go (she left the island)
    if (mode === 'away' || mode === 'hidden') {
      if (e.visible) {
        if (mode === 'hidden') puffOut(e);
        else {
          e.visible = false;
          e.model.group.visible = false;
        }
      }
      e.ox = NaN;
      e.wait = null;
      return;
    }
    // where it wants to be
    let face = NaN; // a heading to face, or NaN to face where it goes
    if (mode === 'wait') {
      if (!e.wait) {
        e.wait = { x: e.visible ? e.x : o.x, z: e.visible ? e.z : o.z };
        const pad = e.mine && flags.tossing ? nearestPad(o.x, o.z) : null;
        if (pad && fin(groundY(padSpot(pad, spot).x, spot.z))) {
          e.wait.x = spot.x;
          e.wait.z = spot.z;
        }
      }
      tgt.x = e.wait.x;
      tgt.z = e.wait.z;
    } else {
      e.wait = null;
      if (mode === 'stage') {
        stageSpot(stage(), o.x, o.z, tgt);
      } else if (mode === 'booth') {
        // in front of her and to her right, toward the lens: in the picture with her
        const s = Math.sin(o.h);
        const c = Math.cos(o.h);
        tgt.x = o.x + s * 0.5 - c * 0.52;
        tgt.z = o.z + c * 0.5 + s * 0.52;
        face = o.h;
      } else {
        if (!e.visible) e.th = o.h;
        else if (o.speed > 0.35) e.th += angleDelta(e.th, o.h) * Math.min(1, dt * 6);
        followSpot(o.x, o.z, e.th, e.side, tgt);
      }
    }
    let gp = groundY(e.x, e.z); // the ground under it (the shadow, and how high it floats)
    tgt.y = floorY(gp, o);
    // she jumped somewhere (travel, the stage, the booth's mark, back from the rescue cloud): poof along
    const jumped = fin(e.ox) && Math.hypot(o.x - e.ox, o.z - e.oz) > PET.jump;
    e.ox = o.x;
    e.oz = o.z;
    if (!e.visible || jumped || Math.hypot(tgt.x - e.x, tgt.z - e.z) > PET.catchUp) {
      if (e.visible) puffOut(e);
      let x = tgt.x;
      let z = tgt.z;
      if (e.arrive > 0) {
        // the unlock moment: right in front of her and to her right, where the camera sees it
        const s = Math.sin(o.h);
        const c = Math.cos(o.h);
        x = o.x + s * 1.1 - c * 0.7;
        z = o.z + c * 1.1 + s * 0.7;
        if (!fin(groundY(x, z))) {
          x = tgt.x;
          z = tgt.z;
        }
      }
      gp = groundY(x, z);
      tgt.y = floorY(gp, o);
      puffIn(e, x, z, tgt.y);
      e.heading = Math.atan2(o.x - x, o.z - z);
      if (e.arrive > 0) {
        e.arrive = 0;
        bark(world.audio);
        e.spinT = SPIN;
        e.happyT = 3;
        if (world.spawnBurst) world.spawnBurst(x, e.y + 0.6, z, { count: 26, speed: 3.2, size: 0.4 });
      }
    }
    // the spring (x, z, and y on its own softer spring)
    const far = Math.hypot(tgt.x - e.x, tgt.z - e.z);
    const om = mode === 'follow' ? PET.omega + clamp(far - 2, 0, 6) * 1.2 : 4;
    springStep(e, tgt, om, dt);
    const sp = Math.hypot(e.vx, e.vz);
    // moving, still, sitting
    if (o.speed < 0.25 && sp < 0.4) e.still += dt;
    else e.still = 0;
    const wantSit = mode === 'stage' || mode === 'booth' || (mode === 'follow' && e.still > 0.7);
    e.sit += ((wantSit ? 1 : 0) - e.sit) * Math.min(1, dt * 5);
    e.move += (clamp(sp / 3, 0, 1) - e.move) * Math.min(1, dt * 6);
    e.excite += ((mode === 'wait' ? 1 : 0) - e.excite) * Math.min(1, dt * 4);
    // facing: where it goes; else its owner (or the lens)
    let want = face;
    if (!fin(want)) want = sp > 0.5 ? Math.atan2(e.vx, e.vz) : Math.atan2(o.x - e.x, o.z - e.z);
    e.heading += angleDelta(e.heading, want) * Math.min(1, dt * (sp > 0.5 ? 9 : 4));
    // hops while it goes, bounces while it waits, a soft float and bob always
    const m = motion();
    const glide = smooth(clamp((sp - 4.5) / 3.5, 0, 1));
    let hop = 0;
    if (e.excite > 0.05) {
      e.hopPh += dt * 8.5;
      hop = Math.abs(Math.sin(e.hopPh)) * 0.2 * e.excite * m;
    } else if (sp > 0.45) {
      e.hopPh += dt * (6.5 + Math.min(6, sp) * 0.9);
      hop = Math.abs(Math.sin(e.hopPh)) * (0.13 + Math.min(0.08, sp * 0.02)) * (1 - glide) * m;
    } else {
      e.hopPh = 0;
    }
    // the happy spin, and a curious head tilt now and then while it sits
    let spinYaw = 0;
    if (e.spinT > 0) {
      e.spinT = Math.max(0, e.spinT - dt);
      const u = 1 - e.spinT / SPIN;
      if (!isReducedMotion()) spinYaw = Math.PI * 2 * smooth(u);
      hop += Math.sin(Math.PI * u) * 0.32 * (isReducedMotion() ? 0.4 : 1);
    }
    if (e.happyT > 0) e.happyT -= dt;
    if ((e.tiltT -= dt) <= 0) {
      e.tiltT = 3 + Math.random() * 4;
      e.tilt = e.sit > 0.5 && Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) * 0.32 : 0;
    }
    if (e.sit < 0.5) e.tilt = 0;
    const hover = 0.26 - 0.2 * e.sit;
    const bob = Math.sin(t * 2.3 + e.ph) * 0.035 * (1 - 0.6 * e.sit) * m;
    const g = e.model.group;
    g.position.set(e.x, e.y, e.z);
    const body = e.model.body;
    e.bodyY = e.y + hover + bob + hop;
    body.position.y = PIVOT_Y + hover + bob + hop;
    const c2 = Math.cos(e.hopPh * 2);
    const hopping = hop > 0.001 && e.spinT <= 0 ? 1 : 0;
    const sy = 1 - 0.08 * Math.pow(Math.max(0, c2), 3) * hopping + 0.05 * (1 - Math.abs(c2)) * hopping;
    const sxz = 1 / Math.sqrt(sy);
    body.scale.set(sxz, sy, sxz);
    body.rotation.set(-0.3 * e.sit + 0.14 * e.move * (1 - glide) + 0.1 * glide, e.heading + spinYaw, Math.sin(t * 6 + e.ph) * 0.05 * e.move * m);
    // the shadow stays on the ground and shrinks as it floats up
    const sh = e.model.shadow;
    if (sh) {
      const above = e.bodyY - gp;
      sh.visible = fin(gp) && above < 3;
      if (sh.visible) {
        sh.position.y = gp - e.y + 0.03;
        const k = clamp(1 - above * 0.35, 0.35, 1);
        sh.scale.set(0.27 * k, 1, 0.3 * k);
      }
    }
    // mood for the model: ears, tail, tongue, eyes, head
    const mood = e.model.mood;
    mood.sit = e.sit;
    mood.move = e.move;
    mood.excite = e.excite;
    mood.happy = e.happyT > 0 || e.spinT > 0 || mode === 'booth' ? 1 : 0;
    mood.vy = dt > 0 ? (e.bodyY - e.lastY) / dt : 0;
    e.lastY = e.bodyY;
    mood.tilt = e.tilt;
    // sitting, it looks at the camera; waiting, up at her
    let look = 0;
    if (e.sit > 0.5 && mode !== 'booth') look = angleDelta(e.heading, Math.atan2(camPos.x - e.x, camPos.z - e.z));
    mood.look = Math.abs(look) < 1.6 ? look : 0;
    e.model.update(dt, t);
  }

  function nearestPad(x, z) {
    const list = world.toss && Array.isArray(world.toss.pads) ? world.toss.pads : (world.places && world.places.tossPads) || [];
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || !fin(p.x) || !fin(p.z)) continue;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best && !fin(best.heading) && fin(best.facing)) return { x: best.x, z: best.z, heading: best.facing };
    return best;
  }

  function idFor(id) {
    if (id === 'me') return 'me';
    const me = meId();
    return id && id === me ? 'me' : id;
  }

  return {
    update,
    sync,
    cheer(id) {
      const e = pets.get(idFor(id));
      if (!e || !e.visible) return false;
      e.spinT = SPIN;
      e.happyT = 2.2;
      if (world.spawnBurst && !isReducedMotion()) world.spawnBurst(e.x, e.bodyY + 0.6, e.z, { count: 10, speed: 2.2, size: 0.3 });
      return true;
    },
    arrive(id) {
      sync();
      const e = pets.get(idFor(id));
      if (!e) return false;
      e.arrive = 6;
      if (e.visible) {
        // already here (she wore it before): it bounds over with the same hello
        e.visible = false;
        e.model.group.visible = false;
      }
      return true;
    },
    track(id, owner) {
      if (owner === 'peer' || (owner && owner.position)) tracked.set(id, owner);
      else tracked.delete(id);
      sync();
    },
    get count() { return pets.size; },
    get visibleCount() {
      let n = 0;
      for (const e of pets.values()) if (e.visible) n++;
      return n;
    },
    get mine() { return pets.get('me') || null; },
    get(id) { return pets.get(idFor(id)) || null; },
    get puffs() { return puffs.points; },
    dispose() {
      if (net && typeof net.off === 'function') for (const ev of NET_EVENTS) net.off(ev, onNet);
      for (const id of [...pets.keys()]) remove(id, false);
      puffs.dispose();
      root.removeFromParent();
    },
  };
}
