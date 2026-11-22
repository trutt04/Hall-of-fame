import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, PATTERNS, DEFAULT_STRUCTURE, DEFAULT_BPM, MOTION_SETS, MOTION_LABELS,
  levelInfo, parseEight, normalizeStructure, kindOf, buildChart, resolveOverlaps,
} from '../js/rhythm/charts.js';

// Every hold lets go at least half a beat before the next note on its lane.
function assertNoLaneOverlap(notes, label) {
  const lastEnd = [-Infinity, -Infinity, -Infinity];
  for (const n of notes) {
    for (const l of n.lanes) {
      assert.ok(n.beat >= lastEnd[l] + 0.5 - 1e-9, `${label}: lane ${l} note at beat ${n.beat} starts before the previous one lets go (${lastEnd[l]})`);
    }
    for (const l of n.lanes) lastEnd[l] = n.beat + n.len;
  }
}

test('levels: three of them, named the way cheer kids know them', () => {
  assert.deepEqual(LEVELS.map((l) => l.name), ['Level 1', 'Level 4', 'Level 7']);
  assert.ok(LEVELS[0].approach > LEVELS[1].approach && LEVELS[1].approach > LEVELS[2].approach, 'higher levels scroll faster');
  for (const [input, id] of [[4, 4], ['7', 7], ['Level 4', 4], ['L7', 7], [{ id: 4 }, 4], [2, 1], [null, 1], ['nope', 1], [undefined, 1]]) {
    assert.equal(levelInfo(input).id, id, `levelInfo(${JSON.stringify(input)})`);
  }
});

test('pattern notation: rests, taps, stunts, holds and "and" counts', () => {
  assert.deepEqual(parseEight('. . . . . . . .'), []);
  assert.deepEqual(parseEight('L . M . R . . .'), [
    { at: 0, lanes: [0], len: 0 }, { at: 2, lanes: [1], len: 0 }, { at: 4, lanes: [2], len: 0 },
  ]);
  assert.deepEqual(parseEight('RL . . . . . . M_2'), [{ at: 0, lanes: [0, 2], len: 0 }, { at: 7, lanes: [1], len: 2 }]);
  assert.deepEqual(parseEight('L&R .&M . . . . . LR_1.5'), [
    { at: 0, lanes: [0], len: 0 }, { at: 0.5, lanes: [2], len: 0 }, { at: 1.5, lanes: [1], len: 0 }, { at: 7, lanes: [0, 2], len: 1.5 },
  ]);
  assert.throws(() => parseEight('L . M'), /8 tokens/);
  assert.throws(() => parseEight('X . . . . . . .'), /bad pattern/);
  assert.throws(() => parseEight('LL . . . . . . .'), /two different lanes/);
  assert.throws(() => parseEight('L&M&R . . . . . . .'), /one "&"/);
});

test('patterns: every one parses, and holds never run into the next note on their lane', () => {
  for (const [lvl, pools] of Object.entries(PATTERNS)) {
    for (const [kind, list] of Object.entries(pools)) {
      assert.ok(list.length >= 2, `level ${lvl} ${kind} has a choice of patterns`);
      for (const p of list) {
        const notes = parseEight(p).map((n) => ({ beat: n.at, lanes: n.lanes, len: n.len }));
        assert.ok(notes.length > 0, `${lvl}/${kind}: "${p}" has notes`);
        assertNoLaneOverlap(notes, `${lvl}/${kind} "${p}"`);
        if (lvl === '1') {
          assert.ok(!p.includes('&'), `Level 1 stays on the counts: "${p}"`);
          // little ones: nothing else happens while a hold is held
          let busyUntil = -Infinity;
          for (const n of notes) {
            assert.ok(n.beat >= busyUntil, `Level 1 "${p}": a note at ${n.beat} lands during a hold`);
            busyUntil = Math.max(busyUntil, n.beat + n.len);
          }
        }
      }
    }
    assert.ok(/_4/.test(pools.finale[0]) && /LR/.test(pools.finale[0]), `level ${lvl} ends on a two-lane final pose`);
  }
});

