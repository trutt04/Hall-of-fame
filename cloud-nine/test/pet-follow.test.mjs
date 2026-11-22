// The cloud puppy's behaviour as pure maths: where it likes to be, the soft spring that takes it
// there, what it does when, and where it sits for Hit Zero and the basket toss.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PET, followSpot, springStep, petMode, stageSpot, padSpot } from '../js/world/pets.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('followSpot: about 1.2 m behind her, to one side', () => {
  for (const h of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.1, 5.5]) {
    const fwd = { x: Math.sin(h), z: Math.cos(h) };
    const right = { x: -Math.cos(h), z: Math.sin(h) }; // facing +Z, her right is -X
    for (const side of [1, -1]) {
      const o = followSpot(10, -4, h, side, {});
      const dx = o.x - 10;
      const dz = o.z + 4;
      const d = Math.hypot(dx, dz);
      assert.ok(d > 1.1 && d < 1.3, 'distance ' + d.toFixed(3));
      assert.ok(dx * fwd.x + dz * fwd.z < -0.9, 'behind her');
      const across = dx * right.x + dz * right.z;
      assert.ok(across * side > 0.5, 'on her ' + (side > 0 ? 'right' : 'left'));
    }
  }
  // heading 0 faces +Z: behind is -Z, her right is -X
  const o = followSpot(0, 0, 0, 1, {});
  assert.ok(near(o.x, -PET.beside) && near(o.z, -PET.back));
});

test('springStep: settles on the target without overshooting, from any start', () => {
  for (const start of [-9, -1, 0.3, 4, 25]) {
    const s = { x: start, z: -start, vx: 0, vz: 0, y: 0, vy: 0 };
    const target = { x: 2, z: 1, y: 0.5 };
    let prev = Math.abs(s.x - target.x);
    for (let i = 0; i < 120; i++) {
      springStep(s, target, PET.omega, 1 / 60);
      const d = Math.abs(s.x - target.x);
      assert.ok(d <= prev + 1e-12, 'never moves away from the target (no overshoot)');
      assert.ok(Math.sign(s.x - target.x) === Math.sign(start - target.x) || d < 1e-9, 'never crosses it');
      prev = d;
    }
    assert.ok(Math.abs(s.x - 2) < 0.06 * Math.abs(start - 2) + 1e-6, 'nearly there after 2 s');
    for (let i = 0; i < 300; i++) springStep(s, target, PET.omega, 1 / 60);
    assert.ok(near(s.x, 2, 1e-3) && near(s.z, 1, 1e-3) && near(s.y, 0.5, 1e-3), 'there');
  }
});

test('springStep: the same at 30, 60 and 120 frames a second, and calm on a very slow frame', () => {
  const run = (fps) => {
    const s = { x: 0, z: 0, vx: 3, vz: -1 };
    for (let i = 0; i < fps; i++) springStep(s, { x: 5, z: 2 }, 6, 1 / fps);
    return s;
  };
  const a = run(30);
  const b = run(60);
  const c = run(120);
  assert.ok(near(a.x, b.x, 1e-9) && near(b.x, c.x, 1e-9) && near(a.z, c.z, 1e-9), 'exact for any dt');
  // a half-second hitch: no blow-up, no jump past the target
  const s = { x: 0, z: 0, vx: 0, vz: 0 };
  springStep(s, { x: 3, z: 0 }, 12, 0.5);
  assert.ok(s.x > 0 && s.x <= 3 && Number.isFinite(s.vx));
  // a target without y leaves y alone; non-finite targets are ignored
  const t = { x: 1, z: 1, vx: 0, vz: 0, y: 7, vy: 0 };
  springStep(t, { x: 1, z: NaN }, 5, 0.1);
  assert.equal(t.y, 7);
  assert.equal(t.z, 1);
});

test('petMode: hidden for games and the rescue cloud, waiting for the toss, sitting for Hit Zero and the booth', () => {
  const f = (o) => petMode({ visible: true, ...o });
  assert.equal(petMode(null), 'away');
  assert.equal(petMode({ visible: false, game: true }), 'away');
  assert.equal(f({}), 'follow');
  assert.equal(f({ game: true }), 'hidden');
  assert.equal(f({ game: true, booth: true, stage: true, tossing: true }), 'hidden', 'a game beats everything');
  assert.equal(f({ rescuing: true }), 'hidden');
  assert.equal(f({ tossing: true }), 'wait');
  assert.equal(f({ tossing: true, airborne: true }), 'wait');
  assert.equal(f({ stage: true }), 'stage');
  assert.equal(f({ booth: true }), 'booth');
  assert.equal(f({ airborne: true }), 'wait', 'a friend way up in the air: it waits below');
});

test('stageSpot: beside the 12 m mat on her side, never on it', () => {
  for (const facing of [0, -Math.PI / 4, 2]) {
    const stage = { x: 31, z: -31, facing };
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    for (const [lx, lz] of [[0, 0], [1.6, -1.3], [-3.2, -2.6], [4.6, -3.9], [-0.1, 5.5]]) {
      const x = stage.x + c * lx + s * lz;
      const z = stage.z - s * lx + c * lz;
      const o = stageSpot(stage, x, z, {});
      const dx = o.x - stage.x;
      const dz = o.z - stage.z;
      const px = c * dx - s * dz;
      const pz = s * dx + c * dz;
      assert.ok(near(Math.abs(px), PET.stageSide, 1e-9) && Math.abs(px) > 6, 'beside the mat');
      assert.ok(Math.sign(px) === (lx >= 0 ? 1 : -1), 'on her side');
      assert.ok(Math.abs(pz) <= 5 + 1e-9, 'along the mat, clear of the judges and the backdrop');
    }
  }
});

test('padSpot: beside the toss pad, off its spots', () => {
  for (const heading of [0, 1, -2.5]) {
    const o = padSpot({ x: -20, z: 8, heading }, {});
    const d = Math.hypot(o.x + 20, o.z - 8);
    assert.ok(d > 2.2 && d < 2.6, 'off the mat: ' + d.toFixed(2));
  }
});
