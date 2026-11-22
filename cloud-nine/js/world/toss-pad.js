// One basket toss pad: a glittery hot-pink mat with the flyer's star in the middle, three base spots
// and a back spot that glow, a chevron pointing at the target cloud, a little sign with the big
// pink cheer bow on top, and a few twinkles. Built in pad space (+Z is the throw direction).
// Draw calls: the mat and sign (one merged mesh), the spot glows, the sign's face, the twinkles.
//
//   const art = createPadArt({ x, y, z, heading, spots, title, sub, quality })
//       spots: [{ x, z, back }] in pad space
//   art.group, art.mat (the mesh to tap)
//   art.setSpot(i, lit)     lit: a real player stands there (gold) or not (soft pink, lilac for the back spot)
//   art.setSign(lines)      { big, small } redraws the sign's face
//   art.update(dt, t)
//   art.dispose()

import * as THREE from '../../lib/three.module.min.js';
import { Geo, shade } from '../art/geo.js';
import { flatMat, addMat } from '../art/materials.js';
import { makeSparkles, rng } from '../art/util.js';
import { PALETTE, FONT_STACK } from '../config.js';

const hex = (css) => parseInt(String(css).replace('#', ''), 16);
const C = {
  pink: hex(PALETTE.pink),
  pinkSoft: hex(PALETTE.pinkSoft),
  pinkPale: hex(PALETTE.pinkPale),
  black: hex(PALETTE.black),
  white: hex(PALETTE.white),
  rPink: hex(PALETTE.rhinestonePink),
  rPurple: hex(PALETTE.rhinestonePurple),
  rSilver: hex(PALETTE.rhinestoneSilver),
  lilac: hex(PALETTE.lilac),
  gold: hex(PALETTE.gold),
};
const R = 1.9;
const TOP = 0.1;
const SIGN = { x: -2.55, z: -1.1, ry: Math.PI - 0.7, w: 1.5, h: 0.95, y: 1.35 }; // faces back toward the approach

const up = (cx, cz) => [cx, -5, cz]; // triOut from below: the face looks up

function star5(g, x, y, z, ro, ri, color, rot = 0) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const r = i % 2 ? ri : ro;
    pts.push([x + Math.sin(a) * r, y, z + Math.cos(a) * r]);
  }
  for (let i = 0; i < 10; i++) g.triOut([x, y, z], pts[i], pts[(i + 1) % 10], color, up(x, z));
}

function ringFlat(g, x, y, z, r0, r1, seg, color) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const A = [x + Math.cos(a0) * r1, y, z + Math.sin(a0) * r1];
    const B = [x + Math.cos(a1) * r1, y, z + Math.sin(a1) * r1];
    const Cc = [x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0];
    const D = [x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0];
    g.triOut(A, B, Cc, color, up(x, z));
    g.triOut(A, Cc, D, color, up(x, z));
  }
}

// The signature bow: two lobes, a knot and two tails, with small black stars on the lobes.
export function addBow(g, x, y, z, s, color, ry = 0) {
  g.at(x, y, z, ry);
  for (const sx of [-1, 1]) {
    g.ico(sx * 0.2 * s, 0, 0, 0.2 * s, color, { sx: 1.25, sy: 0.95, sz: 0.5 });
    g.box(sx * 0.08 * s, -0.42 * s, 0, 0.1 * s, 0.4 * s, 0.04 * s, shade(color, 0.85), { rz: sx * 0.32 });
    for (const [dx, dy] of [[0.16, 0.07], [0.27, -0.05], [0.2, -0.11]]) {
      g.box(sx * dx * s, dy * s, 0.1 * s, 0.045 * s, 0.045 * s, 0.02 * s, C.black);
      g.box(sx * dx * s, dy * s, -0.1 * s, 0.045 * s, 0.045 * s, 0.02 * s, C.black);
    }
  }
  g.ico(0, 0, 0, 0.085 * s, shade(color, 0.8), { sz: 0.8 });
  g.restore();
}

