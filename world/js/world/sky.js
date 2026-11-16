// Sky, time of day and per-neighborhood atmosphere.
//
// Time follows the visitor's real local clock unless overridden (sky.setTime(hours) or ?time=17.5).
// Every frame the fog and light tint are blended from the zone weights at the focus position, so
// The Hill is always a little golden and clear and The Dump is always a grey-green murk.
//
// Cheap on purpose: one hemisphere light, one directional light, one ambient light, no shadows.

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { clamp, lerp, smoothstep, mulberry32, emitter, TAU } from '../core/util.js';

// hour, sky top, horizon, sun/moon light color, light intensity, hemisphere sky, hemisphere ground,
// hemisphere intensity, ambient intensity, star alpha, night amount, cloud tint
const KEYS = [
  { h: 0.0, top: 0x0b1436, hor: 0x24356a, sun: 0x9db4ff, sunI: 0.85, hSky: 0x5a70c0, hGnd: 0x232a4a, hemiI: 1.25, amb: 0.42, star: 1.0, night: 1.0, cloud: 0x43507c },
  { h: 4.8, top: 0x0b1436, hor: 0x24356a, sun: 0x9db4ff, sunI: 0.85, hSky: 0x5a70c0, hGnd: 0x232a4a, hemiI: 1.25, amb: 0.42, star: 1.0, night: 1.0, cloud: 0x43507c },
  { h: 6.1, top: 0x41559a, hor: 0xf4a983, sun: 0xffb27d, sunI: 1.3, hSky: 0xa9b1de, hGnd: 0x514657, hemiI: 1.3, amb: 0.34, star: 0.2, night: 0.5, cloud: 0xf3b6a6 },
  { h: 7.6, top: 0x5a9ae2, hor: 0xcfe4f3, sun: 0xfff0d2, sunI: 2.1, hSky: 0xcfe2ff, hGnd: 0x7a735c, hemiI: 1.45, amb: 0.3, star: 0.0, night: 0.0, cloud: 0xffffff },
  { h: 12.0, top: 0x3f8fe6, hor: 0xcde6f7, sun: 0xfff6e2, sunI: 2.4, hSky: 0xd6e8ff, hGnd: 0x80785e, hemiI: 1.5, amb: 0.3, star: 0.0, night: 0.0, cloud: 0xffffff },
  { h: 16.4, top: 0x4b8fda, hor: 0xe5e3d2, sun: 0xffe6ba, sunI: 2.3, hSky: 0xd8e2f5, hGnd: 0x80745a, hemiI: 1.45, amb: 0.3, star: 0.0, night: 0.0, cloud: 0xfff6ea },
  { h: 18.2, top: 0x55649f, hor: 0xffb56d, sun: 0xff9d4f, sunI: 2.0, hSky: 0xe3bca4, hGnd: 0x6c584a, hemiI: 1.3, amb: 0.3, star: 0.0, night: 0.18, cloud: 0xffc39e },
  { h: 19.4, top: 0x2c3169, hor: 0xdb745e, sun: 0xff7e5e, sunI: 1.1, hSky: 0x9a8fc0, hGnd: 0x40354d, hemiI: 1.25, amb: 0.36, star: 0.35, night: 0.68, cloud: 0xa26f90 },
  { h: 20.7, top: 0x0b1436, hor: 0x24356a, sun: 0x9db4ff, sunI: 0.85, hSky: 0x5a70c0, hGnd: 0x232a4a, hemiI: 1.25, amb: 0.42, star: 1.0, night: 1.0, cloud: 0x43507c },
  { h: 24.0, top: 0x0b1436, hor: 0x24356a, sun: 0x9db4ff, sunI: 0.85, hSky: 0x5a70c0, hGnd: 0x232a4a, hemiI: 1.25, amb: 0.42, star: 1.0, night: 1.0, cloud: 0x43507c },
].map((k) => Object.assign(k, {
  top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun),
  hSky: new THREE.Color(k.hSky), hGnd: new THREE.Color(k.hGnd), cloud: new THREE.Color(k.cloud),
}));

