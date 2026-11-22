// The sky over Cloud Nine: a pastel gradient dome with a soft sun, the sea of clouds below the
// island stretching to the horizon, big low-poly clouds drifting round, and slow sparkles in the
// air. It owns the world's three lights (one hemisphere, one directional, one ambient) and the fog.
//
//   const sky = createSky({ scene, quality })     quality: 'low' | 'high'
//   sky.update(dt, t, camera)                     once a frame (the dome and sparkles follow the camera)
//   sky.lights                                    { hemi, dir, amb }
//   sky.sunDirection                              Vector3 toward the sun
//   sky.fogColor                                  the horizon colour (THREE.Color)
//   sky.setSparkles(on)                           the air sparkles (on by default)
//   sky.dispose()
//
// Cheap on purpose: the sun is drawn inside the dome shader, the cloud sea and the drifting clouds
// are one instanced mesh each, and the sparkles are one Points draw.

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { mulberry32, TAU } from '../core/util.js';
import { motion, isReducedMotion } from '../art/util.js';

const SEA_Y = -50; // the top of the cloud sea sits about here

export function createSky({ scene, quality = 'high' } = {}) {
  const low = quality === 'low';
  const group = new THREE.Group();
  group.name = 'sky';
  scene.add(group);
  const own = [];

  // ---------------------------------------------------------------- lights
  const sunDir = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
  const hemi = new THREE.HemisphereLight(0xeaf1ff, 0xf7d3ea, 1.55);
  const dir = new THREE.DirectionalLight(0xfff1df, 1.85);
  dir.position.copy(sunDir).multiplyScalar(120);
  dir.target.position.set(0, 0, 0);
  const amb = new THREE.AmbientLight(0xffffff, 0.62);
  scene.add(hemi, dir, dir.target, amb);

  // ---------------------------------------------------------------- fog and the dome
  // a touch lighter than the palette's horizon, so the pink world in front of it still pops
  const horizon = new THREE.Color(PALETTE.skyHorizon).lerp(new THREE.Color(0xfff4fa), 0.3);
  scene.fog = new THREE.FogExp2(horizon.getHex(), low ? 0.0026 : 0.0022);
  const fogColor = scene.fog.color;
  const uniforms = {
    top: { value: new THREE.Color(0x78a9ff) },
    mid: { value: new THREE.Color(0xc2d4ff) },
    horizon: { value: fogColor },
    below: { value: new THREE.Color(0xffe6f2) },
    sunDir: { value: sunDir },
    sunColor: { value: new THREE.Color(0xfff2d6) },
  };
  const domeGeo = new THREE.SphereGeometry(620, 32, 18);
  const domeMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 sunDir; uniform vec3 sunColor;',
      'varying vec3 vDir;',
      'void main(){',
      '  vec3 d = normalize(vDir);',
      '  float h = d.y;',
      '  vec3 col;',
      '  if (h >= 0.0) {',
      '    float a = pow(clamp(h / 0.22, 0.0, 1.0), 0.75);',
      '    float b = smoothstep(0.12, 0.85, h);',
      '    col = mix(mix(horizon, mid, a), top, b);',
      '  } else {',
      '    col = mix(horizon, below, smoothstep(0.0, -0.25, h) * 0.5);',
      '  }',
      '  float s = max(dot(d, sunDir), 0.0);',
      '  col += sunColor * (pow(s, 6.0) * 0.12 + pow(s, 48.0) * 0.32);',
      '  col = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.99935, 0.9997, s));',
      '  gl_FragColor = vec4(col, 1.0);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.name = 'skyDome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);
  own.push(domeGeo, domeMat);

  // ---------------------------------------------------------------- the sea of clouds
  const sea = new THREE.Group();
  sea.name = 'cloudSea';
  group.add(sea);
  {
    // a wide soft floor
    const seg = 48;
    const rings = [0, 80, 180, 320, 520, 900];
    const cols = [0xfbf6ff, 0xfdf3fb, 0xfff0f7, 0xffebf5, 0xffe6f2, 0xffe2f0].map((c) => new THREE.Color(c));
    const pos = [];
    const col = [];
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * TAU;
        const a1 = ((i + 1) / seg) * TAU;
        const P = (r, a) => [Math.sin(a) * r, SEA_Y - 6 - (r > 0 ? 3 * Math.sin(a * 5 + r * 0.01) : 0), Math.cos(a) * r];
        const quad = k === 0 ? [[P(0, 0), P(rings[1], a1), P(rings[1], a0)]] : [[P(rings[k], a0), P(rings[k + 1], a1), P(rings[k + 1], a0)], [P(rings[k], a0), P(rings[k], a1), P(rings[k + 1], a1)]];
        for (const tri of quad) {
          for (const p of tri) {
            pos.push(p[0], p[1], p[2]);
            const r = Math.hypot(p[0], p[2]);
            let kk = 0;
            while (kk < rings.length - 2 && r > rings[kk + 1]) kk++;
            const t = Math.min(1, (r - rings[kk]) / (rings[kk + 1] - rings[kk]));
            const c = cols[kk].clone().lerp(cols[kk + 1], t);
            col.push(c.r, c.g, c.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0xffeef7, emissiveIntensity: 0.3 });
    const floor = new THREE.Mesh(g, m);
    floor.name = 'seaFloor';
    floor.matrixAutoUpdate = false;
    sea.add(floor);
    own.push(g, m);
  }
  // lumpy puffs: a jittered icosahedron, fine for the near ring and coarse for the far one
  const puffGeo = (detail, seed) => {
    const ico = new THREE.IcosahedronGeometry(1, detail);
    const src = ico.attributes.position;
    const rnd = mulberry32(seed);
    const map = new Map();
    const p = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      const x = src.getX(i);
      const y = src.getY(i);
      const z = src.getZ(i);
      const key = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000);
      let k = map.get(key);
      if (k === undefined) {
        k = 0.88 + rnd() * 0.24;
        map.set(key, k);
      }
      p[i * 3] = x * k;
      p[i * 3 + 1] = Math.max(-0.35, y * k);
      p[i * 3 + 2] = z * k;
    }
    ico.setAttribute('position', new THREE.BufferAttribute(p, 3));
    ico.computeVertexNormals();
    own.push(ico);
    return ico;
  };
  const puffMat = new THREE.MeshLambertMaterial({ flatShading: true, color: 0xffffff, emissive: 0xffeef7, emissiveIntensity: 0.24 });
  own.push(puffMat);
  {
    const rnd = mulberry32(77);
    const near = [];
    const far = [];
    const nNear = low ? 18 : 30;
    const nFar = low ? 26 : 42;
    for (let i = 0; i < nNear; i++) {
      const a = rnd() * TAU;
      const r = 55 + Math.sqrt(rnd()) * 170;
      near.push([Math.sin(a) * r, Math.cos(a) * r, 9 + rnd() * 14]);
    }
    for (let i = 0; i < nFar; i++) {
      const a = (i / nFar) * TAU + rnd() * 0.15;
      const r = 230 + rnd() * 340;
      far.push([Math.sin(a) * r, Math.cos(a) * r, 22 + rnd() * 34]);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const tints = [0xffffff, 0xffeaf5, 0xf1eaff, 0xffe4f1, 0xfaf2ff, 0xffffff];
    for (const [items, geo, name] of [[near, puffGeo(1, 5), 'seaPuffs'], [far, puffGeo(0, 6), 'seaPuffsFar']]) {
      const mesh = new THREE.InstancedMesh(geo, puffMat, items.length);
      mesh.name = name;
      items.forEach(([x, z, s], i) => {
        e.set(0, rnd() * TAU, 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(x, SEA_Y - s * 0.32 + rnd() * 2, z), q, new THREE.Vector3(s * (1.2 + rnd() * 0.7), s * (0.36 + rnd() * 0.16), s * (1.1 + rnd() * 0.4)));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, c.setHex(tints[i % tints.length]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      sea.add(mesh);
    }
  }

  // ---------------------------------------------------------------- drifting clouds
  const clouds = (() => {
    const rnd = mulberry32(31);
    const parts = [];
    const lumps = [[0, 0, 0, 9, 4.6, 6.5], [8.5, -0.8, 1.2, 6.4, 3.6, 5.2], [-8.4, -1, -0.8, 7, 3.4, 5.4], [3.2, 2.6, -1.4, 5.8, 3.4, 4.6], [-3.6, 2.0, 1.8, 5.4, 3.0, 4.2], [12.5, -1.6, -0.6, 3.6, 2.2, 3.2]];
    for (const [ox, oy, oz, sx, sy, sz] of lumps) {
      const ico = new THREE.IcosahedronGeometry(1, sx > 6 ? 1 : 0);
      const src = ico.attributes.position;
      for (let i = 0; i < src.count; i++) parts.push(src.getX(i) * sx + ox, Math.max(-1.8, src.getY(i) * sy + oy), src.getZ(i) * sz + oz);
      ico.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(parts), 3));
    g.computeVertexNormals();
    own.push(g);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0xffe9f6, emissiveIntensity: 0.18 });
    own.push(mat);
    const count = low ? 7 : 11;
    const mesh = new THREE.InstancedMesh(g, mat, count);
    mesh.name = 'clouds';
    mesh.frustumCulled = false;
    const items = [];
    for (let i = 0; i < count; i++) {
      const band = i % 3;
      items.push({
        a: rnd() * TAU,
        r: band === 0 ? 150 + rnd() * 60 : band === 1 ? 230 + rnd() * 90 : 330 + rnd() * 120,
        y: band === 0 ? -18 + rnd() * 26 : 20 + rnd() * 60,
        s: 1.1 + rnd() * 1.6 + band * 0.5,
        w: (0.004 + rnd() * 0.006) * (rnd() < 0.5 ? 1 : -1) * (band === 0 ? 1.4 : 1),
        rot: rnd() * TAU,
        bob: rnd() * TAU,
      });
    }
    group.add(mesh);
    return { mesh, items };
  })();

  // ---------------------------------------------------------------- sparkles in the air
  const sparkles = (() => {
    const N = low ? 70 : 150;
    const BOX = new THREE.Vector3(72, 26, 72);
    const rnd = mulberry32(9);
    const seed = new Float32Array(N * 4);
    const color = new Float32Array(N * 3);
    const pal = [0xffffff, 0xffd6f0, 0xe7d6ff, 0xfff0b8, 0xffffff].map((h) => new THREE.Color(h));
    for (let i = 0; i < N; i++) {
      seed[i * 4] = rnd();
      seed[i * 4 + 1] = rnd();
      seed[i * 4 + 2] = rnd();
      seed[i * 4 + 3] = rnd() * TAU;
      const c = pal[i % pal.length];
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    own.push(g);
    const tex = sparkleTexture();
    own.push(tex);
    const u = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: BOX },
      uMap: { value: tex },
      uScale: { value: 300 },
      uRate: { value: 1 },
      uMaxPx: { value: 26 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: [
        'attribute vec4 aSeed; attribute vec3 aColor;',
        'uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uScale; uniform float uRate; uniform float uMaxPx;',
        'varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vec3 drift = vec3(sin(uTime * 0.11 + aSeed.w) * 1.5, uTime * (0.25 + aSeed.x * 0.35) * uRate, cos(uTime * 0.09 + aSeed.w) * 1.5);',
        '  vec3 rel = fract((aSeed.xyz * uBox + drift - uCam) / uBox) - 0.5;',
        '  vec3 wp = uCam + rel * uBox;',
        '  vec4 mv = viewMatrix * vec4(wp, 1.0);',
        '  float tw = max(0.0, sin(uTime * (1.2 + aSeed.y * 1.6) * uRate + aSeed.w * 5.0));',
        '  float edge = 1.0 - smoothstep(0.32, 0.5, max(abs(rel.x), max(abs(rel.y), abs(rel.z))));',
        '  float nearFade = smoothstep(2.5, 7.0, -mv.z);',
        '  vAlpha = tw * tw * tw * edge * nearFade;',
        '  vColor = aColor;',
        '  gl_PointSize = min(uMaxPx, (0.35 + 0.45 * aSeed.z) * uScale * (0.4 + 0.8 * tw) / max(1.0, -mv.z));',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha;',
        'void main(){',
        '  vec4 t = texture2D(uMap, gl_PointCoord);',
        '  gl_FragColor = vec4(vColor * t.rgb * vAlpha, 1.0);',
        '}',
      ].join('\n'),
    });
    own.push(mat);
    const pts = new THREE.Points(g, mat);
    pts.name = 'airSparkles';
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    group.add(pts);
    return { pts, u };
  })();

  // ---------------------------------------------------------------- per frame
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  let seaSpin = 0;
  function update(dt, t, camera) {
    const m = motion();
    if (camera) {
      dome.position.copy(camera.position);
      sparkles.u.uCam.value.copy(camera.position);
      // keep sparkles the same size on every screen
      const h = camera.isPerspectiveCamera ? 1 / Math.tan((camera.fov * Math.PI) / 360) : 1;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sparkles.u.uScale.value = 0.5 * h * (window.innerHeight || 800) * dpr * 0.5;
      sparkles.u.uMaxPx.value = 22 * dpr;
    }
    sparkles.u.uTime.value = t;
    sparkles.u.uRate.value = isReducedMotion() ? 0.25 : 1;
    seaSpin += dt * 0.0035 * m;
    sea.rotation.y = seaSpin;
    for (let i = 0; i < clouds.items.length; i++) {
      const c = clouds.items[i];
      c.a += c.w * dt * m;
      e.set(0, c.rot + c.a * 0.5, 0);
      q.setFromEuler(e);
      v3.set(Math.sin(c.a) * c.r, c.y + Math.sin(t * 0.08 + c.bob) * 2 * m, Math.cos(c.a) * c.r);
      s3.set(c.s, c.s * 0.78, c.s);
      m4.compose(v3, q, s3);
      clouds.mesh.setMatrixAt(i, m4);
    }
    clouds.mesh.instanceMatrix.needsUpdate = true;
  }
  update(0, 0, null);

  return {
    group,
    lights: { hemi, dir, amb },
    update,
    get sunDirection() { return sunDir; },
    get fogColor() { return fogColor; },
    setSparkles(on) { sparkles.pts.visible = !!on; },
    dispose() {
      scene.remove(group, hemi, dir, dir.target, amb);
      if (scene.fog && scene.fog.color === fogColor) scene.fog = null;
      for (const o of own) o.dispose();
      own.length = 0;
    },
  };
}

// A soft four-point twinkle, drawn once into a small canvas.
function sparkleTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.1, 'rgba(255,255,255,0.12)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  const cx = S / 2;
  const r0 = S / 2 - 1;
  const r1 = S * 0.06;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const r = i % 2 ? r1 : i % 4 === 0 ? r0 : r0 * 0.7;
    g.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
