// The step sequencer and the song structure it publishes (js/audio/sequencer.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileSection, createSequence, songStructure } from '../js/audio/sequencer.js';
import { SONGS } from '../js/audio/songs.js';

// a tiny song exercising every role
const mini = {
  id: 'mini',
  bpm: 120,
  loop: true,
  loopFrom: 1,
  voices: {
    kick: { inst: 'kick', role: 'hit' },
    hey: { inst: 'hey', role: 'hit', cue: 'hey' },
    bass: { inst: 'bass', role: 'bass', base: 36 },
    keys: { inst: 'epiano', role: 'chord', lo: 55, hi: 72, size: 3 },
    arp: { inst: 'pluck', role: 'arp', base: 60 },
    lead: { inst: 'bell', role: 'melody' },
    riser: { inst: 'riser', role: 'fx' },
  },
  form: ['intro', ['a', 'b']],
  sections: {
    intro: { bars: 1, chords: 'C', parts: { kick: 'x...x...x...x...', riser: 'x...............' } },
    a: {
      bars: 2,
      chords: 'C F,G',
      parts: {
        kick: 'x...x...x...x...',
        hey: ['................', '............X...'],
        bass: 'R...............',
        keys: 'x...............',
        arp: '0.1.2.3.4.3.2.1.',
        lead: { alts: [['C5:16', 'A5:8 B5:8'], null] },
      },
    },
    b: { like: 'a', parts: { lead: ['E5:16', 'D5:16'], arp: null } },
  },
};

function walk(song, steps, seed = 1) {
  const seq = createSequence(song, { seed });
  const out = [];
  for (let i = 0; i < steps; i++) {
    const s = seq.next();
    if (!s) break;
    out.push(s);
  }
  return { seq, out };
}

test('steps are 16th notes on an even grid, and beats count 1 to 8', () => {
  const { seq, out } = walk(mini, 64);
  assert.equal(seq.stepDur, 0.125);
  out.forEach((s, i) => {
    assert.equal(s.i, i);
    assert.ok(Math.abs(s.t - i * 0.125) < 1e-9);
    if (i % 4 === 0) {
      assert.deepEqual(s.beat, { n: i / 4, count: ((i / 4) % 8) + 1, eight: Math.floor(i / 32) });
    } else {
      assert.equal(s.beat, null);
    }
  });
});

test('the form plays the intro once, then loops, alternating sections by pass', () => {
  const { out } = walk(mini, 16 + 32 * 4);
  const starts = out.filter((s) => s.sectionStart).map((s) => s.section + s.pass);
  assert.deepEqual(starts, ['intro0', 'a0', 'b1', 'a2', 'b3']);
  // the grid never hiccups across the loop
  for (let i = 1; i < out.length; i++) assert.ok(Math.abs(out[i].t - out[i - 1].t - 0.125) < 1e-9);
});

test('bass and pads follow chord changes inside a held note', () => {
  const sec = compileSection(mini, 'a', 0);
  const bass = sec.byStep.flatMap((evs, step) => evs.filter((e) => e.part === 'bass').map((e) => [step, e.len, e.midi]));
  // bar 1: C held a bar; bar 2: F for two beats, then G
  assert.deepEqual(bass, [[0, 16, 36], [16, 8, 41], [24, 8, 43]]);
  const keys = sec.byStep.flatMap((evs) => evs.filter((e) => e.part === 'keys'));
  assert.equal(keys.length, 3);
  assert.ok(keys.every((k) => k.notes.length === 3));
});

test('alternatives pick by pass, and null rests', () => {
  const lead = (pass) => compileSection(mini, 'a', pass).byStep.flat().filter((e) => e.part === 'lead').map((e) => e.midi);
  assert.deepEqual(lead(0), [72, 81, 83]);
  assert.deepEqual(lead(1), []);
  assert.deepEqual(lead(2), [72, 81, 83]);
});

