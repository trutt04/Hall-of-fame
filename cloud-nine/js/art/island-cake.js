// The birthday corner of the plaza. On her birthday: a giant three-tier cake with one candle per
// year, a "Happy Birthday <name>!" banner over the walk to the gym, bunting round the plaza and
// fireworks over the island. On every other day: a cupcake tower with a little cake on top (with
// the same candles when the age is known, a star when it is not).
//
//   const corner = createCakeCorner({ x, z, quality })
//   corner.set({ isBirthday, age, name })     rebuilds what changed
//   corner.update(dt, t, camera)
//   corner.group, corner.dispose()
//   cleanName(raw) / cleanAge(raw)            exported for tests

import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU } from './geo.js';
import { flatMat, glowMat, makeAddMaterial } from './materials.js';
import { rng, motion, isReducedMotion } from './util.js';
import { FONT_STACK, PALETTE } from '../config.js';
import { K, shade, star, heart, bow, burst } from './island-kit.js';

export function cleanName(raw) {
  const s = typeof raw === 'string' ? raw.replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12).trim() : '';
  return s || 'Bailey';
}
export function cleanAge(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

// Candles in rings on a tier top of radius r: up to 9 round the edge, the rest further in.
export function candleSpots(n, r) {
  const out = [];
  if (!n) return out;
  const outer = Math.min(n, n > 12 ? Math.ceil(n * 0.6) : n <= 9 ? n : 9);
  const inner = n - outer;
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * TAU + 0.2;
    out.push([Math.sin(a) * r * 0.74, Math.cos(a) * r * 0.74]);
  }
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * TAU + 0.5;
    const rr = inner === 1 ? 0 : r * 0.36;
    out.push([Math.sin(a) * rr, Math.cos(a) * rr]);
  }
  return out;
}

// ------------------------------------------------------------------------------------- drawing
function tier(g, y, r, h, col, frost, rnd) {
  g.lathe(0, y, 0, [[r, 0, shade(col, 0.94)], [r, h * 0.85, col], [r - 0.04, h]], col, { seg: 18, capTop: frost });
  // drips of frosting over the edge
  const n = Math.round(r * 9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const len = h * (0.22 + rnd() * 0.38);
    g.at(Math.sin(a) * (r + 0.015), y + h, Math.cos(a) * (r + 0.015), a);
    g.box(0, -len, 0, 0.16, len, 0.04, frost);
    g.sphere(0, -len, 0.0, 0.085, frost, { seg: 5, rings: 3 });
    g.restore();
  }
  // a band of pearls round the bottom
  const m = Math.round(r * 11);
  for (let i = 0; i < m; i++) {
    const a = (i / m) * TAU;
    g.sphere(Math.sin(a) * (r + 0.02), y + 0.06, Math.cos(a) * (r + 0.02), 0.075, i % 2 ? K.white : K.rSilver, { seg: 4, rings: 2 });
  }
}

function candles(g, glow, add, spots, baseY, scale = 1.35) {
  const flames = [];
  spots.forEach(([x, z], i) => {
    const h = 0.42 * scale;
    const r = 0.05 * scale;
    for (let k = 0; k < 4; k++) g.cyl(x, baseY + (h * k) / 4, z, r, h / 4, k % 2 ? K.white : [K.pink, K.rPurple, 0x9fd8ff, 0xffd36e][i % 4], { seg: 5 });
    g.cyl(x, baseY + h, z, 0.008, 0.06 * scale, 0x3a3040, { seg: 3 });
    glow.lathe(x, baseY + h + 0.04 * scale, z, [[0.0, 0], [0.055 * scale, 0.05 * scale, 0xffb340], [0.045 * scale, 0.12 * scale, 0xffe27a], [0, 0.22 * scale]], 0xffb340, { seg: 5 });
    flames.push([x, baseY + h + 0.14 * scale, z]);
    const sa = add.a;
    add.a = 0.42;
    add.ico(x, baseY + h + 0.13 * scale, z, 0.15 * scale, 0xffd27a, { detail: 0 });
    add.a = 0.12;
    add.ico(x, baseY + h + 0.14 * scale, z, 0.24 * scale, 0xffb0d8, { detail: 0 });
    add.a = sa;
  });
  return flames;
}

