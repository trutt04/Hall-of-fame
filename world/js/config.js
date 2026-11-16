// Shared constants for League World. Pure data, no imports, safe to load in Node and the browser.

// Neighborhoods, best to worst. The keys are used everywhere (model, art, world).
export const TIER_ORDER = ['hill', 'heights', 'bubble', 'park', 'dump'];

export const TIERS = {
  hill: {
    name: 'The Hill',
    blurb: 'First place. Gold gates, a throne, and a crown that is only on loan.',
  },
  heights: {
    name: 'Playoff Heights',
    blurb: 'Nice houses, a fountain, and neighbors who say "we" about their roster.',
  },
  bubble: {
    name: 'The Bubble',
    blurb: 'A beige cul-de-sac where nobody sleeps well.',
  },
  park: {
    name: 'Waiver Wire Trailer Park',
    blurb: 'Next to the landfill. The raccoons run the homeowners association.',
  },
  dump: {
    name: 'The Dump',
    blurb: 'Last place. A tent, a garbage heap, and a personal rain cloud.',
  },
};

// Twelve team colors, assigned by position in the list of team ids sorted ascending,
// so a team keeps its color all season no matter how its name or rank changes.
// Gold is deliberately missing: gold belongs to The Hill and the crown.
export const TEAM_COLORS = [
  0xd7263d, // red
  0xf46036, // orange
  0x9bc53d, // lime
  0x2e9e4f, // green
  0x1b998b, // teal
  0x33c6e8, // sky
  0x2d6be0, // blue
  0x5b4be0, // indigo
  0x9b3fd1, // purple
  0xe63fa4, // magenta
  0xff8fab, // pink
  0xa26a42, // tan
];

// Brand colors carried over from the existing Hall of Fame page.
export const BRAND = {
  night: 0x0a1022,
  navy: 0x18213f,
  turf: 0x14553c,
  gold: 0xf5c542,
  chalk: 0xf3eedd,
  stone: 0xaab3bf,
  flare: 0xff6a3d,
};

// Daytime palette per neighborhood. The sky system darkens and tints these by time of day.
export const PALETTE = {
  hill: {
    grass: 0x6fbf5a, path: 0xe9dfc4, wall: 0xf1ead8, roof: 0x3d4a7a, trim: 0xf5c542,
    fog: 0xffe9bd, accent: 0xf5c542,
  },
  heights: {
    grass: 0x67b35a, path: 0xd8cfb8, wall: 0xf3e9d2, roof: 0xb5523a, trim: 0xffffff,
    fog: 0xd6ebff, accent: 0x5fb8e8,
    walls: [0xf3e9d2, 0xcfe0ea, 0xd5e3c8, 0xf0d9c9],
  },
  plaza: {
    grass: 0x5fa955, path: 0xc9bfa6, wall: 0x18213f, roof: 0x0f1734, trim: 0xf5c542,
    fog: 0xdfe7ee, accent: 0xf5c542,
  },
  bubble: {
    grass: 0x9fae5e, path: 0xcfc6b2, wall: 0xd9c7a3, roof: 0xa89473, trim: 0xefe6d0,
    fog: 0xe6dcc6, accent: 0xc9b58a,
  },
  park: {
    grass: 0x8d8a4a, path: 0x8a6f4d, wall: 0xb9c2c4, roof: 0x8fa3a8, trim: 0x9a4b2a,
    fog: 0xb89f7c, accent: 0xff9a3d,
  },
  dump: {
    grass: 0x5a5a3c, path: 0x4d4436, wall: 0x6f7355, roof: 0x4a4f3c, trim: 0x2f3327,
    fog: 0x6f746a, accent: 0x9bbf5a,
  },
  road: 0x3b3f4a,
  roadLine: 0xf3eedd,
  trashBag: 0x23262b,
  trashBagAlt: 0x3a4a3a,
};

// Performance budget. Mid-range phones are the target, not laptops.
export const PERF = {
  maxPixelRatioMobile: 1.5,
  maxPixelRatioDesktop: 2,
  minPixelRatio: 0.75,
  targetDrawCalls: 220,
  targetTriangles: 160000,
  slowFrameMs: 24, // above this for a while, quality steps down
};

// Where things live, relative to world/index.html.
export const PATHS = {
  league: 'data/league.json',
  history: 'data/history.json',
  status: 'data/status.json',
  hallOfFame: '../index.html',
};

export const STORAGE_KEYS = {
  team: 'lw.team',
  sound: 'lw.sound',
  lastSeen: 'lw.lastSeen',
};
