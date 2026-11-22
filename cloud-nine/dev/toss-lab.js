// Basket toss lab: a small stand-in world with just what js/world/toss.js needs from Contracts 1
// and 2: scene, camera, renderer, the real input and camera rig, a simple player with takeControl,
// groundAt over a sky island and three cloud platforms (8, 14 and 22 m), places.tossPads, and
// hud, audio, interact and net stubs (with fake friends you can put on the base spots).
// Uses js/art/character.js and js/content/hype.js when they exist, stand-ins otherwise.
//
// URL: ?pad=0|1|2   start on that pad's mat        ?friends=0..4  real friends on that pad's spots
//      ?rm=1        pretend prefers-reduced-motion  ?quality=low
//      ?ui=0        hide the lab panel              ?manual=1      no animation loop (drive it with step)
//      ?poses=1     a gallery of every toss pose    ?bot=spot      park the bot on a base spot (it must not count)
//      ?classic=1   the middle pad has no cloud to aim at: a straight-up toss back into the bases' arms
//
// Hooks: window.__c9 is the world. window.__tossLab = { world, toss, net, audio, step(sec), start(i),
//   gesture(g), setFriends(n, pad), baseMe(pad, spot), friendToss(pad), goPad(i), home(), state(), stats() }

const q = new URLSearchParams(location.search);
if (q.get('rm') === '1') {
  const real = window.matchMedia ? window.matchMedia.bind(window) : null;
  window.matchMedia = (m) => (String(m).includes('prefers-reduced-motion')
    ? { matches: true, media: m, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
    : real(m));
}

const THREE = await import('../lib/three.module.min.js');
const { PALETTE } = await import('../js/config.js');
const { createEngine } = await import('../js/core/engine.js');
const { createInput } = await import('../js/core/input.js');
const { createCameraRig } = await import('../js/core/camera.js');
const { createColliders } = await import('../js/core/colliders.js');
const { damp, dampAngle, clamp, lerp } = await import('../js/core/util.js');
const { Geo } = await import('../js/art/geo.js');
const { flatMat } = await import('../js/art/materials.js');
const { setReducedMotion } = await import('../js/art/util.js');
const { TOSS, solveToss, heightAt } = await import('../js/world/toss-rules.js');
const { createStandin, standinStyle, STANDIN_ANIMS } = await import('../js/world/toss-standin.js');
const { starTexture } = await import('../js/world/toss-fx.js');
const { createToss } = await import('../js/world/toss.js');

const RM = q.get('rm') === '1';
const MANUAL = q.get('manual') === '1';
const QUALITY = q.get('quality') === 'low' ? 'low' : 'high';
const POSES = q.get('poses') === '1';
setReducedMotion(RM);
const hex = (c) => parseInt(String(c).replace('#', ''), 16);

// ------------------------------------------------------------------ the place
const ISLAND_R = 30;
const SPAWN = { x: 0, z: -2, facing: Math.PI };
const PLATFORMS = [
  { id: 'cloud-8', x: -14, y: 8, z: -37, r: 4.6 },
  { id: 'cloud-14', x: 2, y: 14, z: -42, r: 4.2 },
  { id: 'cloud-22', x: 17, y: 22, z: -37, r: 3.9 },
];
const PADS = [
  { id: 'toss-1', x: -10, z: -18, targetPlatformId: 'cloud-8' },
  { id: 'toss-2', x: 0, z: -20, targetPlatformId: 'cloud-14' },
  { id: 'toss-3', x: 10, z: -18, targetPlatformId: 'cloud-22' },
].map((p) => {
  const t = PLATFORMS.find((c) => c.id === p.targetPlatformId);
  return Object.assign(p, { facing: Math.atan2(t.x - p.x, t.z - p.z) });
});
// ?classic=1: the middle pad aims at a cloud that does not exist, so it does a straight-up classic toss
if (q.get('classic') === '1') PADS[1].targetPlatformId = 'no-such-cloud';

function groundAt(x, z) {
  let best = -Infinity;
  for (const p of PLATFORMS) if (Math.hypot(x - p.x, z - p.z) <= p.r) best = Math.max(best, p.y);
  if (Math.hypot(x, z) <= ISLAND_R) best = Math.max(best, 0);
  return best;
}

// ------------------------------------------------------------------ engine, scene, light, sky
const canvas = document.getElementById('scene');
const engine = createEngine({ canvas, quality: QUALITY === 'low' ? 'low' : 'auto' });
const { scene, camera, renderer } = engine;
renderer.setClearColor(hex(PALETTE.skyHorizon), 1);
scene.fog = new THREE.Fog(hex(PALETTE.skyHorizon), 80, 300);
// about League World's noon (sun 3.1, hemi 1.95): three r160 lights are physical, so they run high
const hemi = new THREE.HemisphereLight(0xf3eeff, 0xcbb6ef, 1.9);
const sun = new THREE.DirectionalLight(0xfff1e2, 2.6);
sun.position.set(30, 50, 20);
const amb = new THREE.AmbientLight(0xffffff, 0.28);
scene.add(hemi, sun, amb);

const sky = (() => {
  const g = new THREE.SphereGeometry(420, 24, 14);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(PALETTE.skyTop);
  const hor = new THREE.Color(PALETTE.skyHorizon);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = clamp(pos.getY(i) / 420, 0, 1);
    c.copy(hor).lerp(top, Math.pow(k, 0.55));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  m.frustumCulled = false;
  scene.add(m);
  return m;
})();

function puff(g, x, y, z, r, color, o = {}) {
  g.ico(x, y, z, r, color, Object.assign({ detail: 1, sy: 0.62 }, o));
}

// the island: grass on top, pastel rock below, a ring of clouds around the rim
(() => {
  const g = new Geo();
  g.cyl(0, -0.8, 0, ISLAND_R, 0.8, hex(PALETTE.grassDark), { seg: 48, top: hex(PALETTE.grass) });
  g.lathe(0, -0.8, 0, [[0.5, -27, hex(PALETTE.lavender)], [5, -24], [13, -17, hex(PALETTE.lilac)], [22, -9], [27.5, -3.5, hex(PALETTE.cloudShadow)], [ISLAND_R, 0]], hex(PALETTE.lavender), { seg: 36, capTop: false });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    puff(g, Math.cos(a) * (ISLAND_R + 0.6), -1.6 + (i % 3) * 0.35, Math.sin(a) * (ISLAND_R + 0.6), 2.6 + (i % 4) * 0.45, i % 5 === 2 ? hex(PALETTE.pinkPale) : hex(PALETTE.cloud));
  }
  g.disc(0, 0.012, -2, 5.5, hex(PALETTE.pinkPale), { seg: 32 });
  g.box(0, 0.006, -12, 2.4, 0.01, 15, hex(PALETTE.pinkPale));
  g.box(0, 0.006, -17.5, 22, 0.01, 2.2, hex(PALETTE.pinkPale));
  // lollipop trees and flowers, kept off the pads, the path and the plaza
  const trees = [[-18, 6], [-22, -6], [17, 4], [21, -8], [-6, 12], [8, 14], [-15, 17], [14, 19], [-24, 8], [24, 10], [-3, 22], [5, -27]];
  const crowns = [PALETTE.mint, PALETTE.pinkSoft, PALETTE.lemon, PALETTE.lilac, PALETTE.peach];
  trees.forEach(([x, z], i) => {
    g.cyl(x, 0, z, 0.22, 2.1, hex(PALETTE.peach), { seg: 6 });
    g.ico(x, 2.8, z, 1.25 + (i % 3) * 0.2, hex(crowns[i % crowns.length]), { detail: 1 });
  });
  for (let i = 0; i < 90; i++) {
    const a = i * 2.39996;
    const r = 7 + ((i * 37) % 21);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z < -12 && Math.abs(x) < 14) continue;
    g.ico(x, 0.12, z, 0.13, hex([PALETTE.pink, PALETTE.lemon, PALETTE.white, PALETTE.lavender][i % 4]), { detail: 0 });
  }
  const m = g.mesh(flatMat);
  m.name = 'labIsland';
  scene.add(m);
})();

