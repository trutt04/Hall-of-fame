// Skinned characters on WebGL 1 (js/core/webgl1.js): three r160's skinning shader needs WebGL 2, so on
// a WebGL 1 renderer the shim swaps in a texture2D lookup on a bone texture of a fixed size. A WebGL 2
// renderer must be left exactly as it is. (The browser check that the cheerleader really draws on
// WebGL 1 was done by hand: Chromium with getContext('webgl2') refused.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.min.js';
import { useWebGL1Skinning, BONE_TEXTURE_SIZE, SKINNING_PARS_WEBGL1 } from '../js/core/webgl1.js';

const skeletonOf = (n) => {
  const bones = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Bone();
    b.position.set(i * 0.1, i * 0.2, -i * 0.05);
    if (i) bones[i - 1].add(b);
    bones.push(b);
  }
  bones[0].updateMatrixWorld(true);
  const s = new THREE.Skeleton(bones);
  s.update();
  return s;
};

test('a WebGL 2 renderer (or none) changes nothing', () => {
  const chunk = THREE.ShaderChunk.skinning_pars_vertex;
  const compute = THREE.Skeleton.prototype.computeBoneTexture;
  for (const r of [null, {}, { capabilities: {} }, { capabilities: { isWebGL2: true } }]) {
    assert.equal(useWebGL1Skinning(THREE, r), false);
  }
  assert.equal(THREE.ShaderChunk.skinning_pars_vertex, chunk);
  assert.equal(THREE.Skeleton.prototype.computeBoneTexture, compute);
  assert.match(chunk, /texelFetch/, 'three r160 still reads bones with texelFetch (WebGL 2 only), so the shim is still needed');
  const s = skeletonOf(29).computeBoneTexture();
  assert.equal(s.boneTexture.image.width, 12, "three's own size for 29 bones");
});

test('a WebGL 1 renderer gets a texture2D bone lookup and fixed-size bone textures, once', () => {
  const webgl1 = { capabilities: { isWebGL2: false } };
  assert.equal(useWebGL1Skinning(THREE, webgl1), true);
  const patched = THREE.Skeleton.prototype.computeBoneTexture;
  assert.equal(useWebGL1Skinning(THREE, webgl1), true, 'a second renderer (the creator) is fine');
  assert.equal(THREE.Skeleton.prototype.computeBoneTexture, patched, 'not wrapped twice');

  const chunk = THREE.ShaderChunk.skinning_pars_vertex;
  assert.equal(chunk, SKINNING_PARS_WEBGL1);
  assert.doesNotMatch(chunk, /texelFetch|textureSize|ivec2/, 'GLSL ES 1.00 has none of these');
  assert.match(chunk, /texture2D\( boneTexture/);
  assert.match(chunk, new RegExp('mod\\( j, ' + BONE_TEXTURE_SIZE + '\\.0 \\)'));
  for (const name of ['bindMatrix', 'bindMatrixInverse', 'boneTexture', 'getBoneMatrix']) assert.ok(chunk.includes(name), name);

  // the cheerleader (29 bones) and the cloud puppy (7): the same matrices, in a 16 x 16 float texture
  for (const n of [29, 7, 64]) {
    const s = skeletonOf(n);
    const before = Array.from(s.boneMatrices);
    s.computeBoneTexture();
    const tex = s.boneTexture;
    assert.equal(tex.image.width, BONE_TEXTURE_SIZE);
    assert.equal(tex.image.height, BONE_TEXTURE_SIZE);
    assert.equal(tex.type, THREE.FloatType);
    assert.equal(tex.format, THREE.RGBAFormat);
    assert.equal(tex.magFilter, THREE.NearestFilter, 'no float linear filtering needed (iOS has none)');
    assert.equal(tex.image.data, s.boneMatrices, 'update() writes straight into the texture');
    assert.deepEqual(Array.from(s.boneMatrices.subarray(0, n * 16)), before);
    // the shader's lookup for the last bone lands on its 4 texels
    const i = n - 1;
    const x = (i * 4) % BONE_TEXTURE_SIZE;
    const y = Math.floor((i * 4) / BONE_TEXTURE_SIZE);
    const texel = (y * BONE_TEXTURE_SIZE + x) * 4;
    assert.deepEqual(Array.from(s.boneMatrices.subarray(texel, texel + 16)), before.slice(i * 16, i * 16 + 16));
    s.bones[0].position.x += 1;
    s.bones[0].updateMatrixWorld(true);
    s.update();
    assert.equal(tex.image.data, s.boneMatrices, 'still the same array after an update');
  }
  // more bones than fit: three's own sizing (they'd be misread, but nothing throws)
  const big = skeletonOf(65).computeBoneTexture();
  assert.ok(big.boneTexture.image.width > BONE_TEXTURE_SIZE);
});
