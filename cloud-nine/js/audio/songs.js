// Cloud Nine's soundtrack, written out as data for the sequencer (sequencer.js describes the shape,
// theory.js the pattern languages). Every melody here is original except "Happy Birthday to You",
// which is in the public domain. Pure data: no WebAudio, no DOM.
//
//   SONGS.island     bright and chill, 104 BPM, a two-minute loop that changes a little every time round
//   SONGS.game       energetic electro-pop for the mini games, 128 BPM
//   SONGS.tense      sneaky pizzicato for hide and seek, 108 BPM
//   SONGS.routine    the Hit Zero cheer mix: 36 eight-counts at 144 BPM, exactly two minutes, then the pose
//   SONGS.birthday   a brass fanfare, then "Happy Birthday" twice: a music box waltz, then the whole band a step up
//   SONGS.victory    a five-second fanfare sting
//
// A "Cloud Nine" motif (sol-do-mi-re-do-re-mi) runs through the island chorus, the routine hook and
// the birthday ending, so the music sounds like one world.

const _ = '................'; // an empty 4/4 bar
const _3 = '............'; // an empty 3/4 bar
const bars = (n, s) => Array(n).fill(s);
const hold = (n) => ['x' + '.'.repeat(15), ...bars(n - 1, '................')]; // one note held n bars

// ================================================================ island
// F major. Verses ride the "royal road" (IV V iii vi), the chorus is the motif over I V vi IV.

const islandVerseA = [
  '.:2 C5 D5 F5 A5:6 G5', // Bbmaj7
  'E5:6 D5 C5:4 .:4', // C7
  '.:2 A4 C5 E5 G5:6 F5', // Am7
  'D5:6 C5 A4:4 .:4', // Dm7
  '.:2 D5 F5 A5 C6:6 Bb5', // Gm7
  'A5:4 G5 E5 G5:4 .:4', // C7
  'F5:8 .:4 E5 F5', // Fmaj7
  'G5:4 Eb5:4 D5 C5 A4:4', // F7
];
const islandVerseB = [
  '.:2 C5 D5 F5:3 A5:3 G5 F5',
  'E5:4 .:2 C5 D5 E5 C5:4',
  '.:2 A4 C5 E5:3 G5:3 F5 E5',
  'D5:4 .:2 A4 C5 D5 F5:4',
  '.:2 D5 F5 A5:3 C6:3 Bb5 A5',
  'G5:4 .:2 E5 F5 G5 Bb5:4',
  'A5:6 G5 F5:8',
  '.:4 C5 D5 Eb5 F5 A5:4',
];
const islandChorus = [
  'C5 F5 A5:4 G5 F5 G5 A5', // F: the motif
  'G5:6 E5 C5:4 .:2 C5', // C/E
  'D5 F5 A5:4 G5 F5 G5 A5', // Dm7
  'Bb5:6 A5 F5:4 .:4', // Bbmaj7
  'C5 F5 A5:4 G5 F5 G5 A5', // F
  'C6:6 Bb5 A5:4 G5 F5', // C/E
  'F5 G5 A5 Bb5 C6:4 D6:4', // Bbmaj7
  'C6:4 Bb5 G5 E5:6 .:2', // C7sus4, C7
];
const islandBridge = [
  'A5:6 G5 F5:4 E5 D5', // Dm7
  'E5:8 .:4 C5 D5', // Am7
  'F5:6 G5 A5:4 F5 D5', // Bbmaj7
  'C5:8 .:8', // F/A
  'Bb5:6 A5 G5:4 F5 D5', // Gm7
  'E5:6 G5 C6:4 .:2 A5', // Am7
  'A5:4 Bb5 A5 F5:4 D5:4', // Bbmaj7
  'F5:8 E5:6 .:2', // C7sus4, C7
];
const islandWhistle = [
  '.:8 C5 F5 A5:4',
  'G5:4 F5 E5 .:8',
  '.:8 A4 C5 E5:4',
  'E5:4 D5 C5 .:8',
  '.:8 Bb4 D5 G5:4',
  'A5:4 G5 E5 .:8',
  '.:8 D5 F5 A5:4',
  'G5:4 F5:4 E5:6 .:2',
];

const islandGroove = {
  name: 'Groove',
  bars: 8,
  energy: 0.45,
  chords: 'Bbmaj7 C7 Am7 Dm7 Gm7 C7 Fmaj7 F7',
  parts: {
    kick: ['x.......x.......', 'x.......x.....x.'],
    snap: '....x.......x...',
    shaker: 'o.x.o.x.o.x.o.x.',
    bass: 'R.....R.-.R.5.8.',
    keys: '..x.-.x.-.x.-.x.',
    pad: { p: 'x...............', gain: 0.7 },
    arp: { alts: ['0..2..1.3..2..4.', '0..2..1.3..2..4.', '2..4..3.5..4..6.'] },
  },
};