// the cloud platforms: a flat walkable top and puffy sides; plus far-off decor clouds
(() => {
  const g = new Geo();
  for (const p of PLATFORMS) {
    g.cyl(p.x, p.y - 0.5, p.z, p.r, 0.5, hex(PALETTE.cloudShadow), { seg: 28, top: hex(PALETTE.cloud) });
    const n = Math.round(p.r * 3.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      puff(g, p.x + Math.cos(a) * (p.r - 0.1), p.y - 0.72, p.z + Math.sin(a) * (p.r - 0.1), 1.0 + (i % 3) * 0.16, i % 4 === 1 ? hex(PALETTE.pinkPale) : hex(PALETTE.cloud));
    }
    puff(g, p.x, p.y - 2.3, p.z, p.r * 0.85, hex(PALETTE.cloudShadow), { sy: 0.45 });
    puff(g, p.x + 1, p.y - 3.0, p.z - 0.6, p.r * 0.55, hex(PALETTE.lilac), { sy: 0.5 });
  }
  const far = [[-70, 16, -60, 7], [60, 24, -80, 9], [90, 8, 20, 8], [-95, 30, 40, 10], [20, 40, -130, 12], [-40, -12, -90, 9], [40, -20, 70, 10]];
  for (const [x, y, z, r] of far) {
    puff(g, x, y, z, r, hex(PALETTE.cloud));
    puff(g, x + r * 0.9, y - r * 0.15, z + 1, r * 0.7, hex(PALETTE.pinkPale));
    puff(g, x - r * 0.9, y - r * 0.2, z - 1, r * 0.65, hex(PALETTE.cloud));
  }
  const m = g.mesh(flatMat);
  m.name = 'labClouds';
  scene.add(m);
})();

