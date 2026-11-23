// The photo wall's art (js/art/photowall-art.js): every polaroid and the banner in one atlas, the
// polaroids on the heart, the budget, and which polaroid a tap lands on. Runs without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.min.js';
import { SLOTS, SLOT_SIZE, atlasLayout, slotFrame, BANNER, buildPhotoWallArt } from '../js/art/photowall-art.js';
import { makeIslandPlan, heartPoint, HEART } from '../js/art/island-layout.js';
import { PHOTO_LIMITS } from '../js/core/photos.js';

const plan = makeIslandPlan();
const W = plan.photoWall;

test('twelve polaroids, the first the big star in the middle', () => {
  assert.equal(SLOTS.length, PHOTO_LIMITS.max);
  assert.ok(SLOTS[0].star && SLOTS.filter((s) => s.star).length === 1);
  assert.ok(Math.abs(SLOTS[0].x) < 0.05 && Math.abs(SLOTS[0].y) < 0.3, 'the star sits in the middle');
  assert.ok(SLOTS[0].layer > Math.max(...SLOTS.slice(1).map((s) => s.layer)), 'and on top');
  assert.ok(SLOT_SIZE.star.w > SLOT_SIZE.regular.w * 1.4);
  for (const s of SLOTS) assert.ok(['tape', 'pin', 'tapes'].includes(s.hold) && Math.abs(s.tilt) <= 10, 'tilted a little, taped or pinned');
  // a polaroid's frame is about 5:6, like the real thing
  for (const k of ['regular', 'star']) assert.ok(Math.abs(SLOT_SIZE[k].w / SLOT_SIZE[k].h - 0.84) < 0.03);
});

test('the polaroids cover the heart: their middles on it, and hardly any of them hanging off', () => {
  const s = W.board.scale;
  const ring = [];
  for (let i = 0; i < 720; i++) {
    const p = heartPoint((i / 720) * Math.PI * 2);
    ring.push([p[0] * s, p[1] * s]);
  }
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if ((ring[i][1] > y) !== (ring[j][1] > y) && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
    }
    return c;
  };
  SLOTS.forEach((sl, i) => {
    const f = slotFrame(i);
    assert.ok(inside(f.x, f.y), 'polaroid ' + i + ' sits on the heart');
    // sample the frame: at least 80% of it on the board
    let on = 0;
    let n = 0;
    for (let u = -0.5; u <= 0.5; u += 0.1) {
      for (let v = -0.5; v <= 0.5; v += 0.1) {
        const lx = u * f.w;
        const ly = v * f.h;
        const x = f.x + lx * Math.cos(f.tilt) - ly * Math.sin(f.tilt);
        const y = f.y + lx * Math.sin(f.tilt) + ly * Math.cos(f.tilt);
        n++;
        if (inside(x, y)) on++;
      }
    }
    assert.ok(on / n >= 0.8, 'polaroid ' + i + ' is ' + Math.round((100 * on) / n) + '% on the heart');
  });
  // the board is the size the plan says, with the tip near the ground and the lobes about 5 m up
  assert.equal(W.board.w, HEART.width * s);
  assert.ok(W.board.cy + HEART.tip * s > 0.3 && W.board.cy + HEART.top * s < 5.2);
});

test('the atlas: every polaroid and the banner in their own cells, inside it, at 2048 and at 1024', () => {
  for (const size of [2048, 1024]) {
    const L = atlasLayout(size);
    const rects = [...L.cells, L.banner];
    for (const r of rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= size && r.y + r.h <= size, 'inside the ' + size + ' atlas');
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, 'cells ' + i + ' and ' + j + ' overlap at ' + size);
      }
    }
    L.cells.forEach((c, i) => {
      // the frame inside the cell with a margin (tape and mipmaps), the photo and the caption inside the frame
      assert.ok(c.frame.x > c.x && c.frame.y > c.y && c.frame.x + c.frame.w < c.x + c.w && c.frame.y + c.frame.h < c.y + c.h, 'margin round polaroid ' + i);
      for (const part of [c.photo, c.caption]) {
        assert.ok(part.x >= c.frame.x && part.y >= c.frame.y && part.x + part.w <= c.frame.x + c.frame.w && part.y + part.h <= c.frame.y + c.frame.h, 'polaroid ' + i + ' parts inside its frame');
      }
      assert.ok(c.photo.y + c.photo.h <= c.caption.y, 'the caption under the photo');
      assert.equal(c.photo.w, c.photo.h, 'a square photo window, like a real polaroid');
    });
  }
  const big = atlasLayout(2048);
  const small = atlasLayout(1024);
  small.cells.forEach((c, i) => assert.ok(Math.abs(c.x * 2 - big.cells[i].x) <= 1 && Math.abs(c.w * 2 - big.cells[i].w) <= 1, 'the 1024 atlas is the 2048 one at half size'));
  // enough pixels: the star's photo window at least 600 px on the big atlas, a small one at least 300
  assert.ok(big.cells[0].photo.w >= 600 && big.cells[1].photo.w >= 300);
  assert.ok(BANNER.w / BANNER.h > 5, 'a long banner');
});

test('the whole wall is a handful of draw calls and a few thousand triangles', () => {
  for (const quality of ['high', 'low']) {
    const art = buildPhotoWallArt(W, { quality, yAt: plan.ground.groundAt });
    assert.equal(art.drawCalls, 5);
    assert.ok(art.triangles > 1000 && art.triangles < 8000, quality + ': ' + art.triangles + ' triangles');
    const meshes = [];
    art.group.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    assert.equal(meshes.length, 5, 'the board, the polaroids, the bulbs, the glow and the balloons');
    // the polaroids: one mesh, two triangles each, and the banner's two sides
    const pol = meshes.find((m) => m.name === 'photoWallPolaroids');
    assert.equal(pol.geometry.attributes.position.count, (SLOTS.length + 2) * 6);
    assert.equal(pol.material.toneMapped, false);
    assert.ok(pol.material.alphaTest > 0 && !pol.material.transparent, 'cut out, not blended');
    art.dispose();
  }
});

test('a tap on a polaroid finds it (the one on top), and a tap from behind or beside finds none', () => {
  const art = buildPhotoWallArt(W, { yAt: plan.ground.groundAt });
  const out = new THREE.Vector3(Math.sin(W.facing), 0, Math.cos(W.facing));
  for (let i = 0; i < SLOTS.length; i++) {
    const p = art.slotWorld(i);
    const from = p.clone().addScaledVector(out, 6).add(new THREE.Vector3(0, 0.6, 0));
    const ray = new THREE.Ray(from, p.clone().sub(from).normalize());
    assert.equal(art.slotAt(ray), i, 'polaroid ' + i);
  }
  // from behind the board
  const p0 = art.slotWorld(0);
  const back = p0.clone().addScaledVector(out, -6);
  assert.equal(art.slotAt(new THREE.Ray(back, p0.clone().sub(back).normalize())), -1);
  // at the pink between them, below the tip
  const c = Math.cos(W.facing);
  const s = Math.sin(W.facing);
  const low = new THREE.Vector3(W.x + 2.3 * c, W.y + 0.3, W.z - 2.3 * s);
  const eye = low.clone().addScaledVector(out, 5);
  assert.equal(art.slotAt(new THREE.Ray(eye, low.clone().sub(eye).normalize())), -1);
  assert.equal(art.slotAt(null), -1);
  art.dispose();
});