test('charts: the default routine on every level', () => {
  let prev = 0;
  for (const L of LEVELS) {
    const c = buildChart({ level: L.id });
    assert.equal(c.level.id, L.id);
    assert.equal(c.bpm, DEFAULT_BPM);
    assert.ok(Math.abs(c.spb - 60 / 144) < 1e-12);
    assert.ok(c.notes.length > prev, `${L.name} has more notes than the level below`);
    prev = c.notes.length;
    // sorted, timed, and in sections that carry notes
    for (let i = 0; i < c.notes.length; i++) {
      const n = c.notes[i];
      assert.equal(n.id, i);
      if (i) assert.ok(n.beat >= c.notes[i - 1].beat);
      assert.ok(Math.abs(n.t - n.beat * c.spb) < 1e-9 && Math.abs(n.end - (n.beat + n.len) * c.spb) < 1e-9);
      assert.ok(['tap', 'hold', 'stunt'].includes(n.kind));
      assert.equal(n.kind === 'stunt', n.lanes.length === 2);
      assert.ok(MOTION_LABELS[n.motion], `note motion "${n.motion}" has a label`);
      const sec = c.sections[n.section];
      assert.ok(!['intro', 'outro'].includes(sec.kind), 'no notes in the intro or the final pose');
      assert.ok(n.beat >= sec.startBeat && n.beat < sec.startBeat + sec.eights * 8);
    }
    assertNoLaneOverlap(c.notes, L.name);
    assert.ok(c.firstBeat >= 8, 'the first eight-count is the count-in');
    assert.equal(c.countInBeat, Math.floor(c.firstBeat / 8) * 8 - 8);
    const last = c.notes[c.notes.length - 1];
    assert.equal(last.kind, 'stunt');
    assert.ok(last.len >= 2, 'the routine ends on a held two-lane final pose');
    assert.ok(c.endBeat > c.lastBeat && c.endBeat <= c.totalBeats + 4);
    assert.equal(c.stats.notes, c.notes.length);
    assert.ok(c.stats.holds > 3 && c.stats.stunts > 3 && c.stats.taps > 10, `${L.name} mixes taps, holds and stunts`);
    for (const s of c.sections) assert.equal(s.motions.length, 3);
    const secs = DEFAULT_STRUCTURE.reduce((a, s) => a + s.eights, 0) * 8 * c.spb;
    assert.ok(secs > 50 && secs < 75, 'about a minute of routine');
  }
});

test('charts: the same seed gives the same chart (everyone in a room plays the same one)', () => {
  const a = buildChart({ level: 4, seed: 11 });
  const b = buildChart({ level: 4, seed: 11 });
  assert.deepEqual(a.notes, b.notes);
  const sig = (c) => c.notes.map((n) => n.beat + ':' + n.lanes.join('')).join(' ');
  const differs = [1, 2, 3, 5, 8].some((seed) => sig(buildChart({ level: 4, seed })) !== sig(a));
  assert.ok(differs, 'other seeds shuffle the patterns');
});

test('charts: the audio module tempo is used, junk tempos are not', () => {
  assert.equal(buildChart({ level: 1, bpm: 120 }).bpm, 120);
  assert.equal(buildChart({ level: 1, bpm: 'fast' }).bpm, DEFAULT_BPM);
  assert.equal(buildChart({ level: 1, bpm: 9000 }).bpm, DEFAULT_BPM);
});