// ------------------------------------------------------------------ stand-in HUD (Contract 1)
const hudRoot = document.getElementById('hud');
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function createLabHud(root) {
  const toasts = el('div', 'lab-toasts');
  const fadeEl = el('div', 'lab-fade');
  const stickEl = el('div', 'lab-stick');
  const knob = el('i');
  stickEl.appendChild(knob);
  root.append(fadeEl, toasts, stickEl);
  let btn = null;
  let fn = null;
  const log = [];
  return {
    log,
    toast(text, { icon, ms = 2400 } = {}) {
      log.push(String(text));
      const t = el('div', 'lab-toast', (icon ? icon + ' ' : '') + text);
      toasts.appendChild(t);
      while (toasts.children.length > 3) toasts.firstChild.remove();
      setTimeout(() => t.remove(), ms);
    },
    prompt(label, onUse) {
      fn = onUse;
      if (!btn) {
        btn = el('button', 'lab-prompt');
        btn.type = 'button';
        btn.addEventListener('click', () => fn && fn());
        root.appendChild(btn);
      }
      btn.textContent = label;
      btn.hidden = false;
    },
    clearPrompt() {
      fn = null;
      if (btn) btn.hidden = true;
    },
    usePrompt() {
      if (fn) fn();
      return !!fn;
    },
    get promptLabel() { return fn && btn ? btn.textContent : null; },
    big(text, sub) { this.toast(text + (sub ? '  ' + sub : '')); },
    setGameUI() {},
    fade(on, ms = 200) {
      fadeEl.style.transitionDuration = ms + 'ms';
      fadeEl.style.opacity = on ? '1' : '0';
      return new Promise((r) => setTimeout(r, MANUAL ? 0 : ms));
    },
    stick: {
      show(x, y) {
        stickEl.style.display = 'block';
        stickEl.style.left = x + 'px';
        stickEl.style.top = y + 'px';
        knob.style.transform = 'none';
      },
      move(ox, oy, dx, dy) {
        stickEl.style.left = ox + 'px';
        stickEl.style.top = oy + 'px';
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      },
      hide() { stickEl.style.display = 'none'; },
    },
  };
}
const hud = createLabHud(hudRoot);

// ------------------------------------------------------------------ audio stub (little synth blips once unlocked)
function createLabAudio() {
  const log = [];
  let ctx = null;
  const tone = (f, dur, type = 'sine', vol = 0.12, sweep = 1) => {
    if (!ctx || ctx.state !== 'running') return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const n = ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f, n);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f * sweep), n + dur);
    g.gain.setValueAtTime(vol, n);
    g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
    o.connect(g).connect(ctx.destination);
    o.start(n);
    o.stop(n + dur + 0.02);
  };
  const SOUNDS = {
    count: (p) => tone(620 * p, 0.14, 'triangle', 0.16),
    toss: () => tone(260, 0.45, 'triangle', 0.14, 3.2),
    whoosh: (p) => tone(900 * p, 0.22, 'sine', 0.06, 0.45),
    sparkle: (p) => { tone(1800 * p, 0.12, 'sine', 0.05); tone(2400 * p, 0.1, 'sine', 0.04); },
    chime: (p) => tone(1320 * p, 0.3, 'sine', 0.06),
    land: () => { tone(140, 0.18, 'sine', 0.2, 0.6); tone(1046, 0.4, 'triangle', 0.08); },
    cradle: () => tone(520, 0.5, 'sine', 0.1, 0.7),
    tada: () => { tone(784, 0.2, 'triangle', 0.1); setTimeout(() => tone(1046, 0.4, 'triangle', 0.1), 120); },
    tap: () => tone(880, 0.06, 'sine', 0.06),
  };
  const unlock = () => {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (err) { ctx = null; }
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
  return {
    log, enabled: true, setEnabled() {}, unlock, music() {}, setListener() {}, beat: null, dispose() {},
    sfx(name, opts = {}) {
      log.push(name);
      if (log.length > 400) log.shift();
      const f = SOUNDS[name];
      if (f) {
        try {
          f(opts.pitch || 1);
        } catch (err) { /* blips only */ }
      }
    },
  };
}
const audio = createLabAudio();

