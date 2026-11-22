// Music theory for Cloud Nine's synthesized soundtrack: note names, chords, voicings and the small
// pattern languages the songs in songs.js are written in. Pure: no WebAudio, no DOM, runs under node.
//
//   noteToMidi('A4') -> 69     noteToMidi('Bb3') -> 58     midiToFreq(69) -> 440     midiToName(70) -> 'A#4'
//   parseChord('Fmaj7/A', tr = 0) -> { symbol, root, bass, intervals, pcs }    root/bass/pcs are pitch classes 0-11
//   parseChords('F C/E Dm7 Gm7,C7', bars, stepsPerBar, tr) -> [{ step, len, chord }]   one token a bar; commas split it
//   voiceChord(chord, { lo, hi, size, prev }) -> ascending MIDI notes in [lo, hi], moving as little as possible from prev
//   chordTones(chord, from, count) -> ascending MIDI chord tones at or above `from` (arpeggios)
//   bassNote(chord, sym, base) -> MIDI note for a bass symbol: R (bass note) r (root) 3 5 7 8 (octave) L (fifth below)
//
// Pattern languages. One character is one 16th-note step; spaces and | are ignored:
//   parseHits('x...X...o...r...')  drums: . nothing, o soft, x normal, X accent, r roll (two 32nds)
//   parseHold('R.....R.-.R.5.8.')  bass, chords, arps, fx: any other character starts a note, . holds it, - stops it
// Melodies are tokens: NOTE[:steps][!?~]  (C5:4 is a quarter note; the default length is an 8th)
//   . or .:N rest     _:N tie (lengthens the previous note)     ! accent  ? soft  ~ glide from the previous note
//   | checks that a bar line falls where it should, so a miscounted bar fails loudly instead of drifting.
//   parseMelody('C5 F5 A5:4 G5 F5 G5 A5 |', { len: 2, stepsPerBar: 16 }) -> { steps, notes: [{ step, len, midi, vel, glide }] }

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const VEL = { o: 0.5, x: 0.8, X: 1 };

export function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(String(name).trim());
  if (!m) throw new Error('bad note name "' + name + '"');
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (parseInt(m[3], 10) + 1) + LETTER[m[1]] + acc;
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function freqToMidi(f) {
  return 69 + 12 * Math.log2(f / 440);
}

export function midiToName(m) {
  const r = Math.round(m);
  return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

const pcOf = (m) => ((m % 12) + 12) % 12;

// ---------------------------------------------------------------- chords

const QUALITIES = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  '5': [0, 7],
};

