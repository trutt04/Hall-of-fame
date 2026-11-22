// The photo booth by the plaza (phase 2). Walk up to it, pick a frame and a pose, tap "Snap!": the
// camera swings round to the booth's lens, counts 3-2-1, and takes a 4:5 picture (1080x1350) with
// the frame, a small "Cloud Nine" title, sparkles and today's date. Never a name on it, so a photo
// is safe to show anyone. It stays on this device unless she saves or shares it herself.
// Friends standing near the booth in a room get an 'fx' and strike a pose of their own (each device
// only ever poses its own cheerleader).
//
//   import { installPhotoBooth } from './world/photobooth.js'
//   const booth = installPhotoBooth(world)   once the world exists (main.js); null when there is no booth
//   booth.open()        the booth's prompt does this: her mark, the lens camera and the picker card
//                       (or first, the picture still waiting for her, with Save / Again! / Done)
//   booth.close(why?)   back to free roam at once (a game or Hit Zero starting, the menu, Done).
//                       why 'game' | 'routine': once it is over, a toast says her photo is waiting
//   booth.active        true from the picker until Done (main.js keeps the menu and the wheel shut)
//   booth.phase         'idle' | 'entering' | 'picking' | 'countdown' | 'developing' | 'result'
//   booth.lastPhoto     { blob, width, height } of the last picture, or null (tests)
//   booth.waiting       true while her last picture is unsaved: kept (one blob) until it is saved,
//                       replaced by a new one, or the page goes away
//   booth.stats         { canvases, freed } photo canvases made and given back (tests)
//
// Pure parts (node tests, no three.js, no DOM):
//   PHOTO_W, PHOTO_H, FRAMES, POSES, framesFor(birthday), poseById(id), frameLayout(frameId, w, h)
//   toBooth(booth, x, z) / fromBooth(booth, u, v)       booth-local: u across its front, v out of it
//   shotSubjects(me, others, booth, opts)               who is in the picture (friends and bots within ~6 m)
//   shotFraming(subjects, booth, opts) -> { cam, look, fov, dist, crane }   the lens: everyone in, never in the booth
//   projectPoint(cam, look, fov, aspect, p)            -> screen x, y (-1..1) and depth z
//   aimLook(cam, target, sx, sy, W, H, fov)             a look point that puts target at screen (sx, sy)
//   viewfinderRect(W, H, aspect, margins) / screenFovFor(photoFov, rectH, H)
//   cleanBoothFx(data, now) -> { x, z, cx, cz, at, shot } | null   untrusted 'fx' from the network
//   friendPose(seed), dateLabel(date), photoFileName(date), BOOTH_LINES, boothLine(kind, rng)

import { reducedMotion, coarsePointer, loadCss } from '../ui/dom.js';
import { createBoothUi, buildPicker, buildPolaroid, paintBack, paintScene, paintFront, savePhoto, shareableFile } from '../ui/photo-card.js';

// ------------------------------------------------------------------------------------------ data

export const PHOTO_W = 1080;
export const PHOTO_H = 1350;
export const PHOTO_FOV = 44; // the lens's vertical field of view, in degrees
export const SHOT_RADIUS = 6; // friends and bots this close to her are in the picture
export const MARK_DEPTH = 5.8; // where she stands: this far out from the booth's centre, facing its lens
const CAM_MIN_DEPTH = 1.85; // the camera never goes closer to the booth's centre than this (its front is at 1.3)

// Her colours (hot pink, black, rhinestone sparkle) and the island's pastels. `swatch` is the
// picker's little preview; the canvas art is in ui/photo-card.js.
export const FRAMES = Object.freeze([
  Object.freeze({ id: 'cloudNine', label: 'Cloud Nine', accent: '#ff2e93', swatch: 'linear-gradient(135deg,#ff2e93,#ff8cc6 55%,#ff7ad1)' }),
  Object.freeze({ id: 'flyer', label: 'Flyer', accent: '#17121c', tag: 'FLYER', swatch: 'radial-gradient(circle at 30% 30%,#ff2e93 0 9%,transparent 10%),radial-gradient(circle at 72% 64%,#eae8f2 0 7%,transparent 8%),#17121c' }),
  Object.freeze({ id: 'squad', label: 'Squad', accent: '#a96bff', tag: 'SQUAD', swatch: 'repeating-linear-gradient(135deg,#cdb4ff 0 12px,#9fd8ff 12px 24px,#9be7c4 24px 36px,#ffd6ea 36px 48px)' }),
  Object.freeze({ id: 'birthday', label: 'Birthday', accent: '#ffd36e', tag: 'HAPPY BIRTHDAY!', birthday: true, swatch: 'radial-gradient(circle at 25% 70%,#ff2e93 0 8%,transparent 9%),radial-gradient(circle at 70% 30%,#a96bff 0 8%,transparent 9%),linear-gradient(135deg,#ffd36e,#ff8cc6)' }),
]);

export function framesFor(birthday) {
  return FRAMES.filter((f) => !f.birthday || birthday);
}

// Poses from the character's own animations (Contract 3). `jump` poses are timed so the shutter
// catches the top of the jump; `friend` poses are held ones a friend can strike over the network.
export const POSES = Object.freeze([
  Object.freeze({ id: 'highV', label: 'High V', anim: 'highV', friend: true }),
  Object.freeze({ id: 'toeTouch', label: 'Toe touch', anim: 'toeTouch', jump: true, ready: 'clasp' }),
  Object.freeze({ id: 'liberty', label: 'Liberty', anim: 'liberty', friend: true }),
  Object.freeze({ id: 'heelStretch', label: 'Heel stretch', anim: 'heelStretch', friend: true }),
  Object.freeze({ id: 'clasp', label: 'Clasp', anim: 'clasp', friend: true }),
  Object.freeze({ id: 'cheer', label: 'Cheer!', anim: 'cheer', friend: true }),
]);

