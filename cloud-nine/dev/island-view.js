// Island viewer: orbit round Cloud Nine, tour every place, or walk it with a capsule that uses
// island.groundAt() and the shared colliders.
//
// URL params: ?shot=<preset> (gym, stage, ...), ?q=low, ?birthday=1, ?age=11, ?walk=1, ?clean=1,
// ?t=<seconds> (start the clock there), ?freeze=1 (stop time, for screenshots).
// window.__island exposes { island, sky, engine, colliders, presets, go(name), walkTo(x, z) }.

import * as THREE from '../lib/three.module.min.js';
import { createEngine } from '../js/core/engine.js';
import { createColliders } from '../js/core/colliders.js';
import { buildIsland } from '../js/world/island.js';
import { createSky } from '../js/world/sky.js';
import { setReducedMotion } from '../js/art/util.js';
import { toWorld } from '../js/art/island-layout.js';

const params = new URLSearchParams(location.search);
const quality = params.get('q') === 'low' ? 'low' : 'high';
if (params.get('clean')) document.body.classList.add('clean');
if (params.get('reduced')) setReducedMotion(true);

const canvas = document.getElementById('c');
const engine = createEngine({ canvas, quality });
const { scene, camera, renderer } = engine;
camera.far = 900;
camera.updateProjectionMatrix();
const colliders = createColliders();
const t0 = performance.now();
const sky = createSky({ scene, quality });
const island = buildIsland({ scene, quality, colliders });
const buildMs = Math.round(performance.now() - t0);
if (params.get('birthday')) island.setBirthday({ isBirthday: true, age: Number(params.get('age') || 11), name: params.get('name') || 'Bailey' });
else if (params.get('age')) island.setBirthday({ isBirthday: false, age: Number(params.get('age')) });

const P = island.places;
const pf = island.platforms;

// ---------------------------------------------------------------- the walker (a stand-in for the player)
const walker = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 10), new THREE.MeshLambertMaterial({ color: 0xff2e93 }));
  body.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshLambertMaterial({ color: 0xffd9c2 }));
  head.position.y = 1.25;
  const bow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshLambertMaterial({ color: 0xff2e93 }));
  bow.scale.set(1.8, 0.8, 0.6);
  bow.position.set(0, 1.55, -0.1);
  walker.add(body, head, bow);
}
walker.visible = false;
scene.add(walker);
const me = { x: P.plaza.x, y: 0, z: P.plaza.z, h: P.plaza.facing, vy: 0, grounded: true, rescue: 0 };

// ---------------------------------------------------------------- camera presets
const W = (place, lx, lz) => toWorld(place, lx, lz);
const stageFront = W(P.stage, 0, 26);
const garden = P.hideGarden.bounds;
const gx = (garden.x0 + garden.x1) / 2;
const gz = (garden.z0 + garden.z1) / 2;
const lawn = P.tagZone.bounds;
const c3 = pf[2];
const toss = P.tossPads[1];
const falls = P.waterfalls[0];
const presets = {
  overview: { pos: [118, 112, 150], look: [8, -6, -4] },
  top: { pos: [12, 230, 14], look: [12, 0, 0] },
  spawn: { pos: [P.plaza.x, 4.39, P.plaza.z + 9.17], look: [P.plaza.x, 2.37, P.plaza.z] },
  plaza: { pos: [17, 8.5, 19], look: [0, 1.6, -2] },
  fountain: { pos: [7, 3.6, -16.5], look: [0, 3.4, -28] },
  gym: { pos: [15, 7, -20], look: [0, 4.6, -46] },
  stage: { pos: [stageFront[0], 9, stageFront[1]], look: [P.stage.x, 1, P.stage.z] },
  garden: { pos: [gx + 22, 17, gz + 21], look: [gx, 0, gz] },
  court: { pos: [P.court.x - 6, 13, P.court.z + 25], look: [P.court.x, 0, P.court.z] },
  field: { pos: [P.bowField.x - 4, 20, P.bowField.z + 34], look: [P.bowField.x, 1, P.bowField.z] },
  lawn: { pos: [lawn.x1 + 14, 12, lawn.z1 + 16], look: [(lawn.x0 + lawn.x1) / 2, 0, (lawn.z0 + lawn.z1) / 2] },
  toss: { pos: [toss.x + 22, 12, toss.z + 22], look: [toss.x - 12, 9, toss.z - 12] },
  cloud3: { pos: [c3.x + 9, c3.y + 6.5, c3.z + 11], look: [c3.x, c3.y + 1, c3.z] },
  bridge: { pos: [P.bridge.x0 - 4, 9, P.bridge.z0 + 18], look: [(P.bridge.x0 + P.bridge.x1) / 2, 1, (P.bridge.z0 + P.bridge.z1) / 2] },
  isle: { pos: [P.isle.x - 6, 11, P.isle.z + 22], look: [P.isle.x, 2, P.isle.z] },
  falls: (() => {
    const dx = falls.x - 0;
    const dz = falls.z + 2;
    const l = Math.hypot(dx, dz);
    const ux = dx / l;
    const uz = dz / l;
    return { pos: [falls.x + ux * 34 - uz * 22, -6, falls.z + uz * 34 + ux * 22], look: [falls.x + ux * 3, -18, falls.z + uz * 3] };
  })(),
  underside: { pos: [62, -36, 84], look: [0, -24, 0] },
  photo: { pos: [P.photoBooth.x + 7, 3.2, P.photoBooth.z + 4], look: [P.photoBooth.x, 1.6, P.photoBooth.z] },
};

