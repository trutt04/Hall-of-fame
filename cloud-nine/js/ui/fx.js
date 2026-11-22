// Rhinestone sparkle bursts (Contract 1: world.spawnBurst). One pooled THREE.Points with a
// canvas-drawn four-point star, additive, so every burst on screen together is a single draw call.
//
//   const fx = createFx({ scene, renderer, camera, quality })
//   fx.burst(x, y, z, { count = 26, colors, speed = 5, size = 0.5, up = 1 })
//   fx.update(dt)          call once a frame
//   fx.dispose()

import * as THREE from '../../lib/three.module.min.js';
import { PALETTE } from '../config.js';
import { isReducedMotion } from '../art/util.js';

const DEFAULT_COLORS = [PALETTE.rhinestonePink, PALETTE.rhinestonePurple, PALETTE.rhinestoneSilver, PALETTE.pink, PALETTE.gold];

function starTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#ffffff';
  for (const [w, h] of [[3.2, S / 2 - 2], [S / 2 - 2, 3.2]]) {
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2 - h);
    ctx.lineTo(S / 2 + w, S / 2);
    ctx.lineTo(S / 2, S / 2 + h);
    ctx.lineTo(S / 2 - w, S / 2);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFx({ scene, renderer = null, camera = null, quality = 'high' } = {}) {
  const N = quality === 'low' ? 220 : 520;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const maxLife = new Float32Array(N);
  const base = new Float32Array(N);
  const tint = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  let next = 0;
  let alive = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const tex = starTexture();
  const uniforms = { map: { value: tex }, scale: { value: 400 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: [
      'attribute float size; attribute vec3 color; varying vec3 vColor; uniform float scale;',
      'void main(){',
      '  vColor = color;',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  gl_PointSize = size * scale / max(0.1, -mv.z);',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D map; varying vec3 vColor;',
      'void main(){',
      '  vec4 t = texture2D(map, gl_PointCoord);',
      '  gl_FragColor = vec4(vColor * t.rgb * t.a, 1.0);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  points.name = 'sparkleBursts';
  scene.add(points);
  const c = new THREE.Color();
  const buf = new THREE.Vector2();

  function burst(x, y, z, o = {}) {
    if (![x, y, z].every(Number.isFinite)) return;
    const calm = isReducedMotion();
    const count = Math.max(1, Math.min(N, Math.round((o.count ?? 26) * (calm ? 0.4 : 1))));
    const colors = Array.isArray(o.colors) && o.colors.length ? o.colors : DEFAULT_COLORS;
    const sp = (o.speed ?? 5) * (calm ? 0.6 : 1);
    const sz = o.size ?? 0.5;
    const up = o.up ?? 1;
    for (let i = 0; i < count; i++) {
      const k = next;
      next = (next + 1) % N;
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(1 - Math.random() * (up > 0.5 ? 1 : 2)); // upper hemisphere when up
      const s = sp * (0.45 + Math.random() * 0.75);
      vel[k * 3] = Math.cos(a) * Math.sin(e) * s;
      vel[k * 3 + 1] = Math.cos(e) * s * up + 1.2;
      vel[k * 3 + 2] = Math.sin(a) * Math.sin(e) * s;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      maxLife[k] = 0.75 + Math.random() * 0.75;
      life[k] = maxLife[k];
      base[k] = sz * (0.55 + Math.random() * 0.9);
      seed[k] = Math.random() * 10;
      try {
        c.set(colors[i % colors.length]);
      } catch (err) {
        c.set(DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
      }
      tint[k * 3] = c.r;
      tint[k * 3 + 1] = c.g;
      tint[k * 3 + 2] = c.b;
    }
    alive = N;
  }

  let t = 0;
  function update(dt) {
    t += dt;
    if (renderer && camera) {
      renderer.getDrawingBufferSize(buf);
      uniforms.scale.value = buf.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
    if (!alive) return;
    let any = 0;
    const calm = isReducedMotion();
    const drag = Math.exp(-2.2 * dt);
    for (let k = 0; k < N; k++) {
      if (life[k] <= 0) {
        if (size[k] !== 0) size[k] = 0;
        continue;
      }
      any++;
      life[k] -= dt;
      const u = Math.max(0, life[k] / maxLife[k]);
      vel[k * 3] *= drag;
      vel[k * 3 + 1] = vel[k * 3 + 1] * drag - 4.2 * dt;
      vel[k * 3 + 2] *= drag;
      pos[k * 3] += vel[k * 3] * dt;
      pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
      pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      const tw = calm ? 1 : 0.65 + 0.35 * Math.sin(t * 18 + seed[k] * 6.3);
      const fade = u < 0.35 ? u / 0.35 : 1;
      size[k] = base[k] * (0.4 + 0.6 * u) * tw;
      col[k * 3] = tint[k * 3] * fade;
      col[k * 3 + 1] = tint[k * 3 + 1] * fade;
      col[k * 3 + 2] = tint[k * 3 + 2] * fade;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    if (!any) alive = 0;
  }

  return {
    burst,
    update,
    get active() { return alive > 0; },
    dispose() {
      points.removeFromParent();
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
