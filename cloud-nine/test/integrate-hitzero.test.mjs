// Hit Zero built on the real routine track: the chart follows the audio module's beat.structure
// eight for eight (no invented breaks), ends with the music, and runs at the track's tempo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackStructure, SONGS } from '../js/audio/index.js';
import { buildChart, normalizeStructure } from '../js/rhythm/charts.js';

test("the routine's structure reads as its own sections, in eights", () => {
  const st = trackStructure('routine');
  const secs = normalizeStructure(st);
  assert.ok(secs && secs.length === st.length, 'one section per audio section, no breaks added');
  assert.deepEqual(secs.map((s) => s.eights), st.map((s) => s.eights));
  assert.equal(secs.reduce((a, s) => a + s.eights, 0), st.eights);
});

test('every chart ends with the music, at the track tempo', () => {
  const st = trackStructure('routine');
  const bpm = SONGS.routine.bpm;
  for (const level of [1, 4, 7]) {
    const chart = buildChart({ level, structure: st, bpm, seed: 11 });
    assert.equal(chart.totalBeats, st.beats, 'level ' + level + ': as long as the song');
    // note times are song seconds
    const lastEnd = Math.max(...chart.notes.map((n) => n.end));
    assert.ok(lastEnd <= st.duration + 1e-6, 'level ' + level + ': the last note (' + lastEnd + ' s) is inside the song (' + st.duration + ' s)');
    assert.ok(Math.abs(chart.spb - 60 / bpm) < 1e-9, 'level ' + level + ' runs at the routine tempo');
  }
});
