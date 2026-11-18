// League World art: the champion's front lawn kit. A trophy to brag with, a mast to hang a
// banner from, and a confetti burst. The reference is a town that takes one person's good
// season far too seriously: a municipal monument on a private lawn, a stadium flagpole next to
// it, and a party that goes off every time anyone walks past. Generic shapes only, no marks of
// any kind, and no text anywhere in the geometry (text is a canvas texture the world supplies).
//
// Each prop is ONE draw call: merged geometry, vertex colours, a shared material, no textures.
//
//   createChampionTrophy({ scale, color })  -> { group, height, radius, colliders, triangles, anchors: { plaque, cupTop }, plaqueSize }
//   createBannerMast({ height, scale })     -> { group, height, radius, colliders, triangles, anchors: { bannerTop, bannerSize } }
//   createConfetti({ count, color })        -> { group, height, radius, colliders, triangles, burst, update, busy }
//
// The trophy is drawn with `goldMat`, the same material as the Supreme Commissioner, so a
// winner's lawn and the monument are made of the same metal. The mast is grey anodized pole on
// the shared flat material: white would vanish against the sky it stands in.
import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU, shade, lin } from './geo.js';
import { flatMat, glowMat, goldMat } from './materials.js';
import { rng, motion, makeProp, addMesh, V3 } from './util.js';
import { C } from './parts.js';

// ---- the trophy ---------------------------------------------------------------------------------
// Origin at the centre of the plinth on the ground, plaque face toward +Z. About 2.2 m tall, so
// it is a monument on a lawn rather than an ornament on a shelf.
//
// The whole shape is tuned for the silhouette from across the street (about 25 m, where the cup
// is maybe 20 pixels wide on a phone): a wide bowl, two handles that break the outline well
// clear of it, one narrow stem, and a stepped block under it. Detail spent anywhere else is
// detail nobody ever sees, so there is almost none.
const T = {
  PL: [                                   // the stepped plinth: [base y, height, width]
    [0, 0.17, 1.16], [0.17, 0.19, 0.98], [0.36, 0.36, 0.80], [0.72, 0.12, 0.92],
  ],
  FILLET: 0.84,                           // top of the plinth, where the gold foot lands
  PLAQUE: [0.42, 0.24, 0.58],             // name plate panel: [base y, height, width]
  STEM: [                                 // foot, knop and stem, seg 8
    [0.33, 0.875], [0.38, 0.94], [0.25, 1.06], [0.115, 1.16], [0.175, 1.24], [0.105, 1.40],
  ],
  BOWL: [                                 // the cup, seg 12. Flares fast, then stands up. Last
    [0.105, 1.40], [0.34, 1.53], [0.47, 1.71],   // point is the rim: a cup, not a funnel.
    [0.545, 1.91], [0.575, 2.07], [0.605, 2.14], [0.575, 2.20],
  ],
  LIP: [0.46, 2.06],                      // inside of the rim: [radius, y] of the pool at the bottom
  HANDLE: [                               // one handle in the XY plane, mirrored across X
    [0.50, 2.07], [0.70, 2.10], [0.82, 1.99], [0.82, 1.80], [0.70, 1.68], [0.50, 1.65],
  ],
  MEDAL: [1.8, 0.125],                    // medallion on the front of the bowl: [y, radius]
};