export function poseById(id) {
  return POSES.find((p) => p.id === id) || POSES[0];
}

// A pose for a friend's own cheerleader, the same on every try with the same seed.
export function friendPose(seed) {
  const list = POSES.filter((p) => p.friend);
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// Hype lines, never about looks, bodies, weight or food (the copy rules in the tests check them).
export const BOOTH_LINES = Object.freeze({
  countdown: Object.freeze(['Say cheese... I mean CHEER!', 'Big spirit on three!', 'Hold that pose!', 'Everybody say CLOUD NINE!', 'Flyers, get ready!', 'Show the camera that spirit!']),
  result: Object.freeze(['Picture perfect!', 'That one is a keeper!', 'Stuck the pose!', 'Frame it, flyer!', 'Hall of fame shot!', 'Pure spirit stick energy!', 'Total superstar shot!']),
  squad: Object.freeze(['Squad goals!', 'The whole squad in one shot!', 'Best squad on Cloud Nine!', 'Team spirit, captured!']),
  birthday: Object.freeze(['Birthday flyer in the frame!', 'A birthday photo to keep!', 'Birthday spirit, captured!']),
  friend: Object.freeze(['Photo time! Strike a pose!', 'Say cheese... I mean CHEER!', 'Squad photo! Strike a pose!']),
  saved: Object.freeze(['Saved! It lives on this device.', 'Saved to this device!']),
});

export function boothLine(kind, rng = Math.random) {
  const list = BOOTH_LINES[kind] || BOOTH_LINES.result;
  const r = typeof rng === 'function' ? rng() : Math.random();
  return list[Math.min(list.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * list.length)))];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateLabel(date = new Date()) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}
export function photoFileName(date = new Date()) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const two = (n) => String(n).padStart(2, '0');
  return 'cloud-nine-photo-' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()) + '.png';
}

// ------------------------------------------------------------------------------------- the frame

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Where everything goes on the picture: a polaroid, the scene in a window at the top, the title and
// the date on the wide band under it, the frame's word on a sticker over the window's top corner,
// and sparkles on the border (they only ever overlap the window's edge, never the middle).
export function frameLayout(frameId = 'cloudNine', w = PHOTO_W, h = PHOTO_H) {
  const frame = FRAMES.find((f) => f.id === frameId) || FRAMES[0];
  const m = Math.round(w * 0.05);
  const band = Math.round(h * 0.17);
  const win = { x: m, y: m, w: w - 2 * m, h: h - m - band, r: Math.round(w * 0.026) };
  const bandTop = win.y + win.h;
  const title = { x: w / 2, y: bandTop + band * 0.47, size: Math.round(w * 0.07) };
  const date = { x: w / 2, y: bandTop + band * 0.8, size: Math.round(w * 0.034) };
  const tag = frame.tag ? { x: win.x + w * 0.2, y: win.y + h * 0.035, size: Math.round(w * (frame.tag.length > 8 ? 0.042 : 0.05)), angle: -0.08 } : null;
  const kind = frame.id === 'flyer' ? 'star' : frame.id === 'squad' ? 'heart' : frame.id === 'birthday' ? 'confetti' : 'gem';
  const rnd = rngFrom(hashStr(frame.id));
  const sparkles = [];
  // a big starburst on each window corner
  for (const [cx, cy] of [[win.x, win.y], [win.x + win.w, win.y], [win.x, win.y + win.h], [win.x + win.w, win.y + win.h]]) {
    sparkles.push({ x: cx, y: cy, r: Math.round(w * 0.034), kind: 'gem', tone: sparkles.length % 3 });
  }
  // the border's own pattern: along the left, right and top edges and the band's sides
  const n = 22;
  for (let i = 0; i < n; i++) {
    const side = i % 4;
    const u = rnd();
    let x;
    let y;
    if (side === 0) {
      x = m * (0.25 + rnd() * 0.5);
      y = m + u * (h - m * 2);
    } else if (side === 1) {
      x = w - m * (0.25 + rnd() * 0.5);
      y = m + u * (h - m * 2);
    } else if (side === 2) {
      x = m + u * (w - 2 * m);
      y = m * (0.25 + rnd() * 0.5);
    } else {
      // the band, away from the words in its middle
      x = rnd() < 0.5 ? m + u * w * 0.16 : w - m - u * w * 0.16;
      y = bandTop + band * (0.2 + rnd() * 0.65);
    }
    sparkles.push({ x: Math.round(x), y: Math.round(y), r: Math.round(w * (0.011 + rnd() * 0.012)), kind, tone: Math.floor(rnd() * 3) });
  }
  return { w, h, frame: frame.id, margin: m, band, win, title, date, tag, sparkles };
}

// ------------------------------------------------------------------------------------ the lens

// Booth-local axes: v out of its front (the lens looks along +v), u across it.
export function toBooth(b, x, z) {
  const f = Number.isFinite(b.facing) ? b.facing : 0;
  const dx = x - b.x;
  const dz = z - b.z;
  return { u: dx * Math.cos(f) - dz * Math.sin(f), v: dx * Math.sin(f) + dz * Math.cos(f) };
}
export function fromBooth(b, u, v) {
  const f = Number.isFinite(b.facing) ? b.facing : 0;
  return { x: b.x + Math.cos(f) * u + Math.sin(f) * v, z: b.z - Math.sin(f) * u + Math.cos(f) * v };
}