function bigCake(age, rnd) {
  const g = new Geo();
  const glow = new Geo();
  const add = new Geo({ alpha: true });
  const Y0 = 0.53; // the dais top
  tier(g, Y0, 1.85, 1.0, 0xffb6d9, 0xfff3f9, rnd);
  tier(g, Y0 + 1.0, 1.38, 0.86, 0xffffff, K.pinkSoft, rnd);
  tier(g, Y0 + 1.86, 0.95, 0.74, 0xd7c2ff, 0xffffff, rnd);
  // a big bow on the front of the bottom tier, rhinestones round the middle
  bow(g, 0, Y0 + 0.55, 1.9, 1.1, { color: K.pink, star: K.black, detail: 'hi' });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    star(g, Math.sin(a) * 1.4, Y0 + 1.42, Math.cos(a) * 1.4, 0.1, 0.045, i % 2 ? K.rPink : K.rPurple, { ry: a });
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.3;
    heart(g, Math.sin(a) * 0.965, Y0 + 2.25, Math.cos(a) * 0.965, 0.18, K.pink, { ry: a });
  }
  const topY = Y0 + 2.6;
  const flames = candles(g, glow, add, candleSpots(age || 0, 0.95), topY);
  if (!age) star(glow, 0, topY + 0.6, 0, 0.32, 0.14, 0xffe27a, { thick: 0.08 });
  return { g, glow, add, flames, top: topY + 0.8 };
}

function cupcakeTower(age, rnd) {
  const g = new Geo();
  const glow = new Geo();
  const add = new Geo({ alpha: true });
  // drawn from the dais top, a size up so it holds the plaza
  for (const geo of [g, glow, add]) geo.at(0, 0.53, 0).scale(1.3);
  const Y0 = 0;
  // a white stand: three plates on a pole
  g.cyl(0, Y0, 0, 0.5, 0.08, K.white, { seg: 10 });
  g.cyl(0, Y0, 0, 0.06, 2.0, K.rSilver, { seg: 6 });
  const plates = [[Y0 + 0.25, 1.55, 9], [Y0 + 0.95, 1.12, 7], [Y0 + 1.6, 0.72, 4]];
  const cups = [0xffb6d9, 0xc9b6ff, 0xa9ecd0, 0xffe08a, 0x9fd8ff];
  const swirls = [0xfff3f9, 0xffd6ea, 0xe7d6ff, 0xffffff];
  for (const [py, pr, n] of plates) {
    g.cyl(0, py, 0, pr, 0.06, K.white, { seg: 16, bottom: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      g.sphere(Math.sin(a) * pr, py + 0.03, Math.cos(a) * pr, 0.05, K.pinkPale, { seg: 4, rings: 2 });
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + py;
      const cx = Math.sin(a) * pr * 0.68;
      const cz = Math.cos(a) * pr * 0.68;
      const cup = cups[(i + n) % cups.length];
      g.lathe(cx, py + 0.06, cz, [[0.15, 0, shade(cup, 0.85)], [0.21, 0.22, cup], [0.22, 0.24]], cup, { seg: 6, capTop: false });
      const sw = swirls[(i * 3 + n) % swirls.length];
      g.lathe(cx, py + 0.3, cz, [[0.23, 0, sw], [0.2, 0.1, sw], [0.13, 0.2, shade(sw, 0.97)], [0.05, 0.3, sw], [0, 0.34]], sw, { seg: 6 });
      g.sphere(cx, py + 0.66, cz, 0.055, i % 2 ? K.pink : 0xff6b8a, { seg: 4, rings: 3 });
      for (let k = 0; k < 2; k++) {
        const b = rnd() * TAU;
        g.box(cx + Math.sin(b) * 0.14, py + 0.42 + rnd() * 0.1, cz + Math.cos(b) * 0.14, 0.05, 0.015, 0.015, cups[(k + i) % cups.length], { ry: b, bottom: true });
      }
    }
  }
  // the little cake on top
  const ty = Y0 + 2.0;
  g.lathe(0, ty, 0, [[0.55, 0, K.pinkSoft], [0.55, 0.36, K.pinkSoft], [0.52, 0.42]], K.pinkSoft, { seg: 14, capTop: K.white });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.sphere(Math.sin(a) * 0.55, ty + 0.4, Math.cos(a) * 0.55, 0.06, K.white, { seg: 4, rings: 2 });
  }
  const flames = candles(g, glow, add, candleSpots(age || 0, 0.55), ty + 0.42, 0.75);
  if (!age) {
    star(glow, 0, ty + 0.95, 0, 0.3, 0.13, 0xffe27a, { thick: 0.08 });
    burst(add, 0, ty + 0.95, 0, 0.7, 0xfff0b8, 0.45);
  }
  for (const geo of [g, glow, add]) geo.restore();
  return { g, glow, add, flames, top: 0.53 + (ty + 1) * 1.3 };
}