// ------------------------------------------------------------------ net stub with fake friends and a bot
function createLabNet() {
  const handlers = new Map();
  const players = new Map();
  const states = new Map();
  const me = { id: 'me', nick: 'Bailey', look: {}, bot: false, joinedAt: 0 };
  players.set('me', me);
  [['f1', 'Sparkle Comet'], ['f2', 'Moon Pie'], ['f3', 'Glitter Star'], ['f4', 'Sunny Bow']].forEach(([id, nick], i) => players.set(id, { id, nick, look: {}, bot: false, joinedAt: i + 1 }));
  players.set('bot1', { id: 'bot1', nick: 'Robo Pom', look: {}, bot: true, joinedAt: 9 });
  const sent = [];
  return {
    status: 'online', me, players, sent, room: { code: 'LABS', hostId: 'me', createdAt: 0 }, isHost: true, game: null,
    stateOf(id) { return states.get(id) || null; },
    setState(id, s) { states.set(id, s); },
    on(evt, fn) {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt).add(fn);
    },
    off(evt, fn) { if (handlers.has(evt)) handlers.get(evt).delete(fn); },
    emit(evt, data) { for (const fn of handlers.get(evt) || []) fn(data); },
    send(type, data) { sent.push({ type, data }); },
    sendState() {},
    now: () => performance.now(),
  };
}
const net = createLabNet();

// ------------------------------------------------------------------ characters: the real ones when they exist
let charMod = null;
try {
  charMod = await import('../js/art/character.js');
} catch (err) {
  charMod = null;
}
function makeCharacter(seed, team = 0, look = null) {
  if (charMod && typeof charMod.createCharacter === 'function') {
    try {
      let l = look;
      if (!l && typeof charMod.randomLook === 'function') l = charMod.randomLook(() => ((seed * 9301 + 49297) % 233280) / 233280);
      return charMod.createCharacter(l || charMod.DEFAULT_LOOK, { quality: QUALITY });
    } catch (err) {
      console.warn('[lab] createCharacter failed, using a stand-in', err);
    }
  }
  return createStandin(standinStyle(seed, team), { seed });
}

// ------------------------------------------------------------------ input, camera rig, player (Contract 2)
const input = createInput({ canvas, stick: hud.stick });
const terrain = { heightAt: (x, z) => { const g = groundAt(x, z); return Number.isFinite(g) ? g : -40; } };
const rig = createCameraRig({ camera, engine, terrain, input });

