// The photo booth's pure parts (js/world/photobooth.js): frames and poses, the picture's layout,
// who is in the shot and where the lens goes, the 'fx' friends get over the network, and the words.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_W, PHOTO_H, FRAMES, POSES, framesFor, poseById, friendPose, frameLayout, toBooth, fromBooth,
  shotSubjects, shotFraming, aimLook, viewfinderRect, screenFovFor, cleanBoothFx, dateLabel, photoFileName,
  BOOTH_LINES, boothLine, MARK_DEPTH,
} from '../js/world/photobooth.js';
import { ANIM_INFO } from '../js/art/character-poses.js';
import { copyProblems } from './content-copy-rules.mjs';

// the island's booth: by the plaza, its front (and lens) facing +x
const BOOTH = { x: -14, z: -3.5, facing: Math.PI / 2 };
const mark = () => {
  const p = fromBooth(BOOTH, 0, MARK_DEPTH);
  return { x: p.x, y: 0, z: p.z };
};

// project a world point through a camera at cam looking at look (three.js conventions)
function project(cam, look, fov, aspect, p) {
  let fx = look.x - cam.x;
  let fy = look.y - cam.y;
  let fz = look.z - cam.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  // right = forward x up(0,1,0)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl; rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const z = dx * fx + dy * fy + dz * fz;
  const x = dx * rx + dz * rz;
  const y = dx * ux + dy * uy + dz * uz;
  const tv = Math.tan((fov * Math.PI) / 360);
  return { x: x / (z * tv * aspect), y: y / (z * tv), z };
}

