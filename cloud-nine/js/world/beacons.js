// Activity beacons: a round badge with an icon and a short label floating over each place where
// there is something to do (the basket toss pads, the Hit Zero stage, the photo booth, and the four
// game fields), so a new cheerleader sees from across the island where the fun is. They bob gently,
// keep a steady size on screen (a map pin, not a billboard), fade away as she walks up to one, and
// all step aside while a game, Hit Zero, the booth or the toss has the screen.
//
// Cheap on purpose: every badge is drawn once into one canvas atlas (one texture); each beacon is a
// sprite with its own little quad pointing at its cell. 7 sprites = at most 7 draw calls, ~14
// triangles, nothing allocated per frame.
//
//   import { createBeacons, beaconSpots, beaconFade, beaconHeight, BEACON_KINDS } from './world/beacons.js'
//   const beacons = createBeacons({ scene, places, groundAt })
//   beacons.update(dt, t, camera, playerPos, show)   every frame; show: false fades them all out
//   beacons.intro()                                  pop them in one by one (her first arrival)
//   beacons.list                                     [{ id, label, x, y, z, sprite }] (tests, dev)
//   beacons.visibleCount                             how many are drawn this frame (tests)
//   beacons.dispose()
//
// Pure helpers (node tests, no three.js state):
//   beaconSpots(places, groundAt) -> [{ id, label, color, icon, x, y, z, near, far }]
//   beaconFade(d, near, far) -> 0..1 (0 within near metres, 1 beyond far)
//   beaconHeight(d, pxPerRad) -> the sprite's height in metres at distance d, so its label stays
//                                about 17 px tall on screen (smaller far away, never tiny up close)

import * as THREE from '../../lib/three.module.min.js';
import { FONT_STACK, PALETTE } from '../config.js';
import { motion } from '../art/util.js';

// One entry per beacon. `near`/`far`: she is "here" within near metres (gone), it is fully shown
// beyond far. `up`: how high over the place's ground the label's bottom floats.
export const BEACON_KINDS = Object.freeze([
  Object.freeze({ id: 'toss', label: 'Basket toss', color: '#ffe08a', icon: 'toss', up: 6.5, near: 9, far: 15 }),
  Object.freeze({ id: 'stage', label: 'Hit Zero', color: '#c9b6ff', icon: 'music', up: 7.5, near: 9, far: 15 }),
  Object.freeze({ id: 'booth', label: 'Photo booth', color: '#ffc4df', icon: 'camera', up: 6.6, near: 9.5, far: 15 }),
  Object.freeze({ id: 'court', label: 'Dodgeball', color: '#ffb3d9', icon: 'ball', up: 5.5, near: 9, far: 15 }),
  Object.freeze({ id: 'bowField', label: 'Capture the Bow', color: '#ffd0b0', icon: 'bow', up: 5.5, near: 12, far: 19 }),
  Object.freeze({ id: 'tagZone', label: 'Freeze tag', color: '#9fd8ff', icon: 'snow', up: 5.5, near: 10, far: 16 }),
  Object.freeze({ id: 'hideGarden', label: 'Hide and seek', color: '#a9ecd0', icon: 'eyes', up: 6.5, near: 11, far: 17 }),
]);

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const centre = (b) => (b && [b.x0, b.z0, b.x1, b.z1].every(fin) ? { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 } : null);

// Where each beacon stands: over the middle toss pad (one badge for the group of three), over the
// stage, the booth, the court and the field, and over the middle of the tag lawn and the garden.
export function beaconSpots(places, groundAt) {
  const P = places || {};
  const ground = (x, z) => {
    let y = -Infinity;
    try {
      y = typeof groundAt === 'function' ? groundAt(x, z) : 0;
    } catch (err) {
      y = -Infinity;
    }
    return Number.isFinite(y) ? y : 0;
  };
  const pads = Array.isArray(P.tossPads) ? P.tossPads.filter((p) => p && fin(p.x) && fin(p.z)) : [];
  const where = {
    toss: pads.length ? pads[Math.floor((pads.length - 1) / 2)] : null,
    stage: P.stage,
    booth: P.photoBooth,
    court: P.court,
    bowField: P.bowField,
    tagZone: P.tagZone ? centre(P.tagZone.bounds) : null,
    hideGarden: P.hideGarden ? centre(P.hideGarden.bounds) : null,
  };
  const out = [];
  for (const k of BEACON_KINDS) {
    const p = where[k.id];
    if (!p || !fin(p.x) || !fin(p.z)) continue;
    out.push({ id: k.id, label: k.label, color: k.color, icon: k.icon, x: p.x, y: ground(p.x, p.z) + k.up, z: p.z, near: k.near, far: k.far });
  }
  return out;
}