const island = {
  id: 'island',
  title: 'Sky Island',
  bpm: 104,
  shuffle: 0.3,
  loop: true,
  loopFrom: 1,
  tail: 2,
  voices: {
    kick: { inst: 'softkick', role: 'hit', vol: 1 },
    snap: { inst: 'snap', role: 'hit', vol: 0.55, rev: 0.25, pan: 0.1 },
    clap: { inst: 'clap', role: 'hit', vol: 0.7, rev: 0.25 },
    shaker: { inst: 'shaker', role: 'hit', vol: 0.48, pan: 0.3 },
    hat: { inst: 'hat', role: 'hit', vol: 0.5, pan: -0.25 },
    bass: { inst: 'bass', role: 'bass', base: 34, vol: 0.5 },
    keys: { inst: 'epiano', role: 'chord', lo: 53, hi: 74, size: 4, vol: 0.42, rev: 0.25, pan: -0.15 },
    pad: { inst: 'pad', role: 'chord', lo: 57, hi: 79, size: 4, vol: 0.21, rev: 0.45 },
    arp: { inst: 'marimba', role: 'arp', base: 65, vol: 0.4, rev: 0.2, del: 0.12, pan: 0.25 },
    lead: { inst: 'bell', role: 'melody', vol: 0.8, rev: 0.3, del: 0.16 },
    lead2: { inst: 'flute', role: 'melody', vol: 0.65, rev: 0.35, del: 0.1, pan: -0.1 },
    sparkle: { inst: 'sparkle', role: 'hit', vol: 0.5, rev: 0.5 },
    riser: { inst: 'riser', role: 'fx', vol: 0.14, rev: 0.4 },
  },
  form: ['intro', 'verse', 'chorus', 'groove', 'bridge', 'chorus2', ['groove2', 'groove3'], 'turn'],
  sections: {
    intro: {
      name: 'Intro',
      bars: 4,
      energy: 0.2,
      chords: 'Bbmaj7 C7 Am7 Dm7',
      parts: {
        pad: 'x...............',
        keys: { p: 'x.......x.......', gain: 0.6 },
        arp: { p: ['0...2...4...2...', '1...3...5...3...', '0...2...4...2...', '1.2.3.4.5.4.3.2.'], gain: 1.2 },
        sparkle: ['x...............', _, _, _],
        shaker: [_, _, 'o.x.o.x.o.x.o.x.', 'o.x.o.x.o.x.oxxx'],
        bass: [_, _, 'R...............', 'R.......R...5...'],
        riser: [_, _, _, 'x...............'],
      },
    },
    groove: islandGroove,
    verse: {
      like: 'groove',
      name: 'Verse',
      energy: 0.55,
      parts: {
        arp: null,
        lead: { alts: [{ p: islandVerseA }, { p: islandVerseB, inst: 'pluck', gain: 0.9 }, { p: islandVerseA, inst: 'glock', gain: 0.8 }] },
      },
    },
    chorus: {
      name: 'Chorus',
      bars: 8,
      energy: 0.75,
      chords: 'F C/E Dm7 Bbmaj7 F C/E Bbmaj7 C7sus4,C7',
      parts: {
        kick: ['x.......x.......', 'x.......x...x...'],
        clap: '....x.......x...',
        hat: '..x...x...x...x.',
        shaker: 'o.x.o.x.o.x.o.x.',
        bass: 'R.....R.R...5.8.',
        keys: '..x.-.x.-.x.-.x.',
        pad: 'x...............',
        lead: islandChorus,
        sparkle: ['x...............', ...bars(7, _)],
      },
    },
    groove2: {
      like: 'groove',
      name: 'Marimba',
      chords: 'Bbmaj7 C7 Am7 Dm7 Gm7 Am7 Bbmaj7 C7sus4,C7',
      parts: {
        arp: { p: '0.2.1.3.2.4.3.5.', gain: 1.1 },
        keys: { p: '..x.-.x.-.x.-.x.', gain: 0.7 },
      },
    },
    groove3: {
      like: 'groove2',
      name: 'Whistle',
      parts: {
        arp: { p: '0...2...1...3...', gain: 0.8 },
        lead2: { p: islandWhistle, oct: 12, gain: 0.75 },
      },
    },
    bridge: {
      name: 'Bridge',
      bars: 8,
      energy: 0.4,
      chords: 'Dm7 Am7 Bbmaj7 F/A Gm7 Am7 Bbmaj7 C7sus4,C7',
      parts: {
        kick: 'x...............',
        snap: '........x.......',
        shaker: { p: 'o.x.o.x.o.x.o.x.', gain: 0.8 },
        bass: 'R.......5.......',
        pad: 'x...............',
        keys: { p: 'x...........x...', gain: 0.6 },
        lead2: { alts: [{ p: islandBridge }, { p: islandBridge, inst: 'bell', gain: 0.9 }] },
      },
    },
    chorus2: {
      like: 'chorus',
      name: 'Chorus',
      energy: 0.85,
      parts: {
        lead2: { p: islandChorus, oct: -12, gain: 0.65 },
        arp: { p: '0.1.2.3.4.3.2.1.', gain: 0.55 },
      },
    },
    turn: {
      name: 'Turnaround',
      bars: 4,
      energy: 0.3,
      chords: 'Bbmaj7 C7 Am7,D7 Gm7,C7',
      parts: {
        pad: 'x...............',
        arp: '0.1.2.3.4.3.2.1.',
        bass: ['R...............', 'R...............', 'R.......R.......', 'R.......R.......'],
        kick: [_, _, 'x.......x.......', 'x.......x.x.x.x.'],
        shaker: 'o.x.o.x.o.x.o.x.',
        sparkle: [_, _, _, 'x...............'],
        riser: [_, _, 'x...............', _],
      },
    },
  },
};

// ================================================================ game
// E minor / G major, four on the floor, pumping chords, a hook built on the motif's opening leap.

