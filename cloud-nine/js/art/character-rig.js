// The cheerleader's skeleton: bone names, parents and the bind-pose joint positions shared by the
// geometry builder (character-build.js), the pose library (character-poses.js) and the runtime
// (character.js). Pure data, no three.js.
//
// Bind pose: standing, arms hanging straight down, facing +Z, feet at y = 0. Meters.
// Her left is +X. Every vertex follows one bone (or blends two at a joint), like League World.

export const RIG = {
  height: 1.45,
  hipY: 0.62, // hip joints (the hips bone pivot)
  waistY: 0.7,
  chestY: 0.8,
  neckY: 0.985, // the head bone pivots at the base of the neck
  headY: 1.18, headZ: 0.005, headR: 0.166, // the skull: centre and radius
  shoulderX: 0.148, shoulderY: 0.94,
  elbowY: 0.745,
  wristY: 0.565,
  fistY: 0.532,
  legX: 0.074,
  kneeY: 0.34,
  ankleY: 0.075,
};
RIG.thigh = RIG.hipY - RIG.kneeY; // 0.28
RIG.shin = RIG.kneeY - RIG.ankleY; // 0.265
RIG.upperArm = RIG.shoulderY - RIG.elbowY; // 0.195
RIG.foreArm = RIG.elbowY - RIG.fistY; // elbow to the centre of the fist

export const BONES = [
  'hips', 'waist', 'chest', 'head',
  'armL', 'foreL', 'armR', 'foreR',
  'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
  'pony0', 'pony1', 'pony2', // hair chain (ponytails and long hair), simulated
  'bow', // the bow wobbles on its own bone
  'eyeL', 'eyeR', 'happy', 'brows', 'mouthSmile', 'mouthGrin', 'mouthO', // face: toggled by scale
  'skirtF', 'skirtB', 'skirtL', 'skirtR', // skirt panels flare with the legs
];
export const B = Object.freeze(Object.fromEntries(BONES.map((n, i) => [n, i])));

export const PARENT = Object.freeze({
  hips: null, waist: 'hips', chest: 'waist', head: 'chest',
  armL: 'chest', foreL: 'armL', armR: 'chest', foreR: 'armR',
  legL: 'hips', shinL: 'legL', footL: 'shinL', legR: 'hips', shinR: 'legR', footR: 'shinR',
  pony0: 'head', pony1: 'pony0', pony2: 'pony1', bow: 'head',
  eyeL: 'head', eyeR: 'head', happy: 'head', brows: 'head', mouthSmile: 'head', mouthGrin: 'head', mouthO: 'head',
  skirtF: 'hips', skirtB: 'hips', skirtL: 'hips', skirtR: 'hips',
});

// Bind-pose world positions of the joints that never move between looks. The hair chain, the bow
// and the face bones come from the geometry builder (they depend on the hairstyle).
export const JOINTS = Object.freeze({
  hips: [0, RIG.hipY, 0],
  waist: [0, RIG.waistY, 0],
  chest: [0, RIG.chestY, 0],
  head: [0, RIG.neckY, 0],
  armL: [RIG.shoulderX, RIG.shoulderY, 0], foreL: [RIG.shoulderX, RIG.elbowY, 0],
  armR: [-RIG.shoulderX, RIG.shoulderY, 0], foreR: [-RIG.shoulderX, RIG.elbowY, 0],
  legL: [RIG.legX, RIG.hipY, 0], shinL: [RIG.legX, RIG.kneeY, 0], footL: [RIG.legX, RIG.ankleY, 0],
  legR: [-RIG.legX, RIG.hipY, 0], shinR: [-RIG.legX, RIG.kneeY, 0], footR: [-RIG.legX, RIG.ankleY, 0],
  skirtF: [0, 0.735, 0.055], skirtB: [0, 0.735, -0.055], skirtL: [0.075, 0.735, 0], skirtR: [-0.075, 0.735, 0],
});