export function createChampionTrophy({ scale = 1, color = 0xf2c93f } = {}) {
  const group = new THREE.Group(); group.name = 'championTrophy';
  const own = [], g = new Geo();
  g.scale(scale);
  // One hue, a very wide value range. Under flat shading that is what reads as polished metal
  // instead of flat yellow, and it is why the plinth is dark: gold against grass needs a foot.
  const G = color, H = shade(color, 1.42), L = shade(color, 0.74), D = shade(color, 0.5);
  const P = 0x3c352b, PL = 0x4e463a, PD = 0x2a251e;

  // the stepped plinth, dark stone with a gold fillet under the trophy
  const S = T.PL;
  g.box(0, S[0][0], 0, S[0][2], S[0][1], S[0][2], PD, { top: P });
  g.box(0, S[1][0], 0, S[1][2], S[1][1], S[1][2], P, { top: PL });
  g.box(0, S[2][0], 0, S[2][2], S[2][1], S[2][2], P, { front: PL, top: PL });
  g.box(0, S[3][0], 0, S[3][2], S[3][1], S[3][2], PL, { tx: 0.9, tz: 0.9, top: P });
  g.box(0, T.FILLET, 0, 0.84, 0.035, 0.84, H, { top: G });

  // the name plate: a raised panel the world hangs a canvas plaque on. No text here, ever.
  const Q = T.PLAQUE, qz = S[2][2] / 2;
  g.box(0, Q[0], qz, Q[2], Q[1], 0.03, L, { front: G, top: H, bottom: true });
  g.quad([-Q[2] / 2 + 0.04, Q[0] + 0.04, qz + 0.032], [Q[2] / 2 - 0.04, Q[0] + 0.04, qz + 0.032],
    [Q[2] / 2 - 0.04, Q[0] + Q[1] - 0.04, qz + 0.032], [-Q[2] / 2 + 0.04, Q[0] + Q[1] - 0.04, qz + 0.032], D);

  g.jit = 0.05;
  // foot, knop and stem. Gaudy bulges on the way up: they are what makes the stem read as cast
  // metal at a distance where a plain post would read as a stick.
  g.lathe(0, 0, 0, [
    [T.STEM[0][0], T.STEM[0][1], L], [T.STEM[1][0], T.STEM[1][1], H], [T.STEM[2][0], T.STEM[2][1], G],
    [T.STEM[3][0], T.STEM[3][1], G], [T.STEM[4][0], T.STEM[4][1], H], [T.STEM[5][0], T.STEM[5][1], G],
  ], G, { seg: 8, capTop: false });

  // the bowl. seg 12 so the rim stays round in profile, and the facet that falls dead ahead
  // gives the medallion something flat to sit on.
  const B = T.BOWL, TOP = B.length - 1;
  g.lathe(0, 0, 0, [
    [B[0][0], B[0][1], L], [B[1][0], B[1][1], G], [B[2][0], B[2][1], G],
    [B[3][0], B[3][1], H], [B[4][0], B[4][1], H], [B[5][0], B[5][1], H], [B[6][0], B[6][1], H],
  ], G, { seg: 12, capTop: false });
  // the inside of the rim, drawn mirrored so it faces inward, and a flat pool at the bottom of it
  g.save(); g.scale(-1, 1, 1);
  g.lathe(0, 0, 0, [[T.LIP[0], T.LIP[1]], [B[TOP][0] - 0.012, B[TOP][1] - 0.008]], D, { seg: 12, capTop: false });
  g.restore();
  g.fan(T.LIP[0], T.LIP[1], 12, Math.PI / 12, shade(D, 0.8));

  // two handles, well clear of the bowl. The outline they cut is most of what says "trophy"
  // from the far pavement, so they are chunky and they stick out.
  for (const sx of [-1, 1]) {
    g.tube(T.HANDLE.map((p) => [sx * p[0], p[1], 0]), 0.055, sx > 0 ? G : L, { seg: 4, ph: Math.PI / 4 });
  }
  g.jit = 0;

  // A star medallion on the front of the bowl: gaudy, generic, and it gives the prop a front.
  // Bright star on a sunk dark disc, because gold on gold is a smudge at any distance.
  // The bowl wall leans out as it rises, so the plate has to lean with it or its top edge
  // disappears into the metal. Both the lean and the stand off come off the profile itself,
  // and the plate is kept inside one facet so it never floats over the corners.
  const [my, mr] = T.MEDAL;
  const bi = B.findIndex((q, i) => i > 0 && q[1] >= my), b0 = B[bi - 1], b1 = B[bi];
  const lean = Math.atan2(b1[0] - b0[0], b1[1] - b0[1]);
  const wall = b0[0] + (b1[0] - b0[0]) * ((my - b0[1]) / (b1[1] - b0[1]));
  g.at(0, my, wall * Math.cos(Math.PI / 12) + 0.006, 0, lean);
  g.disc(0, 0, 0, mr, H, { seg: 8, rx: Math.PI / 2 });
  g.disc(0, 0, 0.01, mr * 0.84, D, { seg: 8, rx: Math.PI / 2 });
  for (let i = 0; i < 5; i++) {
    // a0 is backed off by half a step so a POINT lands straight up. A star with a point down
    // reads as a pair of horns, which is a different sport entirely.
    const a0 = Math.PI / 2 - TAU / 10 + (i * TAU) / 5, a1 = a0 + TAU / 5, am = a0 + TAU / 10;
    const p0 = [Math.cos(a0) * mr * 0.3, Math.sin(a0) * mr * 0.3, 0.016];
    const p1 = [Math.cos(a1) * mr * 0.3, Math.sin(a1) * mr * 0.3, 0.016];
    g.tri([0, 0, 0.016], p0, p1, H);                                                    // the core
    g.tri(p1, p0, [Math.cos(am) * mr * 0.8, Math.sin(am) * mr * 0.8, 0.022], H);
  }
  g.restore();

  g.shadeY(0, 1.0 * scale, 0.82);
  addMesh(group, g, goldMat, own, 'trophy');

  const k = scale, top = B[TOP][1], half = S[0][2] / 2;
  return makeProp(group, own, null, {
    height: top * k,
    // the handles reach further than the plinth corners do
    radius: Math.max(Math.hypot(half, half), T.HANDLE[2][0] + 0.06) * k,
    colliders: [{ x: 0, z: 0, r: (half + 0.08) * k }],
    anchors: {
      plaque: V3(0, (Q[0] + Q[1] / 2) * k, (qz + 0.045) * k),
      cupTop: V3(0, top * k, 0),
    },
    plaqueSize: { w: (Q[2] - 0.06) * k, h: (Q[1] - 0.06) * k },
    triangles: g.tris,
  });
}

