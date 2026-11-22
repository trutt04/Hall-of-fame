// Sample arenas in the Contract 1 `places` shapes, for the bot simulator (dev/games-sim.html) and
// the node tests. ISLAND picks the real coordinates; these only have to look like an island would.
// The court and the bow field are rotated on purpose, and the seeker starts at the garden gate just
// outside the garden bounds, so the arena maths gets exercised.
//
//   SAMPLE_PLACES            a whole `places` object
//   ARENA_VARIANTS[kind]     odd and edge-case arenas per mode (reversed corners, tiny, missing parts)

export const SAMPLE_PLACES = {
  plaza: { x: 0, z: 0, facing: 0 },
  gym: { x: -34, z: 8, w: 18, d: 22, facing: Math.PI / 2 },
  stage: { x: 0, z: 30, facing: Math.PI },
  tossPads: [
    { id: 'pad1', x: -10, z: -14, facing: 0, targetPlatformId: 'cloud1' },
    { id: 'pad2', x: 0, z: -16, facing: 0, targetPlatformId: 'cloud2' },
    { id: 'pad3', x: 10, z: -14, facing: 0, targetPlatformId: 'cloud3' },
  ],
  slides: [
    { id: 'slide1', fromPlatformId: 'cloud1', x0: -10, z0: -30, x1: -18, z1: -20 },
    { id: 'slide2', fromPlatformId: 'cloud2', x0: 0, z0: -34, x1: 4, z1: -22 },
    { id: 'slide3', fromPlatformId: 'cloud3', x0: 10, z0: -40, x1: 16, z1: -24 },
  ],
  hideGarden: {
    bounds: { x0: 22, z0: -46, x1: 56, z1: -14 },
    seekerStart: { x: 39, z: -12.5, facing: Math.PI },
    hideSpots: [
      { id: 'hedge1', x: 26, z: -18, kind: 'hedge', r: 1.4 },
      { id: 'hedge2', x: 52, z: -18, kind: 'hedge', r: 1.4 },
      { id: 'hedge3', x: 34, z: -21, kind: 'hedge', r: 1.3 },
      { id: 'bush1', x: 30, z: -26, kind: 'bush', r: 1.1 },
      { id: 'bush2', x: 46, z: -25, kind: 'bush', r: 1.1 },
      { id: 'bush3', x: 38, z: -31, kind: 'bush', r: 1 },
      { id: 'bush4', x: 43, z: -19.5, kind: 'bush', r: 1 },
      { id: 'slide1', x: 25, z: -33, kind: 'slide', r: 1.5 },
      { id: 'slide2', x: 23.5, z: -26, kind: 'slide', r: 1.3 },
      { id: 'tent1', x: 53, z: -32, kind: 'tent', r: 1.6 },
      { id: 'tent2', x: 47, z: -37, kind: 'tent', r: 1.5 },
      { id: 'rack1', x: 33, z: -40, kind: 'rack', r: 1.2 },
      { id: 'rack2', x: 54.5, z: -25, kind: 'rack', r: 1.1 },
      { id: 'cloud1', x: 42, z: -42, kind: 'cloud', r: 1.5 },
      { id: 'cloud2', x: 30, z: -35, kind: 'cloud', r: 1.4 },
      { id: 'barrel1', x: 26, z: -43.5, kind: 'barrel', r: 0.9 },
      { id: 'barrel2', x: 51, z: -44, kind: 'barrel', r: 0.9 },
      { id: 'curtain1', x: 37, z: -44.5, kind: 'curtain', r: 1.3 },
    ],
  },
  court: { x: -34, z: -28, w: 14, d: 24, facing: 0.3 },
  bowField: {
    x: 40,
    z: 34,
    w: 26,
    d: 46,
    facing: Math.PI / 2, // long side along world x
    bases: [
      { team: 0, x: 21, z: 34, r: 3 },
      { team: 1, x: 59, z: 34, r: 3 },
    ],
  },
  tagZone: { bounds: { x0: -14, z0: 44, x1: 16, z1: 70 } },
  photoBooth: { x: 6, z: -6, facing: 0 },
};

export const ARENA_VARIANTS = {
  hideSeek: [
    SAMPLE_PLACES.hideGarden,
    {
      // corners given backwards, only three spots (the game scatters its own), start inside
      bounds: { x0: 12, z0: 12, x1: -12, z1: -12 },
      seekerStart: { x: 0, z: 0, facing: 1 },
      hideSpots: [
        { id: 'a', x: 8, z: 8, kind: 'tent', r: 1.5 },
        { id: 'b', x: -8, z: 8, kind: 'nope', r: 99 },
        { id: 'c', x: 500, z: 0, kind: 'bush', r: 1 },
      ],
    },
    {}, // nothing at all: falls back to a default garden
  ],
  freezeTag: [SAMPLE_PLACES.tagZone, { bounds: { x0: -6, z0: -6, x1: 6, z1: 6 } }, { bounds: { x0: 'x' } }],
  dodgeball: [
    SAMPLE_PLACES.court,
    { x: 5, z: 5, w: 10, d: 18, facing: 2.4 },
    { x: 0, z: 0, w: 20, d: 30, facing: -1.2 },
  ],
  captureBow: [
    SAMPLE_PLACES.bowField,
    { x: 0, z: 0, w: 22, d: 40, facing: 0 }, // no bases: they go at the two ends
    { x: 10, z: -5, w: 30, d: 50, facing: 0.8, bases: [{ team: 1, x: 10, z: -5, r: 3 }, { team: 0, x: 10.5, z: -5, r: 30 }] },
  ],
};
