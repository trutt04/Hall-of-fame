// The mini husky: its model (one skinned geometry on the shared flatMat, under 800 triangles, its
// colours in one palette), and its behaviour headless: it trots on the ground, sits when its owner
// stops, hops with an "awoo" (only with the sound on) for a cheer or a landed toss, hides for games,
// and swaps with the cloud puppy when the look changes. Never locked, never random.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.min.js';
import { huskyGeometry, createHusky, createPet, petIcon, PET_IDS, HUSKY_COLORS, PIVOT_Y } from '../js/art/pet.js';
import { flatMat } from '../js/art/materials.js';
import { createPets, wantsPet, petKindOf, awoo } from '../js/world/pets.js';
import { LOOK_OPTIONS, randomLook } from '../js/art/character-looks.js';
import { lockedLooks } from '../js/world/sticks.js';
import { SPIRIT_STICKS } from '../js/content/collectibles.js';

test('the husky model: one merged skinned geometry under 800 triangles, two draw calls with its shadow', () => {
  const g = huskyGeometry();
  assert.equal(g, huskyGeometry(), 'built once, shared');
  const tris = g.attributes.position.count / 3;
  assert.ok(tris <= 800 && tris > 300, tris + ' triangles');
  const si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array;
  for (let i = 0; i < g.attributes.position.count; i++) {
    assert.equal(sw[i * 4], 1);
    assert.ok(si[i * 4] >= 0 && si[i * 4] < 11);
  }
  const h = createHusky();
  const meshes = [];
  h.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 2, 'the husky and its blob shadow');
  assert.equal(h.mesh.material, flatMat);
  assert.equal(h.kind, 'husky');
  assert.equal(h.ground, true, 'it walks on the ground');
  assert.equal(createPet('husky').kind, 'husky');
  assert.equal(createPet('cloudPuppy').kind, 'cloudPuppy');
  assert.deepEqual([...PET_IDS], LOOK_OPTIONS.pet.map((o) => o.id));
  // every knob at once, sitting and trotting and howling: bones stay finite
  Object.assign(h.mood, { sit: 1, happy: 1, move: 1, excite: 1, look: 3, tilt: 0.3, vy: -20, howl: 1 });
  for (let i = 0; i < 200; i++) {
    h.mood.sit = i > 100 ? 1 : 0;
    h.update(i % 7 ? 1 / 60 : 0.5, i / 60);
  }
  h.mesh.skeleton.bones.forEach((b) => {
    for (const v of [b.position.x, b.position.y, b.position.z, b.rotation.x, b.rotation.y, b.rotation.z, b.scale.y]) assert.ok(Number.isFinite(v), b.name);
  });
  h.dispose();
  h.dispose();
});

test('sitting puts its rump and paws on the ground, not under it', () => {
  const h = createHusky({ shadow: false });
  h.group.position.set(0, 0, 0);
  h.mood.sit = 1;
  for (let i = 0; i < 120; i++) h.update(1 / 60, i / 60);
  h.group.updateMatrixWorld(true);
  const pos = h.mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  let minY = Infinity;
  for (let i = 0; i < pos.count; i += 3) {
    h.mesh.getVertexPosition(i, v);
    h.mesh.localToWorld(v);
    minY = Math.min(minY, v.y);
  }
  assert.ok(minY > -0.04 && minY < 0.05, 'lowest point ' + minY.toFixed(3));
});

test('its colours are one small frozen palette, and its tile is an inline SVG in them', () => {
  assert.ok(Object.isFrozen(HUSKY_COLORS));
  for (const k of ['coat', 'saddle', 'white', 'eye', 'nose']) assert.equal(typeof HUSKY_COLORS[k], 'number', k);
  const s = petIcon('husky');
  assert.match(s, /^<svg viewBox="0 0 64 64"[^>]*>.*<\/svg>$/s);
  assert.ok(!/href|http|<script|<text|on[a-z]+=/i.test(s));
  assert.ok(s.includes('#' + HUSKY_COLORS.eye.toString(16).padStart(6, '0')), 'blue eyes');
  assert.notEqual(s, petIcon('cloudPuppy'));
});

test('the husky is there from the start: never locked, never random', () => {
  assert.equal(lockedLooks(SPIRIT_STICKS, []).pet.husky, undefined);
  let n = 1;
  const rng = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1000; i++) assert.equal(randomLook(rng).pet, 'none');
  assert.equal(petKindOf({ pet: 'husky' }), 'husky');
  assert.equal(petKindOf({ pet: 'cloudPuppy' }), 'cloudPuppy');
  for (const l of [{ pet: 'none' }, { pet: 'Husky' }, {}, null, 'husky', { pet: ['husky'] }]) assert.equal(petKindOf(l), null);
  assert.equal(wantsPet({ pet: 'husky' }), true);
});

