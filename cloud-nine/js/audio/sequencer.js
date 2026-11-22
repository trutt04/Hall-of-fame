// The music sequencer: walks a song (data, see songs.js) one 16th-note step at a time and says
// which notes start on each step. Pure: no WebAudio, no DOM, so the timing logic runs under node.
//
//   const seq = createSequence(song, { seed })
//   seq.stepDur                  seconds per 16th note
//   seq.next() -> step | null    null once a song that does not loop has finished
//     step = { i, t, section, name, pass, secStep, bar, sectionStart, beat, events, chord, sweep }
//       i     global step index from the start of the song (never resets, even across loops)
//       t     song time in seconds (swing included); the music clock
//       beat  { n, count 1..8, eight } on quarter-note steps, else null
//       events [{ part, inst, role, len (steps), vel, midi | notes, roll, glide, from, v, chord }]
//   seq.seek(seconds)            fast-forward (skips events), for renders that start mid-song
//   songStructure(song) -> { id, bpm, beatsPerEight: 8, duration, eights, loop, loopStart, tail,
//                            sections: [{ id, name, start, end, startBeat, beats, startEight, eights, bars, energy }],
//                            cues: [{ beat, time, eight, count, kind }] }
//
// Song shape:
//   { id, bpm, swing (odd 16ths late, in 16ths), shuffle (the off-beat 8th late, in 16ths), loop,
//     loopFrom (form index the loop goes back to), tail (seconds the last notes ring after the end),
//     voices: { part: { inst, role, vol, pan, rev, del, ...instrument params } },
//     form: ['intro', 'a', ['b', 'b2'], ...],     an array entry alternates by pass (b, then b2, then b...)
//     sections: { id: { name, bars, meter (beats a bar, default 4), chords, tr (semitones), energy,
//                       sweep: { lp|hp: [fromHz, toHz] }, like: 'otherSection', parts: { part: spec } } } }
//   roles: hit (drums, shouts, one-shot fx), fx (held fx like risers), bass, chord, arp, melody
//   spec: a pattern string, an array of bar strings, or { p, alts: [spec | null, ...], gain, inst, oct, ... }
//         alts pick by pass, so a part can change (or rest) on later times round the loop.

import { bassNote, chordTones, parseChords, parseHits, parseHold, parseMelody, voiceChord } from './theory.js';
import { mulberry32 } from '../core/util.js';

export const ROLES = ['hit', 'fx', 'bass', 'chord', 'arp', 'melody'];

// a section with `like` copied out in full (parts merged; a part set to null is removed)
export function resolveSection(song, id) {
  const sec = song.sections[id];
  if (!sec) throw new Error('song ' + song.id + ' has no section "' + id + '"');
  if (!sec.like) return sec;
  const base = resolveSection(song, sec.like);
  const parts = { ...base.parts, ...sec.parts };
  for (const k of Object.keys(parts)) if (parts[k] === null) delete parts[k];
  return { ...base, ...sec, parts, like: undefined };
}

function resolveSpec(spec, pass) {
  if (spec === null || spec === undefined) return null;
  if (typeof spec === 'string' || Array.isArray(spec)) return { p: spec };
  if (spec.alts) {
    const pick = spec.alts[pass % spec.alts.length];
    if (pick === null || pick === undefined) return null;
    const rest = { ...spec };
    delete rest.alts;
    if (typeof pick === 'string' || Array.isArray(pick)) return { ...rest, p: pick };
    return resolveSpec({ ...rest, ...pick }, pass);
  }
  return spec;
}

// Which alternative each part (and the form) takes on a pass: the cache key for compiled sections.
function altKey(sec, pass) {
  const keys = [];
  for (const [name, spec] of Object.entries(sec.parts || {})) {
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && spec.alts) keys.push(name + (pass % spec.alts.length));
  }
  return keys.join(',');
}

// Split [step, step + len) where the chord changes, so held bass notes and pads follow the harmony.
function splitAtChords(step, len, chords) {
  const out = [];
  for (const c of chords) {
    const a = Math.max(step, c.step);
    const b = Math.min(step + len, c.step + c.len);
    if (b > a) out.push({ step: a, len: b - a, chord: c.chord });
  }
  return out;
}

function chordAt(chords, step) {
  for (const c of chords) if (step >= c.step && step < c.step + c.len) return c.chord;
  return null;
}

