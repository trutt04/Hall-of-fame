// League World art: pure three.js builders. No scene, DOM or data access. See ARCHITECTURE.md, Contract 5.
//
//   Prop = { group, update?(dt, t), dispose() }      1 unit = 1 m, Y up, base on y = 0, front faces +Z.
//
// Everything is drawn with a handful of shared materials (materials.js). Call setReducedMotion(true)
// to damp flicker, flashing and bobbing everywhere.
export { setReducedMotion, isReducedMotion } from './util.js';
export { flatMat, glowMat, addMat, glassMat, blobMat, SHARED_MATERIALS } from './materials.js';
export { Geo, merge } from './geo.js';

// Homes
export { createHome, dumpHeapHeight } from './homes.js';

// Reactive details
export {
  createTrashPile, createGoalposts, createForSaleSign, createGoldenToilet, createSpotlight, createBlackCat,
  createHorseshoe, createFlamingos, createYardSign, createPlaque,
} from './reactive.js';
export { createAmbulance, createMovingTruck, createGarbageTruck } from './vehicles.js';

// Set pieces
export {
  createCrown, createThrone, createGoldGates, createFountain, createStreetlight, createBurningBarrel, createRainCloud,
  createStatue, createNewspaperBox, createTelescope, createPeriscope, createOuthouse, createTree, createBush,
  createTrashCan, createVelvetRope, createLawnChair, createGrill,
} from './setpieces.js';
export { createBuilding, createBoardFrame, createBlimp, createFloodlight } from './buildings.js';
export { createLeaderStatue, createLeaderBust, createLoudspeaker } from './regime.js';

// Characters
export { createAvatar, AVATAR_HEIGHT, AVATAR_ANIMS } from './avatar.js';
export { createCritters } from './critters.js';
