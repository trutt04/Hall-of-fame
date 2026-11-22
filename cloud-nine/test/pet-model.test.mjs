// The cloud puppy model (one skinned geometry on the shared flatMat, under the triangle budget) and
// the pets running headless: following her, sitting, hiding for games, poofing along on a teleport,
// waiting at the toss pad and sitting by the stage, and never a pet for a bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.min.js';
import { puppyGeometry, createPuppy, petIcon, petTabIcon, PET_IDS } from '../js/art/pet.js';
import { flatMat } from '../js/art/materials.js';
import { createPets, PET } from '../js/world/pets.js';
import { LOOK_OPTIONS } from '../js/art/character-looks.js';

test('the puppy: one merged skinned geometry, at most 800 triangles, every vertex on one bone', () => {
  const g = puppyGeometry();
  assert.equal(g, puppyGeometry(), 'built once, shared by every pet');
  const tris = g.attributes.position.count / 3;
  assert.ok(tris <= 800 && tris > 400, tris + ' triangles');
  const si = g.attributes.skinIndex.array;
  const sw = g.attributes.skinWeight.array;
  for (let i = 0; i < g.attributes.position.count; i++) {
    assert.equal(sw[i * 4], 1);
    assert.ok(si[i * 4] >= 0 && si[i * 4] < 7);
  }
  const p = createPuppy();
  const meshes = [];
  p.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 2, 'the puppy and its blob shadow: two draw calls');
  assert.equal(p.mesh.material, flatMat, 'the shared flat material');
  assert.ok(p.mesh.isSkinnedMesh);
  assert.equal(p.shadow.name, 'blob');
  assert.deepEqual([...PET_IDS], LOOK_OPTIONS.pet.map((o) => o.id));
  // every knob at once: bones stay finite
  Object.assign(p.mood, { sit: 1, happy: 1, move: 1, excite: 1, look: 3, tilt: 0.3, vy: -20 });
  for (let i = 0; i < 200; i++) p.update(i % 7 ? 1 / 60 : 0.5, i / 60);
  p.mesh.skeleton.bones.forEach((b) => {
    for (const v of [b.rotation.x, b.rotation.y, b.rotation.z, b.scale.x, b.scale.y, b.scale.z]) assert.ok(Number.isFinite(v), b.name);
  });
  p.dispose();
  p.dispose();
});

test('the creator icons: inline SVG of preset colours, no text, no links', () => {
  for (const s of [petIcon('cloudPuppy'), petIcon('none'), petIcon('nope'), petTabIcon()]) {
    assert.match(s, /^<svg viewBox="0 0 64 64"[^>]*>.*<\/svg>$/s);
    assert.ok(!/href|http|<script|<text|on[a-z]+=/i.test(s));
  }
  assert.notEqual(petIcon('cloudPuppy'), petIcon('none'));
});

// ---- headless pets ---------------------------------------------------------------------------------
function fakeWorld() {
  const scene = new THREE.Scene();
  const player = {
    position: new THREE.Vector3(0, 0, 0), heading: 0, speed: 0, anim: 'idle', controller: null, rescuing: false,
  };
  const players = new Map();
  const peers = new Map();
  const handlers = {};
  const net = {
    me: { id: 'me1' },
    players,
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
    off: () => {},
    emit: (ev) => (handlers[ev] || []).forEach((fn) => fn()),
  };
  const world = {
    scene, player, net, mode: 'play', activeGame: null, toss: { active: false, pads: [{ id: 'p0', x: 20, z: 0, heading: 0 }] },
    places: { stage: { x: 31, z: -31, facing: -Math.PI / 4 } },
    groundAt: () => 0,
    peers: { get: (id) => peers.get(id) || null },
    look: { pet: 'none' },
    audio: { sfx: () => {}, enabled: false },
  };
  return { world, player, players, peers, net };
}
const run = (pets, seconds, each) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    if (each) each(i / 60);
    pets.update(1 / 60, i / 60);
  }
};

test('pets: mine follows her, sits when she stops, and comes and goes with the look', () => {
  const { world, player } = fakeWorld();
  let look = { pet: 'none' };
  const pets = createPets(world, { myLook: () => look });
  pets.update(1 / 60, 0);
  assert.equal(pets.count, 0, 'no pet until she wears one');
  look = { pet: 'cloudPuppy' };
  pets.sync();
  assert.equal(pets.count, 1);
  run(pets, 0.2);
  const e = pets.mine;
  assert.equal(e.visible, true, 'it poofs in');
  // she walks along +Z at 2.6 m/s for 4 s: it keeps up, behind her
  player.speed = 2.6;
  player.anim = 'walk';
  run(pets, 4, () => { player.position.z += 2.6 / 60; });
  const d = Math.hypot(e.x - player.position.x, e.z - player.position.z);
  assert.ok(d > 0.8 && d < 2.2, 'keeps close while she walks: ' + d.toFixed(2));
  assert.ok(e.z < player.position.z, 'behind her');
  assert.ok(e.model.body.position.y > 0.3, 'floating');
  // she stops: it settles and sits
  player.speed = 0;
  player.anim = 'idle';
  run(pets, 2.5);
  assert.ok(e.sit > 0.9, 'sitting');
  assert.ok(Math.hypot(e.vx, e.vz) < 0.05, 'still');
  look = { pet: 'none' };
  pets.sync();
  assert.equal(pets.count, 0, 'gone with "No pet"');
  pets.dispose();
});