export function compileSection(song, id, pass = 0) {
  const sec = resolveSection(song, id);
  const meter = sec.meter || 4;
  const stepsPerBar = meter * 4;
  const steps = sec.bars * stepsPerBar;
  const tr = sec.tr || 0;
  const chords = parseChords(sec.chords, sec.bars, stepsPerBar, tr);
  const byStep = Array.from({ length: steps }, () => []);
  const add = (step, ev) => {
    if (step >= 0 && step < steps) byStep[step].push(ev);
  };

  for (const [part, rawSpec] of Object.entries(sec.parts || {})) {
    const spec = resolveSpec(rawSpec, pass);
    if (!spec || spec.p === undefined || spec.p === null) continue;
    const base = song.voices[part];
    if (!base) throw new Error('song ' + song.id + ' section ' + id + ' uses unknown part "' + part + '"');
    const v = { ...base, ...spec };
    delete v.p;
    const role = v.role;
    const gainMul = spec.gain ?? 1;
    const oct = v.oct || 0;
    const mk = (step, extra) => ({ part, inst: v.inst, role, v, chord: chordAt(chords, step), ...extra });

    if (role === 'hit') {
      const { steps: n, hits } = parseHits(spec.p);
      if (!n) continue;
      for (let at = 0; at < steps; at += n) {
        for (const h of hits) add(at + h.step, mk(at + h.step, { len: 1, vel: h.vel * gainMul, roll: h.roll }));
      }
    } else if (role === 'melody') {
      const { steps: n, notes } = parseMelody(spec.p, { len: v.len || 2, stepsPerBar });
      if (!n) continue;
      if (n > steps) throw new Error(song.id + '/' + id + '/' + part + ': melody is ' + n + ' steps, the section only ' + steps);
      let prev = null;
      for (let at = 0; at < steps; at += n) {
        for (const note of notes) {
          const midi = note.midi + tr + oct;
          add(at + note.step, mk(at + note.step, {
            len: Math.min(note.len, steps - at - note.step),
            vel: note.vel * gainMul,
            midi,
            glide: note.glide,
            from: note.glide && prev !== null ? prev : null,
          }));
          prev = midi;
        }
      }
    } else {
      const { steps: n, notes } = parseHold(spec.p);
      if (!n) continue;
      let prevVoicing = null;
      let prevBass = null;
      for (let at = 0; at < steps; at += n) {
        for (const note of notes) {
          const start = at + note.step;
          if (start >= steps) continue;
          const len = Math.min(note.len, steps - start);
          if (role === 'fx') {
            add(start, mk(start, { len, vel: ({ o: 0.5, x: 0.8, X: 1 }[note.sym] ?? 0.8) * gainMul }));
          } else if (role === 'arp') {
            const chord = chordAt(chords, start);
            if (!chord) continue;
            const idx = parseInt(note.sym, 36);
            const tones = chordTones(chord, (v.base ?? 60) + tr, idx + 1);
            add(start, mk(start, { len, vel: 0.8 * gainMul, midi: tones[idx] + oct }));
          } else if (role === 'bass') {
            for (const piece of splitAtChords(start, len, chords)) {
              if (!piece.chord) continue;
              const midi = bassNote(piece.chord, note.sym, v.base ?? 36) + oct;
              const contiguous = prevBass && prevBass.end === piece.step;
              add(piece.step, mk(piece.step, {
                len: piece.len,
                vel: 0.8 * gainMul,
                midi,
                glide: !!(v.glide && contiguous),
                from: v.glide && contiguous ? prevBass.midi : null,
              }));
              prevBass = { midi, end: piece.step + piece.len };
            }
          } else if (role === 'chord') {
            const vel = ({ o: 0.5, x: 0.8, X: 1 }[note.sym] ?? 0.8) * gainMul;
            for (const piece of splitAtChords(start, len, chords)) {
              if (!piece.chord) continue;
              const notes = voiceChord(piece.chord, { lo: (v.lo ?? 52) + oct, hi: (v.hi ?? 76) + oct, size: v.size ?? 4, prev: prevVoicing });
              prevVoicing = notes;
              add(piece.step, mk(piece.step, { len: piece.len, vel, notes }));
            }
          } else {
            throw new Error('unknown role "' + role + '" for part ' + part);
          }
        }
      }
    }
  }
  return { id, name: sec.name || id, bars: sec.bars, meter, stepsPerBar, steps, tr, chords, byStep, energy: sec.energy ?? 0.5, sweep: sec.sweep || null };
}

