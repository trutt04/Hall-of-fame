// The soundtrack as data (js/audio/songs.js): every track is well formed, in range and on tempo,
// the routine has the published eight-count structure, and "Happy Birthday" is the real tune.
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileSection, createSequence, resolveSection, songStructure } from '../js/audio/sequencer.js';
import { SONGS, TRACK_IDS } from '../js/audio/songs.js';
import { SFX_NAMES } from '../js/audio/sfx.js';
import { INSTRUMENTS } from '../js/audio/synth.js';
import { noteToMidi, parseMelody } from '../js/audio/theory.js';

const CONTRACT_TRACKS = ['island', 'game', 'tense', 'routine', 'birthday', 'victory'];
const CONTRACT_SFX = 'tap, open, close, toss, whoosh, sparkle, land, cradle, cheer, crowd, clap, whistle, count, go, bounce, throw, hit, catch, pop, found, freeze, unfreeze, bowGrab, score, tada, aww, firework, chime, step, jump, poms'.split(', ');

test('the six contract tracks exist', () => {
  assert.deepEqual([...TRACK_IDS].sort(), [...CONTRACT_TRACKS].sort());
});

test('every contract sound effect exists, and nothing else', () => {
  assert.equal(CONTRACT_SFX.length, 31);
  assert.deepEqual([...SFX_NAMES].sort(), [...CONTRACT_SFX].sort());
});

test('tempos match the brief', () => {
  assert.ok(SONGS.island.bpm >= 100 && SONGS.island.bpm <= 110);
  assert.ok(Math.abs(SONGS.game.bpm - 128) <= 4);
  assert.ok(Math.abs(SONGS.routine.bpm - 144) <= 4);
  for (const id of TRACK_IDS) assert.ok(SONGS[id].bpm >= 80 && SONGS[id].bpm <= 170, id);
});

test('every part uses a real instrument and a known role', () => {
  for (const id of TRACK_IDS) {
    for (const [part, v] of Object.entries(SONGS[id].voices)) {
      assert.ok(INSTRUMENTS[v.inst], `${id}/${part}: no instrument "${v.inst}"`);
      assert.ok(['hit', 'fx', 'bass', 'chord', 'arp', 'melody'].includes(v.role), `${id}/${part}: role ${v.role}`);
      assert.ok(v.vol > 0 && v.vol <= 1.5, `${id}/${part}: vol ${v.vol}`);
    }
    for (const sec of Object.values(SONGS[id].sections)) {
      for (const spec of Object.values(sec.parts || {})) {
        if (spec && spec.inst) assert.ok(INSTRUMENTS[spec.inst], `${id}: no instrument "${spec.inst}"`);
        for (const alt of (spec && spec.alts) || []) if (alt && alt.inst) assert.ok(INSTRUMENTS[alt.inst], `${id}: no instrument "${alt.inst}"`);
      }
    }
  }
});

test('every section compiles on every pass, melodies fill their bars exactly, notes stay in range', () => {
  for (const id of TRACK_IDS) {
    const song = SONGS[id];
    for (const secId of Object.keys(song.sections)) {
      for (let pass = 0; pass < 6; pass++) {
        const sec = compileSection(song, secId, pass);
        for (const evs of sec.byStep) {
          for (const ev of evs) {
            const notes = ev.notes || (ev.midi !== undefined ? [ev.midi] : []);
            for (const m of notes) {
              const lo = ev.role === 'bass' ? 24 : 45;
              const hi = ev.role === 'bass' ? 64 : 100;
              assert.ok(m >= lo && m <= hi, `${id}/${secId}/${ev.part}: note ${m} out of range`);
            }
            assert.ok(ev.len >= 1 && ev.vel > 0 && ev.vel <= 1.2, `${id}/${secId}/${ev.part}: len ${ev.len} vel ${ev.vel}`);
          }
        }
      }
      // a melody fills its section exactly, or repeats a whole number of times to fill it
      const sec = song.sections[secId];
      const full = resolveSection(song, secId);
      for (const [part, spec] of Object.entries(sec.parts || {})) {
        if (!spec || song.voices[part].role !== 'melody') continue;
        const options = spec.alts ? spec.alts : [spec];
        for (const opt of options) {
          if (!opt) continue;
          const p = typeof opt === 'string' || Array.isArray(opt) ? opt : opt.p;
          const { steps } = parseMelody(p, { stepsPerBar: (full.meter || 4) * 4 });
          const want = full.bars * (full.meter || 4) * 4;
          assert.ok(steps > 0 && want % steps === 0, `${id}/${secId}/${part} is ${steps} steps, the section ${want}`);
        }
      }
    }
  }
});

