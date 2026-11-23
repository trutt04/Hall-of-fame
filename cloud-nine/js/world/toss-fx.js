// Shared basket toss effects, one of each for whichever pad is in use: the sparkle arc that shows
// where you will fly, the landing ring on the target cloud, the flyer's sparkle trail, her soft
// shadow on whatever is below, and the puffy cloud cushion for a cradle catch. Sparkles are
// canvas-drawn additive sprites (THREE.Points): one draw call each, nothing allocated per frame.
//
//   const fx = createTossFx({ scene, calm, quality })
//   fx.preview(points | null)        [[x, y, z], ...] along the arc, the pad end first (null hides it)
//   fx.ring(x, y, z, strength)       strength 0 hides it, 1 is bright
//   fx.trailPush(x, y, z) / fx.trailClear()
//   fx.shadow(x, y, z, height)       height above the surface below; null hides it
//   fx.cushion(x, y, z) / fx.cushionOff()
//   fx.update(dt, t)
//   fx.dispose()

import * as THREE from '../../lib/three.module.min.js';
import { Geo } from '../art/geo.js';
import { flatMat } from '../art/materials.js';
import { makeBlob } from '../art/util.js';
import { PALETTE } from '../config.js';

const PREVIEW_N = 40;
const TRAIL_N = 48;
const TRAIL_LIFE = 0.6;

let starTex = null;
export function starTexture() {
  if (starTex) return starTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.moveTo(32, 1);
  x.quadraticCurveTo(35.5, 28.5, 63, 32);
  x.quadraticCurveTo(35.5, 35.5, 32, 63);
  x.quadraticCurveTo(28.5, 35.5, 1, 32);
  x.quadraticCurveTo(28.5, 28.5, 32, 1);
  x.fill();
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  starTex.userData.shared = true;
  return starTex;
}

function sparkleMaterial(size) {
  return new THREE.PointsMaterial({
    size, map: starTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  });
}