export function createSequence(song, { seed = 1 } = {}) {
  const stepDur = 60 / song.bpm / 4;
  // swing delays the odd 16ths; shuffle delays the off-beat 8th (and eases the 16ths either side
  // of it), the lazy long-short feel. Both are fractions of a 16th, and beats themselves never move.
  const swing = song.swing || 0;
  const shuffle = song.shuffle || 0;
  const feel = [0, swing + shuffle * 0.5, shuffle, swing + shuffle * 0.5].map((x) => x * stepDur);
  const rng = mulberry32(seed);
  const cache = new Map();
  let formIndex = 0;
  let pass = 0;
  let secStep = 0;
  let i = 0;
  let cur = null;
  let done = false;

  function sectionFor(fi, p) {
    const entry = song.form[fi];
    const id = Array.isArray(entry) ? entry[p % entry.length] : entry;
    const key = id + '#' + altKey(resolveSection(song, id), p);
    let sec = cache.get(key);
    if (!sec) {
      sec = compileSection(song, id, p);
      cache.set(key, sec);
    }
    return sec;
  }

  function next() {
    if (done) return null;
    if (!cur) {
      cur = sectionFor(formIndex, pass);
      secStep = 0;
    }
    const t = i * stepDur + feel[secStep % 4];
    const n = i / 4;
    const beat = i % 4 === 0 ? { n, count: (n % 8) + 1, eight: Math.floor(n / 8) } : null;
    const events = cur.byStep[secStep].map((ev) => (ev.role === 'hit' ? { ...ev, vel: ev.vel * (0.95 + rng() * 0.1) } : ev));
    const step = {
      i,
      t,
      section: cur.id,
      name: cur.name,
      pass,
      secStep,
      bar: Math.floor(secStep / cur.stepsPerBar),
      sectionStart: secStep === 0,
      sectionSteps: cur.steps,
      meter: cur.meter,
      energy: cur.energy,
      sweep: secStep === 0 ? cur.sweep : null,
      beat,
      events,
      chord: chordAt(cur.chords, secStep),
    };
    i++;
    secStep++;
    if (secStep >= cur.steps) {
      cur = null;
      formIndex++;
      if (formIndex >= song.form.length) {
        if (song.loop) {
          formIndex = song.loopFrom || 0;
          pass++;
        } else {
          done = true;
        }
      }
    }
    return step;
  }

  function seek(seconds) {
    while (!done && i * stepDur < seconds - 1e-9) next();
  }

  return {
    next,
    seek,
    stepDur,
    song,
    get step() { return i; },
    get pass() { return pass; },
    get done() { return done; },
  };
}

// The published shape of a song: sections in seconds, beats and eight-counts (first time through),
// plus the cues (shouts, hits, crashes) a rhythm chart can line up with.
export function songStructure(song) {
  const seq = createSequence(song, { seed: 1 });
  const spb = 60 / song.bpm;
  const sections = [];
  const cues = [];
  const cueParts = new Set(Object.entries(song.voices).filter(([, v]) => v.cue).map(([k]) => k));
  let loopStart = 0;
  let formSeen = 0;
  let total = 0;
  // one pass of the form: stop when the loop wraps (pass 1) or the song ends
  for (let st = seq.next(); st && st.pass === 0; st = seq.next()) {
    if (st.sectionStart) {
      if (song.loop && formSeen === (song.loopFrom || 0)) loopStart = st.i * seq.stepDur;
      formSeen++;
      sections.push({
        id: st.section,
        name: st.name,
        start: st.i * seq.stepDur,
        startBeat: st.i / 4,
        startEight: st.i / 32,
        steps: st.sectionSteps,
        meter: st.meter,
        energy: st.energy,
      });
    }
    for (const ev of st.events) {
      if (!cueParts.has(ev.part)) continue;
      const beat = st.i / 4;
      cues.push({ beat, time: beat * spb, eight: Math.floor(beat / 8), count: (Math.floor(beat) % 8) + 1, kind: song.voices[ev.part].cue });
    }
    total = st.i + 1;
  }
  const duration = total * seq.stepDur;
  for (const s of sections) {
    s.beats = s.steps / 4;
    s.eights = s.beats / 8;
    s.end = s.start + s.steps * seq.stepDur;
    s.bars = s.steps / (s.meter * 4);
    delete s.steps;
  }
  return {
    id: song.id,
    title: song.title || song.id,
    bpm: song.bpm,
    beatsPerEight: 8,
    duration,
    beats: total / 4,
    eights: total / 32,
    loop: !!song.loop,
    loopStart: song.loop ? loopStart : null,
    tail: song.tail || 0,
    sections,
    cues,
  };
}