const gameHook = [
  'B4 E5 G5:3 F#5:1 E5 D5 E5 B4', // Em
  'C5 E5 G5:3 F#5:1 E5 D5 E5:4', // C
  'B4 D5 G5:3 A5:1 B5 A5 G5 D5', // G
  'F#5:6 E5 D5 E5 F#5 A5', // D
  'B4 E5 G5:3 F#5:1 E5 D5 E5 B4',
  'C5 E5 G5:3 F#5:1 E5 D5 E5:4',
  'B4 D5 G5:3 A5:1 B5 C6 B5 A5',
  'A5:4 F#5 D5 E5:4 .:4',
];
const gameCall = [
  'E5:4 G5:4 C6:6 B5:2', // C
  'A5:8 F#5:4 D5:4', // D
  'D5:4 F#5:4 B5:6 A5:2', // Bm
  'G5:8 E5:4 B4:4', // Em
  'E5:4 G5:4 C6:6 D6:2', // C
  'E6:4 D6:4 A5:8', // D
  'B5:4 A5 G5 D5:4 G5:4', // G
  'F#5:12 .:4', // D
];
const gameBridge = [
  'G5 G5 .:2 E5 G5:4 .:4', // C
  'F#5 F#5 .:2 D5 F#5:4 .:4', // D
  'F#5 F#5 .:2 D5 F#5:4 A5:4', // Bm
  'G5:8 .:8', // Em
  'A5 A5 .:2 E5 A5:4 .:4', // Am
  'A5 A5 .:2 F#5 A5:4 .:4', // D
  'B5:4 A5:4 G5:4 F#5:4', // G
  'A5:8 .:8', // D
];

const gameA = {
  name: 'Drop',
  bars: 8,
  energy: 0.85,
  chords: 'Em C G D',
  parts: {
    kick: 'x...x...x...x...',
    clap: '....x.......x...',
    hat: 'xo.oxo.oxo.oxo.o',
    ohat: '..x...x...x...x.',
    crash: ['X...............', ...bars(7, _)],
    bass: '..R...8...R...8.',
    stab: { p: 'x...x...x...x...', a: 0.05, d: 0.12, s: 0.35 },
    lead: { alts: [{ p: gameHook }, { p: gameHook, inst: 'pluck', gain: 1.1 }] },
  },
};