// Everybody else who is in the picture: within `radius` of her, on her level (not up on a cloud),
// and out in front of the booth (not beside it or behind it, where the lens can't see).
export function shotSubjects(me, others, booth, o = {}) {
  const radius = o.radius ?? SHOT_RADIUS;
  const minDepth = o.minDepth ?? 2.4;
  const rise = o.rise ?? 2.5;
  const max = o.max ?? 9;
  const out = [];
  if (!me || ![me.x, me.y, me.z].every(Number.isFinite)) return out;
  for (const p of others || []) {
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) continue;
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d > radius || Math.abs(p.y - me.y) > rise) continue;
    if (toBooth(booth, p.x, p.z).v < minDepth) continue;
    out.push({ id: p.id, bot: !!p.bot, x: p.x, y: p.y, z: p.z, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, max);
}

// Where the lens goes to fit everyone: straight out from the booth's front, centred across the
// group, as far back as the group needs (but never inside the booth: then a wider lens instead).
// aspect is the picture window's width / height; fov the vertical field of view in degrees.
export function shotFraming(subjects, booth, o = {}) {
  const aspect = o.aspect ?? 0.9;
  const pad = o.pad ?? 0.75; // half an arm span beside the outermost cheerleader
  const tall = o.tall ?? 2.3; // feet to bow, plus a toe touch's hop
  const lift = o.lift ?? -0.15; // the picture's bottom edge, from the lowest feet
  const minDepth = o.camMinDepth ?? CAM_MIN_DEPTH;
  const minDist = o.minDist ?? 2.4;
  const pts = [];
  for (const s of subjects || []) {
    if (!s || ![s.x, s.y, s.z].every(Number.isFinite)) continue;
    const { u, v } = toBooth(booth, s.x, s.z);
    pts.push({ u, v, y: s.y });
  }
  if (!pts.length) pts.push({ u: 0, v: MARK_DEPTH, y: 0 });
  let uMin = Infinity;
  let uMax = -Infinity;
  let vNear = Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of pts) {
    uMin = Math.min(uMin, p.u);
    uMax = Math.max(uMax, p.u);
    vNear = Math.min(vNear, p.v);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  const uc = (uMin + uMax) / 2;
  const bottom = yMin + lift;
  const top = yMax + tall;
  const height = top - bottom;
  const midY = (bottom + top) / 2;
  const backFor = (fov) => {
    const tv = Math.tan((fov * Math.PI) / 360);
    const th = tv * aspect;
    let vc = vNear - Math.max(minDist, (height * 1.06) / (2 * tv));
    for (const p of pts) vc = Math.min(vc, p.v - (Math.abs(p.u - uc) + pad) / th);
    return vc;
  };
  const straight = (vc, fov) => {
    const c = fromBooth(booth, uc, vc);
    const l = fromBooth(booth, uc, vc + 10);
    return { cam: { x: c.x, y: midY, z: c.z }, look: { x: l.x, y: midY, z: l.z }, fov, dist: vNear - vc, uc, vc, crane: false };
  };
  // 1. straight out of the lens, a little wider if the group needs it
  let fov = o.fov ?? PHOTO_FOV;
  let vc = backFor(fov);
  while (vc < minDepth && fov < 70) {
    fov += 2;
    vc = backFor(fov);
  }
  if (vc >= minDepth) return straight(vc, fov);
  // 2. a squad too wide for the space in front of the booth: the lens rises up over the booth's
  //    roof and looks down on everyone (the sightline to the nearest feet clears the roof)
  const keys = [];
  for (const p of pts) {
    for (const [du, dy] of [[0, -0.15], [0, tall], [-pad, 1.2], [pad, 1.2]]) {
      const w = fromBooth(booth, p.u + du, p.v);
      keys.push({ x: w.x, y: p.y + dy, z: w.z });
    }
  }
  let vFar = -Infinity;
  for (const p of pts) vFar = Math.max(vFar, p.v);
  const roofV = 1.35;
  const roofY = bottom + 4;
  if (vNear > roofV + 0.4) {
    const cfov = 56;
    for (let back = 0; back <= 40; back += 0.5) {
      const cv = minDepth - back;
      const h = Math.max(midY + 1, bottom + ((roofY - bottom) * (vNear - cv)) / (vNear - roofV));
      const c = fromBooth(booth, uc, cv);
      const l = fromBooth(booth, uc, (vNear + vFar) / 2);
      const cam = { x: c.x, y: h, z: c.z };
      const look = { x: l.x, y: midY, z: l.z };
      if (fitsAll(cam, look, cfov, aspect, keys, 0.94)) return { cam, look, fov: cfov, dist: vNear - cv, uc, vc: cv, crane: true };
    }
  }
  // 3. as wide as the lens goes (the very edges may be cropped)
  return straight(minDepth, Math.max(fov, 70));
}

// A world point through a camera at `cam` looking at `look` (three.js conventions: x right, y up,
// both -1..1 on screen; z is the distance in front of the lens).
export function projectPoint(cam, look, fov, aspect, p, out = { x: 0, y: 0, z: 0 }) {
  let fx = look.x - cam.x;
  let fy = look.y - cam.y;
  let fz = look.z - cam.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const z = dx * fx + dy * fy + dz * fz;
  const tv = Math.tan((fov * Math.PI) / 360);
  out.z = z;
  out.x = (dx * rx + dz * rz) / (Math.max(1e-6, z) * tv * aspect);
  out.y = (dx * ux + dy * uy + dz * uz) / (Math.max(1e-6, z) * tv);
  return out;
}
function fitsAll(cam, look, fov, aspect, pts, lim) {
  const q = { x: 0, y: 0, z: 0 };
  for (const p of pts) {
    projectPoint(cam, look, fov, aspect, p, q);
    if (q.z < 0.5 || Math.abs(q.x) > lim || Math.abs(q.y) > lim) return false;
  }
  return true;
}

