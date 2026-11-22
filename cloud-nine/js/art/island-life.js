// The moving bits that make the island feel alive: glitter waterfalls pouring off the rim into
// the clouds, butterflies over the flower beds, birds circling high, balloons bobbing on their
// strings at the plaza (and a few that slipped away, drifting up into the sky).
//
//   const life = createLife(plan, decor, { yAt, quality })
//   life.group, life.update(dt, t, camera), life.dispose()
//
// Each kind is one instanced mesh (or one Points draw), so the whole lot costs a handful of draws.

import * as THREE from '../../lib/three.module.min.js';
import { Geo, TAU } from './geo.js';
import { flatMat } from './materials.js';
import { rng, motion, isReducedMotion } from './util.js';
import { K, puff, zoneKey } from './island-kit.js';

export function createLife(plan, decor, { yAt, quality = 'high', batch } = {}) {
  const low = quality === 'low';
  const group = new THREE.Group();
  group.name = 'life';
  const own = [];
  const updates = [];

  // ---------------------------------------------------------------- waterfalls
  {
    const tex = waterTexture();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    own.push(tex);
    const pos = [];
    const uv = [];
    const r = rng(8);
    const glitter = [];
    for (const w of plan.waterfalls) {
      // the static bits (pond, its water, the mist below) go into the island's merged meshes
      const key = zoneKey(w.x, w.z);
      const ponds = batch.geo(key);
      const glass = batch.geo(key, 'glass');
      const mist = batch.geo(key, 'cloud');
      const [dx, dz] = w.dir;
      const nx = -dz;
      const nz = dx;
      const y0 = yAt(w.x, w.z);
      // the pond: a pastel stone ring with a spout toward the rim
      ponds.lathe(w.x, y0 - 0.1, w.z, [[w.pondR + 0.3, 0, 0xf0dcef], [w.pondR + 0.3, 0.42, 0xfff3fa], [w.pondR, 0.5, 0xfff3fa], [w.pondR - 0.25, 0.45]], 0xf0dcef, { seg: 14, capTop: false });
      ponds.fan(w.pondR - 0.25, y0 + 0.3, 14, 0, 0x8fd6f5);
      glass.a = 0.8;
      glass.at(w.x, y0 + 0.36, w.z);
      glass.fan(w.pondR - 0.2, 0, 14, 0, 0x9fe3ff);
      glass.restore();
      // the channel from the pond to the lip
      const lipX = w.lip[0] + dx * 0.2;
      const lipZ = w.lip[1] + dz * 0.2;
      const ly = yAt(w.lip[0] - dx * 0.6, w.lip[1] - dz * 0.6);
      // a sheet: along the channel, over the lip, then straight down into the clouds
      const H = 54;
      const prof = [];
      prof.push([w.x + dx * (w.pondR - 0.4), y0 + 0.38, w.z + dz * (w.pondR - 0.4), 1.15]);
      prof.push([lipX - dx * 0.5, ly + 0.12, lipZ - dz * 0.5, 1.3]);
      prof.push([lipX, ly - 0.2, lipZ, 1.4]);
      for (let k = 1; k <= 9; k++) {
        const t = k / 9;
        const out = 0.9 + Math.sqrt(t) * 2.6;
        prof.push([lipX + dx * out, ly - 0.4 - t * H, lipZ + dz * out, 1.5 + t * 2.4]);
      }
      let v = 0;
      for (let i = 0; i < prof.length - 1; i++) {
        const a = prof[i];
        const b = prof[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const v1 = v + len / 6;
        const A0 = [a[0] - nx * a[3], a[1], a[2] - nz * a[3]];
        const A1 = [a[0] + nx * a[3], a[1], a[2] + nz * a[3]];
        const B0 = [b[0] - nx * b[3], b[1], b[2] - nz * b[3]];
        const B1 = [b[0] + nx * b[3], b[1], b[2] + nz * b[3]];
        pos.push(...A0, ...A1, ...B1, ...A0, ...B1, ...B0);
        uv.push(0, v, 1, v, 1, v1, 0, v, 1, v1, 0, v1);
        v = v1;
      }
      // mist where it lands in the clouds
      puff(mist, lipX + dx * 4, -52, lipZ + dz * 4, 5.5, r, { lumps: 5, detail: low ? 0 : 1, color: 0xffffff, under: 0xf1e6ff });
      glitter.push({ x: lipX, y: ly, z: lipZ, dx, dz, nx, nz, H });
    }
    // the bow fountain's veil, spilling from its high bowl into the pool (same material, same draw)
    {
      const f = plan.fountain;
      const seg = 18;
      const yTop = 5.27;
      const yBot = 0.58;
      const r0 = 1.45;
      const r1 = 1.72;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * TAU;
        const a1 = ((i + 1) / seg) * TAU;
        const P = (rr, a, y) => [f.x + Math.sin(a) * rr, y, f.z + Math.cos(a) * rr];
        const A0 = P(r0, a0, yTop);
        const A1 = P(r0, a1, yTop);
        const B0 = P(r1, a0, yBot);
        const B1 = P(r1, a1, yBot);
        const u0 = (i / seg) * 4;
        const u1 = ((i + 1) / seg) * 4;
        pos.push(...A0, ...A1, ...B1, ...A0, ...B1, ...B0);
        uv.push(u0, 0, u1, 0, u1, 0.9, u0, 0, u1, 0.9, u0, 0.9);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    g.computeBoundingSphere();
    own.push(g);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xffffff, opacity: 0.92 });
    own.push(mat);
    const sheet = new THREE.Mesh(g, mat);
    sheet.name = 'waterfalls';
    sheet.renderOrder = 3;
    group.add(sheet);
    // falling glitter
    const N = (low ? 14 : 26) * glitter.length;
    const gp = new Float32Array(N * 3);
    const gs = new Float32Array(N);
    const gc = new Float32Array(N * 3);
    const seeds = [];
    const pal = [[1, 1, 1], [1, 0.82, 0.94], [0.9, 0.84, 1], [1, 0.95, 0.75]];
    for (let i = 0; i < N; i++) {
      seeds.push({ f: glitter[i % glitter.length], u: r(), side: r() * 2 - 1, sp: 0.5 + r() * 0.5 });
      const c = pal[i % pal.length];
      gc[i * 3] = c[0];
      gc[i * 3 + 1] = c[1];
      gc[i * 3 + 2] = c[2];
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('size', new THREE.BufferAttribute(gs, 1).setUsage(THREE.DynamicDrawUsage));
    gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
    own.push(gg);
    const st = sparkTexture();
    own.push(st);
    const gm = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: st }, uScale: { value: 400 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, vertexColors: true,
      vertexShader: 'attribute float size; varying vec3 vC; uniform float uScale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; varying vec3 vC; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, 1.0); }',
    });
    own.push(gm);
    const gpts = new THREE.Points(gg, gm);
    gpts.name = 'waterfallGlitter';
    gpts.frustumCulled = false;
    gpts.renderOrder = 6;
    group.add(gpts);
    updates.push((dt, t, camera) => {
      const m = motion();
      tex.offset.y = (tex.offset.y - dt * 0.9 * (0.3 + 0.7 * m)) % 1;
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        const u = (t * 0.09 * s.sp * (0.3 + 0.7 * m) + s.u) % 1;
        const f = s.f;
        const out = 1.0 + Math.sqrt(u) * 2.6 + 0.3;
        gp[i * 3] = f.x + f.dx * out + f.nx * s.side * (1.4 + u * 2.3);
        gp[i * 3 + 1] = f.y - 0.4 - u * f.H;
        gp[i * 3 + 2] = f.z + f.dz * out + f.nz * s.side * (1.4 + u * 2.3);
        const tw = isReducedMotion() ? 0.7 : 0.5 + 0.5 * Math.sin(t * 7 + i * 1.7);
        gs[i] = (0.25 + 0.35 * tw) * (1 - u * 0.4);
      }
      gg.attributes.position.needsUpdate = true;
      gg.attributes.size.needsUpdate = true;
      if (camera) gm.uniforms.uScale.value = (1 / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight || 800) * Math.min(2, window.devicePixelRatio || 1) * 0.5;
    });
  }

  // ---------------------------------------------------------------- butterflies
  {
    const homes = decor.props.filter((p) => p.type === 'flowers' || p.type === 'planter').map((p) => [p.x, p.z]);
    homes.push([0, 0], [plan.fountain.x, plan.fountain.z], [plan.isle.x, plan.isle.z]);
    const count = low ? 8 : 18;
    const wing = new THREE.BufferGeometry();
    // one wing: a rounded fan from the body out to +X, two lobes
    const wp = [0, 0, 0, 0.16, 0.02, -0.12, 0.2, 0.02, 0.04, 0, 0, 0, 0.2, 0.02, 0.04, 0.1, 0.01, 0.14];
    wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wp), 3));
    wing.computeVertexNormals();
    own.push(wing);
    const wmat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: 0x402040, emissiveIntensity: 0.4 });
    own.push(wmat);
    const mesh = new THREE.InstancedMesh(wing, wmat, count * 2);
    mesh.name = 'butterflies';
    mesh.frustumCulled = false;
    const r = rng(15);
    const cols = [0xff7ab8, 0xa96bff, 0xffd36e, 0x9fd8ff, 0xffffff, 0xff9ecf, 0x8fe3b8];
    const bf = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const h = homes[Math.floor(r() * homes.length)];
      bf.push({ x: h[0], z: h[1], ph: r() * TAU, sp: 0.5 + r() * 0.5, rad: 1.5 + r() * 2.5, flap: 9 + r() * 4 });
      c.setHex(cols[i % cols.length]);
      mesh.setColorAt(i * 2, c);
      mesh.setColorAt(i * 2 + 1, c);
    }
    mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p3 = new THREE.Vector3();
    const s3 = new THREE.Vector3();
    updates.push((dt, t) => {
      const m = motion();
      for (let i = 0; i < count; i++) {
        const b = bf[i];
        const a = t * 0.45 * b.sp + b.ph;
        const x = b.x + Math.sin(a) * b.rad + Math.sin(a * 2.3) * 0.6;
        const z = b.z + Math.cos(a * 0.8) * b.rad;
        const y = yAt(x, z);
        const yy = (y > -1e6 ? y : 0) + 1.1 + Math.sin(a * 3.1) * 0.35 + 0.4;
        const head = Math.atan2(Math.cos(a) * b.rad + Math.cos(a * 2.3) * 1.38, -Math.sin(a * 0.8) * b.rad * 0.8);
        const f = Math.sin(t * b.flap * (0.25 + 0.75 * m) + b.ph) * 1.1;
        for (let w = 0; w < 2; w++) {
          const side = w ? -1 : 1;
          e.set(0, head, side * f, 'YXZ');
          q.setFromEuler(e);
          p3.set(x, yy, z);
          s3.set(side * 1.6, 1.6, 1.6);
          m4.compose(p3, q, s3);
          mesh.setMatrixAt(i * 2 + w, m4);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- birds, high up
  {
    const count = low ? 4 : 7;
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.25, 0, 0, 0.2, 1.1, 0.05, -0.1]), 3));
    wing.computeVertexNormals();
    own.push(wing);
    const wmat = new THREE.MeshLambertMaterial({ color: 0xfff6fb, side: THREE.DoubleSide, emissive: 0xffe0f0, emissiveIntensity: 0.25 });
    own.push(wmat);
    const mesh = new THREE.InstancedMesh(wing, wmat, count * 2);
    mesh.name = 'birds';
    mesh.frustumCulled = false;
    group.add(mesh);
    const r = rng(21);
    const birds = [];
    for (let i = 0; i < count; i++) birds.push({ r: 30 + r() * 45, y: 26 + r() * 18, ph: r() * TAU, w: (0.12 + r() * 0.08) * (i % 3 ? 1 : -1), flap: 3 + r() * 2, cx: (r() - 0.5) * 40, cz: (r() - 0.5) * 40 });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p3 = new THREE.Vector3();
    const s3 = new THREE.Vector3();
    updates.push((dt, t) => {
      const m = motion();
      for (let i = 0; i < count; i++) {
        const b = birds[i];
        const a = b.ph + t * b.w;
        const x = b.cx + Math.sin(a) * b.r;
        const z = b.cz + Math.cos(a) * b.r;
        const head = a + (b.w > 0 ? Math.PI / 2 : -Math.PI / 2);
        const glide = Math.sin(t * 0.4 + b.ph) > 0.3;
        const f = glide ? 0.12 : Math.sin(t * b.flap * (0.3 + 0.7 * m) + b.ph) * 0.6;
        for (let w = 0; w < 2; w++) {
          const side = w ? -1 : 1;
          e.set(0, head, side * f + 0.05 * side, 'YXZ');
          q.setFromEuler(e);
          p3.set(x, b.y + Math.sin(t * 0.7 + b.ph) * 1.5, z);
          s3.set(side * 1.2, 1.2, 1.2);
          m4.compose(p3, q, s3);
          mesh.setMatrixAt(i * 2 + w, m4);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- balloons
  {
    const anchors = decor.props.filter((p) => p.type === 'balloons');
    const per = 5;
    const free = low ? 4 : 9;
    const count = anchors.length * per + free;
    const bg = new Geo();
    bg.sphere(0, 0, 0, 0.36, 0xffffff, { seg: 7, rings: 5, sy: 1.18 });
    bg.cone(0, -0.46, 0, 0.07, 0.1, 0xffffff, { seg: 5, rx: Math.PI });
    const bgeo = bg.build();
    own.push(bgeo);
    const bmat = new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true, emissive: 0x2a1530, emissiveIntensity: 0.25 });
    own.push(bmat);
    const balloons = new THREE.InstancedMesh(bgeo, bmat, count);
    balloons.name = 'balloons';
    balloons.frustumCulled = false;
    group.add(balloons);
    const sgeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 3, 1);
    sgeo.translate(0, 0.5, 0);
    own.push(sgeo);
    const smat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    own.push(smat);
    const strings = new THREE.InstancedMesh(sgeo, smat, anchors.length * per);
    strings.name = 'balloonStrings';
    strings.frustumCulled = false;
    group.add(strings);
    const cols = [K.pink, K.white, K.rPurple, K.pinkSoft, 0xffe066, 0x9fd8ff, K.black];
    const c = new THREE.Color();
    const r = rng(33);
    const items = [];
    anchors.forEach((a, ai) => {
      const y = yAt(a.x, a.z) + 1.15;
      for (let k = 0; k < per; k++) {
        const ang = (k / per) * TAU + ai;
        items.push({ ax: a.x, ay: y, az: a.z, ox: Math.cos(ang) * 0.55, oz: Math.sin(ang) * 0.55, len: 2.0 + (k % 3) * 0.45 + a.s * 0.3, ph: r() * TAU });
        c.setHex(cols[(k + ai * 2) % cols.length]);
        balloons.setColorAt(items.length - 1, c);
      }
    });
    const freeItems = [];
    for (let i = 0; i < free; i++) {
      freeItems.push({ x: (r() - 0.5) * 60, z: (r() - 0.5) * 60, u: r(), sp: 0.5 + r() * 0.5, ph: r() * TAU });
      c.setHex(cols[i % cols.length]);
      balloons.setColorAt(items.length + i, c);
    }
    balloons.instanceColor.needsUpdate = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p3 = new THREE.Vector3();
    const s3 = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const d3 = new THREE.Vector3();
    const e = new THREE.Euler();
    updates.push((dt, t) => {
      const m = motion();
      for (let i = 0; i < items.length; i++) {
        const b = items[i];
        const sway = 0.25 * m;
        const bx = b.ax + b.ox + Math.sin(t * 0.9 + b.ph) * sway;
        const bz = b.az + b.oz + Math.cos(t * 0.7 + b.ph) * sway;
        const by = b.ay + b.len + Math.sin(t * 1.3 + b.ph) * 0.12 * m;
        e.set(Math.sin(t * 0.8 + b.ph) * 0.12 * m, b.ph, Math.cos(t * 0.6 + b.ph) * 0.12 * m);
        q.setFromEuler(e);
        p3.set(bx, by, bz);
        s3.set(1, 1, 1);
        m4.compose(p3, q, s3);
        balloons.setMatrixAt(i, m4);
        // the string from the anchor to the knot
        d3.set(bx - b.ax, by - 0.46 - b.ay, bz - b.az);
        const len = d3.length();
        q.setFromUnitVectors(up, d3.normalize());
        p3.set(b.ax, b.ay, b.az);
        s3.set(1, len, 1);
        m4.compose(p3, q, s3);
        strings.setMatrixAt(i, m4);
      }
      for (let i = 0; i < freeItems.length; i++) {
        const f = freeItems[i];
        const u = (t * 0.012 * f.sp + f.u) % 1;
        p3.set(f.x + Math.sin(t * 0.3 + f.ph) * 3, 2 + u * 90, f.z + Math.cos(t * 0.25 + f.ph) * 3);
        e.set(Math.sin(t + f.ph) * 0.1 * m, f.ph, 0);
        q.setFromEuler(e);
        const s = u > 0.9 ? (1 - u) * 10 : u < 0.03 ? u / 0.03 : 1;
        s3.set(s, s, s);
        m4.compose(p3, q, s3);
        balloons.setMatrixAt(items.length + i, m4);
      }
      balloons.instanceMatrix.needsUpdate = true;
      strings.instanceMatrix.needsUpdate = true;
    });
  }

  return {
    group,
    update(dt, t, camera) {
      for (let i = 0; i < updates.length; i++) updates[i](dt, t, camera);
    },
    dispose() {
      for (const o of own) o.dispose();
      own.length = 0;
      if (group.parent) group.parent.remove(group);
    },
  };
}

// Vertical streaks of water with glints, pastel blue to white.
function waterTexture() {
  const W = 64;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, 'rgba(170,225,255,0.15)');
  grd.addColorStop(0.2, 'rgba(190,235,255,0.75)');
  grd.addColorStop(0.5, 'rgba(225,246,255,0.9)');
  grd.addColorStop(0.8, 'rgba(190,235,255,0.75)');
  grd.addColorStop(1, 'rgba(170,225,255,0.15)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const r = rng(4);
  for (let i = 0; i < 26; i++) {
    const x = 4 + r() * (W - 8);
    const y = r() * H;
    const len = 30 + r() * 90;
    g.fillStyle = i % 3 ? 'rgba(255,255,255,0.65)' : 'rgba(255,210,238,0.6)';
    g.fillRect(x, y, 1.5 + r() * 2, len);
    if (y + len > H) g.fillRect(x, y - H, 1.5, len);
  }
  for (let i = 0; i < 18; i++) {
    g.fillStyle = 'rgba(255,255,255,0.95)';
    const x = r() * W;
    const y = r() * H;
    g.fillRect(x - 2, y, 4, 1);
    g.fillRect(x, y - 2, 1, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sparkTexture() {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  g.fillRect(S / 2 - 0.5, 2, 1, S - 4);
  g.fillRect(2, S / 2 - 0.5, S - 4, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