// ---- headless ----------------------------------------------------------------------------------------
function fakeWorld(audio) {
  const scene = new THREE.Scene();
  const player = { position: new THREE.Vector3(0, 0, 0), heading: 0, speed: 0, anim: 'idle', controller: null, rescuing: false };
  const handlers = {};
  const net = { me: { id: 'me1' }, players: new Map(), on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); }, off: () => {} };
  const world = {
    scene, player, net, mode: 'play', activeGame: null, toss: { active: false, pads: [{ id: 'p0', x: 20, z: 0, heading: 0 }] },
    places: { stage: { x: 31, z: -31, facing: 0 } }, groundAt: () => 0, peers: { get: () => null },
    audio: audio || { sfx: () => {}, enabled: false },
  };
  return { world, player };
}
const run = (pets, seconds, each) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    if (each) each(i / 60);
    pets.update(1 / 60, i / 60);
  }
};

test('pets: the husky trots along on the ground, sits when she stops, and hops for a cheer', () => {
  const sfx = [];
  const { world, player } = fakeWorld({ sfx: (name) => sfx.push(name), enabled: false });
  let look = { pet: 'husky' };
  const pets = createPets(world, { myLook: () => look });
  run(pets, 0.3);
  const e = pets.mine;
  assert.equal(e.kind, 'husky');
  assert.equal(e.visible, true);
  player.speed = 2.6;
  let maxBody = 0;
  let legSwing = 0;
  const legFL = e.model.mesh.skeleton.bones[7];
  run(pets, 3, () => {
    player.position.z += 2.6 / 60;
    maxBody = Math.max(maxBody, e.model.body.position.y);
    legSwing = Math.max(legSwing, Math.abs(legFL.rotation.x));
  });
  const d = Math.hypot(e.x - player.position.x, e.z - player.position.z);
  assert.ok(d > 0.8 && d < 2.2, 'keeps up: ' + d.toFixed(2));
  assert.ok(maxBody < PIVOT_Y + 0.06, 'on the ground, not floating: ' + maxBody.toFixed(3));
  assert.ok(legSwing > 0.15, 'its legs trot: ' + legSwing.toFixed(2));
  assert.ok(e.y < 0.01, 'its feet on the ground');
  player.speed = 0;
  run(pets, 2.5);
  assert.ok(e.sit > 0.9, 'sitting');
  // a cheer: a happy hop and an awoo (sound off here: only the game's own sfx, which minds the toggle)
  assert.equal(pets.cheer('me'), true);
  assert.ok(e.hopT > 0 && e.howlT > 0 && e.spinT === 0, 'a hop, not a spin');
  assert.deepEqual(sfx.slice(-1), ['aww']);
  let top = 0;
  run(pets, 0.7, () => { top = Math.max(top, e.model.body.position.y); });
  assert.ok(top > PIVOT_Y + 0.15, 'up it hops: ' + top.toFixed(2));
  // not an awoo for every cheer in a burst
  const before = sfx.length;
  pets.cheer('me');
  assert.equal(sfx.length, before, 'one awoo at a time');
  // a game: it poofs away like the puppy, and back after
  world.activeGame = { kind: 'freezeTag' };
  run(pets, 0.3);
  assert.equal(e.visible, false);
  world.activeGame = null;
  run(pets, 0.2);
  assert.equal(e.visible, true);
  // switching to the cloud puppy swaps the model
  look = { pet: 'cloudPuppy' };
  pets.sync();
  assert.equal(pets.mine.kind, 'cloudPuppy');
  assert.notEqual(pets.mine, e);
  look = { pet: 'husky' };
  pets.sync();
  assert.equal(pets.mine.kind, 'husky');
  pets.dispose();
});

test('the awoo plays on the game\'s audio context only while sound is on', () => {
  const made = [];
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, gain: param(), frequency: param(), Q: param(), type: '' });
  function param() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  const ctx = {
    state: 'running', currentTime: 1, destination: {},
    createGain: () => node(), createBiquadFilter: () => node(), createOscillator: () => { made.push(1); return node(); },
  };
  const sfx = [];
  const audio = { enabled: false, real: { context: ctx }, sfx: (n) => sfx.push(n) };
  awoo(audio);
  assert.equal(made.length, 0, 'sound off: no oscillators');
  audio.enabled = true;
  awoo(audio);
  assert.ok(made.length >= 1, 'sound on: synthesized');
  assert.equal(sfx.length, 1, 'only the sound-off call fell back to the sfx (which keeps its own toggle)');
  ctx.state = 'suspended';
  made.length = 0;
  awoo(audio);
  assert.equal(made.length, 0, 'not before the first tap unlocks audio');
  awoo(null);
  awoo({});
});