test('pets: a happy spin on a cheer, hidden through a game, back after, and along on a teleport', () => {
  const { world, player } = fakeWorld();
  const pets = createPets(world, { myLook: () => ({ pet: 'cloudPuppy' }) });
  run(pets, 1);
  const e = pets.mine;
  assert.equal(pets.cheer('me'), true);
  assert.ok(e.spinT > 0 && e.happyT > 0);
  assert.equal(pets.cheer('me1'), true, 'my net id is me too');
  assert.equal(pets.cheer('nobody'), false);
  // a squad game: it poofs away (a pet would give a hider away), and comes back after
  world.activeGame = { kind: 'hideSeek' };
  run(pets, 0.5);
  assert.equal(e.visible, false);
  assert.equal(e.model.group.visible, false);
  assert.equal(pets.puffs.visible, true, 'a poof');
  world.activeGame = null;
  run(pets, 0.2);
  assert.equal(e.visible, true, 'back after the game');
  // travel: she jumps 40 m away, it poofs along
  player.position.set(40, 0, -12);
  run(pets, 0.1);
  assert.ok(Math.hypot(e.x - 40, e.z + 12) < 2, 'right beside her again');
  // the rescue cloud: gone while she rides, back when she lands
  player.rescuing = true;
  run(pets, 0.3);
  assert.equal(e.visible, false);
  player.rescuing = false;
  player.position.set(0, 0, 0);
  run(pets, 0.1);
  assert.equal(e.visible, true);
  assert.ok(Math.hypot(e.x, e.z) < 2);
  pets.dispose();
});

test('pets: waits at the pad during her toss, sits by the mat for Hit Zero, beside her in the booth', () => {
  const { world, player } = fakeWorld();
  world.groundAt = (x) => (x > 40 ? 14 : 0); // the toss's target cloud, 14 m up, past x = 40
  const pets = createPets(world, { myLook: () => ({ pet: 'cloudPuppy' }) });
  player.position.set(20, 0, 0);
  run(pets, 1);
  const e = pets.mine;
  world.toss.active = true;
  run(pets, 1, (t) => { player.position.set(20 + t * 30, t * 16, 0); }); // up she goes, over the cloud
  run(pets, 2);
  assert.equal(e.mode, 'wait');
  assert.ok(Math.hypot(e.x - 20, e.z) > 1.8 && Math.hypot(e.x - 20, e.z) < 3, 'at the pad, off its mat');
  assert.ok(e.y < 1, 'it stays down at the pad, even with her over a high cloud');
  assert.ok(e.excite > 0.9, 'bouncing');
  // she lands on the cloud and the toss ends: it poofs up beside her
  player.position.set(50, 14, 0);
  world.toss.active = false;
  run(pets, 0.2);
  assert.equal(e.mode, 'follow');
  assert.ok(Math.hypot(e.x - 50, e.z) < 2 && e.y > 13, 'on the cloud with her');
  player.position.set(31, 0.2, -31);
  player.controller = 'hitZero';
  run(pets, 3);
  assert.equal(e.mode, 'stage');
  const dx = e.x - 31;
  const dz = e.z + 31;
  assert.ok(Math.hypot(dx, dz) > 6.5, 'beside the mat, not on it');
  assert.ok(e.sit > 0.9);
  player.controller = 'photoBooth';
  player.heading = 1;
  player.position.set(5, 0, 5);
  run(pets, 2);
  assert.equal(e.mode, 'booth');
  const bd = Math.hypot(e.x - 5, e.z - 5);
  assert.ok(bd > 0.35 && bd < 0.8, 'right beside her: ' + bd.toFixed(2));
  const ahead = (e.x - 5) * Math.sin(1) + (e.z - 5) * Math.cos(1);
  assert.ok(ahead > 0.15, 'a little toward the lens');
  pets.dispose();
});

test('pets: friends wearing one get one; bots never do; at most ten', () => {
  const { world, players, peers, net } = fakeWorld();
  const pets = createPets(world, { myLook: () => ({ pet: 'cloudPuppy' }) });
  const g = (x, z) => {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.visible = true;
    return { group, speed: 0, anim: 'idle' };
  };
  players.set('me1', { id: 'me1', look: { pet: 'cloudPuppy' } });
  players.set('ava', { id: 'ava', look: { pet: 'cloudPuppy' } });
  players.set('bo', { id: 'bo', look: { pet: 'none' } });
  players.set('bot1', { id: 'bot1', bot: true, look: { pet: 'cloudPuppy' } });
  for (let i = 0; i < 12; i++) players.set('f' + i, { id: 'f' + i, look: { pet: 'cloudPuppy' } });
  for (const id of players.keys()) peers.set(id, g(Math.random() * 10, Math.random() * 10));
  net.emit('join');
  assert.equal(pets.count, PET.max, 'at most ten');
  assert.ok(pets.get('me'), 'mine');
  assert.ok(pets.get('ava'), "a friend's");
  assert.equal(pets.get('bo'), null, 'no pet chosen');
  assert.equal(pets.get('bot1'), null, 'bots never');
  run(pets, 1);
  const ava = pets.get('ava');
  assert.equal(ava.visible, true);
  assert.ok(Math.hypot(ava.x - peers.get('ava').group.position.x, ava.z - peers.get('ava').group.position.z) < 2, 'follows her');
  // she leaves the room: her pet goes with her
  players.delete('ava');
  net.emit('leave');
  assert.equal(pets.get('ava'), null);
  pets.dispose();
});