function createLabPlayer() {
  const group = new THREE.Group();
  group.name = 'player';
  scene.add(group);
  const position = group.position;
  const velocity = new THREE.Vector3();
  const follow = { position, heading: SPAWN.facing, speed: 0 };
  const mv = { x: 0, y: 0 };
  let heading = SPAWN.facing;
  let avatar = null;
  let frozen = false;
  let control = null;
  let grounded = true;
  let anim = '';
  let speed = 0;
  function setAnim(name) {
    if (name === anim) return;
    anim = name;
    if (avatar) avatar.setAnim(name);
  }
  function place(x, z, facing) {
    const g = groundAt(x, z);
    position.set(x, Number.isFinite(g) ? g : 0, z);
    if (typeof facing === 'number') heading = facing;
    velocity.set(0, 0, 0);
    grounded = true;
    group.rotation.y = heading;
    follow.heading = heading;
    rig.snapBehind(heading);
  }
  const api = {
    group, position, velocity,
    get heading() { return heading; },
    set heading(v) { heading = v; },
    get grounded() { return grounded; },
    get avatar() { return avatar; },
    get frozen() { return frozen || !!control; },
    set frozen(v) { frozen = !!v; },
    get controlledBy() { return control; },
    get anim() { return anim; },
    follow,
    setAvatar(a) {
      if (avatar) {
        group.remove(avatar.group);
        if (avatar.dispose) avatar.dispose();
      }
      avatar = a;
      anim = '';
      if (avatar) group.add(avatar.group);
    },
    takeControl(owner) {
      const me = owner || 'someone';
      control = me;
      velocity.set(0, 0, 0);
      return () => {
        if (control === me) control = null;
        velocity.set(0, 0, 0);
        anim = '';
      };
    },
    jump() {
      if (!grounded || control || frozen) return;
      velocity.y = 6.2;
      grounded = false;
      audio.sfx('jump');
    },
    place,
    teleport(x, z, facing, opts = {}) {
      const fade = opts.fade !== false;
      return (fade ? hud.fade(true, 170) : Promise.resolve()).then(() => {
        place(x, z, facing);
        return fade ? hud.fade(false, 260) : null;
      });
    },
    getState() { return { x: position.x, y: position.y, z: position.z, h: heading, anim }; },
    update(dt, t) {
      if (control) {
        group.rotation.y = heading;
        follow.heading = heading;
        follow.speed = 0;
        if (avatar) avatar.update(dt, t);
        return;
      }
      let wx = 0;
      let wz = 0;
      if (!frozen) {
        input.getMove(mv);
        const mag = Math.min(1, Math.hypot(mv.x, mv.y));
        if (mag > 0.05) {
          const yaw = rig.yaw;
          const dx = (Math.cos(yaw) * mv.x - Math.sin(yaw) * mv.y) / mag;
          const dz = (-Math.sin(yaw) * mv.x - Math.cos(yaw) * mv.y) / mag;
          const sp = mag < 0.6 ? lerp(1, 3, mag / 0.6) : lerp(3, 6.2, (mag - 0.6) / 0.4);
          wx = dx * sp;
          wz = dz * sp;
        }
      }
      velocity.x = damp(velocity.x, wx, 10, dt);
      velocity.z = damp(velocity.z, wz, 10, dt);
      let nx = position.x + velocity.x * dt;
      let nz = position.z + velocity.z * dt;
      // never walk off into the open sky; drops of more than a step are edges too
      const ok = (x, z) => {
        const g = groundAt(x, z);
        return Number.isFinite(g) && g > position.y - 1.2 && g < position.y + 0.6;
      };
      if (grounded && !ok(nx, nz)) {
        if (ok(nx, position.z)) nz = position.z;
        else if (ok(position.x, nz)) nx = position.x;
        else {
          nx = position.x;
          nz = position.z;
        }
      }
      speed = Math.hypot(nx - position.x, nz - position.z) / Math.max(dt, 1e-4);
      position.x = nx;
      position.z = nz;
      if (!grounded) velocity.y -= 22 * dt;
      position.y += velocity.y * dt;
      const g = groundAt(position.x, position.z);
      if (Number.isFinite(g) && position.y <= g + 0.02 && velocity.y <= 0) {
        position.y = g;
        velocity.y = 0;
        grounded = true;
      } else if (Number.isFinite(g) && grounded && position.y - g < 0.35) position.y = g;
      else grounded = false;
      if (position.y < -30) place(SPAWN.x, SPAWN.z, SPAWN.facing); // a cloud floats you home
      if (speed > 0.4) heading = dampAngle(heading, Math.atan2(velocity.x, velocity.z), 12, dt);
      group.rotation.y = heading;
      setAnim(!grounded ? (velocity.y > 0 ? 'jump' : 'fall') : speed < 0.3 ? 'idle' : speed < 3.4 ? 'walk' : 'run');
      if (avatar) {
        if (avatar.setSpeed) avatar.setSpeed(speed);
        avatar.update(dt, t);
      }
      follow.heading = heading;
      follow.speed = speed;
    },
  };
  return api;
}
const player = createLabPlayer();
player.setAvatar(charMod && charMod.DEFAULT_LOOK ? makeCharacter(1, 0, charMod.DEFAULT_LOOK) : createStandin(standinStyle(2, 0), { seed: 2 }));
rig.setFollow(player.follow);
player.place(SPAWN.x, SPAWN.z, SPAWN.facing);

// ------------------------------------------------------------------ interact (as in League World, trimmed)
function createLabInteract() {
  const items = new Map();
  let current = null;
  let clock = 1;
  const v = new THREE.Vector3();
  function use(item = current) {
    if (!item || item.enabled === false || typeof item.onUse !== 'function') return false;
    item.onUse(item);
    return true;
  }
  return {
    register(def) {
      const item = Object.assign({ radius: 2.5, label: 'Use', priority: 0, enabled: true }, def);
      items.set(item.id, item);
      clock = 1;
      return item;
    },
    unregister(id) {
      const item = items.get(id);
      items.delete(id);
      if (item && item === current) {
        current = null;
        hud.clearPrompt();
      }
    },
    update(dt) {
      clock += dt;
      if (clock < 0.1) return;
      clock = 0;
      let best = null;
      let score = -Infinity;
      if (!player.frozen) {
        for (const item of items.values()) {
          if (item.enabled === false) continue;
          const p = typeof item.position === 'function' ? item.position() : item.position;
          v.set(p.x, p.y, p.z);
          const d = Math.hypot(v.x - player.position.x, v.z - player.position.z);
          if (d > item.radius || Math.abs(v.y - player.position.y) > 6) continue;
          const s = item.priority * 1000 - d;
          if (s > score) {
            score = s;
            best = item;
          }
        }
      }
      if (best !== current) {
        current = best;
        if (best) hud.prompt(best.label, () => use(best));
        else hud.clearPrompt();
      }
    },
    use,
    get current() { return current; },
  };
}
const interact = createLabInteract();
input.on('use', () => {
  if (!hud.usePrompt()) player.jump();
});

