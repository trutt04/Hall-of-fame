// Shared materials. Almost everything in the world is drawn with `flatMat`.
// Never dispose these: every prop shares them.
import * as THREE from '../../lib/three.module.min.js';

// The workhorse: lit, flat shaded, colors come from vertex colors.
export const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
flatMat.name = 'lw-flat';

// Unlit: bulbs, flames, neon. Looks the same day and night.
export const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
glowMat.name = 'lw-glow';

// Additive, uses vertex alpha: halos, beams, sparkles. Never writes depth.
export const addMat = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  side: THREE.DoubleSide, fog: false,
});
addMat.name = 'lw-add';

// Lit and see-through (uses vertex alpha): water, glass, tarps.
export const glassMat = new THREE.MeshLambertMaterial({
  vertexColors: true, flatShading: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});
glassMat.name = 'lw-glass';

// Soft blob shadow under things that move (vertex alpha fades it out at the rim).
export const blobMat = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
blobMat.name = 'lw-blob';

export const SHARED_MATERIALS = [flatMat, glowMat, addMat, glassMat, blobMat];

// Per-object variants (the caller owns and disposes these).
export function makeWindowMaterial(emissive = 0xffc66b) {
  // Looks exactly like flatMat by day. The world raises emissiveIntensity at night.
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive, emissiveIntensity: 0 });
  m.name = 'lw-window';
  return m;
}
export function makeGlowMaterial(color = 0xffffff) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, color });
  m.name = 'lw-glow-own';
  return m;
}
export function makeAddMaterial(color = 0xffffff, opacity = 1) {
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  m.name = 'lw-add-own';
  return m;
}

// Lit like flatMat, plus a glow in the surface's OWN color: emissive = vertex color * intensity.
// Used by the crown so gold glows gold and velvet glows red. Set material.userData.glow.value.
export function makeSelfLitMaterial(intensity = 0.3) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.name = 'lw-selflit';
  m.userData.glow = { value: intensity };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.lwGlow = m.userData.glow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lwGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * lwGlow;');
  };
  m.customProgramCacheKey = () => 'lw-selflit';
  return m;
}