test('structure: the shapes an audio module might hand over', () => {
  const plain = normalizeStructure([{ name: 'intro', eights: 2 }, { name: 'stunts', eights: 4 }]);
  assert.deepEqual(plain.map((s) => [s.kind, s.eights]), [['intro', 2], ['stunts', 4]]);
  assert.deepEqual(normalizeStructure({ sections: [{ id: 'jumps', beats: 16 }] }).map((s) => [s.kind, s.eights]), [['jumps', 2]]);
  assert.deepEqual(normalizeStructure({ routine: [{ kind: 'dance', bars: 8 }] }).map((s) => [s.kind, s.eights]), [['dance', 4]]);
  assert.deepEqual(normalizeStructure(['intro', 'stunts', 'stunts', 'dance']).map((s) => [s.kind, s.eights]), [['intro', 1], ['stunts', 2], ['dance', 1]]);
  assert.deepEqual(normalizeStructure({ intro: 1, pyramid: 3 }).map((s) => [s.kind, s.eights]), [['intro', 1], ['pyramid', 3]]);
  // start positions only, with a gap: lengths come from the next start, the gap is a breather
  const pos = normalizeStructure([{ name: 'intro', startBeat: 0 }, { name: 'tumbling', startBeat: 8 }, { name: 'finale', startBeat: 32, eights: 1 }]);
  assert.deepEqual(pos.map((s) => [s.kind, s.eights]), [['intro', 1], ['tumbling', 3], ['finale', 1]]);
  const gap = normalizeStructure([{ name: 'opening', startEight: 0, eights: 2 }, { name: 'dance', startEight: 4, eights: 2 }]);
  assert.deepEqual(gap.map((s) => [s.kind, s.eights]), [['opening', 2], ['break', 2], ['dance', 2]]);
  for (const junk of [null, undefined, 7, 'routine', [], {}, [null, 3], { sections: 'nope' }]) assert.equal(normalizeStructure(junk), null, JSON.stringify(junk));
  // sizes are clamped
  assert.equal(normalizeStructure([{ name: 'dance', eights: 999 }])[0].eights, 32);
});

test('structure: section names map to kinds, labels stay short and clean', () => {
  const cases = { intro: 'intro', 'Count In': 'intro', Outro: 'outro', 'Grand Finale': 'finale', opening: 'opening', 'Elite Stunts': 'stunts',
    'basket toss': 'stunts', 'Standing Tumbling': 'tumbling', jumps: 'jumps', Pyramid: 'pyramid', 'bridge': 'break', 'chorus': 'dance', '': 'dance' };
  for (const [name, kind] of Object.entries(cases)) assert.equal(kindOf(name), kind, name);
  const s = normalizeStructure([{ name: 'running tumbling!!', eights: 2 }, { name: 'a very long section name indeed', eights: 2 }, { name: '<b>x</b>', eights: 1 }]);
  assert.equal(s[0].label, 'Running Tumbling');
  assert.equal(s[1].label, 'Dance');
  assert.ok(/^[A-Za-z0-9 ]+$/.test(s[2].label));
});

test('charts: built on a structure from the audio module', () => {
  const structure = [{ name: 'intro', eights: 2 }, { name: 'stunts', eights: 2 }, { name: 'jumps', eights: 1 }, { name: 'dance', eights: 2 }, { name: 'outro', eights: 1 }];
  const c = buildChart({ level: 7, structure, bpm: 140 });
  assert.equal(c.bpm, 140);
  assert.deepEqual(c.sections.map((s) => s.kind), ['intro', 'stunts', 'jumps', 'dance', 'outro']);
  assert.equal(c.firstBeat, 16, 'notes start right after the two-eight intro');
  assert.equal(c.countInBeat, 8);
  assert.equal(c.sections[1].motions.join(), MOTION_SETS.stunts.join());
  assertNoLaneOverlap(c.notes, 'audio structure');
  // a structure with no room for notes falls back to the default routine
  const quiet = buildChart({ level: 1, structure: [{ name: 'intro', eights: 4 }] });
  assert.deepEqual(quiet.sections.map((s) => s.kind), DEFAULT_STRUCTURE.map((s) => s.kind));
  // a structure that starts straight away still gets a count-in eight
  const straight = buildChart({ level: 4, structure: [{ name: 'dance', eights: 4 }] });
  assert.equal(straight.firstBeat, 8);
});

test('overlaps: a hold that runs into the next note on its lane is shortened, or becomes a tap', () => {
  const notes = resolveOverlaps([
    { beat: 0, lanes: [0], len: 4 }, { beat: 3, lanes: [0], len: 0 },
    { beat: 4, lanes: [1, 2], len: 2 }, { beat: 5, lanes: [2], len: 0 },
    { beat: 8, lanes: [1], len: 2 }, { beat: 9, lanes: [0], len: 0 },
  ]);
  assert.equal(notes[0].len, 2.5);
  assert.equal(notes[2].len, 0, 'no room for a beat of hold: a plain stunt');
  assert.equal(notes[4].len, 2, 'other lanes do not get in the way');
});
