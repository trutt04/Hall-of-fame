// Music theory and the pattern languages the songs are written in (js/audio/theory.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bassNote, chordTones, midiToFreq, midiToName, noteToMidi, parseChord, parseChords, parseHits, parseHold, parseMelody, voiceChord,
} from '../js/audio/theory.js';

test('note names map to MIDI numbers and back', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('Bb3'), 58);
  assert.equal(noteToMidi('F#5'), 78);
  assert.equal(noteToMidi('C-1'), 0);
  assert.equal(midiToName(70), 'A#4');
  assert.equal(midiToName(noteToMidi('G#2')), 'G#2');
  assert.throws(() => noteToMidi('H2'));
  assert.throws(() => noteToMidi('C'));
});

test('MIDI numbers map to equal-tempered frequencies', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(60) - 261.6256) < 1e-3);
  assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});

test('chord symbols parse into pitch classes, with slash basses and transposition', () => {
  const c = parseChord('Cmaj7');
  assert.deepEqual(c.pcs, [0, 4, 7, 11]);
  assert.equal(c.root, 0);
  assert.equal(c.bass, 0);
  const fa = parseChord('F/A');
  assert.equal(fa.root, 5);
  assert.equal(fa.bass, 9);
  assert.deepEqual(parseChord('Dm7').pcs, [2, 5, 9, 0]);
  assert.deepEqual(parseChord('Bb7').pcs, [10, 2, 5, 8]);
  assert.deepEqual(parseChord('C7sus4').pcs, [0, 5, 7, 10]);
  assert.equal(parseChord('C', 2).root, 2); // up a whole step: D
  assert.equal(parseChord('C/G', 2).bass, 9);
  assert.throws(() => parseChord('Cfoo'));
});

test('a chord line gives one chord a bar, commas split bars, % repeats and N rests', () => {
  const line = parseChords('F C/E Gm7,C7 %', 4, 16);
  assert.deepEqual(line.map((c) => [c.step, c.len]), [[0, 16], [16, 16], [32, 8], [40, 8], [48, 16]]);
  assert.equal(line[4].chord.symbol, 'C7');
  assert.equal(parseChords('C N', 2, 16)[1].chord, null);
  const waltz = parseChords('C/G,C/G,G7', 1, 12);
  assert.deepEqual(waltz.map((c) => [c.step, c.len]), [[0, 4], [4, 4], [8, 4]]);
  // short lines cycle
  assert.equal(parseChords('Am F', 4, 16)[2].chord.symbol, 'Am');
});

test('voicings stay in range and move smoothly from chord to chord', () => {
  let prev = null;
  let total = 0;
  for (const sym of ['F', 'C/E', 'Dm7', 'Bbmaj7', 'F', 'C7']) {
    const v = voiceChord(parseChord(sym), { lo: 53, hi: 74, size: 4, prev });
    assert.equal(v.length, 4);
    for (const m of v) assert.ok(m >= 53 && m <= 74, sym + ' ' + v);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1]);
    const pcs = parseChord(sym).pcs;
    for (const m of v) assert.ok(pcs.includes(m % 12), sym + ' has a stray note');
    if (prev) total += v.reduce((s, m, i) => s + Math.abs(m - prev[i]), 0);
    prev = v;
  }
  // smooth voice leading: on average each voice moves about two semitones, not leaps
  assert.ok(total / 5 / 4 < 3, 'voices jump around: ' + total);
});

test('five-note chords drop the fifth first', () => {
  const v = voiceChord(parseChord('Cmaj9'), { lo: 48, hi: 84, size: 4 });
  assert.ok(!v.some((m) => m % 12 === 7), 'the fifth should go: ' + v);
});

test('chord tones climb from a base note for arpeggios', () => {
  assert.deepEqual(chordTones(parseChord('C'), 60, 5), [60, 64, 67, 72, 76]);
  assert.deepEqual(chordTones(parseChord('Am'), 62, 3), [64, 69, 72]);
});

test('bass symbols pick the right notes in the bass range', () => {
  const c = parseChord('C/E');
  assert.equal(bassNote(c, 'R', 34), 40); // E2: the slash bass
  assert.equal(bassNote(c, 'r', 34), 36); // C2
  assert.equal(bassNote(c, '5', 34), 43); // G2
  assert.equal(bassNote(c, '8', 34), 52); // E3
  assert.equal(bassNote(parseChord('Dm'), '3', 34), 41); // F2
  assert.equal(bassNote(parseChord('Bb7'), '7', 34), 34 + 10);
  assert.equal(bassNote(parseChord('A'), 'L', 33), 28); // E1, the fifth below
  assert.throws(() => bassNote(c, 'Q', 34));
});

test('drum patterns: velocities, rolls, spaces and bar lines ignored', () => {
  const { steps, hits } = parseHits('x.o. X.r. | ....');
  assert.equal(steps, 12);
  assert.deepEqual(hits.map((h) => [h.step, h.vel, h.roll]), [[0, 0.8, false], [2, 0.5, false], [4, 1, false], [6, 0.62, true]]);
  assert.equal(parseHits(['x...', '..x.']).hits[1].step, 6);
  assert.throws(() => parseHits('x?..'));
});

test('hold patterns: dots sustain, dashes stop', () => {
  const { steps, notes } = parseHold('R.....R.-.R.5.8.');
  assert.equal(steps, 16);
  assert.deepEqual(notes.map((n) => [n.step, n.len, n.sym]), [[0, 6, 'R'], [6, 2, 'R'], [10, 2, 'R'], [12, 2, '5'], [14, 2, '8']]);
  assert.deepEqual(parseHold('..x.....').notes.map((n) => [n.step, n.len]), [[2, 6]]);
});

test('melodies: lengths, rests, ties, accents, glides', () => {
  const { steps, notes } = parseMelody('C5 F5 A5:4 _:2 . G5! E5? D5:4~', { len: 2 });
  assert.equal(steps, 2 + 2 + 4 + 2 + 2 + 2 + 2 + 4);
  assert.deepEqual(notes.map((n) => [n.step, n.len, n.midi]), [[0, 2, 72], [2, 2, 77], [4, 6, 81], [12, 2, 79], [14, 2, 76], [16, 4, 74]]);
  assert.equal(notes[3].vel, 1);
  assert.equal(notes[4].vel, 0.5);
  assert.equal(notes[5].glide, true);
});

test('bar lines catch a miscounted bar', () => {
  assert.doesNotThrow(() => parseMelody(['C5:16', 'D5:8 E5:8']));
  assert.throws(() => parseMelody(['C5:14', 'D5:16']), /bar 1/);
  assert.throws(() => parseMelody('C5:4 | D5', { stepsPerBar: 16 }));
  // waltz bars are 12 steps
  assert.doesNotThrow(() => parseMelody(['A4:4 G4:4 C5:4', 'B4:8 G4:3 G4:1'], { stepsPerBar: 12 }));
  assert.throws(() => parseMelody('X5'));
});