export function beaconFade(d, near, far) {
  if (!(d > near)) return 0;
  if (d >= far) return 1;
  const u = (d - near) / Math.max(0.001, far - near);
  return u * u * (3 - 2 * u);
}

// The atlas cell is 512 x 256 and the label's letters are 36 px of its 256: so on a phone in
// portrait (about 600 px per radian at a 70 degree field of view) a height of 0.2 m per metre away
// keeps the label near 17 px. Far beacons shrink a little (less clutter), near ones never go tiny.
const LABEL_SHARE = 36 / 256;
export function beaconHeight(d, pxPerRad = 600) {
  const dist = Math.max(0, Number(d) || 0);
  const k = 17 / (Math.max(200, pxPerRad) * LABEL_SHARE);
  const shrink = dist <= 45 ? 1 : Math.max(0.7, 1 - (dist - 45) * 0.0045);
  return Math.max(3, dist * k * shrink);
}

// ------------------------------------------------------------------------------------ the atlas

const COLS = 2;
const ROWS = 4;
const CW = 512;
const CH = 256;
const BADGE = { x: 256, y: 100, r: 70 };
const PILL = { y: 186, h: 60, font: 36 };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sparkle(ctx, x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 ? r * 0.32 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Icons in a 24-unit box (the HUD's icon language): stroked ink with hot-pink fills.
const INK = PALETTE.black;
const PINK = PALETTE.pink;
function drawIcon(ctx, name) {
  const P = (d) => new Path2D(d);
  const stroke = (d, w = 2.3, color = INK) => {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke(P(d));
  };
  const fill = (d, color) => {
    ctx.fillStyle = color;
    ctx.fill(P(d));
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (name) {
    case 'toss': {
      const star = 'M12 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z';
      fill(star, PINK);
      stroke(star, 1.6);
      stroke('M5.5 18.2l6.5-4.6 6.5 4.6M5.5 22.4l6.5-4.6 6.5 4.6', 2.5);
      break;
    }
    case 'music': {
      stroke('M9 18V5.2l11-2.2v13', 2.3);
      const heads = 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';
      fill(heads, PINK);
      stroke(heads, 2);
      stroke('M9 9l11-2.2', 2);
      break;
    }
    case 'camera': {
      const body = 'M3 8.4h4.2l1.9-2.8h5.8l1.9 2.8H21v11H3z';
      fill(body, INK);
      stroke(body, 1.6);
      const lens = 'M12 17.6a4 4 0 1 0 0-8 4 4 0 0 0 0 8z';
      fill(lens, PINK);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(P(lens));
      fill('M10.6 12.4a1.2 1.2 0 1 0 0-.01z', '#ffffff');
      fill('M17.2 10h2v1.5h-2z', PALETTE.lemon);
      break;
    }
    case 'ball': {
      const ball = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';
      fill(ball, PINK);
      stroke(ball, 2.1);
      stroke('M3.6 9.6c5 1.6 11.8 1.6 16.8 0M3.6 14.4c5-1.6 11.8-1.6 16.8 0', 1.6, '#ffffff');
      break;
    }
    case 'bow': {
      const loops = 'M12 12C9 7.6 3.6 5.6 3.4 9.6 3.2 13.6 9 14.4 12 12zM12 12c3-4.4 8.4-6.4 8.6-2.4.2 4-5.6 4.8-8.6 2.4z';
      const tails = 'M10.6 12.8 7.6 19.4l2.2-.7 1 1.9L13 13.4zM13.4 12.8l3 6.6-2.2-.7-1 1.9L11 13.4z';
      fill(tails, '#e0137c');
      stroke(tails, 1.5);
      fill(loops, PINK);
      stroke(loops, 1.7);
      fill('M10.4 10.6h3.2v2.8h-3.2z', '#ff4fa3');
      stroke('M10.4 10.6h3.2v2.8h-3.2z', 1.4);
      fill('M6.2 9.1l.5 1 1.1.2-.8.7.2 1.1-1-.5-1 .5.2-1.1-.8-.7 1.1-.2zM17.8 9.1l.5 1 1.1.2-.8.7.2 1.1-1-.5-1 .5.2-1.1-.8-.7 1.1-.2z', INK);
      break;
    }
    case 'snow': {
      const flake = 'M12 2.6v18.8M3.9 7.3l16.2 9.4M3.9 16.7l16.2-9.4M9.4 3.9 12 6.5l2.6-2.6M9.4 20.1 12 17.5l2.6 2.6M3.4 10.6l3.6-.9-1-3.6M20.6 10.6l-3.6-.9 1-3.6M3.4 13.4l3.6.9-1 3.6M20.6 13.4l-3.6.9 1 3.6';
      stroke(flake, 4.4, '#ffffff');
      stroke(flake, 2.2, '#3f7fd9');
      break;
    }
    case 'eyes': {
      for (const dx of [-5.4, 5.4]) {
        ctx.save();
        ctx.translate(dx, 0);
        const eye = 'M12 6.5c3.2 0 5 2.6 5 5.5s-1.8 5.5-5 5.5-5-2.6-5-5.5 1.8-5.5 5-5.5z';
        fill(eye, '#ffffff');
        stroke(eye, 1.9);
        fill('M12.8 14.6a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z', INK);
        fill('M13.5 11.3a.75.75 0 1 0 0-.01z', '#ffffff');
        ctx.restore();
      }
      stroke('M4 5.6c1.4-1.2 3.2-1.6 5-1.2M20 5.6c-1.4-1.2-3.2-1.6-5-1.2', 1.6);
      break;
    }
    default:
      fill('M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z', PINK);
  }
}

function drawCell(ctx, kind, col, row) {
  const ox = col * CW;
  const oy = row * CH;
  ctx.save();
  ctx.translate(ox, oy);
  const { x, y, r } = BADGE;
  // the sticker: a black drop under the badge, the badge, a white ring inside its black edge
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x, y + 8, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = kind.color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(x, y, r - 9, 0, Math.PI * 2);
  ctx.stroke();
  // the icon, 24 units across 92 px
  ctx.save();
  ctx.translate(x - 46, y - 46);
  ctx.scale(92 / 24, 92 / 24);
  drawIcon(ctx, kind.icon);
  ctx.restore();
  // rhinestone sparkles round the badge
  sparkle(ctx, x + r + 16, y - r + 18, 15, '#ffffff');
  sparkle(ctx, x - r - 14, y - 12, 11, PALETTE.rhinestonePink);
  sparkle(ctx, x + r + 8, y + 34, 9, PALETTE.rhinestonePurple);
  // the label: a white pill with a black edge, like the HUD's chips
  ctx.font = '900 ' + PILL.font + 'px ' + FONT_STACK;
  let size = PILL.font;
  while (size > 24 && ctx.measureText(kind.label).width > CW - 70) {
    size -= 2;
    ctx.font = '900 ' + size + 'px ' + FONT_STACK;
  }
  const tw = ctx.measureText(kind.label).width;
  const pw = Math.min(CW - 12, tw + 48);
  roundRect(ctx, (CW - pw) / 2, PILL.y, pw, PILL.h, PILL.h / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(kind.label, CW / 2, PILL.y + PILL.h / 2 + 2);
  ctx.restore();
}

function makeAtlas(kinds) {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CW;
  canvas.height = ROWS * CH;
  const ctx = canvas.getContext('2d');
  kinds.forEach((k, i) => drawCell(ctx, k, i % COLS, Math.floor(i / COLS)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

// A sprite quad (as three.js builds its own) whose uvs point at one atlas cell.
function cellGeometry(i) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const u0 = col / COLS;
  const u1 = (col + 1) / COLS;
  const v1 = 1 - row / ROWS;
  const v0 = 1 - (row + 1) / ROWS;
  const buf = new THREE.InterleavedBuffer(new Float32Array([
    -0.5, -0.5, 0, u0, v0,
    0.5, -0.5, 0, u1, v0,
    0.5, 0.5, 0, u1, v1,
    -0.5, 0.5, 0, u0, v1,
  ]), 5);
  const g = new THREE.BufferGeometry();
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0, false));
  g.setAttribute('uv', new THREE.InterleavedBufferAttribute(buf, 2, 3, false));
  return g;
}

export function createBeacons({ scene, places, groundAt } = {}) {
  const spots = beaconSpots(places, groundAt);
  const kinds = BEACON_KINDS.filter((k) => spots.some((s) => s.id === k.id));
  const group = new THREE.Group();
  group.name = 'beacons';
  scene.add(group);
  const bob = 0.045 * motion(); // reduced motion: barely a bob
  let tex = null;
  try {
    tex = makeAtlas(kinds);
  } catch (err) {
    console.warn('[c9] the beacons could not be drawn', err);
  }
  const list = spots.map((s, i) => {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
    const sprite = new THREE.Sprite(mat);
    sprite.geometry = cellGeometry(kinds.findIndex((k) => k.id === s.id));
    sprite.center.set(0.5, 0); // the label's bottom edge is the anchor: it never sinks into the ground
    sprite.position.set(s.x, s.y, s.z);
    sprite.renderOrder = 8;
    sprite.visible = false;
    sprite.name = 'beacon-' + s.id;
    group.add(sprite);
    return Object.assign({}, s, { sprite, mat, phase: i * 1.7, pop: 1, delay: 0 });
  });
  let shown = 0; // 0..1, all of them together (games, Hit Zero, the booth, the toss: 0)
  let visibleCount = 0;
  let clock = 0;

  function update(dt, t, camera, playerPos, show) {
    const step = Math.min(0.1, Math.max(0, dt || 0));
    clock += step;
    shown += ((show ? 1 : 0) - shown) * Math.min(1, step * (show ? 3 : 9));
    if (shown < 0.004) shown = 0;
    // pixels per radian on this screen, from the camera's vertical field of view
    const h = typeof window !== 'undefined' ? window.innerHeight || 800 : 800;
    const ppr = h / 2 / Math.tan(((camera ? camera.fov : 60) * Math.PI) / 360);
    visibleCount = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.pop < 1) {
        if (clock >= b.delay) b.pop = Math.min(1, b.pop + step * 2.6);
      }
      const near = playerPos ? beaconFade(Math.hypot(playerPos.x - b.x, playerPos.z - b.z), b.near, b.far) : 1;
      const a = shown * near * Math.min(1, b.pop * 1.6);
      if (a < 0.01 || !camera) {
        b.sprite.visible = false;
        continue;
      }
      const cp = camera.position;
      const d = Math.hypot(cp.x - b.x, cp.y - b.y, cp.z - b.z);
      // a little overshoot as it pops in
      const p = b.pop;
      const popScale = p >= 1 ? 1 : 1 + 1.7 * Math.pow(p - 1, 3) + 0.7 * Math.pow(p - 1, 2);
      const H = beaconHeight(d, ppr) * Math.max(0.05, popScale);
      b.sprite.scale.set(H * 2, H, 1);
      b.sprite.position.y = b.y + Math.sin(t * 1.7 + b.phase) * H * bob;
      b.mat.opacity = a;
      b.sprite.visible = true;
      visibleCount++;
    }
  }

  return {
    group,
    list,
    update,
    get visibleCount() { return visibleCount; },
    // her first arrival: each badge pops up in turn, a beat apart
    intro() {
      list.forEach((b, i) => {
        b.pop = 0;
        b.delay = clock + 1.0 + i * 0.16;
      });
    },
    dispose() {
      for (const b of list) {
        b.sprite.geometry.dispose();
        b.mat.dispose();
      }
      if (tex) tex.dispose();
      scene.remove(group);
    },
  };
}