// fog color, fog density, light tint, how much the zone overrides the time-of-day horizon,
// sun strength, how murky the upper sky gets
const ZONES = {
  hill: { fog: PALETTE.hill.fog, density: 0.0019, tint: 0xfff0cf, mix: 0.5, sun: 1.06, murk: 0.0 },
  heights: { fog: PALETTE.heights.fog, density: 0.0023, tint: 0xf1f7ff, mix: 0.42, sun: 1.0, murk: 0.0 },
  plaza: { fog: PALETTE.plaza.fog, density: 0.0026, tint: 0xffffff, mix: 0.3, sun: 1.0, murk: 0.05 },
  bubble: { fog: PALETTE.bubble.fog, density: 0.0036, tint: 0xf7efdb, mix: 0.62, sun: 0.94, murk: 0.3 },
  park: { fog: PALETTE.park.fog, density: 0.0045, tint: 0xf5d9a6, mix: 0.68, sun: 0.9, murk: 0.38 },
  dump: { fog: PALETTE.dump.fog, density: 0.0058, tint: 0xb8c8ac, mix: 0.82, sun: 0.7, murk: 0.7 },
};
const ZONE_KEYS = Object.keys(ZONES);
for (const k of ZONE_KEYS) {
  ZONES[k].fogC = new THREE.Color(ZONES[k].fog);
  ZONES[k].tintC = new THREE.Color(ZONES[k].tint);
}

const SUNRISE = 6.0;
const SUNSET = 19.6;