const game = {
  id: 'game',
  title: 'Game On',
  bpm: 128,
  loop: true,
  loopFrom: 1,
  tail: 1.5,
  voices: {
    kick: { inst: 'kick', role: 'hit', vol: 0.82 },
    clap: { inst: 'bigclap', role: 'hit', vol: 0.78, rev: 0.2 },
    snare: { inst: 'snare', role: 'hit', vol: 0.45, rev: 0.15 },
    hat: { inst: 'hat', role: 'hit', vol: 0.35, pan: 0.2 },
    ohat: { inst: 'ohat', role: 'hit', vol: 0.25, pan: -0.15 },
    tom: { inst: 'tom', role: 'hit', freq: 110, vol: 0.4, pan: -0.2 },
    tomhi: { inst: 'tom', role: 'hit', freq: 165, vol: 0.36, pan: 0.2 },
    crash: { inst: 'crash', role: 'hit', vol: 0.3, cue: 'crash' },
    hey: { inst: 'hey', role: 'hit', vol: 0.5, rev: 0.25, cue: 'hey' },
    bass: { inst: 'pluckbass', role: 'bass', base: 31, vol: 0.45 },
    stab: { inst: 'supersaw', role: 'chord', lo: 55, hi: 76, size: 4, vol: 0.42, rev: 0.2 },
    arp: { inst: 'pluck', role: 'arp', base: 64, vol: 0.3, del: 0.2, pan: -0.25 },
    lead: { inst: 'lead', role: 'melody', vol: 0.75, rev: 0.2, del: 0.14 },
    riser: { inst: 'riser', role: 'fx', vol: 0.25 },
  },
  form: ['intro', 'a', 'b', 'build', 'a2', 'd'],
  sections: {
    intro: {
      name: 'Intro',
      bars: 4,
      energy: 0.4,
      chords: 'Em C G D',
      sweep: { lp: [500, 12000] },
      parts: {
        kick: 'x...x...x...x...',
        hat: '..x...x...x...x.',
        bass: { p: '..R...R...R...R.', gain: 0.8 },
        arp: '0.2.4.2.1.3.5.3.',
        snare: [_, _, 'x...x...x...x...', 'x.x.x.x.xxxxXXXX'],
        riser: [_, _, 'x...............', _],
        hey: [_, _, _, '............X...'],
      },
    },
    a: gameA,
    b: {
      name: 'Bounce',
      bars: 8,
      energy: 0.6,
      chords: 'C D Bm Em C D G D',
      parts: {
        kick: 'x.......x.......',
        clap: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        bass: 'R.....R.R...R...',
        arp: { alts: ['0123432101234321', '0.2.4.2.0.2.4.2.'] },
        stab: { p: 'x...............', a: 0.25, d: 0.5, s: 0.7, gain: 0.7 },
        lead: gameCall,
      },
    },
    build: {
      name: 'Build',
      bars: 8,
      energy: 0.7,
      chords: 'Em C G D Em C D D',
      sweep: { hp: [30, 500] },
      parts: {
        kick: [...bars(4, 'x...x...x...x...'), 'x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'xxxxxxxxxxxxxxxx', _],
        snare: [_, _, 'x.......x.......', 'x.......x.......', 'x...x...x...x...', 'x.x.x.x.x.x.x.x.', 'xxxxxxxxxxxxxxxx', 'rrrrrrrrXXXX....'],
        clap: [...bars(4, '....x.......x...'), ...bars(4, _)],
        bass: [...bars(6, 'R...R...R...R...'), 'R.R.R.R.R.R.R.R.', _],
        arp: [...bars(4, '0.1.2.3.4.3.2.1.'), '0123012301230123', '1234123412341234', '2345234523452345', '3456345634563456'],
        riser: hold(8),
        hey: [...bars(7, _), '............X...'],
      },
    },
    a2: {
      like: 'a',
      name: 'Drop',
      energy: 0.95,
      parts: {
        clap: '....x.......x..x',
        hey: ['X...............', _, _, _],
        arp: { p: '0.2.4.2.1.3.5.3.', gain: 0.8 },
        lead: { alts: [{ p: gameHook }, { p: gameHook, inst: 'supersaw', gain: 0.9 }] },
      },
    },
    d: {
      name: 'Hey Hey',
      bars: 8,
      energy: 0.7,
      chords: 'C D Bm Em Am D G D',
      parts: {
        kick: 'x.....x...x.....',
        clap: '....x.......x...',
        tom: '..x.......x..x..',
        tomhi: '.......x.......x',
        hat: 'x.x.x.x.x.x.x.x.',
        bass: 'R.....R.R.....R.',
        stab: { p: '..x-..x-..x-..x-', d: 0.08, s: 0.2 },
        lead: gameBridge,
        hey: ['............x...', '............x...', '............x...', _, '............x...', '............x...', _, '........x...X...'],
        riser: [...bars(6, _), 'x...............', _],
      },
    },
  },
};

// ================================================================ tense
// D minor. Tiptoeing pizzicato, a ticking clock, and a "where are you?" call in the quiet part.

const tenseTheme = [
  'D5 E5 F5 . A5 G#5 A5 .', // Dm
  'D6 . A5 . F5 E5 D5 .', // Dm
  'D5 E5 F5 . Ab5 G5 F5 .', // Bb7
  'E5 . C#5 . E5 . A4:4', // A7
  'D5 E5 F5 . A5 G#5 A5 .', // Dm
  'D6 . A5 . F5 . D5 F5', // Dm
  'Ab5 . F5 . D5 . Bb4 .', // Bb7
  'A4:1 Bb4:1 B4:1 C5:1 C#5 . E5 . A5 .', // A7: tiptoe up
];
const tenseGlock = [
  '.:4 D6:2 .:6 Bb5:2 .:2',
  '.:8 G5:2 .:6',
  '.:4 A5:2 .:6 F5:2 .:2',
  '.:8 D6:2 .:6',
  '.:4 Ab5:2 .:6 F5:2 .:2',
  '.:8 D6:2 .:6',
  '.:4 C#6:2 .:6 E6:2 .:2',
  'A5:1 C#6:1 E6:1 A6:1 .:12',
];

const tense = {
  id: 'tense',
  title: 'Ready Or Not',
  bpm: 108,
  loop: true,
  loopFrom: 1,
  tail: 1.5,
  voices: {
    tick: { inst: 'wood', role: 'hit', freq: 1500, vol: 0.5, pan: 0.35 },
    tock: { inst: 'wood', role: 'hit', freq: 1000, vol: 0.5, pan: -0.35 },
    kick: { inst: 'softkick', role: 'hit', vol: 0.7 },
    heart: { inst: 'heartbeat', role: 'hit', vol: 0.7 },
    shaker: { inst: 'shaker', role: 'hit', vol: 0.45, pan: 0.2 },
    boing: { inst: 'boing', role: 'hit', vol: 0.45, pan: 0.3 },
    bass: { inst: 'pizz', role: 'bass', base: 38, vol: 0.65 },
    pizz: { inst: 'pizz', role: 'melody', vol: 0.85, rev: 0.25 },
    glock: { inst: 'glock', role: 'melody', vol: 0.4, rev: 0.4, del: 0.2, pan: 0.2 },
    strings: { inst: 'strings', role: 'chord', lo: 50, hi: 69, size: 3, vol: 0.24, rev: 0.3 },
    call: { inst: 'flute', role: 'melody', vol: 0.6, rev: 0.4, pan: -0.15 },
  },
  form: ['intro', 'a', 'b', 'a2', 'c'],
  sections: {
    intro: {
      name: 'Intro',
      bars: 2,
      energy: 0.2,
      chords: 'Dm A7',
      parts: {
        tick: 'x.......x.......',
        tock: '....x.......x...',
        bass: 'R-..L-..R-..5-..',
        strings: { p: 'x...............', gain: 0.35 },
      },
    },
    a: {
      name: 'Tiptoe',
      bars: 8,
      energy: 0.5,
      chords: 'Dm Dm Bb7 A7 Dm Dm Bb7 A7',
      parts: {
        tick: 'x.......x.......',
        tock: '....x.......x...',
        shaker: '..o...o...o...o.',
        bass: 'R-..L-..R-..5-..',
        strings: { p: 'x...............', gain: 0.45 },
        pizz: tenseTheme,
      },
    },
    b: {
      name: 'Heartbeat',
      bars: 8,
      energy: 0.45,
      chords: 'Gm Gm Dm Dm Bb7 Bb7 A7 A7',
      parts: {
        tick: { p: 'x.......x.......', gain: 0.6 },
        tock: { p: '....x.......x...', gain: 0.6 },
        heart: 'x.......x.......',
        bass: 'R-......R-......',
        strings: 'x...............',
        glock: tenseGlock,
        pizz: ['.:16', '.:16', '.:16', '.:16', '.:16', '.:16', 'A4 . Bb4 . B4 . C5 .', 'C#5 . D5 . D#5 . E5 .'],
      },
    },
    a2: {
      like: 'a',
      name: 'Tiptoe',
      energy: 0.6,
      parts: {
        kick: 'x.......x.......',
        glock: { alts: [{ p: tenseTheme, oct: 12, gain: 0.5 }, null] },
        call: { alts: [null, { p: tenseTheme, oct: 0, gain: 0.45 }] },
      },
    },
    c: {
      name: 'Where Are You?',
      bars: 8,
      energy: 0.3,
      chords: 'Dm Dm Gm Gm Dm Dm A7 A7',
      parts: {
        tick: { p: 'x.......x.......', gain: 0.7 },
        tock: { p: '....x.......x...', gain: 0.7 },
        bass: 'R-..............',
        strings: { p: 'x...............', gain: 0.6 },
        call: ['.:8 A5:4 F5:4', '.:16', '.:8 Bb5:4 G5:4', '.:16', '.:8 A5:4 F5:4', '.:8 A5:2 A5:2 F5:4', '.:8 E5:4 C#5:4', 'E5:4 .:12'],
        pizz: ['.:16', 'D5 . . F5 . . A5 .', '.:16', 'G5 . . Bb5 . . D6 .', '.:16', '.:16', '.:16', 'A4 . C#5 . E5 . A5 .'],
        boing: [_, '............x...', _, _, _, _, _, '........x.......'],
      },
    },
  },
};

// ================================================================ routine
// The Hit Zero cheer mix. 144 BPM, so an eight-count is 3 1/3 seconds and two bars. 36 eights,
// 120 seconds exactly, then the final pose rings out. Sections follow a real routine.

const routineHook = [
  'A4 D5 F#5 A5:3 F#5:1 A5:2 B5:2 A5:2', // D
  'E5:3 E5:3 C#5:2 E5:4 .:4', // A
  'B4 D5 F#5 B5:3 A5:1 F#5:2 D5:2 F#5:2', // Bm
  'G5:3 G5:3 F#5:2 D5:4 .:4', // G
  'A4 D5 F#5 A5:3 F#5:1 A5:2 B5:2 A5:2', // D
  'C#6:3 C#6:3 B5:2 A5:4 .:2 A5:2', // A
  'B5:3 B5:3 A5:2 F#5:3 D5:3 F#5:2', // Bm
  'G5:3 G5:3 F#5:2 G5:2 A5:6', // G
];
const routineStunts = [
  'D5:4 G5:4 B5:6 A5:2', // G
  'C#6:6 B5:2 A5:8', // A
  'F#5:4 A5:4 C#6:6 B5:2', // F#m
  'B5:8 F#5:4 D5:4', // Bm
  'D5:4 G5:4 B5:6 D6:2', // G
  'E6:6 D6:2 C#6:4 A5:4', // A
  'C#6:6 B5:2 A5:4 F#5:4', // F#m
  'B5:12 .:4', // Bm
  'G5 A5 B5:4 D6:4 B5:4', // G
  'C#6:4 E6:4 C#6:4 A5:4', // A
  'A5:4 C#6:4 F#6:4 E6:4', // F#m
  'D6:8 .:4 B5 C#6', // Bm
];
const routinePyramid = [
  'B4:4 D5:4 G5:8', // G
  'A5:4 G5:4 E5:8', // A
  'F#5:4 A5:4 C#6:8', // F#m
  'B5:8 A5:4 F#5:4', // Bm
  'G5:4 B5:4 D6:8', // G
  'E6:4 D6:4 C#6:4 A5:4', // A
  'D6:16', // D
  'D6:3 .:1 D6:3 .:1 D6:4 .:4', // D: the pyramid hits on 5, 6, 7
];
const routineDance = [
  'E5:2 .:1 E5:1 G5:2 E5:2 A5:2 .:2 G5:2 E5:2', // Em7
  'C#5:2 .:2 E5:2 .:10', // A7 (hey! hey!)
  'E5:2 .:1 E5:1 G5:2 E5:2 B5:2 .:2 A5:2 G5:2', // Em7
  'A5:4 G5:2 E5:2 .:8', // A7
  'E5:2 .:1 E5:1 G5:2 E5:2 A5:2 .:2 G5:2 E5:2', // Em7
  'C#5:2 .:2 E5:2 .:10', // A7
  'D5:2 E5:2 G5:2 A5:2 B5:4 D6:4', // G
  'C#6:4 .:4 E6:4 .:4', // A
];
const routineFinale = [
  ...routineHook.slice(0, 6),
  'B5:4 D6:4 C#6:4 E6:4', // G, A
  'A5:3 .:1 A5:3 .:1 A5:3 .:1 D6:4', // the final pose on 8
];

const routine = {
  id: 'routine',
  title: 'Hit Zero',
  bpm: 144,
  loop: false,
  tail: 3,
  voices: {
    kick: { inst: 'kick', role: 'hit', vol: 0.75 },
    kick808: { inst: 'kick808', role: 'hit', vol: 0.8 },
    clap: { inst: 'bigclap', role: 'hit', vol: 0.72, rev: 0.2 },
    snare: { inst: 'snare', role: 'hit', vol: 0.45, rev: 0.18 },
    hat: { inst: 'hat', role: 'hit', vol: 0.33, pan: 0.2 },
    ohat: { inst: 'ohat', role: 'hit', vol: 0.24, pan: -0.15 },
    tom: { inst: 'tom', role: 'hit', freq: 105, vol: 0.45, pan: -0.2 },
    crash: { inst: 'crash', role: 'hit', vol: 0.3, cue: 'crash' },
    impact: { inst: 'impact', role: 'hit', vol: 0.5, rev: 0.3, cue: 'hit' },
    hey: { inst: 'hey', role: 'hit', vol: 0.62, rev: 0.25, cue: 'hey' },
    whoosh: { inst: 'swoosh', role: 'fx', vol: 0.32, cue: 'whoosh' },
    riser: { inst: 'riser', role: 'fx', vol: 0.25 },
    cheer: { inst: 'cheer', role: 'hit', vol: 0.45, rev: 0.3 },
    sparkle: { inst: 'sparkle', role: 'hit', vol: 0.5, rev: 0.5 },
    bass: { inst: 'pluckbass', role: 'bass', base: 33, vol: 0.38 },
    sub: { inst: 'sub808', role: 'bass', base: 33, vol: 0.45, glide: true },
    stab: { inst: 'supersaw', role: 'chord', lo: 57, hi: 78, size: 4, vol: 0.42, rev: 0.2 },
    pad: { inst: 'pad', role: 'chord', lo: 55, hi: 79, size: 4, vol: 0.2, rev: 0.4 },
    brass: { inst: 'brass', role: 'chord', lo: 55, hi: 76, size: 4, vol: 0.3, rev: 0.25 },
    choir: { inst: 'choir', role: 'chord', lo: 57, hi: 76, size: 4, vol: 0.2, rev: 0.45 },
    arp: { inst: 'pluck', role: 'arp', base: 62, vol: 0.3, del: 0.18, pan: -0.25 },
    riff: { inst: 'pluck', role: 'arp', base: 66, vol: 0.34, del: 0.12, pan: 0.2 },
    lead: { inst: 'lead', role: 'melody', vol: 0.75, rev: 0.2, del: 0.14 },
    bell: { inst: 'glock', role: 'melody', vol: 0.36, rev: 0.3, pan: 0.15 },
  },
  form: ['intro', 'opening', 'standing', 'stunts', 'pyramid', 'jumps', 'running', 'dance', 'finale'],
  sections: {
    intro: {
      name: 'Take the Mat',
      bars: 4,
      energy: 0.3,
      chords: 'Bm G D A',
      sweep: { lp: [700, 16000] },
      parts: {
        pad: 'x...............',
        riser: hold(4),
        cheer: ['x...............', _, _, _],
        arp: ['0...1...2...3...', '4...3...2...1...', '0.1.2.3.4.5.6.7.', _],
        kick: [_, _, 'x...x...x...x...', _],
        clap: [_, _, _, 'X...X...X...X...'],
        snare: [_, _, _, '........x.x.xxxx'],
        hey: [_, _, _, '............X...'],
      },
    },
    opening: {
      name: 'Opening',
      bars: 8,
      energy: 0.85,
      chords: 'D A Bm G',
      parts: {
        impact: ['X...............', ...bars(7, _)],
        crash: ['X...............', ...bars(7, _)],
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: 'xo.oxo.oxo.oxo.o',
        ohat: '..x...x...x...x.',
        bass: '..R...8...R...8.',
        stab: { p: 'x...x...x...x...', a: 0.04, d: 0.12, s: 0.35 },
        lead: routineHook,
        hey: ['X...............', _, _, _],
      },
    },
    standing: {
      name: 'Standing Tumbling',
      bars: 8,
      energy: 0.8,
      chords: 'Bm G D A',
      parts: {
        kick808: 'x.........x.....',
        clap: '........X.......',
        snare: { p: '........x.......', gain: 0.6 },
        hat: ['x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.xxxx'],
        sub: 'R.........8.....',
        impact: ['X...............', _],
        whoosh: [_, '........x.......'],
        brass: { p: ['X..x..x.........', _], d: 0.12, s: 0.4 },
        riff: '0..3..2.0..3..2.',
        hey: [_, _, _, '............X...'],
      },
    },
    stunts: {
      name: 'Stunts',
      bars: 12,
      energy: 0.75,
      chords: 'G A F#m Bm',
      parts: {
        crash: ['X...............', ...bars(11, _)],
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: 'xoxoxoxoxoxoxoxo',
        ohat: '..x...x...x...x.',
        bass: 'R..R..R.R..R..R.',
        arp: '0123456701234567',
        pad: 'x...............',
        lead: routineStunts,
        hey: [_, '............X...', _, _, _, '............X...'],
        riser: [...bars(10, _), 'x...............', _],
      },
    },
    pyramid: {
      name: 'Pyramid',
      bars: 8,
      energy: 0.9,
      chords: 'G A F#m Bm G A D D',
      parts: {
        crash: ['X...............', ...bars(7, _)],
        impact: ['X...............', ...bars(7, _)],
        kick: [...bars(7, 'x.......x.......'), 'X...X...X.......'],
        snare: [...bars(6, '........X.......'), 'x.x.x.x.x.x.x.x.', 'rrrrrrrrrrrr....'],
        tom: [...bars(6, 'x.....x...x.....'), _, _],
        brass: [...bars(7, 'x...............'), 'X..-X..-X..-....'],
        choir: [...bars(7, 'x...............'), _],
        bass: [...bars(7, 'R.......R.......'), 'R..-R..-R..-....'],
        lead: { p: routinePyramid, inst: 'brass', gain: 1.1 },
        riser: [...bars(6, _), 'x...............', _],
      },
    },
    jumps: {
      name: 'Jumps',
      bars: 8,
      energy: 0.85,
      chords: 'D A Bm G',
      parts: {
        crash: ['X...............', _],
        cheer: ['x...............', ...bars(7, _)],
        kick: 'X.......X.......',
        stab: { p: 'X..-....X..-....', d: 0.1, s: 0.3 },
        clap: '....x.......x...',
        hat: 'o.o.o.o.o.o.o.o.',
        bass: 'R..-....R..-....',
        whoosh: '....x...-...x...',
        bell: ['A5:2 .:6 D6:2 .:6', 'C#6:2 .:6 E6:2 .:6', 'B5:2 .:6 F#6:2 .:6', 'B5:2 .:6 D6:2 .:6'],
        hey: [_, _, _, '............X...'],
      },
    },
    running: {
      name: 'Running Tumbling',
      bars: 8,
      energy: 0.95,
      chords: 'Bm G D A',
      parts: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        clap: '....x.......x...',
        hat: 'xoxoxoxoxoxoxoxo',
        ohat: '..x...x...x...x.',
        bass: 'R.RRR.RRR.RRR.RR',
        stab: { p: '..x-..x-..x-..x-', d: 0.08, s: 0.3 },
        riff: '0121012101210123',
        impact: [_, _, 'X...............', _],
        whoosh: [_, '........x.......', _, _],
        riser: [...bars(6, _), 'x...............', _],
        hey: [...bars(7, _), '............X...'],
      },
    },
    dance: {
      name: 'Dance',
      bars: 8,
      energy: 0.8,
      chords: 'Em7 A7 Em7 A7 Em7 A7 G A',
      parts: {
        crash: ['X...............', ...bars(7, _)],
        kick: 'x...x...x...x...',
        snare: '...x..x....x..x.',
        clap: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        sub: 'R.....R.R.....R.',
        stab: { p: '..x-..x-..x-..x-', d: 0.06, s: 0.25 },
        lead: routineDance,
        hey: [_, '........x...x...'],
      },
    },
    finale: {
      name: 'Finale',
      bars: 8,
      energy: 1,
      tr: 2,
      chords: 'D A Bm G D A G,A D',
      parts: {
        impact: ['X...............', ...bars(6, _), '............X...'],
        crash: ['X...............', _, _, _, 'X...............', _, _, '............X...'],
        kick: [...bars(7, 'x...x...x...x...'), 'X...X...X...X...'],
        clap: [...bars(6, '....x.......x...'), '....x...x.x.xxxx', 'X...X...X...X...'],
        snare: [...bars(6, _), 'x.x.x.x.xxxxrrrr', _],
        hat: [...bars(7, 'xo.oxo.oxo.oxo.o'), _],
        ohat: [...bars(7, '..x...x...x...x.'), _],
        bass: [...bars(7, '..R...8...R...8.'), 'R-..R-..R-..R...'],
        stab: { p: [...bars(7, 'x...x...x...x...'), 'X-..X-..X-..X...'], a: 0.03, d: 0.15, s: 0.45 },
        brass: [...bars(7, 'x...............'), 'X-..X-..X-..X...'],
        choir: 'x...............',
        lead: routineFinale,
        hey: ['X...............', _, _, _, 'X...............', _, _, '............X...'],
        cheer: [...bars(7, _), '............X...'],
        sparkle: [...bars(7, _), '............x...'],
      },
    },
  },
};