// ---------------------------------------------------------------- orbit camera
const orbit = { target: new THREE.Vector3(), yaw: 0, pitch: 0.4, dist: 60 };
function setPreset(name) {
  const p = presets[name] || presets.overview;
  const pos = new THREE.Vector3(...p.pos);
  orbit.target.set(...p.look);
  const d = pos.clone().sub(orbit.target);
  orbit.dist = d.length();
  orbit.yaw = Math.atan2(d.x, d.z);
  orbit.pitch = Math.asin(d.y / orbit.dist);
  mode = 'orbit';
  walker.visible = false;
  current = name;
  updateNav();
}
let mode = 'orbit';
let current = 'overview';

// ---------------------------------------------------------------- input
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space' && mode === 'walk' && me.grounded) me.vy = 5.2;
});
addEventListener('keyup', (e) => keys.delete(e.code));
let drag = null;
const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [c, d] = [...pointers.values()];
    const after = Math.hypot(c.x - d.x, c.y - d.y);
    if (before > 0 && after > 0) orbit.dist = Math.max(3, Math.min(400, orbit.dist * (before / after)));
    return;
  }
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  orbit.yaw -= dx * 0.005;
  orbit.pitch = Math.max(-1.45, Math.min(1.5, orbit.pitch + dy * 0.005));
});
const up = (e) => {
  pointers.delete(e.pointerId);
  drag = null;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.dist = Math.max(3, Math.min(400, orbit.dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
void drag;

// ---------------------------------------------------------------- walking
function startWalk(x, z, h) {
  mode = 'walk';
  me.x = x ?? P.plaza.x;
  me.z = z ?? P.plaza.z;
  me.h = h ?? P.plaza.facing;
  me.y = island.groundAt(me.x, me.z);
  me.vy = 0;
  walker.visible = true;
  orbit.yaw = me.h + Math.PI;
  orbit.pitch = 0.3;
  orbit.dist = 9.6;
  current = 'walk';
  updateNav();
}
const probe = { x: 0, z: 0 };
function walk(dt) {
  if (me.rescue > 0) {
    // a cloud catches you and floats you home
    me.rescue -= dt;
    if (me.rescue <= 0) startWalk();
    return;
  }
  let fx = 0;
  let fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
  const speed = keys.has('ShiftLeft') ? 2.7 : 7.8;
  const yaw = orbit.yaw;
  const dirX = (-Math.sin(yaw) * fz + Math.cos(yaw) * fx);
  const dirZ = (-Math.cos(yaw) * fz - Math.sin(yaw) * fx);
  const len = Math.hypot(dirX, dirZ);
  if (len > 0) {
    const nx = me.x + (dirX / len) * speed * dt;
    const nz = me.z + (dirZ / len) * speed * dt;
    // too steep to climb is a wall (same rule as the player: 1.7 rise over run)
    const ahead = island.groundAt(me.x + (dirX / len) * 0.5, me.z + (dirZ / len) * 0.5);
    if (!(ahead - me.y > 0.85 && me.grounded)) {
      probe.x = nx;
      probe.z = nz;
      colliders.resolve(probe, 0.45);
      me.x = probe.x;
      me.z = probe.z;
    }
    me.h = Math.atan2(dirX, dirZ);
  }
  const g = island.groundAt(me.x, me.z);
  me.vy -= 18 * dt;
  me.y += me.vy * dt;
  if (g > -Infinity && me.y <= g) {
    me.y = me.y < g - 0.6 && me.grounded ? g : Math.max(me.y, g);
    if (me.y <= g + 0.001) {
      me.y = g;
      me.vy = 0;
      me.grounded = true;
    }
  } else me.grounded = false;
  if (g > -Infinity && me.grounded) me.y = g;
  if (me.y < -30) me.rescue = 0.8;
  walker.position.set(me.x, me.y, me.z);
  walker.rotation.y = me.h;
  orbit.target.set(me.x, me.y + 1.55, me.z);
}

// ---------------------------------------------------------------- nav
const nav = document.getElementById('nav');
function button(label, fn, id) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.id = id || label;
  b.addEventListener('click', fn);
  nav.appendChild(b);
  return b;
}
for (const name of Object.keys(presets)) button(name, () => setPreset(name), name);
button('walk', () => startWalk(), 'walk');
let bday = !!params.get('birthday');
button('birthday', () => {
  bday = !bday;
  island.setBirthday({ isBirthday: bday, age: 11, name: 'Bailey' });
  updateNav();
}, 'birthday');
button(quality === 'low' ? 'high' : 'low', () => {
  params.set('q', quality === 'low' ? 'high' : 'low');
  location.search = params.toString();
}, 'quality');
function updateNav() {
  for (const b of nav.children) b.classList.toggle('on', b.dataset.id === current || (b.dataset.id === 'birthday' && bday));
}

// ---------------------------------------------------------------- loop
const statsEl = document.getElementById('stats');
let statClock = 0;
const freeze = !!params.get('freeze');
let clock = Number(params.get('t') || 0);
engine.addSystem({
  update(dt, t) {
    if (!freeze) clock += dt;
    if (mode === 'walk') walk(dt);
    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      orbit.target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
      orbit.target.y + Math.sin(orbit.pitch) * orbit.dist,
      orbit.target.z + Math.cos(orbit.yaw) * cp * orbit.dist,
    );
    camera.lookAt(orbit.target);
    island.update(freeze ? 0 : dt, clock, { camera, playerPos: mode === 'walk' ? walker.position : null });
    sky.update(freeze ? 0 : dt, clock, camera);
    statClock += dt;
    if (statClock > 0.4) {
      statClock = 0;
      const s = engine.stats();
      const ground = island.groundAt(orbit.target.x, orbit.target.z);
      statsEl.textContent = `\n${s.fps} fps  ${s.frameMs} ms  q=${quality}\ndraw calls ${s.drawCalls}\ntriangles ${s.triangles.toLocaleString()}\nbuild ${buildMs} ms, ${island.stats.colliders} colliders` +
        (mode === 'walk' ? `\nat ${me.x.toFixed(1)}, ${me.y.toFixed(2)}, ${me.z.toFixed(1)}${me.rescue > 0 ? '  (cloud rescue!)' : ''}` : `\nground ${ground > -Infinity ? ground.toFixed(2) : 'sky'}`);
    }
  },
}, 10);

setPreset(params.get('shot') || 'overview');
if (params.get('walk')) startWalk(params.has('x') ? Number(params.get('x')) : undefined, params.has('z') ? Number(params.get('z')) : undefined);
engine.start();

window.__island = {
  island, sky, engine, colliders, presets, THREE,
  go: setPreset,
  walkTo(x, z, h) { startWalk(x, z, h); },
  get me() { return { ...me }; },
  render() { engine.renderOnce(); return engine.stats(); },
  ready: true,
};