// A look point for a camera at `cam` that puts `target` at screen point (sx, sy) of a W x H view.
export function aimLook(cam, target, sx, sy, W, H, fov, out = { x: 0, y: 0, z: 0 }) {
  const K = H / 2 / Math.tan((fov * Math.PI) / 360);
  const dx = target.x - cam.x;
  const dy = target.y - cam.y;
  const dz = target.z - cam.z;
  const yaw = Math.atan2(dx, dz) + Math.atan((sx - W / 2) / K);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + Math.atan((sy - H / 2) / K);
  out.x = cam.x + Math.sin(yaw) * Math.cos(pitch);
  out.y = cam.y + Math.sin(pitch);
  out.z = cam.z + Math.cos(yaw) * Math.cos(pitch);
  return out;
}

// The viewfinder on screen during the countdown: the biggest box of the picture's shape, centred.
export function viewfinderRect(W, H, aspect, { top = 80, bottom = 80, side = 16 } = {}) {
  const aw = Math.max(40, W - 2 * side);
  const ah = Math.max(40, H - top - bottom);
  let w = aw;
  let h = w / aspect;
  if (h > ah) {
    h = ah;
    w = h * aspect;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
// The screen's field of view that shows, inside that box, exactly what the picture will show.
export function screenFovFor(photoFov, rectH, H) {
  const t = Math.tan((photoFov * Math.PI) / 360) * (H / Math.max(1, rectH));
  return Math.min(120, (Math.atan(t) * 360) / Math.PI);
}

// ------------------------------------------------------------------------- the network ('fx')

// { kind: 'booth', x, z, cx, cz, at, shot }: a photo at the booth, her mark (x, z), the lens (cx, cz),
// the shutter time `at` on the shared clock. Anything else, or out of range, is null.
export function cleanBoothFx(data, now) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.kind !== 'booth') return null;
  const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null);
  const x = num(data.x, 1000);
  const z = num(data.z, 1000);
  const cx = num(data.cx, 1000);
  const cz = num(data.cz, 1000);
  const at = num(data.at, 1e15);
  if (x === null || z === null || cx === null || cz === null || at === null) return null;
  if (Math.hypot(cx - x, cz - z) > 40) return null; // the lens is never far from the mark
  if (Number.isFinite(now) && (at < now - 2000 || at > now + 9000)) return null;
  const shot = typeof data.shot === 'string' && /^[a-z0-9]{1,12}$/i.test(data.shot) ? data.shot : '';
  return { x, z, cx, cz, at, shot };
}

// ------------------------------------------------------------------------------- the booth itself

const FRIEND_RADIUS = 6.5; // a friend this close to her mark poses too (a little slack for lag)
const SWING = 0.8; // the camera's swing round to the lens, before the 3
const BEAT = 0.9; // seconds per number
const JUMP_AT = 0.5; // a toe touch is at its top this long after it starts