// ================================================================ birthday
// A fanfare, then "Happy Birthday to You" in its own 3/4 so everybody can sing along: first a
// music box waltz in C, then a step up to D with the whole band, claps on "pah pah", a "hey!"
// after each "to you" and "cha cha cha" at the end, then a big finish on the Cloud Nine motif.

const happyBirthday = [
  'A4:4 G4:4 C5:4', // birth-day to
  'B4:8 G4:3 G4:1', // you, hap-py
  'A4:4 G4:4 D5:4', // birth-day to
  'C5:8 G4:3 G4:1', // you, hap-py
  'G5:4 E5:4 C5:4', // birth-day dear
  'B4:4 A4:4 F5:3 F5:1', // Bai-ley, hap-py
  'E5:4 C5:4 D5:4', // birth-day to
];
const verse1Melody = [...happyBirthday, 'C5:8 A4:3 A4:1']; // you, and a pickup into the new key
const verse2Melody = [...happyBirthday, 'C5:12'];
const birthdayChords = 'C G7 G7 C C7 F C/G,C/G,G7 C';

const birthday = {
  id: 'birthday',
  title: 'Happy Birthday',
  bpm: 112,
  loop: false,
  tail: 3,
  voices: {
    brass: { inst: 'brass', role: 'melody', vol: 0.55, rev: 0.3 },
    horns: { inst: 'brass', role: 'chord', lo: 52, hi: 72, size: 4, vol: 0.3, rev: 0.3 },
    timp: { inst: 'tom', role: 'hit', freq: 82, vol: 0.5, rev: 0.3 },
    snare: { inst: 'snare', role: 'hit', vol: 0.4, rev: 0.25 },
    crash: { inst: 'crash', role: 'hit', vol: 0.32, cue: 'crash' },
    box: { inst: 'musicbox', role: 'melody', vol: 0.85, rev: 0.35, del: 0.08 },
    glock: { inst: 'glock', role: 'melody', vol: 0.45, rev: 0.4, pan: 0.2 },
    pad: { inst: 'pad', role: 'chord', lo: 55, hi: 76, size: 4, vol: 0.3, rev: 0.45 },
    choir: { inst: 'choir', role: 'chord', lo: 57, hi: 76, size: 3, vol: 0.22, rev: 0.45 },
    oom: { inst: 'bass', role: 'bass', base: 36, vol: 0.46 },
    pah: { inst: 'epiano', role: 'chord', lo: 55, hi: 74, size: 3, vol: 0.44, pan: -0.1 },
    kick: { inst: 'kick', role: 'hit', vol: 0.75 },
    clap: { inst: 'bigclap', role: 'hit', vol: 0.72, rev: 0.25 },
    hat: { inst: 'hat', role: 'hit', vol: 0.33 },
    shaker: { inst: 'shaker', role: 'hit', vol: 0.5, pan: 0.25 },
    hey: { inst: 'hey', role: 'hit', vol: 0.62, rev: 0.25, cue: 'hey' },
    lead: { inst: 'lead', role: 'melody', vol: 0.72, rev: 0.25, del: 0.1 },
    sparkle: { inst: 'sparkle', role: 'hit', vol: 0.45, rev: 0.5 },
    cheer: { inst: 'cheer', role: 'hit', vol: 0.45, rev: 0.3 },
    riser: { inst: 'riser', role: 'fx', vol: 0.2 },
    bass: { inst: 'pluckbass', role: 'bass', base: 36, vol: 0.36 },
  },
  form: ['fanfare', 'verse1', 'verse2', 'ending'],
  sections: {
    fanfare: {
      name: 'Fanfare',
      bars: 4,
      energy: 0.8,
      chords: 'C F C G',
      parts: {
        brass: ['G4:1 G4:1 G4:2 C5:6 E5:2 G5:4', 'A5:6 G5:2 F5:4 A5:4', 'G5:6 E5:2 C5:4 E5:4', 'D5:2 G5:2 B5:2 D6:6 .:4'],
        horns: ['x...............', 'x...............', 'x...............', 'x...........-...'],
        timp: ['x.......x.......', 'x.......x.......', 'x.......x.......', 'x...x...x.......'],
        snare: [_, _, _, 'rrrrrrrrrrrr....'],
        crash: ['X...............', _, _, _],
        sparkle: ['x...............', _, _, _],
        box: ['.:16', '.:16', '.:16', '.:12 G4:3 G4:1'], // "Hap-py"
      },
    },
    verse1: {
      name: 'Music Box',
      bars: 8,
      meter: 3,
      energy: 0.35,
      chords: birthdayChords,
      parts: {
        box: verse1Melody,
        oom: 'R...........',
        pah: '....x...x...',
        pad: { p: 'x...........', gain: 0.7 },
        shaker: '..o...o...o.',
        glock: ['.:12', '.:2 B5:2 D6:2 G6:2 .:4', '.:12', '.:2 E6:2 G6:2 C7:2 .:4', '.:12', '.:12', '.:12', '.:2 C6:2 E6:2 G6:2 .:4'],
        sparkle: ['x...........', ...bars(7, _3)],
        snare: [...bars(7, _3), '......x.xxrr'],
        riser: [...bars(7, _3), 'x...........'],
      },
    },
    verse2: {
      name: 'Everybody!',
      bars: 8,
      meter: 3,
      tr: 2,
      energy: 0.9,
      chords: birthdayChords,
      parts: {
        lead: verse2Melody,
        box: { p: verse2Melody, oct: 12, gain: 0.35 },
        kick: 'x...........',
        clap: [...bars(7, '....x...x...'), 'X...X.X.X...'],
        hat: 'x.x.x.x.x.x.',
        bass: 'R.......5...',
        horns: { p: '....x-..x-..', d: 0.1, s: 0.4 },
        crash: ['X...........', _3, _3, _3, 'X...........', _3, _3, _3],
        hey: [_3, '....X.......', _3, '....X.......', _3, _3, _3, _3],
        choir: [...bars(4, _3), ...bars(4, 'x...........')],
        sparkle: [...bars(5, _3), 'x...........', _3, _3],
      },
    },
    ending: {
      name: 'Big Finish',
      bars: 3,
      tr: 2,
      energy: 1,
      chords: 'F G C',
      parts: {
        brass: ['C5 F5 A5:4 G5 F5 G5 A5', 'B5:4 D6:4 G5 A5 B5 D6', 'C6:16'],
        horns: ['x...............', 'x.......x.......', 'X...............'],
        choir: 'x...............',
        timp: ['x.......x.......', 'x...x...x.x.x.x.', 'X...............'],
        snare: [_, 'x.x.x.x.rrrrrrrr', _],
        kick: ['x...x...x...x...', 'x...x...x...x...', 'X...............'],
        clap: ['....x.......x...', '....x.......x...', _],
        bass: ['R.......R.......', 'R.......R.......', 'R...............'],
        crash: [_, _, 'X...............'],
        cheer: [_, _, 'X...............'],
        sparkle: [_, _, 'x...............'],
        hey: [_, _, 'X...............'],
      },
    },
  },
};