export function createTossFx({ scene, calm = false, quality = 'high' }) {
  const group = new THREE.Group();
  group.name = 'tossFx';
  scene.add(group);
  const own = [];
  const palette = [PALETTE.rhinestonePink, PALETTE.white, PALETTE.rhinestonePurple, PALETTE.rhinestoneSilver].map((c) => new THREE.Color(c));

  // ---------------------------------------------------------------- the arc preview
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PREVIEW_N * 3);
  const pCol = new Float32Array(PREVIEW_N * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  const pMat = sparkleMaterial(0.5);
  const previewPts = new THREE.Points(pGeo, pMat);
  previewPts.name = 'tossArc';
  previewPts.frustumCulled = false;
  previewPts.visible = false;
  previewPts.renderOrder = 3;
  group.add(previewPts);
  own.push(pGeo, pMat);
  let previewCount = 0;
  let previewFade = 0;
  let previewWant = 0;

  // ---------------------------------------------------------------- the landing ring
  const ringGroup = new THREE.Group();
  ringGroup.name = 'tossRing';
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.rhinestonePink, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const discMat = new THREE.MeshBasicMaterial({ color: PALETTE.rhinestonePurple, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ringGeo = new THREE.RingGeometry(0.62, 0.84, 40);
  const discGeo = new THREE.CircleGeometry(0.62, 40);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  const disc = new THREE.Mesh(discGeo, discMat);
  ring.rotation.x = -Math.PI / 2;
  disc.rotation.x = -Math.PI / 2;
  ring.renderOrder = 3;
  disc.renderOrder = 3;
  ringGroup.add(ring, disc);
  ringGroup.visible = false;
  group.add(ringGroup);
  own.push(ringMat, discMat, ringGeo, discGeo);
  let ringStrength = 0;

  // ---------------------------------------------------------------- the trail
  const tGeo = new THREE.BufferGeometry();
  const tPos = new Float32Array(TRAIL_N * 3);
  const tCol = new Float32Array(TRAIL_N * 3);
  const tBorn = new Float32Array(TRAIL_N).fill(-99);
  const tBase = [];
  for (let i = 0; i < TRAIL_N; i++) tBase.push(palette[i % palette.length]);
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
  const tMat = sparkleMaterial(quality === 'low' ? 0.34 : 0.42);
  const trail = new THREE.Points(tGeo, tMat);
  trail.name = 'tossTrail';
  trail.frustumCulled = false;
  trail.renderOrder = 3;
  group.add(trail);
  own.push(tGeo, tMat);
  let head = 0;
  let clock = 0;
  let trailLive = false;

  // ---------------------------------------------------------------- the shadow
  const blob = makeBlob(0.5, 0.5, 0);
  blob.visible = false;
  group.add(blob);

  // ---------------------------------------------------------------- the cloud cushion
  const cg = new Geo();
  const puffs = [[0, 0.1, 0, 0.55], [0.55, 0.18, 0.2, 0.42], [-0.55, 0.18, 0.15, 0.44], [0.25, 0.22, -0.5, 0.4], [-0.3, 0.2, -0.45, 0.42], [0.1, 0.34, 0.55, 0.36], [-0.75, 0.32, -0.2, 0.3], [0.75, 0.34, -0.15, 0.3]];
  puffs.forEach(([x, y, z, r], i) => cg.ico(x, y, z, r, i % 3 === 2 ? 0xffe3f1 : 0xffffff, { detail: 1, sy: 0.72 }));
  const cushionMesh = cg.mesh(flatMat);
  cushionMesh.name = 'tossCushion';
  cushionMesh.visible = false;
  group.add(cushionMesh);
  own.push(cushionMesh.geometry);
  let cushionT = -1;
  let cushionOut = -1;

  return {
    preview(points) {
      if (!points || !points.length) {
        previewWant = 0;
        return;
      }
      previewCount = Math.min(PREVIEW_N, points.length);
      for (let i = 0; i < previewCount; i++) {
        pPos[i * 3] = points[i][0];
        pPos[i * 3 + 1] = points[i][1];
        pPos[i * 3 + 2] = points[i][2];
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.setDrawRange(0, previewCount);
      previewWant = 1;
    },
    ring(x, y, z, strength = 1) {
      ringStrength = Math.max(0, strength);
      ringGroup.visible = ringStrength > 0.01;
      if (ringGroup.visible) ringGroup.position.set(x, y + 0.07, z);
    },
    trailPush(x, y, z) {
      head = (head + 1) % TRAIL_N;
      tPos[head * 3] = x + (Math.random() - 0.5) * 0.25;
      tPos[head * 3 + 1] = y + (Math.random() - 0.5) * 0.25;
      tPos[head * 3 + 2] = z + (Math.random() - 0.5) * 0.25;
      tBorn[head] = clock;
      tGeo.attributes.position.needsUpdate = true;
      trailLive = true;
    },
    trailClear() {
      tBorn.fill(-99);
      tCol.fill(0);
      tGeo.attributes.color.needsUpdate = true;
      trailLive = false;
    },
    shadow(x, y, z, height) {
      if (height === null || !Number.isFinite(y)) {
        blob.visible = false;
        return;
      }
      blob.visible = true;
      blob.position.set(x, y + 0.05, z);
      const s = Math.max(0.3, Math.min(1.1, 1.1 - height / 16));
      blob.scale.set(0.5 * s, 1, 0.5 * s);
    },
    cushion(x, y, z) {
      cushionMesh.position.set(x, y, z);
      cushionMesh.visible = true;
      cushionT = 0;
      cushionOut = -1;
    },
    cushionOff() {
      if (cushionT >= 0 && cushionOut < 0) cushionOut = 0;
    },
    update(dt, t) {
      clock += dt;
      // the arc: lights running from the pad to the cloud
      previewFade += (previewWant - previewFade) * Math.min(1, dt * 6);
      previewPts.visible = previewFade > 0.02;
      if (previewPts.visible) {
        for (let i = 0; i < previewCount; i++) {
          const run = calm ? 0.6 : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(i * 0.55 - t * 6), 3);
          const c = palette[i % palette.length];
          const k = run * previewFade;
          pCol[i * 3] = c.r * k;
          pCol[i * 3 + 1] = c.g * k;
          pCol[i * 3 + 2] = c.b * k;
        }
        pGeo.attributes.color.needsUpdate = true;
      }
      if (ringGroup.visible) {
        const pulse = calm ? 1 : 1 + 0.07 * Math.sin(t * 6);
        ringGroup.scale.setScalar(pulse);
        ringMat.opacity = 0.9 * Math.min(1, ringStrength);
        discMat.opacity = 0.32 * Math.min(1, ringStrength);
      }
      if (trailLive) {
        let any = false;
        for (let i = 0; i < TRAIL_N; i++) {
          const age = clock - tBorn[i];
          const k = age >= 0 && age < TRAIL_LIFE ? 1 - age / TRAIL_LIFE : 0;
          if (k > 0) any = true;
          const c = tBase[i];
          tCol[i * 3] = c.r * k;
          tCol[i * 3 + 1] = c.g * k;
          tCol[i * 3 + 2] = c.b * k;
        }
        tGeo.attributes.color.needsUpdate = true;
        if (!any) trailLive = false;
      }
      if (cushionT >= 0) {
        cushionT += dt;
        let s = Math.min(1, cushionT / 0.22);
        s = calm ? s : s < 1 ? s * 1.15 : 1 + 0.06 * Math.sin(cushionT * 9) * Math.exp(-cushionT * 3);
        if (cushionOut >= 0) {
          cushionOut += dt;
          s *= Math.max(0, 1 - cushionOut / 0.55);
          if (cushionOut >= 0.55) {
            cushionT = -1;
            cushionMesh.visible = false;
          }
        }
        cushionMesh.scale.set(s, s * (calm ? 1 : 1 - 0.08 * Math.sin(cushionT * 7) * Math.exp(-cushionT * 2)), s);
      }
    },
    dispose() {
      for (const o of own) if (o && o.dispose) o.dispose();
      own.length = 0;
      scene.remove(group);
    },
  };
}