test('frames: three in her colours and the pastels, plus a birthday one on her birthday', () => {
  const normal = framesFor(false);
  const bday = framesFor(true);
  assert.ok(normal.length >= 3 && normal.length <= 4, 'three or four frames');
  assert.equal(bday.length, normal.length + 1);
  assert.ok(bday.some((f) => f.id === 'birthday') && !normal.some((f) => f.id === 'birthday'));
  assert.equal(new Set(FRAMES.map((f) => f.id)).size, FRAMES.length, 'ids are unique');
  for (const f of FRAMES) {
    assert.match(f.accent, /^#[0-9a-f]{6}$/i, f.id + ' accent');
    assert.ok(typeof f.label === 'string' && f.label.length <= 12, f.id + ' label');
    assert.ok(!f.tag || f.tag.length <= 16, f.id + ' tag');
  }
});

test('poses: four to six, every one a real character animation', () => {
  assert.ok(POSES.length >= 4 && POSES.length <= 6);
  for (const p of POSES) assert.ok(ANIM_INFO[p.anim], p.id + ' plays ' + p.anim);
  assert.ok(POSES.some((p) => p.jump), 'a jump, timed for the shutter');
  assert.equal(poseById('nope').id, POSES[0].id, 'unknown ids fall back');
  // friends strike held poses (a jump can't be timed over the network), the same for the same seed
  for (const seed of ['a', 'bb', 'ccc', 'friend-42', '']) {
    const p = friendPose(seed);
    assert.ok(p.friend && !p.jump, seed + ' -> ' + p.id);
    assert.equal(friendPose(seed), p);
  }
});

test('the picture: 4:5, the scene window on top, the title and date on the band, sparkles off the faces', () => {
  for (const [w, h] of [[PHOTO_W, PHOTO_H], [540, 675]]) {
    assert.equal(w / h, 0.8);
    for (const f of FRAMES) {
      const L = frameLayout(f.id, w, h);
      const { win } = L;
      assert.equal(L.w, w);
      assert.equal(L.h, h);
      assert.ok(win.x > 0 && win.y > 0 && win.x + win.w < w && win.y + win.h < h, f.id + ': window inside');
      assert.ok(win.w / win.h > 0.8 && win.w / win.h < 1, f.id + ': a portrait window');
      assert.ok(win.w * win.h > w * h * 0.65, f.id + ': the scene is most of the picture');
      for (const t of [L.title, L.date]) {
        assert.ok(t.y > win.y + win.h && t.y + t.size / 2 < h, f.id + ': words on the band');
        assert.ok(t.size >= h * 0.025, f.id + ': words big enough to read');
      }
      assert.ok(L.title.size > L.date.size);
      assert.equal(!!L.tag, !!f.tag, f.id + ': a sticker only for frames with a word');
      // no sparkle sits over the middle of the scene
      const inner = { x0: win.x + w * 0.06, y0: win.y + w * 0.06, x1: win.x + win.w - w * 0.06, y1: win.y + win.h - w * 0.06 };
      for (const s of L.sparkles) {
        assert.ok(s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h, f.id + ': sparkle on the picture');
        const over = s.x + s.r > inner.x0 && s.x - s.r < inner.x1 && s.y + s.r > inner.y0 && s.y - s.r < inner.y1;
        assert.ok(!over, f.id + ': sparkle at ' + s.x + ',' + s.y + ' covers the scene');
      }
      assert.deepEqual(frameLayout(f.id, w, h), L, 'the same every time');
    }
  }
});

test('booth axes: the lens looks out of the front', () => {
  const p = fromBooth(BOOTH, 1.5, 4);
  const q = toBooth(BOOTH, p.x, p.z);
  assert.ok(Math.abs(q.u - 1.5) < 1e-9 && Math.abs(q.v - 4) < 1e-9);
  // facing +x: straight out of the front is +x
  const out = fromBooth(BOOTH, 0, 5);
  assert.ok(Math.abs(out.x - (BOOTH.x + 5)) < 1e-9 && Math.abs(out.z - BOOTH.z) < 1e-9);
});

test('who is in the shot: friends and bots within 6 m, on her level, in front of the booth', () => {
  const me = mark();
  const at = (u, v, y = 0, extra = {}) => Object.assign({ x: fromBooth(BOOTH, u, v).x, y, z: fromBooth(BOOTH, u, v).z }, extra);
  const others = [
    at(1.2, MARK_DEPTH, 0, { id: 'beside' }),
    at(-2, MARK_DEPTH + 2, 0, { id: 'bot', bot: true }),
    at(0, MARK_DEPTH + 7, 0, { id: 'far' }), // 7 m away
    at(1, MARK_DEPTH, 8, { id: 'cloud' }), // up on a cloud
    at(0, -2, 0, { id: 'behind' }), // behind the booth
    at(4, 0.5, 0, { id: 'side' }), // beside the booth, where the lens can't see
    { id: 'broken', x: NaN, y: 0, z: 0 },
    null,
  ];
  const got = shotSubjects(me, others, BOOTH);
  assert.deepEqual(got.map((s) => s.id), ['beside', 'bot']);
  assert.equal(got[1].bot, true);
  assert.deepEqual(shotSubjects(me, [], BOOTH), []);
  assert.deepEqual(shotSubjects({ x: NaN, y: 0, z: 0 }, others, BOOTH), []);
  // a crowd is capped, nearest first
  const crowd = [];
  for (let i = 0; i < 14; i++) crowd.push(at(-3 + (i % 7), MARK_DEPTH + 1 + Math.floor(i / 7) * 1.5, 0, { id: 'c' + i }));
  const some = shotSubjects(me, crowd, BOOTH);
  assert.equal(some.length, 9);
  for (let i = 1; i < some.length; i++) assert.ok(some[i].d >= some[i - 1].d);
});

test('the lens fits everyone in the picture and never goes inside the booth', () => {
  const aspect = frameLayout('cloudNine').win.w / frameLayout('cloudNine').win.h;
  const me = mark();
  const at = (u, v, y = 0) => ({ x: fromBooth(BOOTH, u, v).x, y, z: fromBooth(BOOTH, u, v).z });
  const groups = {
    solo: [me],
    pair: [me, at(1.3, MARK_DEPTH + 0.3)],
    trio: [me, at(-1.4, MARK_DEPTH + 0.5), at(1.5, MARK_DEPTH + 0.8)],
    squad: [me, at(-2.5, MARK_DEPTH + 1), at(2.8, MARK_DEPTH + 2), at(0.5, MARK_DEPTH + 4.5)],
    wide: [me, at(-5.5, MARK_DEPTH + 1.5), at(5.5, MARK_DEPTH + 1)],
    near: [me, at(-3, 3), at(3, 3)],
  };
  for (const [name, subjects] of Object.entries(groups)) {
    const f = shotFraming(subjects, BOOTH, { aspect });
    // in front of the booth, or (a squad too wide for that) up over its roof, never inside it
    if (f.crane) assert.ok(f.cam.y >= 4 + 1e-9, name + ': the crane is above the roof');
    else assert.ok(toBooth(BOOTH, f.cam.x, f.cam.z).v >= 1.85 - 1e-9, name + ': the camera is in front of the booth');
    assert.ok(f.fov >= 40 && f.fov <= 80, name + ': fov ' + f.fov);
    for (const s of subjects) {
      // her feet, the top of her bow mid toe touch, and her hands out wide
      for (const [du, dy] of [[0, 0], [0, 2.2], [-0.55, 1.2], [0.55, 1.2]]) {
        const { u, v } = toBooth(BOOTH, s.x, s.z);
        const p = fromBooth(BOOTH, u + du, v);
        const q = project(f.cam, f.look, f.fov, aspect, { x: p.x, y: s.y + dy, z: p.z });
        if (name === 'near') continue; // checked below: as many as fit
        assert.ok(q.z > 0 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1, name + ': ' + JSON.stringify(q));
      }
    }
    if (name === 'solo') {
      // a solo portrait: she fills a good part of the frame
      const head = project(f.cam, f.look, f.fov, aspect, { x: me.x, y: 1.6, z: me.z });
      const feet = project(f.cam, f.look, f.fov, aspect, { x: me.x, y: 0, z: me.z });
      assert.ok(head.y - feet.y > 1.0, 'she is more than half the picture tall');
      assert.equal(f.crane, false);
    }
  }
  // even a friend right beside the booth: she is always in it
  const f = shotFraming(groups.near, BOOTH, { aspect });
  const q = project(f.cam, f.look, f.fov, aspect, { x: me.x, y: 1, z: me.z });
  assert.ok(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1);
  // nobody (bad input): still a sensible lens
  const none = shotFraming([], BOOTH, { aspect });
  assert.ok([none.cam.x, none.cam.y, none.cam.z, none.look.x, none.fov].every(Number.isFinite));
});

test('aimLook puts her where the card is not', () => {
  const cam = { x: 0, y: 1.4, z: 0 };
  const target = { x: 0.3, y: 0.9, z: 4 };
  for (const [W, H, sx, sy, fov] of [[390, 844, 195, 211, 64], [1024, 768, 300, 400, 50]]) {
    const look = aimLook(cam, target, sx, sy, W, H, fov);
    const q = project(cam, look, fov, W / H, target);
    const px = ((q.x + 1) / 2) * W;
    const py = ((1 - q.y) / 2) * H;
    assert.ok(Math.abs(px - sx) < W * 0.03 && Math.abs(py - sy) < H * 0.03, `${px},${py} vs ${sx},${sy}`);
  }
});

test('the viewfinder shows exactly the picture', () => {
  for (const [W, H] of [[390, 844], [1024, 768], [844, 390]]) {
    const r = viewfinderRect(W, H, 0.9);
    assert.ok(Math.abs(r.w / r.h - 0.9) < 1e-9);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 1e-9 && r.y + r.h <= H + 1e-9);
    const fov = screenFovFor(44, r.h, H);
    // the box's share of the screen's height, through the wider lens, is the picture's lens
    const t = Math.tan((fov * Math.PI) / 360) * (r.h / H);
    assert.ok(Math.abs(t - Math.tan((44 * Math.PI) / 360)) < 1e-9);
  }
  assert.ok(Math.abs(screenFovFor(44, 500, 500) - 44) < 1e-9);
});

