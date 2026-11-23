// Character lineup: ten random cheerleaders plus Bailey's default look in front, and a button for
// every animation. Drag to orbit, wheel or pinch to zoom.
//   ?count=10         how many random looks behind her        ?seed=7    which random looks
//   ?solo=1           only the default look                   ?q=low     low quality
//   ?anim=toeTouch    play an animation on everyone           ?at=0.5    simulate to t seconds, then pause
//   ?cam=front|three|side|back|face|bow|feet|top              ?ui=0      hide the panels (screenshots)
//   ?hl=1             highlight everyone                      ?look={...} JSON look for the front character
//   ?speed=2.5        locomotion speed for idle/walk/run      ?parade=1  walk them around in a circle
// window.__lineup exposes the scene for tests.
import * as THREE from '../lib/three.module.min.js';
import { Geo } from '../js/art/geo.js';
import { flatMat } from '../js/art/materials.js';
import { setReducedMotion } from '../js/art/util.js';
import { createCharacter, randomLook, DEFAULT_LOOK, cleanLook, ANIM_GROUPS, ANIM_INFO, trickSpin } from '../js/art/character.js';

const q = new URLSearchParams(location.search);
const count = Math.max(0, Math.min(20, parseInt(q.get('count') || '10', 10) || 0));
const solo = q.get('solo') === '1';
const quality = q.get('q') === 'low' ? 'low' : 'high';
if (q.get('ui') === '0') document.body.classList.add('noui');
if (q.get('rm') === '1') setReducedMotion(true);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);

// The same kind of light the island uses: a sky / ground hemisphere and a warm sun.
const hemi = new THREE.HemisphereLight(0xd6e6ff, 0xffd3e8, 1.35);
const sun = new THREE.DirectionalLight(0xfff1de, 1.55);
sun.position.set(3, 7, 5);
scene.add(hemi, sun);

// a soft cloud floor
{
  const g = new Geo();
  g.cyl(0, -0.3, 0, 7.5, 0.3, 0xfff4fa, { seg: 28, bottom: false });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, r = 7.4 + (i % 3) * 0.2;
    g.ico(Math.cos(a) * r, -0.15, Math.sin(a) * r, 0.7 + (i % 4) * 0.12, i % 2 ? 0xfff4fa : 0xf4e8fb, { detail: 1, sy: 0.6 });
  }
  scene.add(g.mesh(flatMat));
}

