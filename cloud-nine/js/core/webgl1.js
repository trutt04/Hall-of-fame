// Skinned meshes on WebGL 1. three r160 reads bone matrices with textureSize() and texelFetch(), which
// only exist in WebGL 2 shaders, so on a device that only gives a WebGL 1 context (older Android
// GPUs, or an iPad that couldn't make a WebGL 2 one) the cheerleaders, the bots and the cloud puppy
// fail to compile and vanish while the island still draws. On a WebGL 1 renderer only, this swaps in
// the lookup three used before (texture2D on a bone texture of a size the shader knows) and makes
// every bone texture that size. A WebGL 2 renderer is left exactly as it is.
//
//   useWebGL1Skinning(THREE, renderer) -> boolean   true when the renderer is WebGL 1 (patched, once)
//   BONE_TEXTURE_SIZE                               texels per side: 16 x 16 / 4 = 64 bones (a cheerleader has 29)

export const BONE_TEXTURE_SIZE = 16;
const MAX_BONES = (BONE_TEXTURE_SIZE * BONE_TEXTURE_SIZE) / 4;
const S = BONE_TEXTURE_SIZE.toFixed(1);

// three r154's skinning_pars_vertex, with its boneTextureSize uniform (gone in r160) as a constant.
export const SKINNING_PARS_WEBGL1 = `#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		float j = i * 4.0;
		float x = mod( j, ${S} );
		float y = floor( j / ${S} );
		float dx = 1.0 / ${S};
		float dy = 1.0 / ${S};
		y = dy * ( y + 0.5 );
		vec4 v1 = texture2D( boneTexture, vec2( dx * ( x + 0.5 ), y ) );
		vec4 v2 = texture2D( boneTexture, vec2( dx * ( x + 1.5 ), y ) );
		vec4 v3 = texture2D( boneTexture, vec2( dx * ( x + 2.5 ), y ) );
		vec4 v4 = texture2D( boneTexture, vec2( dx * ( x + 3.5 ), y ) );
		return mat4( v1, v2, v3, v4 );
	}
#endif`;

export function useWebGL1Skinning(THREE, renderer) {
  const caps = renderer && renderer.capabilities;
  if (!caps || caps.isWebGL2 !== false) return false;
  const proto = THREE.Skeleton.prototype;
  if (proto.computeBoneTexture.c9WebGL1) return true;
  const original = proto.computeBoneTexture;
  // three's own computeBoneTexture, at the fixed size (the texture2D lookup above needs to know it)
  function computeBoneTexture() {
    if (this.bones.length > MAX_BONES) return original.call(this);
    const size = BONE_TEXTURE_SIZE;
    const boneMatrices = new Float32Array(size * size * 4);
    boneMatrices.set(this.boneMatrices);
    const boneTexture = new THREE.DataTexture(boneMatrices, size, size, THREE.RGBAFormat, THREE.FloatType);
    boneTexture.needsUpdate = true;
    this.boneMatrices = boneMatrices;
    this.boneTexture = boneTexture;
    return this;
  }
  computeBoneTexture.c9WebGL1 = true;
  proto.computeBoneTexture = computeBoneTexture;
  THREE.ShaderChunk.skinning_pars_vertex = SKINNING_PARS_WEBGL1;
  return true;
}