test("friends' 'fx': only a well-formed booth shot, close in time, is believed", () => {
  const now = 1.8e12;
  const ok = { kind: 'booth', shot: 'ab12cd', x: -8.8, z: -3.5, cx: -11, cz: -3.5, at: now + 3000 };
  assert.deepEqual(cleanBoothFx(ok, now), { x: -8.8, z: -3.5, cx: -11, cz: -3.5, at: now + 3000, shot: 'ab12cd' });
  const bad = [
    null, undefined, 'booth', 42, [], [ok],
    Object.assign({}, ok, { kind: 'burst' }),
    Object.assign({}, ok, { x: '1' }),
    Object.assign({}, ok, { z: NaN }),
    Object.assign({}, ok, { cx: Infinity }),
    Object.assign({}, ok, { cz: 1e9 }),
    Object.assign({}, ok, { at: now - 60000 }), // long gone
    Object.assign({}, ok, { at: now + 60000 }), // far in the future
    Object.assign({}, ok, { at: 'soon' }),
    Object.assign({}, ok, { cx: ok.x + 500 }), // a lens nowhere near the mark
  ];
  for (const b of bad) assert.equal(cleanBoothFx(b, now), null, JSON.stringify(b));
  // a junk shot id is dropped, not shown or used
  assert.equal(cleanBoothFx(Object.assign({}, ok, { shot: '<img src=x>' }), now).shot, '');
  assert.equal(cleanBoothFx(Object.assign({}, ok, { shot: 'x'.repeat(40) }), now).shot, '');
  // no extra fields come through
  const extra = cleanBoothFx(Object.assign({}, ok, { name: 'Ava', anim: 'dance', __proto__: { evil: 1 } }), now);
  assert.deepEqual(Object.keys(extra).sort(), ['at', 'cx', 'cz', 'shot', 'x', 'z']);
});

test('the words: hype, sweet and funny, never about looks, bodies or food', () => {
  for (const [kind, list] of Object.entries(BOOTH_LINES)) {
    assert.ok(list.length >= 2, kind);
    for (const line of list) assert.deepEqual(copyProblems(line, kind, { max: 60, praise: true }), []);
    assert.ok(list.includes(boothLine(kind, () => 0.999)));
    assert.equal(boothLine(kind, () => 0), list[0]);
  }
  assert.ok(BOOTH_LINES.result.includes('Picture perfect!'));
  assert.ok(BOOTH_LINES.countdown.includes('Say cheese... I mean CHEER!'));
  for (const f of FRAMES) assert.deepEqual(copyProblems(f.label, f.id, { max: 16 }), []);
  for (const p of POSES) assert.deepEqual(copyProblems(p.label, p.id, { max: 16 }), []);
});

test('the date on the picture and the file name', () => {
  const d = new Date(2026, 10, 22, 15, 4, 9);
  assert.equal(dateLabel(d), 'Nov 22, 2026');
  assert.equal(photoFileName(d), 'cloud-nine-photo-2026-11-22-150409.png');
  assert.match(photoFileName(new Date('nope')), /^cloud-nine-photo-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
  assert.match(dateLabel(), /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
});