// ------------------------------------------------------------------ the rhinestone sparkle burst (Contract 1)
const bursts = (() => {
  const N = 320;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const base = Array.from({ length: N }, () => new THREE.Color());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({ size: 0.34, map: starTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  scene.add(pts);
  let next = 0;
  let live = 0;
  return {
    spawn(x, y, z, { count = 24, colors = [PALETTE.rhinestonePink] } = {}) {
      count = clamp(count | 0, 1, 80);
      for (let i = 0; i < count; i++) {
        const k = next;
        next = (next + 1) % N;
        const a = Math.random() * Math.PI * 2;
        const up = 0.3 + Math.random() * 0.9;
        const sp = 2 + Math.random() * 3.4;
        pos.set([x, y, z], k * 3);
        vel.set([Math.cos(a) * sp * (1 - up * 0.5), up * sp, Math.sin(a) * sp * (1 - up * 0.5)], k * 3);
        life[k] = 0.7 + Math.random() * 0.6;
        base[k].set(colors[i % colors.length]);
      }
      live = 1.4;
    },
    update(dt) {
      if (live <= 0) return;
      live -= dt;
      for (let k = 0; k < N; k++) {
        if (life[k] <= 0) {
          col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = 0;
          continue;
        }
        life[k] -= dt;
        vel[k * 3 + 1] -= 3.2 * dt;
        for (let j = 0; j < 3; j++) {
          vel[k * 3 + j] *= 1 - 1.6 * dt;
          pos[k * 3 + j] += vel[k * 3 + j] * dt;
        }
        const f = clamp(life[k] / 0.5, 0, 1) * (0.6 + 0.4 * Math.sin(life[k] * 30));
        col[k * 3] = base[k].r * f;
        col[k * 3 + 1] = base[k].g * f;
        col[k * 3 + 2] = base[k].b * f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
})();

// ------------------------------------------------------------------ the world object (Contract 1)
const updaters = new Set();
const world = {
  THREE, scene, camera, renderer, engine, rig, input, audio, net, content: null, player, hud, interact,
  colliders: createColliders(),
  groundAt,
  platforms: PLATFORMS.map((p) => Object.assign({}, p)),
  places: { plaza: SPAWN, tossPads: PADS.map((p) => Object.assign({}, p)), slides: [] },
  onUpdate(fn) {
    updaters.add(fn);
    return () => updaters.delete(fn);
  },
  spawnBurst: (x, y, z, opts) => bursts.spawn(x, y, z, opts),
  quality: QUALITY,
};
window.__c9 = world;
const toss = createToss(world);

// ------------------------------------------------------------------ fake friends: on the base spots, or hanging out by the plaza
const LAB = { pad: 0, friends: 0, botSpot: q.get('bot') === 'spot', remote: null };
const friendIds = ['f1', 'f2', 'f3', 'f4'];
const others = ['f1', 'f2', 'f3', 'f4', 'bot1'].map((id, i) => {
  const c = makeCharacter(11 + i * 5, id === 'bot1' ? 0 : 1);
  scene.add(c.group);
  return { id, c, anim: '' };
});
function spotsOf(i) {
  const p = toss.pads[i];
  const lx = Math.cos(p.heading);
  const lz = -Math.sin(p.heading);
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  return [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]].map(([a, b]) => ({ x: p.x + lx * a + fx * b, y: p.y, z: p.z + lz * a + fz * b }));
}
function layoutFriends() {
  const spots = spotsOf(LAB.pad);
  friendIds.forEach((id, i) => {
    if (LAB.remote && LAB.remote.id === id) return;
    if (i < LAB.friends) {
      const s = spots[i];
      const p = toss.pads[LAB.pad];
      net.setState(id, { x: s.x, y: s.y, z: s.z, h: Math.atan2(p.x - s.x, p.z - s.z), anim: 'base' });
    } else {
      const a = i * 1.6 + 0.4;
      net.setState(id, { x: Math.cos(a) * 4.5, y: 0, z: -2 + Math.sin(a) * 4.5, h: Math.atan2(-Math.cos(a), -Math.sin(a)), anim: 'idle' });
    }
  });
  if (LAB.botSpot) {
    const s = spots[3];
    net.setState('bot1', { x: s.x, y: s.y, z: s.z, h: 0, anim: 'base' });
  } else net.setState('bot1', { x: 5.5, y: 0, z: 3, h: -2.4, anim: 'idle' });
}
function updateOthers(dt, t) {
  if (POSES) return;
  for (const o of others) {
    const s = net.stateOf(o.id);
    if (!s) {
      o.c.group.visible = false;
      continue;
    }
    o.c.group.visible = true;
    o.c.group.position.set(s.x, s.y, s.z);
    o.c.group.rotation.y = s.h;
    if (s.anim !== o.anim) {
      o.anim = s.anim;
      o.c.setAnim(s.anim);
    }
    o.c.update(dt, t);
  }
}

// A friend's toss, played out here the way their device would: it sends 'fx' events and flies an arc.
function friendToss(padIndex = LAB.pad) {
  if (LAB.remote) return false;
  const p = toss.pads[padIndex];
  const id = friendIds.slice().reverse().find((f, i) => 3 - i >= LAB.friends) || 'f4';
  const beat = TOSS.countBeat;
  const from = { x: p.x, y: p.y + TOSS.releaseY, z: p.z };
  const sol = p.target ? solveToss({ from, to: p.target, friends: LAB.friends }) : solveToss({ from, to: { x: p.x, y: p.y + TOSS.catchY, z: p.z }, friends: LAB.friends, classic: true });
  LAB.remote = { id, t: 0, beat, sol, pad: p, landed: false };
  net.emit('event', { from: id, type: 'fx', data: { kind: 'toss', pad: p.id, beat } });
  return true;
}
function updateRemote(dt) {
  const r = LAB.remote;
  if (!r) return;
  r.t += dt;
  const launchAt = 3.38 * r.beat;
  const p = r.pad;
  if (r.t < launchAt) net.setState(r.id, { x: p.x, y: p.y + TOSS.basketY - 0.15 * Math.abs(Math.sin((r.t / r.beat) * Math.PI)), z: p.z, h: p.heading, anim: 'daggers' });
  else {
    const tau = Math.min(r.sol.T, r.t - launchAt);
    const u = tau / r.sol.T;
    const y = heightAt(r.sol, tau);
    net.setState(r.id, { x: r.sol.x0 + (r.sol.x1 - r.sol.x0) * u, y, z: r.sol.z0 + (r.sol.z1 - r.sol.z0) * u, h: p.heading, anim: tau < r.sol.T ? (u > 0.3 && u < 0.6 ? 'toeTouch' : 'highV') : 'cheer' });
    if (tau >= r.sol.T && !r.landed) {
      r.landed = true;
      net.emit('event', { from: r.id, type: 'fx', data: { kind: 'tossLand', pad: p.id, stuck: true, score: 777 } });
    }
    if (r.t > launchAt + r.sol.T + 2.5) {
      LAB.remote = null;
      layoutFriends();
    }
  }
}

function setFriends(n, padIndex = LAB.pad) {
  LAB.friends = clamp(n | 0, 0, 4);
  LAB.pad = clamp(padIndex | 0, 0, toss.pads.length - 1);
  layoutFriends();
  renderPanel();
  return LAB.friends;
}
function goPad(i, opts = {}) {
  LAB.pad = clamp(i | 0, 0, toss.pads.length - 1);
  const p = toss.pads[LAB.pad];
  layoutFriends();
  player.place(p.x - Math.sin(p.heading) * 0.2, p.z - Math.cos(p.heading) * 0.2, p.heading);
  if (opts.render !== false) renderPanel();
}
function baseMe(padIndex = LAB.pad, spot = 0) {
  LAB.pad = clamp(padIndex | 0, 0, toss.pads.length - 1);
  if (LAB.friends > spot) setFriends(spot, LAB.pad);
  const s = spotsOf(LAB.pad)[spot];
  const p = toss.pads[LAB.pad];
  player.place(s.x, s.z, Math.atan2(p.x - s.x, p.z - s.z));
}

// ------------------------------------------------------------------ the pose gallery (?poses=1)
const labels = [];
if (POSES) {
  const list = ['idle', 'base', 'throw', 'catch', 'cradle', 'daggers', 'highV', 'lowV', 'tMotion', 'touchdown', 'punch', 'clasp', 'jump', 'fall', 'land',
    'toeTouch', 'pike', 'kickDouble', 'twist', 'liberty', 'heelStretch', 'scorpion', 'bowArrow', 'arabesque', 'cheer', 'clap', 'wave', 'aww'];
  const cols = 7;
  list.forEach((name, i) => {
    const c = makeCharacter(i * 3 + 1, i % 2);
    const x = ((i % cols) - (cols - 1) / 2) * 2.1;
    const z = 4 + Math.floor(i / cols) * 2.5;
    c.group.position.set(x, 0, z);
    c.group.rotation.y = Math.PI;
    c.setAnim(name);
    scene.add(c.group);
    updaters.add((dt, t) => c.update(dt, t));
    const lab = el('div', 'lab-label', name);
    document.body.appendChild(lab);
    labels.push({ lab, pos: new THREE.Vector3(x, 1.75, z) });
  });
  player.group.visible = false;
  for (const o of others) o.c.group.position.y = -100;
  rig.play([{ cut: true, dur: 1e7, pos: [0, 8.2, -4.2], look: [0, 0.2, 8.2], fov: 50 }], { skippable: false });
  console.log('[lab] stand-in anims:', STANDIN_ANIMS.join(' '));
}
const vp = new THREE.Vector3();
function placeLabels() {
  for (const l of labels) {
    vp.copy(l.pos).project(camera);
    l.lab.style.left = ((vp.x * 0.5 + 0.5) * window.innerWidth).toFixed(0) + 'px';
    l.lab.style.top = ((-vp.y * 0.5 + 0.5) * window.innerHeight).toFixed(0) + 'px';
  }
}

// ------------------------------------------------------------------ the frame
let statClock = 0;
let labT = 0;
function tick(dt, t = labT + dt) {
  labT = t;
  input.update();
  player.update(dt, t);
  interact.update(dt);
  updateRemote(dt);
  toss.update(dt, t);
  updateOthers(dt, t);
  for (const fn of updaters) fn(dt, t);
  rig.update(dt, t);
  bursts.update(dt);
  sky.position.copy(camera.position);
  if (labels.length) placeLabels();
  statClock += dt;
  if (statClock > 0.5) {
    statClock = 0;
    updateStats();
  }
}
engine.addSystem({ update: tick }, 0);

// ------------------------------------------------------------------ the lab panel
const panel = document.getElementById('panel');
const statsEl = el('span', 'lab-stats', '');
function button(label, fn, on = false) {
  const b = el('button', on ? 'on' : null, label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn();
    b.blur();
  });
  return b;
}
function renderPanel() {
  if (q.get('ui') === '0') {
    panel.classList.add('hidden');
    return;
  }
  panel.replaceChildren(
    ...toss.pads.map((p, i) => button(`Pad ${i + 1} · ${p.target ? Math.round(p.target.y) + ' m' : 'classic'}`, () => goPad(i), LAB.pad === i)),
    button('Friends −', () => setFriends(LAB.friends - 1)),
    button(`Friends: ${LAB.friends}`, () => setFriends((LAB.friends + 1) % 5)),
    button('Friend tosses', () => friendToss()),
    button('Base it', () => baseMe(LAB.pad, LAB.friends < 4 ? LAB.friends : 3)),
    button('Toss!', () => toss._start(LAB.pad)),
    button('Home', () => player.place(SPAWN.x, SPAWN.z, SPAWN.facing)),
    statsEl,
  );
}
function updateStats() {
  const s = engine.stats();
  statsEl.textContent = `${s.fps} fps  ${s.drawCalls} calls  ${(s.triangles / 1000).toFixed(1)}k tris`;
}

layoutFriends();
const startPad = parseInt(q.get('pad') || '-1', 10);
if (startPad >= 0 && startPad < toss.pads.length) {
  LAB.friends = clamp(parseInt(q.get('friends') || '0', 10) || 0, 0, 4);
  goPad(startPad, { render: false });
}
renderPanel();

window.__tossLab = {
  world, toss, net, audio, hud, player, engine,
  step(sec = 1 / 60, dt = 1 / 60) {
    const n = Math.max(1, Math.round(sec / dt));
    for (let i = 0; i < n; i++) tick(dt);
    engine.renderOnce();
    return toss.state;
  },
  start(i = LAB.pad) {
    goPad(i);
    tick(1 / 60);
    return toss._start(i);
  },
  gesture: (g, info) => toss._gesture(g, info),
  setFriends, baseMe, friendToss, goPad,
  home: () => player.place(SPAWN.x, SPAWN.z, SPAWN.facing),
  state: () => toss.state,
  stats: () => engine.stats(),
  player: () => ({ x: player.position.x, y: player.position.y, z: player.position.z, h: player.heading, controlled: player.controlledBy, avatarAnim: player.avatar && player.avatar.anim }),
  ready: true,
};

if (MANUAL) {
  tick(1 / 60);
  engine.renderOnce();
} else engine.start();