test('the routine is 36 eight-counts at 144 BPM: two minutes, sections on eight-count lines', () => {
  const st = songStructure(SONGS.routine);
  assert.equal(st.bpm, 144);
  assert.equal(st.eights, 36);
  assert.ok(Math.abs(st.duration - 120) < 1e-9);
  assert.equal(st.loop, false);
  assert.deepEqual(st.sections.map((s) => s.id), ['intro', 'opening', 'standing', 'stunts', 'pyramid', 'jumps', 'running', 'dance', 'finale']);
  let at = 0;
  for (const s of st.sections) {
    assert.ok(Number.isInteger(s.eights), s.id + ' is not whole eights');
    assert.ok(Math.abs(s.startEight - at) < 1e-9);
    at += s.eights;
    assert.ok(s.name && s.energy > 0);
  }
  // there are shouts and hits to line a chart up with, and the last thing is the final pose on count 8
  assert.ok(st.cues.filter((c) => c.kind === 'hey').length >= 10);
  const last = st.cues[st.cues.length - 1];
  assert.equal(last.eight, 35);
  assert.equal(last.count, 8);
});

test('the island loops for two minutes and changes a little every time round', () => {
  const st = songStructure(SONGS.island);
  assert.equal(st.loop, true);
  assert.ok(Math.abs(st.duration - st.loopStart - 120) < 1e-6, 'loop is ' + (st.duration - st.loopStart));
  // two passes of the loop are not identical
  const seq = createSequence(SONGS.island, { seed: 1 });
  const loopSteps = Math.round((st.duration - st.loopStart) / seq.stepDur);
  const introSteps = Math.round(st.loopStart / seq.stepDur);
  const sig = [];
  for (let i = 0; i < introSteps + loopSteps * 3; i++) {
    const s = seq.next();
    sig.push(s.events.filter((e) => e.role !== 'hit').map((e) => e.part + ':' + e.inst + ':' + (e.midi ?? (e.notes || []).join('.'))).join(','));
  }
  const pass = (k) => sig.slice(introSteps + k * loopSteps, introSteps + (k + 1) * loopSteps).join('|');
  assert.notEqual(pass(0), pass(1));
  assert.notEqual(pass(1), pass(2));
});

test('the victory sting lasts four to six seconds', () => {
  const st = songStructure(SONGS.victory);
  const total = st.duration + st.tail;
  assert.ok(total >= 4 && total <= 6, 'victory is ' + total + ' s');
});

// the notes one part plays in the named sections, first time through (looping songs never end)
function partNotes(song, part, sections) {
  const seq = createSequence(song);
  const out = [];
  for (let s = seq.next(); s && s.pass === 0; s = seq.next()) {
    if (!sections.includes(s.section)) continue;
    for (const ev of s.events) if (ev.part === part) out.push({ midi: ev.midi, len: ev.len });
  }
  return out;
}

test('"Happy Birthday to You" is the real tune, in its own 3/4, and the band takes it up a step', () => {
  const tune = 'G4 G4 A4 G4 C5 B4 G4 G4 A4 G4 D5 C5 G4 G4 G5 E5 C5 B4 A4 F5 F5 E5 C5 D5 C5'.split(' ').map(noteToMidi);
  const lens = [3, 1, 4, 4, 4, 8, 3, 1, 4, 4, 4, 8, 3, 1, 4, 4, 4, 4, 4, 3, 1, 4, 4, 4];
  // verse 1: the pickup lives at the end of the fanfare
  const v1 = partNotes(SONGS.birthday, 'box', ['fanfare', 'verse1']);
  assert.deepEqual(v1.slice(0, 25).map((n) => n.midi), tune);
  assert.deepEqual(v1.slice(0, 24).map((n) => n.len), lens);
  assert.equal(SONGS.birthday.sections.verse1.meter, 3);
  // verse 2, the full band: the same tune two semitones up
  const v2 = partNotes(SONGS.birthday, 'lead', ['verse2']);
  assert.deepEqual(v2.map((n) => n.midi), tune.slice(2).map((m) => m + 2));
});

test('the Cloud Nine motif (sol-do-mi) opens the island chorus and the routine hook', () => {
  const shape = (notes) => [notes[1] - notes[0], notes[2] - notes[1]];
  const chorus = partNotes(SONGS.island, 'lead', ['chorus']).map((n) => n.midi);
  const hook = partNotes(SONGS.routine, 'lead', ['opening']).map((n) => n.midi);
  assert.deepEqual(shape(chorus), [5, 4]);
  assert.deepEqual(shape(hook), [5, 4]);
});
