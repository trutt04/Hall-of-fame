// Shared constants for Cloud Nine. Owned by the director: agents read this file, they don't edit it.
// Values marked OWNER are filled in once the owner sends the details.

// Same budgets as League World (phones and tablets first).
export const PERF = {
  maxPixelRatioMobile: 1.5,
  maxPixelRatioDesktop: 2,
  minPixelRatio: 0.75,
  targetDrawCalls: 220,
  targetTriangles: 160000,
  slowFrameMs: 24, // above this for a while, quality steps down
};

// Team colours come from Bailey's cheer outfit: hot pink, black and rhinestone sparkle.
// The rest is the pastel sky-island world around them.
export const PALETTE = {
  // her team
  pink: '#ff2e93', // hot pink: her bow and shorts
  pinkSoft: '#ff8cc6',
  pinkPale: '#ffd6ea',
  black: '#17121c', // team black, a touch of purple so it reads soft
  ink: '#2b2233', // UI text
  rhinestonePink: '#ff7ad1',
  rhinestonePurple: '#a96bff',
  rhinestoneSilver: '#eae8f2',
  // the world
  white: '#fff8fc',
  cloud: '#fff4fa',
  cloudShadow: '#e9dcf5',
  lilac: '#cdb4ff',
  lavender: '#b89cf0',
  babyBlue: '#9fd8ff',
  mint: '#9be7c4',
  lemon: '#ffe68a',
  peach: '#ffc4a8',
  coral: '#ff8a8a',
  grass: '#a8e6a1',
  grassDark: '#7fcf8a',
  skyTop: '#9fc4ff',
  skyHorizon: '#ffd1e8',
  sunset: '#ffb38a',
  gold: '#ffd36e',
  // two teams for dodgeball and Capture the Bow
  teamA: '#ff2e93', // Team Pink
  teamB: '#7b5cff', // Team Purple
};

export const TEAMS = [
  { id: 0, name: 'Team Pink', color: PALETTE.teamA },
  { id: 1, name: 'Team Purple', color: PALETTE.teamB },
];

// OWNER: her birthday. month 1-12, day 1-31, year of birth (used for the candle count).
// While these are null, birthday mode stays off.
export const BIRTHDAY = { name: 'Bailey', month: null, day: null, year: null };

export const GAME = {
  title: 'Cloud Nine', // working title
  maxPlayers: 10, // per room, bots included
  roomCodeLength: 4,
  roomCodeAlphabet: 'BCDFGHJKLMNPQRSTVWXZ2346789', // no vowels, so codes never spell words
  netHz: 10, // position updates per second
  interpDelayMs: 120, // remote players are drawn this far in the past, for smooth motion
};

export const STORAGE_KEYS = {
  look: 'c9.look.v1',
  nick: 'c9.nick.v1',
  sound: 'c9.sound.v1',
  progress: 'c9.progress.v1',
  quality: 'c9.quality.v1',
  rhythmLatency: 'c9.rhythm.latency.v1',
};

export const FEATURES = {
  online: true, // multiplayer rooms (needs js/net/firebase-config.js filled in to work across devices)
  birthdayMode: true,
  familyNotes: true,
};

// The UI font stack: no font files, the system's rounded face where there is one.
export const FONT_STACK = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