// ---- the banner mast ----------------------------------------------------------------------------
// Mast and crossarm only: no cloth, no text. The world hangs its own textured plane from
// `anchors.bannerTop`, sized `anchors.bannerSize`, and that plane is the banner.
//
// The arm is centred on the mast and pushed forward to +Z, so the banner hangs in a plane in
// FRONT of the pole instead of through it. bannerTop is the middle of the banner's top edge, on
// the underside of the arm. The arm is deliberately a little wider than the banner.
//
// `height` is the real height of the mast in metres, finial included. Everything is drawn at
// 7.5 m proportions and scaled: a taller pole is a thicker pole and carries a bigger banner,
// which is how flagpoles actually work. `scale` multiplies on top of that.
const M = {
  REF: 7.5,                     // the height everything below is drawn for
  ARM_Y: 6.5, ARM_Z: 0.2, ARM_HALF: 0.88,
  BANNER: [1.6, 3.2],           // what fits under that arm: [w, h]
  BASE: 0.78,
  POLE: [[0.17, 0.26], [0.125, 0.52], [0.105, 2.4], [0.088, 5.0], [0.07, 7.28]],
  BALL: [7.385, 0.115],         // finial: [centre y, radius]
};

export function createBannerMast({ height = 7.5, scale = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'bannerMast';
  const own = [], g = new Geo();
  const H = Math.max(2.5, height), k = scale * (H / M.REF);
  g.scale(k);
  const pole = C.metal, poleLt = C.metalLt, poleDk = C.metalDk, arm = C.metalLt;
  const AY = M.ARM_Y, AZ = M.ARM_Z, AH = M.ARM_HALF;

  // a two step concrete footing. A flagpole with nothing at its foot looks like it was pushed in.
  g.box(0, 0, 0, M.BASE, 0.14, M.BASE, C.concreteDk, { top: C.concrete });
  g.box(0, 0.14, 0, 0.56, 0.12, 0.56, C.concrete, { top: shade(C.concrete, 1.08) });

  // the pole: a flared collar at the butt, then a long taper. Split into bands so the ground
  // shading at the bottom stays at the bottom instead of smearing up the whole mast.
  g.lathe(0, 0, 0, [
    [M.POLE[0][0], M.POLE[0][1], poleDk], [M.POLE[1][0], M.POLE[1][1], pole],
    [M.POLE[2][0], M.POLE[2][1], pole], [M.POLE[3][0], M.POLE[3][1], poleLt],
    [M.POLE[4][0], M.POLE[4][1], poleLt],
  ], pole, { seg: 8, capTop: false });
  // gold ball on top, the one piece of swagger on an otherwise municipal object
  g.ico(0, M.BALL[0], 0, M.BALL[1], C.gold, { detail: 0, ry: 0.4 });

  // the crossarm, its collar on the mast, and a stay back to the pole at each end
  g.box(0, AY - 0.08, 0.06, 0.2, 0.34, 0.3, pole, { bottom: true, top: poleLt });
  g.box(0, AY, AZ, AH * 2, 0.11, 0.13, arm, { bottom: true, top: poleLt, side: pole });
  for (const sx of [-1, 1]) {
    g.tube([[sx * (AH - 0.14), AY + 0.02, AZ], [sx * 0.07, AY - 0.42, 0.03]], 0.035, pole, { seg: 3 });
    // a plate at each end of the arm: the corner of the banner ties off here
    g.box(sx * (AH - 0.035), AY - 0.16, AZ, 0.07, 0.3, 0.17, poleDk, { bottom: true, top: poleLt });
  }
  // three eyelets along the underside of the arm, inside the banner's width
  for (const ex of [-M.BANNER[0] / 2 + 0.06, 0, M.BANNER[0] / 2 - 0.06]) {
    g.box(ex, AY - 0.075, AZ, 0.05, 0.08, 0.05, poleDk, { bottom: true });
  }
  // halyard down to a cleat, so the thing looks like it can be raised and lowered
  g.box(0.055, 1.05, 0.035, 0.07, 0.3, 0.1, poleDk, { bottom: true, top: poleLt });
  g.quad2([0.085, 1.3, 0.055], [0.105, 1.3, 0.055], [0.105, AY - 0.02, 0.03], [0.085, AY - 0.02, 0.03], C.white, C.stone);

  g.shadeY(0, 1.4 * k, 0.84);
  addMesh(group, g, flatMat, own, 'mast');

  return makeProp(group, own, null, {
    height: (M.BALL[0] + M.BALL[1]) * k,
    radius: (AH + 0.04) * k,
    colliders: [{ x: 0, z: 0, r: (M.BASE / 2 + 0.02) * k }],
    anchors: {
      // the middle of the banner's top edge, on the underside of the arm and clear of the pole
      bannerTop: V3(0, AY * k, AZ * k),
      bannerSize: { w: M.BANNER[0] * k, h: M.BANNER[1] * k },
    },
    triangles: g.tris,
  });
}

// ---- the confetti burst -------------------------------------------------------------------------
// One InstancedMesh of flat rectangles, so a whole burst is one draw call and the group is
// invisible (and free) between bursts. Each piece is drawn on both faces, bright on top and
// dim underneath, which is what makes a tumbling piece flicker the way real confetti does.
//
// Pieces are party sized, not life sized: 13 cm of paper reads from across the street, 2 cm of
// paper is one pixel of nothing.
const PIECE = [0.13, 0.085];
// Terminal velocity is the whole trick: paper that falls at 1.5 m/s reads as a celebration and
// paper that falls at 6 reads as something blowing off a bin lorry.
const GRAVITY = 8.0, TERMINAL = 1.5, DRAG = 2.3, FADE = 0.45, LAND = 0.015;
const MIXED = [0xffd23f, 0xff5964, 0x49d2f7, 0x6ced76, 0xff9d4d, 0xf87ad8, 0xf7f4ea, 0xb78bff];

// Bright enough to read as paper in the air. A dark team colour gets lifted rather than dropped,
// because navy confetti against grass reads as litter.
function brighten(hex) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const lum = (r * 0.3 + g * 0.6 + b * 0.1) / 255;
  return lum < 0.42 ? shade(hex, 1 + (0.42 - lum) * 1.5) : hex;
}