// ------------------------------------------------------------------------------------- banner
function bannerTexture(name) {
  const W = 1024;
  const H = 192;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#ff7ab8');
  grd.addColorStop(0.5, PALETTE.pink);
  grd.addColorStop(1, '#ff7ab8');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.fillStyle = PALETTE.black;
  g.fillRect(0, 0, W, 14);
  g.fillRect(0, H - 14, W, 14);
  // rhinestones along the edges
  for (let x = 24; x < W; x += 48) {
    g.fillStyle = x % 96 ? PALETTE.rhinestoneSilver : PALETTE.rhinestonePurple;
    g.beginPath();
    g.arc(x, 7, 4.5, 0, TAU);
    g.arc(x + 24, H - 7, 4.5, 0, TAU);
    g.fill();
  }
  const text = 'Happy Birthday ' + name + '!';
  let size = 104;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (; size > 40; size -= 4) {
    g.font = '800 ' + size + 'px ' + FONT_STACK;
    if (g.measureText(text).width < W - 120) break;
  }
  g.lineJoin = 'round';
  g.lineWidth = size * 0.16;
  g.strokeStyle = PALETTE.black;
  g.strokeText(text, W / 2, H / 2 + 4);
  g.fillStyle = '#ffffff';
  g.fillText(text, W / 2, H / 2 + 4);
  // stars at both ends
  for (const x of [52, W - 52]) {
    g.fillStyle = '#fff3a8';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 13 : 32;
      g.lineTo(x + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------------------------- corner
export function createCakeCorner({ x = 0, z = 0, quality = 'high', banner = null, bunting = [] } = {}) {
  const low = quality === 'low';
  const group = new THREE.Group();
  group.name = 'cakeCorner';
  const cakeGroup = new THREE.Group();
  cakeGroup.position.set(x, 0, z);
  group.add(cakeGroup);
  const party = new THREE.Group();
  party.name = 'birthdayParty';
  party.visible = false;
  group.add(party);
  // banner, bunting and balloon arches: rebuilt when the name changes (the fireworks stay put)
  const deco = new THREE.Group();
  deco.name = 'partyDeco';
  party.add(deco);
  let own = [];
  let partyOwn = [];
  let flames = [];
  let state = { isBirthday: null, age: undefined, name: '' };
  const flameMat = makeAddMaterial(0xffffff, 1);
  const partyAdd = makeAddMaterial(0xffffff, 1);

  function clearCake() {
    for (const o of own) o.dispose();
    own = [];
    while (cakeGroup.children.length) cakeGroup.remove(cakeGroup.children[0]);
  }
  function mesh(geo, mat, parent, list) {
    if (!geo.tris) return null;
    const b = geo.build();
    list.push(b);
    const m = new THREE.Mesh(b, mat);
    parent.add(m);
    return m;
  }

  // ---------------------------------------------------------------- the party (birthday only)
  let bannerMesh = null;
  let bannerTex = null;
  let bannerMat = null;
  function buildParty(name) {
    for (const o of partyOwn) o.dispose();
    partyOwn = [];
    while (deco.children.length) deco.remove(deco.children[0]);
    if (bannerTex) bannerTex.dispose();
    bannerTex = null;
    const g = new Geo();
    const add = new Geo({ alpha: true });
    if (banner) {
      // two candy-striped poles and a banner that reads from both sides
      const { x0, z0, x1, z1, y } = banner;
      for (const [px, pz] of [[x0, z0], [x1, z1]]) {
        for (let k = 0; k < 8; k++) g.cyl(px, (y + 1.2) * (k / 8), pz, 0.14, (y + 1.2) / 8, k % 2 ? K.white : K.pink, { seg: 6 });
        star(g, px, y + 1.75, pz, 0.5, 0.21, 0xffe066, { thick: 0.12, ry: Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2 });
      }
      bannerTex = banner ? bannerTexture(name) : null;
      const len = Math.hypot(x1 - x0, z1 - z0) - 0.4;
      const bh = len * (192 / 1024);
      const geo = new THREE.PlaneGeometry(len, bh, 8, 1);
      // a gentle droop
      const pa = geo.attributes.position;
      for (let i = 0; i < pa.count; i++) pa.setY(i, pa.getY(i) - Math.cos((pa.getX(i) / len) * Math.PI) * 0.35);
      partyOwn.push(geo);
      bannerMat = new THREE.MeshLambertMaterial({ map: bannerTex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.35 });
      partyOwn.push(bannerMat);
      bannerMesh = new THREE.Mesh(geo, bannerMat);
      bannerMesh.position.set((x0 + x1) / 2, y + 0.35, (z0 + z1) / 2);
      bannerMesh.rotation.y = Math.atan2(z0 - z1, x1 - x0);
      bannerMesh.name = 'birthdayBanner';
      deco.add(bannerMesh);
    }
    // bunting: little pennants strung between points round the plaza
    const cols = [K.pink, K.white, K.black, K.rPurple, 0xffe066, K.pinkSoft];
    for (const run of bunting) {
      const [ax, ay, az, bx, by, bz] = run;
      const n = Math.max(3, Math.round(Math.hypot(bx - ax, bz - az) / 0.7));
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 0.7) / n;
        const sag = (t) => -Math.sin(t * Math.PI) * 0.9;
        const P = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t + sag(t), az + (bz - az) * t];
        const A = P(t0);
        const B = P(t1);
        const C = P((t0 + t1) / 2);
        C[1] -= 0.45;
        g.tri2(A, B, C, cols[i % cols.length]);
      }
    }
    // balloon arches either side of the cake
    const r = rng(11);
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const a = Math.PI * t;
      for (const side of [-1, 1]) {
        const bx = x + side * 4.6;
        const bz = z + Math.cos(a) * 3.6;
        const by = Math.sin(a) * 3.6;
        g.sphere(bx, by + 0.3, bz, 0.34 + r() * 0.06, [K.pink, K.white, K.rPurple, K.pinkSoft, 0xffe066][(i + (side > 0 ? 2 : 0)) % 5], { seg: 6, rings: 4 });
      }
    }
    burst(add, x, 6.6, z, 0.8, 0xffffff, 0.5);
    mesh(g, flatMat, deco, partyOwn);
    const am = mesh(add, partyAdd, deco, partyOwn);
    if (am) am.renderOrder = 3;
  }

  // ---------------------------------------------------------------- fireworks
  const FW_N = low ? 120 : 260;
  const fw = (() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(FW_N * 3);
    const col = new Float32Array(FW_N * 3);
    const size = new Float32Array(FW_N);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const tex = sparkTexture();
    // Daytime fireworks: added light vanishes against a pastel sky, so the sparks are painted in
    // their own full colour (a white-hot core) and fade with their alpha instead.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uScale: { value: 1100 } },
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false, vertexColors: true,
      vertexShader: 'attribute float size; varying vec3 vC; uniform float uScale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; varying vec3 vC; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float k = max(max(vC.r, vC.g), vC.b); if (k < 0.004 || t.a < 0.02) discard; vec3 c = mix(vC / k, vec3(1.0), t.a * t.a * 0.45); gl_FragColor = vec4(c, min(1.0, t.a * 1.35) * k); }',
    });
    const pts = new THREE.Points(geo, mat);
    pts.name = 'fireworks';
    pts.frustumCulled = false;
    pts.renderOrder = 7;
    party.add(pts);
    const parts = [];
    for (let i = 0; i < FW_N; i++) parts.push({ life: 1, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, s: 1 });
    return { geo, mat, tex, pts, parts, pos, col, size, next: 1.2, cursor: 0 };
  })();
  // saturated pairs: pastel sparks disappear into the day sky
  const PALETTES = [[0xff2e93, 0xa96bff], [0x7b5cff, 0xff7ad1], [0xffb21e, 0xff2e93], [0x2ea8ff, 0xff2e93], [0xff7ad1, 0x7b5cff]];
  const fc = new THREE.Color();
  function launch() {
    const rnd = Math.random;
    const cx = x + (rnd() - 0.5) * 70;
    const cz = z - 40 - rnd() * 40;
    const cy = 34 + rnd() * 22;
    const pal = PALETTES[Math.floor(rnd() * PALETTES.length)];
    const n = isReducedMotion() ? 18 : low ? 34 : 52;
    const speed = 9 + rnd() * 5;
    for (let k = 0; k < n; k++) {
      const p = fw.parts[fw.cursor];
      fw.cursor = (fw.cursor + 1) % FW_N;
      // even directions on a sphere, flattened a touch
      const u = (k + 0.5) / n;
      const phi = Math.acos(1 - 2 * u);
      const th = k * 2.399963;
      p.vx = Math.sin(phi) * Math.cos(th) * speed;
      p.vy = Math.cos(phi) * speed * 0.85;
      p.vz = Math.sin(phi) * Math.sin(th) * speed;
      p.x = cx;
      p.y = cy;
      p.z = cz;
      p.life = 0;
      p.max = 1.6 + rnd() * 0.7;
      fc.setHex(pal[k % 2]);
      p.r = fc.r;
      p.g = fc.g;
      p.b = fc.b;
      p.s = 1.3 + rnd() * 1.1;
    }
    return { x: cx, y: cy, z: cz };
  }
  const onBurst = [];
  function updateFireworks(dt, camera) {
    const reduced = isReducedMotion();
    fw.next -= dt;
    if (fw.next <= 0) {
      const at = launch();
      fw.next = reduced ? 4.5 + Math.random() * 2 : 1.4 + Math.random() * 1.6;
      for (const fn of onBurst) fn(at);
    }
    for (let i = 0; i < FW_N; i++) {
      const p = fw.parts[i];
      if (p.life >= p.max) {
        fw.size[i] = 0;
        continue;
      }
      p.life += dt;
      const drag = Math.exp(-1.6 * dt);
      p.vx *= drag;
      p.vy = p.vy * drag - 3.2 * dt;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const u = p.life / p.max;
      const fade = u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9;
      const tw = reduced ? 1 : 0.75 + 0.25 * Math.sin(p.life * 30 + i);
      fw.pos[i * 3] = p.x;
      fw.pos[i * 3 + 1] = p.y;
      fw.pos[i * 3 + 2] = p.z;
      fw.col[i * 3] = p.r * fade * tw;
      fw.col[i * 3 + 1] = p.g * fade * tw;
      fw.col[i * 3 + 2] = p.b * fade * tw;
      fw.size[i] = p.s * (0.6 + 0.4 * fade);
    }
    fw.geo.attributes.position.needsUpdate = true;
    fw.geo.attributes.color.needsUpdate = true;
    fw.geo.attributes.size.needsUpdate = true;
    if (camera) {
      const h = 1 / Math.tan((camera.fov * Math.PI) / 360);
      fw.mat.uniforms.uScale.value = h * (window.innerHeight || 800) * Math.min(2, window.devicePixelRatio || 1) * 0.5;
    }
  }

  // ---------------------------------------------------------------- set
  function set(next = {}) {
    const isBirthday = !!next.isBirthday;
    const age = cleanAge(next.age);
    const name = cleanName(next.name);
    const changed = isBirthday !== state.isBirthday || age !== state.age;
    if (changed) {
      clearCake();
      const rnd = rng(1234);
      const built = isBirthday ? bigCake(age, rnd) : cupcakeTower(age, rnd);
      mesh(built.g, flatMat, cakeGroup, own);
      mesh(built.glow, glowMat, cakeGroup, own);
      const fm = mesh(built.add, flameMat, cakeGroup, own);
      if (fm) fm.renderOrder = 3;
      flames = built.flames;
    }
    if (isBirthday && (name !== state.name || !state.isBirthday)) buildParty(name);
    party.visible = isBirthday;
    state = { isBirthday, age, name };
  }

  return {
    group,
    set,
    get state() { return { ...state }; },
    get flames() { return flames; },
    onFirework(fn) { onBurst.push(fn); },
    update(dt, t, camera) {
      const m = motion();
      flameMat.opacity = 0.8 + 0.2 * Math.sin(t * 9.3) * Math.sin(t * 5.1) * m;
      if (party.visible) {
        updateFireworks(dt, camera);
        if (bannerMesh) bannerMesh.position.y = (banner ? banner.y + 0.35 : 0) + Math.sin(t * 1.3) * 0.06 * m;
        partyAdd.opacity = 0.7 + 0.3 * Math.sin(t * 2) * m;
      }
    },
    dispose() {
      clearCake();
      for (const o of partyOwn) o.dispose();
      partyOwn = [];
      if (bannerTex) bannerTex.dispose();
      fw.geo.dispose();
      fw.mat.dispose();
      fw.tex.dispose();
      flameMat.dispose();
      partyAdd.dispose();
      if (group.parent) group.parent.remove(group);
    },
  };
}

function sparkTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  g.fillRect(S / 2 - 1, 4, 2, S - 8);
  g.fillRect(4, S / 2 - 1, S - 8, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