export function parseChord(symbol, tr = 0) {
  const m = /^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/.exec(String(symbol).trim());
  if (!m || !(m[3] in QUALITIES)) throw new Error('bad chord "' + symbol + '"');
  const acc = (a) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
  const root = pcOf(LETTER[m[1]] + acc(m[2]) + tr);
  const bass = m[4] ? pcOf(LETTER[m[4]] + acc(m[5]) + tr) : root;
  const intervals = QUALITIES[m[3]].slice();
  const pcs = [];
  for (const i of intervals) {
    const pc = pcOf(root + i);
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return { symbol, root, bass, intervals, pcs };
}

// A chord string has one token per bar (cycled if there are fewer tokens than bars). A token with
// commas splits its bar into equal parts: 'Gm7,C7' is two beats each in 4/4. '%' repeats the
// previous chord and 'N' means no chord (bass and chord parts rest).
export function parseChords(str, bars, stepsPerBar = 16, tr = 0) {
  const tokens = String(str || 'N').split(/[\s|]+/).filter(Boolean);
  const out = [];
  let prev = null;
  for (let b = 0; b < bars; b++) {
    const parts = tokens[b % tokens.length].split(',');
    if (stepsPerBar % parts.length) throw new Error('cannot split a bar of ' + stepsPerBar + ' steps into ' + parts.length);
    const len = stepsPerBar / parts.length;
    parts.forEach((p, k) => {
      const chord = p === '%' ? prev : p === 'N' ? null : parseChord(p, tr);
      prev = chord;
      out.push({ step: b * stepsPerBar + k * len, len, chord });
    });
  }
  return out;
}

// Pick an inversion of the chord inside [lo, hi] that moves the least from the previous voicing
// (smooth voice leading), or sits nearest the middle of the range when there is none.
export function voiceChord(chord, { lo = 52, hi = 76, size = 4, prev = null } = {}) {
  let pcs = chord.pcs.slice();
  const fifth = pcOf(chord.root + 7);
  while (pcs.length > size) {
    const k = pcs.indexOf(fifth);
    pcs.splice(k > 0 ? k : pcs.length - 1, 1); // the fifth goes first, then the top extension
  }
  const cands = [];
  for (let r = 0; r < pcs.length; r++) {
    const order = pcs.slice(r).concat(pcs.slice(0, r));
    for (let base = lo; base < lo + 12; base++) {
      if (pcOf(base) !== order[0]) continue;
      const v = [base];
      for (let j = 1; j < order.length; j++) {
        let m = v[j - 1] + 1;
        while (pcOf(m) !== order[j]) m++;
        v.push(m);
      }
      while (v.length < size) v.push(v[v.length - pcs.length] + 12);
      if (v[v.length - 1] <= hi) cands.push(v);
    }
  }
  if (!cands.length) {
    // the range is too narrow for this chord: stack it from the bottom and accept the overshoot
    const v = [];
    let m = lo;
    for (const pc of pcs) {
      while (pcOf(m) !== pc) m++;
      v.push(m);
    }
    return v.sort((a, b) => a - b);
  }
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const centre = (lo + hi) / 2;
  let best = null;
  let bestScore = Infinity;
  for (const v of cands) {
    let score;
    if (prev && prev.length) {
      const n = Math.min(v.length, prev.length);
      score = 0;
      for (let i = 0; i < n; i++) score += Math.abs(v[i] - prev[i]);
      score += Math.abs(mean(v) - mean(prev)) * 0.5 + Math.abs(mean(v) - centre) * 0.15;
    } else {
      score = Math.abs(mean(v) - centre);
    }
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

export function chordTones(chord, from, count = 12) {
  const out = [];
  for (let m = from; out.length < count && m < from + 96; m++) if (chord.pcs.includes(pcOf(m))) out.push(m);
  return out;
}

export function bassNote(chord, sym, base = 36) {
  const place = (pc) => base + pcOf(pc - base);
  const root = place(chord.root);
  const has = (i) => chord.intervals.includes(i);
  switch (sym) {
    case 'R': return place(chord.bass);
    case 'r': return root;
    case '8': return place(chord.bass) + 12;
    case '5': return root + (has(6) ? 6 : has(8) ? 8 : 7);
    case 'L': return root - (has(6) ? 6 : 5);
    case '3': return root + (has(4) ? 4 : has(3) ? 3 : has(5) ? 5 : 2);
    case '7': return root + (has(10) ? 10 : has(11) ? 11 : has(9) ? 9 : 12);
    case '2': return root + 2;
    case '6': return root + 9;
    default: throw new Error('bad bass symbol "' + sym + '"');
  }
}

// ---------------------------------------------------------------- pattern languages

const clean = (s) => (Array.isArray(s) ? s.join('') : String(s)).replace(/[\s|]+/g, '');

export function parseHits(str) {
  const s = clean(str);
  const hits = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '.') continue;
    if (c === 'r') hits.push({ step: i, vel: 0.62, roll: true });
    else if (c in VEL) hits.push({ step: i, vel: VEL[c], roll: false });
    else throw new Error('bad hit "' + c + '" in "' + s + '"');
  }
  return { steps: s.length, hits };
}

export function parseHold(str) {
  const s = clean(str);
  const notes = [];
  let open = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '.') {
      if (open) open.len++;
    } else if (c === '-') {
      open = null;
    } else {
      open = { step: i, len: 1, sym: c };
      notes.push(open);
    }
  }
  return { steps: s.length, notes };
}

export function parseMelody(str, { len = 2, stepsPerBar = 16 } = {}) {
  const text = Array.isArray(str) ? str.join(' | ') + ' |' : String(str);
  const notes = [];
  let step = 0;
  let bar = 1;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if (tok === '|') {
      if (step % stepsPerBar !== 0) {
        throw new Error('bar ' + bar + ' of "' + text.slice(0, 40) + '..." has ' + (step % stepsPerBar) + ' extra steps');
      }
      bar = step / stepsPerBar + 1;
      continue;
    }
    const rest = /^\.(?::(\d+))?$/.exec(tok);
    if (rest) {
      step += rest[1] ? parseInt(rest[1], 10) : len;
      continue;
    }
    const tie = /^_(?::(\d+))?$/.exec(tok);
    if (tie) {
      const n = tie[1] ? parseInt(tie[1], 10) : len;
      if (notes.length) notes[notes.length - 1].len += n;
      step += n;
      continue;
    }
    const m = /^([A-G](?:#|b)?-?\d)(?::(\d+))?([!?~]*)$/.exec(tok);
    if (!m) throw new Error('bad melody token "' + tok + '"');
    const n = m[2] ? parseInt(m[2], 10) : len;
    if (!(n > 0)) throw new Error('bad length in "' + tok + '"');
    const flags = m[3] || '';
    notes.push({
      step,
      len: n,
      midi: noteToMidi(m[1]),
      vel: flags.includes('!') ? 1 : flags.includes('?') ? 0.5 : 0.8,
      glide: flags.includes('~'),
    });
    step += n;
  }
  return { steps: step, notes };
}