function confettiPiece(own) {
  const g = new Geo(), w = PIECE[0] / 2, d = PIECE[1] / 2;
  // flat in XZ so a landed piece lies on the ground. White: the per piece colour rides on the
  // instance colour and multiplies this. The underside is a little darker, enough to flicker as
  // a piece turns over.
  g.quad2([-w, 0, d], [w, 0, d], [w, 0, -d], [-w, 0, -d], 0xffffff, 0xcfcfcf);
  const geo = g.build();
  own.push(geo);
  return { geo, tris: g.tris };
}

export function createConfetti({ count = 160, color = null } = {}) {
  const group = new THREE.Group(); group.name = 'confetti';
  const own = [], N = Math.max(4, Math.min(400, Math.round(count || 0) || 160));
  const { geo, tris } = confettiPiece(own);

  // Unlit, on purpose. Under the world's one sun a tumbling lit quad spends half its life
  // facing the ground light, and a cloud of half dark paper reads as litter blowing about
  // rather than as a celebration. Unlit keeps every piece the colour it was cut from.
  const mesh = new THREE.InstancedMesh(geo, glowMat, N);
  mesh.name = 'pieces';
  mesh.frustumCulled = false;           // a burst can be thrown anywhere in local space
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(mesh); own.push(mesh);

  // one colour per piece, fixed for the life of the prop. If a champion colour is given it takes
  // a bit over half the pieces, in three values, so their colour dominates without being alone.
  const pick = rng(0x9e37 + N), tint = color === null ? 0 : brighten(color);
  const biased = color === null ? null : [tint, shade(tint, 1.3), shade(tint, 0.82)];
  mesh.setColorAt(0, new THREE.Color(0xffffff));
  const ca = mesh.instanceColor.array;
  for (let i = 0; i < N; i++) {
    const hex = biased && pick() < 0.56 ? biased[i % 3] : MIXED[(i * 3 + (i % 5)) % MIXED.length];
    const c = lin(hex);
    ca[i * 3] = c[0]; ca[i * 3 + 1] = c[1]; ca[i * 3 + 2] = c[2];
  }
  mesh.instanceColor.needsUpdate = true;

  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const spin = new Float32Array(N * 4);     // yaw, pitch, yaw rate, pitch rate
  const age = new Float32Array(N), life = new Float32Array(N), down = new Uint8Array(N);
  const im = mesh.instanceMatrix.array;
  let alive = 0, bursts = 0;

  const hide = (i) => { const o = i * 16; im[o] = 0; im[o + 5] = 0; im[o + 10] = 0; };
  for (let i = 0; i < N; i++) { hide(i); im[i * 16 + 15] = 1; }

  function place(i, s) {
    const o = i * 16, ca2 = Math.cos(spin[i * 4]), sa = Math.sin(spin[i * 4]);
    const cb = Math.cos(spin[i * 4 + 1]), sb = Math.sin(spin[i * 4 + 1]);
    // yaw about Y then pitch about X, written straight into the matrix: no allocation, no Object3D
    im[o] = ca2 * s; im[o + 1] = 0; im[o + 2] = -sa * s; im[o + 3] = 0;
    im[o + 4] = sa * sb * s; im[o + 5] = cb * s; im[o + 6] = ca2 * sb * s; im[o + 7] = 0;
    im[o + 8] = sa * cb * s; im[o + 9] = -sb * s; im[o + 10] = ca2 * cb * s; im[o + 11] = 0;
    im[o + 12] = pos[i * 3]; im[o + 13] = pos[i * 3 + 1]; im[o + 14] = pos[i * 3 + 2];
  }

  function step(dt) {
    if (alive <= 0) return;
    const d = Math.min(0.05, Math.max(0, dt || 0)), m = motion();
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) continue;
      age[i] += d;
      const left = life[i] - age[i];
      if (left <= 0) { life[i] = 0; hide(i); continue; }
      live++;
      if (age[i] < 0) { hide(i); continue; }      // staggered launch: not thrown yet
      const p = i * 3, s4 = i * 4;
      if (!down[i]) {
        vel[p + 1] -= GRAVITY * d;
        if (vel[p + 1] < -TERMINAL) vel[p + 1] = -TERMINAL;   // paper does not plummet
        const drag = 1 - DRAG * d;
        vel[p] *= drag; vel[p + 2] *= drag;
        // a sideways sway on the way down, which is most of what sells paper over gravel
        const sway = Math.sin(age[i] * 3.1 + spin[s4]) * 0.55 * m;
        pos[p] += (vel[p] + sway) * d;
        pos[p + 1] += vel[p + 1] * d;
        pos[p + 2] += (vel[p + 2] - sway * 0.6) * d;
        spin[s4] += spin[s4 + 2] * d * m;
        spin[s4 + 1] += spin[s4 + 3] * d * m;
        // landed (only on the way down, so a burst thrown from y = 0 still gets off the ground):
        // lie flat and clear off soon, because a celebration must never turn into litter
        if (pos[p + 1] <= LAND && vel[p + 1] <= 0) {
          down[i] = 1;
          pos[p + 1] = LAND; vel[p] = 0; vel[p + 1] = 0; vel[p + 2] = 0; spin[s4 + 1] = 0;
          if (left > FADE + 0.25) life[i] = age[i] + FADE + 0.25;
        }
      }
      place(i, Math.min(1, (life[i] - age[i]) / FADE));
    }
    alive = live;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = live > 0;
  }

  const prop = makeProp(group, own, (dt) => step(dt), {
    // the reach of one burst from the point it is thrown at, measured over many bursts, for
    // whoever has to bound it. A burst lasts about 4 seconds at the outside.
    height: 3.4, radius: 3.1,
    colliders: [],
    count: N,
    triangles: tris * N,
    burst(x = 0, y = 0, z = 0) {
      const r = rng(0x5f3b + ++bursts * 7919);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + r() * 0.7, out = 0.9 + r() * r() * 3.6, up = 4.8 + r() * 2.6;
        const p = i * 3, s4 = i * 4;
        pos[p] = x + Math.cos(a) * 0.09; pos[p + 1] = y; pos[p + 2] = z + Math.sin(a) * 0.09;
        vel[p] = Math.cos(a) * out; vel[p + 1] = up; vel[p + 2] = Math.sin(a) * out;
        spin[s4] = r() * TAU; spin[s4 + 1] = r() * TAU;
        spin[s4 + 2] = (r() - 0.5) * 9; spin[s4 + 3] = (r() - 0.5) * 12;
        age[i] = -r() * 0.12; life[i] = 2.6 + r() * 1.8; down[i] = 0;
      }
      alive = N;
      mesh.visible = true;
      step(0);
    },
  });
  Object.defineProperty(prop, 'busy', { get: () => alive > 0, enumerable: true });
  return prop;
}