test('"like" inherits a section and overrides parts', () => {
  const b = compileSection(mini, 'b', 0);
  const parts = new Set(b.byStep.flat().map((e) => e.part));
  assert.ok(parts.has('kick') && parts.has('bass') && parts.has('lead'));
  assert.ok(!parts.has('arp'));
});

test('arpeggio digits index chord tones from the base note', () => {
  const sec = compileSection(mini, 'a', 0);
  const arp = sec.byStep.slice(0, 16).flat().filter((e) => e.part === 'arp').map((e) => e.midi);
  assert.deepEqual(arp, [60, 64, 67, 72, 76, 72, 67, 64]);
});

test('scheduling in chunks of any size gives exactly the same events (the lookahead invariant)', () => {
  // The live scheduler asks for "everything before t" every 25 ms; an offline render asks once.
  // Whatever the chunking, every step must come out once, in order, at the same time.
  const all = walk(SONGS.island, 400, 5).out.map((s) => s.t.toFixed(9) + ':' + s.events.map((e) => e.part + (e.midi ?? '')).join(','));
  const seq = createSequence(SONGS.island, { seed: 5 });
  const chunked = [];
  let pending = null;
  let horizon = 0;
  let r = 1;
  while (chunked.length < 400) {
    r = (r * 16807) % 2147483647;
    horizon += 0.02 + (r % 1000) / 4000; // 20 to 270 ms
    for (;;) {
      if (!pending) pending = seq.next();
      if (pending.t >= horizon) break;
      chunked.push(pending.t.toFixed(9) + ':' + pending.events.map((e) => e.part + (e.midi ?? '')).join(','));
      pending = null;
      if (chunked.length === 400) break;
    }
  }
  assert.deepEqual(chunked, all);
});

test('swing and shuffle move off-beats but never the beat', () => {
  const swung = { ...mini, swing: 0.5, shuffle: 0.4 };
  const { out } = walk(swung, 16);
  for (const s of out) {
    const pos = s.i % 4;
    const expect = s.i * 0.125 + [0, 0.5 + 0.2, 0.4, 0.5 + 0.2][pos] * 0.125;
    assert.ok(Math.abs(s.t - expect) < 1e-9, 'step ' + s.i);
  }
});

test('songs that do not loop end, and seek skips ahead', () => {
  const seq = createSequence(SONGS.victory);
  let n = 0;
  while (seq.next()) n++;
  assert.equal(n, 3 * 16);
  assert.equal(seq.next(), null);
  const s2 = createSequence(SONGS.routine);
  s2.seek(60);
  assert.ok(Math.abs(s2.step * s2.stepDur - 60) < s2.stepDur);
});

test('structure: sections, eights, loop point and cues', () => {
  const st = songStructure(mini);
  assert.equal(st.bpm, 120);
  assert.deepEqual(st.sections.map((s) => [s.id, s.start, s.end, s.startEight, s.eights]), [['intro', 0, 2, 0, 0.5], ['a', 2, 6, 0.5, 1]]);
  assert.equal(st.loop, true);
  assert.equal(st.loopStart, 2);
  assert.equal(st.duration, 6);
  assert.deepEqual(st.cues.map((c) => [c.kind, c.beat, c.count]), [['hey', 11, 4]]);
});

test('meter: waltz sections have three beats a bar and the beat count runs on', () => {
  const waltz = { id: 'w', bpm: 90, voices: { k: { inst: 'kick', role: 'hit' } }, form: ['a', 'b'], sections: { a: { bars: 2, meter: 3, parts: { k: 'x...........' } }, b: { bars: 1, parts: { k: 'x...............' } } } };
  const st = songStructure(waltz);
  assert.deepEqual(st.sections.map((s) => [s.bars, s.beats]), [[2, 6], [1, 4]]);
  const { out } = walk(waltz, 40);
  assert.deepEqual(out.filter((s) => s.events.length).map((s) => s.i), [0, 12, 24]);
});