function drawSign(canvas, { big = '', small = '' } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.pinkPale;
  ctx.fillRect(0, 0, w, h);
  // rhinestone dots in the corners
  const dots = [PALETTE.rhinestonePink, PALETTE.rhinestonePurple, PALETTE.rhinestoneSilver];
  for (let i = 0; i < 26; i++) {
    const x = (i * 97) % w;
    const y = 110 + ((i * 53) % (h - 120));
    if (x > 70 && x < w - 70) continue;
    ctx.fillStyle = dots[i % 3];
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = PALETTE.pink;
  ctx.fillRect(0, 0, w, 96);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `900 62px ${FONT_STACK}`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = PALETTE.black;
  ctx.strokeText('BASKET TOSS', w / 2, 52, w - 36);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('BASKET TOSS', w / 2, 52, w - 36);
  // a little cloud next to the height
  ctx.font = `900 92px ${FONT_STACK}`;
  const bw = Math.min(w - 170, ctx.measureText(big).width);
  const cx = w / 2 - bw / 2 - 52;
  const cy = 172;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = PALETTE.lavender;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx - 20, cy + 6, 20, 0, Math.PI * 2);
  ctx.arc(cx + 2, cy - 8, 26, 0, Math.PI * 2);
  ctx.arc(cx + 26, cy + 6, 19, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(big, w / 2 + 28, 176, w - 170);
  ctx.font = `800 40px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.pink;
  ctx.fillText(small, w / 2, 268, w - 40);
}

export function createPadArt({ x, y, z, heading = 0, spots = [], title = { big: '', small: '' }, quality = 'high' }) {
  const group = new THREE.Group();
  group.name = 'tossPad';
  group.position.set(x, y, z);
  group.rotation.y = heading;
  const own = [];
  const rnd = rng(Math.round(x * 31 + z * 17));

  // ------------------------------------------------------------ the mat and the sign's frame
  const g = new Geo();
  g.cyl(0, 0, 0, R + 0.14, TOP, C.black, { seg: 30, top: C.black });
  g.disc(0, TOP + 0.002, 0, R, C.pink, { seg: 30 });
  ringFlat(g, 0, TOP + 0.006, 0, 1.22, 1.32, 30, C.pinkSoft);
  for (const s of spots) {
    ringFlat(g, s.x, TOP + 0.008, s.z, 0.43, 0.5, 18, C.black);
    g.disc(s.x, TOP + 0.007, s.z, 0.43, shade(C.pink, 0.8), { seg: 18 });
  }
  star5(g, 0, TOP + 0.009, 0, 0.5, 0.22, C.black);
  star5(g, 0, TOP + 0.011, 0, 0.4, 0.17, C.white);
  // chevrons pointing at the cloud
  for (const cz of [1.33, 1.62]) {
    const pts = [[-0.3, cz - 0.08], [-0.21, cz - 0.15], [0, cz + 0.04], [0, cz + 0.17], [0.21, cz - 0.15], [0.3, cz - 0.08]];
    const P = pts.map((p) => [p[0], TOP + 0.01, p[1]]);
    g.triOut(P[0], P[1], P[2], C.white, up(0, cz));
    g.triOut(P[0], P[2], P[3], C.white, up(0, cz));
    g.triOut(P[3], P[2], P[4], C.white, up(0, cz));
    g.triOut(P[3], P[4], P[5], C.white, up(0, cz));
  }
  // glitter: rhinestone flecks scattered over the pink, clear of the spots and the star
  const flecks = quality === 'low' ? 26 : 46;
  const fcol = [C.rSilver, C.rPink, C.rPurple, C.white];
  for (let i = 0, tries = 0; i < flecks && tries < 400; tries++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.6 + rnd() * 1.18;
    const fx = Math.cos(a) * r;
    const fz = Math.sin(a) * r;
    if (spots.some((s) => Math.hypot(fx - s.x, fz - s.z) < 0.58)) continue;
    const s = 0.035 + rnd() * 0.035;
    const b = rnd() * Math.PI;
    const P = [0, 1, 2].map((k) => [fx + Math.cos(b + (k * Math.PI * 2) / 3) * s, TOP + 0.01, fz + Math.sin(b + (k * Math.PI * 2) / 3) * s]);
    g.triOut(P[0], P[1], P[2], fcol[i % fcol.length], up(fx, fz));
    i++;
  }
  // the sign: a striped post, a frame, and the bow
  g.at(SIGN.x, 0, SIGN.z, SIGN.ry);
  for (let k = 0; k < 6; k++) g.cyl(0, k * 0.3, 0, 0.055, 0.3, k % 2 ? C.pink : C.white, { seg: 8, top: false });
  g.box(0, SIGN.y - 0.06, 0, SIGN.w + 0.12, SIGN.h + 0.12, 0.08, C.black, { bottom: true });
  addBow(g, 0, SIGN.y + SIGN.h + 0.12, 0, 0.85, C.pink);
  g.restore();
  const mat = g.mesh(flatMat);
  mat.name = 'tossMat';
  own.push(mat.geometry);
  group.add(mat);

  // ------------------------------------------------------------ the sign's face
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  drawSign(canvas, title);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const faceMat = new THREE.MeshBasicMaterial({ map: tex });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.w, SIGN.h), faceMat);
  face.position.set(SIGN.x, SIGN.y - 0.06 + (SIGN.h + 0.12) / 2, SIGN.z);
  face.rotation.y = SIGN.ry;
  face.translateZ(0.045);
  face.name = 'tossSign';
  own.push(face.geometry, faceMat, tex);
  group.add(face);

  // ------------------------------------------------------------ spot glows (additive, recoloured live)
  const sg = new Geo({ alpha: true });
  const ranges = [];
  for (const s of spots) {
    const a = sg.p.length / 3;
    sg.a = 0.95;
    ringFlat(sg, s.x, TOP + 0.014, s.z, 0.3, 0.42, 20, 0xffffff);
    const mid = sg.p.length / 3;
    sg.a = 0.3;
    sg.disc(s.x, TOP + 0.013, s.z, 0.3, 0xffffff, { seg: 20 });
    ranges.push([a, mid, sg.p.length / 3]);
  }
  const glow = sg.mesh(addMat);
  glow.name = 'tossSpots';
  glow.renderOrder = 2;
  const gcol = glow.geometry.attributes.color;
  gcol.setUsage(THREE.DynamicDrawUsage);
  own.push(glow.geometry);
  group.add(glow);
  const lit = spots.map(() => false);
  const tint = new THREE.Color();

  // ------------------------------------------------------------ twinkles over the mat
  const pts = [];
  for (let i = 0; i < (quality === 'low' ? 5 : 9); i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.5 + rnd() * 1.4;
    pts.push([Math.cos(a) * r, 0.3 + rnd() * 0.8, Math.sin(a) * r, 0.06 + rnd() * 0.06]);
  }
  const twinkles = makeSparkles(pts, 0xfff0fa, 2.1);
  own.push(twinkles.mesh.geometry);
  group.add(twinkles.mesh);

  function paintSpots(t) {
    for (let i = 0; i < ranges.length; i++) {
      const on = lit[i];
      const base = on ? PALETTE.gold : spots[i].back ? PALETTE.lilac : PALETTE.rhinestonePink;
      const pulse = on ? 0.85 + 0.15 * Math.sin(t * 7 + i) : 0.55 + 0.25 * Math.sin(t * 2.4 + i * 1.7);
      tint.set(base).multiplyScalar(pulse);
      const [a, mid, b] = ranges[i];
      for (let v = a; v < b; v++) {
        const o = v * 4;
        gcol.array[o] = tint.r;
        gcol.array[o + 1] = tint.g;
        gcol.array[o + 2] = tint.b;
        gcol.array[o + 3] = v < mid ? 0.95 : on ? 0.5 : 0.28;
      }
    }
    gcol.needsUpdate = true;
  }
  paintSpots(0);

  return {
    group,
    mat,
    setSpot(i, on) {
      if (i >= 0 && i < lit.length) lit[i] = !!on;
    },
    setSign(lines) {
      drawSign(canvas, lines);
      tex.needsUpdate = true;
    },
    update(dt, t) {
      paintSpots(t);
      twinkles.update(t);
    },
    dispose() {
      for (const o of own) if (o && o.dispose) o.dispose();
      own.length = 0;
      if (group.parent) group.parent.remove(group);
    },
  };
}