// ---- the characters -------------------------------------------------------------------------------
let seed = parseInt(q.get('seed') || '7', 10) || 7;
function rng(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let frontLook = DEFAULT_LOOK;
if (q.get('look')) {
  try { frontLook = cleanLook(JSON.parse(q.get('look'))); } catch (err) { console.warn('bad ?look'); }
}
const chars = [];
function spawn() {
  for (const c of chars) c.ch.dispose();
  chars.length = 0;
  const r = rng(seed);
  const front = createCharacter(frontLook, { quality });
  front.group.position.set(0, 0, 1.6);
  scene.add(front.group);
  chars.push({ ch: front, home: new THREE.Vector3(0, 0, 1.6), heading: 0 });
  if (!solo) {
    for (let i = 0; i < count; i++) {
      const row = i < 5 ? 0 : 1, k = row ? i - 5 : i, n = row ? Math.max(1, count - 5) : Math.min(5, count);
      const x = (k - (n - 1) / 2) * 1.15 + (row ? 0.55 : 0), z = row ? -1.5 : 0;
      const c = createCharacter(randomLook(r), { quality });
      c.group.position.set(x, 0, z);
      c.group.rotation.y = -x * 0.08;
      scene.add(c.group);
      chars.push({ ch: c, home: new THREE.Vector3(x, 0, z), heading: -x * 0.08 });
    }
  }
}
spawn();

// ---- camera -----------------------------------------------------------------------------------------
const target = new THREE.Vector3(0, 0.85, 0.4);
const orbit = { az: 0, el: 0.12, dist: 7 };
const CAMS = {
  front: [0, 0.12, 7, [0, 0.85, 0.4]],
  three: [0.65, 0.16, 3.1, [0, 0.8, 1.6]],
  side: [Math.PI / 2, 0.08, 3.1, [0, 0.8, 1.6]],
  back: [Math.PI * 0.85, 0.2, 3.0, [0, 0.85, 1.6]],
  face: [0.35, 0.05, 1.05, [0, 1.22, 1.6]],
  bow: [Math.PI * 0.8, 0.45, 1.25, [0, 1.3, 1.6]],
  feet: [0.5, 0.25, 1.3, [0, 0.25, 1.6]],
  top: [0.4, 0.15, 1.6, [0, 0.95, 1.6]],
  trick: [0.55, 0.12, 3.6, [0, 0.95, 1.6]],
};
function setCamera(name) {
  const c = CAMS[name] || CAMS.front;
  orbit.az = c[0]; orbit.el = c[1]; orbit.dist = c[2];
  target.set(c[3][0], c[3][1], c[3][2]);
}
setCamera(q.get('cam') || (solo ? 'three' : 'front'));
function placeCamera() {
  const ce = Math.cos(orbit.el);
  camera.position.set(target.x + Math.sin(orbit.az) * ce * orbit.dist, target.y + Math.sin(orbit.el) * orbit.dist, target.z + Math.cos(orbit.az) * ce * orbit.dist);
  camera.lookAt(target);
}
let drag = null;
const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); drag = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]), d0 = drag.pinch || d;
    drag.pinch = d;
    orbit.dist = Math.min(20, Math.max(0.6, orbit.dist * (d0 / d)));
    return;
  }
  orbit.az -= (e.clientX - prev[0]) * 0.008;
  orbit.el = Math.min(1.3, Math.max(-0.3, orbit.el + (e.clientY - prev[1]) * 0.006));
});
const endPointer = (e) => { pointers.delete(e.pointerId); if (!pointers.size) drag = null; else if (drag) drag.pinch = 0; };
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(20, Math.max(0.6, orbit.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 52 : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- animation control -----------------------------------------------------------------------------
let current = q.get('anim') || 'idle';
let speed = parseFloat(q.get('speed') || '0') || 0;
let parade = q.get('parade') === '1';
let clock = 0, paused = false;
const what = document.getElementById('what');
function play(name, opts = {}) {
  current = name;
  what.textContent = name;
  for (const c of chars) {
    if (ANIM_INFO[name] && ANIM_INFO[name].trick) c.ch.setAnim('idle', { air: false });
    c.ch.setAnim(name, Object.assign({ restart: true }, opts));
    c.ch.setSpeed(name === 'walk' ? Math.max(speed, 1.4) : name === 'run' ? Math.max(speed, 5) : speed);
  }
}
function step(dt) {
  clock += dt;
  chars.forEach((c, i) => {
    // twists and kick doubles leave turning her to whoever moves her: do it here, like the toss does
    const info = ANIM_INFO[c.ch.anim];
    const turn = info && info.turns ? trickSpin(c.ch.anim, Math.min(1, c.ch.animTime / info.duration), !c.ch.airborne) : 0;
    if (parade) {
      const r = 2.2 + (i % 3) * 0.9, w = (speed || 1.6) / r, a = clock * w + i * 0.7;
      c.ch.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      c.ch.group.rotation.y = -a + turn; // tangent to the circle
      c.ch.setSpeed(speed || 1.6);
    } else c.ch.group.rotation.y = c.heading + turn;
    c.ch.update(dt, clock);
  });
}
// Simulate to exactly `t` seconds into the current animation, then hold (for screenshots).
function freeze(t) {
  play(current);
  const n = Math.round(t * 60);
  for (let i = 0; i < n; i++) step(1 / 60);
  paused = true;
}
const panel = document.getElementById('panel');
function row(label, items) {
  const r = document.createElement('div');
  r.className = 'row';
  const s = document.createElement('span');
  s.textContent = label;
  r.append(s, ...items);
  panel.append(r);
}
function button(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', () => { paused = false; onClick(b); });
  return b;
}
for (const [group, names] of Object.entries(ANIM_GROUPS)) row(group, names.map((n) => button(n, () => play(n))));
const sp = document.createElement('input');
sp.type = 'range'; sp.min = '0'; sp.max = '8'; sp.step = '0.1'; sp.value = String(speed);
sp.addEventListener('input', () => { speed = parseFloat(sp.value); for (const c of chars) c.ch.setSpeed(speed); spLabel.textContent = speed.toFixed(1) + ' m/s'; });
const spLabel = document.createElement('b');
spLabel.textContent = speed.toFixed(1) + ' m/s';
let hlOn = q.get('hl') === '1';
const hlColors = [0xff2e93, 0x7b5cff, 0x9fd8ff];
let hlI = 0;
row('options', [
  sp, spLabel,
  button('parade', (b) => { parade = !parade; b.classList.toggle('on', parade); if (!parade) chars.forEach((c) => { c.ch.group.position.copy(c.home); c.ch.group.rotation.y = c.heading; }); }),
  button('highlight', (b) => { hlOn = !hlOn; hlI = (hlI + 1) % hlColors.length; b.classList.toggle('on', hlOn); chars.forEach((c) => c.ch.setHighlight(hlOn, hlColors[hlI])); }),
  button('new looks', () => { seed++; spawn(); play(current); }),
  button('surprise her', () => chars[0].ch.setLook(randomLook(Math.random))),
  button('reset look', () => chars[0].ch.setLook(DEFAULT_LOOK)),
  ...Object.keys(CAMS).map((n) => button('cam ' + n, () => setCamera(n))),
]);
if (hlOn) chars.forEach((c) => c.ch.setHighlight(true, hlColors[0]));
play(current);

// ---- loop -------------------------------------------------------------------------------------------
const stats = document.getElementById('stats');
let last = performance.now(), frames = 0, fpsT = 0, fps = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused && !document.hidden) step(dt);
  placeCamera();
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  stats.textContent = `${chars.length} characters, ${renderer.info.render.calls} draw calls, ${(renderer.info.render.triangles / 1000).toFixed(1)}k triangles, ${fps.toFixed(0)} fps`;
  requestAnimationFrame(frame);
}
if (q.has('at')) freeze(parseFloat(q.get('at')) || 0);
requestAnimationFrame(frame);

window.__lineup = {
  THREE, scene, camera, renderer, chars, play, freeze, setCamera,
  orbit, target,
  pause(on = true) { paused = on; },
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  ready: true,
};