export function installPhotoBooth(world) {
  const booth = world && world.places && world.places.photoBooth;
  if (!booth || !Number.isFinite(booth.x) || !Number.isFinite(booth.z)) return null;
  const { player, hud, rig, net, interact, engine, renderer, scene, camera } = world;
  if (!player || !hud || !rig || !interact || !engine || !renderer) return null;
  const THREE = world.THREE;
  const calm = reducedMotion();
  const sfx = (name, o) => {
    try {
      if (world.audio) world.audio.sfx(name, o);
    } catch (err) { /* a sound never stops the booth */ }
  };
  const gy = (x, z) => {
    const y = world.groundAt(x, z);
    return Number.isFinite(y) ? y : 0;
  };

  let phase = 'idle';
  let run = 0; // bumps on every open and close, so a late async step knows it is stale
  let release = null;
  const choice = { frame: FRAMES[0].id, pose: POSES[0].id };
  let ui = null;
  let cardEl = null;
  let cardMine = false;
  let quietCard = false;
  let photo = null; // { blob, url, width, height }
  let polaroid = null; // the result card's picture, while it shows
  let lastPhoto = null;
  let waiting = null; // { blob, width, height }: her last picture while it is unsaved (never uploaded)
  let closedFor = null; // why the booth last closed: 'game' | 'routine' nudge her about `waiting` after
  let nudge = false;
  let nudgeT = 0;
  let saving = false;
  const stats = { canvases: 0, freed: 0 };

  // ---------------------------------------------------------------- the prompt
  const front = fromBooth(booth, 0, 3.4);
  const proxy = THREE ? new THREE.Mesh(new THREE.BoxGeometry(2.8, 4, 2.8), new THREE.MeshBasicMaterial()) : null;
  if (proxy) {
    // never drawn: tapping the booth itself walks her over and opens it
    const y0 = gy(booth.x, booth.z);
    proxy.position.set(booth.x, y0 + 2, booth.z);
    proxy.rotation.y = Number.isFinite(booth.facing) ? booth.facing : 0;
    proxy.updateMatrixWorld(true);
  }
  const entry = interact.register({
    id: 'photoBooth', position: { x: front.x, y: gy(front.x, front.z), z: front.z }, radius: 3.6, label: 'Photo booth!',
    icon: '\u{1F4F8}', priority: 1, object3D: proxy, onUse: () => open(),
  });

  // ---------------------------------------------------------------- helpers
  const isBirthday = () => !!(world.birthday && world.birthday.isBirthday);
  const inRoom = () => !!(world.session && world.session.kind === 'room');
  const free = () => world.mode === 'play' && !player.controller && !player.rescuing && !(world.toss && world.toss.active)
    && !world.activeGame && !world.hitZero;

  function ensureUi() {
    if (!ui) ui = createBoothUi(document.body);
    return ui;
  }

  // her mark, a step aside if a friend already stands on it
  function markSpot() {
    const others = othersNow();
    for (const u of [0, 1.4, -1.4, 2.6, -2.6]) {
      const p = fromBooth(booth, u, MARK_DEPTH);
      if (!Number.isFinite(world.groundAt(p.x, p.z))) continue;
      if (world.colliders && world.colliders.hits(p.x, p.z, 0.5)) continue;
      if (others.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 0.9)) continue;
      return p;
    }
    return fromBooth(booth, 0, MARK_DEPTH);
  }

  // everyone else on the island as this device sees them (friends and bots)
  function othersNow() {
    const out = [];
    const peers = world.peers;
    if (!peers || typeof peers.list !== 'function') return out;
    for (const p of peers.list()) {
      const pos = peers.positionOf(p.id);
      if (pos) out.push({ id: p.id, bot: !!p.bot, x: pos.x, y: pos.y, z: pos.z });
    }
    return out;
  }

  // ---------------------------------------------------------------- the camera
  const camArr = [0, 0, 0];
  const lookArr = [0, 0, 0];
  const holdShot = { dur: 1e7, ease: 'linear', cut: true, fov: 50, pos: () => camArr, look: () => lookArr };
  const swingShot = { dur: 0.8, ease: 'inOut', fov: 50, pos: () => camArr, look: () => lookArr };
  let framing = null;
  let subjects = [];
  const aim = { x: 0, y: 0, z: 0 };

  function setCam(c, l) {
    camArr[0] = c.x;
    camArr[1] = c.y;
    camArr[2] = c.z;
    lookArr[0] = l.x;
    lookArr[1] = l.y;
    lookArr[2] = l.z;
  }

  // While she picks: the lens looks at her, and she stands where the card isn't (above it on a
  // phone, beside it on a wide screen).
  function framePicking() {
    const W = Math.max(1, engine.width);
    const H = Math.max(1, engine.height);
    const portrait = H > W * 1.05;
    const fov = portrait ? 64 : 50;
    const p = player.position;
    const { u, v } = toBooth(booth, p.x, p.z);
    const c = fromBooth(booth, u, Math.max(CAM_MIN_DEPTH, v - (portrait ? 3.35 : 3.1)));
    const cam = { x: c.x, y: p.y + 1.35, z: c.z };
    const target = { x: p.x, y: p.y + 0.85, z: p.z };
    const sx = portrait ? W / 2 : W * (W > 900 ? 0.3 : 0.26);
    const sy = portrait ? H * 0.25 : H * 0.52;
    aimLook(cam, target, sx, sy, W, H, fov, aim);
    setCam(cam, aim);
    holdShot.fov = fov;
    swingShot.fov = fov;
  }

  // For the picture: everyone in, centred, and the screen's lens wide enough that the viewfinder
  // box shows exactly what the picture will.
  let vf = null;
  function frameShot() {
    const W = Math.max(1, engine.width);
    const H = Math.max(1, engine.height);
    const L = frameLayout(choice.frame, PHOTO_W, PHOTO_H);
    const aspect = L.win.w / L.win.h;
    // a jump on her own: the picture follows her up; anyone standing: from the feet up
    const pose = poseById(choice.pose);
    const solo = subjects.length === 1;
    framing = shotFraming(subjects, booth, { aspect, fov: PHOTO_FOV, tall: pose.jump ? 2.35 : 2.05, lift: pose.jump && solo ? 0.5 : -0.12 });
    setCam(framing.cam, framing.look);
    vf = viewfinderRect(W, H, aspect, H > W ? { top: 96, bottom: 96, side: 14 } : { top: 70, bottom: 70, side: 16 });
    const fov = screenFovFor(framing.fov, vf.h, H);
    holdShot.fov = fov;
    swingShot.fov = fov;
    if (ui) ui.viewfinder(vf, frameById(choice.frame).accent);
  }

  function playCamera(swing) {
    swingShot.dur = calm || !swing ? 0.01 : SWING;
    rig.play([swingShot, holdShot], { skippable: false, handoff: calm ? 0.01 : 0.7 });
  }

  const onResize = () => {
    if (phase === 'picking' || phase === 'entering') framePicking();
    else if (phase === 'countdown') frameShot();
  };
  if (typeof engine.on === 'function') engine.on('resize', onResize);

  // ---------------------------------------------------------------- open, pick, close
  async function open() {
    if (phase !== 'idle' || !free() || hud.isModalOpen()) return;
    phase = 'entering';
    const my = ++run;
    entry.enabled = false;
    hud.closeWheel();
    hud.hideHint();
    await loadCss('css/photo.css');
    if (my !== run) return;
    ensureUi();
    hud.setBusy(true);
    await hud.fade(true, 170);
    if (my !== run) return;
    const m = markSpot();
    const p0 = player.position;
    const lens = fromBooth(booth, toBooth(booth, m.x, m.z).u, CAM_MIN_DEPTH);
    player.place(m.x, m.z, Math.atan2(lens.x - m.x, lens.z - m.z));
    release = player.takeControl('photoBooth');
    player.setAnim('wave');
    framePicking();
    playCamera(false);
    sfx('whoosh', { volume: 0.4 });
    if (Math.hypot(p0.x - m.x, p0.z - m.z) > 0.3) world.spawnBurst(m.x, gy(m.x, m.z) + 0.3, m.z, { count: calm ? 8 : 16, speed: 2.5, size: 0.35 });
    hud.fade(false, 260);
    nudge = false;
    // her last picture, unsaved, comes first: Save, Again! or Done, the same as right after the shot
    if (waiting) {
      photo = { blob: waiting.blob, url: null, width: waiting.width, height: waiting.height };
      showResult('Your photo waited for you!');
    } else showPicker();
  }

  function showPicker(line) {
    phase = 'picking';
    const frames = framesFor(isBirthday());
    if (!frames.some((f) => f.id === choice.frame)) choice.frame = frames[0].id;
    const content = buildPicker({
      frames,
      poses: POSES,
      frame: choice.frame,
      pose: choice.pose,
      onFrame: (id) => {
        if (phase !== 'picking') return;
        choice.frame = id;
        sfx('tap', { volume: 0.5 });
      },
      onPose: (id) => {
        if (phase !== 'picking') return;
        choice.pose = id;
        const pose = poseById(id);
        // she tries it on right away (a jump plays once and lands)
        player.setAnim(pose.anim, { restart: true });
        sfx('pop', { volume: 0.5, pitch: 1.1 });
      },
    });
    openMyCard({
      kicker: 'Photo booth',
      title: line || 'Strike a pose!',
      contentEl: content,
      actions: [{ label: 'Snap!', icon: 'star', primary: true, keepOpen: true, onClick: snap }],
    }, 'c9-booth-pick');
  }

  function openMyCard(o, cls) {
    const card = hud.openCard(Object.assign({}, o, { onClose: onCardClose }));
    cardEl = card;
    cardMine = true;
    if (card && card.classList) card.classList.add('c9-booth-card', cls);
    return card;
  }
  function closeMyCard() {
    if (!cardMine) return;
    quietCard = true;
    try {
      hud.closeCard();
    } finally {
      quietCard = false;
    }
  }
  function onCardClose() {
    cardMine = false;
    if (cardEl && cardEl.classList) cardEl.classList.remove('c9-booth-card', 'c9-booth-pick', 'c9-booth-result');
    cardEl = null;
    if (quietCard) return;
    // the X, Escape, or another card taking the screen: the booth is done
    close();
  }

  function close(why) {
    if (phase === 'idle') return;
    run++;
    const was = phase;
    phase = 'idle';
    // a game or the routine took her away: her unsaved picture waits, and she hears so after
    closedFor = why === 'game' || why === 'routine' ? why : null;
    nudge = !!(waiting && closedFor);
    nudgeT = 0;
    clearShot();
    if (ui) ui.hide();
    closeMyCard();
    if (release) {
      player.setAnim('idle');
      const r = release;
      release = null;
      r();
    }
    // the normal camera, from behind her, eased back
    if (rig.isCinematic) {
      rig.yaw = player.heading + Math.PI;
      rig.skip();
    }
    hud.setBusy(false);
    if (was === 'entering') hud.fade(false, 200);
    freePhoto();
    saving = false;
    entry.enabled = true;
  }

  // ---------------------------------------------------------------- the shot
  const shot = { t: 0, snapAt: 0, shown: -1, jumped: false, captured: false, dev: 0, poseAnim: 'idle', bots: [] };

  function snap() {
    if (phase !== 'picking') return;
    phase = 'countdown';
    closeMyCard();
    const pose = poseById(choice.pose);
    const me = { x: player.position.x, y: player.position.y, z: player.position.z };
    subjects = [me, ...shotSubjects(me, othersNow(), booth)];
    shot.t = 0;
    shot.snapAt = (calm ? 0.25 : SWING) + BEAT * 3;
    shot.shown = -1;
    shot.jumped = false;
    shot.captured = false;
    shot.dev = 0;
    frameShot();
    playCamera(true);
    // she gets ready: a held pose right away, a jump from the ready position on the beat
    player.setAnim(pose.jump ? pose.ready || 'clasp' : pose.anim, { restart: true });
    poseBots(pose);
    // friends near the booth strike their own pose at the same moment
    if (inRoom() && net && typeof net.send === 'function') {
      const id = Math.random().toString(36).slice(2, 10);
      const at = Math.round((typeof net.now === 'function' ? net.now() : Date.now()) + shot.snapAt * 1000);
      net.send('fx', { kind: 'booth', shot: id, x: round2(me.x), z: round2(me.z), cx: round2(framing.cam.x), cz: round2(framing.cam.z), at });
    }
  }
  const round2 = (v) => Math.round(v * 100) / 100;

  // bots in the picture pose too, on this device only, when this device runs them (solo, or the host)
  function poseBots(pose) {
    shot.bots.length = 0;
    const peers = world.peers;
    const host = !inRoom() || (net && net.isHost);
    if (!host || !peers || typeof peers.get !== 'function') return;
    for (const s of subjects) {
      if (!s.bot) continue;
      const e = peers.get(s.id);
      if (!e || !e.character || typeof e.character.setAnim !== 'function') continue;
      try {
        e.character.setAnim(friendPose(s.id + choice.pose + pose.id).anim, { restart: true });
        shot.bots.push(e);
      } catch (err) { /* a bot that can't pose stands */ }
    }
  }
  function unposeBots() {
    for (const e of shot.bots) {
      try {
        if (e.character) e.character.setAnim(e.anim || 'idle');
      } catch (err) { /* fine */ }
    }
    shot.bots.length = 0;
  }

  function clearShot() {
    unposeBots();
  }

  // once a frame, after everything else has moved and just before the engine draws
  function update(dt) {
    if (phase === 'countdown') {
      shot.t += dt;
      const t0 = calm ? 0.25 : SWING;
      const k = shot.t < t0 ? -1 : Math.floor((shot.t - t0) / BEAT);
      if (k !== shot.shown && k >= 0 && k < 3) {
        shot.shown = k;
        ui.count(3 - k, k === 0 ? boothLine('countdown') : null);
        sfx('count', { volume: 0.8, pitch: [1, 1.12, 1.26][k] });
      }
      const pose = poseById(choice.pose);
      if (pose.jump && !shot.jumped && shot.t >= shot.snapAt - JUMP_AT) {
        shot.jumped = true;
        player.setAnim(pose.anim, { restart: true });
      }
      let ready = shot.t >= shot.snapAt;
      if (pose.jump) {
        // the top of the jump, by her own clock (the frame rate can't make the shutter miss it)
        const av = player.avatar;
        const at = av && av.anim === pose.anim && Number.isFinite(av.animTime) ? av.animTime : null;
        ready = at !== null ? at >= JUMP_AT || shot.t >= shot.snapAt + 0.3 : ready;
      }
      if (ready && !shot.captured) {
        shot.captured = true;
        takePicture();
      }
    } else if (phase === 'developing') {
      shot.dev += dt;
      if (shot.dev > 0.45 && player.anim !== 'cheer' && !poseById(choice.pose).jump) player.setAnim('cheer');
      if (shot.dev > 0.9 && photo && photo.blob) showResult();
      else if (shot.dev > 8) {
        // the picture never came back from the encoder: say so kindly, try again
        backToPicking('The camera blinked! Try again?');
      }
    } else if (nudge && phase === 'idle') {
      // the game or the routine that took her away is over, and she is free a moment: tell her once
      if (!waiting) nudge = false;
      else if (!free()) nudgeT = 0;
      else if ((nudgeT += dt) > 1.5) {
        nudge = false;
        hud.toast('Your photo is waiting at the booth!', { icon: '\u{1F4F8}', ms: 4200 });
      }
    }
  }
  engine.addSystem({ update }, 95);

  function takePicture() {
    const my = run;
    let canvas = null;
    try {
      canvas = capture();
    } catch (err) {
      console.warn('[c9] the photo booth could not take the picture', err);
      canvas = null;
    }
    phase = 'developing';
    shot.dev = 0;
    ui.count(null);
    ui.flash(calm);
    ui.viewfinder(null);
    sfx('tap', { volume: 0.9, pitch: 0.55 });
    setTimeout(() => sfx('tap', { volume: 0.6, pitch: 1.5 }), 70);
    sfx('sparkle', { volume: 0.5, pitch: 1.2 });
    const p = player.position;
    world.spawnBurst(p.x, p.y + 1.5, p.z, { count: calm ? 12 : 30, speed: 4, size: 0.45 });
    unposeBots();
    if (!canvas) {
      backToPicking('The camera blinked! Try again?');
      return;
    }
    const w = canvas.width;
    const h = canvas.height;
    const done = (blob) => {
      canvas.width = 0; // give the pixels back right away
      canvas.height = 0;
      stats.freed++;
      if (blob) {
        // the newest picture takes the waiting one's place: one blob kept, never more
        waiting = { blob, width: w, height: h };
        lastPhoto = { blob, width: w, height: h };
      }
      if (my !== run) {
        if (blob && closedFor) nudge = true; // a game took her away while it developed: it waits too
        return;
      }
      if (!blob) {
        backToPicking('The camera blinked! Try again?');
        return;
      }
      photo = { blob, url: null, width: w, height: h };
    };
    try {
      canvas.toBlob(done, 'image/png');
    } catch (err) {
      done(null);
    }
  }

  // Draw the scene for the picture's window right after rendering it, in this same task (the
  // drawing buffer is still there: no preserveDrawingBuffer needed), then the frame on top.
  const sizeTmp = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
  function capture() {
    const gl = renderer.getContext && renderer.getContext();
    if (gl && gl.isContextLost && gl.isContextLost()) return null;
    const L = frameLayout(choice.frame, PHOTO_W, PHOTO_H);
    const frame = frameById(choice.frame);
    const canvas = document.createElement('canvas');
    stats.canvases++;
    canvas.width = L.w;
    canvas.height = L.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.width = canvas.height = 0;
      stats.freed++;
      return null;
    }
    paintBack(ctx, L, frame);
    // no names in the picture: every name tag and speech bubble steps out for this one render
    const hidden = [];
    scene.traverse((o) => {
      if (o.isSprite && o.visible && o.userData && o.userData.base) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const attrs = gl && gl.getContextAttributes ? gl.getContextAttributes() : null;
    const ss = attrs && attrs.antialias ? 1 : 1.5; // no multisampling here: render bigger, scale down smooth
    const rw = Math.round(L.win.w * ss);
    const rh = Math.round(L.win.h * ss);
    const pr = renderer.getPixelRatio();
    renderer.getSize(sizeTmp);
    const fov = camera.fov;
    const aspect = camera.aspect;
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(rw, rh, false);
      camera.fov = framing ? framing.fov : PHOTO_FOV;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      paintScene(ctx, L, renderer.domElement, rw, rh);
    } finally {
      renderer.setPixelRatio(pr);
      renderer.setSize(sizeTmp.x, sizeTmp.y, false);
      camera.fov = fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      for (const o of hidden) o.visible = true;
    }
    paintFront(ctx, L, frame, { date: dateLabel(new Date()) });
    return canvas;
  }

  function backToPicking(line) {
    if (phase === 'idle') return;
    if (ui) {
      ui.count(null);
      ui.viewfinder(null);
    }
    freePhoto();
    showPicker(line);
    framePicking();
    playCamera(true);
  }

  // ---------------------------------------------------------------- the result
  // title: given when the picture is one that waited for her (it shows at once, already developed)
  function showResult(title) {
    if (!photo || (phase !== 'developing' && phase !== 'entering')) return;
    phase = 'result';
    if (ui) ui.hide();
    try {
      photo.url = URL.createObjectURL(photo.blob);
    } catch (err) {
      photo.url = null;
    }
    const file = shareableFile(photo.blob, photoFileName(new Date()));
    const share = !!file && coarsePointer();
    const pol = buildPolaroid(photo.url, { calm: calm || !!title, alt: 'Your photo from the Cloud Nine photo booth' });
    polaroid = pol;
    openMyCard({
      kicker: 'Photo booth',
      title: title || boothLine(isBirthday() && Math.random() < 0.5 ? 'birthday' : subjects.length > 1 ? 'squad' : 'result'),
      contentEl: pol.el,
      actions: [
        { label: share ? 'Share' : 'Save', icon: 'star', primary: true, keepOpen: true, onClick: () => save(pol, share) },
        { label: 'Again!', icon: 'reload', keepOpen: true, onClick: again },
        { label: 'Done', icon: 'check', keepOpen: true, onClick: () => close() },
      ],
    }, 'c9-booth-result');
    player.setAnim('wave');
    sfx('chime', { volume: 0.7 });
  }

  async function save(pol, share) {
    if (phase !== 'result' || !photo || saving) return;
    saving = true;
    const my = run;
    const blob = photo.blob;
    let res = 'failed';
    try {
      res = await savePhoto(blob, photoFileName(new Date()), { share });
    } catch (err) {
      res = 'failed';
    }
    saving = false;
    // saved (or shared): it is hers now, nothing waits at the booth any more
    if ((res === 'downloaded' || res === 'shared') && waiting && waiting.blob === blob) waiting = null;
    if (my !== run || phase !== 'result') return;
    if (res === 'downloaded' || res === 'shared') {
      pol.note(res === 'shared' ? 'Shared! It only goes where you sent it.' : boothLine('saved'));
      sfx('sparkle', { volume: 0.6 });
    } else if (res === 'failed') pol.note('Hmm, that did not save. Try again?');
  }

  function again() {
    if (phase !== 'result') return;
    closeMyCard();
    freePhoto();
    showPicker();
    framePicking();
    playCamera(true);
    sfx('pop', { volume: 0.6 });
  }

  function freePhoto() {
    if (polaroid) polaroid.clear();
    polaroid = null;
    if (photo && photo.url) {
      try {
        URL.revokeObjectURL(photo.url);
      } catch (err) { /* already gone */ }
    }
    photo = null;
  }

  const frameById = (id) => FRAMES.find((f) => f.id === id) || FRAMES[0];

  // ---------------------------------------------------------------- friends: strike a pose
  let friendTimer = 0;
  let lastFriendPose = -1e9;
  const onEvent = (ev) => {
    if (!ev || ev.type !== 'fx' || !net) return;
    const me = net.me;
    if (!me || ev.from === me.id || typeof ev.from !== 'string') return; // mine: I'm the one taking it
    if (!inRoom() || !net.players || !net.players.has(ev.from)) return; // only from someone in my room
    const fx = cleanBoothFx(ev.data, typeof net.now === 'function' ? net.now() : Date.now());
    if (!fx || phase !== 'idle' || !free()) return;
    const p = player.position;
    if (Math.hypot(p.x - fx.x, p.z - fx.z) > FRIEND_RADIUS) return;
    const wall = performance.now();
    if (wall - lastFriendPose < 2500) return; // one pose at a time, however many arrive
    lastFriendPose = wall;
    const pose = friendPose(me.id + fx.shot);
    hud.toast(boothLine('friend'), { icon: '\u{1F4F8}', ms: 2400 });
    clearTimeout(friendTimer);
    const lead = Math.max(0, Math.min(6000, fx.at - net.now() - 1300));
    friendTimer = setTimeout(() => {
      friendTimer = 0;
      if (phase !== 'idle' || !free()) return;
      const q = player.position;
      if (Math.hypot(q.x - fx.x, q.z - fx.z) > FRIEND_RADIUS + 1.5) return;
      // turn to the lens, and hold the pose through the shutter
      player.heading = Math.atan2(fx.cx - q.x, fx.cz - q.z);
      player.emote(pose.anim, Math.max(1.6, Math.min(5, (fx.at - net.now()) / 1000 + 1.6)));
    }, lead);
  };
  if (net && typeof net.on === 'function') net.on('event', onEvent);

  return {
    open,
    close,
    get active() { return phase !== 'idle'; },
    get phase() { return phase; },
    get lastPhoto() { return lastPhoto; },
    get waiting() { return !!waiting; },
    get choice() { return { frame: choice.frame, pose: choice.pose }; },
    get subjects() { return subjects.map((s) => ({ id: s.id || 'me', bot: !!s.bot })); },
    stats,
    // tests and dev: pick without the card's buttons, and snap
    pick(frame, pose) {
      if (frame && FRAMES.some((f) => f.id === frame)) choice.frame = frame;
      if (pose && POSES.some((p) => p.id === pose)) choice.pose = pose;
    },
    snap,
    dispose() {
      close();
      waiting = null;
      nudge = false;
      clearTimeout(friendTimer);
      if (net && typeof net.off === 'function') net.off('event', onEvent);
      interact.unregister('photoBooth');
      if (proxy) {
        proxy.geometry.dispose();
        proxy.material.dispose();
      }
      if (ui) ui.dispose();
      ui = null;
    },
  };
}