export function createSky({ scene, camera, terrain, quality = 'high' }) {
  const events = emitter();
  const group = new THREE.Group();
  group.name = 'sky';
  scene.add(group);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.4);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  const amb = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(hemi, sun, sun.target, amb);

  const fogColor = new THREE.Color(0xcfe4f3);
  scene.fog = new THREE.FogExp2(fogColor, 0.0026);
  scene.background = null;

  // ---------------------------------------------------------------- dome
  const uniforms = {
    top: { value: new THREE.Color() },
    horizon: { value: fogColor },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    glow: { value: 1 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(480, 20, 12),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float glow;',
        'varying vec3 vDir;',
        'void main(){',
        '  vec3 d = normalize(vDir);',
        '  float h = max(d.y, 0.0);',
        '  vec3 col = mix(horizon, top, 1.0 - pow(1.0 - h, 2.6));',
        '  float s = max(dot(d, sunDir), 0.0);',
        '  col += sunColor * (pow(s, 48.0) * 0.5 + pow(s, 7.0) * 0.16) * glow;',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
    }),
  );
  dome.name = 'skyDome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // ---------------------------------------------------------------- sun, moon, stars
  const discGeo = new THREE.CircleGeometry(1, 24);
  const sunDisc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false, depthWrite: false }));
  sunDisc.renderOrder = -9;
  sunDisc.frustumCulled = false;
  group.add(sunDisc);

  const moonCanvas = document.createElement('canvas');
  moonCanvas.width = 64;
  moonCanvas.height = 64;
  {
    const g = moonCanvas.getContext('2d');
    g.fillStyle = '#eef2ff';
    g.beginPath();
    g.arc(32, 32, 30, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(44, 26, 26, 0, TAU);
    g.fill();
  }
  const moonTex = new THREE.CanvasTexture(moonCanvas);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  const moonDisc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false }));
  moonDisc.renderOrder = -9;
  moonDisc.frustumCulled = false;
  group.add(moonDisc);

  const stars = (() => {
    const rnd = mulberry32(1987);
    const n = quality === 'low' ? 160 : 320;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const y = 0.08 + rnd() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 440;
      pos[i * 3 + 1] = y * 440;
      pos[i * 3 + 2] = Math.sin(a) * r * 440;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    pts.renderOrder = -9;
    pts.frustumCulled = false;
    pts.visible = false;
    group.add(pts);
    return pts;
  })();

  // ---------------------------------------------------------------- clouds (one instanced mesh)
  const clouds = (() => {
    const rnd = mulberry32(31);
    const parts = [];
    const lump = new THREE.IcosahedronGeometry(1, 0);
    const src = lump.attributes.position;
    const lumps = [[0, 0, 0, 9, 4.2, 6], [8, -0.6, 1.5, 6.5, 3.2, 5], [-8, -0.8, -1, 7, 3, 5.2], [3, 2.2, -1.5, 5.5, 3, 4.4], [-3.5, 1.6, 2, 5, 2.6, 4]];
    for (const [ox, oy, oz, sx, sy, sz] of lumps) {
      for (let i = 0; i < src.count; i++) parts.push(src.getX(i) * sx + ox, Math.max(-1.6, src.getY(i) * sy + oy), src.getZ(i) * sz + oz);
    }
    lump.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(parts), 3));
    g.computeVertexNormals();
    const count = quality === 'low' ? 5 : 8;
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const mesh = new THREE.InstancedMesh(g, mat, count);
    mesh.name = 'clouds';
    mesh.frustumCulled = false;
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        x: -380 + rnd() * 760, y: 78 + rnd() * 34, z: -300 + rnd() * 600,
        s: 1.6 + rnd() * 1.8, speed: 0.9 + rnd() * 1.1, rot: rnd() * TAU,
      });
    }
    group.add(mesh);
    return { mesh, mat, items };
  })();

  // ---------------------------------------------------------------- state
  let override = null;
  let hours = 12;
  let live = false;
  const cur = {
    top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hSky: new THREE.Color(), hGnd: new THREE.Color(), cloud: new THREE.Color(),
    sunI: 1, hemiI: 1, amb: 0.3, star: 0, night: 0,
  };
  const zoneW = { hill: 0, heights: 0, plaza: 1, bubble: 0, park: 0, dump: 0 };
  const zoneTmp = {};
  let zoneReady = false;
  const sunDir = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  const moonDir = new THREE.Vector3(-0.4, 0.7, 0.3).normalize();
  const lightDir = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const tmpC2 = new THREE.Color();
  const nightTint = new THREE.Color();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();

  function clockHours() {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  function sampleKeys(h) {
    h = ((h % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = smoothstep(0, 1, clamp((h - a.h) / Math.max(1e-6, b.h - a.h), 0, 1));
    cur.top.copy(a.top).lerp(b.top, t);
    cur.hor.copy(a.hor).lerp(b.hor, t);
    cur.sun.copy(a.sun).lerp(b.sun, t);
    cur.hSky.copy(a.hSky).lerp(b.hSky, t);
    cur.hGnd.copy(a.hGnd).lerp(b.hGnd, t);
    cur.cloud.copy(a.cloud).lerp(b.cloud, t);
    cur.sunI = lerp(a.sunI, b.sunI, t);
    cur.hemiI = lerp(a.hemiI, b.hemiI, t);
    cur.amb = lerp(a.amb, b.amb, t);
    cur.star = lerp(a.star, b.star, t);
    cur.night = lerp(a.night, b.night, t);
  }

  function celestial(h) {
    // The sun rises in the east (+x), swings through the south (+z, downhill) and sets west.
    const a = ((h - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
    sunDir.set(Math.cos(a), Math.sin(a) * 0.95, 0.42 * Math.max(0, Math.sin(a)) + 0.18).normalize();
    const nightLen = 24 - (SUNSET - SUNRISE);
    const hn = (h - SUNSET + 24) % 24;
    const m = (hn / nightLen) * Math.PI;
    moonDir.set(Math.cos(m) * 0.8, Math.sin(m) * 0.75 + 0.12, 0.5).normalize();
    // Blend the one directional light from sun to moon around dusk and dawn so shading never pops.
    const sunUp = smoothstep(-0.06, 0.1, sunDir.y);
    lightDir.copy(moonDir).lerp(sunDir, sunUp).normalize();
    if (lightDir.y < 0.12) {
      lightDir.y = 0.12;
      lightDir.normalize();
    }
    return sunUp;
  }

  function update(dt, t, focus) {
    hours = override !== null ? override : clockHours();
    sampleKeys(hours);
    const sunUp = celestial(hours);

    // zone weights at the focus, eased a little so teleports do not snap the mood
    const fx = focus ? focus.x : 0;
    const fz = focus ? focus.z : 0;
    terrain.zoneAt(fx, fz, zoneTmp);
    const k = zoneReady ? 1 - Math.exp(-2.2 * dt) : 1;
    zoneReady = true;
    let density = 0;
    let mix = 0;
    let sunMul = 0;
    let murk = 0;
    tmpC.setRGB(0, 0, 0);
    tmpC2.setRGB(0, 0, 0);
    for (const key of ZONE_KEYS) {
      zoneW[key] += (zoneTmp[key] - zoneW[key]) * k;
      const w = zoneW[key];
      const z = ZONES[key];
      density += z.density * w;
      mix += z.mix * w;
      sunMul += z.sun * w;
      murk += z.murk * w;
      tmpC.r += z.fogC.r * w;
      tmpC.g += z.fogC.g * w;
      tmpC.b += z.fogC.b * w;
      tmpC2.r += z.tintC.r * w;
      tmpC2.g += z.tintC.g * w;
      tmpC2.b += z.tintC.b * w;
    }

    // fog: the zone's mood, dimmed and cooled at night, laid over the time-of-day horizon
    nightTint.setRGB(lerp(1, 0.2, cur.night), lerp(1, 0.25, cur.night), lerp(1, 0.44, cur.night));
    tmpC.multiply(nightTint);
    fogColor.copy(cur.hor).lerp(tmpC, mix);
    scene.fog.density = density * (1 + 0.25 * cur.night) * (live ? 0.92 : 1);

    uniforms.top.value.copy(cur.top).lerp(fogColor, murk);
    uniforms.sunDir.value.copy(sunUp > 0.02 ? sunDir : moonDir);
    uniforms.sunColor.value.copy(cur.sun);
    uniforms.glow.value = (sunUp > 0.02 ? 1 : 0.35) * (1 - murk * 0.7);

    sun.color.copy(cur.sun).multiply(tmpC2);
    sun.intensity = cur.sunI * sunMul;
    sun.position.copy(lightDir).multiplyScalar(100);
    sun.target.position.set(0, 0, 0);
    hemi.color.copy(cur.hSky).lerp(fogColor, murk * 0.5);
    hemi.groundColor.copy(cur.hGnd);
    hemi.intensity = cur.hemiI * lerp(1, 0.88, murk);
    amb.intensity = cur.amb;
    amb.color.copy(tmpC2);

    // follow the camera
    const cp = camera.position;
    dome.position.copy(cp);
    stars.position.copy(cp);
    stars.material.opacity = cur.star * (1 - murk * 0.8);
    stars.visible = stars.material.opacity > 0.01;
    stars.rotation.y = hours * 0.05;

    sunDisc.visible = sunDir.y > -0.12;
    if (sunDisc.visible) {
      sunDisc.position.copy(sunDir).multiplyScalar(430).add(cp);
      sunDisc.lookAt(cp);
      const lowSun = 1 - smoothstep(0, 0.5, sunDir.y);
      sunDisc.scale.setScalar(20 + lowSun * 10);
      sunDisc.material.color.copy(cur.sun).lerp(tmpC.setRGB(1, 1, 1), 0.55 - lowSun * 0.35);
    }
    moonDisc.visible = cur.night > 0.05 && moonDir.y > -0.05;
    if (moonDisc.visible) {
      moonDisc.position.copy(moonDir).multiplyScalar(430).add(cp);
      moonDisc.lookAt(cp);
      moonDisc.scale.setScalar(17);
      moonDisc.material.opacity = clamp(cur.night * 1.4, 0, 1) * (1 - murk * 0.5);
    }

    // clouds drift east and wrap
    clouds.mat.color.copy(cur.cloud).lerp(fogColor, 0.25 + murk * 0.5);
    for (let i = 0; i < clouds.items.length; i++) {
      const c = clouds.items[i];
      c.x += c.speed * dt;
      if (c.x > 400) c.x = -400;
      e.set(0, c.rot, 0);
      q.setFromEuler(e);
      v3.set(c.x, c.y, c.z);
      s3.set(c.s, c.s * 0.8, c.s);
      m4.compose(v3, q, s3);
      clouds.mesh.setMatrixAt(i, m4);
    }
    clouds.mesh.instanceMatrix.needsUpdate = true;
  }

  const api = {
    group,
    lights: { hemi, sun, ambient: amb },
    update,
    // hours 0..24, or null to follow the real clock again
    setTime(h) {
      override = h === null || h === undefined || Number.isNaN(Number(h)) ? null : ((Number(h) % 24) + 24) % 24;
    },
    setGameDay(state) {
      const next = !!(state && state.live);
      if (next === live) return;
      live = next;
      events.emit('gameday', live);
    },
    on: events.on.bind(events),
    get hours() { return hours; },
    get nightAmount() { return cur.night; },
    get live() { return live; },
    get sunDirection() { return sunDir; },
    get fogColor() { return fogColor; },
    get zoneWeights() { return zoneW; },
    dispose() {
      scene.remove(group, hemi, sun, sun.target, amb);
      scene.fog = null;
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    },
  };
  return api;
}