// ================================================================ victory
// Five seconds: a run up, a hit, a flat-six flat-seven lift, and the big chord with a cheer.

const victory = {
  id: 'victory',
  title: 'Victory',
  bpm: 160,
  loop: false,
  tail: 1.2,
  voices: {
    brass: { inst: 'brass', role: 'melody', vol: 0.62, rev: 0.3 },
    horns: { inst: 'brass', role: 'chord', lo: 55, hi: 74, size: 4, vol: 0.32, rev: 0.3 },
    stab: { inst: 'supersaw', role: 'chord', lo: 55, hi: 76, size: 4, vol: 0.32, rev: 0.25 },
    choir: { inst: 'choir', role: 'chord', lo: 57, hi: 76, size: 4, vol: 0.24, rev: 0.45 },
    kick: { inst: 'kick', role: 'hit', vol: 0.9 },
    snare: { inst: 'snare', role: 'hit', vol: 0.4, rev: 0.25 },
    tom: { inst: 'tom', role: 'hit', freq: 120, vol: 0.4 },
    crash: { inst: 'crash', role: 'hit', vol: 0.28 },
    impact: { inst: 'impact', role: 'hit', vol: 0.45, rev: 0.3 },
    hey: { inst: 'hey', role: 'hit', vol: 0.5, rev: 0.25 },
    cheer: { inst: 'cheer', role: 'hit', vol: 0.42, rev: 0.3 },
    sparkle: { inst: 'sparkle', role: 'hit', vol: 0.45, rev: 0.5 },
    bass: { inst: 'pluckbass', role: 'bass', base: 33, vol: 0.38 },
  },
  form: ['sting'],
  sections: {
    sting: {
      name: 'Victory',
      bars: 3,
      energy: 1,
      chords: 'C Ab,Bb C',
      parts: {
        brass: ['G4:1 A4:1 B4:1 C5:1 D5:1 E5:1 F5:1 G5:1 C6:4 .:2 G5:1 C6:1', 'Ab5 C6 Eb6:4 Bb5 D6 F6:4', 'E6:16'],
        stab: ['........X..-....', 'X.......X.......', 'X...............'],
        horns: ['........x.......', 'x.......x.......', 'x...............'],
        choir: [_, _, 'x...............'],
        bass: ['........R.......', 'R.......R.......', 'R...............'],
        snare: ['xxxxxxxx........', 'x.......x.......', _],
        tom: [_, '............xxxx', _],
        kick: ['........X.......', 'X.......X.......', 'X...............'],
        crash: ['........X.......', _, 'X...............'],
        impact: [_, _, 'X...............'],
        hey: ['........X.......', _, 'X...............'],
        cheer: [_, _, 'X...............'],
        sparkle: ['........x.......', _, 'x...............'],
      },
    },
  },
};

export const SONGS = { island, game, tense, routine, birthday, victory };
export const TRACK_IDS = Object.keys(SONGS);
